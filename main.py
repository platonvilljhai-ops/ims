"""Compatibility WSGI entry point for Railway/Railpack.

Railpack's Flask detector defaults to ``gunicorn main:app``.  The real
application lives in ``app.py``; this shim makes either module path work so a
deploy can never crash with ``ModuleNotFoundError: No module named 'main'``.
"""

from app import app

# Some WSGI servers look for ``application`` instead of ``app``.
application = app

if __name__ == "__main__":
    app.run()
