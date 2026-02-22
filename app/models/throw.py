"""
app/models/throw.py
-------------------
Data-access layer for the `throws` table.

Responsibilities:
    - Insert individual dart throw records
    - Fetch throws by turn (used by stats service)

All SQL is written explicitly here — no ORM. Connections are obtained
via the db module's get_db() helper which manages the per-request
connection from the pool.
"""

from app.models.db import get_db


def insert_throw(
    turn_id: int,
    dart_number: int,
    segment: int,
    multiplier: int,
    points: int,
    score_before: int,
    score_after: int,
    is_bust: bool,
    is_checkout: bool,
) -> int:
    """
    Insert a single dart throw record into the throws table.

    Args:
        turn_id      -- FK to the parent turn
        dart_number  -- position within the turn (1, 2, or 3)
        segment      -- board segment hit (0–20 or 25)
        multiplier   -- 1=single, 2=double, 3=treble
        points       -- pre-calculated points value (segment * multiplier)
        score_before -- player's score before this dart landed
        score_after  -- player's score after this dart (unchanged on bust)
        is_bust      -- True if the throw caused a bust
        is_checkout  -- True if the throw won the leg

    Returns:
        The auto-incremented ID of the newly inserted throw row.
    """
    db = get_db()
    cursor = db.cursor()

    sql = """
        INSERT INTO throws (
            turn_id,
            dart_number,
            segment,
            multiplier,
            points,
            score_before,
            score_after,
            is_bust,
            is_checkout
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """

    cursor.execute(sql, (
        turn_id,
        dart_number,
        segment,
        multiplier,
        points,
        score_before,
        score_after,
        is_bust,
        is_checkout,
    ))

    db.commit()
    return cursor.lastrowid


def get_throws_for_turn(turn_id: int) -> list:
    """
    Fetch all throw records for a given turn, ordered by dart number.

    Used by the undo logic and stats service.

    Args:
        turn_id -- the turn to fetch throws for

    Returns:
        List of dicts, one per throw, ordered by dart_number ASC.
    """
    db = get_db()
    cursor = db.cursor()

    sql = """
        SELECT
            id,
            turn_id,
            dart_number,
            segment,
            multiplier,
            points,
            score_before,
            score_after,
            is_bust,
            is_checkout,
            created_at
        FROM throws
        WHERE turn_id = %s
        ORDER BY dart_number ASC
    """

    cursor.execute(sql, (turn_id,))
    return cursor.fetchall()


def delete_last_throw(turn_id: int) -> dict | None:
    """
    Delete the highest dart_number throw for a given turn (undo last dart).

    Returns the deleted throw record so the caller can reverse the score,
    or None if no throws exist for this turn.

    The caller (route layer) is responsible for updating the turn's
    darts_thrown count and the player's running score after deletion.
    """
    db = get_db()
    cursor = db.cursor()

    # Find the last dart thrown in this turn
    cursor.execute(
        """
        SELECT * FROM throws
        WHERE turn_id = %s
        ORDER BY dart_number DESC
        LIMIT 1
        """,
        (turn_id,)
    )
    last_throw = cursor.fetchone()

    if not last_throw:
        return None

    cursor.execute(
        "DELETE FROM throws WHERE id = %s",
        (last_throw['id'],)
    )
    db.commit()

    return last_throw
