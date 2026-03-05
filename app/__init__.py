"""
app/__init__.py
---------------
Flask application factory.

Usage:
    from app import create_app
    app = create_app()

Keeping app creation inside a factory function (rather than at module
level) makes it easy to:
    - Swap configs between dev, test, and production
    - Avoid circular imports (blueprints import from `app`, not the other way)
    - Instantiate multiple app instances in tests
"""

from flask import Flask, redirect, url_for
from config import DevelopmentConfig, ProductionConfig


def create_app(config_object=None):
    """
    Create and configure the Flask application.

    Args:
        config_object -- a config class from config.py, or None to
                         auto-select based on FLASK_ENV environment variable.

    Returns:
        A configured Flask app instance.
    """
    app = Flask(__name__, instance_relative_config=False)

    # --- Load configuration ---
    if config_object is None:
        import os
        env = os.getenv("FLASK_ENV", "development")
        config_object = ProductionConfig if env == "production" else DevelopmentConfig

    app.config.from_object(config_object)

    # --- Initialise extensions ---
    _init_db(app)

    # --- Register blueprints ---
    _register_blueprints(app)

    return app


def _init_db(app: Flask) -> None:
    """
    Set up the database connection teardown.

    The actual connection is created lazily per-request inside get_db().
    Here we only register the teardown hook that closes it afterwards.
    """
    from app.models.db import close_db
    app.teardown_appcontext(close_db)


def _register_blueprints(app: Flask) -> None:
    """
    Import and register all route blueprints.

    All API endpoints are grouped under the /api prefix. The views
    blueprint serves the HTML shell at the root.

    Add new blueprints here as the project grows — one import per module.
    """

    # --- API blueprints ---
    from app.routes.api.throws  import throws_bp
    from app.routes.api.players import players_bp
    from app.routes.api.matches import matches_bp
    from app.routes.api.legs    import legs_bp
    from app.routes.api.turns   import turns_bp
    from app.routes.api.stats    import stats_bp
    from app.routes.api.analysis import analysis_bp
    from app.routes.api.cricket  import cricket_bp
    from app.routes.api.shanghai  import shanghai_bp
    from app.routes.api.baseball  import baseball_bp
    from app.routes.api.killer    import killer_bp

    api_blueprints = [
        throws_bp,
        players_bp,
        matches_bp,
        legs_bp,
        turns_bp,
        stats_bp,
        analysis_bp,
        cricket_bp,
        shanghai_bp,
        baseball_bp,
        killer_bp,
    ]

    for bp in api_blueprints:
        app.register_blueprint(bp, url_prefix="/api")

    # --- HTML shell (served at /) ---
    from app.routes.views import views_bp
    app.register_blueprint(views_bp)

    # --- Favicon redirect ---
    # Browsers request /favicon.ico automatically; redirect to the static PNG
    @app.route('/favicon.ico')
    def favicon():
        return redirect(url_for('static', filename='favicon.png'))