"""Database connection helpers for the EduShelf application."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import mysql.connector
from mysql.connector import MySQLConnection

from config import DB_CONFIG


def get_connection() -> MySQLConnection:
    """Create and return a new MySQL connection using the configured settings."""
    return mysql.connector.connect(**DB_CONFIG)


@contextmanager
def get_db_cursor(commit: bool = False) -> Iterator[Any]:
    """Yield a dictionary cursor with guaranteed cleanup.

    The transaction is committed when ``commit`` is true and the block exits
    normally. Any exception triggers a rollback. The cursor and connection are
    always closed in the ``finally`` block.
    """
    connection: MySQLConnection | None = None
    cursor: Any | None = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        yield cursor
        if commit:
            connection.commit()
    except Exception:
        if connection is not None:
            connection.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None:
            connection.close()
