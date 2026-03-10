"""
app/routes/api/shanghai.py
--------------------------
Shanghai darts game endpoints.

POST /api/shanghai/matches              — create a new game
GET  /api/shanghai/matches/<id>         — get full game state
POST /api/shanghai/matches/<id>/submit  — submit a completed round (all 3 darts)
POST /api/shanghai/matches/<id>/end     — abandon match

Rules:
  - Rounds 1-7 (short) or 1-20 (long), each targeting that round number
  - Only hits on the current target number score
  - Single = face value, Double = 2x, Treble = 3x
  - Shanghai = hitting S + D + T of the target in one round → instant win
  - No bust rule, no penalty for zero rounds
  - Tie after all rounds → bull tiebreak (target = 25), repeated until broken
  - Bull tiebreak: inner bull (50) beats outer bull (25) beats miss
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

shanghai_bp = Blueprint("shanghai", __name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_players(cursor, match_id):
    cursor.execute(
        "SELECT p.id, p.name FROM match_players mp "
        "JOIN players p ON p.id = mp.player_id "
        "WHERE mp.match_id = %s ORDER BY mp.turn_order",
        (match_id,)
    )
    return cursor.fetchall()


def _get_state(db, match_id):
    """Return full game state dict for a Shanghai match."""
    cursor = db.cursor()

    cursor.execute(
        "SELECT sg.id, sg.match_id, sg.num_rounds, sg.target_sequence, sg.status, sg.winner_id, sg.tiebreak "
        "FROM shanghai_games sg WHERE sg.match_id = %s",
        (match_id,)
    )
    game = cursor.fetchone()
    if not game:
        return None

    game_id = game["id"]
    players = _get_players(cursor, match_id)
    player_ids = [p["id"] for p in players]

    # All submitted rounds grouped by player
    cursor.execute(
        "SELECT player_id, round_number, target_number, score, shanghai, darts_thrown "
        "FROM shanghai_rounds "
        "WHERE game_id = %s AND submitted = 1 "
        "ORDER BY round_number",
        (game_id,)
    )
    rounds_raw = cursor.fetchall()

    # scores[player_id] = total score across all submitted rounds
    scores = {pid: 0 for pid in player_ids}
    # rounds_by_player[player_id] = list of round dicts
    rounds_by_player = {pid: [] for pid in player_ids}
    for r in rounds_raw:
        pid = r["player_id"]
        scores[pid] = scores.get(pid, 0) + r["score"]
        rounds_by_player[pid].append({
            "round_number":  r["round_number"],
            "target_number": r["target_number"],
            "score":         r["score"],
            "shanghai":      bool(r["shanghai"]),
            "darts_thrown":  r["darts_thrown"],
        })

    # Determine current round and whose turn it is
    # Count submitted rounds per player to find the current round number
    # All players complete each round before moving to the next
    submitted_per_player = {pid: len(rounds_by_player[pid]) for pid in player_ids}
    min_submitted = min(submitted_per_player.values()) if player_ids else 0
    max_submitted = max(submitted_per_player.values()) if player_ids else 0

    # Current round = min_submitted + 1 (1-based), unless tiebreak
    if game["tiebreak"]:
        current_round = 0   # 0 = tiebreak round
        target_number = 25
    else:
        current_round = min_submitted + 1
        if game.get("target_sequence"):
            # 7-round random variant — look up from stored sequence
            seq = [int(x) for x in game["target_sequence"].split(",")]
            target_number = seq[current_round - 1] if current_round <= len(seq) else None
        else:
            # 20-round sequential variant
            target_number = current_round if current_round <= game["num_rounds"] else None

    # Current player = first player who hasn't submitted current_round yet
    current_player_id = None
    for pid in player_ids:
        submitted = submitted_per_player[pid]
        if submitted < (min_submitted + 1 if max_submitted > min_submitted else min_submitted + 1):
            current_player_id = pid
            break
    # Fallback: all players equal rounds — start of new round, first player goes
    if current_player_id is None and player_ids:
        current_player_id = player_ids[0]

    # Tiebreak: find which tied players still need to throw
    if game["tiebreak"]:
        cursor.execute(
            "SELECT player_id FROM shanghai_rounds "
            "WHERE game_id = %s AND round_number = 0 AND submitted = 1",
            (game_id,)
        )
        tb_done = {r["player_id"] for r in cursor.fetchall()}
        for pid in player_ids:
            if pid not in tb_done:
                current_player_id = pid
                break
        else:
            current_player_id = player_ids[0]

    return {
        "match_id":           match_id,
        "game_id":            game_id,
        "num_rounds":         game["num_rounds"],
        "target_sequence":    game.get("target_sequence"),  # None for 20-round
        "status":             game["status"],
        "winner_id":          game["winner_id"],
        "tiebreak":           bool(game["tiebreak"]),
        "players":            [{"id": p["id"], "name": p["name"]} for p in players],
        "scores":             scores,
        "rounds_by_player":   rounds_by_player,
        "current_round":      current_round,
        "target_number":      target_number,
        "current_player_id":  current_player_id,
    }


def _check_tie_winner(scores, tiebreak_rounds):
    """
    Given tiebreak round results {player_id: score}, return the winner.
    50 (inner bull) > 25 (outer bull) > 0 (miss).
    Returns winning player_id, or None if still tied.
    """
    if not tiebreak_rounds:
        return None
    max_score = max(tiebreak_rounds.values())
    winners = [pid for pid, s in tiebreak_rounds.items() if s == max_score]
    if len(winners) == 1:
        return winners[0]
    return None  # still tied


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@shanghai_bp.route("/shanghai/matches", methods=["POST"])
def create_shanghai_match():
    """
    Create a new Shanghai match.
    Body: { player_ids: [int, ...], num_rounds: 7|20 }
    Returns: full game state
    """
    data       = request.get_json(force=True)
    player_ids = data.get("player_ids", [])
    num_rounds = int(data.get("num_rounds", 7))

    if not (2 <= len(player_ids) <= 4):
        return jsonify({"error": "Shanghai requires 2–4 players"}), 400
    if num_rounds not in (7, 20):
        return jsonify({"error": "num_rounds must be 7 or 20"}), 400

    # For 7-round games, pick 7 distinct random targets from 1-20
    import random
    if num_rounds == 7:
        targets = random.sample(range(1, 21), 7)
        target_sequence = ','.join(str(t) for t in targets)
    else:
        target_sequence = None

    db     = get_db()
    cursor = db.cursor()

    # Create match record
    cpu_difficulty = data.get("cpu_difficulty")
    if cpu_difficulty not in ("easy", "medium", "hard"):
        cpu_difficulty = None

    cursor.execute(
        "INSERT INTO matches (game_type, cpu_difficulty, legs_to_win, sets_to_win, legs_per_set, "
        "session_type, status) VALUES ('shanghai', %s, 1, 1, 1, 'match', 'active')",
        (cpu_difficulty,)
    )
    match_id = cursor.lastrowid

    for i, pid in enumerate(player_ids):
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s, %s, %s)",
            (match_id, pid, i)
        )

    cursor.execute(
        "INSERT INTO shanghai_games (match_id, num_rounds, target_sequence, status) VALUES (%s, %s, %s, 'active')",
        (match_id, num_rounds, target_sequence)
    )
    db.commit()

    return jsonify(_get_state(db, match_id)), 201


@shanghai_bp.route("/shanghai/matches/<int:match_id>", methods=["GET"])
def get_shanghai_match(match_id):
    db    = get_db()
    state = _get_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@shanghai_bp.route("/shanghai/matches/<int:match_id>/submit", methods=["POST"])
def submit_shanghai_round(match_id):
    """
    Submit a completed round for one player (all darts entered, NEXT pressed).

    Body:
    {
        "player_id": int,
        "round_number": int,          -- 1-20 or 0 for tiebreak
        "target_number": int,         -- number being aimed at
        "darts": [
            { "segment": int, "multiplier": int },
            ...                       -- 1 to 3 darts
        ]
    }

    Returns: updated game state + round_result
    """
    data         = request.get_json(force=True)
    player_id    = int(data["player_id"])
    round_number = int(data["round_number"])
    target_number = int(data["target_number"])
    darts        = data.get("darts", [])

    if not (1 <= len(darts) <= 3):
        return jsonify({"error": "darts must contain 1-3 throws"}), 400

    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT sg.id, sg.num_rounds, sg.status, sg.tiebreak "
        "FROM shanghai_games sg WHERE sg.match_id = %s",
        (match_id,)
    )
    game = cursor.fetchone()
    if not game or game["status"] != "active":
        return jsonify({"error": "Game not found or not active"}), 400

    game_id = game["id"]

    players = _get_players(cursor, match_id)
    player_ids = [p["id"] for p in players]

    # ── Score the round ──────────────────────────────────────────────
    round_score = 0
    hit_single  = False
    hit_double  = False
    hit_treble  = False
    is_shanghai = False

    dart_records = []
    for i, dart in enumerate(darts):
        seg = int(dart["segment"])
        mul = int(dart["multiplier"])
        pts = 0

        # In tiebreak, only bull scores (25 or 50)
        if round_number == 0:
            if seg == 25:
                pts = 25 * mul   # outer=25, inner=50
        else:
            # Only the target number scores
            if seg == target_number:
                pts = seg * mul
                if mul == 1: hit_single = True
                if mul == 2: hit_double = True
                if mul == 3: hit_treble = True

        round_score += pts
        dart_records.append({"segment": seg, "multiplier": mul, "points": pts})

    # Shanghai = single + double + treble of target in same round
    if round_number != 0 and hit_single and hit_double and hit_treble:
        is_shanghai = True

    # ── Write round record ───────────────────────────────────────────
    cursor.execute(
        "INSERT INTO shanghai_rounds "
        "(game_id, match_id, player_id, round_number, target_number, "
        "score, shanghai, darts_thrown, submitted) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1)",
        (game_id, match_id, player_id, round_number, target_number,
         round_score, int(is_shanghai), len(darts))
    )
    round_id = cursor.lastrowid

    for i, d in enumerate(dart_records):
        cursor.execute(
            "INSERT INTO shanghai_throws "
            "(game_id, round_id, match_id, player_id, dart_number, segment, multiplier, points) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (game_id, round_id, match_id, player_id,
             i + 1, d["segment"], d["multiplier"], d["points"])
        )
    db.commit()

    # ── Check win conditions ─────────────────────────────────────────
    winner_id       = None
    game_over       = False
    tiebreak_needed = False

    if is_shanghai:
        # Instant win — Shanghai on any round
        winner_id = player_id
        game_over = True

    else:
        # Check if all players have submitted this round
        cursor.execute(
            "SELECT COUNT(*) AS cnt FROM shanghai_rounds "
            "WHERE game_id = %s AND round_number = %s AND submitted = 1",
            (game_id, round_number)
        )
        submitted_count = cursor.fetchone()["cnt"]

        if submitted_count >= len(player_ids):
            # All done this round — check if game is over
            if round_number == 0:
                # Tiebreak round complete — determine winner
                cursor.execute(
                    "SELECT player_id, score FROM shanghai_rounds "
                    "WHERE game_id = %s AND round_number = 0 AND submitted = 1",
                    (game_id,)
                )
                tb_scores = {r["player_id"]: r["score"] for r in cursor.fetchall()}
                tb_winner = _check_tie_winner(tb_scores, tb_scores)
                if tb_winner:
                    winner_id = tb_winner
                    game_over = True
                else:
                    # Still tied — another tiebreak round needed
                    # Reset tiebreak rounds so players throw again
                    cursor.execute(
                        "DELETE FROM shanghai_throws WHERE game_id = %s AND round_id IN "
                        "(SELECT id FROM shanghai_rounds WHERE game_id = %s AND round_number = 0)",
                        (game_id, game_id)
                    )
                    cursor.execute(
                        "DELETE FROM shanghai_rounds "
                        "WHERE game_id = %s AND round_number = 0",
                        (game_id,)
                    )
                    db.commit()
                    # tiebreak stays active
            elif round_number >= game["num_rounds"]:
                # Final round complete — check scores
                cursor.execute(
                    "SELECT player_id, SUM(score) AS total "
                    "FROM shanghai_rounds "
                    "WHERE game_id = %s AND submitted = 1 AND round_number > 0 "
                    "GROUP BY player_id",
                    (game_id,)
                )
                totals = {r["player_id"]: r["total"] for r in cursor.fetchall()}
                max_score = max(totals.values()) if totals else 0
                leaders   = [pid for pid, s in totals.items() if s == max_score]

                if len(leaders) == 1:
                    winner_id = leaders[0]
                    game_over = True
                else:
                    # Tie — enter tiebreak
                    tiebreak_needed = True
                    cursor.execute(
                        "UPDATE shanghai_games SET tiebreak = 1 WHERE id = %s",
                        (game_id,)
                    )
                    db.commit()

    if game_over:
        cursor.execute(
            "UPDATE matches SET status = 'complete', winner_id = %s, ended_at = NOW() "
            "WHERE id = %s",
            (winner_id, match_id)
        )
        cursor.execute(
            "UPDATE shanghai_games SET status = 'complete', winner_id = %s, ended_at = NOW() "
            "WHERE id = %s",
            (winner_id, game_id)
        )
        db.commit()

    state = _get_state(db, match_id)
    state["round_result"] = {
        "player_id":    player_id,
        "round_number": round_number,
        "score":        round_score,
        "is_shanghai":  is_shanghai,
        "darts":        dart_records,
        "tiebreak":     tiebreak_needed,
    }
    return jsonify(state), 200


@shanghai_bp.route("/shanghai/matches/<int:match_id>/restart", methods=["POST"])
def restart_shanghai_match(match_id):
    """Restart a Shanghai match — wipe all rounds/throws and reset to fresh state."""
    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, status FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404
    if match["status"] not in ("active", "cancelled"):
        return jsonify({"error": "Cannot restart a completed match"}), 400

    # Get player list
    cursor.execute(
        "SELECT player_id FROM match_players WHERE match_id = %s ORDER BY turn_order ASC",
        (match_id,)
    )
    player_ids = [r["player_id"] for r in cursor.fetchall()]

    # Get the shanghai_game record
    cursor.execute(
        "SELECT id, num_rounds FROM shanghai_games WHERE match_id = %s",
        (match_id,)
    )
    game = cursor.fetchone()
    if not game:
        return jsonify({"error": "Shanghai game record not found"}), 404

    game_id = game["id"]

    # Wipe all throws and rounds
    cursor.execute("DELETE FROM shanghai_throws WHERE game_id = %s", (game_id,))
    cursor.execute("DELETE FROM shanghai_rounds WHERE game_id = %s", (game_id,))

    # Reset game status
    cursor.execute(
        "UPDATE shanghai_games SET status = 'active', winner_id = NULL, tiebreak = 0 WHERE id = %s",
        (game_id,)
    )

    # Reset match
    cursor.execute(
        "UPDATE matches SET status = 'active', winner_id = NULL, ended_at = NULL WHERE id = %s",
        (match_id,)
    )

    db.commit()
    return jsonify({
        "match_id":   match_id,
        "game_id":    game_id,
        "num_rounds": game["num_rounds"],
        "player_ids": player_ids,
    }), 200


@shanghai_bp.route("/shanghai/matches/<int:match_id>/end", methods=["POST"])
def end_shanghai_match(match_id):
    """Abandon a Shanghai match."""
    db     = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE matches SET status = 'cancelled', ended_at = NOW() WHERE id = %s",
        (match_id,)
    )
    cursor.execute(
        "UPDATE shanghai_games SET status = 'cancelled', ended_at = NOW() "
        "WHERE match_id = %s",
        (match_id,)
    )
    db.commit()
    return jsonify({"status": "cancelled"}), 200