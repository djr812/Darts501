"""
app/routes/api/throws.py
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
from app.models.db import get_db
from app.services.scoring_engine import process_throw, suggested_checkouts

throws_bp = Blueprint("throws", __name__)

_CHECKOUT_FILE = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "checkouts.json"
)
try:
    with open(os.path.abspath(_CHECKOUT_FILE)) as f:
        _CHECKOUTS = json.load(f)
except FileNotFoundError:
    _CHECKOUTS = {}


def _get_checkout_suggestion(score: int) -> list | None:
    return _CHECKOUTS.get(str(score))


def _record_leg_win(match_id: int, winner_id: int, leg_id: int) -> dict:
    """
    Update leg/set/match tallies for a leg win and create the next leg.
    Returns the same structure as POST /api/matches/<id>/checkout.
    Inlined here to avoid an internal HTTP call.
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, sets_to_win, legs_per_set, game_type, status FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()

    # Close the leg
    cursor.execute(
        "UPDATE legs SET status = 'complete', winner_id = %s, ended_at = NOW() WHERE id = %s",
        (winner_id, leg_id)
    )

    # Increment winner's leg tally
    cursor.execute(
        "UPDATE match_players SET legs_won = legs_won + 1 WHERE match_id = %s AND player_id = %s",
        (match_id, winner_id)
    )

    cursor.execute(
        "SELECT player_id, legs_won, sets_won FROM match_players WHERE match_id = %s",
        (match_id,)
    )
    players = {r["player_id"]: r for r in cursor.fetchall()}

    legs_per_set    = match["legs_per_set"]
    legs_to_win_set = (legs_per_set // 2) + 1
    sets_to_win     = match["sets_to_win"]

    winner_legs     = players[winner_id]["legs_won"]
    set_complete    = False
    set_winner_id   = None
    match_complete  = False
    match_winner_id = None
    next_leg_id     = None

    if winner_legs >= legs_to_win_set:
        set_complete  = True
        set_winner_id = winner_id

        cursor.execute(
            "UPDATE match_players SET sets_won = sets_won + 1, legs_won = 0 WHERE match_id = %s AND player_id = %s",
            (match_id, winner_id)
        )
        cursor.execute(
            "UPDATE match_players SET legs_won = 0 WHERE match_id = %s AND player_id != %s",
            (match_id, winner_id)
        )
        cursor.execute(
            "SELECT player_id, legs_won, sets_won FROM match_players WHERE match_id = %s",
            (match_id,)
        )
        players = {r["player_id"]: r for r in cursor.fetchall()}

        if players[winner_id]["sets_won"] >= sets_to_win:
            match_complete  = True
            match_winner_id = winner_id
            cursor.execute(
                "UPDATE matches SET status = 'complete', winner_id = %s, ended_at = NOW() WHERE id = %s",
                (winner_id, match_id)
            )

    db.commit()

    if not match_complete:
        cursor.execute("SELECT COUNT(*) AS cnt FROM legs WHERE match_id = %s", (match_id,))
        leg_number = cursor.fetchone()["cnt"] + 1

        cursor.execute(
            "SELECT double_out, game_type FROM legs WHERE match_id = %s ORDER BY id DESC LIMIT 1",
            (match_id,)
        )
        last_leg   = cursor.fetchone()
        double_out = bool(last_leg["double_out"]) if last_leg else True
        game_type  = last_leg["game_type"] if last_leg else "501"
        starting_score = {"501": 501, "201": 201}.get(game_type, 501)

        cursor.execute(
            """
            INSERT INTO legs (match_id, game_type, leg_number, starting_score, double_out)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (match_id, game_type, leg_number, starting_score, double_out)
        )
        db.commit()
        next_leg_id = cursor.lastrowid

    return {
        "set_complete":    set_complete,
        "set_winner_id":   set_winner_id,
        "match_complete":  match_complete,
        "match_winner_id": match_winner_id,
        "next_leg_id":     next_leg_id,
        "sets_score":      {str(pid): p["sets_won"] for pid, p in players.items()},
        "legs_score":      {str(pid): p["legs_won"] for pid, p in players.items()},
    }


@throws_bp.route("/throws", methods=["POST"])
def record_throw():
    data = request.get_json(silent=True)

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

    turn = get_active_turn(leg_id, player_id)

    db = get_db()
    cursor = db.cursor()

    # Load leg config including match_id
    cursor.execute(
        "SELECT id, starting_score, double_out, match_id FROM legs WHERE id = %s",
        (leg_id,)
    )
    leg = cursor.fetchone()
    if not leg:
        return jsonify({"error": f"Leg {leg_id} not found"}), 404

    double_out = bool(leg.get("double_out", True))
    match_id   = leg["match_id"]

    if turn is None:
        if "score_before" not in data:
            return jsonify({"error": "No active turn found. Provide 'score_before' to open a new turn."}), 400

        score_before = data["score_before"]
        if not isinstance(score_before, int) or score_before < 1:
            return jsonify({"error": "'score_before' must be an integer >= 1"}), 400

        turn_id = open_turn(leg_id, player_id, score_before)
        turn = get_turn_by_id(turn_id)

    dart_number  = turn["darts_thrown"] + 1
    score_before = turn["score_before"]

    existing_throws = get_throws_for_turn(turn["id"])
    if existing_throws:
        last = existing_throws[-1]
        score_before = last["score_after"] if not last["is_bust"] else turn["score_before"]

    state = {
        "score":       score_before,
        "dart_number": dart_number,
        "turn_darts":  existing_throws,
    }

    result = process_throw(state, segment, multiplier, double_out)

    if result.error:
        return jsonify({"error": result.error}), 400

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

    if result.turn_complete:
        final_score = result.score_after if not result.is_bust else turn["score_before"]
        close_turn(
            turn_id     = turn["id"],
            score_after = final_score,
            is_bust     = result.is_bust,
            is_checkout = result.is_checkout,
        )

    # Checkout suggestion
    checkout_suggestion = None
    if not result.is_checkout and not result.is_bust and result.turn_complete:
        checkout_suggestion = _get_checkout_suggestion(result.score_after)
    elif not result.turn_complete:
        checkout_suggestion = _get_checkout_suggestion(result.score_after)

    # If checkout, resolve leg/set/match tallies
    leg_result = None
    if result.is_checkout:
        leg_result = _record_leg_win(match_id, player_id, leg_id)

    response = {
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
    }

    if leg_result:
        response.update(leg_result)

    return jsonify(response), 200


@throws_bp.route("/turns/submit", methods=["POST"])
def submit_turn():
    """
    Submit a complete turn (1-3 darts) in a single request.

    Replaces the per-dart POST /api/throws flow for human players.
    Processes all darts through the scoring engine, writes one turn
    record + N throw records in a single transaction, and handles
    checkout/leg-win if the turn ended in a checkout.

    Body:
    {
        "leg_id":       int,
        "player_id":    int,
        "score_before": int,
        "darts": [
            { "segment": int, "multiplier": int },
            ...
        ]
    }

    Returns the same shape as the last per-dart response would have,
    plus leg_result if a checkout occurred.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    missing = [f for f in ("leg_id", "player_id", "score_before", "darts") if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    leg_id       = data["leg_id"]
    player_id    = data["player_id"]
    score_before = data["score_before"]
    darts        = data["darts"]

    if not isinstance(darts, list) or not (1 <= len(darts) <= 3):
        return jsonify({"error": "darts must be a list of 1-3 throws"}), 400

    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, starting_score, double_out, match_id FROM legs WHERE id = %s",
        (leg_id,)
    )
    leg = cursor.fetchone()
    if not leg:
        return jsonify({"error": f"Leg {leg_id} not found"}), 404

    double_out = bool(leg.get("double_out", True))
    match_id   = leg["match_id"]

    # Open turn
    turn_id = open_turn(leg_id, player_id, score_before)

    # Process each dart through the scoring engine
    running_score = score_before
    turn_score_before = score_before
    results = []
    final_is_bust = False
    final_is_checkout = False

    for i, dart in enumerate(darts):
        seg = dart["segment"]
        mul = dart["multiplier"]
        dart_number = i + 1

        state = {
            "score":       running_score,
            "dart_number": dart_number,
            "turn_darts":  results,
        }
        result = process_throw(state, seg, mul, double_out)

        if result.error:
            # Roll back the open turn on validation error
            cursor.execute("DELETE FROM turns WHERE id = %s", (turn_id,))
            db.commit()
            return jsonify({"error": result.error}), 400

        insert_throw(
            turn_id      = turn_id,
            dart_number  = dart_number,
            segment      = seg,
            multiplier   = mul,
            points       = result.points,
            score_before = running_score,
            score_after  = result.score_after,
            is_bust      = result.is_bust,
            is_checkout  = result.is_checkout,
        )
        increment_darts_thrown(turn_id)

        results.append({
            "segment":    seg,
            "multiplier": mul,
            "points":     result.points,
            "score_after": result.score_after,
            "is_bust":    result.is_bust,
            "is_checkout": result.is_checkout,
        })

        if result.is_bust:
            final_is_bust = True
            running_score = turn_score_before   # bust reverts score
            break
        elif result.is_checkout:
            final_is_checkout = True
            running_score = 0
            break
        else:
            running_score = result.score_after

        if result.turn_complete:
            break

    # Close the turn
    final_score_after = turn_score_before if final_is_bust else running_score
    close_turn(
        turn_id     = turn_id,
        score_after = final_score_after,
        is_bust     = final_is_bust,
        is_checkout = final_is_checkout,
    )

    # Checkout suggestion for the next turn
    checkout_suggestion = None
    if not final_is_checkout and not final_is_bust:
        checkout_suggestion = _get_checkout_suggestion(running_score)

    # Leg win resolution
    leg_result = None
    if final_is_checkout:
        leg_result = _record_leg_win(match_id, player_id, leg_id)

    response = {
        "turn_id":             turn_id,
        "score_before":        score_before,
        "score_after":         final_score_after,
        "is_bust":             final_is_bust,
        "is_checkout":         final_is_checkout,
        "turn_complete":       True,
        "darts":               results,
        "checkout_suggestion": checkout_suggestion,
    }
    if leg_result:
        response.update(leg_result)

    return jsonify(response), 200


@throws_bp.route("/throws/last", methods=["DELETE"])
def undo_last_throw():
    data = request.get_json(silent=True)

    if not data or "turn_id" not in data:
        return jsonify({"error": "Request body must include 'turn_id'"}), 400

    turn_id = data["turn_id"]
    if not isinstance(turn_id, int):
        return jsonify({"error": "'turn_id' must be an integer"}), 400

    turn = get_turn_by_id(turn_id)
    if not turn:
        return jsonify({"error": f"Turn {turn_id} not found"}), 404

    deleted = delete_last_throw(turn_id)
    if not deleted:
        return jsonify({"error": "No throws found for this turn — nothing to undo"}), 400

    decrement_darts_thrown(turn_id)
    score_reverted_to = deleted["score_before"]

    return jsonify({
        "deleted_throw":     deleted,
        "turn_id":           turn_id,
        "score_reverted_to": score_reverted_to,
    }), 200