#!/bin/sh
set -eu

python deploy/prepare_db.py

gunicorn \
    --bind 127.0.0.1:5000 \
    --workers "${WEB_CONCURRENCY:-1}" \
    --threads "${WEB_THREADS:-4}" \
    --timeout 120 \
    --access-logfile - \
    --error-logfile - \
    app:app &

exec nginx -g "daemon off;"
