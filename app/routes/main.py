from flask import render_template, request, redirect, url_for, jsonify
from app import app, SessionLocal
from app.models import Turn, Player

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        multiplier = request.form.get("multiplier")
        score_input = request.form.get("score")
        if multiplier and score_input:
            try:
                score = int(score_input)
                multiplier_value = {"single": 1, "double": 2, "treble": 3}.get(multiplier)
                current_total = 501
                if multiplier_value and 1 <= score <= 20:
                    new_score = multiplier_value * score
                    remaining_total = max(0, current_total - new_score)
                    new_turn = Turn(score=new_score, remaining_score=remaining_total)
                    db = SessionLocal()
                    db.add(new_turn)
                    db.commit()
                    if remaining_total == 0:
                        return redirect(url_for("score", success="true"))
                    else:
                        turns = db.query(Turn).all()
                        if len(turns) >= 3 and remaining_total > 0:
                            return redirect(url_for("score", success="false"))
                else:
                    return "Invalid score or multiplier."
            except ValueError:
                return "Please enter a valid number for the score."
        else:
            return "Multiplier and score are required."
    return render_template("index.html")

@app.route("/score/<string:success>")
def score(success):
    db = SessionLocal()
    if success.lower() == "true":
        message = "Congratulations! You scored exactly to zero!"
    else:
        message = "You have reached your limit of 3 scoring opportunities. Starting a new round..."
    turns = db.query(Turn).all()
    total_scored = sum(turn.score for turn in turns)
    remaining_total = max(0, 501 - total_scored)
    return render_template(
        "score.html",
        success=success.lower() == "true",
        message=message,
        turns=turns,
        remaining_total=remaining_total,
    )

@app.route("/players/active")
def get_active_players():
    try:
        active_players = Player.query.filter(Player.is_active).all()
        players_list = [
            {
                "id": player.id,
                "name": player.name,
                "nickname": player.nickname
            }
            for player in active_players
        ]
        return jsonify(players_list)
    except Exception as e:
        app.logger.error(f"Error fetching active players: {str(e)}")
        return jsonify({"error": "Failed to fetch active players"}), 500