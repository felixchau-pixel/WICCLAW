#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const openclawHome =
  process.env.OPENCLAW_STATE_DIR ||
  process.env.OPENCLAW_HOME ||
  path.join(projectRoot, '.openclaw');
const openclawConfigPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  process.env.OPENCLAW_CONFIG ||
  path.join(openclawHome, 'openclaw.json');
const projectBinDir = path.join(projectRoot, 'bin');

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function checkBinary() {
  const localEntrypoint = path.join(projectRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  const localPackageJson = path.join(projectRoot, 'node_modules', 'openclaw', 'package.json');

  if (!fs.existsSync(localEntrypoint) || !fs.existsSync(localPackageJson)) {
    return { ok: false, error: 'OpenClaw runtime files are missing' };
  }

  const manifest = JSON.parse(fs.readFileSync(localPackageJson, 'utf8'));
  return {
    ok: true,
    version: `OpenClaw ${manifest.version || 'unknown'}`
  };
}

function getGatewayStatus() {
  let command = [path.join(projectRoot, 'node_modules', '.bin', 'openclaw')];
  if (!fs.existsSync(command[0])) {
    const localEntrypoint = path.join(projectRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
    command = fs.existsSync(localEntrypoint) ? [process.execPath, localEntrypoint] : ['openclaw'];
  }

  const child = spawnSync(command[0], [...command.slice(1), 'gateway', 'status', '--json'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: openclawHome,
      OPENCLAW_HOME: openclawHome,
      OPENCLAW_CONFIG_PATH: openclawConfigPath,
      OPENCLAW_CONFIG: openclawConfigPath,
      OPENCLAW_SKILLS_PATH: path.join(projectRoot, 'skills'),
      OPENCLAW_MEMORY_PATH: path.join(openclawHome, 'memory'),
      HOME: process.env.HOME || os.homedir(),
      PATH: `${projectBinDir}:${process.env.PATH || ''}`
    },
    encoding: 'utf8'
  });

  if (child.error && child.status === null) {
    return { ok: false, error: child.error.message };
  }

  const parsed = parseJson(child.stdout);
  if (parsed) {
    return { ok: child.status === 0, data: parsed };
  }

  return {
    ok: child.status === 0,
    error: String(child.stderr || child.stdout || '').trim()
  };
}

function deriveRuntimeFlags(gatewayStatus) {
  const data = gatewayStatus?.data || {};
  const portStatus = data.port?.status || '';
  const hasListeners = Array.isArray(data.port?.listeners) && data.port.listeners.length > 0;
  const rpcOk = data.rpc?.ok === true;
  const running = rpcOk || portStatus === 'busy' || hasListeners;
  const ready = rpcOk;

  return { ready, running };
}

const binary = checkBinary();
const gateway = binary.ok ? getGatewayStatus() : { ok: false, error: binary.error };
const runtime = deriveRuntimeFlags(gateway);

const payload = {
  enabled: true,
  ready: Boolean(binary.ok && runtime.ready),
  running: Boolean(runtime.running),
  version: binary.version || null,
  gateway: gateway.data || null,
  blockers: []
};

if (!binary.ok) {
  payload.blockers.push(binary.error);
}

if (binary.ok && !gateway.ok) {
  payload.blockers.push(gateway.error || 'Gateway not ready');
}

if (binary.ok && gateway.data && !runtime.ready) {
  const rpcError = gateway.data.rpc?.error;
  if (rpcError) {
    payload.blockers.push(rpcError);
  } else if (!runtime.running) {
    payload.blockers.push('Gateway not ready');
  }
}

process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exit(payload.ready ? 0 : 1);
