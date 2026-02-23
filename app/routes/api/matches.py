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