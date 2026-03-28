#!/usr/bin/env node

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

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
  const command = `'${process.execPath.replace(/'/g, `'\\''`)}' '${path.join(__dirname, 'openclaw-master.js').replace(/'/g, `'\\''`)}' gateway status --json`;
  const child = spawnSync('bash', ['-lc', command], {
    cwd: projectRoot,
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

const binary = checkBinary();
const gateway = binary.ok ? getGatewayStatus() : { ok: false, error: binary.error };

const payload = {
  enabled: true,
  ready: Boolean(binary.ok && gateway.ok),
  running: Boolean(gateway.ok),
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

process.stdout.write(`${JSON.stringify(payload)}\n`);
process.exit(payload.ready ? 0 : 1);
