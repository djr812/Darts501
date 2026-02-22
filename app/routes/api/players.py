"""
app/routes/api/players.py
--------------------------
REST endpoints for player management.

Endpoints:
    GET  /api/players          -- List all active players
    POST /api/players          -- Create a new player
    GET  /api/players/<id>     -- Get a single player
    PUT  /api/players/<id>     -- Update a player's name/nickname
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

players_bp = Blueprint("players", __name__)


def _get_player_by_id(player_id: int) -> dict | None:
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT id, name, nickname, created_at, is_active FROM players WHERE id = %s",
        (player_id,)
    )
    return cursor.fetchone()


@players_bp.route("/players", methods=["GET"])
def list_players():
    """
    Return all active players ordered by name.
    """
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT id, name, nickname FROM players WHERE is_active = TRUE ORDER BY name ASC"
    )
    players = cursor.fetchall()
    return jsonify(players), 200


@players_bp.route("/players", methods=["POST"])
def create_player():
    """
    Create a new player.

    Payload: { "name": "Dave", "nickname": "The Arrow" (optional) }
    """
    data = request.get_json(silent=True)

    if not data or not data.get("name", "").strip():
        return jsonify({"error": "Player name is required"}), 400

    name     = data["name"].strip()[:64]
    nickname = data.get("nickname", "").strip()[:32] or None

    db = get_db()
    cursor = db.cursor()

    # Check for duplicate name
    cursor.execute("SELECT id FROM players WHERE name = %s", (name,))
    if cursor.fetchone():
        return jsonify({"error": f"A player named '{name}' already exists"}), 409

    cursor.execute(
        "INSERT INTO players (name, nickname) VALUES (%s, %s)",
        (name, nickname)
    )
    db.commit()
    player_id = cursor.lastrowid

    return jsonify({
        "id":       player_id,
        "name":     name,
        "nickname": nickname,
    }), 201


@players_bp.route("/players/<int:player_id>", methods=["GET"])
def get_player(player_id):
    player = _get_player_by_id(player_id)
    if not player:
        return jsonify({"error": "Player not found"}), 404
    return jsonify(player), 200


@players_bp.route("/players/<int:player_id>", methods=["PUT"])
def update_player(player_id):
    """
    Update a player's name or nickname.

    Payload: { "name": "Dave", "nickname": "The Arrow" }
    """
    player = _get_player_by_id(player_id)
    if not player:
        return jsonify({"error": "Player not found"}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    name     = data.get("name", player["name"]).strip()[:64]
    nickname = data.get("nickname", player["nickname"] or "").strip()[:32] or None

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE players SET name = %s, nickname = %s WHERE id = %s",
        (name, nickname, player_id)
    )
    db.commit()

    return jsonify({"id": player_id, "name": name, "nickname": nickname}), 200