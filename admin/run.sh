#!/usr/bin/env sh
# Run the admin panel DIRECTLY on the host — for development, or on a host where
# Docker is available but you would rather not build the image.
#
# The normal way to run this panel is the container in compose.yaml:
#     docker compose --profile admin up -d --build admin
#
# Host requirements: python3 with admin/requirements.txt installed, plus access
# to /var/run/docker.sock (the `docker` group is enough — no root needed).
#
#   ./admin/run.sh                 # honours admin/.env and the environment
#   ADMIN_BIND_PORT=9000 ./admin/run.sh
#
set -eu

cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"

# Read the admin's own .env so this script and the app agree on the address (the
# app re-reads the same file). Quoted values and comments are handled by the app,
# not here, so keep this file simple.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi

HOST="${ADMIN_BIND_HOST:-127.0.0.1}"
PORT="${ADMIN_BIND_PORT:-8642}"

# Anything other than loopback needs a password; app/config.py enforces it, but
# say so here too rather than letting the process die with a traceback.
if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "::1" ] && [ "$HOST" != "localhost" ]; then
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    echo "ADMIN_BIND_HOST=$HOST 需要同时设置 ADMIN_PASSWORD（管理端会明文显示登录 token）。" >&2
    exit 1
  fi
fi

echo "dsh admin panel -> http://${HOST}:${PORT}/"
exec "$PYTHON" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --no-access-log