#!/bin/sh
set -eu

PORT="${PORT:-5000}"
WEB_CONCURRENCY="${WEB_CONCURRENCY:-1}"
WEB_THREADS="${WEB_THREADS:-4}"

# Ensure the deployed database exists with the current schema and seed data.
python deploy/prepare_db.py

exec gunicorn \
  --bind "0.0.0.0:${PORT}" \
  --workers "${WEB_CONCURRENCY}" \
  --threads "${WEB_THREADS}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile - \
  app:app
