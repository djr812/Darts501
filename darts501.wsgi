"""
darts501.wsgi
-------------
mod_wsgi entry point for Apache2 deployment under a subpath
e.g. https://djrogers.net.au/Darts501/

The SCRIPT_NAME middleware wrapper tells Flask (via Werkzeug) that the
application is mounted at /Darts501, so:
  - request.script_root == '/Darts501'
  - url_for('static', ...) generates /Darts501/static/...
  - All redirect URLs are generated with the correct prefix

Deployed at: /var/www/Darts501/darts501.wsgi
"""

import sys
import os

# Add the project root to the Python path so 'app' and 'config' are importable
sys.path.insert(0, '/var/www/Darts501')

# Set environment so Flask uses ProductionConfig
os.environ['FLASK_ENV'] = 'production'

from app import create_app

# Create the Flask application
_flask_app = create_app()


def application(environ, start_response):
    """
    WSGI callable.

    Forces SCRIPT_NAME to /Darts501 so Flask's URL generation always
    includes the subpath prefix. Without this, url_for() and redirects
    produce paths relative to /, breaking subpath deployments.
    """
    environ['SCRIPT_NAME'] = '/Darts501'
    # PATH_INFO must not include SCRIPT_NAME — strip it if Apache has
    # already prepended it (some mod_wsgi versions do this)
    path_info = environ.get('PATH_INFO', '')
    if path_info.startswith('/Darts501'):
        environ['PATH_INFO'] = path_info[len('/Darts501'):]
    return _flask_app(environ, start_response)
