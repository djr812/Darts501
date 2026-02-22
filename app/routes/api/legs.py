"""
app/routes/api/legs.py
-----------------------
REST endpoints for leg management.

Endpoints:
    POST /api/legs       -- Start a new leg within a match
    GET  /api/legs/<id>  -- Get a leg record
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

legs_bp = Blueprint("legs", __name__)


@legs_bp.route("/legs", methods=["POST"])
def create_leg():
    """
    Start a new leg within a match.

    Payload:
    {
        "match_id":       1,
        "starting_score": 501   (optional, defaults to 501)
    }
    """
    data = request.get_json(silent=True)

    if not data or "match_id" not in data:
        return jsonify({"error": "match_id is required"}), 400

    match_id       = data["match_id"]
    starting_score = data.get("starting_score", 501)

    db = get_db()
    cursor = db.cursor()

    # Verify match exists
    cursor.execute("SELECT id FROM matches WHERE id = %s", (match_id,))
    if not cursor.fetchone():
        return jsonify({"error": f"Match {match_id} not found"}), 404

    # Determine next leg number for this match
    cursor.execute(
        "SELECT COUNT(*) AS cnt FROM legs WHERE match_id = %s",
        (match_id,)
    )
    leg_number = cursor.fetchone()["cnt"] + 1

    cursor.execute(
        """
        INSERT INTO legs (match_id, leg_number, starting_score)
        VALUES (%s, %s, %s)
        """,
        (match_id, leg_number, starting_score)
    )
    db.commit()
    leg_id = cursor.lastrowid

    return jsonify({
        "id":             leg_id,
        "match_id":       match_id,
        "leg_number":     leg_number,
        "starting_score": starting_score,
        "status":         "active",
    }), 201


@legs_bp.route("/legs/<int:leg_id>", methods=["GET"])
def get_leg(leg_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM legs WHERE id = %s", (leg_id,))
    leg = cursor.fetchone()
    if not leg:
        return jsonify({"error": "Leg not found"}), 404
    return jsonify(leg), 200