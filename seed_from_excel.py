#!/usr/bin/env python3
"""Import the EduShelf inventory datasheet into MySQL.

The importer accepts the original Excel workbook or the committed CSV export.
Rows are validated, thresholds are derived, stock statuses are recomputed, and
inventory is upserted by product code. One opening audit record is created per
product code the first time the importer sees it.

Usage:
    python seed_from_excel.py
    python seed_from_excel.py --file "Datasheet for Inventory Management System - Datasheet.csv"
    python seed_from_excel.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from db import get_db_cursor

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_XLSX = BASE_DIR / "Datasheet for Inventory Management System.xlsx"
DEFAULT_CSV = BASE_DIR / "Datasheet for Inventory Management System - Datasheet.csv"

EXPECTED_TITLE = "inventoryStock"
EXPECTED_HEADERS = (
    "product_code",
    "product_name",
    "category",
    "quantity",
    "unit_price",
    "location",
    "status",
)

THRESHOLD_OVERRIDES = {
    "BP-BLK-001": 15,
    "BP-RED-002": 10,
    "YP-STD-003": 10,
    "MRK-PER-006": 10,
    "MRK-WBO-007": 10,
}
DEFAULT_THRESHOLD = 5
ALLOWED_STATUSES = ("With Stock", "Low Stock", "Out of Stock")

UPSERT_SQL = """
    INSERT INTO inventoryStock
        (product_code, product_name, category, quantity, unit_price,
         location, threshold, status)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
        product_name = VALUES(product_name),
        category = VALUES(category),
        quantity = VALUES(quantity),
        unit_price = VALUES(unit_price),
        location = VALUES(location),
        threshold = VALUES(threshold),
        status = VALUES(status)
"""

INITIAL_LOG_CHECK_SQL = """
    SELECT 1
    FROM audit_logs
    WHERE product_code = %s AND action = 'Initial Record'
    LIMIT 1
"""

INITIAL_LOG_INSERT_SQL = """
    INSERT INTO audit_logs (user_id, product_code, action, details)
    VALUES (NULL, %s, 'Initial Record', %s)
"""


def calculate_status(quantity: int, threshold: int) -> str:
    """Return the stock status implied by quantity and threshold."""
    if quantity <= 0:
        return "Out of Stock"
    if quantity <= threshold:
        return "Low Stock"
    return "With Stock"


def parse_int(value: Any, field: str) -> int:
    """Parse a whole-number cell value."""
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"{field} must be a whole number (got {value!r}).") from exc
    if not number.is_finite() or number != number.to_integral_value():
        raise ValueError(f"{field} must be a whole number (got {value!r}).")
    return int(number)


def parse_price(value: Any) -> Decimal:
    """Parse and round a monetary cell value to two decimal places."""
    try:
        price = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"unit_price must be a number (got {value!r}).") from exc
    if not price.is_finite() or price < 0:
        raise ValueError(f"unit_price must be a non-negative number (got {value!r}).")
    return price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def resolve_default_file() -> Path:
    """Return the preferred datasheet path, falling back to the committed CSV."""
    if DEFAULT_XLSX.exists():
        return DEFAULT_XLSX
    return DEFAULT_CSV


def read_csv_rows(path: Path) -> list[tuple[Any, ...]]:
    """Read all rows from a CSV export of the datasheet."""
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [tuple(row) for row in csv.reader(handle)]


def read_xlsx_rows(path: Path) -> list[tuple[Any, ...]]:
    """Read all rows from the `Datasheet` sheet of an Excel workbook."""
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        if "Datasheet" not in workbook.sheetnames:
            names = ", ".join(workbook.sheetnames)
            raise ValueError(f"Sheet 'Datasheet' not found. Available sheets: {names}")
        sheet = workbook["Datasheet"]
        return [tuple(row) for row in sheet.iter_rows(values_only=True)]
    finally:
        workbook.close()


def read_rows(path: Path) -> list[tuple[Any, ...]]:
    """Dispatch to the CSV or XLSX reader based on the file extension."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return read_csv_rows(path)
    if suffix == ".xlsx":
        return read_xlsx_rows(path)
    raise ValueError("Unsupported file type. Use a .csv or .xlsx datasheet.")


def parse_datasheet(path: Path) -> list[dict[str, Any]]:
    """Validate the datasheet layout and return cleaned inventory records."""
    rows = read_rows(path)
    if len(rows) < 2:
        raise ValueError("Datasheet must contain a title row and a header row.")

    title = str(rows[0][0] or "").strip() if rows[0] else ""
    if title != EXPECTED_TITLE:
        raise ValueError(f"Cell A1 must be '{EXPECTED_TITLE}' (found {title!r}).")

    headers = tuple(
        str(value or "").strip() for value in rows[1][: len(EXPECTED_HEADERS)]
    )
    if headers != EXPECTED_HEADERS:
        raise ValueError(
            "Unexpected headers on row 2. "
            f"Expected {EXPECTED_HEADERS}, found {headers}."
        )

    records: list[dict[str, Any]] = []
    for line_number, raw_row in enumerate(rows[2:], start=3):
        values = tuple(raw_row[: len(EXPECTED_HEADERS)])
        if not any(str(value or "").strip() for value in values):
            continue
        if len(values) < len(EXPECTED_HEADERS):
            raise ValueError(f"Row {line_number} has fewer than 7 columns.")

        product_code = str(values[0] or "").strip()
        product_name = str(values[1] or "").strip()
        category = str(values[2] or "").strip()
        location = str(values[5] or "").strip()
        sheet_status = str(values[6] or "").strip()

        if not product_code or not product_name or not category or not location:
            raise ValueError(f"Row {line_number} has an empty required text field.")

        quantity = parse_int(values[3], f"Row {line_number} quantity")
        if quantity < 0:
            raise ValueError(f"Row {line_number} quantity must be non-negative.")
        unit_price = parse_price(values[4])

        threshold = THRESHOLD_OVERRIDES.get(product_code, DEFAULT_THRESHOLD)
        status = calculate_status(quantity, threshold)

        if sheet_status and sheet_status not in ALLOWED_STATUSES:
            print(f"Warning: row {line_number} has unknown status {sheet_status!r}.")
        elif sheet_status and sheet_status != status:
            print(
                f"Warning: row {line_number} ({product_code}) sheet status "
                f"{sheet_status!r} does not match computed status {status!r}."
            )

        records.append(
            {
                "product_code": product_code,
                "product_name": product_name,
                "category": category,
                "quantity": quantity,
                "unit_price": unit_price,
                "location": location,
                "threshold": threshold,
                "status": status,
            }
        )

    if not records:
        raise ValueError("Datasheet does not contain any inventory records.")
    return records


def seed_records(records: list[dict[str, Any]]) -> tuple[int, int]:
    """Upsert records and add missing opening audit logs."""
    logs_added = 0
    with get_db_cursor(commit=True) as cursor:
        for record in records:
            cursor.execute(
                UPSERT_SQL,
                (
                    record["product_code"],
                    record["product_name"],
                    record["category"],
                    record["quantity"],
                    record["unit_price"],
                    record["location"],
                    record["threshold"],
                    record["status"],
                ),
            )
            cursor.execute(INITIAL_LOG_CHECK_SQL, (record["product_code"],))
            if cursor.fetchone() is None:
                details = (
                    f"Opening stock recorded at {record['quantity']} units"
                )
                cursor.execute(
                    INITIAL_LOG_INSERT_SQL,
                    (record["product_code"], details),
                )
                logs_added += 1
    return len(records), logs_added


def print_dry_run(records: list[dict[str, Any]]) -> None:
    """Print a human-readable preview without touching the database."""
    header = f"{'CODE':<14} {'QTY':>5} {'THRESHOLD':>10} {'STATUS':<14} NAME"
    print(header)
    print("-" * len(header))
    for record in records:
        print(
            f"{record['product_code']:<14} "
            f"{record['quantity']:>5} "
            f"{record['threshold']:>10} "
            f"{record['status']:<14} "
            f"{record['product_name']}"
        )


def main() -> int:
    """Parse the datasheet and import it, or preview it in dry-run mode."""
    parser = argparse.ArgumentParser(
        description="Import the EduShelf inventory datasheet into MySQL."
    )
    parser.add_argument(
        "--file",
        type=Path,
        default=None,
        help="Path to a .csv or .xlsx datasheet (defaults to the committed file).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print the parsed rows without writing to MySQL.",
    )
    args = parser.parse_args()

    path = args.file.expanduser().resolve() if args.file else resolve_default_file()
    if not path.exists():
        print(f"Error: datasheet not found: {path}")
        return 1

    try:
        records = parse_datasheet(path)
    except (ValueError, OSError) as exc:
        print(f"Error: {exc}")
        return 1

    print(f"Parsed {len(records)} record(s) from {path}")
    if args.dry_run:
        print_dry_run(records)
        return 0

    try:
        processed, logs_added = seed_records(records)
    except Exception as exc:  # Database errors are reported without a traceback.
        print(f"Database import failed: {exc}")
        return 1

    print(
        f"Upserted {processed} inventory row(s); "
        f"added {logs_added} opening audit log(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
