#!/usr/bin/env bash
# setup-db.sh — start Postgres and wait until it's accepting connections

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Starting Postgres..."
docker compose -f "$REPO_ROOT/docker-compose.yml" up -d postgres

echo "Waiting for Postgres to be ready..."
MAX_TRIES=30
TRIES=0
until docker compose -f "$REPO_ROOT/docker-compose.yml" exec -T postgres \
    pg_isready -U ouroboros -d ouroboros > /dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -ge "$MAX_TRIES" ]; then
    echo "ERROR: Postgres did not become ready after ${MAX_TRIES} attempts." >&2
    exit 1
  fi
  echo "  waiting... (${TRIES}/${MAX_TRIES})"
  sleep 2
done

echo "Postgres is ready."
