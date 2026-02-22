"""
app/routes/api/matches.py
--------------------------
REST endpoints for match management.

Endpoints:
    POST /api/matches       -- Start a new match
    GET  /api/matches/<id>  -- Get a match with its players
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

matches_bp = Blueprint("matches", __name__)


@matches_bp.route("/matches", methods=["POST"])
def create_match():
    """
    Start a new match.

    Payload:
    {
        "player_ids":  [1, 2],   -- ordered list of player IDs
        "legs_to_win": 1          -- first to win N legs wins the match
    }
    """
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    player_ids  = data.get("player_ids", [])
    legs_to_win = data.get("legs_to_win", 1)

    if not player_ids or not isinstance(player_ids, list):
        return jsonify({"error": "player_ids must be a non-empty list"}), 400

    db = get_db()
    cursor = db.cursor()

    # Create the match record
    cursor.execute(
        "INSERT INTO matches (game_type, legs_to_win) VALUES ('501', %s)",
        (legs_to_win,)
    )
    match_id = cursor.lastrowid

    # Link players to match in the order provided
    for order, player_id in enumerate(player_ids):
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s, %s, %s)",
            (match_id, player_id, order)
        )

    db.commit()

    return jsonify({
        "id":          match_id,
        "legs_to_win": legs_to_win,
        "player_ids":  player_ids,
        "status":      "active",
    }), 201


@matches_bp.route("/matches/<int:match_id>", methods=["GET"])
def get_match(match_id):
    """Return a match record with its associated players."""
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()

    if not match:
        return jsonify({"error": "Match not found"}), 404

    cursor.execute(
        """
        SELECT p.id, p.name, mp.turn_order, mp.legs_won
        FROM match_players mp
        JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = %s
        ORDER BY mp.turn_order ASC
        """,
        (match_id,)
    )
    match["players"] = cursor.fetchall()

    return jsonify(match), 200