"""
app/models/turn.py
------------------
Data-access layer for the `turns` table.

A turn represents one player's visit to the oche within a leg —
up to 3 darts. The turn record tracks:
    - The score at the start of the visit (score_before)
    - The score at the end (score_after), set when the turn is closed
    - How many darts were thrown
    - Whether the turn ended in a bust or checkout

Typical lifecycle:
    1. open_turn()       -- called when a player steps up
    2. get_active_turn() -- called on each dart to load current state
    3. close_turn()      -- called when the turn ends (bust/checkout/3 darts)
"""

from app.models.db import get_db


def get_active_turn(leg_id: int, player_id: int) -> dict | None:
    """
    Return the current open (not yet closed) turn for a player in a leg.

    A turn is considered open when score_after IS NULL, meaning it has
    not yet been closed by close_turn().

    Args:
        leg_id    -- the active leg
        player_id -- the player whose turn we're looking for

    Returns:
        A dict of the turn row, or None if no open turn exists.
    """
    db = get_db()
    cursor = db.cursor()

    sql = """
        SELECT
            id,
            leg_id,
            player_id,
            turn_number,
            score_before,
            score_after,
            is_bust,
            is_checkout,
            darts_thrown,
            created_at
        FROM turns
        WHERE leg_id = %s
          AND player_id = %s
          AND score_after IS NULL
        ORDER BY turn_number DESC
        LIMIT 1
    """

    cursor.execute(sql, (leg_id, player_id))
    return cursor.fetchone()


def open_turn(leg_id: int, player_id: int, score_before: int) -> int:
    """
    Create a new open turn for a player at the start of their visit.

    The turn_number is auto-incremented by counting existing turns in
    the leg, making it sequential across all players.

    Args:
        leg_id       -- the active leg
        player_id    -- the player stepping up to the oche
        score_before -- player's score at the start of this turn

    Returns:
        The auto-incremented ID of the new turn row.
    """
    db = get_db()
    cursor = db.cursor()

    # Determine the next sequential turn number within this leg
    cursor.execute("SELECT COUNT(*) AS turn_count FROM turns WHERE leg_id = %s", (leg_id,))
    
    turn_count = cursor.fetchone()['turn_count']
    turn_number = turn_count + 1

    sql = """
        INSERT INTO turns (
            leg_id,
            player_id,
            turn_number,
            score_before,
            darts_thrown
        )
        VALUES (%s, %s, %s, %s, 0)
    """

    cursor.execute(sql, (leg_id, player_id, turn_number, score_before))
    db.commit()
    return cursor.lastrowid


def increment_darts_thrown(turn_id: int) -> None:
    """
    Increment the darts_thrown counter on a turn by 1.

    Called after each dart is successfully recorded in the throws table.
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        "UPDATE turns SET darts_thrown = darts_thrown + 1 WHERE id = %s",
        (turn_id,)
    )
    db.commit()


def close_turn(
    turn_id: int,
    score_after: int,
    is_bust: bool,
    is_checkout: bool,
) -> None:
    """
    Close a turn by setting its final score and outcome flags.

    Once score_after is set (non-NULL), get_active_turn() will no longer
    return this turn, signalling that the player's visit is complete.

    Args:
        turn_id     -- the turn to close
        score_after -- the player's score at the end of the turn
                       (reverts to score_before on a bust — enforced by caller)
        is_bust     -- True if the turn ended in a bust
        is_checkout -- True if the turn ended in a checkout (leg won)
    """
    db = get_db()
    cursor = db.cursor()

    sql = """
        UPDATE turns
        SET
            score_after = %s,
            is_bust     = %s,
            is_checkout = %s
        WHERE id = %s
    """

    cursor.execute(sql, (score_after, is_bust, is_checkout, turn_id))
    db.commit()


def get_turn_by_id(turn_id: int) -> dict | None:
    """
    Fetch a single turn by its primary key.

    Used by the undo logic to reload turn state after a throw deletion.

    Args:
        turn_id -- the turn's primary key

    Returns:
        A dict of the turn row, or None if not found.
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        """
        SELECT
            id,
            leg_id,
            player_id,
            turn_number,
            score_before,
            score_after,
            is_bust,
            is_checkout,
            darts_thrown,
            created_at
        FROM turns
        WHERE id = %s
        """,
        (turn_id,)
    )
    return cursor.fetchone()


def decrement_darts_thrown(turn_id: int) -> None:
    """
    Decrement the darts_thrown counter on a turn by 1.

    Called by the undo route after a throw is deleted, to keep the
    counter in sync with the actual throws in the throws table.
    """
    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        """
        UPDATE turns
        SET
            darts_thrown = GREATEST(darts_thrown - 1, 0),
            score_after  = NULL,   -- re-open the turn so it's active again
            is_bust      = FALSE,
            is_checkout  = FALSE
        WHERE id = %s
        """,
        (turn_id,)
    )
    db.commit()
