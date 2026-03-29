#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const bridgeRoot = path.join(projectRoot, '.openclaw-bridge');
const requestDir = path.join(bridgeRoot, 'requests');
const responseDir = path.join(bridgeRoot, 'responses');
const processingDir = path.join(bridgeRoot, 'processing');

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runScript(scriptName, input) {
  const command = `${shellEscape(process.execPath)} ${shellEscape(path.join(projectRoot, 'scripts', scriptName))}`;
  const child = spawnSync('bash', ['-lc', command], {
    cwd: projectRoot,
    env: process.env,
    input: input ? JSON.stringify(input) : '',
    encoding: 'utf8',
    timeout: Number(process.env.OPENCLAW_TIMEOUT_MS || 120000)
  });

  if (child.error && child.status === null) {
    return { ok: false, error: child.error.message, stdout: child.stdout || '', stderr: child.stderr || '' };
  }

  return {
    ok: child.status === 0,
    status: child.status || 0,
    stdout: String(child.stdout || '').trim(),
    stderr: String(child.stderr || '').trim()
  };
}

function parseOutput(result, fallbackMessage) {
  const raw = result.stdout || result.stderr || '';
  try {
    return JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: raw || fallbackMessage
    };
  }
}

function handleRequest(payload) {
  if (payload.kind === 'status') {
    return parseOutput(runScript('openclaw-status.js'), 'OpenClaw status failed');
  }

  if (payload.kind === 'chat') {
    return parseOutput(runScript('openclaw-master-chat.js', payload.input), 'OpenClaw chat failed');
  }

  if (payload.kind === 'task') {
    return parseOutput(runScript('openclaw-task-runner.js', payload.input), 'OpenClaw task failed');
  }

  return {
    ok: false,
    error: `Unsupported bridge request kind: ${payload.kind}`
  };
}

function processOne(fileName) {
  const sourcePath = path.join(requestDir, fileName);
  const processingPath = path.join(processingDir, fileName);
  const responsePath = path.join(responseDir, fileName);

  try {
    fs.renameSync(sourcePath, processingPath);
  } catch {
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(processingPath, 'utf8'));
  } catch (error) {
    writeJson(responsePath, { ok: false, error: error.message || 'Invalid bridge payload' });
    fs.rmSync(processingPath, { force: true });
    return;
  }

  const response = handleRequest(payload);
  writeJson(responsePath, response);
  fs.rmSync(processingPath, { force: true });
}

function tick() {
  const files = fs.readdirSync(requestDir).filter((name) => name.endsWith('.json')).sort();
  for (const fileName of files) {
    processOne(fileName);
  }
}

function main() {
  ensureDir(requestDir);
  ensureDir(responseDir);
  ensureDir(processingDir);

  setInterval(tick, 200);
  tick();
}

main();
