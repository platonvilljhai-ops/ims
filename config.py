"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "edushelf_db")

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
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
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
