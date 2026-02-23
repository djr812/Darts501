"""
app/routes/api/analysis.py
---------------------------
AI-powered player analysis endpoints.

Endpoints:
    GET  /api/players/<id>/analysis/metrics
        Computes the full set of analysis metrics from raw throw/turn/leg data.
        Returns structured JSON — can be used independently for display or
        passed to the generate endpoint.

    POST /api/players/<id>/analysis/generate
        Accepts { "style": "full"|"tips", "metrics": {...} }
        Builds a prompt and streams a response from the local Ollama instance.
        Returns a text/event-stream (SSE) response so the UI can display
        tokens as they arrive.

Ollama config (in Flask app.config):
    OLLAMA_URL        -- base URL, default http://localhost:11434
    OLLAMA_MODEL      -- model name, default llama3
    OLLAMA_NUM_PREDICT_FULL -- token budget for full analysis, default 1000
    OLLAMA_NUM_PREDICT_TIPS -- token budget for quick tips,    default 500
"""

import json
import math
import urllib.request
import urllib.error
from flask import Blueprint, request, jsonify, stream_with_context, Response, current_app
from app.models.db import get_db

analysis_bp = Blueprint("analysis", __name__)


# ======================================================================
# Helpers
# ======================================================================

def _safe_div(num, den, decimals=2):
    """Return num/den rounded to decimals, or 0.0 if den is zero."""
    if not den:
        return 0.0
    return round(num / den, decimals)


def _safe_pct(num, den):
    """Return percentage (0-100) rounded to 1dp, or 0.0."""
    return round(_safe_div(num, den) * 100, 1)


def _stddev(values):
    """Population standard deviation of a list of numbers."""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / len(values)
    return round(math.sqrt(variance), 2)


# ======================================================================
# Metrics endpoint
# ======================================================================

@analysis_bp.route("/players/<int:player_id>/analysis/metrics", methods=["GET"])
def get_analysis_metrics(player_id):
    """
    Compute the full analysis metric set for a player.
    All metrics are derived from existing throw/turn/leg data — no schema
    changes required.
    """
    db     = get_db()
    cursor = db.cursor()

    cursor.execute(
        "SELECT id, name FROM players WHERE id = %s AND is_active = TRUE",
        (player_id,)
    )
    player = cursor.fetchone()
    if not player:
        return jsonify({"error": "Player not found"}), 404
    if player["name"] == "CPU":
        return jsonify({"error": "Analysis not available for CPU"}), 400

    # ------------------------------------------------------------------
    # 1. Scoring metrics
    # ------------------------------------------------------------------

    # Per-dart average and total throw count
    cursor.execute("""
        SELECT
            COUNT(*)           AS total_throws,
            SUM(th.points)     AS total_points,
            AVG(th.points)     AS avg_per_dart
        FROM throws th
        JOIN turns t ON t.id = th.turn_id
        JOIN legs  l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND l.status    = 'complete'
    """, (player_id,))
    dart_row = cursor.fetchone()

    total_throws = int(dart_row["total_throws"] or 0)
    total_points = int(dart_row["total_points"] or 0)
    avg_per_dart = round(float(dart_row["avg_per_dart"] or 0), 2)

    # Per-turn average (3-dart avg) and variance
    cursor.execute("""
        SELECT
            COUNT(*)                           AS total_turns,
            AVG(t.score_before - t.score_after) AS avg_turn_score,
            SUM(t.darts_thrown)                AS total_darts
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id   = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust      = 0
          AND l.status       = 'complete'
    """, (player_id,))
    turn_row = cursor.fetchone()

    total_turns    = int(turn_row["total_turns"] or 0)
    avg_turn_score = round(float(turn_row["avg_turn_score"] or 0), 2)
    total_darts_t  = int(turn_row["total_darts"] or 0)
    three_dart_avg = _safe_div(total_points, total_throws / 3 if total_throws else 0)

    # Turn score variance — fetch individual turn scores for stddev
    cursor.execute("""
        SELECT (t.score_before - t.score_after) AS turn_score
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id   = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust      = 0
          AND l.status       = 'complete'
    """, (player_id,))
    turn_scores  = [r["turn_score"] for r in cursor.fetchall() if r["turn_score"] is not None]
    turn_stddev  = _stddev(turn_scores)

    # Per-dart variance
    cursor.execute("""
        SELECT th.points
        FROM throws th
        JOIN turns t ON t.id = th.turn_id
        JOIN legs  l ON l.id = t.leg_id
        WHERE t.player_id = %s AND l.status = 'complete'
    """, (player_id,))
    dart_scores = [r["points"] for r in cursor.fetchall()]
    dart_stddev = _stddev(dart_scores)

    # ------------------------------------------------------------------
    # 2. Dart position drop-off  (dart 1 vs 2 vs 3 within a turn)
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            th.dart_number,
            AVG(th.points) AS avg_points,
            COUNT(*)       AS count
        FROM throws th
        JOIN turns t ON t.id = th.turn_id
        JOIN legs  l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND l.status    = 'complete'
          AND t.is_bust   = 0
        GROUP BY th.dart_number
        ORDER BY th.dart_number
    """, (player_id,))
    pos_rows = cursor.fetchall()
    dart_position_avgs = {}
    for r in pos_rows:
        dart_position_avgs[int(r["dart_number"])] = round(float(r["avg_points"]), 2)

    # Drop-off: difference between dart 1 avg and dart 3 avg
    d1 = dart_position_avgs.get(1, 0)
    d3 = dart_position_avgs.get(3, 0)
    dropoff = round(d1 - d3, 2)

    # ------------------------------------------------------------------
    # 3. First turn vs subsequent turns (opening vs mid-leg performance)
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT AVG(turn_score) AS first_turn_avg
        FROM (
            SELECT
                t.leg_id,
                (t.score_before - t.score_after) AS turn_score,
                ROW_NUMBER() OVER (PARTITION BY t.leg_id ORDER BY t.turn_number) AS rn
            FROM turns t
            JOIN legs l ON l.id = t.leg_id
            WHERE t.player_id   = %s
              AND t.score_after IS NOT NULL
              AND t.is_bust      = 0
              AND l.status       = 'complete'
        ) ranked
        WHERE rn = 1
    """, (player_id,))
    first_turn_row = cursor.fetchone()
    first_turn_avg = round(float(first_turn_row["first_turn_avg"] or 0), 2)

    cursor.execute("""
        SELECT AVG(turn_score) AS subsequent_avg
        FROM (
            SELECT
                t.leg_id,
                (t.score_before - t.score_after) AS turn_score,
                ROW_NUMBER() OVER (PARTITION BY t.leg_id ORDER BY t.turn_number) AS rn
            FROM turns t
            JOIN legs l ON l.id = t.leg_id
            WHERE t.player_id   = %s
              AND t.score_after IS NOT NULL
              AND t.is_bust      = 0
              AND l.status       = 'complete'
        ) ranked
        WHERE rn > 1
    """, (player_id,))
    subseq_row    = cursor.fetchone()
    subsequent_avg = round(float(subseq_row["subsequent_avg"] or 0), 2)

    # ------------------------------------------------------------------
    # 4. Segment accuracy — top segments hit, frequency by segment
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            th.segment,
            th.multiplier,
            COUNT(*)       AS hit_count,
            SUM(th.points) AS total_pts
        FROM throws th
        JOIN turns t ON t.id = th.turn_id
        JOIN legs  l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND l.status    = 'complete'
        GROUP BY th.segment, th.multiplier
        ORDER BY hit_count DESC
    """, (player_id,))
    seg_rows = cursor.fetchall()

    # Build segment hit map: segment -> {single, double, treble counts}
    seg_map = {}
    for r in seg_rows:
        seg = r["segment"]
        mul = r["multiplier"]
        cnt = r["hit_count"]
        if seg not in seg_map:
            seg_map[seg] = {1: 0, 2: 0, 3: 0}
        seg_map[seg][mul] = cnt

    # Key segment hit rates (total hits on segment / total throws)
    def seg_hit_pct(seg):
        if seg not in seg_map:
            return 0.0
        total_seg = sum(seg_map[seg].values())
        return _safe_pct(total_seg, total_throws)

    key_segments = {
        "20": seg_hit_pct(20),
        "19": seg_hit_pct(19),
        "18": seg_hit_pct(18),
        "bull": seg_hit_pct(25),
        "treble_20": _safe_pct(seg_map.get(20, {}).get(3, 0), total_throws),
        "treble_19": _safe_pct(seg_map.get(19, {}).get(3, 0), total_throws),
    }

    # Top 5 most-hit segments
    seg_totals = {seg: sum(muls.values()) for seg, muls in seg_map.items()}
    top_segments = sorted(seg_totals.items(), key=lambda x: x[1], reverse=True)[:5]
    top_segments = [{"segment": s, "hits": c, "pct": _safe_pct(c, total_throws)}
                    for s, c in top_segments]

    # Miss tendencies: when aiming 20 (high-scoring attempts) how often do
    # adjacent segments (1, 5) appear?  Proxy: ratio of 1s and 5s to 20s.
    hits_20    = seg_totals.get(20, 0)
    hits_1     = seg_totals.get(1, 0)
    hits_5     = seg_totals.get(5, 0)
    hits_19    = seg_totals.get(19, 0)
    hits_3     = seg_totals.get(3, 0)
    hits_7     = seg_totals.get(7, 0)
    miss_20_ratio = _safe_div(hits_1 + hits_5, max(hits_20, 1))
    miss_19_ratio = _safe_div(hits_3 + hits_7, max(hits_19, 1))

    # ------------------------------------------------------------------
    # 5. Double / checkout accuracy
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            COUNT(*) AS total_double_attempts,
            SUM(CASE WHEN th.points > 0 THEN 1 ELSE 0 END) AS doubles_hit
        FROM throws th
        JOIN turns t ON t.id = th.turn_id
        JOIN legs  l ON l.id = t.leg_id
        WHERE t.player_id  = %s
          AND th.multiplier = 2
          AND l.status      = 'complete'
    """, (player_id,))
    dbl_row = cursor.fetchone()
    double_attempts = int(dbl_row["total_double_attempts"] or 0)
    doubles_hit     = int(dbl_row["doubles_hit"] or 0)
    double_pct      = _safe_pct(doubles_hit, double_attempts)

    # Checkout %: legs won / legs where player reached ≤170
    cursor.execute("""
        SELECT COUNT(DISTINCT t.leg_id) AS attempts
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id   = %s
          AND t.score_before <= 170
          AND t.score_before >= 2
          AND l.status       = 'complete'
    """, (player_id,))
    co_att_row = cursor.fetchone()

    cursor.execute("""
        SELECT COUNT(*) AS legs_won
        FROM legs WHERE winner_id = %s AND status = 'complete'
    """, (player_id,))
    legs_won_row = cursor.fetchone()

    checkout_attempts = int(co_att_row["attempts"] or 0)
    legs_won          = int(legs_won_row["legs_won"] or 0)
    checkout_pct      = _safe_pct(legs_won, checkout_attempts)

    # Checkout success by score range
    cursor.execute("""
        SELECT
            SUM(CASE WHEN t.score_before BETWEEN 41 AND 170
                      AND t.is_checkout = 1 THEN 1 ELSE 0 END) AS won_41_170,
            SUM(CASE WHEN t.score_before BETWEEN 41 AND 170 THEN 1 ELSE 0 END) AS att_41_170,
            SUM(CASE WHEN t.score_before BETWEEN 2  AND 40
                      AND t.is_checkout = 1 THEN 1 ELSE 0 END) AS won_2_40,
            SUM(CASE WHEN t.score_before BETWEEN 2  AND 40  THEN 1 ELSE 0 END) AS att_2_40
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s AND l.status = 'complete'
    """, (player_id,))
    co_range = cursor.fetchone()
    checkout_by_range = {
        "41_to_170": {
            "attempts": int(co_range["att_41_170"] or 0),
            "won":      int(co_range["won_41_170"] or 0),
            "pct":      _safe_pct(co_range["won_41_170"] or 0, co_range["att_41_170"] or 0),
        },
        "2_to_40": {
            "attempts": int(co_range["att_2_40"] or 0),
            "won":      int(co_range["won_2_40"] or 0),
            "pct":      _safe_pct(co_range["won_2_40"] or 0, co_range["att_2_40"] or 0),
        },
    }

    # ------------------------------------------------------------------
    # 6. Bust analysis
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            COUNT(*)               AS total_busts,
            AVG(t.score_before)    AS avg_score_before_bust
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id = %s
          AND t.is_bust   = 1
          AND l.status    = 'complete'
    """, (player_id,))
    bust_row = cursor.fetchone()
    total_busts         = int(bust_row["total_busts"] or 0)
    avg_score_pre_bust  = round(float(bust_row["avg_score_before_bust"] or 0), 1)
    bust_rate           = _safe_pct(total_busts, total_turns + total_busts)

    # ------------------------------------------------------------------
    # 7. Performance by game type
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            l.game_type,
            COUNT(DISTINCT l.id)   AS legs_played,
            SUM(CASE WHEN l.winner_id = %s THEN 1 ELSE 0 END) AS legs_won,
            AVG(t.score_before - t.score_after) AS avg_turn
        FROM legs l
        JOIN turns t ON t.leg_id = l.id
        WHERE t.player_id = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust    = 0
          AND l.status     = 'complete'
        GROUP BY l.game_type
    """, (player_id, player_id))
    game_type_rows = cursor.fetchall()
    by_game_type = {}
    for r in game_type_rows:
        gt = r["game_type"]
        lp = int(r["legs_played"] or 0)
        lw = int(r["legs_won"]    or 0)
        by_game_type[gt] = {
            "legs_played": lp,
            "legs_won":    lw,
            "win_pct":     _safe_pct(lw, lp),
            "avg_turn":    round(float(r["avg_turn"] or 0), 2),
        }

    # ------------------------------------------------------------------
    # 8. Milestone counts
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT
            SUM(CASE WHEN (t.score_before - t.score_after) = 180 THEN 1 ELSE 0 END) AS s180,
            SUM(CASE WHEN (t.score_before - t.score_after) >= 140
                      AND (t.score_before - t.score_after) < 180 THEN 1 ELSE 0 END) AS s140,
            SUM(CASE WHEN (t.score_before - t.score_after) >= 100
                      AND (t.score_before - t.score_after) < 140 THEN 1 ELSE 0 END) AS s100
        FROM turns t
        JOIN legs l ON l.id = t.leg_id
        WHERE t.player_id   = %s
          AND t.score_after IS NOT NULL
          AND t.is_bust      = 0
          AND l.status       = 'complete'
    """, (player_id,))
    ms = cursor.fetchone()

    # ------------------------------------------------------------------
    # 9. Average darts to win a leg
    # ------------------------------------------------------------------
    cursor.execute("""
        SELECT AVG(dart_count) AS avg_darts_leg
        FROM (
            SELECT l.id, SUM(t.darts_thrown) AS dart_count
            FROM legs l
            JOIN turns t ON t.leg_id = l.id
            WHERE l.winner_id  = %s
              AND l.status     = 'complete'
              AND t.player_id  = %s
            GROUP BY l.id
        ) per_leg
    """, (player_id, player_id))
    avg_darts_leg = round(float(cursor.fetchone()["avg_darts_leg"] or 0), 1)

    # ------------------------------------------------------------------
    # Assemble
    # ------------------------------------------------------------------
    return jsonify({
        "player": {"id": player_id, "name": player["name"]},
        "sample_size": {
            "total_throws": total_throws,
            "total_turns":  total_turns,
            "legs_played":  sum(v["legs_played"] for v in by_game_type.values()),
            "legs_won":     legs_won,
        },
        "scoring": {
            "avg_per_dart":      avg_per_dart,
            "three_dart_avg":    round(avg_per_dart * 3, 2),
            "avg_turn_score":    avg_turn_score,
            "turn_stddev":       turn_stddev,
            "dart_stddev":       dart_stddev,
            "dart_position_avgs": dart_position_avgs,
            "dart1_to_dart3_dropoff": dropoff,
            "first_turn_avg":    first_turn_avg,
            "subsequent_turn_avg": subsequent_avg,
            "first_vs_subsequent_diff": round(first_turn_avg - subsequent_avg, 2),
            "milestones": {
                "180s":    int(ms["s180"] or 0),
                "140plus": int(ms["s140"] or 0),
                "100plus": int(ms["s100"] or 0),
            },
        },
        "segments": {
            "key_hit_pcts":  key_segments,
            "top_5":         top_segments,
            "miss_tendency": {
                "aiming_20_miss_ratio": miss_20_ratio,
                "aiming_19_miss_ratio": miss_19_ratio,
                "hits_on_1_and_5":      hits_1 + hits_5,
                "hits_on_3_and_7":      hits_3 + hits_7,
            },
        },
        "doubles": {
            "attempts":    double_attempts,
            "hit":         doubles_hit,
            "hit_pct":     double_pct,
        },
        "checkout": {
            "attempts":         checkout_attempts,
            "conversions":      legs_won,
            "checkout_pct":     checkout_pct,
            "avg_darts_to_win": avg_darts_leg,
            "by_range":         checkout_by_range,
        },
        "busts": {
            "total":            total_busts,
            "bust_rate_pct":    bust_rate,
            "avg_score_pre_bust": avg_score_pre_bust,
        },
        "by_game_type": by_game_type,
    }), 200


# ======================================================================
# Generate endpoint — streams Ollama response
# ======================================================================

@analysis_bp.route("/players/<int:player_id>/analysis/generate", methods=["POST"])
def generate_analysis(player_id):
    """
    POST { "style": "full"|"tips", "metrics": {...} }
    Streams an Ollama response as text/event-stream (SSE).
    Each event is:  data: <token>\n\n
    Terminal event: data: [DONE]\n\n
    """
    db     = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id, name FROM players WHERE id = %s", (player_id,))
    player = cursor.fetchone()
    if not player:
        return jsonify({"error": "Player not found"}), 404

    body = request.get_json(silent=True) or {}
    style       = body.get("style",       "tips")
    skill_level = body.get("skill_level", "beginner")   # beginner | intermediate | advanced
    metrics     = body.get("metrics",     {})

    if not metrics:
        return jsonify({"error": "metrics payload required"}), 400

    prompt = _build_prompt(player["name"], metrics, style, skill_level)

    ollama_url        = current_app.config.get("OLLAMA_URL",              "http://localhost:11434")
    ollama_model      = current_app.config.get("OLLAMA_MODEL",            "llama3")
    num_predict_full  = current_app.config.get("OLLAMA_NUM_PREDICT_FULL", 1000)
    num_predict_tips  = current_app.config.get("OLLAMA_NUM_PREDICT_TIPS", 500)
    num_predict       = num_predict_full if style == "full" else num_predict_tips

    def generate():
        payload = json.dumps({
            "model":  ollama_model,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": 0.7,
                # Generous token budget — avoids mid-sentence truncation.
                # Tune OLLAMA_NUM_PREDICT_FULL / _TIPS in config.py per model.
                "num_predict": num_predict,
                # Stop at sentence-ending punctuation so if the budget IS hit,
                # the response ends at a clean boundary rather than mid-word.
                "stop": ["\n\n\n"],
            }
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{ollama_url}/api/generate",
            data    = payload,
            headers = {"Content-Type": "application/json"},
            method  = "POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    token = chunk.get("response", "")
                    if token:
                        # Escape newlines for SSE transport
                        safe = token.replace("\n", "\\n")
                        yield f"data: {safe}\n\n"

                    if chunk.get("done"):
                        yield "data: [DONE]\n\n"
                        return

        except urllib.error.URLError as e:
            yield f"data: [ERROR] Could not reach Ollama: {e.reason}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":  "no-cache",
            "X-Accel-Buffering": "no",   # Disable nginx buffering if proxied
        }
    )


# ======================================================================
# Prompt builder
# ======================================================================

def _build_prompt(name: str, m: dict, style: str, skill_level: str = "beginner") -> str:
    """
    Build a focused, data-rich prompt from the metrics dict.
    style:       'full' = narrative analysis, 'tips' = concise bullet coaching
    skill_level: 'beginner' | 'intermediate' | 'advanced'
    """

    scoring   = m.get("scoring",  {})
    segments  = m.get("segments", {})
    doubles   = m.get("doubles",  {})
    checkout  = m.get("checkout", {})
    busts     = m.get("busts",    {})
    sample    = m.get("sample_size", {})
    by_type   = m.get("by_game_type", {})

    pos_avgs  = scoring.get("dart_position_avgs", {})
    key_segs  = segments.get("key_hit_pcts", {})
    miss      = segments.get("miss_tendency", {})
    co_range  = checkout.get("by_range", {})
    ms        = scoring.get("milestones", {})

    # Format game type breakdown
    gt_lines = []
    for gt, v in by_type.items():
        gt_lines.append(
            f"  {gt}: {v['legs_played']} legs played, "
            f"{v['legs_won']} won ({v['win_pct']}%), "
            f"avg turn {v['avg_turn']}"
        )
    gt_text = "\n".join(gt_lines) if gt_lines else "  No game type data"

    metrics_summary = f"""
PLAYER: {name}
SAMPLE: {sample.get('total_throws', 0)} darts thrown across {sample.get('legs_played', 0)} completed legs

SCORING
  Average per dart:        {scoring.get('avg_per_dart', 0)}
  3-dart average:          {scoring.get('three_dart_avg', 0)}
  Average turn score:      {scoring.get('avg_turn_score', 0)}
  Turn score std deviation:{scoring.get('turn_stddev', 0)} (consistency — lower is better)
  Dart score std deviation:{scoring.get('dart_stddev', 0)}
  180s / 140+ / 100+:      {ms.get('180s',0)} / {ms.get('140plus',0)} / {ms.get('100plus',0)}

DART POSITION DROP-OFF (within a turn)
  Dart 1 avg: {pos_avgs.get(1, 'N/A')}
  Dart 2 avg: {pos_avgs.get(2, 'N/A')}
  Dart 3 avg: {pos_avgs.get(3, 'N/A')}
  Drop-off dart 1→3: {scoring.get('dart1_to_dart3_dropoff', 0)} points

OPENING VS MID-LEG
  First turn avg:       {scoring.get('first_turn_avg', 0)}
  Subsequent turns avg: {scoring.get('subsequent_turn_avg', 0)}
  Difference:           {scoring.get('first_vs_subsequent_diff', 0)} points

SEGMENT ACCURACY
  T20 hit %:   {key_segs.get('treble_20', 0)}%
  T19 hit %:   {key_segs.get('treble_19', 0)}%
  20 bed %:    {key_segs.get('20', 0)}%
  19 bed %:    {key_segs.get('19', 0)}%
  Bull %:      {key_segs.get('bull', 0)}%
  Miss ratio when aiming 20 (hits on 1+5 vs 20): {miss.get('aiming_20_miss_ratio', 0):.2f}
  Miss ratio when aiming 19 (hits on 3+7 vs 19): {miss.get('aiming_19_miss_ratio', 0):.2f}

DOUBLES
  Double attempts: {doubles.get('attempts', 0)}
  Doubles hit:     {doubles.get('hit', 0)}
  Double hit %:    {doubles.get('hit_pct', 0)}%

CHECKOUT
  Checkout %:           {checkout.get('checkout_pct', 0)}% ({checkout.get('conversions', 0)}/{checkout.get('attempts', 0)} legs)
  Avg darts to win leg: {checkout.get('avg_darts_to_win', 0)}
  In range 41-170:      {co_range.get('41_to_170', {}).get('pct', 0)}% ({co_range.get('41_to_170', {}).get('won', 0)}/{co_range.get('41_to_170', {}).get('attempts', 0)})
  In range 2-40:        {co_range.get('2_to_40', {}).get('pct', 0)}% ({co_range.get('2_to_40', {}).get('won', 0)}/{co_range.get('2_to_40', {}).get('attempts', 0)})

BUSTS
  Total busts:          {busts.get('total', 0)}
  Bust rate:            {busts.get('bust_rate_pct', 0)}%
  Avg score before bust:{busts.get('avg_score_pre_bust', 0)}

BY GAME TYPE
{gt_text}
""".strip()

    # Skill-level context injected into every prompt
    skill_context = {
        "beginner": (
            "The player is a **beginner**. "
            "Use simple, jargon-free language. "
            "Focus on the absolute fundamentals: consistent stance, a smooth and repeatable throwing action, "
            "and building confidence on the 20-bed before worrying about doubles. "
            "Avoid overwhelming them — prioritise the 2-3 most impactful changes they can make right now. "
            "Suggest simple, fun practice routines they can do alone (e.g. Shanghai, Around the Clock, "
            "hitting the same number 9 times). Reassure them that the numbers will improve with repetition."
        ),
        "intermediate": (
            "The player is at an **intermediate** level. "
            "They understand the basics and are looking to build consistency and improve their average. "
            "Focus on scoring efficiency (maximising T20/T19 visits), reducing busts through better "
            "checkout awareness, and developing a reliable doubles game. "
            "Suggest structured practice routines such as doubles practice on a clock pattern, "
            "or focused T20/T19 sessions tracking hit rate."
        ),
        "advanced": (
            "The player is an **advanced** player. "
            "Assume familiarity with all standard checkouts and game strategy. "
            "Focus on marginal gains: consistency under pressure, strategic target selection "
            "(e.g. when to switch from T20 to T19 based on grouping), optimising checkout routes, "
            "and mental game. Suggest competitive practice formats and match simulation drills."
        ),
    }.get(skill_level, "")

    if style == "full":
        instruction = (
            "You are an expert darts coach. Using the performance metrics below, "
            "write a coaching analysis for this player. "
            f"{skill_context} "
            "Use these exact sections with markdown headings: "
            "### Scoring Power, ### Consistency, ### Segment Accuracy, ### Doubles & Checkout, ### Key Recommendations. "
            "Write 2-3 complete sentences per section. Reference specific numbers from the metrics. "
            "End with a ### Practice Routine section suggesting 2-3 specific drills appropriate to the player's level. "
            "IMPORTANT: Complete every sentence fully. Do not trail off or stop mid-thought. "
            "Finish with a complete sentence in Practice Routine."
        )
    else:
        instruction = (
            "You are an expert darts coach. Using the performance metrics below, "
            f"{skill_context} "
            "Give this player exactly 5 concise, actionable coaching tips. "
            "Format as a numbered list (1. 2. 3. 4. 5.). "
            "Each tip: one sentence referencing a specific metric, then one sentence with a concrete "
            "drill or practice routine appropriate to the player's skill level. "
            "IMPORTANT: Write all 5 tips in full. Complete every sentence. Do not stop before tip 5 is finished."
        )

    return f"{instruction}\n\n{metrics_summary}"