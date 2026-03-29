#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  ".env.template"
  "CLAUDE.md"
  "server.js"
  "core/env.js"
  "core/openclawSkills.js"
  "core/taskValidator.js"
  "core/permissions.js"
  "services/openclawAdapter.js"
  "services/taskDispatch.js"
  "services/masterAgent.js"
  "services/assistantAgent.js"
  "services/onboardingLink.js"
  "services/syncManifest.js"
  "device/mini-agent.js"
  "device/executor.js"
  "device/wicclaw-mini.service"
  "local-box/files/executor.js"
  "scripts/openclaw-master.js"
  "scripts/openclaw-master-chat.js"
  "scripts/openclaw-status.js"
  "scripts/openclaw-task-runner.js"
  "scripts/test-assistant-appliance.js"
  "prompts/telegram-live.md"
)

for file in "${required_files[@]}"; do
  [[ -f "$file" ]] || {
    echo "Missing required file: $file"
    exit 1
  }
done

node --check server.js >/dev/null || {
  echo "server.js syntax check failed"
  exit 1
}

node --check services/telegram.js >/dev/null || {
  echo "services/telegram.js syntax check failed"
  exit 1
}

node --check services/masterAgent.js >/dev/null || {
  echo "services/masterAgent.js syntax check failed"
  exit 1
}

node --check services/assistantAgent.js >/dev/null || {
  echo "services/assistantAgent.js syntax check failed"
  exit 1
}

node --check scripts/openclaw-master-chat.js >/dev/null || {
  echo "scripts/openclaw-master-chat.js syntax check failed"
  exit 1
}

node --check device/mini-agent.js >/dev/null || {
  echo "device/mini-agent.js syntax check failed"
  exit 1
}

node --check scripts/test-assistant-appliance.js >/dev/null || {
  echo "scripts/test-assistant-appliance.js syntax check failed"
  exit 1
}

node --check scripts/openclaw-master.js >/dev/null || {
  echo "scripts/openclaw-master.js syntax check failed"
  exit 1
}

echo "Master readiness check passed"
