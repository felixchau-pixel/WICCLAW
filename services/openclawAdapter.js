const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const statusScript = path.join(projectRoot, 'scripts', 'openclaw-status.js');
const runnerScript = path.join(projectRoot, 'scripts', 'openclaw-task-runner.js');
const chatScript = path.join(projectRoot, 'scripts', 'openclaw-master-chat.js');

function runNodeScript(scriptPath, input) {
  const command = `'${process.execPath.replace(/'/g, `'\\''`)}' '${scriptPath.replace(/'/g, `'\\''`)}'`;
  return spawnSync('bash', ['-lc', command], {
    cwd: projectRoot,
    env: process.env,
    input,
    encoding: 'utf8',
    timeout: Number(process.env.OPENCLAW_TIMEOUT_MS || 120000)
  });
}

function tryParseJson(value) {
  try {
    return JSON.parse(String(value || '').trim());
  } catch {
    return null;
  }
}

function getOpenClawStatus() {
  const child = runNodeScript(statusScript, '');

  if (child.error && child.status === null) {
    return {
      enabled: true,
      ready: false,
      running: false,
      blockers: [child.error.message]
    };
  }

  const parsed = tryParseJson(child.stdout);
  if (parsed) {
    return parsed;
  }

  return {
    enabled: true,
    ready: false,
    running: false,
    blockers: [String(child.stderr || child.stdout || 'Unable to read OpenClaw status').trim()]
  };
}

async function executeTaskViaOpenClaw({ deviceId, taskId, task }) {
  const child = runNodeScript(runnerScript, JSON.stringify({ deviceId, taskId, task }));

  if (child.error && child.status === null) {
    return {
      ok: false,
      available: false,
      error: child.error.message
    };
  }

  const parsed = tryParseJson(child.stdout);
  if (parsed) {
    return parsed;
  }

  const stderr = String(child.stderr || '').trim();
  return {
    ok: false,
    available: child.status === 0,
    error: stderr || 'OpenClaw returned invalid output',
    raw: String(child.stdout || '').trim()
  };
}

async function converseWithOpenClaw(input) {
  const child = runNodeScript(chatScript, JSON.stringify(input));

  if (child.error && child.status === null) {
    return {
      ok: false,
      available: false,
      error: child.error.message
    };
  }

  const parsed = tryParseJson(child.stdout);
  if (parsed) {
    return parsed;
  }

  return {
    ok: false,
    available: child.status === 0,
    error: String(child.stderr || child.stdout || 'OpenClaw returned invalid output').trim()
  };
}

module.exports = {
  executeTaskViaOpenClaw,
  getOpenClawStatus,
  converseWithOpenClaw
};
