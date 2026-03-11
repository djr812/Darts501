"""
app/routes/api/race1000.py
---------------------------
REST endpoints for the Race to 1000 darts game.

POST /api/race1000/matches                  — create match
GET  /api/race1000/matches/<match_id>       — get state
POST /api/race1000/matches/<match_id>/throw — submit batch of up to 3 throws
POST /api/race1000/matches/<match_id>/next  — end turn, apply score, check win
POST /api/race1000/matches/<match_id>/end   — abandon
"""

import random
from flask import Blueprint, request, jsonify
from app.models.db import get_db

race1000_bp = Blueprint("race1000", __name__)

WIN_TARGET = 1000


def _score_dart(segment, multiplier, variant):
    """
    Return points for a single dart.
    variant='twenties': only segment 20 scores (any multiplier).
    variant='all':      any segment scores (segment * multiplier).
    Segment 0 = miss = 0 always.
    """
    if segment == 0:
        return 0
    if variant == 'twenties':
        return (segment * multiplier) if segment == 20 else 0
    return segment * multiplier


def _get_state(db, match_id):
    cursor = db.cursor()

    cursor.execute("SELECT * FROM race1000_games WHERE match_id = %s", (match_id,))
    game = cursor.fetchone()
    if not game:
        return None

    game_id = game["id"]

    cursor.execute(
        """SELECT rp.*, p.name
           FROM race1000_players rp
           JOIN players p ON p.id = rp.player_id
           WHERE rp.game_id = %s
           ORDER BY rp.turn_order ASC""",
        (game_id,)
    )
    rows = cursor.fetchall()

    players_out = [
        {
            "id":         r["player_id"],
            "name":       r["name"],
            "turn_order": r["turn_order"],
            "score":      r["score"],
        }
        for r in rows
    ]

    current = players_out[game["current_player_index"]] if players_out else None

    return {
        "match_id":             match_id,
        "game_id":              game_id,
        "variant":              game["variant"],
        "current_player_index": game["current_player_index"],
        "current_player_id":    current["id"] if current else None,
        "status":               game["status"],
        "winner_id":            game["winner_id"],
        "players":              players_out,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@race1000_bp.route("/race1000/matches", methods=["POST"])
def create_race1000_match():
    data = request.get_json(silent=True)
    if not data or not data.get("player_ids"):
        return jsonify({"error": "player_ids required"}), 400

    player_ids = data["player_ids"]
    if not (2 <= len(player_ids) <= 4):
        return jsonify({"error": "2–4 players required"}), 400

    variant = data.get("variant", "twenties")
    if variant not in ("twenties", "all"):
        variant = "twenties"

    order = list(range(len(player_ids)))
    random.shuffle(order)

    db = get_db()
    cursor = db.cursor()

    cpu_difficulty = data.get("cpu_difficulty")  # 'easy'|'medium'|'hard' or None
    if cpu_difficulty not in ("easy", "medium", "hard"):
        cpu_difficulty = None

    cursor.execute(
        "INSERT INTO matches (game_type, cpu_difficulty, status) VALUES ('race1000', %s, 'active')",
        (cpu_difficulty,)
    )
    match_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO race1000_games (match_id, variant) VALUES (%s, %s)",
        (match_id, variant)
    )
    game_id = cursor.lastrowid

    for idx, pos in enumerate(order):
        pid = player_ids[pos]
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s,%s,%s)",
            (match_id, pid, idx)
        )
        cursor.execute(
            "INSERT INTO race1000_players (game_id, match_id, player_id, turn_order) "
            "VALUES (%s,%s,%s,%s)",
            (game_id, match_id, pid, idx)
        )

    db.commit()
    return jsonify(_get_state(db, match_id)), 201


@race1000_bp.route("/race1000/matches/<int:match_id>", methods=["GET"])
def get_race1000_match(match_id):
    db = get_db()
    state = _get_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@race1000_bp.route("/race1000/matches/<int:match_id>/throw", methods=["POST"])
def race1000_throw(match_id):
    """
    Store up to 3 dart throws for the current player.
    Payload: { "throws": [{"segment":20,"multiplier":3}, ...], "turn_number": 1 }
    Does NOT update scores — that happens in /next.
    """
    data = request.get_json(silent=True)
    if not data or not data.get("throws"):
        return jsonify({"error": "throws required"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM race1000_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not active"}), 400

    game_id  = game["id"]
    variant  = game["variant"]
    turn_num = int(data.get("turn_number", 1))

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
        pts = _score_dart(seg, mul, variant)
        cursor.execute(
            "INSERT INTO race1000_throws "
            "(game_id, match_id, player_id, turn_number, dart_number, segment, multiplier, points) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (game_id, match_id, current_pid, turn_num, dart_num, seg, mul, pts)
        )
        dart_results.append({"segment": seg, "multiplier": mul, "points": pts})

    db.commit()
    state = _get_state(db, match_id)
    state["dart_results"] = dart_results
    return jsonify(state), 200


@race1000_bp.route("/race1000/matches/<int:match_id>/next", methods=["POST"])
def race1000_next(match_id):
    """
    Finalise turn: sum throws, update score, check for win, advance player.
    Payload: { "turn_number": N }
    Win condition: first player to reach WIN_TARGET after completing all 3 darts.
    Tie-break: highest score wins; if still tied, the player who threw first wins
    (lower turn_order = earlier in the round, so lower index wins on tie).
    """
    data     = request.get_json(silent=True) or {}
    turn_num = int(data.get("turn_number", 1))

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM race1000_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        state = _get_state(db, match_id)
        return jsonify(state), 200

    game_id     = game["id"]
    events      = []

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows  = cursor.fetchall()
    num_players  = len(player_rows)
    current_idx  = game["current_player_index"]
    current_pid  = player_rows[current_idx]["player_id"]

    # Sum throws for this turn
    cursor.execute(
        "SELECT COALESCE(SUM(points),0) AS total FROM race1000_throws "
        "WHERE game_id=%s AND player_id=%s AND turn_number=%s",
        (game_id, current_pid, turn_num)
    )
    turn_points = int(cursor.fetchone()["total"])

    cursor.execute(
        "SELECT score FROM race1000_players WHERE game_id=%s AND player_id=%s",
        (game_id, current_pid)
    )
    old_score = int(cursor.fetchone()["score"])
    new_score = old_score + turn_points

    cursor.execute(
        "UPDATE race1000_players SET score=%s WHERE game_id=%s AND player_id=%s",
        (new_score, game_id, current_pid)
    )
    events.append({
        "type":        "scored",
        "player_id":   current_pid,
        "turn_points": turn_points,
        "new_score":   new_score,
    })

    # Check if this player has reached the target
    next_idx       = (current_idx + 1) % num_players
    is_winner      = new_score >= WIN_TARGET
    round_complete = (next_idx == 0)

    if round_complete:
        # All players have had equal turns — check if anyone has reached the target
        cursor.execute(
            "SELECT player_id, score FROM race1000_players "
            "WHERE game_id=%s AND score >= %s ORDER BY score DESC, turn_order ASC",
            (game_id, WIN_TARGET)
        )
        leaders = cursor.fetchall()
        if leaders:
            winner_pid = leaders[0]["player_id"]
            cursor.execute(
                "UPDATE race1000_games SET status='complete', winner_id=%s, ended_at=NOW() WHERE id=%s",
                (winner_pid, game_id)
            )
            cursor.execute("UPDATE matches SET status='complete' WHERE id=%s", (match_id,))
            events.append({"type": "winner", "player_id": winner_pid,
                           "new_score": leaders[0]["score"]})
            db.commit()
            state = _get_state(db, match_id)
            state["events"] = events
            return jsonify(state), 200

    elif is_winner:
        # Not last in round yet — flag that a target has been set so others know to beat it
        events.append({"type": "target_set", "player_id": current_pid, "score": new_score})

    # Advance to next player
    cursor.execute(
        "UPDATE race1000_games SET current_player_index=%s WHERE id=%s",
        (next_idx, game_id)
    )
    db.commit()

    state = _get_state(db, match_id)
    state["events"] = events
    return jsonify(state), 200


@race1000_bp.route("/race1000/matches/<int:match_id>/end", methods=["POST"])
def end_race1000_match(match_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE race1000_games SET status='cancelled', ended_at=NOW() WHERE match_id=%s",
        (match_id,)
    )
    cursor.execute("UPDATE matches SET status='cancelled' WHERE id=%s", (match_id,))
    db.commit()
    return jsonify({"match_id": match_id, "status": "cancelled"}), 200


@race1000_bp.route("/race1000/matches/<int:match_id>/restart", methods=["POST"])
def restart_race1000_match(match_id):
    """Reset all player scores to 0 and restart from player 0."""
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM race1000_games WHERE match_id = %s", (match_id,))
    row = cursor.fetchone()
    if not row:
        return jsonify({"error": "match not found"}), 404
    game_id = row["id"]

    cursor.execute("DELETE FROM race1000_throws WHERE game_id = %s", (game_id,))
    cursor.execute(
        "UPDATE race1000_players SET score = 0 WHERE game_id = %s",
        (game_id,)
    )
    cursor.execute(
        "UPDATE race1000_games "
        "SET current_player_index=0, status='active', winner_id=NULL, ended_at=NULL "
        "WHERE id = %s",
        (game_id,)
    )
    cursor.execute("UPDATE matches SET status='active' WHERE id = %s", (match_id,))

    db.commit()
    return jsonify(_get_state(db, match_id)), 200