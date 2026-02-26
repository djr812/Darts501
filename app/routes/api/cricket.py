"""
app/routes/api/cricket.py
--------------------------
Cricket darts game endpoints.

POST /api/cricket/matches           — create a new cricket match
GET  /api/cricket/matches/<id>      — get full game state
POST /api/cricket/matches/<id>/throw — record one dart
POST /api/cricket/matches/<id>/undo  — undo last dart
POST /api/cricket/matches/<id>/end   — abandon / end match

Cricket numbers: 15, 16, 17, 18, 19, 20, 25 (Bull)
  - 3 marks closes a number
  - Once a player has 3 marks (closed) and an opponent is still open,
    additional hits score points (single=face value, double=2x, triple=3x)
  - Outer Bull (25pts) = 1 mark, Inner Bull (50pts) = 2 marks
  - Win condition: all 7 numbers closed AND points >= all opponents
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

cricket_bp = Blueprint("cricket", __name__)

CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25]   # display order


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _init_cricket_state(db, match_id, player_ids):
    """Seed cricket_marks and cricket_scores rows for a new match."""
    cursor = db.cursor()
    for pid in player_ids:
        for num in CRICKET_NUMBERS:
            cursor.execute(
                "INSERT INTO cricket_marks (match_id, player_id, number, marks) "
                "VALUES (%s, %s, %s, 0)",
                (match_id, pid, num)
            )
        cursor.execute(
            "INSERT INTO cricket_scores (match_id, player_id, points) "
            "VALUES (%s, %s, 0)",
            (match_id, pid)
        )
    db.commit()


def _get_state(db, match_id):
    """Return full game state dict for a cricket match."""
    cursor = db.cursor()

    # Match + players
    cursor.execute(
        "SELECT id, status, winner_id FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()
    if not match:
        return None

    cursor.execute(
        "SELECT p.id, p.name FROM match_players mp "
        "JOIN players p ON p.id = mp.player_id "
        "WHERE mp.match_id = %s ORDER BY mp.turn_order",
        (match_id,)
    )
    players = cursor.fetchall()
    player_ids = [p["id"] for p in players]

    # Marks: { player_id: { number: marks } }
    cursor.execute(
        "SELECT player_id, number, marks FROM cricket_marks WHERE match_id = %s",
        (match_id,)
    )
    marks_raw = cursor.fetchall()
    marks = {pid: {} for pid in player_ids}
    for row in marks_raw:
        marks[row["player_id"]][row["number"]] = row["marks"]

    # Scores: { player_id: points }
    cursor.execute(
        "SELECT player_id, points FROM cricket_scores WHERE match_id = %s",
        (match_id,)
    )
    scores = {row["player_id"]: row["points"] for row in cursor.fetchall()}

    # Current turn info from cricket_throws
    cursor.execute(
        "SELECT MAX(turn_number) AS max_turn FROM cricket_throws WHERE match_id = %s",
        (match_id,)
    )
    row = cursor.fetchone()
    max_turn = row["max_turn"] or 1

    cursor.execute(
        "SELECT COUNT(*) AS darts_this_turn FROM cricket_throws "
        "WHERE match_id = %s AND turn_number = %s",
        (match_id, max_turn)
    )
    darts_this_turn = cursor.fetchone()["darts_this_turn"]

    # Which player's turn:
    # turn_number 1 = player index 0, turn_number 2 = player index 1, etc.
    # If the current turn has 3 darts, the NEXT turn belongs to the next player.
    n_players = len(player_ids)
    if darts_this_turn >= 3:
        # Current turn is complete — next turn number determines next player
        effective_turn = max_turn + 1
    else:
        effective_turn = max_turn
    current_player_index = (effective_turn - 1) % n_players
    current_player_id = player_ids[current_player_index]

    return {
        "match_id":             match_id,
        "status":               match["status"],
        "winner_id":            match["winner_id"],
        "players":              players,
        "marks":                marks,
        "scores":               scores,
        "current_player_id":    current_player_id,
        "current_turn_number":  max_turn,
        "darts_this_turn":      darts_this_turn,
    }


def _check_winner(db, match_id, player_ids, marks, scores):
    """
    Return winner player_id if someone has won, else None.
    Win = all 7 numbers closed AND points >= every opponent.
    """
    for pid in player_ids:
        player_marks = marks.get(pid, {})
        all_closed = all(player_marks.get(n, 0) >= 3 for n in CRICKET_NUMBERS)
        if not all_closed:
            continue
        my_score = scores.get(pid, 0)
        if all(my_score >= scores.get(opp, 0) for opp in player_ids if opp != pid):
            return pid
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@cricket_bp.route("/cricket/matches", methods=["POST"])
def create_cricket_match():
    """
    Create a new cricket match.
    Body: { player_ids: [int, ...] }   (2–4 players, already resolved)
    Returns: full game state
    """
    data       = request.get_json(force=True)
    player_ids = data.get("player_ids", [])

    if not (2 <= len(player_ids) <= 4):
        return jsonify({"error": "Cricket requires 2–4 players"}), 400

    db     = get_db()
    cursor = db.cursor()

    # Create match record
    cursor.execute(
        "INSERT INTO matches (game_type, legs_to_win, sets_to_win, legs_per_set, session_type, status) "
        "VALUES ('cricket', 1, 1, 1, 'match', 'active')",
    )
    match_id = cursor.lastrowid

    # Register players with turn order
    for i, pid in enumerate(player_ids):
        cursor.execute(
            "INSERT INTO match_players (match_id, player_id, turn_order) VALUES (%s, %s, %s)",
            (match_id, pid, i)
        )

    db.commit()
    _init_cricket_state(db, match_id, player_ids)

    state = _get_state(db, match_id)
    return jsonify(state), 201


@cricket_bp.route("/cricket/matches/<int:match_id>", methods=["GET"])
def get_cricket_match(match_id):
    db    = get_db()
    state = _get_state(db, match_id)
    if not state:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(state), 200


@cricket_bp.route("/cricket/matches/<int:match_id>/throw", methods=["POST"])
def record_cricket_throw(match_id):
    """
    Record one dart throw.
    Body: { player_id, segment, multiplier }
      segment:    15-20, 25, or 0 (miss)
      multiplier: 1, 2, or 3
    Returns: updated game state
    """
    data       = request.get_json(force=True)
    player_id  = data["player_id"]
    segment    = int(data["segment"])
    multiplier = int(data.get("multiplier", 1))

    db     = get_db()
    cursor = db.cursor()

    # Validate match exists and is active
    cursor.execute("SELECT status FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()
    if not match or match["status"] != "active":
        return jsonify({"error": "Match not active"}), 400

    # Get player list
    cursor.execute(
        "SELECT p.id FROM match_players mp JOIN players p ON p.id = mp.player_id "
        "WHERE mp.match_id = %s ORDER BY mp.turn_order",
        (match_id,)
    )
    player_ids = [r["id"] for r in cursor.fetchall()]

    # Current turn number and darts thrown
    cursor.execute(
        "SELECT MAX(turn_number) AS max_turn FROM cricket_throws WHERE match_id = %s",
        (match_id,)
    )
    row      = cursor.fetchone()
    max_turn = row["max_turn"] or 1

    cursor.execute(
        "SELECT COUNT(*) AS cnt FROM cricket_throws WHERE match_id = %s AND turn_number = %s",
        (match_id, max_turn)
    )
    darts_this_turn = cursor.fetchone()["cnt"]

    # Advance turn if previous turn was complete
    if darts_this_turn >= 3:
        max_turn        += 1
        darts_this_turn  = 0

    dart_number = darts_this_turn + 1

    # ── Scoring logic ──
    marks_added   = 0
    points_scored = 0

    if segment in CRICKET_NUMBERS and segment != 0:
        # How many marks does this player already have on this number?
        cursor.execute(
            "SELECT marks FROM cricket_marks WHERE match_id = %s AND player_id = %s AND number = %s",
            (match_id, player_id, segment)
        )
        row          = cursor.fetchone()
        current_marks = row["marks"] if row else 0

        # Bull: outer=1 mark (25pts), inner=2 marks (50pts)
        dart_marks = multiplier  # single=1, double=2, triple=3

        if current_marks < 3:
            # Still closing — some or all marks go toward closing
            marks_needed = 3 - current_marks
            marks_to_close = min(dart_marks, marks_needed)
            overflow       = dart_marks - marks_to_close
            marks_added    = marks_to_close
            new_marks      = current_marks + marks_to_close

            # Update marks
            cursor.execute(
                "UPDATE cricket_marks SET marks = %s "
                "WHERE match_id = %s AND player_id = %s AND number = %s",
                (new_marks, match_id, player_id, segment)
            )

            # Any overflow marks score points if opponents are still open
            if overflow > 0 and new_marks >= 3:
                # Check if any opponent is open on this number
                cursor.execute(
                    "SELECT player_id, marks FROM cricket_marks "
                    "WHERE match_id = %s AND number = %s AND player_id != %s",
                    (match_id, segment, player_id)
                )
                opponent_marks = cursor.fetchall()
                any_open = any(r["marks"] < 3 for r in opponent_marks)
                if any_open:
                    face_value    = 25 if segment == 25 else segment
                    points_scored = face_value * overflow
        else:
            # Already closed — score points if any opponent still open
            cursor.execute(
                "SELECT player_id, marks FROM cricket_marks "
                "WHERE match_id = %s AND number = %s AND player_id != %s",
                (match_id, segment, player_id)
            )
            opponent_marks = cursor.fetchall()
            any_open = any(r["marks"] < 3 for r in opponent_marks)
            if any_open:
                face_value    = 25 if segment == 25 else segment
                points_scored = face_value * dart_marks

        # Add points
        if points_scored > 0:
            cursor.execute(
                "UPDATE cricket_scores SET points = points + %s "
                "WHERE match_id = %s AND player_id = %s",
                (points_scored, match_id, player_id)
            )

    # Record throw
    cursor.execute(
        "INSERT INTO cricket_throws "
        "(match_id, player_id, turn_number, dart_number, segment, multiplier, marks_added, points_scored) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (match_id, player_id, max_turn, dart_number, segment, multiplier, marks_added, points_scored)
    )
    db.commit()

    # Re-fetch full state to check for winner
    state = _get_state(db, match_id)
    winner_id = _check_winner(
        db, match_id,
        [p["id"] for p in state["players"]],
        state["marks"],
        state["scores"]
    )
    if winner_id:
        cursor.execute(
            "UPDATE matches SET status = 'complete', winner_id = %s, ended_at = NOW() "
            "WHERE id = %s",
            (winner_id, match_id)
        )
        db.commit()
        state["status"]    = "complete"
        state["winner_id"] = winner_id

    state["last_throw"] = {
        "segment":      segment,
        "multiplier":   multiplier,
        "marks_added":  marks_added,
        "points_scored": points_scored,
    }
    return jsonify(state), 200


@cricket_bp.route("/cricket/matches/<int:match_id>/undo", methods=["POST"])
def undo_cricket_throw(match_id):
    """Undo the most recent dart throw."""
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT status FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404

    # Find the last throw
    cursor.execute(
        "SELECT * FROM cricket_throws WHERE match_id = %s "
        "ORDER BY turn_number DESC, dart_number DESC LIMIT 1",
        (match_id,)
    )
    last = cursor.fetchone()
    if not last:
        return jsonify({"error": "Nothing to undo"}), 400

    # Reverse marks
    if last["marks_added"] > 0:
        cursor.execute(
            "UPDATE cricket_marks SET marks = GREATEST(0, marks - %s) "
            "WHERE match_id = %s AND player_id = %s AND number = %s",
            (last["marks_added"], match_id, last["player_id"], last["segment"])
        )

    # Reverse points
    if last["points_scored"] > 0:
        cursor.execute(
            "UPDATE cricket_scores SET points = GREATEST(0, points - %s) "
            "WHERE match_id = %s AND player_id = %s",
            (last["points_scored"], match_id, last["player_id"])
        )

    # Delete the throw record
    cursor.execute("DELETE FROM cricket_throws WHERE id = %s", (last["id"],))

    # If match was marked complete, reopen it
    if match["status"] == "complete":
        cursor.execute(
            "UPDATE matches SET status = 'active', winner_id = NULL, ended_at = NULL "
            "WHERE id = %s",
            (match_id,)
        )

    db.commit()
    return jsonify(_get_state(db, match_id)), 200


@cricket_bp.route("/cricket/matches/<int:match_id>/end", methods=["POST"])
def end_cricket_match(match_id):
    """Abandon a cricket match."""
    db     = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE matches SET status = 'cancelled', ended_at = NOW() WHERE id = %s",
        (match_id,)
    )
    db.commit()
    return jsonify({"status": "cancelled"}), 200