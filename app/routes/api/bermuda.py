"""
app/routes/api/bermuda.py
--------------------------
REST endpoints for the Bermuda Triangle darts game.

Round sequence (1-13):
  1=12, 2=13, 3=14, 4=any_double, 5=15, 6=16, 7=17,
  8=any_triple, 9=18, 10=19, 11=20, 12=single_bull, 13=double_bull

POST /api/bermuda/matches                  — create match
GET  /api/bermuda/matches/<match_id>       — get state
POST /api/bermuda/matches/<match_id>/throw — submit batch of up to 3 throws
POST /api/bermuda/matches/<match_id>/next  — end turn, apply score/halve, advance
POST /api/bermuda/matches/<match_id>/end   — abandon
"""

import random
from flask import Blueprint, request, jsonify
from app.models.db import get_db

bermuda_bp = Blueprint("bermuda", __name__)

# Round index (1-based) -> target descriptor
ROUNDS = {
    1:  {"type": "number", "value": 12},
    2:  {"type": "number", "value": 13},
    3:  {"type": "number", "value": 14},
    4:  {"type": "special", "value": "any_double"},
    5:  {"type": "number", "value": 15},
    6:  {"type": "number", "value": 16},
    7:  {"type": "number", "value": 17},
    8:  {"type": "special", "value": "any_triple"},
    9:  {"type": "number", "value": 18},
    10: {"type": "number", "value": 19},
    11: {"type": "number", "value": 20},
    12: {"type": "special", "value": "single_bull"},
    13: {"type": "special", "value": "double_bull"},
}
TOTAL_ROUNDS = 13


def _score_dart(segment, multiplier, round_number):
    """
    Return points scored by a single dart for the given round.
    Returns 0 if the dart does not hit the target for this round.

    Rules:
      Number rounds (12-20): only exact number counts; score = segment * multiplier
      Any Double round:  any double scores segment * 2; singles/trebles = 0
      Any Triple round:  any triple scores segment * 3; singles/doubles = 0
      Single Bull round: outer bull (segment=25, multiplier=1) scores 25; else 0
      Double Bull round: inner bull (segment=25, multiplier=2) scores 50; else 0
    """
    r = ROUNDS[round_number]

    if r["type"] == "number":
        if segment == r["value"]:
            return segment * multiplier
        return 0

    if r["value"] == "any_double":
        if multiplier == 2 and segment != 25:
            return segment * 2
        return 0

    if r["value"] == "any_triple":
        if multiplier == 3:
            return segment * 3
        return 0

    if r["value"] == "single_bull":
        if segment == 25 and multiplier == 1:
            return 25
        return 0

    if r["value"] == "double_bull":
        if segment == 25 and multiplier == 2:
            return 50
        return 0

    return 0


def _get_state(db, match_id):
    cursor = db.cursor()

    cursor.execute("SELECT * FROM bermuda_games WHERE match_id = %s", (match_id,))
    game = cursor.fetchone()
    if not game:
        return None

    game_id = game["id"]

    cursor.execute(
        """SELECT bp.*, p.name
           FROM bermuda_players bp
           JOIN players p ON p.id = bp.player_id
           WHERE bp.game_id = %s
           ORDER BY bp.turn_order ASC""",
        (game_id,)
    )
    rows = cursor.fetchall()

    players_out = []
    for r in rows:
        players_out.append({
            "id":         r["player_id"],
            "name":       r["name"],
            "turn_order": r["turn_order"],
            "score":      r["score"],
        })

    current = players_out[game["current_player_index"]] if players_out else None

    round_num  = game["current_round"]
    round_info = ROUNDS.get(round_num, {})

    return {
        "match_id":             match_id,
        "game_id":              game_id,
        "current_player_index": game["current_player_index"],
        "current_player_id":    current["id"] if current else None,
        "current_round":        round_num,
        "round_info":           round_info,
        "total_rounds":         TOTAL_ROUNDS,
        "status":               game["status"],
        "winner_id":            game["winner_id"],
        "players":              players_out,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@bermuda_bp.route("/bermuda/matches", methods=["POST"])
def create_bermuda_match():
    data = request.get_json(silent=True)
    if not data or not data.get("player_ids"):
        return jsonify({"error": "player_ids required"}), 400

    player_ids = data["player_ids"]
    if not (2 <= len(player_ids) <= 4):
        return jsonify({"error": "2–4 players required"}), 400

    order = list(range(len(player_ids)))
    random.shuffle(order)

    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        "INSERT INTO matches (game_type, status) VALUES ('bermuda', 'active')"
    )
    match_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO bermuda_games (match_id) VALUES (%s)", (match_id,)
    )
    game_id = cursor.lastrowid

    for idx, pos in enumerate(order):
        pid = player_ids[pos]
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s,%s,%s)",
            (match_id, pid, idx)
        )
        cursor.execute(
            "INSERT INTO bermuda_players (game_id, match_id, player_id, turn_order) "
            "VALUES (%s,%s,%s,%s)",
            (game_id, match_id, pid, idx)
        )

    db.commit()
    return jsonify(_get_state(db, match_id)), 201


@bermuda_bp.route("/bermuda/matches/<int:match_id>", methods=["GET"])
def get_bermuda_match(match_id):
    db = get_db()
    state = _get_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@bermuda_bp.route("/bermuda/matches/<int:match_id>/throw", methods=["POST"])
def bermuda_throw(match_id):
    """
    Record up to 3 dart throws for the current player's turn (read-only scoring preview).
    Payload: { "throws": [{"segment":12,"multiplier":1}, ...], "round_number": 3 }
    Returns state + per-dart points for UI preview. Does NOT update scores yet.
    """
    data = request.get_json(silent=True)
    if not data or not data.get("throws"):
        return jsonify({"error": "throws required"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM bermuda_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not active"}), 400

    game_id      = game["id"]
    round_number = game["current_round"]

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    current_pid = player_rows[game["current_player_index"]]["player_id"]

    dart_results = []
    for dart_num, t in enumerate(data["throws"], start=1):
        seg = int(t.get("segment", 0))
        mul = int(t.get("multiplier", 1))
        pts = _score_dart(seg, mul, round_number)

        cursor.execute(
            "INSERT INTO bermuda_throws "
            "(game_id, match_id, player_id, round_number, dart_number, segment, multiplier, points) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (game_id, match_id, current_pid, round_number, dart_num, seg, mul, pts)
        )
        dart_results.append({"segment": seg, "multiplier": mul, "points": pts})

    db.commit()
    state = _get_state(db, match_id)
    state["dart_results"] = dart_results
    return jsonify(state), 200


@bermuda_bp.route("/bermuda/matches/<int:match_id>/next", methods=["POST"])
def bermuda_next(match_id):
    """
    Finalise the current player's turn:
      - Sum points from throws already stored for this player/round
      - If total == 0: halve the player's score (floor, min 0)
      - Else: add points to score
      - Record bermuda_turns summary row
      - Advance player; if all players done this round, advance round
      - If round was 13 and all players done: declare winner (highest score)
    Payload: {} (empty — all data already in DB from /throw calls)
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM bermuda_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        state = _get_state(db, match_id)
        return jsonify(state), 200

    game_id      = game["id"]
    round_number = game["current_round"]
    events       = []

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    num_players  = len(player_rows)
    current_idx  = game["current_player_index"]
    current_pid  = player_rows[current_idx]["player_id"]

    # Sum throws for this player/round
    cursor.execute(
        "SELECT COALESCE(SUM(points),0) AS total FROM bermuda_throws "
        "WHERE game_id=%s AND player_id=%s AND round_number=%s",
        (game_id, current_pid, round_number)
    )
    turn_points = int(cursor.fetchone()["total"])

    cursor.execute(
        "SELECT score FROM bermuda_players WHERE game_id=%s AND player_id=%s",
        (game_id, current_pid)
    )
    current_score = int(cursor.fetchone()["score"])

    was_halved = False
    if turn_points == 0:
        new_score  = max(0, current_score // 2)
        was_halved = True
        events.append({
            "type":      "halved",
            "player_id": current_pid,
            "new_score": new_score,
        })
    else:
        new_score = current_score + turn_points
        events.append({
            "type":        "scored",
            "player_id":   current_pid,
            "turn_points": turn_points,
            "new_score":   new_score,
        })

    cursor.execute(
        "UPDATE bermuda_players SET score=%s WHERE game_id=%s AND player_id=%s",
        (new_score, game_id, current_pid)
    )
    cursor.execute(
        "INSERT INTO bermuda_turns "
        "(game_id, match_id, player_id, round_number, points_scored, was_halved, score_after) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (game_id, match_id, current_pid, round_number,
         turn_points, int(was_halved), new_score)
    )

    # Determine next player / round
    next_idx        = (current_idx + 1) % num_players
    next_round      = round_number
    round_complete  = (next_idx == 0)  # wrapped back to first player

    if round_complete:
        next_round = round_number + 1

    # Check if game is over (all players completed round 13)
    if round_complete and round_number == TOTAL_ROUNDS:
        # Find winner — highest score; ties share the win
        cursor.execute(
            "SELECT player_id, score FROM bermuda_players WHERE game_id=%s ORDER BY score DESC",
            (game_id,)
        )
        scores      = cursor.fetchall()
        top_score   = scores[0]["score"]
        winners     = [r["player_id"] for r in scores if r["score"] == top_score]
        winner_id   = winners[0]  # store first; frontend handles ties

        cursor.execute(
            "UPDATE bermuda_games SET status='complete', winner_id=%s, "
            "current_round=%s, ended_at=NOW() WHERE id=%s",
            (winner_id, next_round, game_id)
        )
        cursor.execute("UPDATE matches SET status='complete' WHERE id=%s", (match_id,))
        events.append({
            "type":      "game_over",
            "winners":   winners,
            "top_score": top_score,
        })
        db.commit()
        state = _get_state(db, match_id)
        state["events"] = events
        return jsonify(state), 200

    cursor.execute(
        "UPDATE bermuda_games SET current_player_index=%s, current_round=%s WHERE id=%s",
        (next_idx, next_round, game_id)
    )
    db.commit()

    state = _get_state(db, match_id)
    state["events"] = events
    return jsonify(state), 200


@bermuda_bp.route("/bermuda/matches/<int:match_id>/end", methods=["POST"])
def end_bermuda_match(match_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE bermuda_games SET status='cancelled', ended_at=NOW() WHERE match_id=%s",
        (match_id,)
    )
    cursor.execute("UPDATE matches SET status='cancelled' WHERE id=%s", (match_id,))
    db.commit()
    return jsonify({"match_id": match_id, "status": "cancelled"}), 200