"""Reusable authentication and role-based access decorators."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, TypeVar, cast

from flask import jsonify, session

ViewFunction = TypeVar("ViewFunction", bound=Callable[..., Any])


def login_required(view: ViewFunction) -> ViewFunction:
    """Reject requests that do not have an authenticated session."""

    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if "user_id" not in session:
            return jsonify(
                {"status": "error", "message": "Authentication required."}
            ), 401
        return view(*args, **kwargs)

    return cast(ViewFunction, wrapped)


def admin_required(view: ViewFunction) -> ViewFunction:
    """Reject authenticated users who are not administrators."""

    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if "user_id" not in session:
            return jsonify(
                {"status": "error", "message": "Authentication required."}
            ), 401
        if session.get("role") != "Administrator":
            return jsonify(
                {"status": "error", "message": "Administrator access required."}
            ), 403
        return view(*args, **kwargs)

    return cast(ViewFunction, wrapped)
