#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
LOCK_FILE="$ROOT_DIR/.master-runtime.lock"
export PATH="$ROOT_DIR/bin:$PATH"

unset DISABLE_TELEGRAM_POLLING

set -a
. "$ROOT_DIR/.env"
set +a

mkdir -p "${APPROVED_FOLDER:-$ROOT_DIR/local-box/files/approved}"
mkdir -p "${OPENCLAW_HOME:-$ROOT_DIR/.openclaw}"
mkdir -p "$ROOT_DIR/.openclaw-bridge/requests" "$ROOT_DIR/.openclaw-bridge/responses" "$ROOT_DIR/.openclaw-bridge/processing"

if command -v flock >/dev/null 2>&1; then
  if flock -n "$LOCK_FILE" true; then
    exec flock --close "$LOCK_FILE" bash -lc "cd '$ROOT_DIR'; export PATH='$ROOT_DIR/bin':\"\$PATH\"; node scripts/openclaw-master.js > '$ROOT_DIR/.openclaw-gateway.log' 2>&1 & node scripts/openclaw-bridge.js > '$ROOT_DIR/.openclaw-bridge.log' 2>&1 & exec node server.js"
  fi

  echo "Master already running or lock held: $LOCK_FILE" >&2
  exit 1
fi

node scripts/openclaw-master.js > "${ROOT_DIR}/.openclaw-gateway.log" 2>&1 &
node scripts/openclaw-bridge.js > "${ROOT_DIR}/.openclaw-bridge.log" 2>&1 &
exec node server.js
