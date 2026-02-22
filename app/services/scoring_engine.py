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

import json
import os

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
# Checkout table — loaded once at module import time
# ---------------------------------------------------------------------------

def _load_checkouts() -> dict:
    """
    Load checkout suggestions from checkouts.json.

    Searches for the file relative to this module's location so the path
    works regardless of where the application is launched from.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    # Module lives at app/services/scoring_engine.py
    # checkouts.json lives at app/data/checkouts.json
    path = os.path.join(base_dir, '..', 'data', 'checkouts.json')
    path = os.path.normpath(path)

    try:
        with open(path, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Non-fatal — suggestions will simply be unavailable
        import warnings
        warnings.warn(f"checkouts.json not found at {path}. Checkout suggestions disabled.")
        return {}


CHECKOUTS = _load_checkouts()


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
        return (False, f"Invalid segment: {segment}. Must be 0-20 or 25 (bull)")

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

def is_bust(
    score_before: int,
    points: int,
    segment: int,
    multiplier: int,
    double_out: bool = True,
) -> bool:
    """
    Determine whether a dart results in a bust.

    Bust conditions (double_out=True, standard rules):
        1. score_after < 0  -- went below zero
        2. score_after == 1 -- stranded; no double scores 1
        3. score_after == 0 -- reached zero but NOT on a double

    Bust conditions (double_out=False, single out):
        1. score_after < 0  -- went below zero only
           Any dart reaching exactly zero wins regardless of multiplier.
           Note: score_after == 1 is still reachable and NOT a bust in
           single-out mode (player can hit S1 next dart to win).

    Args:
        score_before -- player's score before this dart
        points       -- points scored by this dart
        segment      -- segment hit
        multiplier   -- multiplier of the dart
        double_out   -- True  = must finish on a double (standard 501/201)
                        False = any dart reaching zero wins (single out)

    Returns:
        True if the throw is a bust, False otherwise
    """
    score_after = score_before - points

    if score_after < 0:
        return True  # Overshot — always a bust regardless of mode

    if double_out:
        if score_after == 1:
            return True  # Stranded — no double scores 1

        if score_after == 0 and multiplier != 2:
            return True  # Must finish on a double

    return False


# ---------------------------------------------------------------------------
# Checkout detection
# ---------------------------------------------------------------------------

def is_checkout(
    score_before: int,
    segment: int,
    multiplier: int,
    double_out: bool = True,
) -> bool:
    """
    Determine whether a dart completes the leg (checkout).

    double_out=True  (standard): score_after must be 0 AND multiplier must be 2.
    double_out=False (single out): score_after must be 0, any multiplier valid.

    D-Bull (segment=25, multiplier=2) is always a valid checkout in both modes.

    Args:
        score_before -- player's score before this dart
        segment      -- segment hit
        multiplier   -- multiplier of the dart
        double_out   -- True  = double required to finish
                        False = any dart can finish

    Returns:
        True if this dart wins the leg, False otherwise
    """
    points = calculate_points(segment, multiplier)
    score_after = score_before - points

    if score_after != 0:
        return False

    if double_out:
        return multiplier == 2  # must be a double

    return True  # single-out: any dart reaching zero wins


# ---------------------------------------------------------------------------
# Primary interface
# ---------------------------------------------------------------------------

def process_throw(
    state: dict,
    segment: int,
    multiplier: int,
    double_out: bool = True,
) -> ThrowResult:
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
            'turn_darts' -- list of throw dicts thrown so far this turn
        segment    -- int, board segment hit (0-20 or 25)
        multiplier -- int, 1=single, 2=double, 3=treble
        double_out -- bool, True = must finish on a double (default, standard rules)
                            False = any dart reaching zero wins (single out)

    Returns:
        ThrowResult describing the full outcome of the dart
    """
    score_before = state['score']
    dart_number  = state['dart_number']

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
    is_checkout_flag = is_checkout(score_before, segment, multiplier, double_out)
    is_bust_flag     = False if is_checkout_flag else is_bust(
        score_before, points, segment, multiplier, double_out
    )

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

    return CHECKOUTS.get(str(score)) or None