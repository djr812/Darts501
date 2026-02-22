"""
app/models/db.py
----------------
Database connection management for the Flask application.

Uses PyMySQL with a per-request connection pattern — one connection is
opened when first needed within a request and closed automatically when
the request context tears down (via close_db registered in create_app).

This keeps connection handling simple and appropriate for a single-user
local network application. If concurrent usage grows significantly, this
can be replaced with a connection pool (e.g. via DBUtils or SQLAlchemy
pool-only mode) without changing any model code.

Configuration keys read from app.config:
    DB_HOST     -- MySQL host (default: localhost)
    DB_PORT     -- MySQL port (default: 3306)
    DB_USER     -- MySQL user
    DB_PASSWORD -- MySQL password
    DB_NAME     -- database name (default: darts)
"""

import pymysql
import pymysql.cursors
from flask import current_app, g


def get_db():
    """
    Return the database connection for the current request context.

    Creates a new connection if one does not already exist for this
    request. Subsequent calls within the same request return the same
    connection object (stored in Flask's `g`).

    Returns:
        A PyMySQL connection object.

    Raises:
        pymysql.MySQLError -- if the connection cannot be established.
    """
    if "db" not in g:
        g.db = pymysql.connect(
            host     = current_app.config.get("DB_HOST", "localhost"),
            port     = current_app.config.get("DB_PORT", 3306),
            user     = current_app.config["DB_USER"],
            password = current_app.config["DB_PASSWORD"],
            database = current_app.config.get("DB_NAME", "darts"),
            # Return column values as Python-native types (e.g. bool for TINYINT(1))
            cursorclass = pymysql.cursors.DictCursor,
            # Automatically decode bytes to str
            charset  = "utf8mb4",
            # Raise exceptions on warnings (catches silent data truncation etc.)
            sql_mode = "STRICT_TRANS_TABLES",
        )
    return g.db


def close_db(exception=None):
    """
    Close the database connection at the end of the request.

    Registered as a teardown handler in create_app() so it runs
    automatically after every request, whether or not an exception occurred.

    Args:
        exception -- passed by Flask's teardown mechanism; unused here but
                     required by the teardown signature.
    """
    db = g.pop("db", None)
    if db is not None:
        db.close()


def execute_one(sql: str, params: tuple = ()) -> dict | None:
    """
    Execute a query and return the first result row as a dict, or None.

    Convenience helper for single-row lookups, reducing boilerplate in
    model functions.

    Args:
        sql    -- parameterised SQL string (use %s placeholders)
        params -- tuple of values to bind

    Returns:
        A dict of {column: value} for the first row, or None.
    """
    db = get_db()
    cursor = db.cursor(pymysql.cursors.DictCursor)
    cursor.execute(sql, params)
    return cursor.fetchone()


def execute_all(sql: str, params: tuple = ()) -> list:
    """
    Execute a query and return all result rows as a list of dicts.

    Args:
        sql    -- parameterised SQL string (use %s placeholders)
        params -- tuple of values to bind

    Returns:
        List of dicts, one per row. Empty list if no rows matched.
    """
    db = get_db()
    cursor = db.cursor(pymysql.cursors.DictCursor)
    cursor.execute(sql, params)
    return cursor.fetchall()


def execute_write(sql: str, params: tuple = ()) -> int:
    """
    Execute an INSERT, UPDATE, or DELETE statement and commit.

    Args:
        sql    -- parameterised SQL string (use %s placeholders)
        params -- tuple of values to bind

    Returns:
        The lastrowid for INSERT statements, or the rowcount for
        UPDATE/DELETE statements.
    """
    db = get_db()
    cursor = db.cursor()
    cursor.execute(sql, params)
    db.commit()
    return cursor.lastrowid or cursor.rowcount
