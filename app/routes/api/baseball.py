"""
app/routes/api/baseball.py
--------------------------
REST endpoints for Baseball Darts — high score tracking and multiplayer game.

Endpoints:
    GET  /api/baseball/highscore/<player_id>         -- Get player's best score
    POST /api/baseball/highscore/<player_id>         -- Submit a new score (saves if best)
    POST /api/baseball/matches                       -- Create a new multiplayer game
    GET  /api/baseball/matches/<match_id>            -- Get full game state
    POST /api/baseball/matches/<match_id>/throw      -- Record a single dart throw
    POST /api/baseball/matches/<match_id>/next       -- Advance (end set / end inning)
    POST /api/baseball/matches/<match_id>/undo       -- Undo last dart in current set
    POST /api/baseball/matches/<match_id>/end        -- Abandon the game
"""

import random
from flask import Blueprint, request, jsonify
from app.models.db import get_db

baseball_bp = Blueprint("baseball", __name__)


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_game_state(db, match_id):
    """
    Return full game state as a dict suitable for JSON serialisation.
    """
    cursor = db.cursor()

    # Game row
    cursor.execute(
        "SELECT * FROM baseball_games WHERE match_id = %s",
        (match_id,)
    )
    game = cursor.fetchone()
    if not game:
        return None

    game_id = game["id"]

    # Players ordered by their position (derived from match)
    cursor.execute(
        """SELECT p.id, p.name,
                  mp.turn_order
           FROM   match_players mp
           JOIN   players p ON p.id = mp.player_id
           WHERE  mp.match_id = %s
           ORDER BY mp.turn_order ASC""",
        (match_id,)
    )
    players = cursor.fetchall()

    # Innings scores: { player_id: { inning: runs } }
    cursor.execute(
        "SELECT player_id, inning_number, runs, outs, darts_thrown, complete "
        "FROM baseball_innings WHERE game_id = %s",
        (game_id,)
    )
    innings_rows = cursor.fetchall()
    innings = {}
    for row in innings_rows:
        pid = str(row["player_id"])
        if pid not in innings:
            innings[pid] = {}
        innings[pid][row["inning_number"]] = {
            "runs":    row["runs"],
            "outs":    row["outs"],
            "darts":   row["darts_thrown"],
            "complete": bool(row["complete"]),
        }

    # Throws for the current inning/player (current set only — for display)
    current_inning  = game["current_inning"]
    current_player  = players[game["current_player_index"]] if players else None
    current_pid     = current_player["id"] if current_player else None

    current_inning_row = innings.get(str(current_pid), {}).get(current_inning, {})
    darts_in_set = (current_inning_row.get("darts", 0) % 3) if current_inning_row else 0

    cursor.execute(
        """SELECT segment, multiplier, runs, is_out, dart_number
           FROM baseball_throws
           WHERE game_id = %s AND player_id = %s AND inning_number = %s
           ORDER BY id DESC LIMIT 3""",
        (game_id, current_pid, current_inning)
    ) if current_pid else None
    current_throws = cursor.fetchall() if current_pid else []

    # Total runs per player
    total_runs = {}
    for row in innings_rows:
        pid = str(row["player_id"])
        total_runs[pid] = total_runs.get(pid, 0) + row["runs"]

    return {
        "match_id":             match_id,
        "game_id":              game_id,
        "start_number":         game["start_number"],
        "current_inning":       current_inning,
        "current_player_index": game["current_player_index"],
        "current_player_id":    current_pid,
        "status":               game["status"],
        "winner_ids":           game["winner_ids"],
        "players":              [{"id": p["id"], "name": p["name"]} for p in players],
        "innings":              innings,
        "total_runs":           total_runs,
        "current_throws":       list(reversed(current_throws)),
        "darts_in_set":         darts_in_set,
    }


def _ensure_inning_row(db, game_id, match_id, player_id, inning_number, target_number):
    cursor = db.cursor()
    cursor.execute(
        "SELECT id FROM baseball_innings "
        "WHERE game_id=%s AND player_id=%s AND inning_number=%s",
        (game_id, player_id, inning_number)
    )
    row = cursor.fetchone()
    if not row:
        cursor.execute(
            "INSERT INTO baseball_innings "
            "(game_id, match_id, player_id, inning_number, target_number) "
            "VALUES (%s,%s,%s,%s,%s)",
            (game_id, match_id, player_id, inning_number, target_number)
        )
        db.commit()
        return cursor.lastrowid
    return row["id"]


def _submit_high_scores(db, match_id):
    """Submit final run totals for all players and update high scores."""
    cursor = db.cursor()
    cursor.execute(
        """SELECT player_id, SUM(runs) as total
           FROM baseball_innings
           WHERE match_id=%s
           GROUP BY player_id""",
        (match_id,)
    )
    rows = cursor.fetchall()
    results = []
    for row in rows:
        pid   = row["player_id"]
        total = row["total"] or 0
        cursor.execute(
            "SELECT score FROM player_high_scores "
            "WHERE player_id=%s AND game_type='baseball'",
            (pid,)
        )
        existing = cursor.fetchone()
        current_best = existing["score"] if existing else 0
        is_new = total > current_best
        if is_new:
            if existing:
                cursor.execute(
                    "UPDATE player_high_scores SET score=%s, achieved_at=NOW() "
                    "WHERE player_id=%s AND game_type='baseball'",
                    (total, pid)
                )
            else:
                cursor.execute(
                    "INSERT INTO player_high_scores (player_id, game_type, score) "
                    "VALUES (%s,'baseball',%s)",
                    (pid, total)
                )
        results.append({"player_id": pid, "score": total,
                         "high_score": total if is_new else current_best,
                         "is_new_high": is_new})
    db.commit()
    return results


# ─────────────────────────────────────────────────────────────────────────────
# High score endpoints (solo practice)
# ─────────────────────────────────────────────────────────────────────────────

@baseball_bp.route("/baseball/highscore/<int:player_id>", methods=["GET"])
def get_high_score(player_id):
    from flask import request as _req
    game_type = _req.args.get("game_type", "baseball")
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT score FROM player_high_scores WHERE player_id = %s AND game_type = %s",
        (player_id, game_type)
    )
    row = cursor.fetchone()
    return jsonify({"player_id": player_id, "score": row["score"] if row else 0}), 200


@baseball_bp.route("/baseball/highscore/<int:player_id>", methods=["POST"])
def submit_score(player_id):
    from flask import request as _req
    game_type = _req.args.get("game_type", "baseball")
    data = _req.get_json(silent=True)
    if not data or "score" not in data:
        return jsonify({"error": "score is required"}), 400
    submitted = int(data["score"])
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "SELECT score FROM player_high_scores WHERE player_id = %s AND game_type = %s",
        (player_id, game_type)
    )
    existing = cursor.fetchone()
    current_best = existing["score"] if existing else 0
    is_new_high  = submitted > current_best
    if is_new_high:
        if existing:
            cursor.execute(
                "UPDATE player_high_scores SET score=%s, achieved_at=NOW() "
                "WHERE player_id=%s AND game_type=%s", (submitted, player_id, game_type))
        else:
            cursor.execute(
                "INSERT INTO player_high_scores (player_id, game_type, score) VALUES (%s,%s,%s)",
                (player_id, game_type, submitted))
        db.commit()
    return jsonify({
        "player_id": player_id, "submitted_score": submitted,
        "high_score": submitted if is_new_high else current_best,
        "is_new_high": is_new_high,
    }), 200


# ─────────────────────────────────────────────────────────────────────────────
# Multiplayer game endpoints
# ─────────────────────────────────────────────────────────────────────────────

@baseball_bp.route("/baseball/matches", methods=["POST"])
def create_baseball_match():
    """
    Create a new multiplayer Baseball Darts game.
    Payload: { "player_ids": [1, 2, ...] }
    """
    data = request.get_json(silent=True)
    if not data or not data.get("player_ids"):
        return jsonify({"error": "player_ids required"}), 400

    player_ids = data["player_ids"]
    if not (2 <= len(player_ids) <= 4):
        return jsonify({"error": "2 to 4 players required"}), 400

    start_number = random.randint(1, 11)
    db = get_db()
    cursor = db.cursor()

    # Create base match record
    cursor.execute(
        "INSERT INTO matches (game_type, status) VALUES ('baseball', 'active')"
    )
    match_id = cursor.lastrowid

    # Record player order in match_players
    for idx, pid in enumerate(player_ids):
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s,%s,%s)",
            (match_id, pid, idx)
        )

    # Create baseball_games row
    cursor.execute(
        "INSERT INTO baseball_games (match_id, start_number) VALUES (%s,%s)",
        (match_id, start_number)
    )
    db.commit()

    state = _get_game_state(db, match_id)
    return jsonify(state), 201


@baseball_bp.route("/baseball/matches/<int:match_id>", methods=["GET"])
def get_baseball_match(match_id):
    db = get_db()
    state = _get_game_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@baseball_bp.route("/baseball/matches/<int:match_id>/throw", methods=["POST"])
def record_baseball_throw(match_id):
    """
    Record a batch of up to 3 dart throws for the current set.
    Payload: { "throws": [ {"segment": 8, "multiplier": 1}, ... ] }
    """
    data = request.get_json(silent=True)
    if not data or not data.get("throws"):
        return jsonify({"error": "throws array required"}), 400

    throws = data["throws"]

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM baseball_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not active"}), 400

    game_id        = game["id"]
    current_inning = game["current_inning"]
    start_number   = game["start_number"]
    target_number  = start_number + current_inning - 1

    # Resolve current player
    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    players     = [r["player_id"] for r in player_rows]
    current_pid = players[game["current_player_index"]]

    # Ensure inning row exists and get current state
    inning_id = _ensure_inning_row(
        db, game_id, match_id, current_pid, current_inning, target_number
    )
    cursor.execute(
        "SELECT runs, outs, darts_thrown FROM baseball_innings WHERE id=%s",
        (inning_id,)
    )
    inn          = cursor.fetchone()
    total_runs   = inn["runs"]
    total_outs   = inn["outs"]
    total_darts  = inn["darts_thrown"]

    # Insert each throw
    for t in throws:
        segment    = int(t.get("segment", 0))
        multiplier = int(t.get("multiplier", 1))
        is_hit     = (segment == target_number)
        runs       = multiplier if is_hit else 0
        is_out     = not is_hit
        dart_num   = (total_darts % 3) + 1

        cursor.execute(
            "INSERT INTO baseball_throws "
            "(game_id, inning_id, match_id, player_id, inning_number, "
            " dart_number, segment, multiplier, runs, is_out) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (game_id, inning_id, match_id, current_pid, current_inning,
             dart_num, segment, multiplier, runs, int(is_out))
        )
        total_runs  += runs
        total_outs  += 1 if is_out else 0
        total_darts += 1

    cursor.execute(
        "UPDATE baseball_innings SET runs=%s, outs=%s, darts_thrown=%s WHERE id=%s",
        (total_runs, total_outs, total_darts, inning_id)
    )
    db.commit()

    state = _get_game_state(db, match_id)
    return jsonify(state), 200


@baseball_bp.route("/baseball/matches/<int:match_id>/next", methods=["POST"])
def baseball_next(match_id):
    """
    Called after player presses NEXT:
      - If end of set (3 darts) but outs < 3: just acknowledges, state already up to date
      - If end of inning (outs >= 3 after last set): advance player/inning
    Payload: { "inning_complete": true/false }
    """
    data = request.get_json(silent=True) or {}
    inning_complete = bool(data.get("inning_complete", False))

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM baseball_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not active"}), 400

    if not inning_complete:
        # Mid-inning set boundary — no state change needed, just return current state
        state = _get_game_state(db, match_id)
        return jsonify(state), 200

    game_id         = game["id"]
    current_inning  = game["current_inning"]
    current_p_index = game["current_player_index"]

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    num_players = len(player_rows)

    # Mark current inning complete
    cursor.execute(
        "UPDATE baseball_innings SET complete=1 "
        "WHERE game_id=%s AND player_id=%s AND inning_number=%s",
        (game_id, player_rows[current_p_index]["player_id"], current_inning)
    )

    next_p_index = current_p_index + 1
    next_inning  = current_inning

    if next_p_index >= num_players:
        # All players have batted this inning
        next_p_index = 0
        next_inning  = current_inning + 1

    if next_inning > 9:
        # Game over — determine winner(s)
        cursor.execute(
            """SELECT player_id, SUM(runs) as total
               FROM baseball_innings WHERE game_id=%s GROUP BY player_id""",
            (game_id,)
        )
        totals = {str(r["player_id"]): (r["total"] or 0) for r in cursor.fetchall()}
        max_runs = max(totals.values()) if totals else 0
        winners  = [pid for pid, r in totals.items() if r == max_runs]

        cursor.execute(
            "UPDATE baseball_games SET status='complete', winner_ids=%s, ended_at=NOW(), "
            "current_player_index=%s WHERE id=%s",
            (",".join(winners), current_p_index, game_id)
        )
        cursor.execute(
            "UPDATE matches SET status='complete' WHERE id=%s", (match_id,)
        )
        db.commit()

        high_score_results = _submit_high_scores(db, match_id)
        state = _get_game_state(db, match_id)
        state["high_score_results"] = high_score_results
        return jsonify(state), 200

    cursor.execute(
        "UPDATE baseball_games SET current_inning=%s, current_player_index=%s WHERE id=%s",
        (next_inning, next_p_index, game_id)
    )
    db.commit()

    state = _get_game_state(db, match_id)
    return jsonify(state), 200


@baseball_bp.route("/baseball/matches/<int:match_id>/undo", methods=["POST"])
def baseball_undo(match_id):
    """Undo the last dart in the current inning for the current player."""
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM baseball_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not active"}), 400

    game_id        = game["id"]
    current_inning = game["current_inning"]

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    current_pid = player_rows[game["current_player_index"]]["player_id"]

    # Find last throw for this player/inning
    cursor.execute(
        "SELECT bt.id, bt.runs, bt.is_out, bi.id as inning_id, bi.runs as inn_runs, "
        "bi.outs as inn_outs, bi.darts_thrown "
        "FROM baseball_throws bt "
        "JOIN baseball_innings bi ON bi.id = bt.inning_id "
        "WHERE bt.game_id=%s AND bt.player_id=%s AND bt.inning_number=%s "
        "ORDER BY bt.id DESC LIMIT 1",
        (game_id, current_pid, current_inning)
    )
    last = cursor.fetchone()
    if not last:
        return jsonify({"error": "Nothing to undo"}), 400

    cursor.execute("DELETE FROM baseball_throws WHERE id=%s", (last["id"],))
    cursor.execute(
        "UPDATE baseball_innings SET runs=%s, outs=%s, darts_thrown=%s WHERE id=%s",
        (last["inn_runs"] - last["runs"],
         last["inn_outs"] - last["is_out"],
         last["darts_thrown"] - 1,
         last["inning_id"])
    )
    db.commit()

    state = _get_game_state(db, match_id)
    return jsonify(state), 200


@baseball_bp.route("/baseball/matches/<int:match_id>/end", methods=["POST"])
def end_baseball_match(match_id):
    """Abandon the game."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE baseball_games SET status='cancelled', ended_at=NOW() WHERE match_id=%s",
        (match_id,)
    )
    cursor.execute(
        "UPDATE matches SET status='cancelled' WHERE id=%s", (match_id,)
    )
    db.commit()
    return jsonify({"match_id": match_id, "status": "cancelled"}), 200