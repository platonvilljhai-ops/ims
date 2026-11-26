#!/bin/bash
set -euo pipefail

python deploy/prepare_db.py

gunicorn \
    --bind 127.0.0.1:5000 \
    --workers "${WEB_CONCURRENCY:-1}" \
    --threads "${WEB_THREADS:-4}" \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    app:app &
gunicorn_pid=$!

nginx -g "daemon off;" &
nginx_pid=$!

cleanup() {
    kill "$gunicorn_pid" "$nginx_pid" 2>/dev/null || true
    wait "$gunicorn_pid" "$nginx_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait -n "$gunicorn_pid" "$nginx_pid"
