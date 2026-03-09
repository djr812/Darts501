"""
app/routes/api/nine_lives.py
-----------------------------
REST endpoints for the Nine Lives darts game.

POST /api/nine_lives/matches                  — create match
GET  /api/nine_lives/matches/<match_id>       — get state
POST /api/nine_lives/matches/<match_id>/throw — submit batch of up to 3 throws
POST /api/nine_lives/matches/<match_id>/next  — advance to next player
POST /api/nine_lives/matches/<match_id>/end   — abandon
"""

import random
from flask import Blueprint, request, jsonify
from app.models.db import get_db

nine_lives_bp = Blueprint("nine_lives", __name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_state(db, match_id):
    cursor = db.cursor()

    cursor.execute("SELECT * FROM nine_lives_games WHERE match_id = %s", (match_id,))
    game = cursor.fetchone()
    if not game:
        return None

    game_id = game["id"]

    cursor.execute(
        """SELECT nlp.*, p.name
           FROM nine_lives_players nlp
           JOIN players p ON p.id = nlp.player_id
           WHERE nlp.game_id = %s
           ORDER BY nlp.turn_order ASC""",
        (game_id,)
    )
    rows = cursor.fetchall()

    players_out = []
    for r in rows:
        players_out.append({
            "id":          r["player_id"],
            "name":        r["name"],
            "turn_order":  r["turn_order"],
            "target":      r["target"],
            "lives":       r["lives"],
            "eliminated":  bool(r["eliminated"]),
            "completed":   bool(r["completed"]),
        })

    current = players_out[game["current_player_index"]] if players_out else None

    return {
        "match_id":             match_id,
        "game_id":              game_id,
        "current_player_index": game["current_player_index"],
        "current_player_id":    current["id"] if current else None,
        "status":               game["status"],
        "winner_id":            game["winner_id"],
        "players":              players_out,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@nine_lives_bp.route("/nine_lives/matches", methods=["POST"])
def create_nine_lives_match():
    """
    Payload: { "player_ids": [1, 2, ...] }   (2–4 players)
    """
    data = request.get_json(silent=True)
    if not data or not data.get("player_ids"):
        return jsonify({"error": "player_ids required"}), 400

    player_ids = data["player_ids"]
    if not (2 <= len(player_ids) <= 4):
        return jsonify({"error": "2–4 players required"}), 400

    # Random turn order
    order = list(range(len(player_ids)))
    random.shuffle(order)

    db = get_db()
    cursor = db.cursor()

    cpu_difficulty = data.get("cpu_difficulty")
    if cpu_difficulty not in ("easy", "medium", "hard"):
        cpu_difficulty = None

    cursor.execute(
        "INSERT INTO matches (game_type, cpu_difficulty, status) VALUES ('nine_lives', %s, 'active')",
        (cpu_difficulty,)
    )
    match_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO nine_lives_games (match_id) VALUES (%s)",
        (match_id,)
    )
    game_id = cursor.lastrowid

    for idx, pos in enumerate(order):
        pid = player_ids[pos]
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s,%s,%s)",
            (match_id, pid, idx)
        )
        cursor.execute(
            "INSERT INTO nine_lives_players "
            "(game_id, match_id, player_id, turn_order) VALUES (%s,%s,%s,%s)",
            (game_id, match_id, pid, idx)
        )

    db.commit()
    return jsonify(_get_state(db, match_id)), 201


@nine_lives_bp.route("/nine_lives/matches/<int:match_id>", methods=["GET"])
def get_nine_lives_match(match_id):
    db = get_db()
    state = _get_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@nine_lives_bp.route("/nine_lives/matches/<int:match_id>/throw", methods=["POST"])
def nine_lives_throw(match_id):
    """
    Submit a batch of up to 3 dart throws for the current turn.
    Payload: { "throws": [{"segment": 5, "multiplier": 1}, ...], "turn_number": 1 }

    Scoring logic applied here:
      - A dart is a hit if segment == player's current target (any multiplier).
      - On a hit the player advances their target by 1.
      - After all throws, if the player did NOT hit the target at turn start at least
        once during the turn they lose a life (assessed at turn end by /next).
      - If target reaches 21 the player has completed the sequence — instant win.
    """
    data = request.get_json(silent=True)
    if not data or not data.get("throws"):
        return jsonify({"error": "throws required"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM nine_lives_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not active"}), 400

    game_id  = game["id"]
    turn_num = int(data.get("turn_number", 1))

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    current_pid = player_rows[game["current_player_index"]]["player_id"]

    cursor.execute(
        "SELECT * FROM nine_lives_players WHERE game_id=%s AND player_id=%s",
        (game_id, current_pid)
    )
    nlp = cursor.fetchone()
    target      = nlp["target"]
    hit_this_turn = False
    events      = []

    for dart_num, t in enumerate(data["throws"], start=1):
        seg = int(t.get("segment", 0))
        mul = int(t.get("multiplier", 1))
        is_hit = (seg == target)

        cursor.execute(
            "INSERT INTO nine_lives_throws "
            "(game_id, match_id, player_id, turn_number, dart_number, segment, multiplier, is_hit) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (game_id, match_id, current_pid, turn_num, dart_num, seg, mul, int(is_hit))
        )

        if is_hit and not hit_this_turn:
            # Advance target on first hit
            hit_this_turn = True
            target += 1
            cursor.execute(
                "UPDATE nine_lives_players SET target=%s WHERE game_id=%s AND player_id=%s",
                (target, game_id, current_pid)
            )
            events.append({"type": "hit", "new_target": target})

            # Check instant win (completed all 20)
            if target > 20:
                cursor.execute(
                    "UPDATE nine_lives_players SET completed=1 WHERE game_id=%s AND player_id=%s",
                    (game_id, current_pid)
                )
                cursor.execute(
                    "UPDATE nine_lives_games SET status='complete', winner_id=%s, ended_at=NOW() "
                    "WHERE id=%s", (current_pid, game_id)
                )
                cursor.execute(
                    "UPDATE matches SET status='complete' WHERE id=%s", (match_id,)
                )
                events.append({"type": "winner", "player_id": current_pid})
                db.commit()
                state = _get_state(db, match_id)
                state["events"] = events
                state["hit_this_turn"] = True
                return jsonify(state), 200

    # If no hit this turn, life will be deducted in /next
    db.commit()
    state = _get_state(db, match_id)
    state["events"]        = events
    state["hit_this_turn"] = hit_this_turn
    return jsonify(state), 200


@nine_lives_bp.route("/nine_lives/matches/<int:match_id>/next", methods=["POST"])
def nine_lives_next(match_id):
    """
    Called after NEXT is pressed.
    Payload: { "hit_this_turn": true|false }
    - If no hit: deduct a life; if lives reach 0 mark eliminated.
    - Check if only one player remains; if so declare winner.
    - Advance to next non-eliminated player.
    """
    data = request.get_json(silent=True) or {}
    hit  = bool(data.get("hit_this_turn", False))

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM nine_lives_games WHERE match_id=%s", (match_id,))
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
    player_rows = cursor.fetchall()
    num_players = len(player_rows)
    current_idx = game["current_player_index"]
    current_pid = player_rows[current_idx]["player_id"]

    # Deduct life if missed
    if not hit:
        cursor.execute(
            "SELECT lives FROM nine_lives_players WHERE game_id=%s AND player_id=%s",
            (game_id, current_pid)
        )
        row       = cursor.fetchone()
        new_lives = max(0, row["lives"] - 1)
        cursor.execute(
            "UPDATE nine_lives_players SET lives=%s WHERE game_id=%s AND player_id=%s",
            (new_lives, game_id, current_pid)
        )
        events.append({"type": "life_lost", "player_id": current_pid, "lives_remaining": new_lives})
        if new_lives == 0:
            cursor.execute(
                "UPDATE nine_lives_players SET eliminated=1 WHERE game_id=%s AND player_id=%s",
                (game_id, current_pid)
            )
            events.append({"type": "eliminated", "player_id": current_pid})

    # Check if only one player remains
    cursor.execute(
        "SELECT player_id FROM nine_lives_players WHERE game_id=%s AND eliminated=0",
        (game_id,)
    )
    survivors = cursor.fetchall()
    if len(survivors) == 1:
        winner_pid = survivors[0]["player_id"]
        cursor.execute(
            "UPDATE nine_lives_games SET status='complete', winner_id=%s, ended_at=NOW() WHERE id=%s",
            (winner_pid, game_id)
        )
        cursor.execute("UPDATE matches SET status='complete' WHERE id=%s", (match_id,))
        events.append({"type": "winner", "player_id": winner_pid})
        db.commit()
        state = _get_state(db, match_id)
        state["events"] = events
        return jsonify(state), 200

    # Advance to next non-eliminated player
    next_idx = current_idx
    for _ in range(num_players):
        next_idx = (next_idx + 1) % num_players
        cursor.execute(
            "SELECT eliminated FROM nine_lives_players "
            "WHERE game_id=%s AND player_id=%s",
            (game_id, player_rows[next_idx]["player_id"])
        )
        r = cursor.fetchone()
        if not r["eliminated"]:
            break

    cursor.execute(
        "UPDATE nine_lives_games SET current_player_index=%s WHERE id=%s",
        (next_idx, game_id)
    )
    db.commit()

    state = _get_state(db, match_id)
    state["events"] = events
    return jsonify(state), 200


@nine_lives_bp.route("/nine_lives/matches/<int:match_id>/end", methods=["POST"])
def end_nine_lives_match(match_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE nine_lives_games SET status='cancelled', ended_at=NOW() WHERE match_id=%s",
        (match_id,)
    )
    cursor.execute("UPDATE matches SET status='cancelled' WHERE id=%s", (match_id,))
    db.commit()
    return jsonify({"match_id": match_id, "status": "cancelled"}), 200