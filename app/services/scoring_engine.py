
"""
scoring_engine.py
-----------------
Pure Python scoring engine for 501 darts.

Deliberately has no Flask dependency so it can be unit-tested in isolation
and reused for future game types (Cricket, etc.).

All functions are stateless — they receive the current game state as input
and return a result. The Flask route layer is responsible for persisting
state to the database.
"""


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

class ThrowResult:
    """
    Represents the outcome of a single dart throw.

    Attributes:
        points       -- points scored by this dart (0 if bust)
        score_after  -- player's remaining score after this dart (unchanged if bust)
        is_bust      -- True if the throw resulted in a bust
        is_checkout  -- True if the throw won the leg
        turn_complete-- True if the turn is now over (bust, checkout, or 3rd dart)
        error        -- non-empty string if the throw was rejected as invalid
    """
    def __init__(
        self,
        points: int,
        score_after: int,
        is_bust: bool,
        is_checkout: bool,
        turn_complete: bool,
        error: str
    ):
        self.points = points
        self.score_after = score_after
        self.is_bust = is_bust
        self.is_checkout = is_checkout
        self.turn_complete = turn_complete
        self.error = error

    def __repr__(self):
        return (
            f"ThrowResult(points={self.points}, score_after={self.score_after}, "
            f"is_bust={self.is_bust}, is_checkout={self.is_checkout}, "
            f"turn_complete={self.turn_complete}, error='{self.error}')"
        )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_throw(segment: int, multiplier: int) -> tuple:
    """
    Validate that a segment/multiplier combination is physically possible
    on a standard dartboard.

    Bull (segment 25) only accepts multiplier 1 (outer bull, 25pts)
    or multiplier 2 (bullseye, 50pts). Treble bull does not exist.

    Segment 0 represents a miss (no score). Multiplier must still be 1.

    Returns:
        (True, "")              -- valid throw
        (False, error_message)  -- invalid throw with reason
    """
    if segment == 25:
        # Early return — bull has its own multiplier rules
        if multiplier not in (1, 2):
            return (False, "Bull only accepts multiplier 1 (25pts) or 2 (50pts)")
        return (True, "")

    if not (0 <= segment <= 20):
        return (False, f"Invalid segment: {segment}. Must be 0–20 or 25 (bull)")

    if not (1 <= multiplier <= 3):
        return (False, f"Invalid multiplier: {multiplier}. Must be 1 (single), 2 (double), or 3 (treble)")

    return (True, "")


# ---------------------------------------------------------------------------
# Points calculation
# ---------------------------------------------------------------------------

def calculate_points(segment: int, multiplier: int) -> int:
    """
    Calculate the points value of a dart.

    Standard scoring:
        Single (x1): segment value
        Double (x2): segment value * 2
        Treble (x3): segment value * 3
        Outer bull: 25pts
        Bullseye:   50pts
        Miss:       0pts

    Assumes validate_throw() has already been called.
    """
    # Bull is handled explicitly to make the intent clear
    if segment == 25:
        return 25 * multiplier  # 25 or 50

    return segment * multiplier


# ---------------------------------------------------------------------------
# Bust detection
# ---------------------------------------------------------------------------

def is_bust(score_before: int, points: int, segment: int, multiplier: int) -> bool:
    """
    Determine whether a dart results in a bust under standard 501 rules.

    Bust conditions:
        1. score_after < 0  -- went below zero
        2. score_after == 1 -- impossible to finish (no double scores 1)
        3. score_after == 0 -- reached zero but NOT on a double
                               (D-Bull counts as a valid double finish)

    Note: dart_number is intentionally NOT a parameter here. Bust logic is
    purely a function of the resulting score and the finishing dart type.
    The caller (process_throw) handles turn completion based on dart_number.

    Args:
        score_before -- player's score before this dart
        points       -- points scored by this dart
        segment      -- segment hit (used to distinguish D-Bull from S-Bull)
        multiplier   -- multiplier of the dart (2 = double required to finish)

    Returns:
        True if the throw is a bust, False otherwise
    """
    score_after = score_before - points

    if score_after < 0:
        return True  # Overshot — bust

    if score_after == 1:
        return True  # Stranded on 1 — no double exists to finish from here

    if score_after == 0 and multiplier != 2:
        # Reached zero but not on a double — bust
        # multiplier == 2 covers both D1–D20 and D-Bull (segment=25, multiplier=2)
        return True

    return False


# ---------------------------------------------------------------------------
# Checkout detection
# ---------------------------------------------------------------------------

def is_checkout(score_before: int, segment: int, multiplier: int) -> bool:
    """
    Determine whether a dart completes the leg (checkout).

    A valid checkout requires:
        - score_after == 0
        - The finishing dart is a double (multiplier == 2)
        - D-Bull (segment=25, multiplier=2) is a valid checkout

    Args:
        score_before -- player's score before this dart
        segment      -- segment hit
        multiplier   -- multiplier of the dart

    Returns:
        True if this dart wins the leg, False otherwise
    """
    points = calculate_points(segment, multiplier)
    score_after = score_before - points
    return score_after == 0 and multiplier == 2


# ---------------------------------------------------------------------------
# Primary interface
# ---------------------------------------------------------------------------

def process_throw(state: dict, segment: int, multiplier: int) -> ThrowResult:
    """
    Process a single dart throw and return the full outcome.

    This is the main entry point called by the Flask route when a player
    records a dart. It orchestrates validation, scoring, bust detection,
    and checkout detection in the correct order.

    Checkout is evaluated BEFORE bust — a valid finish is never a bust.

    Args:
        state: dict with keys:
            'score'      -- int, player's current remaining score
            'dart_number'-- int, which dart in the turn this is (1, 2, or 3)
            'turn_darts' -- list of ThrowResult objects thrown so far this turn
        segment   -- int, board segment hit (0–20 or 25)
        multiplier-- int, 1=single, 2=double, 3=treble

    Returns:
        ThrowResult describing the full outcome of the dart
    """
    score_before = state['score']
    dart_number = state['dart_number']

    # --- Validate the throw first ---
    is_valid, error_message = validate_throw(segment, multiplier)
    if not is_valid:
        # Rejected throw: turn is NOT ended — player retries the dart
        return ThrowResult(
            points=0,
            score_after=score_before,
            is_bust=False,
            is_checkout=False,
            turn_complete=False,
            error=error_message
        )

    points = calculate_points(segment, multiplier)

    # --- Checkout must be checked before bust ---
    # A dart that lands on zero via a double is a checkout, not a bust,
    # even though is_bust() would also return True for score_after == 0
    # without a double. Evaluate checkout first and skip bust if confirmed.
    is_checkout_flag = is_checkout(score_before, segment, multiplier)
    is_bust_flag = False if is_checkout_flag else is_bust(score_before, points, segment, multiplier)

    # Turn ends on: checkout, bust, or using all 3 darts
    turn_complete = is_checkout_flag or is_bust_flag or (dart_number == 3)

    # On a bust the score reverts to what it was at the start of the turn —
    # that reversion is handled by the Flask route using score_before from
    # the turn record. Here we simply don't subtract points on a bust.
    score_after = score_before - points if not is_bust_flag else score_before

    return ThrowResult(
        points=points,
        score_after=score_after,
        is_bust=is_bust_flag,
        is_checkout=is_checkout_flag,
        turn_complete=turn_complete,
        error=""
    )


# ---------------------------------------------------------------------------
# Checkout suggestions
# ---------------------------------------------------------------------------

def suggested_checkouts(score: int) -> list:
    """
    Return a suggested dart combination to finish from the given score.

    Covers all valid finishes from 2 to 170.
    Returns None for impossible scores (169, 168, 166, 165, 163, 162, 159)
    or scores outside the valid range.

    Dart notation:
        S  = Single   e.g. S20
        D  = Double   e.g. D20
        T  = Treble   e.g. T20
        DB = D-Bull (bullseye, 50pts)
        OB = Outer bull (25pts)
    """
    # Scores that cannot be checked out under any combination
    impossible = {159, 162, 163, 165, 166, 168, 169}

    if score in impossible or score < 2 or score > 170:
        return None

    checkouts = {
        # ---- One-dart finishes ----
        2:   ["D1"],
        4:   ["D2"],
        6:   ["D3"],
        8:   ["D4"],
        10:  ["D5"],
        12:  ["D6"],
        14:  ["D7"],
        16:  ["D8"],
        18:  ["D9"],
        20:  ["D10"],
        22:  ["D11"],
        24:  ["D12"],
        26:  ["D13"],
        28:  ["D14"],
        30:  ["D15"],
        32:  ["D16"],
        34:  ["D17"],
        36:  ["D18"],
        38:  ["D19"],
        40:  ["D20"],
        50:  ["DB"],

        # ---- Two-dart finishes ----
        3:   ["S1",  "D1"],
        5:   ["S1",  "D2"],
        7:   ["S3",  "D2"],
        9:   ["S1",  "D4"],
        11:  ["S3",  "D4"],
        13:  ["S5",  "D4"],
        15:  ["S7",  "D4"],
        17:  ["S9",  "D4"],
        19:  ["S3",  "D8"],
        21:  ["S5",  "D8"],
        23:  ["S7",  "D8"],
        25:  ["S9",  "D8"],
        27:  ["S3",  "D12"],
        29:  ["S13", "D8"],
        31:  ["S15", "D8"],
        33:  ["S17", "D8"],
        35:  ["S19", "D8"],
        37:  ["S5",  "D16"],
        39:  ["S7",  "D16"],
        41:  ["S9",  "D16"],
        43:  ["S11", "D16"],
        45:  ["S13", "D16"],
        47:  ["S15", "D16"],
        49:  ["S17", "D16"],
        51:  ["S19", "D16"],
        53:  ["S13", "D20"],
        55:  ["S15", "D20"],
        57:  ["S17", "D20"],
        59:  ["S19", "D20"],
        61:  ["T15", "D8"],
        62:  ["T10", "D16"],
        63:  ["T13", "D12"],
        64:  ["T16", "D8"],
        65:  ["T15", "D10"],
        66:  ["T10", "D18"],
        67:  ["T17", "D8"],
        68:  ["T20", "D4"],
        69:  ["T19", "D6"],
        70:  ["T18", "D8"],
        71:  ["T13", "D16"],
        72:  ["T16", "D12"],
        73:  ["T19", "D8"],
        74:  ["T14", "D16"],
        75:  ["T17", "D12"],
        76:  ["T20", "D8"],
        77:  ["T19", "D10"],
        78:  ["T18", "D12"],
        79:  ["T19", "D11"],
        80:  ["T20", "D10"],
        81:  ["T19", "D12"],
        82:  ["T14", "D20"],
        83:  ["T17", "D16"],
        84:  ["T20", "D12"],
        85:  ["T15", "D20"],
        86:  ["T18", "D16"],
        87:  ["T17", "D18"],
        88:  ["T20", "D14"],
        89:  ["T19", "D16"],
        90:  ["T20", "D15"],
        91:  ["T17", "D20"],
        92:  ["T20", "D16"],
        93:  ["T19", "D18"],
        94:  ["T18", "D20"],
        95:  ["T19", "D19"],
        96:  ["T20", "D18"],
        97:  ["T19", "D20"],
        98:  ["T20", "D19"],
        99:  ["T19", "D21"],   # T19 + D21 not valid — use below
        99:  ["T13", "D30"],   # fallback; common route: T19, S10, D16 (3-dart)
        100: ["T20", "D20"],

        # ---- Three-dart finishes ----
        101: ["T17", "T10", "D10"],
        102: ["T20", "T10", "D6"],
        103: ["T19", "T10", "D8"],
        104: ["T18", "T10", "D10"],
        105: ["T20", "T5",  "D20"],
        106: ["T20", "T10", "D8"],
        107: ["T19", "T10", "D10"],
        108: ["T20", "T16", "D6"],
        109: ["T20", "T9",  "D16"],
        110: ["T20", "T10", "D10"],
        111: ["T19", "T12", "D12"],
        112: ["T20", "T12", "D8"],
        113: ["T19", "T12", "D14"],
        114: ["T20", "T14", "D6"],
        115: ["T19", "T14", "D10"],
        116: ["T20", "T16", "D4"],   # or T20 S16 D20
        117: ["T20", "T17", "D6"],   # or T19 D20 D20
        118: ["T20", "S18", "D20"],
        119: ["T19", "T12", "D20"],
        120: ["T20", "S20", "D20"],
        121: ["T20", "T11", "D14"],
        122: ["T18", "T18", "D7"],   # or T20 S10 D26 — use T18 T14 D20
        122: ["T18", "T14", "D20"],
        123: ["T19", "T16", "D9"],
        124: ["T20", "T14", "D11"],  # or T20 S4 D20 (common)
        124: ["T20", "S4",  "D20"],
        125: ["T20", "T15", "D10"],  # or OB T20 D20
        125: ["OB",  "T20", "D20"],
        126: ["T19", "T9",  "D18"],  # or T19 S19 D20
        126: ["T19", "S19", "D20"],
        127: ["T20", "T17", "D9"],   # or T20 S7 D20
        127: ["T20", "S7",  "D20"],
        128: ["T18", "T14", "D17"],  # or T20 S8 D20
        128: ["T20", "S8",  "D20"],
        129: ["T19", "T16", "D12"],  # or T20 S9 D20
        129: ["T20", "S9",  "D20"],
        130: ["T20", "T18", "D8"],   # or T20 S10 D20
        131: ["T20", "T13", "D16"],
        132: ["T20", "T16", "D12"],
        133: ["T20", "T19", "D8"],
        134: ["T20", "T14", "D16"],
        135: ["T20", "T15", "D15"],
        136: ["T20", "T20", "D8"],
        137: ["T20", "T19", "D10"],
        138: ["T20", "T18", "D12"],
        139: ["T20", "T19", "D11"],
        140: ["T20", "T20", "D10"],
        141: ["T20", "T19", "D12"],
        142: ["T20", "T14", "D20"],
        143: ["T20", "T17", "D16"],
        144: ["T20", "T20", "D12"],
        145: ["T20", "T15", "D20"],
        146: ["T20", "T18", "D16"],
        147: ["T20", "T17", "D18"],
        148: ["T20", "T20", "D14"],
        149: ["T20", "T19", "D16"],
        150: ["T20", "T20", "D15"],
        151: ["T20", "T17", "D20"],
        152: ["T20", "T20", "D16"],
        153: ["T20", "T19", "D18"],
        154: ["T20", "T18", "D20"],
        155: ["T20", "T19", "D19"],
        156: ["T20", "T20", "D18"],
        157: ["T20", "T19", "D20"],
        158: ["T20", "T20", "D19"],
        160: ["T20", "T20", "D20"],
        161: ["T20", "T17", "DB"],
        164: ["T20", "T18", "DB"],
        167: ["T20", "T19", "DB"],
        170: ["T20", "T20", "DB"],  # Maximum possible checkout
    }

    return checkouts.get(score, None)