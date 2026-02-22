"""
app/routes/api/throws.py
------------------------
REST endpoints for recording and undoing dart throws.

Blueprint: throws_bp
Prefix:    /api  (applied at registration in app/__init__.py)

Endpoints:
    POST   /api/throws         -- Record a dart throw
    DELETE /api/throws/last    -- Undo the last dart in a turn

The route layer is intentionally thin:
    1. Parse and validate the incoming JSON payload
    2. Load current turn state from the DB
    3. Delegate all scoring logic to the scoring engine
    4. Persist the result via the model layer
    5. Return a JSON response

No game rules or arithmetic live in this file.
"""

import json
import os

from flask import Blueprint, request, jsonify

from app.models.turn import (
    get_active_turn,
    open_turn,
    increment_darts_thrown,
    close_turn,
    get_turn_by_id,
    decrement_darts_thrown,
)
from app.models.throw import insert_throw, get_throws_for_turn, delete_last_throw
from app.services.scoring_engine import process_throw, suggested_checkouts

throws_bp = Blueprint("throws", __name__)

# ---------------------------------------------------------------------------
# Checkout suggestion lookup — loaded once at import time
# ---------------------------------------------------------------------------

_CHECKOUT_FILE = os.path.join(
    os.path.dirname(__file__),   # app/routes/api/
    "..", "..", "..",            # project root
    "checkouts.json"
)

try:
    with open(os.path.abspath(_CHECKOUT_FILE)) as f:
        _CHECKOUTS = json.load(f)
except FileNotFoundError:
    # Non-fatal: suggestions will simply be unavailable
    _CHECKOUTS = {}


def _get_checkout_suggestion(score: int) -> list | None:
    """Return a checkout suggestion list for the given score, or None."""
    return _CHECKOUTS.get(str(score))


# ---------------------------------------------------------------------------
# POST /api/throws
# ---------------------------------------------------------------------------

@throws_bp.route("/throws", methods=["POST"])
def record_throw():
    """
    Record a single dart throw for the active turn.

    Expected JSON payload:
    {
        "leg_id":     <int>,   -- the active leg
        "player_id":  <int>,   -- the player throwing
        "segment":    <int>,   -- board segment (0–20 or 25)
        "multiplier": <int>    -- 1=single, 2=double, 3=treble
    }

    Response (200):
    {
        "throw_id":    <int>,
        "turn_id":     <int>,
        "dart_number": <int>,
        "points":      <int>,
        "score_before":<int>,
        "score_after": <int>,
        "is_bust":     <bool>,
        "is_checkout": <bool>,
        "turn_complete":<bool>,
        "checkout_suggestion": <list|null>  -- suggested route if applicable
    }

    Response (400):
    {
        "error": "<reason>"
    }
    """
    data = request.get_json(silent=True)

    # --- Payload validation ---
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    missing = [f for f in ("leg_id", "player_id", "segment", "multiplier") if f not in data]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    leg_id     = data["leg_id"]
    player_id  = data["player_id"]
    segment    = data["segment"]
    multiplier = data["multiplier"]

    if not all(isinstance(v, int) for v in (leg_id, player_id, segment, multiplier)):
        return jsonify({"error": "leg_id, player_id, segment, and multiplier must all be integers"}), 400

    # --- Load or create the active turn ---
    turn = get_active_turn(leg_id, player_id)

    if turn is None:
        # No open turn — this is the player's first dart of a new visit.
        # The caller must have set up the score via a prior turn or leg record.
        # We need the player's current score; expect it in the payload for new turns.
        if "score_before" not in data:
            return jsonify({
                "error": (
                    "No active turn found for this player. "
                    "Provide 'score_before' to open a new turn."
                )
            }), 400

        score_before = data["score_before"]
        if not isinstance(score_before, int) or score_before < 2:
            return jsonify({"error": "'score_before' must be an integer >= 2"}), 400

        turn_id = open_turn(leg_id, player_id, score_before)
        turn = get_turn_by_id(turn_id)

    # --- Build the state dict the scoring engine expects ---
    dart_number = turn["darts_thrown"] + 1   # next dart in this turn (1, 2, or 3)
    score_before = turn["score_before"]

    # Adjust score_before to reflect darts already thrown this turn
    # by reading the running score from the last throw in this turn
    existing_throws = get_throws_for_turn(turn["id"])
    if existing_throws:
        # score_after of the last throw is the current score entering this dart
        last = existing_throws[-1]
        score_before = last["score_after"] if not last["is_bust"] else turn["score_before"]

    state = {
        "score":       score_before,
        "dart_number": dart_number,
        "turn_darts":  existing_throws,
    }

    # --- Delegate to the scoring engine ---
    result = process_throw(state, segment, multiplier)

    if result.error:
        # Invalid throw (e.g. treble bull) — return 400, do not persist anything
        return jsonify({"error": result.error}), 400

    # --- Persist the throw ---
    throw_id = insert_throw(
        turn_id      = turn["id"],
        dart_number  = dart_number,
        segment      = segment,
        multiplier   = multiplier,
        points       = result.points,
        score_before = score_before,
        score_after  = result.score_after,
        is_bust      = result.is_bust,
        is_checkout  = result.is_checkout,
    )

    increment_darts_thrown(turn["id"])

    # --- Close the turn if it is complete ---
    if result.turn_complete:
        # On a bust the score reverts to what it was at the START of the turn
        final_score = result.score_after if not result.is_bust else turn["score_before"]
        close_turn(
            turn_id     = turn["id"],
            score_after = final_score,
            is_bust     = result.is_bust,
            is_checkout = result.is_checkout,
        )

    # --- Checkout suggestion for the player's next visit (if not finished) ---
    checkout_suggestion = None
    if not result.is_checkout and not result.is_bust and result.turn_complete:
        # Turn ended on dart 3 — suggest a route for the remaining score
        checkout_suggestion = _get_checkout_suggestion(result.score_after)
    elif not result.turn_complete:
        # Mid-turn — suggest a route for the score remaining after this dart
        checkout_suggestion = _get_checkout_suggestion(result.score_after)

    return jsonify({
        "throw_id":            throw_id,
        "turn_id":             turn["id"],
        "dart_number":         dart_number,
        "points":              result.points,
        "score_before":        score_before,
        "score_after":         result.score_after,
        "is_bust":             result.is_bust,
        "is_checkout":         result.is_checkout,
        "turn_complete":       result.turn_complete,
        "checkout_suggestion": checkout_suggestion,
    }), 200


# ---------------------------------------------------------------------------
# DELETE /api/throws/last
# ---------------------------------------------------------------------------

@throws_bp.route("/throws/last", methods=["DELETE"])
def undo_last_throw():
    """
    Undo the most recent dart in a turn.

    Expected JSON payload:
    {
        "turn_id": <int>
    }

    This deletes the throw record and re-opens the turn so the player
    can re-throw the dart. The UI is responsible for reflecting the
    reverted score.

    Response (200):
    {
        "deleted_throw": { ...throw fields... },
        "turn_id":        <int>,
        "score_reverted_to": <int>
    }

    Response (400/404):
    {
        "error": "<reason>"
    }
    """
    data = request.get_json(silent=True)

    if not data or "turn_id" not in data:
        return jsonify({"error": "Request body must include 'turn_id'"}), 400

    turn_id = data["turn_id"]

    if not isinstance(turn_id, int):
        return jsonify({"error": "'turn_id' must be an integer"}), 400

    # Verify the turn exists
    turn = get_turn_by_id(turn_id)
    if not turn:
        return jsonify({"error": f"Turn {turn_id} not found"}), 404

    # Delete the last throw and get back what was deleted
    deleted = delete_last_throw(turn_id)
    if not deleted:
        return jsonify({"error": "No throws found for this turn — nothing to undo"}), 400

    # Re-open the turn and wind back the dart counter
    decrement_darts_thrown(turn_id)

    # The score to display is the deleted throw's score_before
    score_reverted_to = deleted["score_before"]

    return jsonify({
        "deleted_throw":     deleted,
        "turn_id":           turn_id,
        "score_reverted_to": score_reverted_to,
    }), 200
