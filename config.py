"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _settings_from_database_url(url: str) -> dict[str, str | int]:
    """Parse MYSQL_URL or DATABASE_URL into database settings."""
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": unquote(parsed.path.lstrip("/").split("?", 1)[0])
        or "edushelf_db",
    }


_database_url = os.getenv("MYSQL_URL") or os.getenv("DATABASE_URL") or ""
_url_settings = _settings_from_database_url(_database_url) if _database_url else {}

DB_HOST = (
    _url_settings.get("host")
    or os.getenv("DB_HOST")
    or os.getenv("MYSQLHOST")
    or "127.0.0.1"
)
DB_PORT = int(
    _url_settings.get("port")
    or os.getenv("DB_PORT")
    or os.getenv("MYSQLPORT")
    or 3306
)
DB_USER = (
    _url_settings.get("user")
    or os.getenv("DB_USER")
    or os.getenv("MYSQLUSER")
    or "root"
)
DB_PASSWORD = str(
    _url_settings.get("password")
    or os.getenv("DB_PASSWORD")
    or os.getenv("MYSQLPASSWORD")
    or ""
)
DB_NAME = (
    _url_settings.get("database")
    or os.getenv("DB_NAME")
    or os.getenv("MYSQLDATABASE")
    or "edushelf_db"
)

DB_CONFIG = {
    "host": DB_HOST,
    "port": DB_PORT,
    "user": DB_USER,
    "password": DB_PASSWORD,
    "database": DB_NAME,
    "charset": "utf8mb4",
    "collation": "utf8mb4_unicode_ci",
    "autocommit": False,
    "connection_timeout": 10,
    "use_pure": True,
    "time_zone": "+00:00",
}

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
_session_cookie_secure = os.getenv("SESSION_COOKIE_SECURE", "").strip()
SESSION_COOKIE_SECURE = (
    _session_cookie_secure.lower() == "true"
    if _session_cookie_secure
    else False
)
SESSION_LIFETIME_HOURS = 8
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
FLASK_DEBUG = os.getenv("FLASK_DEBUG", "0").lower() in {"1", "true", "yes"}
PORT = int(os.getenv("PORT", "5000"))

MAX_LOGIN_ATTEMPTS = 3
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
DEFAULT_THRESHOLD = 5

ALLOWED_ROLES = ("Administrator", "Warehouse Staff")
PUBLIC_ROLES = ("Warehouse Staff",)
INVENTORY_STATUSES = ("With Stock", "Low Stock", "Out of Stock")
REQUEST_STATUSES = ("Pending", "Approved", "Rejected")
