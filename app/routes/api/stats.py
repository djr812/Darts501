"""
app/routes/api/stats.py
------------------------
Player statistics endpoint.

GET /api/players/<id>/stats
    Query params:
        game_type  -- '501' | '201' | 'all'  (default: 'all')
        double_out -- '1' | '0' | 'all'       (default: 'all')

Returns a single JSON object with all computed stats for that player.
"""

from flask import Blueprint, request, jsonify
from app.models.db import get_db

stats_bp = Blueprint("stats", __name__)


def _scope_clauses(game_type: str, double_out: str) -> tuple[str, list]:
    """
    Build extra WHERE clauses and params for the leg-scope filters.
    Returns (extra_sql, params_list).
    """
    clauses = []
    params  = []

    if game_type and game_type != 'all':
        clauses.append("l.game_type = %s")
        params.append(game_type)

    if double_out and double_out != 'all':
        clauses.append("l.double_out = %s")
        params.append(1 if double_out == '1' else 0)

    sql = (" AND " + " AND ".join(clauses)) if clauses else ""
    return sql, params


@stats_bp.route("/players/<int:player_id>/stats", methods=["GET"])
def get_player_stats(player_id):
    db     = get_db()
    cursor = db.cursor()

    # Verify player exists and is not CPU
    cursor.execute("SELECT id, name FROM players WHERE id = %s AND is_active = TRUE", (player_id,))
    player = cursor.fetchone()
    if not player:
        return jsonify({"error": "Player not found"}), 404
    if player["name"] == "CPU":
        return jsonify({"error": "Stats not available for CPU player"}), 400

    game_type  = request.args.get("game_type",  "all")
    double_out = request.args.get("double_out", "all")

    scope_sql, scope_params = _scope_clauses(game_type, double_out)

    # ------------------------------------------------------------------
    # 1. Matches / Sets / Legs won
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            COUNT(DISTINCT mp.match_id)          AS matches_played,
            SUM(CASE WHEN m.winner_id = %s THEN 1 ELSE 0 END) AS matches_won,
            COALESCE(SUM(mp.sets_won), 0)        AS sets_won,
            COALESCE(SUM(mp.legs_won), 0)        AS legs_won_tally
        FROM match_players mp
        JOIN matches m ON m.id = mp.match_id
        WHERE mp.player_id = %s
          AND m.status = 'complete'
    """, (player_id, player_id))
    record_row = cursor.fetchone()

    # Total legs won = count legs where this player is winner
    cursor.execute("""
        SELECT COUNT(*) AS legs_won
        FROM legs l
        WHERE l.winner_id = %s
          AND l.status = 'complete'
    """ + scope_sql.replace("l.", "l."),
    [player_id] + scope_params)
    legs_won_row = cursor.fetchone()

    # ------------------------------------------------------------------
    # 2. Turn-level stats (3-dart average, ton/ton40/180 counts, busts)
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            COUNT(*)                                        AS total_turns,
            SUM(t.darts_thrown)                            AS total_darts,
            SUM(t.score_before - t.score_after)            AS total_points_scored,
            SUM(CASE WHEN t.is_bust = 1 THEN 1 ELSE 0 END) AS total_busts
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust = 0
    """ + scope_sql,
    [player_id] + scope_params)
    turn_totals = cursor.fetchone()

    # 3-dart average = total_points / (total_darts / 3)
    total_darts  = int(turn_totals["total_darts"] or 0)
    total_points = int(turn_totals["total_points_scored"] or 0)
    three_dart_avg = round((total_points / total_darts) * 3, 2) if total_darts else 0.0

    # Bust count (all turns including bust ones)
    cursor.execute("""
        SELECT COUNT(*) AS busts
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.is_bust = 1
    """ + scope_sql,
    [player_id] + scope_params)
    bust_row = cursor.fetchone()

    # Ton, ton-40, 180 counts (turn scores: score_before - score_after)
    cursor.execute("""
        SELECT
            SUM(CASE WHEN (t.score_before - t.score_after) >= 100
                      AND (t.score_before - t.score_after) < 140 THEN 1 ELSE 0 END) AS tons,
            SUM(CASE WHEN (t.score_before - t.score_after) >= 140
                      AND (t.score_before - t.score_after) < 180 THEN 1 ELSE 0 END) AS ton_forties,
            SUM(CASE WHEN (t.score_before - t.score_after) = 180 THEN 1 ELSE 0 END) AS one_eighties
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust = 0
    """ + scope_sql,
    [player_id] + scope_params)
    milestones = cursor.fetchone()

    # Highest and lowest single-turn score (excluding busts, must be ≥ 1 dart)
    cursor.execute("""
        SELECT
            MAX(t.score_before - t.score_after) AS highest_turn,
            MIN(t.score_before - t.score_after) AS lowest_turn
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust = 0
          AND t.darts_thrown > 0
    """ + scope_sql,
    [player_id] + scope_params)
    turn_extremes = cursor.fetchone()

    # ------------------------------------------------------------------
    # 3. First-9 average
    #    Average points from the first 3 turns of each leg (turns 1,2,3
    #    belonging to this player — identified by ordering turns within leg)
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT AVG(turn_score) AS first9_avg
        FROM (
            SELECT
                t.leg_id,
                (t.score_before - t.score_after) AS turn_score,
                ROW_NUMBER() OVER (PARTITION BY t.leg_id ORDER BY t.turn_number) AS rn
            FROM turns t
            JOIN legs l ON l.id = t.leg_id
            WHERE t.player_id = %s
              AND t.score_after IS NOT NULL
              AND t.is_bust = 0
    """ + scope_sql + """
        ) ranked
        WHERE rn <= 3
    """,
    [player_id] + scope_params)
    first9_row = cursor.fetchone()
    first9_avg = round(float(first9_row["first9_avg"] or 0) * 3, 2)

    # ------------------------------------------------------------------
    # 4. Checkout stats
    # ------------------------------------------------------------------

    # Checkout percentage: legs_won / legs_where_player_had_a_checkout_attempt
    # A checkout attempt = a turn where score_before <= 170 and not a guaranteed bust zone
    cursor.execute("""
        SELECT
            COUNT(DISTINCT t.leg_id) AS checkout_attempts
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.score_before <= 170
          AND t.score_before >= 2
          AND l.status = 'complete'
    """ + scope_sql,
    [player_id] + scope_params)
    checkout_attempts_row = cursor.fetchone()

    # Best checkout = highest score checked out on (is_checkout = 1 on the turn)
    cursor.execute("""
        SELECT MAX(t.score_before) AS best_checkout
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.is_checkout = 1
    """ + scope_sql,
    [player_id] + scope_params)
    best_checkout_row = cursor.fetchone()

    # Average darts to checkout (legs this player won)
    cursor.execute("""
        SELECT AVG(dart_count) AS avg_darts_checkout
        FROM (
            SELECT l.id, SUM(t.darts_thrown) AS dart_count
            FROM legs l
            JOIN turns t ON t.leg_id = l.id
            WHERE l.winner_id = %s
              AND l.status = 'complete'
              AND t.player_id = %s
    """ + scope_sql + """
            GROUP BY l.id
        ) per_leg
    """,
    [player_id, player_id] + scope_params)
    avg_darts_row = cursor.fetchone()

    # ------------------------------------------------------------------
    # 5. Best checkout (double out) and best checkout (single out) separately
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT MAX(t.score_before) AS best_double_checkout
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.is_checkout = 1
          AND l.double_out = 1
    """ + scope_sql.replace("AND l.double_out", "AND 1=1 AND l.double_out" if "double_out" not in scope_sql else "AND 1=1"),
    [player_id] + scope_params)
    best_double_co = cursor.fetchone()

    cursor.execute("""
        SELECT MAX(t.score_before) AS best_single_checkout
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.is_checkout = 1
          AND l.double_out = 0
    """,
    [player_id])
    best_single_co = cursor.fetchone()

    # ------------------------------------------------------------------
    # 6. Favourite double (most common checkout segment when double_out)
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            th.segment,
            COUNT(*) AS times
        FROM throws th
        JOIN turns t  ON t.id  = th.turn_id
        JOIN legs  l  ON l.id  = t.leg_id
        WHERE t.player_id   = %s
          AND th.is_checkout = 1
          AND th.multiplier  = 2
          AND l.double_out   = 1
    """ + scope_sql + """
        GROUP BY th.segment
        ORDER BY times DESC
        LIMIT 1
    """,
    [player_id] + scope_params)
    fav_double_row = cursor.fetchone()

    fav_double = None
    if fav_double_row:
        seg = fav_double_row["segment"]
        fav_double = {
            "notation": "DB" if seg == 25 else f"D{seg}",
            "times":    fav_double_row["times"],
        }

    # ------------------------------------------------------------------
    # 7. Highest and lowest single dart scores (individual throws)
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT MAX(th.points) AS highest_dart, MIN(th.points) AS lowest_dart
        FROM throws th
        JOIN turns t ON t.id = th.turn_id
        JOIN legs  l ON l.id = t.leg_id
        WHERE t.player_id = %s
    """ + scope_sql,
    [player_id] + scope_params)
    dart_extremes = cursor.fetchone()

    # ------------------------------------------------------------------
    # 8. Win rates
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT COUNT(*) AS legs_played
        FROM legs l
        JOIN turns t ON t.leg_id = l.id
        WHERE t.player_id = %s
          AND l.status = 'complete'
    """ + scope_sql,
    [player_id] + scope_params)
    legs_played_row = cursor.fetchone()

    legs_won   = int(legs_won_row["legs_won"] or 0)
    legs_played = int(legs_played_row["legs_played"] or 0)
    leg_win_rate = round((legs_won / legs_played * 100), 1) if legs_played else 0.0

    matches_played = int(record_row["matches_played"] or 0)
    matches_won    = int(record_row["matches_won"] or 0)
    match_win_rate = round((matches_won / matches_played * 100), 1) if matches_played else 0.0

    # ------------------------------------------------------------------
    # Assemble response
    # ------------------------------------------------------------------
    return jsonify({
        "player": {
            "id":   player_id,
            "name": player["name"],
        },
        "scope": {
            "game_type":  game_type,
            "double_out": double_out,
        },
        "records": {
            "matches_played":  matches_played,
            "matches_won":     matches_won,
            "match_win_rate":  match_win_rate,
            "sets_won":        int(record_row["sets_won"] or 0),
            "legs_won":        legs_won,
            "legs_played":     legs_played,
            "leg_win_rate":    leg_win_rate,
        },
        "scoring": {
            "three_dart_avg":   three_dart_avg,
            "first9_avg":       first9_avg,
            "highest_turn":     int(turn_extremes["highest_turn"] or 0),
            "lowest_turn":      int(turn_extremes["lowest_turn"] or 0),
            "highest_dart":     int(dart_extremes["highest_dart"] or 0),
            "total_darts":      total_darts,
            "total_turns":      int(turn_totals["total_turns"] or 0),
            "tons":             int(milestones["tons"] or 0),
            "ton_forties":      int(milestones["ton_forties"] or 0),
            "one_eighties":     int(milestones["one_eighties"] or 0),
            "busts":            int(bust_row["busts"] or 0),
        },
        "checkout": {
            "best_checkout":        int(best_checkout_row["best_checkout"] or 0),
            "best_double_checkout": int(best_double_co["best_double_checkout"] or 0),
            "best_single_checkout": int(best_single_co["best_single_checkout"] or 0),
            "avg_darts_to_checkout": round(float(avg_darts_row["avg_darts_checkout"] or 0), 1),
            "checkout_attempts":    int(checkout_attempts_row["checkout_attempts"] or 0),
            "favourite_double":     fav_double,
        },
    }), 200


@stats_bp.route("/players/<int:player_id>/stats/trend", methods=["GET"])
def get_player_trend(player_id):
    """
    Return per-match 3-dart averages for a player, most recent first.

    Query params:
        limit      -- 10 | 20 | 50  (default: 20)
        game_type  -- '501' | '201' | 'all'  (default: 'all')
        double_out -- '1' | '0' | 'all'      (default: 'all')

    Returns:
        { "matches": [ { "match_id", "date", "avg", "darts", "opponent" }, ... ] }
        Ordered oldest -> newest so the chart renders left-to-right.
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id, name FROM players WHERE id = %s AND is_active = TRUE", (player_id,))
    if not cursor.fetchone():
        return jsonify({"error": "Player not found"}), 404

    limit      = int(request.args.get("limit", 20))
    game_type  = request.args.get("game_type",  "all")
    double_out = request.args.get("double_out", "all")

    if limit not in (10, 20, 50):
        limit = 20

    scope_sql, scope_params = _scope_clauses(game_type, double_out)

    # Exclude practice sessions
    practice_clause = " AND m.session_type != 'practice'"

    # Per-match 3-dart average: sum points / sum darts * 3, grouped by match
    # Build SQL without % formatting to avoid conflicts with %s placeholders
    trend_sql = (
        """
        SELECT
            m.id                                AS match_id,
            DATE(m.ended_at)                    AS match_date,
            SUM(t.score_before - t.score_after) AS total_points,
            SUM(t.darts_thrown)                 AS total_darts
        FROM turns t
        JOIN legs    l  ON l.id  = t.leg_id
        JOIN matches m  ON m.id  = l.match_id
        WHERE t.player_id   = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust      = 0
          AND m.status       = 'complete'
          AND m.session_type != 'practice'
        """
        + scope_sql +
        """
        GROUP BY m.id, m.ended_at
        ORDER BY m.ended_at DESC
        LIMIT """
        + str(limit)
    )
    cursor.execute(trend_sql, [player_id] + scope_params)

    rows = cursor.fetchall()

    matches = []
    for row in reversed(rows):   # oldest first for chart L->R
        darts  = int(row["total_darts"] or 0)
        points = int(row["total_points"] or 0)
        avg    = round((points / darts) * 3, 2) if darts else 0.0

        # Fetch opponent names for this match
        cursor.execute("""
            SELECT GROUP_CONCAT(p.name SEPARATOR ', ') AS opponents
            FROM match_players mp
            JOIN players p ON p.id = mp.player_id
            WHERE mp.match_id = %s AND mp.player_id != %s
        """, (row["match_id"], player_id))
        opp_row = cursor.fetchone()

        matches.append({
            "match_id": row["match_id"],
            "date":     str(row["match_date"]),
            "avg":      avg,
            "darts":    darts,
            "opponent": (opp_row["opponents"] if opp_row and opp_row["opponents"] else "—"),
        })

    return jsonify({"matches": matches}), 200


# ─────────────────────────────────────────────────────────────────────────────
# 30-day daily average trend (all game types + practice)
# ─────────────────────────────────────────────────────────────────────────────

@stats_bp.route("/players/<int:player_id>/stats/daily_trend", methods=["GET"])
def get_player_daily_trend(player_id):
    """
    Return daily 3-dart averages for the past 30 calendar days.

    Aggregates darts from ALL game types (01 games via turns/legs,
    newer games via their own throw tables, practice via practice_sessions).

    Returns:
        { "days": [ { "date": "YYYY-MM-DD", "avg": 54.3, "darts": 72, "sessions": 2 }, ... ] }
        Only days with at least one dart thrown are included.
        Ordered oldest -> newest.
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM players WHERE id = %s AND is_active = TRUE", (player_id,))
    if not cursor.fetchone():
        return jsonify({"error": "Player not found"}), 404

    # Collect (date, points, darts) tuples from every source, then aggregate in Python
    from collections import defaultdict
    from datetime import date, timedelta

    day_points = defaultdict(int)
    day_darts  = defaultdict(int)
    day_sessions = defaultdict(int)

    # ── 501/201 via turns + legs ──────────────────────────────────────────────
    # Use turns.created_at so each turn is dated when it was actually played.
    cursor.execute("""
        SELECT
            DATE(t.created_at)                  AS day,
            SUM(t.score_before - t.score_after) AS pts,
            SUM(t.darts_thrown)                 AS darts,
            COUNT(DISTINCT m.id)                AS sessions
        FROM turns t
        JOIN legs    l ON l.id  = t.leg_id
        JOIN matches m ON m.id  = l.match_id
        WHERE t.player_id    = %s
          AND t.score_after  IS NOT NULL
          AND t.is_bust       = 0
          AND m.status        = 'complete'
          AND m.session_type != 'practice'
          AND t.created_at   >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(t.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]      or 0)
        day_darts[d]    += int(r["darts"]    or 0)
        day_sessions[d] += int(r["sessions"] or 0)

    # ── Race to 1000 ──────────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(rt.created_at) AS day, COUNT(*) AS darts, COALESCE(SUM(rt.points),0) AS pts,
               COUNT(DISTINCT rt.match_id) AS sessions
        FROM race1000_throws rt
        WHERE rt.player_id = %s
          AND rt.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(rt.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]   or 0)
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Nine Lives ────────────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(nt.created_at) AS day, COUNT(*) AS darts
        FROM nine_lives_throws nt
        WHERE nt.player_id = %s
          AND nt.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(nt.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        # Nine Lives darts don't have meaningful points for a 3-dart avg,
        # but we count darts so the denominator stays honest — points stay 0
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Killer ────────────────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(kt.created_at) AS day, COUNT(*) AS darts
        FROM killer_throws kt
        WHERE kt.player_id = %s
          AND kt.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(kt.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Bermuda Triangle ──────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(bt.created_at) AS day, COUNT(*) AS darts, COALESCE(SUM(bt.points),0) AS pts
        FROM bermuda_throws bt
        WHERE bt.player_id = %s
          AND bt.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(bt.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]   or 0)
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Baseball ──────────────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(bt.created_at) AS day, COUNT(*) AS darts, COALESCE(SUM(bt.runs),0) AS pts
        FROM baseball_throws bt
        WHERE bt.player_id = %s
          AND bt.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(bt.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]   or 0)
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Shanghai ──────────────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(st.created_at) AS day,
               COUNT(*) AS darts, COALESCE(SUM(st.points),0) AS pts
        FROM shanghai_throws st
        WHERE st.player_id = %s
          AND st.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(st.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]   or 0)
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Cricket ───────────────────────────────────────────────────────────────
    cursor.execute("""
        SELECT DATE(ct.created_at) AS day,
               COUNT(*) AS darts, COALESCE(SUM(ct.points_scored),0) AS pts
        FROM cricket_throws ct
        WHERE ct.player_id = %s
          AND ct.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(ct.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]   or 0)
        day_darts[d]    += int(r["darts"] or 0)
        day_sessions[d] += 1

    # ── Practice (stored in turns/legs/matches with session_type='practice') ──
    # Use turns.created_at as the date — m.ended_at is unreliable for practice
    # (historical sessions were backfilled to NOW() and lack real timestamps).
    # Points from throws.points since turn score_before - score_after = 0 in practice.
    cursor.execute("""
        SELECT
            DATE(t.created_at)         AS day,
            COUNT(th.id)               AS darts,
            COALESCE(SUM(th.points),0) AS pts,
            COUNT(DISTINCT m.id)       AS sessions
        FROM throws th
        JOIN turns   t  ON t.id  = th.turn_id
        JOIN legs    l  ON l.id  = t.leg_id
        JOIN matches m  ON m.id  = l.match_id
        WHERE t.player_id    = %s
          AND m.session_type = 'practice'
          AND t.created_at  >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(t.created_at)
    """, (player_id,))
    for r in cursor.fetchall():
        d = str(r["day"])
        day_points[d]   += int(r["pts"]      or 0)
        day_darts[d]    += int(r["darts"]    or 0)
        day_sessions[d] += int(r["sessions"] or 0)

    # ── Build ordered output — only days with darts ───────────────────────────
    today    = date.today()
    cutoff   = today - timedelta(days=30)
    all_days = sorted(day_darts.keys())

    result = []
    for d in all_days:
        darts = day_darts[d]
        if darts == 0:
            continue
        pts = day_points[d]
        avg = round((pts / darts) * 3, 1) if darts else 0.0
        result.append({
            "date":     d,
            "avg":      avg,
            "darts":    darts,
            "sessions": day_sessions[d],
        })

    return jsonify({"days": result}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Heatmap
# ─────────────────────────────────────────────────────────────────────────────

@stats_bp.route("/players/<int:player_id>/stats/heatmap", methods=["GET"])
def get_player_heatmap(player_id):
    """
    Return hit counts per segment+multiplier for a player across all matches.

    Query params:
        game_type  -- '501' | '201' | 'all'  (default: 'all')
        double_out -- '1' | '0' | 'all'      (default: 'all')

    Returns:
        { "counts": { "S20": 12, "T20": 3, "D20": 1, "BULL": 2, "OUTER": 5, ... } }
        Keys: S<n>, D<n>, T<n> for numbers 1-20; BULL for inner, OUTER for outer bull
        Misses (segment=0) are excluded.
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM players WHERE id = %s AND is_active = TRUE", (player_id,))
    if not cursor.fetchone():
        return jsonify({"error": "Player not found"}), 404

    game_type  = request.args.get("game_type",  "all")
    double_out = request.args.get("double_out", "all")
    match_id   = request.args.get("match_id",   None)
    scope_sql, scope_params = _scope_clauses(game_type, double_out)

    # Optional single-match scope (used by practice summary modal)
    match_clause  = " AND m.id = %s" if match_id else ""
    match_params  = [int(match_id)] if match_id else []
    status_clause = "" if match_id else " AND m.status = 'complete'"

    heatmap_sql = (
        """
        SELECT
            th.segment,
            th.multiplier,
            COUNT(*) AS hits
        FROM throws th
        JOIN turns   t  ON t.id  = th.turn_id
        JOIN legs    l  ON l.id  = t.leg_id
        JOIN matches m  ON m.id  = l.match_id
        WHERE t.player_id  = %s
          AND th.segment   != 0
        """
        + status_clause
        + match_clause
        + scope_sql +
        """
        GROUP BY th.segment, th.multiplier
        """
    )
    cursor.execute(heatmap_sql, [player_id] + match_params + scope_params)
    rows = cursor.fetchall()

    counts = {}
    for row in rows:
        seg = row["segment"]
        mul = row["multiplier"]
        hits = row["hits"]

        if seg == 25:
            key = "BULL" if mul == 2 else "OUTER"
        else:
            prefix = "T" if mul == 3 else "D" if mul == 2 else "S"
            key = prefix + str(seg)

        counts[key] = hits

    return jsonify({"counts": counts}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Session history list
# ─────────────────────────────────────────────────────────────────────────────

@stats_bp.route("/players/<int:player_id>/history", methods=["GET"])
def get_player_history(player_id):
    """
    Return a paginated list of matches (excluding practice sessions) for a player.

    Query params:
        offset  -- pagination offset (default 0)
        limit   -- page size (default 20, max 50)

    Returns:
        { "sessions": [ { match_id, date, type, game_type, opponent,
                          result, player_avg, duration_darts } ] }
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id FROM players WHERE id = %s AND is_active = TRUE",
        (player_id,)
    )
    if not cursor.fetchone():
        return jsonify({"error": "Player not found"}), 404

    offset = max(0, int(request.args.get("offset", 0)))
    limit  = min(50, max(1, int(request.args.get("limit", 20))))

    # Pull ended_at and winner_id from the game-specific tables where needed,
    # since newer games (race1000, nine_lives, killer, bermuda, baseball) only
    # write those fields to their own tables and not back to matches.
    cursor.execute("""
        SELECT
            m.id            AS match_id,
            m.game_type,
            m.session_type,
            m.cpu_difficulty,
            COALESCE(m.ended_at,
                CASE m.game_type
                    WHEN 'race1000'   THEN (SELECT g.ended_at FROM race1000_games   g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'nine_lives' THEN (SELECT g.ended_at FROM nine_lives_games g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'killer'     THEN (SELECT g.ended_at FROM killer_games     g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'bermuda'    THEN (SELECT g.ended_at FROM bermuda_games    g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'baseball'   THEN (SELECT g.ended_at FROM baseball_games   g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'shanghai'   THEN (SELECT g.ended_at FROM shanghai_games   g WHERE g.match_id = m.id LIMIT 1)
                    ELSE NULL
                END
            ) AS ended_at,
            COALESCE(m.winner_id,
                CASE m.game_type
                    WHEN 'race1000'   THEN (SELECT g.winner_id FROM race1000_games   g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'nine_lives' THEN (SELECT g.winner_id FROM nine_lives_games g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'killer'     THEN (SELECT g.winner_id FROM killer_games     g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'bermuda'    THEN (SELECT g.winner_id FROM bermuda_games    g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'baseball'   THEN (SELECT g.winner_ids FROM baseball_games  g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'shanghai'   THEN (SELECT g.winner_id  FROM shanghai_games   g WHERE g.match_id = m.id LIMIT 1)
                    ELSE NULL
                END
            ) AS winner_id
        FROM matches m
        JOIN match_players mp ON mp.match_id = m.id AND mp.player_id = %s
        WHERE m.status = 'complete'
          AND m.session_type != 'practice'
        ORDER BY ended_at DESC
        LIMIT %s OFFSET %s
    """, (player_id, limit, offset))

    rows = cursor.fetchall()
    sessions = []

    for row in rows:
        # Opponent names
        cursor.execute("""
            SELECT p.name
            FROM match_players mp
            JOIN players p ON p.id = mp.player_id
            WHERE mp.match_id = %s AND mp.player_id != %s
        """, (row["match_id"], player_id))
        opp_rows  = cursor.fetchall()
        opponents = ', '.join(r["name"] for r in opp_rows) if opp_rows else "—"

        # Per-match darts thrown + display score — varies by game type
        game_type = row["game_type"]
        darts = 0
        avg   = "—"     # default: show — for avg on non-01 games
        score = None    # game-specific score shown instead of avg

        if game_type in ("501", "201"):
            cursor.execute("""
                SELECT
                    SUM(t.score_before - t.score_after) AS pts,
                    SUM(t.darts_thrown)                 AS darts
                FROM turns t
                JOIN legs l ON l.id = t.leg_id
                WHERE t.player_id  = %s
                  AND l.match_id   = %s
                  AND t.score_after IS NOT NULL
                  AND t.is_bust    = 0
            """, (player_id, row["match_id"]))
            r2    = cursor.fetchone()
            pts   = int(r2["pts"]   or 0)
            darts = int(r2["darts"] or 0)
            avg   = round((pts / darts) * 3, 1) if darts else 0.0

        elif game_type == "race1000":
            cursor.execute("""
                SELECT COUNT(*) AS darts, COALESCE(SUM(points),0) AS score
                FROM race1000_throws WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] or 0)
            score = int(r2["score"] or 0)

        elif game_type == "nine_lives":
            cursor.execute("""
                SELECT COUNT(*) AS darts FROM nine_lives_throws
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] or 0)
            cursor.execute("""
                SELECT lives FROM nine_lives_players
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            lrow  = cursor.fetchone()
            score = int(lrow["lives"]) if lrow else 0

        elif game_type == "killer":
            cursor.execute("""
                SELECT COUNT(*) AS darts FROM killer_throws
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] or 0)
            cursor.execute("""
                SELECT lives FROM killer_players
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            lrow  = cursor.fetchone()
            score = int(lrow["lives"]) if lrow else 0

        elif game_type == "bermuda":
            cursor.execute("""
                SELECT COUNT(*) AS darts FROM bermuda_throws
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] or 0)
            cursor.execute("""
                SELECT score FROM bermuda_players
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            srow  = cursor.fetchone()
            score = int(srow["score"]) if srow else 0

        elif game_type == "baseball":
            cursor.execute("""
                SELECT COUNT(*) AS darts FROM baseball_throws
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] or 0)
            cursor.execute("""
                SELECT COALESCE(SUM(runs),0) AS runs FROM baseball_innings
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            rrow  = cursor.fetchone()
            score = int(rrow["runs"]) if rrow else 0

        elif game_type == "shanghai":
            cursor.execute("""
                SELECT COUNT(*) AS darts, COALESCE(SUM(score),0) AS score
                FROM shanghai_rounds WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] * 3 or 0)   # each round = 3 darts
            score = int(r2["score"] or 0)

        elif game_type == "cricket":
            cursor.execute("""
                SELECT COUNT(*) AS darts FROM cricket_throws
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            r2    = cursor.fetchone()
            darts = int(r2["darts"] or 0)
            cursor.execute("""
                SELECT points FROM cricket_scores
                WHERE match_id=%s AND player_id=%s
            """, (row["match_id"], player_id))
            srow  = cursor.fetchone()
            score = int(srow["points"]) if srow else 0

        is_practice = row["session_type"] == "practice"
        if is_practice:
            result = "PRACTICE"
        else:
            w = row["winner_id"]
            if w is None:
                result = "—"
            elif str(player_id) in str(w).split(","):
                # Handles both single winner_id (int) and baseball's "1,2" winner_ids string
                result = "WIN"
            else:
                result = "LOSS"

        sessions.append({
            "match_id":    row["match_id"],
            "player_id":   player_id,
            "date":        str(row["ended_at"])[:10] if row["ended_at"] else "—",
            "game_type":   row["game_type"],
            "is_practice": is_practice,
            "opponent":    opponents,
            "cpu_difficulty": row["cpu_difficulty"] if row["cpu_difficulty"] else None,
            "result":      result,
            "avg":         avg,
            "score":       score,   # game-specific score (non-01 games); None for 01
            "darts":       darts,
        })

    return jsonify({"sessions": sessions}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Match / practice scorecard
# ─────────────────────────────────────────────────────────────────────────────

@stats_bp.route("/matches/<int:match_id>/scorecard", methods=["GET"])
def get_match_scorecard(match_id):
    """
    Return full turn-by-turn scorecard for a match.

    Returns:
      {
        match:   { id, game_type, session_type, ended_at, winner_id },
        players: [ { id, name } ],
        legs: [
          {
            leg_number, winner_id,
            turns: [
              {
                player_id, turn_number, score_before, score_after,
                darts_thrown, is_bust, is_checkout,
                throws: [ { dart_number, segment, multiplier, points, is_checkout } ]
              }
            ]
          }
        ]
      }
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, game_type, session_type, ended_at, winner_id FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404

    # Players
    cursor.execute("""
        SELECT p.id, p.name
        FROM match_players mp
        JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = %s
        ORDER BY mp.turn_order
    """, (match_id,))
    players = cursor.fetchall()

    # Legs
    cursor.execute("""
        SELECT id, leg_number, winner_id, starting_score
        FROM legs
        WHERE match_id = %s
        ORDER BY leg_number
    """, (match_id,))
    legs = cursor.fetchall()

    legs_out = []
    for leg in legs:
        # Turns
        cursor.execute("""
            SELECT id, player_id, turn_number, score_before, score_after,
                   darts_thrown, is_bust, is_checkout
            FROM turns
            WHERE leg_id = %s
              AND score_after IS NOT NULL
            ORDER BY turn_number, player_id
        """, (leg["id"],))
        turns = cursor.fetchall()

        turns_out = []
        for turn in turns:
            # Throws
            cursor.execute("""
                SELECT dart_number, segment, multiplier, points, is_checkout
                FROM throws
                WHERE turn_id = %s
                ORDER BY dart_number
            """, (turn["id"],))
            throws = cursor.fetchall()

            throws_out = []
            for th in throws:
                seg = th["segment"]
                mul = th["multiplier"]
                if seg == 0:
                    notation = "MISS"
                elif seg == 25 and mul == 2:
                    notation = "BULL"
                elif seg == 25:
                    notation = "OUTER"
                else:
                    prefix = "T" if mul == 3 else "D" if mul == 2 else ""
                    notation = prefix + str(seg)

                throws_out.append({
                    "dart_number": th["dart_number"],
                    "notation":    notation,
                    "points":      th["points"],
                    "is_checkout": bool(th["is_checkout"]),
                })

            score_after = turn["score_after"]
            turn_score  = turn["score_before"] - (score_after if score_after is not None else turn["score_before"])

            turns_out.append({
                "player_id":    turn["player_id"],
                "turn_number":  turn["turn_number"],
                "score_before": turn["score_before"],
                "score_after":  score_after,
                "turn_score":   turn_score,
                "darts_thrown": turn["darts_thrown"],
                "is_bust":      bool(turn["is_bust"]),
                "is_checkout":  bool(turn["is_checkout"]),
                "throws":       throws_out,
            })

        legs_out.append({
            "leg_id":      leg["id"],
            "leg_number":  leg["leg_number"],
            "winner_id":   leg["winner_id"],
            "starting_score": leg["starting_score"],
            "turns":       turns_out,
        })

    return jsonify({
        "match": {
            "id":           match["id"],
            "game_type":    match["game_type"],
            "session_type": match["session_type"],
            "ended_at":     str(match["ended_at"])[:10] if match["ended_at"] else "—",
            "winner_id":    match["winner_id"],
        },
        "players": [{"id": p["id"], "name": p["name"]} for p in players],
        "legs":    legs_out,
    }), 200


# ─────────────────────────────────────────────────────────────────────────────
# Generic scorecard — tailored per non-01 game type
# ─────────────────────────────────────────────────────────────────────────────

@stats_bp.route("/matches/<int:match_id>/scorecard/generic", methods=["GET"])
def get_generic_scorecard(match_id):
    """
    Return a game-type-aware scorecard for non-01 games.
    Each game returns a different structure suited to its layout.
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, game_type, session_type FROM matches WHERE id = %s",
        (match_id,)
    )
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404

    cursor.execute("""
        SELECT p.id, p.name, mp.turn_order
        FROM match_players mp
        JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = %s ORDER BY mp.turn_order
    """, (match_id,))
    players = cursor.fetchall()

    game_type = match["game_type"]

    # ── Race to 1000 ──────────────────────────────────────────────────────────
    if game_type == "race1000":
        cursor.execute("SELECT * FROM race1000_games WHERE match_id=%s", (match_id,))
        game = cursor.fetchone()
        cursor.execute("""
            SELECT player_id, score FROM race1000_players
            WHERE match_id=%s ORDER BY turn_order
        """, (match_id,))
        final_scores = {r["player_id"]: r["score"] for r in cursor.fetchall()}

        cursor.execute("""
            SELECT player_id, turn_number, dart_number, segment, multiplier, points
            FROM race1000_throws WHERE match_id=%s
            ORDER BY turn_number, player_id, dart_number
        """, (match_id,))
        throw_rows = cursor.fetchall()

        # Group into turns: { turn_number: { player_id: [darts] } }
        from collections import defaultdict
        turns = defaultdict(lambda: defaultdict(list))
        for t in throw_rows:
            turns[t["turn_number"]][t["player_id"]].append({
                "dart":   t["dart_number"],
                "seg":    t["segment"],
                "mul":    t["multiplier"],
                "pts":    t["points"],
            })

        return jsonify({
            "game_type":    "race1000",
            "variant":      game["variant"] if game else "twenties",
            "winner_id":    game["winner_id"] if game else None,
            "players":      [{"id": p["id"], "name": p["name"]} for p in players],
            "final_scores": final_scores,
            "turns":        {str(tn): {str(pid): darts
                             for pid, darts in pmap.items()}
                             for tn, pmap in turns.items()},
        }), 200

    # ── Nine Lives ────────────────────────────────────────────────────────────
    elif game_type == "nine_lives":
        cursor.execute("SELECT * FROM nine_lives_games WHERE match_id=%s", (match_id,))
        game = cursor.fetchone()
        cursor.execute("""
            SELECT player_id, target, lives, eliminated, completed
            FROM nine_lives_players WHERE match_id=%s ORDER BY turn_order
        """, (match_id,))
        final_states = {r["player_id"]: dict(r) for r in cursor.fetchall()}

        cursor.execute("""
            SELECT player_id, turn_number, dart_number, segment, multiplier, is_hit
            FROM nine_lives_throws WHERE match_id=%s
            ORDER BY turn_number, player_id, dart_number
        """, (match_id,))
        throw_rows = cursor.fetchall()

        from collections import defaultdict
        turns = defaultdict(lambda: defaultdict(list))
        for t in throw_rows:
            turns[t["turn_number"]][t["player_id"]].append({
                "dart":   t["dart_number"],
                "seg":    t["segment"],
                "mul":    t["multiplier"],
                "is_hit": bool(t["is_hit"]),
            })

        return jsonify({
            "game_type":     "nine_lives",
            "winner_id":     game["winner_id"] if game else None,
            "players":       [{"id": p["id"], "name": p["name"]} for p in players],
            "final_states":  {str(k): v for k, v in final_states.items()},
            "turns":         {str(tn): {str(pid): darts
                              for pid, darts in pmap.items()}
                              for tn, pmap in turns.items()},
        }), 200

    # ── Killer ────────────────────────────────────────────────────────────────
    elif game_type == "killer":
        cursor.execute("SELECT * FROM killer_games WHERE match_id=%s", (match_id,))
        game = cursor.fetchone()
        cursor.execute("""
            SELECT player_id, assigned_number, hits, is_killer, lives, eliminated
            FROM killer_players WHERE match_id=%s ORDER BY turn_order
        """, (match_id,))
        final_states = {r["player_id"]: dict(r) for r in cursor.fetchall()}

        cursor.execute("""
            SELECT player_id, turn_number, dart_number, segment, multiplier, hits_scored
            FROM killer_throws WHERE match_id=%s
            ORDER BY turn_number, player_id, dart_number
        """, (match_id,))
        throw_rows = cursor.fetchall()

        from collections import defaultdict
        turns = defaultdict(lambda: defaultdict(list))
        for t in throw_rows:
            turns[t["turn_number"]][t["player_id"]].append({
                "dart":       t["dart_number"],
                "seg":        t["segment"],
                "mul":        t["multiplier"],
                "hits_scored": t["hits_scored"],
            })

        return jsonify({
            "game_type":    "killer",
            "variant":      game["variant"] if game else "doubles",
            "winner_id":    game["winner_id"] if game else None,
            "players":      [{"id": p["id"], "name": p["name"]} for p in players],
            "final_states": {str(k): v for k, v in final_states.items()},
            "turns":        {str(tn): {str(pid): darts
                             for pid, darts in pmap.items()}
                             for tn, pmap in turns.items()},
        }), 200

    # ── Bermuda Triangle ──────────────────────────────────────────────────────
    elif game_type == "bermuda":
        cursor.execute("SELECT * FROM bermuda_games WHERE match_id=%s", (match_id,))
        game = cursor.fetchone()
        cursor.execute("""
            SELECT player_id, score FROM bermuda_players
            WHERE match_id=%s ORDER BY turn_order
        """, (match_id,))
        final_scores = {r["player_id"]: r["score"] for r in cursor.fetchall()}

        # Per-round summary (was_halved, score_after)
        cursor.execute("""
            SELECT player_id, round_number, points_scored, was_halved, score_after
            FROM bermuda_turns WHERE match_id=%s
            ORDER BY round_number, player_id
        """, (match_id,))
        round_rows = cursor.fetchall()
        from collections import defaultdict
        round_summary = defaultdict(dict)
        for r in round_rows:
            round_summary[r["round_number"]][r["player_id"]] = {
                "pts":       r["points_scored"],
                "halved":    bool(r["was_halved"]),
                "score_after": r["score_after"],
            }

        # Individual throws
        cursor.execute("""
            SELECT player_id, round_number, dart_number, segment, multiplier, points
            FROM bermuda_throws WHERE match_id=%s
            ORDER BY round_number, player_id, dart_number
        """, (match_id,))
        throw_rows = cursor.fetchall()
        throws_by_round = defaultdict(lambda: defaultdict(list))
        for t in throw_rows:
            throws_by_round[t["round_number"]][t["player_id"]].append({
                "dart": t["dart_number"],
                "seg":  t["segment"],
                "mul":  t["multiplier"],
                "pts":  t["points"],
            })

        return jsonify({
            "game_type":     "bermuda",
            "winner_id":     game["winner_id"] if game else None,
            "players":       [{"id": p["id"], "name": p["name"]} for p in players],
            "final_scores":  final_scores,
            "round_summary": {str(rn): {str(pid): v for pid, v in pmap.items()}
                              for rn, pmap in round_summary.items()},
            "throws_by_round": {str(rn): {str(pid): darts
                                for pid, darts in pmap.items()}
                                for rn, pmap in throws_by_round.items()},
        }), 200

    # ── Baseball ──────────────────────────────────────────────────────────────
    elif game_type == "baseball":
        cursor.execute("SELECT * FROM baseball_games WHERE match_id=%s", (match_id,))
        game = cursor.fetchone()
        cursor.execute("""
            SELECT player_id, inning_number, target_number, runs, outs, darts_thrown, complete
            FROM baseball_innings WHERE match_id=%s
            ORDER BY player_id, inning_number
        """, (match_id,))
        inning_rows = cursor.fetchall()
        from collections import defaultdict
        innings = defaultdict(dict)
        for r in inning_rows:
            innings[r["player_id"]][r["inning_number"]] = {
                "target": r["target_number"],
                "runs":   r["runs"],
                "outs":   r["outs"],
                "darts":  r["darts_thrown"],
            }
        # Total runs per player
        totals = {pid: sum(inn["runs"] for inn in pid_innings.values())
                  for pid, pid_innings in innings.items()}

        return jsonify({
            "game_type":   "baseball",
            "start_number": game["start_number"] if game else 1,
            "winner_ids":  game["winner_ids"] if game else None,
            "players":     [{"id": p["id"], "name": p["name"]} for p in players],
            "innings":     {str(pid): {str(inn): v for inn, v in pid_innings.items()}
                            for pid, pid_innings in innings.items()},
            "totals":      {str(k): v for k, v in totals.items()},
        }), 200

    else:
        return jsonify({"error": f"No generic scorecard for game_type '{game_type}'"}), 404


# ─────────────────────────────────────────────────────────────────────────────
# Shanghai & Cricket generic scorecards (appended to generic endpoint above)
# ─────────────────────────────────────────────────────────────────────────────

@stats_bp.route("/matches/<int:match_id>/scorecard/shanghai", methods=["GET"])
def get_shanghai_scorecard(match_id):
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id, game_type FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404

    cursor.execute("""
        SELECT p.id, p.name, mp.turn_order
        FROM match_players mp JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = %s ORDER BY mp.turn_order
    """, (match_id,))
    players = cursor.fetchall()

    cursor.execute("SELECT * FROM shanghai_games WHERE match_id = %s", (match_id,))
    game = cursor.fetchone()

    # Rounds summary: { round_number: { player_id: {score, shanghai, darts_thrown} } }
    cursor.execute("""
        SELECT player_id, round_number, target_number, score, shanghai, darts_thrown
        FROM shanghai_rounds WHERE match_id = %s
        ORDER BY round_number, player_id
    """, (match_id,))
    from collections import defaultdict
    rounds = defaultdict(dict)
    for r in cursor.fetchall():
        rounds[r["round_number"]][r["player_id"]] = {
            "target":  r["target_number"],
            "score":   r["score"],
            "shanghai": bool(r["shanghai"]),
            "darts":   r["darts_thrown"],
        }

    # Per-round throw detail: { round_number: { player_id: [darts] } }
    cursor.execute("""
        SELECT st.player_id, sr.round_number, st.dart_number, st.segment, st.multiplier, st.points
        FROM shanghai_throws st
        JOIN shanghai_rounds sr ON sr.id = st.round_id
        WHERE st.match_id = %s
        ORDER BY sr.round_number, st.player_id, st.dart_number
    """, (match_id,))
    throws = defaultdict(lambda: defaultdict(list))
    for t in cursor.fetchall():
        throws[t["round_number"]][t["player_id"]].append({
            "dart": t["dart_number"],
            "seg":  t["segment"],
            "mul":  t["multiplier"],
            "pts":  t["points"],
        })

    # Final totals
    cursor.execute("""
        SELECT player_id, SUM(score) AS total FROM shanghai_rounds
        WHERE match_id = %s GROUP BY player_id
    """, (match_id,))
    totals = {r["player_id"]: int(r["total"] or 0) for r in cursor.fetchall()}

    return jsonify({
        "game_type":  "shanghai",
        "num_rounds": game["num_rounds"] if game else 20,
        "winner_id":  game["winner_id"]  if game else None,
        "players":    [{"id": p["id"], "name": p["name"]} for p in players],
        "rounds":     {str(rn): {str(pid): v for pid, v in pmap.items()}
                       for rn, pmap in rounds.items()},
        "throws":     {str(rn): {str(pid): darts for pid, darts in pmap.items()}
                       for rn, pmap in throws.items()},
        "totals":     {str(k): v for k, v in totals.items()},
    }), 200


@stats_bp.route("/matches/<int:match_id>/scorecard/cricket", methods=["GET"])
def get_cricket_scorecard(match_id):
    db     = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id, game_type, winner_id FROM matches WHERE id = %s", (match_id,))
    match = cursor.fetchone()
    if not match:
        return jsonify({"error": "Match not found"}), 404

    cursor.execute("""
        SELECT p.id, p.name, mp.turn_order
        FROM match_players mp JOIN players p ON p.id = mp.player_id
        WHERE mp.match_id = %s ORDER BY mp.turn_order
    """, (match_id,))
    players = cursor.fetchall()

    # Final marks per player per number
    cursor.execute("""
        SELECT player_id, number, marks FROM cricket_marks WHERE match_id = %s
    """, (match_id,))
    from collections import defaultdict
    final_marks = defaultdict(dict)
    for r in cursor.fetchall():
        final_marks[r["player_id"]][r["number"]] = r["marks"]

    # Final scores
    cursor.execute("SELECT player_id, points FROM cricket_scores WHERE match_id = %s", (match_id,))
    final_scores = {r["player_id"]: r["points"] for r in cursor.fetchall()}

    # Turn-by-turn throws: { turn_number: { player_id: [darts] } }
    cursor.execute("""
        SELECT player_id, turn_number, dart_number, segment, multiplier, marks_added, points_scored
        FROM cricket_throws WHERE match_id = %s
        ORDER BY turn_number, player_id, dart_number
    """, (match_id,))
    turns = defaultdict(lambda: defaultdict(list))
    for t in cursor.fetchall():
        turns[t["turn_number"]][t["player_id"]].append({
            "dart":       t["dart_number"],
            "seg":        t["segment"],
            "mul":        t["multiplier"],
            "marks":      t["marks_added"],
            "pts":        t["points_scored"],
        })

    return jsonify({
        "game_type":    "cricket",
        "winner_id":    match["winner_id"],
        "players":      [{"id": p["id"], "name": p["name"]} for p in players],
        "final_marks":  {str(pid): {str(num): m for num, m in nmap.items()}
                         for pid, nmap in final_marks.items()},
        "final_scores": {str(k): v for k, v in final_scores.items()},
        "turns":        {str(tn): {str(pid): darts for pid, darts in pmap.items()}
                         for tn, pmap in turns.items()},
    }), 200