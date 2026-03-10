"""
app/routes/api/killer.py
------------------------
REST endpoints for the Killer darts game.

POST /api/killer/matches                     — create match
GET  /api/killer/matches/<match_id>          — get state
POST /api/killer/matches/<match_id>/throw    — submit a batch of up to 3 throws
POST /api/killer/matches/<match_id>/next     — advance to next player
POST /api/killer/matches/<match_id>/undo     — undo last dart (current turn only)
POST /api/killer/matches/<match_id>/end      — abandon
"""

import random
from flask import Blueprint, request, jsonify
from app.models.db import get_db

killer_bp = Blueprint("killer", __name__)

KILLER_TARGET_HITS = 3   # hits required to become a killer / take a life


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_state(db, match_id):
    cursor = db.cursor()

    cursor.execute("SELECT * FROM killer_games WHERE match_id = %s", (match_id,))
    game = cursor.fetchone()
    if not game:
        return None

    game_id = game["id"]

    cursor.execute(
        """SELECT kp.*, p.name
           FROM killer_players kp
           JOIN players p ON p.id = kp.player_id
           WHERE kp.game_id = %s
           ORDER BY kp.turn_order ASC""",
        (game_id,)
    )
    kplayers = cursor.fetchall()

    players_out = []
    for kp in kplayers:
        players_out.append({
            "id":              kp["player_id"],
            "name":            kp["name"],
            "turn_order":      kp["turn_order"],
            "assigned_number": kp["assigned_number"],
            "hits":            kp["hits"],
            "is_killer":       bool(kp["is_killer"]),
            "lives":           kp["lives"],
            "eliminated":      bool(kp["eliminated"]),
        })

    current_player = players_out[game["current_player_index"]] if players_out else None

    return {
        "match_id":             match_id,
        "game_id":              game_id,
        "variant":              game["variant"],
        "current_player_index": game["current_player_index"],
        "current_player_id":    current_player["id"] if current_player else None,
        "status":               game["status"],
        "winner_id":            game["winner_id"],
        "players":              players_out,
    }


def _hits_for_dart(segment, multiplier, variant):
    """How many hits does this dart score (for gaining/losing killer status / lives).
    Only the exact required multiplier counts — a treble on a doubles game is a miss.
    """
    target_multiplier = 2 if variant == "doubles" else 3
    return 1 if multiplier == target_multiplier else 0


def _apply_throw(db, game_id, match_id, variant, thrower_pid, segment, multiplier, turn_number, dart_number):
    """
    Apply a single dart throw, updating killer_players state.
    Returns dict: { hits_scored, events: [str] }
    """
    cursor = db.cursor()
    events = []

    # Fetch thrower state
    cursor.execute(
        "SELECT * FROM killer_players WHERE game_id=%s AND player_id=%s",
        (game_id, thrower_pid)
    )
    thrower = cursor.fetchone()

    hits = _hits_for_dart(segment, multiplier, variant)

    if hits == 0 or segment == 0:
        # Miss or non-scoring hit — record and move on
        cursor.execute(
            "INSERT INTO killer_throws "
            "(game_id, match_id, player_id, turn_number, dart_number, segment, multiplier, hits_scored) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,0)",
            (game_id, match_id, thrower_pid, turn_number, dart_number, segment, multiplier)
        )
        db.commit()
        return {"hits_scored": 0, "events": []}

    # Find whose number was hit (could be self, opponent, or nobody)
    cursor.execute(
        "SELECT * FROM killer_players WHERE game_id=%s AND assigned_number=%s",
        (game_id, segment)
    )
    target_kp = cursor.fetchone()

    if target_kp is None:
        # Segment not assigned to anyone — no effect
        cursor.execute(
            "INSERT INTO killer_throws "
            "(game_id, match_id, player_id, turn_number, dart_number, segment, multiplier, hits_scored) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,0)",
            (game_id, match_id, thrower_pid, turn_number, dart_number, segment, multiplier)
        )
        db.commit()
        return {"hits_scored": 0, "events": []}

    target_pid = target_kp["player_id"]
    is_self    = (target_pid == thrower_pid)

    if not thrower["is_killer"]:
        # ── Phase 1: gaining killer status ───────────────────────────────────
        if is_self:
            new_hits = min(thrower["hits"] + hits, KILLER_TARGET_HITS)
            actual   = new_hits - thrower["hits"]
            cursor.execute(
                "UPDATE killer_players SET hits=%s WHERE game_id=%s AND player_id=%s",
                (new_hits, game_id, thrower_pid)
            )
            if new_hits >= KILLER_TARGET_HITS:
                cursor.execute(
                    "UPDATE killer_players SET is_killer=1 WHERE game_id=%s AND player_id=%s",
                    (game_id, thrower_pid)
                )
                events.append({"type": "killer", "player_id": thrower_pid})
        else:
            # Not yet a killer — hitting others has no effect
            actual = 0
    else:
        # ── Phase 2: killer targeting opponents ──────────────────────────────
        if is_self:
            # Self-hit as killer: lose lives
            new_lives = max(0, target_kp["lives"] - hits)
            actual    = target_kp["lives"] - new_lives
            cursor.execute(
                "UPDATE killer_players SET lives=%s WHERE game_id=%s AND player_id=%s",
                (new_lives, game_id, thrower_pid)
            )
            for _ in range(actual):
                events.append({"type": "life_lost", "player_id": thrower_pid})
            if new_lives <= 0:
                cursor.execute(
                    "UPDATE killer_players SET eliminated=1 WHERE game_id=%s AND player_id=%s",
                    (game_id, thrower_pid)
                )
                events.append({"type": "eliminated", "player_id": thrower_pid})
        else:
            # Target opponent
            if target_kp["eliminated"]:
                actual = 0
            else:
                new_lives = max(0, target_kp["lives"] - hits)
                actual    = target_kp["lives"] - new_lives
                cursor.execute(
                    "UPDATE killer_players SET lives=%s WHERE game_id=%s AND player_id=%s",
                    (new_lives, game_id, target_pid)
                )
                for _ in range(actual):
                    events.append({"type": "life_lost", "player_id": target_pid})
                if new_lives <= 0:
                    cursor.execute(
                        "UPDATE killer_players SET eliminated=1 WHERE game_id=%s AND player_id=%s",
                        (game_id, target_pid)
                    )
                    events.append({"type": "eliminated", "player_id": target_pid})

    cursor.execute(
        "INSERT INTO killer_throws "
        "(game_id, match_id, player_id, turn_number, dart_number, segment, multiplier, hits_scored) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (game_id, match_id, thrower_pid, turn_number, dart_number, segment, multiplier, actual)
    )

    # Check for win (exactly one player not eliminated)
    cursor.execute(
        "SELECT player_id FROM killer_players WHERE game_id=%s AND eliminated=0",
        (game_id,)
    )
    survivors = cursor.fetchall()
    if len(survivors) == 1:
        winner_pid = survivors[0]["player_id"]
        cursor.execute(
            "UPDATE killer_games SET status='complete', winner_id=%s, ended_at=NOW() WHERE id=%s",
            (winner_pid, game_id)
        )
        cursor.execute("UPDATE matches SET status='complete' WHERE id=%s", (match_id,))
        events.append({"type": "winner", "player_id": winner_pid})

    db.commit()
    return {"hits_scored": actual, "events": events}


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@killer_bp.route("/killer/matches", methods=["POST"])
def create_killer_match():
    """
    Payload: { "player_ids": [1,2,...], "variant": "doubles"|"triples" }
    """
    data = request.get_json(silent=True)
    if not data or not data.get("player_ids"):
        return jsonify({"error": "player_ids required"}), 400

    player_ids = data["player_ids"]
    if not (2 <= len(player_ids) <= 6):
        return jsonify({"error": "2–6 players required"}), 400

    variant = data.get("variant", "doubles")
    if variant not in ("doubles", "triples"):
        variant = "doubles"

    # Assign unique random numbers 1-20
    available = list(range(1, 21))
    random.shuffle(available)
    assigned = available[:len(player_ids)]

    # Random turn order
    order = list(range(len(player_ids)))
    random.shuffle(order)

    db = get_db()
    cursor = db.cursor()

    cpu_difficulty = data.get("cpu_difficulty")  # 'easy'|'medium'|'hard' or None
    if cpu_difficulty not in ("easy", "medium", "hard"):
        cpu_difficulty = None

    cursor.execute(
        "INSERT INTO matches (game_type, cpu_difficulty, status) VALUES ('killer', %s, 'active')",
        (cpu_difficulty,)
    )
    match_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO killer_games (match_id, variant) VALUES (%s,%s)",
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
            "INSERT INTO killer_players "
            "(game_id, match_id, player_id, turn_order, assigned_number) "
            "VALUES (%s,%s,%s,%s,%s)",
            (game_id, match_id, pid, idx, assigned[pos])
        )

    db.commit()
    state = _get_state(db, match_id)
    return jsonify(state), 201


@killer_bp.route("/killer/matches/<int:match_id>", methods=["GET"])
def get_killer_match(match_id):
    db = get_db()
    state = _get_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@killer_bp.route("/killer/matches/<int:match_id>/throw", methods=["POST"])
def killer_throw(match_id):
    """
    Submit a batch of up to 3 dart throws.
    Payload: { "throws": [ {"segment":5,"multiplier":2}, ... ], "turn_number": 3 }
    """
    data = request.get_json(silent=True)
    if not data or not data.get("throws"):
        return jsonify({"error": "throws required"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM killer_games WHERE match_id=%s", (match_id,))
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
    player_rows  = cursor.fetchall()
    current_pid  = player_rows[game["current_player_index"]]["player_id"]

    all_events = []
    for dart_num, t in enumerate(data["throws"], start=1):
        seg = int(t.get("segment", 0))
        mul = int(t.get("multiplier", 1))
        result = _apply_throw(db, game_id, match_id, variant, current_pid,
                              seg, mul, turn_num, dart_num)
        all_events.extend(result["events"])
        # Re-fetch game in case it completed
        cursor.execute("SELECT status FROM killer_games WHERE id=%s", (game_id,))
        g = cursor.fetchone()
        if g["status"] != "active":
            break

    state = _get_state(db, match_id)
    state["events"] = all_events
    return jsonify(state), 200


@killer_bp.route("/killer/matches/<int:match_id>/next", methods=["POST"])
def killer_next(match_id):
    """Advance to the next non-eliminated player."""
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM killer_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        state = _get_state(db, match_id)
        return jsonify(state), 200

    game_id      = game["id"]
    num_players  = len(_get_state(db, match_id)["players"])
    current_idx  = game["current_player_index"]

    # Fetch all players ordered by turn_order
    cursor.execute(
        "SELECT player_id, eliminated FROM killer_players "
        "WHERE game_id=%s ORDER BY turn_order ASC",
        (game_id,)
    )
    kplayers = cursor.fetchall()

    # Find next non-eliminated player
    next_idx = current_idx
    for _ in range(num_players):
        next_idx = (next_idx + 1) % num_players
        if not kplayers[next_idx]["eliminated"]:
            break

    cursor.execute(
        "UPDATE killer_games SET current_player_index=%s WHERE id=%s",
        (next_idx, game_id)
    )
    db.commit()

    state = _get_state(db, match_id)
    return jsonify(state), 200


@killer_bp.route("/killer/matches/<int:match_id>/undo", methods=["POST"])
def killer_undo(match_id):
    """
    Undo the last dart in the current turn (before NEXT is pressed).
    We reverse the last killer_throws row by re-deriving state from scratch.
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT * FROM killer_games WHERE match_id=%s", (match_id,))
    game = cursor.fetchone()
    if not game:
        return jsonify({"error": "Match not found"}), 404

    game_id = game["id"]

    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id=%s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_rows = cursor.fetchall()
    current_pid = player_rows[game["current_player_index"]]["player_id"]

    # Find and delete last throw for current player this turn
    cursor.execute(
        "SELECT id FROM killer_throws WHERE game_id=%s AND player_id=%s "
        "ORDER BY id DESC LIMIT 1",
        (game_id, current_pid)
    )
    last = cursor.fetchone()
    if not last:
        return jsonify({"error": "Nothing to undo"}), 400

    cursor.execute("DELETE FROM killer_throws WHERE id=%s", (last["id"],))

    # Recompute player states from scratch based on remaining throws
    _recompute_player_states(db, game_id, match_id)

    db.commit()
    state = _get_state(db, match_id)
    return jsonify(state), 200


def _recompute_player_states(db, game_id, match_id):
    """Rebuild hits/is_killer/lives/eliminated for all players from throw history."""
    cursor = db.cursor()

    cursor.execute("SELECT * FROM killer_games WHERE id=%s", (game_id,))
    game    = cursor.fetchone()
    variant = game["variant"]

    cursor.execute(
        "SELECT player_id FROM killer_players WHERE game_id=%s",
        (game_id,)
    )
    pids = [r["player_id"] for r in cursor.fetchall()]

    # Reset all to initial state
    cursor.execute(
        "UPDATE killer_players SET hits=0, is_killer=0, lives=3, eliminated=0 "
        "WHERE game_id=%s", (game_id,)
    )
    cursor.execute(
        "UPDATE killer_games SET status='active', winner_id=NULL, ended_at=NULL "
        "WHERE id=%s", (game_id,)
    )
    cursor.execute(
        "UPDATE matches SET status='active' WHERE id=%s", (match_id,)
    )

    # Replay throws in order
    cursor.execute(
        "SELECT * FROM killer_throws WHERE game_id=%s ORDER BY id ASC",
        (game_id,)
    )
    throws = cursor.fetchall()

    # Use in-memory state to replay
    state = {pid: {"hits": 0, "is_killer": False, "lives": 3, "eliminated": False}
             for pid in pids}

    # Build segment→player_id map
    cursor.execute(
        "SELECT player_id, assigned_number FROM killer_players WHERE game_id=%s",
        (game_id,)
    )
    num_map = {r["assigned_number"]: r["player_id"] for r in cursor.fetchall()}

    for t in throws:
        thrower_pid = t["player_id"]
        segment     = t["segment"]
        multiplier  = t["multiplier"]
        thrower     = state[thrower_pid]
        hits        = _hits_for_dart(segment, multiplier, variant)

        if hits == 0 or segment == 0 or segment not in num_map:
            continue

        target_pid = num_map[segment]
        is_self    = (target_pid == thrower_pid)

        if not thrower["is_killer"]:
            if is_self:
                thrower["hits"] = min(thrower["hits"] + hits, KILLER_TARGET_HITS)
                if thrower["hits"] >= KILLER_TARGET_HITS:
                    thrower["is_killer"] = True
        else:
            target = state[target_pid]
            if not target["eliminated"]:
                target["lives"] = max(0, target["lives"] - hits)
                if target["lives"] <= 0:
                    target["eliminated"] = True

    # Check for winner
    survivors = [pid for pid, s in state.items() if not s["eliminated"]]
    if len(survivors) == 1:
        cursor.execute(
            "UPDATE killer_games SET status='complete', winner_id=%s, ended_at=NOW() WHERE id=%s",
            (survivors[0], game_id)
        )
        cursor.execute("UPDATE matches SET status='complete' WHERE id=%s", (match_id,))

    # Write back
    for pid, s in state.items():
        cursor.execute(
            "UPDATE killer_players SET hits=%s, is_killer=%s, lives=%s, eliminated=%s "
            "WHERE game_id=%s AND player_id=%s",
            (s["hits"], int(s["is_killer"]), s["lives"], int(s["eliminated"]), game_id, pid)
        )


@killer_bp.route("/killer/matches/<int:match_id>/end", methods=["POST"])
def end_killer_match(match_id):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE killer_games SET status='cancelled', ended_at=NOW() WHERE match_id=%s",
        (match_id,)
    )
    cursor.execute("UPDATE matches SET status='cancelled' WHERE id=%s", (match_id,))
    db.commit()
    return jsonify({"match_id": match_id, "status": "cancelled"}), 200


@killer_bp.route("/killer/matches/<int:match_id>/restart", methods=["POST"])
def restart_killer_match(match_id):
    db     = get_db()
    cursor = db.cursor()

    # Get the game id
    cursor.execute("SELECT id FROM killer_games WHERE match_id = %s", (match_id,))
    row = cursor.fetchone()
    if not row:
        return jsonify({"error": "match not found"}), 404
    game_id = row["id"]

    # Delete all throws for this game
    cursor.execute("DELETE FROM killer_throws WHERE game_id = %s", (game_id,))

    # Reset all player state to defaults
    cursor.execute(
        "UPDATE killer_players SET hits=0, is_killer=0, lives=3, eliminated=0 "
        "WHERE game_id = %s",
        (game_id,)
    )

    # Reset game state
    cursor.execute(
        "UPDATE killer_games SET current_player_index=0, status='active', "
        "winner_id=NULL, ended_at=NULL WHERE id = %s",
        (game_id,)
    )

    db.commit()
    return jsonify(_get_state(db, match_id)), 200