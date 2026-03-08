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
            COALESCE(m.ended_at,
                CASE m.game_type
                    WHEN 'race1000'   THEN (SELECT g.ended_at FROM race1000_games   g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'nine_lives' THEN (SELECT g.ended_at FROM nine_lives_games g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'killer'     THEN (SELECT g.ended_at FROM killer_games     g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'bermuda'    THEN (SELECT g.ended_at FROM bermuda_games    g WHERE g.match_id = m.id LIMIT 1)
                    WHEN 'baseball'   THEN (SELECT g.ended_at FROM baseball_games   g WHERE g.match_id = m.id LIMIT 1)
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

        # Per-match avg for this player
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
        avg_row = cursor.fetchone()
        pts   = int(avg_row["pts"]   or 0)
        darts = int(avg_row["darts"] or 0)
        avg   = round((pts / darts) * 3, 1) if darts else 0.0

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
            "result":      result,
            "avg":         avg,
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