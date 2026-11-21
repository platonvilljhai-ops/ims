"""Flask API and static host for the EduShelf inventory management system."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import mysql.connector
from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    request,
    send_from_directory,
    session,
)
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from mysql.connector import IntegrityError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from auth_utils import admin_required, login_required
from config import (
    ALLOWED_ROLES,
    BASE_DIR,
    CORS_ORIGINS,
    DB_NAME,
    FLASK_DEBUG,
    MAX_LOGIN_ATTEMPTS,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    PORT,
    PUBLIC_ROLES,
    SECRET_KEY,
    SESSION_COOKIE_SECURE,
    SESSION_LIFETIME_HOURS,
)
from db import get_db_cursor

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
PRODUCT_CODE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$")
ALLOWED_STATIC_EXTENSIONS = {
    ".html",
    ".css",
    ".js",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".webp",
    ".woff",
    ".woff2",
}
LOCKED_MESSAGE = (
    "Account is locked due to multiple failed login attempts. "
    "Please contact an Administrator."
)

SELECT_ITEM_SQL = """
    SELECT product_code, product_name, category, quantity, unit_price,
           location, threshold, status, updated_at
    FROM inventoryStock
    WHERE product_code = %s
"""

SELECT_ITEM_FOR_UPDATE_SQL = """
    SELECT product_code, product_name, category, quantity, unit_price,
           location, threshold, status
    FROM inventoryStock
    WHERE product_code = %s
    FOR UPDATE
"""

REQUEST_SELECT_SQL = """
    SELECT r.request_id, r.product_code, i.product_name,
           i.quantity AS available_quantity, r.user_id, u.full_name,
           r.quantity_requested, r.purpose, r.status, r.reviewed_by,
           rv.full_name AS reviewer_name, r.created_at, r.updated_at
    FROM supply_requests r
    JOIN inventoryStock i ON i.product_code = r.product_code
    JOIN users u ON u.user_id = r.user_id
    LEFT JOIN users rv ON rv.user_id = r.reviewed_by
"""


class EduShelfJSONProvider(DefaultJSONProvider):
    """Serialize Decimal and datetime values consistently."""

    @staticmethod
    def default(value: Any) -> Any:
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.isoformat().replace("+00:00", "Z")
        if isinstance(value, date):
            return value.isoformat()
        return DefaultJSONProvider.default(value)


class ApiError(Exception):
    """Base class for expected API errors."""

    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationError(ApiError):
    """The request payload or query string is invalid."""

    status_code = 400


class ForbiddenError(ApiError):
    """The authenticated account may not perform this action."""

    status_code = 403


class NotFoundError(ApiError):
    """The requested record does not exist."""

    status_code = 404


class ConflictError(ApiError):
    """The request conflicts with current state."""

    status_code = 409


class InsufficientStockError(ApiError):
    """An approval would drive stock below zero."""

    status_code = 400

    def __init__(self) -> None:
        super().__init__("Insufficient stock available")


if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not configured. Copy .env.example to .env and set a value."
    )

app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=SECRET_KEY,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=SESSION_COOKIE_SECURE,
    PERMANENT_SESSION_LIFETIME=timedelta(hours=SESSION_LIFETIME_HOURS),
    MAX_CONTENT_LENGTH=1024 * 1024,
)
app.json = EduShelfJSONProvider(app)

if CORS_ORIGINS:
    CORS(
        app,
        resources={r"/api/*": {"origins": CORS_ORIGINS}},
        supports_credentials=True,
    )


def success_response(
    data: Any = None, status_code: int = 200
) -> tuple[Response, int]:
    """Return the standard success envelope."""
    return jsonify({"status": "success", "data": data}), status_code


def error_response(message: str, status_code: int) -> tuple[Response, int]:
    """Return the standard error envelope."""
    return jsonify({"status": "error", "message": message}), status_code


def get_json_object() -> dict[str, Any]:
    """Return the request body if it is a JSON object."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    return payload


def clean_string(
    payload: dict[str, Any],
    key: str,
    label: str,
    max_length: int,
) -> str:
    """Read, trim, and length-check a required text field."""
    raw = payload.get(key)
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise ValidationError(f"{label} must be text.")
    value = raw.strip()
    if not value:
        raise ValidationError(f"{label} is required.")
    if len(value) > max_length:
        raise ValidationError(f"{label} must be at most {max_length} characters.")
    return value


def parse_int(
    payload: dict[str, Any],
    key: str,
    label: str,
    minimum: int,
    maximum: int | None = None,
) -> int:
    """Parse a JSON value as a whole number within the given bounds."""
    raw = payload.get(key)
    if raw is None or isinstance(raw, bool):
        raise ValidationError(f"{label} must be a whole number.")
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValidationError(f"{label} must be a whole number.") from exc
    if not value.is_finite() or value != value.to_integral_value():
        raise ValidationError(f"{label} must be a whole number.")
    result = int(value)
    if result < minimum:
        raise ValidationError(f"{label} must be at least {minimum}.")
    if maximum is not None and result > maximum:
        raise ValidationError(f"{label} must be at most {maximum}.")
    return result


def parse_price(payload: dict[str, Any], key: str, label: str) -> Decimal:
    """Parse a JSON value as a non-negative money amount."""
    raw = payload.get(key)
    if raw is None or isinstance(raw, bool):
        raise ValidationError(f"{label} must be a number.")
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValidationError(f"{label} must be a number.") from exc
    if not value.is_finite() or value < 0:
        raise ValidationError(f"{label} must be a non-negative number.")
    if value > Decimal("99999999.99"):
        raise ValidationError(f"{label} is too large.")
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def normalize_email(value: Any) -> str:
    """Validate and lowercase an email address."""
    if value is None:
        raise ValidationError("Email is required.")
    if not isinstance(value, str):
        raise ValidationError("Email must be text.")
    email = value.strip().lower()
    if not email:
        raise ValidationError("Email is required.")
    if len(email) > 100:
        raise ValidationError("Email must be at most 100 characters.")
    if not EMAIL_PATTERN.fullmatch(email):
        raise ValidationError("Enter a valid email address.")
    return email


def calculate_status(quantity: int, threshold: int) -> str:
    """Return the stock status implied by quantity and threshold."""
    if quantity <= 0:
        return "Out of Stock"
    if quantity <= threshold:
        return "Low Stock"
    return "With Stock"


def user_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Return the public fields of a user record."""
    return {
        "user_id": row["user_id"],
        "full_name": row["full_name"],
        "email": row["email"],
        "role": row["role"],
    }


def parse_item_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize an item create/update payload."""
    product_code = clean_string(payload, "product_code", "Product code", 20)
    if not PRODUCT_CODE_PATTERN.fullmatch(product_code):
        raise ValidationError(
            "Product code may contain only letters, numbers, dots, hyphens, "
            "and underscores, and must start with a letter or number."
        )
    product_name = clean_string(payload, "product_name", "Product name", 100)
    category = clean_string(payload, "category", "Category", 50)
    location = clean_string(payload, "location", "Location", 50)
    quantity = parse_int(payload, "quantity", "Quantity", 0, 2_147_483_647)
    unit_price = parse_price(payload, "unit_price", "Unit price")
    threshold = parse_int(payload, "threshold", "Threshold", 1, 2_147_483_647)
    return {
        "product_code": product_code,
        "product_name": product_name,
        "category": category,
        "location": location,
        "quantity": quantity,
        "unit_price": unit_price,
        "threshold": threshold,
        "status": calculate_status(quantity, threshold),
    }


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


@app.post("/api/auth/register")
def register() -> tuple[Response, int]:
    """Create a Warehouse Staff account."""
    payload = get_json_object()
    full_name = clean_string(payload, "full_name", "Full name", 100)
    email = normalize_email(payload.get("email"))
    password = payload.get("password")
    if not isinstance(password, str) or not password:
        raise ValidationError("Password is required.")
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValidationError(
            f"Password must be at least {PASSWORD_MIN_LENGTH} characters."
        )
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValidationError(
            f"Password must be at most {PASSWORD_MAX_LENGTH} characters."
        )

    requested_role = payload.get("role", "Warehouse Staff")
    if not isinstance(requested_role, str) or requested_role not in ALLOWED_ROLES:
        raise ValidationError("Role must be 'Administrator' or 'Warehouse Staff'.")
    if requested_role not in PUBLIC_ROLES:
        raise ForbiddenError(
            "Administrator accounts cannot be self-registered. "
            "Contact an Administrator."
        )

    password_hash = generate_password_hash(password)
    try:
        with get_db_cursor(commit=True) as cursor:
            cursor.execute("SELECT user_id FROM users WHERE email = %s", (email,))
            if cursor.fetchone() is not None:
                raise ConflictError("An account with this email already exists.")
            cursor.execute(
                """
                INSERT INTO users (full_name, email, password_hash, role)
                VALUES (%s, %s, %s, %s)
                """,
                (full_name, email, password_hash, "Warehouse Staff"),
            )
            user_id = cursor.lastrowid
            cursor.execute(
                """
                INSERT INTO audit_logs (user_id, product_code, action, details)
                VALUES (%s, NULL, 'User Registered', %s)
                """,
                (
                    user_id,
                    f"Registered Warehouse Staff account for {email}.",
                ),
            )
            cursor.execute(
                """
                SELECT user_id, full_name, email, role
                FROM users
                WHERE user_id = %s
                """,
                (user_id,),
            )
            user = cursor.fetchone()
    except IntegrityError as exc:
        if exc.errno == 1062:
            raise ConflictError(
                "An account with this email already exists."
            ) from exc
        raise

    if user is None:
        raise RuntimeError("The created account could not be loaded.")
    return success_response(user_payload(user), 201)


@app.post("/api/auth/login")
def login() -> tuple[Response, int]:
    """Authenticate an account and start a session."""
    payload = get_json_object()
    email = normalize_email(payload.get("email"))
    password = payload.get("password")
    if not isinstance(password, str) or not password:
        raise ValidationError("Password is required.")

    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            SELECT user_id, full_name, email, password_hash, role,
                   failed_attempts, is_locked
            FROM users
            WHERE email = %s
            FOR UPDATE
            """,
            (email,),
        )
        user = cursor.fetchone()
        if user is None:
            return error_response("Invalid email or password", 401)

        if int(user["is_locked"]) == 1:
            return error_response(LOCKED_MESSAGE, 403)

        if not check_password_hash(user["password_hash"], password):
            attempts = int(user["failed_attempts"]) + 1
            if attempts >= MAX_LOGIN_ATTEMPTS:
                cursor.execute(
                    """
                    UPDATE users
                    SET failed_attempts = %s, is_locked = 1
                    WHERE user_id = %s
                    """,
                    (attempts, user["user_id"]),
                )
                cursor.execute(
                    """
                    INSERT INTO audit_logs
                        (user_id, product_code, action, details)
                    VALUES (%s, NULL, 'Security Alert: Account Locked', %s)
                    """,
                    (
                        user["user_id"],
                        "Account locked after "
                        f"{MAX_LOGIN_ATTEMPTS} consecutive failed login attempts.",
                    ),
                )
                return error_response(LOCKED_MESSAGE, 403)

            cursor.execute(
                """
                UPDATE users
                SET failed_attempts = %s
                WHERE user_id = %s
                """,
                (attempts, user["user_id"]),
            )
            remaining = MAX_LOGIN_ATTEMPTS - attempts
            return error_response(
                f"Invalid email or password. {remaining} attempt(s) remaining.",
                401,
            )

        cursor.execute(
            """
            UPDATE users
            SET failed_attempts = 0, is_locked = 0
            WHERE user_id = %s
            """,
            (user["user_id"],),
        )
        cursor.execute(
            """
            INSERT INTO audit_logs (user_id, product_code, action, details)
            VALUES (%s, NULL, 'User Login', %s)
            """,
            (user["user_id"], f"Signed in as {user['role']}."),
        )

    session.clear()
    session.permanent = True
    session["user_id"] = user["user_id"]
    session["full_name"] = user["full_name"]
    session["email"] = user["email"]
    session["role"] = user["role"]
    return success_response(user_payload(user))


@app.post("/api/auth/logout")
def logout() -> tuple[Response, int]:
    """Clear the current session."""
    session.clear()
    return success_response({"message": "Logged out successfully."})


@app.get("/api/auth/me")
@login_required
def get_current_user() -> tuple[Response, int]:
    """Return the authenticated session user."""
    return success_response(
        {
            "user_id": session["user_id"],
            "full_name": session["full_name"],
            "email": session["email"],
            "role": session["role"],
        }
    )


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


@app.get("/api/items")
@login_required
def get_items() -> tuple[Response, int]:
    """Return the full inventory catalog ordered by product code."""
    with get_db_cursor() as cursor:
        cursor.execute(
            """
            SELECT product_code, product_name, category, quantity, unit_price,
                   location, threshold, status, updated_at
            FROM inventoryStock
            ORDER BY product_code ASC
            """
        )
        items = cursor.fetchall()
    return success_response(items)


@app.get("/api/items/<string:product_code>")
@login_required
def get_item(product_code: str) -> tuple[Response, int]:
    """Return one inventory item and its audit history."""
    with get_db_cursor() as cursor:
        cursor.execute(SELECT_ITEM_SQL, (product_code,))
        item = cursor.fetchone()
        if item is None:
            raise NotFoundError("Item not found.")
        cursor.execute(
            """
            SELECT l.log_id, l.user_id, u.full_name, l.product_code,
                   l.action, l.details, l.created_at
            FROM audit_logs l
            LEFT JOIN users u ON u.user_id = l.user_id
            WHERE l.product_code = %s
            ORDER BY l.created_at DESC, l.log_id DESC
            """,
            (product_code,),
        )
        logs = cursor.fetchall()
    return success_response({"item": item, "logs": logs})


@app.post("/api/items")
@login_required
def create_item() -> tuple[Response, int]:
    """Create a new inventory item."""
    payload = get_json_object()
    item = parse_item_payload(payload)
    try:
        with get_db_cursor(commit=True) as cursor:
            cursor.execute(
                "SELECT 1 FROM inventoryStock WHERE product_code = %s",
                (item["product_code"],),
            )
            if cursor.fetchone() is not None:
                raise ConflictError(
                    f"Product Code ({item['product_code']}) already exists."
                )
            cursor.execute(
                """
                INSERT INTO inventoryStock
                    (product_code, product_name, category, quantity, unit_price,
                     location, threshold, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    item["product_code"],
                    item["product_name"],
                    item["category"],
                    item["quantity"],
                    item["unit_price"],
                    item["location"],
                    item["threshold"],
                    item["status"],
                ),
            )
            details = (
                f"Created {item['product_name']} ({item['product_code']}) with "
                f"{item['quantity']} units at P{item['unit_price']:.2f} each."
            )
            cursor.execute(
                """
                INSERT INTO audit_logs (user_id, product_code, action, details)
                VALUES (%s, %s, 'Item Created', %s)
                """,
                (session["user_id"], item["product_code"], details),
            )
            cursor.execute(SELECT_ITEM_SQL, (item["product_code"],))
            created = cursor.fetchone()
    except IntegrityError as exc:
        if exc.errno == 1062:
            raise ConflictError(
                f"Product Code ({item['product_code']}) already exists."
            ) from exc
        raise

    return success_response(created, 201)


@app.put("/api/items/<string:product_code>")
@login_required
def update_item(product_code: str) -> tuple[Response, int]:
    """Update an inventory item and record a field-level diff."""
    payload = get_json_object()
    updated = parse_item_payload(payload)
    new_code = updated["product_code"]

    try:
        with get_db_cursor(commit=True) as cursor:
            cursor.execute(SELECT_ITEM_FOR_UPDATE_SQL, (product_code,))
            current = cursor.fetchone()
            if current is None:
                raise NotFoundError("Item not found.")

            if new_code.lower() != current["product_code"].lower():
                cursor.execute(
                    """
                    SELECT 1
                    FROM inventoryStock
                    WHERE product_code = %s AND product_code <> %s
                    """,
                    (new_code, current["product_code"]),
                )
                if cursor.fetchone() is not None:
                    raise ConflictError(
                        f"Product Code ({new_code}) is already in use."
                    )

            changes: list[str] = []
            if current["product_code"] != new_code:
                changes.append(
                    f"SKU: {current['product_code']} -> {new_code}"
                )
            if current["product_name"] != updated["product_name"]:
                changes.append(
                    f"Name: {current['product_name']} -> "
                    f"{updated['product_name']}"
                )
            if current["category"] != updated["category"]:
                changes.append(
                    f"Category: {current['category']} -> "
                    f"{updated['category']}"
                )
            if int(current["quantity"]) != updated["quantity"]:
                changes.append(
                    f"Qty: {current['quantity']} -> {updated['quantity']}"
                )
            if current["unit_price"] != updated["unit_price"]:
                changes.append(
                    f"Price: P{current['unit_price']:.2f} -> "
                    f"P{updated['unit_price']:.2f}"
                )
            if current["location"] != updated["location"]:
                changes.append(
                    f"Location: {current['location']} -> "
                    f"{updated['location']}"
                )
            if int(current["threshold"]) != updated["threshold"]:
                changes.append(
                    f"Min Threshold: {current['threshold']} -> "
                    f"{updated['threshold']}"
                )
            if current["status"] != updated["status"]:
                changes.append(
                    f"Status: {current['status']} -> {updated['status']}"
                )

            cursor.execute(
                """
                UPDATE inventoryStock
                SET product_code = %s, product_name = %s, category = %s,
                    quantity = %s, unit_price = %s, location = %s,
                    threshold = %s, status = %s
                WHERE product_code = %s
                """,
                (
                    new_code,
                    updated["product_name"],
                    updated["category"],
                    updated["quantity"],
                    updated["unit_price"],
                    updated["location"],
                    updated["threshold"],
                    updated["status"],
                    current["product_code"],
                ),
            )
            details = " | ".join(changes) if changes else "No field changes."
            cursor.execute(
                """
                INSERT INTO audit_logs (user_id, product_code, action, details)
                VALUES (%s, %s, 'Record Edited', %s)
                """,
                (session["user_id"], new_code, details),
            )
            cursor.execute(SELECT_ITEM_SQL, (new_code,))
            result = cursor.fetchone()
    except IntegrityError as exc:
        if exc.errno == 1062:
            raise ConflictError(
                f"Product Code ({new_code}) is already in use."
            ) from exc
        raise

    return success_response(result)


@app.delete("/api/items/<string:product_code>")
@login_required
@admin_required
def delete_item(product_code: str) -> tuple[Response, int]:
    """Delete an inventory item (Administrator only)."""
    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            SELECT product_code, product_name, quantity
            FROM inventoryStock
            WHERE product_code = %s
            FOR UPDATE
            """,
            (product_code,),
        )
        item = cursor.fetchone()
        if item is None:
            raise NotFoundError("Item not found.")
        details = (
            f"Deleted {item['product_name']} ({item['product_code']}) "
            f"with {item['quantity']} units on hand."
        )
        cursor.execute(
            """
            INSERT INTO audit_logs (user_id, product_code, action, details)
            VALUES (%s, %s, 'Item Deleted', %s)
            """,
            (session["user_id"], item["product_code"], details),
        )
        cursor.execute(
            "DELETE FROM inventoryStock WHERE product_code = %s",
            (item["product_code"],),
        )
    return success_response({"product_code": item["product_code"]})


# ---------------------------------------------------------------------------
# Supply requests
# ---------------------------------------------------------------------------


@app.get("/api/requests")
@login_required
def get_requests() -> tuple[Response, int]:
    """Return all supply requests with item and requester details."""
    with get_db_cursor() as cursor:
        cursor.execute(
            REQUEST_SELECT_SQL
            + " ORDER BY r.created_at DESC, r.request_id DESC"
        )
        requests = cursor.fetchall()
    return success_response(requests)


@app.post("/api/requests")
@login_required
def create_request() -> tuple[Response, int]:
    """Create a pending supply request."""
    payload = get_json_object()
    product_code = clean_string(payload, "product_code", "Product code", 20)
    quantity_requested = parse_int(
        payload,
        "quantity_requested",
        "Quantity requested",
        1,
        2_147_483_647,
    )
    purpose = clean_string(payload, "purpose", "Purpose", 255)

    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            "SELECT product_name FROM inventoryStock WHERE product_code = %s",
            (product_code,),
        )
        product = cursor.fetchone()
        if product is None:
            raise NotFoundError("Product not found.")
        cursor.execute(
            """
            INSERT INTO supply_requests
                (product_code, user_id, quantity_requested, purpose, status)
            VALUES (%s, %s, %s, %s, 'Pending')
            """,
            (product_code, session["user_id"], quantity_requested, purpose),
        )
        request_id = cursor.lastrowid
        details = (
            f"Requested {quantity_requested} units of "
            f"{product['product_name']} ({product_code}). Purpose: {purpose}"
        )
        cursor.execute(
            """
            INSERT INTO audit_logs (user_id, product_code, action, details)
            VALUES (%s, %s, 'Supply Requested', %s)
            """,
            (session["user_id"], product_code, details),
        )
        cursor.execute(
            REQUEST_SELECT_SQL + " WHERE r.request_id = %s",
            (request_id,),
        )
        created = cursor.fetchone()
    return success_response(created, 201)


@app.patch("/api/requests/<int:request_id>")
@login_required
@admin_required
def review_request(request_id: int) -> tuple[Response, int]:
    """Approve or reject a pending supply request (Administrator only)."""
    payload = get_json_object()
    new_status = payload.get("status")
    if new_status not in ("Approved", "Rejected"):
        raise ValidationError("Status must be 'Approved' or 'Rejected'.")

    with get_db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            SELECT request_id, product_code, quantity_requested, status, purpose
            FROM supply_requests
            WHERE request_id = %s
            FOR UPDATE
            """,
            (request_id,),
        )
        request_row = cursor.fetchone()
        if request_row is None:
            raise NotFoundError("Supply request not found.")
        if request_row["status"] != "Pending":
            raise ConflictError("This request has already been reviewed.")

        cursor.execute(
            "SELECT product_name FROM inventoryStock WHERE product_code = %s",
            (request_row["product_code"],),
        )
        product = cursor.fetchone()
        if product is None:
            raise NotFoundError("Product not found.")

        if new_status == "Approved":
            cursor.execute(
                """
                SELECT quantity, threshold
                FROM inventoryStock
                WHERE product_code = %s
                FOR UPDATE
                """,
                (request_row["product_code"],),
            )
            stock = cursor.fetchone()
            if stock is None:
                raise NotFoundError("Product not found.")
            available = int(stock["quantity"])
            requested = int(request_row["quantity_requested"])
            if available < requested:
                raise InsufficientStockError()
            new_quantity = available - requested
            new_stock_status = calculate_status(
                new_quantity, int(stock["threshold"])
            )
            cursor.execute(
                """
                UPDATE inventoryStock
                SET quantity = %s, status = %s
                WHERE product_code = %s
                """,
                (new_quantity, new_stock_status, request_row["product_code"]),
            )
            cursor.execute(
                """
                UPDATE supply_requests
                SET status = 'Approved', reviewed_by = %s
                WHERE request_id = %s
                """,
                (session["user_id"], request_id),
            )
            details = (
                f"Approved request #{request_id} for {requested} units of "
                f"{product['product_name']} ({request_row['product_code']}). "
                f"Stock {available} -> {new_quantity}."
            )
            action = "Request Approved"
        else:
            cursor.execute(
                """
                UPDATE supply_requests
                SET status = 'Rejected', reviewed_by = %s
                WHERE request_id = %s
                """,
                (session["user_id"], request_id),
            )
            details = (
                f"Rejected request #{request_id} for "
                f"{request_row['quantity_requested']} units of "
                f"{product['product_name']} ({request_row['product_code']}). "
                f"Purpose: {request_row['purpose']}"
            )
            action = "Request Rejected"

        cursor.execute(
            """
            INSERT INTO audit_logs (user_id, product_code, action, details)
            VALUES (%s, %s, %s, %s)
            """,
            (
                session["user_id"],
                request_row["product_code"],
                action,
                details,
            ),
        )
        cursor.execute(
            REQUEST_SELECT_SQL + " WHERE r.request_id = %s",
            (request_id,),
        )
        updated = cursor.fetchone()
    return success_response(updated)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


@app.get("/api/logs")
@login_required
def get_logs() -> tuple[Response, int]:
    """Return audit logs with optional keyword and action filters."""
    query = """
        SELECT l.log_id, l.user_id, u.full_name, l.product_code,
               l.action, l.details, l.created_at
        FROM audit_logs l
        LEFT JOIN users u ON u.user_id = l.user_id
    """
    conditions: list[str] = []
    params: list[Any] = []

    keyword = request.args.get("q", "").strip()
    action = request.args.get("action", "").strip()
    if keyword:
        like = f"%{keyword[:100]}%"
        conditions.append(
            "(l.details LIKE %s OR l.action LIKE %s OR "
            "l.product_code LIKE %s OR u.full_name LIKE %s)"
        )
        params.extend([like, like, like, like])
    if action:
        conditions.append("l.action = %s")
        params.append(action[:100])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY l.created_at DESC, l.log_id DESC"

    with get_db_cursor() as cursor:
        cursor.execute(query, tuple(params))
        logs = cursor.fetchall()
    return success_response(logs)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------


@app.errorhandler(ApiError)
def handle_api_error(error: ApiError) -> tuple[Response, int]:
    """Convert expected API errors into JSON envelopes."""
    return error_response(error.message, error.status_code)


@app.errorhandler(IntegrityError)
def handle_integrity_error(error: IntegrityError) -> tuple[Response, int]:
    """Return 409 for uncaught database integrity conflicts."""
    app.logger.warning("Database integrity error: %s", error)
    return error_response("The request conflicts with existing data.", 409)


@app.errorhandler(mysql.connector.Error)
def handle_database_error(error: mysql.connector.Error) -> tuple[Response, int]:
    """Return a generic 500 response for database failures."""
    app.logger.error("Database error: %s", error)
    return error_response("A database error occurred. Please try again.", 500)


@app.errorhandler(400)
def handle_bad_request(error: HTTPException) -> tuple[Response, int]:
    """Return JSON for malformed requests."""
    return error_response("Bad request.", 400)


@app.errorhandler(401)
def handle_unauthorized(error: HTTPException) -> tuple[Response, int]:
    """Return JSON for unauthenticated requests."""
    return error_response("Authentication required.", 401)


@app.errorhandler(403)
def handle_forbidden(error: HTTPException) -> tuple[Response, int]:
    """Return JSON for forbidden requests."""
    return error_response("Forbidden.", 403)


@app.errorhandler(404)
def handle_not_found(error: HTTPException) -> tuple[Response, int]:
    """Return JSON for missing resources."""
    return error_response("Resource not found.", 404)


@app.errorhandler(405)
def handle_method_not_allowed(error: HTTPException) -> tuple[Response, int]:
    """Return JSON for unsupported methods."""
    return error_response("Method not allowed.", 405)


@app.errorhandler(413)
def handle_payload_too_large(error: HTTPException) -> tuple[Response, int]:
    """Return JSON when the request body exceeds the configured limit."""
    return error_response("Request body is too large.", 413)


@app.errorhandler(500)
def handle_server_error(error: HTTPException) -> tuple[Response, int]:
    """Return a generic JSON error without leaking internals."""
    original = getattr(error, "original_exception", None)
    if original is not None:
        app.logger.error("Unhandled server error", exc_info=original)
    else:
        app.logger.error("Unhandled server error: %s", error)
    return error_response("An unexpected server error occurred.", 500)


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------


@app.get("/")
def serve_index() -> Response:
    """Serve the login page."""
    return send_from_directory(str(BASE_DIR), "index.html")


@app.get("/<path:filename>")
def serve_static(filename: str) -> Response:
    """Serve an allowlisted frontend file from the project root."""
    path = Path(filename)
    if any(part.startswith(".") for part in path.parts):
        abort(404)
    if path.suffix.lower() not in ALLOWED_STATIC_EXTENSIONS:
        abort(404)
    return send_from_directory(str(BASE_DIR), filename)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app.logger.info(
        "Starting EduShelf on port %s (database: %s)", PORT, DB_NAME
    )
    app.run(host="127.0.0.1", port=PORT, debug=FLASK_DEBUG)
