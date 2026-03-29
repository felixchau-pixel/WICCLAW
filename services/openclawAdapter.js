const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const bridgeRoot = path.join(projectRoot, '.openclaw-bridge');
const requestDir = path.join(bridgeRoot, 'requests');
const responseDir = path.join(bridgeRoot, 'responses');

function getConfiguredGatewayAddress() {
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH ||
    process.env.OPENCLAW_CONFIG ||
    path.join(projectRoot, '.openclaw', 'openclaw.json');

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {}

  const gateway = config.gateway || {};
  const host =
    process.env.OPENCLAW_HOST ||
    gateway.customBindHost ||
    (gateway.bind === 'custom' ? gateway.host : '') ||
    '127.0.0.1';
  const port = Number(process.env.OPENCLAW_PORT || gateway.port || 18789);
  return { host, port };
}

async function bridgeRequest(kind, input = {}) {
  const timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS || 120000);
  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(responseDir, { recursive: true });

  const requestId = `${Date.now()}-${crypto.randomUUID()}`;
  const requestPath = path.join(requestDir, `${requestId}.json`);
  const responsePath = path.join(responseDir, `${requestId}.json`);

  fs.writeFileSync(requestPath, JSON.stringify({ kind, input }));

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(responsePath)) {
      const raw = fs.readFileSync(responsePath, 'utf8');
      fs.rmSync(responsePath, { force: true });
      return JSON.parse(raw);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`OpenClaw bridge timed out after ${timeoutMs}ms`);
}

async function getOpenClawStatus() {
  const localPackageJson = path.join(projectRoot, 'node_modules', 'openclaw', 'package.json');
  let version = null;

  try {
    const manifest = JSON.parse(fs.readFileSync(localPackageJson, 'utf8'));
    version = `OpenClaw ${manifest.version || 'unknown'}`;
  } catch (error) {
    return {
      enabled: true,
      ready: false,
      running: false,
      version: null,
      gateway: null,
      blockers: [error.message || 'OpenClaw runtime files are missing']
    };
  }

  const gateway = getConfiguredGatewayAddress();
  const response = await bridgeRequest('status');
  if (response && typeof response === 'object') {
    return {
      ...response,
      version: response.version || version,
      gateway: response.gateway || { host: gateway.host, port: gateway.port }
    };
  }

  return {
    enabled: true,
    ready: false,
    running: false,
    version,
    gateway: {
      host: gateway.host,
      port: gateway.port
    },
    blockers: ['OpenClaw bridge returned invalid status payload']
  };
}

async function executeTaskViaOpenClaw({ deviceId, taskId, task }) {
  const parsed = await bridgeRequest('task', { deviceId, taskId, task });
  return {
    ok: Boolean(parsed?.ok),
    available: Boolean(parsed?.available ?? true),
    result: parsed?.result || null,
    error: parsed?.error || null,
    raw: parsed
  };
}

async function converseWithOpenClaw(input) {
  const parsed = await bridgeRequest('chat', input);
  return {
    ok: Boolean(parsed?.ok),
    available: Boolean(parsed?.available ?? true),
    reply: String(parsed?.reply || '').trim(),
    proposedActions: Array.isArray(parsed?.proposedActions) ? parsed.proposedActions : [],
    blockers: Array.isArray(parsed?.blockers) ? parsed.blockers : [],
    error: parsed?.error || null
  };
}

module.exports = {
  executeTaskViaOpenClaw,
  getOpenClawStatus,
  converseWithOpenClaw
};
