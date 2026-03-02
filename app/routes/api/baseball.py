"""
app/routes/api/baseball.py
--------------------------
REST endpoints for Baseball Darts high score tracking.

Endpoints:
    GET  /api/baseball/highscore/<player_id>   -- Get player's best score
    POST /api/baseball/highscore/<player_id>   -- Submit a new score (saves if best)
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

baseball_bp = Blueprint("baseball", __name__)


@baseball_bp.route("/baseball/highscore/<int:player_id>", methods=["GET"])
def get_high_score(player_id):
    """
    Return the player's current Baseball Darts high score.

    Response: { player_id, score }   (score = 0 if no record exists)
    """
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT score FROM player_high_scores WHERE player_id = %s AND game_type = 'baseball'",
        (player_id,)
    )
    row = cursor.fetchone()
    return jsonify({
        "player_id": player_id,
        "score":     row["score"] if row else 0,
    }), 200


@baseball_bp.route("/baseball/highscore/<int:player_id>", methods=["POST"])
def submit_score(player_id):
    """
    Submit a completed Baseball Darts score for a player.

    Payload: { "score": 42 }

    Saves the score only if it beats the current high score.

    Response: { player_id, submitted_score, high_score, is_new_high }
    """
    data = request.get_json(silent=True)
    if not data or "score" not in data:
        return jsonify({"error": "score is required"}), 400

    submitted = int(data["score"])

    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT score FROM player_high_scores WHERE player_id = %s AND game_type = 'baseball'",
        (player_id,)
    )
    existing = cursor.fetchone()
    current_best = existing["score"] if existing else 0
    is_new_high  = submitted > current_best

    if is_new_high:
        if existing:
            cursor.execute(
                "UPDATE player_high_scores SET score = %s, achieved_at = NOW() "
                "WHERE player_id = %s AND game_type = 'baseball'",
                (submitted, player_id)
            )
        else:
            cursor.execute(
                "INSERT INTO player_high_scores (player_id, game_type, score) VALUES (%s, 'baseball', %s)",
                (player_id, submitted)
            )
        db.commit()

    return jsonify({
        "player_id":       player_id,
        "submitted_score": submitted,
        "high_score":      submitted if is_new_high else current_best,
        "is_new_high":     is_new_high,
    }), 200