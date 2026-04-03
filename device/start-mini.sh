#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="wicclaw-mini.service"
SERVICE_TARGET="/etc/systemd/system/$SERVICE_NAME"
SCRIPT_OWNER="$(stat -c '%U' "$SCRIPT_DIR" 2>/dev/null || printf 'wicma')"
SERVICE_USER="${SUDO_USER:-${SCRIPT_OWNER:-wicma}}"

mkdir -p "$SCRIPT_DIR/approved" "$SCRIPT_DIR/runtime/sync" "$SCRIPT_DIR/runtime/state"

repair_runtime_ownership() {
  if [[ "$(id -u)" -ne 0 || "$SERVICE_USER" == "root" ]]; then
    return 0
  fi

  chown -R "$SERVICE_USER:$SERVICE_USER" \
    "$SCRIPT_DIR/approved" \
    "$SCRIPT_DIR/runtime"
}

resolve_node_bin() {
  if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
    printf '%s\n' "$NODE_BIN"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidate
  for candidate in \
    "/home/${SERVICE_USER}/.nvm/versions/node/"*/bin/node \
    "/usr/local/bin/node" \
    "/usr/bin/node"
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

write_service_file() {
  local node_bin
  node_bin="$(resolve_node_bin)" || {
    echo "Unable to locate node binary for systemd service" >&2
    exit 1
  }

  cat >"$SERVICE_TARGET" <<EOF
[Unit]
Description=WicClaw Mini Assistant Appliance
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$SCRIPT_DIR
Environment=HOME=/home/$SERVICE_USER
Environment=NODE_BIN=$node_bin
Environment=PATH=$(dirname "$node_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$SCRIPT_DIR/start-mini.sh --run
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
}

if [[ "${1:-}" == "--run" ]]; then
  MINI_SERVICE_DISABLED_FLAG=""
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    MINI_SERVICE_DISABLED_FLAG="$(awk -F= '/^MINI_SERVICE_DISABLED=/{print $2; exit}' "$SCRIPT_DIR/.env" 2>/dev/null || true)"
  fi

  if [[ "${MINI_SERVICE_DISABLED_FLAG}" == "true" ]]; then
    if command -v systemctl >/dev/null 2>&1 && [[ "$(id -u)" -eq 0 ]]; then
      systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
      systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
    exit 0
  fi

  NODE_EXECUTABLE="$(resolve_node_bin)" || {
    echo "Unable to locate node binary" >&2
    exit 127
  }
  cd "$SCRIPT_DIR"
  repair_runtime_ownership
  if [[ "$(id -u)" -eq 0 && "$SERVICE_USER" != "root" ]]; then
    if command -v runuser >/dev/null 2>&1; then
      exec runuser -u "$SERVICE_USER" -- "$NODE_EXECUTABLE" mini-agent.js
    fi

    if command -v su >/dev/null 2>&1; then
      exec su -s /bin/bash -c "'$NODE_EXECUTABLE' mini-agent.js" "$SERVICE_USER"
    fi
  fi

  exec "$NODE_EXECUTABLE" mini-agent.js
fi

if command -v systemctl >/dev/null 2>&1; then
  if [[ "$(id -u)" -eq 0 ]]; then
    write_service_file
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME"
    systemctl status "$SERVICE_NAME" --no-pager || true
    exit 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    NODE_BIN="$(resolve_node_bin)" || {
      echo "Unable to locate node binary for systemd service" >&2
      exit 1
    }
    sudo bash -lc "cat >'$SERVICE_TARGET' <<'EOF'
[Unit]
Description=WicClaw Mini Assistant Appliance
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$SCRIPT_DIR
Environment=HOME=/home/$SERVICE_USER
Environment=NODE_BIN=$NODE_BIN
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$SCRIPT_DIR/start-mini.sh --run
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF"
    sudo systemctl daemon-reload
    sudo systemctl enable --now "$SERVICE_NAME"
    sudo systemctl status "$SERVICE_NAME" --no-pager || true
    exit 0
  fi
fi

cd "$SCRIPT_DIR"
exec node mini-agent.js
