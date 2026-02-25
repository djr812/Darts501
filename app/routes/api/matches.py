"""
app/routes/api/matches.py
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

matches_bp = Blueprint("matches", __name__)


@matches_bp.route("/matches", methods=["POST"])
def create_match():
    """
    Payload:
    {
        "player_ids":   [1, 2],
        "sets_to_win":  1,
        "legs_per_set": 1
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    player_ids   = data.get("player_ids", [])
    sets_to_win  = int(data.get("sets_to_win", 1))
    legs_per_set = int(data.get("legs_per_set", 1))

    if not player_ids or not isinstance(player_ids, list):
        return jsonify({"error": "player_ids must be a non-empty list"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        """
        INSERT INTO matches (game_type, legs_to_win, sets_to_win, legs_per_set)
        VALUES ('501', %s, %s, %s)
        """,
        (legs_per_set, sets_to_win, legs_per_set)
    )
    match_id = cursor.lastrowid

    for order, player_id in enumerate(player_ids):
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s, %s, %s)",
            (match_id, player_id, order)
        )

    db.commit()

    return jsonify({
        "id":           match_id,
        "sets_to_win":  sets_to_win,
        "legs_per_set": legs_per_set,
        "player_ids":   player_ids,
        "status":       "active",
    }), 201


@matches_bp.route("/matches/<int:match_id>", methods=["GET"])
def get_match(match_id):
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404

    cursor.execute(
        """
        SELECT p.id, p.name, mp.turn_order, mp.legs_won, mp.sets_won
        FROM match_players mp
        JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = %s
        ORDER BY mp.turn_order ASC
        """,
        (match_id,)
    )
    match["players"] = cursor.fetchall()
    return jsonify(match), 200


@matches_bp.route("/matches/<int:match_id>/checkout", methods=["POST"])
def record_leg_checkout(match_id):
    """
    Record that a player has won a leg. Updates set/match tallies.
    Creates the next leg automatically if the match continues.

    Payload:  { "player_id": <int>, "leg_id": <int> }

    Response:
    {
        "leg_winner_id":   <int>,
        "set_complete":    <bool>,
        "set_winner_id":   <int|null>,
        "match_complete":  <bool>,
        "match_winner_id": <int|null>,
        "next_leg_id":     <int|null>,
        "sets_score":      { "<player_id>": <sets_won>, ... },
        "legs_score":      { "<player_id>": <legs_won_this_set>, ... }
    }
    """
    data = request.get_json(silent=True)
    if not data or "player_id" not in data or "leg_id" not in data:
        return jsonify({"error": "player_id and leg_id are required"}), 400

    winner_id = data["player_id"]
    leg_id    = data["leg_id"]

    db = get_db()
    cursor = db.cursor()

    # Load match config
    cursor.execute(
        "SELECT id, sets_to_win, legs_per_set, game_type, status FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404
    if match["status"] != "active":
        return jsonify({"error": "Match is not active"}), 400

    # Close the leg
    cursor.execute(
        "UPDATE legs SET status = 'complete', winner_id = %s, ended_at = NOW() WHERE id = %s",
        (winner_id, leg_id)
    )

    # Increment winner's leg count for this set
    cursor.execute(
        "UPDATE match_players SET legs_won = legs_won + 1 WHERE match_id = %s AND player_id = %s",
        (match_id, winner_id)
    )

    # Reload all players' tallies
    cursor.execute(
        "SELECT player_id, legs_won, sets_won FROM match_players WHERE match_id = %s",
        (match_id,)
    )
    players = {r["player_id"]: r for r in cursor.fetchall()}

    # Legs required to win a set (majority: 1 of 1, 2 of 3, 3 of 5, 4 of 7)
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

        # Increment set count and reset leg counts for everyone
        cursor.execute(
            "UPDATE match_players SET sets_won = sets_won + 1, legs_won = 0 WHERE match_id = %s AND player_id = %s",
            (match_id, winner_id)
        )
        cursor.execute(
            "UPDATE match_players SET legs_won = 0 WHERE match_id = %s AND player_id != %s",
            (match_id, winner_id)
        )

        # Reload after reset
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

    # Start next leg if match continues
    if not match_complete:
        cursor.execute(
            "SELECT COUNT(*) AS cnt FROM legs WHERE match_id = %s", (match_id,)
        )
        leg_number = cursor.fetchone()["cnt"] + 1

        cursor.execute(
            "SELECT double_out, game_type FROM legs WHERE match_id = %s ORDER BY id DESC LIMIT 1",
            (match_id,)
        )
        last_leg   = cursor.fetchone()
        double_out = bool(last_leg["double_out"]) if last_leg else True
        game_type  = last_leg["game_type"] if last_leg else "501"

        starting_scores = {"501": 501, "201": 201}
        starting_score  = starting_scores.get(game_type, 501)

        cursor.execute(
            """
            INSERT INTO legs (match_id, game_type, leg_number, starting_score, double_out)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (match_id, game_type, leg_number, starting_score, double_out)
        )
        db.commit()
        next_leg_id = cursor.lastrowid

    sets_score = {str(pid): p["sets_won"] for pid, p in players.items()}
    legs_score = {str(pid): p["legs_won"] for pid, p in players.items()}

    return jsonify({
        "leg_winner_id":   winner_id,
        "set_complete":    set_complete,
        "set_winner_id":   set_winner_id,
        "match_complete":  match_complete,
        "match_winner_id": match_winner_id,
        "next_leg_id":     next_leg_id,
        "sets_score":      sets_score,
        "legs_score":      legs_score,
    }), 200


@matches_bp.route("/matches/<int:match_id>/cancel", methods=["POST"])
def cancel_match(match_id):
    """
    Cancel an active match.

    Marks the match status = 'cancelled' and cancels any active legs.
    All recorded throws/turns/legs are preserved in the database — they
    are simply excluded from stats queries which filter on status = 'complete'.

    Response: { "match_id": <int>, "status": "cancelled" }
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id, status FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404
    if match["status"] not in ("active",):
        return jsonify({"error": f"Match is already {match['status']}"}), 400

    # Cancel any legs that are still active
    cursor.execute(
        "UPDATE legs SET status = 'cancelled' WHERE match_id = %s AND status = 'active'",
        (match_id,)
    )

    # Cancel the match itself
    cursor.execute(
        "UPDATE matches SET status = 'cancelled', ended_at = NOW() WHERE id = %s",
        (match_id,)
    )

    db.commit()
    return jsonify({"match_id": match_id, "status": "cancelled"}), 200


@matches_bp.route("/matches/<int:match_id>/restart", methods=["POST"])
def restart_match(match_id):
    """
    Restart an active match from scratch.

    Deletes all throws, turns, and legs for this match, resets player
    tallies to zero, and creates a fresh first leg.

    This is a hard reset — all scoring history for this match is wiped.
    Stats are unaffected since no legs were status='complete' after the reset.

    Response:
    {
        "match_id":    <int>,
        "new_leg_id":  <int>,
        "player_ids":  [<int>, ...]
    }
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, status, game_type, sets_to_win, legs_per_set FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404
    if match["status"] not in ("active", "cancelled"):
        return jsonify({"error": "Cannot restart a completed match"}), 400

    # Load leg config from the first leg so we can recreate it
    cursor.execute(
        "SELECT double_out FROM legs WHERE match_id = %s ORDER BY id ASC LIMIT 1",
        (match_id,)
    )
    first_leg = cursor.fetchone()
    double_out = bool(first_leg["double_out"]) if first_leg else True

    # Get player list in turn order
    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id = %s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_ids = [r["player_id"] for r in cursor.fetchall()]

    # --- Wipe all existing leg data ---
    # Get all leg IDs for this match
    cursor.execute("SELECT id FROM legs WHERE match_id = %s", (match_id,))
    leg_ids = [r["id"] for r in cursor.fetchall()]

    if leg_ids:
        # Delete throws for all turns in those legs
        placeholders = ",".join(["%s"] * len(leg_ids))
        cursor.execute(
            f"DELETE th FROM throws th JOIN turns t ON t.id = th.turn_id WHERE t.leg_id IN ({placeholders})",
            leg_ids
        )
        # Delete turns
        cursor.execute(f"DELETE FROM turns WHERE leg_id IN ({placeholders})", leg_ids)
        # Delete legs
        cursor.execute(f"DELETE FROM legs WHERE id IN ({placeholders})", leg_ids)

    # Reset match_players tallies
    cursor.execute(
        "UPDATE match_players SET legs_won = 0, sets_won = 0 WHERE match_id = %s",
        (match_id,)
    )

    # Reactivate the match
    cursor.execute(
        "UPDATE matches SET status = 'active', winner_id = NULL, ended_at = NULL WHERE id = %s",
        (match_id,)
    )

    # Create a fresh first leg
    starting_scores = {"501": 501, "201": 201}
    starting_score  = starting_scores.get(match["game_type"], 501)

    cursor.execute(
        """
        INSERT INTO legs (match_id, game_type, leg_number, starting_score, double_out)
        VALUES (%s, %s, 1, %s, %s)
        """,
        (match_id, match["game_type"], starting_score, double_out)
    )
    new_leg_id = cursor.lastrowid
    db.commit()

    return jsonify({
        "match_id":   match_id,
        "new_leg_id": new_leg_id,
        "player_ids": player_ids,
        "status":     "active",
    }), 200


# ---------------------------------------------------------------------------
# Practice session endpoints
# ---------------------------------------------------------------------------

@matches_bp.route("/practice", methods=["POST"])
def start_practice_session():
    """
    Create a practice session — a match with session_type='practice',
    a single open leg, and an initial open turn ready for throws.

    Payload: { "player_id": 1 }

    Returns: { "match_id", "leg_id", "turn_id" }
    """
    data = request.get_json(silent=True)
    if not data or "player_id" not in data:
        return jsonify({"error": "player_id is required"}), 400

    player_id = int(data["player_id"])

    db = get_db()
    cursor = db.cursor()

    # Verify player exists
    cursor.execute("SELECT id FROM players WHERE id = %s", (player_id,))
    if not cursor.fetchone():
        return jsonify({"error": f"Player {player_id} not found"}), 404

    # Create practice match record
    cursor.execute(
        """
        INSERT INTO matches (game_type, legs_to_win, sets_to_win, legs_per_set, session_type)
        VALUES ('practice', 1, 1, 1, 'practice')
        """
    )
    match_id = cursor.lastrowid

    # Link player to match
    cursor.execute(
        "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s, %s, 0)",
        (match_id, player_id)
    )

    # Create a single open leg (score 0 — no win condition for practice)
    cursor.execute(
        """
        INSERT INTO legs (match_id, game_type, leg_number, starting_score, double_out)
        VALUES (%s, 'practice', 1, 0, 0)
        """,
        (match_id,)
    )
    leg_id = cursor.lastrowid

    # Open the first turn
    cursor.execute(
        """
        INSERT INTO turns (leg_id, player_id, turn_number, score_before)
        VALUES (%s, %s, 1, 0)
        """,
        (leg_id, player_id)
    )
    turn_id = cursor.lastrowid

    db.commit()

    return jsonify({
        "match_id": match_id,
        "leg_id":   leg_id,
        "turn_id":  turn_id,
    }), 201


@matches_bp.route("/practice/<int:match_id>/end", methods=["POST"])
def end_practice_session(match_id):
    """
    Close out a practice session — marks the match and its leg as complete.
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id FROM matches WHERE id = %s AND session_type = 'practice'",
        (match_id,)
    )
    if not cursor.fetchone():
        return jsonify({"error": "Practice session not found"}), 404

    cursor.execute(
        "UPDATE matches SET status = 'complete' WHERE id = %s",
        (match_id,)
    )
    cursor.execute(
        "UPDATE legs SET status = 'complete' WHERE match_id = %s",
        (match_id,)
    )
    cursor.execute(
        "UPDATE turns SET score_after = score_before WHERE id = %s AND score_after IS NULL",
        (match_id,)  # close any open turn
    )
    db.commit()

    return jsonify({"status": "complete", "match_id": match_id}), 200