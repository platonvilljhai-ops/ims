#!/usr/bin/env python3
"""Prepare the deployed database before the Flask web process starts.

The Railway MySQL service supplies connection details through ``MYSQL_URL`` (or
the equivalent ``MYSQL*`` variables). This script waits for the database,
applies the idempotent schema with the configured database name, then runs the
datasheet importer. It is safe to run on every deployment.
"""

from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

import mysql.connector

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import BASE_DIR, DB_NAME  # noqa: E402
from db import get_connection  # noqa: E402

SCHEMA_FILE = BASE_DIR / "schema.sql"
SEED_SCRIPT = BASE_DIR / "seed_from_excel.py"
MAX_DB_ATTEMPTS = 30
DB_RETRY_DELAY_SECONDS = 2


def wait_for_database() -> None:
    """Wait until MySQL accepts connections from the app service."""
    last_error: Exception | None = None
    for attempt in range(1, MAX_DB_ATTEMPTS + 1):
        connection = None
        try:
            connection = get_connection()
            print(f"MySQL is ready (attempt {attempt}).", flush=True)
            return
        except mysql.connector.Error as exc:
            last_error = exc
            print(
                f"Waiting for MySQL ({attempt}/{MAX_DB_ATTEMPTS}): {exc}",
                flush=True,
            )
            time.sleep(DB_RETRY_DELAY_SECONDS)
        finally:
            if connection is not None:
                connection.close()
    raise RuntimeError(f"MySQL did not become ready: {last_error}")


def schema_statements() -> list[str]:
    """Read schema.sql without its hardcoded database create/use statements."""
    sql = SCHEMA_FILE.read_text(encoding="utf-8")

    # Railway creates the database and supplies its name via MYSQLDATABASE.
    sql = re.sub(
        r"CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+edushelf_db\s+"
        r"CHARACTER\s+SET\s+utf8mb4\s+COLLATE\s+utf8mb4_unicode_ci\s*;",
        "",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(r"USE\s+edushelf_db\s*;", "", sql, flags=re.IGNORECASE)
    sql = sql.replace("edushelf_db", DB_NAME)

    statements: list[str] = []
    for raw_statement in sql.split(";"):
        without_comments = "\n".join(
            line
            for line in raw_statement.splitlines()
            if not line.strip().startswith("--")
        ).strip()
        if without_comments:
            statements.append(without_comments)
    return statements


def apply_schema() -> None:
    """Apply the idempotent schema and seed data to the configured database."""
    connection = get_connection()
    cursor = connection.cursor()
    try:
        for statement in schema_statements():
            cursor.execute(statement)
        connection.commit()
        print(f"Applied schema to database '{DB_NAME}'.", flush=True)
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def seed_datasheet() -> None:
    """Run the existing importer so inventory and opening logs are present."""
    subprocess.run(
        [sys.executable, str(SEED_SCRIPT)],
        cwd=str(PROJECT_ROOT),
        check=True,
    )


def main() -> int:
    """Run the full database preparation sequence."""
    wait_for_database()
    apply_schema()
    seed_datasheet()
    print("Database preparation complete.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
