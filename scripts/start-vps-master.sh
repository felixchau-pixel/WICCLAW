#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
LOCK_FILE="$ROOT_DIR/.master-runtime.lock"

set -a
. "$ROOT_DIR/.env"
set +a

mkdir -p "${APPROVED_FOLDER:-$ROOT_DIR/local-box/files/approved}"
mkdir -p "${OPENCLAW_HOME:-$ROOT_DIR/.openclaw}"

if command -v flock >/dev/null 2>&1; then
  if flock -n "$LOCK_FILE" true; then
    exec flock "$LOCK_FILE" bash -lc "cd '$ROOT_DIR'; node scripts/openclaw-master.js > '$ROOT_DIR/.openclaw-gateway.log' 2>&1 & exec node server.js"
  fi

  echo "Master already running or lock held: $LOCK_FILE" >&2
  exit 1
fi

node scripts/openclaw-master.js > "${ROOT_DIR}/.openclaw-gateway.log" 2>&1 &
exec node server.js
