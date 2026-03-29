#!/usr/bin/env node

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

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

function findOpenClawCommand() {
  if (process.env.OPENCLAW_BIN) {
    return [process.env.OPENCLAW_BIN];
  }

  const localBinary = path.join(projectRoot, 'node_modules', '.bin', 'openclaw');
  if (require('fs').existsSync(localBinary)) {
    return [localBinary];
  }

  const localEntrypoint = path.join(projectRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  if (require('fs').existsSync(localEntrypoint)) {
    return [process.execPath, localEntrypoint];
  }

  return ['openclaw'];
}

function buildPrompt({ deviceId, taskId, task }) {
  const approvedFolder = process.env.APPROVED_FOLDER || path.join(projectRoot, 'local-box', 'files', 'approved');

  return [
    'You are executing one deterministic WicClaw task.',
    'Rules:',
    `- Task id: ${taskId}`,
    `- Device id: ${deviceId}`,
    `- Approved folder: ${approvedFolder}`,
    '- Do not act outside the approved folder for filesystem work.',
    '- Do not take any extra actions.',
    '- Return a single JSON object only.',
    '- Required JSON shape: {"ok":boolean,"result":object,"error":string|null}',
    `Task JSON: ${JSON.stringify(task)}`
  ].join('\n');
}

function parseInput() {
  const raw = require('fs').readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function extractJson(text) {
  function normalizeParsed(parsed) {
    const payloadText = parsed?.payloads?.[0]?.text;
    if (typeof payloadText === 'string') {
      const inner = payloadText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(inner);
    }
    return parsed;
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return normalizeParsed(JSON.parse(trimmed));
  } catch {}

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return normalizeParsed(JSON.parse(match[0]));
  } catch {
    return null;
  }
}

const input = parseInput();
const prompt = buildPrompt(input);
const command = [
  ...findOpenClawCommand(),
  'agent',
  '--agent',
  'main',
  '--session-id',
  `wicclaw-task-${String(input.taskId).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
  '--local',
  '--json',
  '--message',
  prompt,
  '--thinking',
  'minimal',
  '--timeout',
  String(Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS || 120))
];

const child = spawnSync(command[0], command.slice(1), {
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
  encoding: 'utf8',
  timeout: Number(process.env.OPENCLAW_TIMEOUT_MS || 120000)
});

if (child.error && child.status === null) {
  process.stdout.write(JSON.stringify({ ok: false, available: false, error: child.error.message }));
  process.exit(1);
}

const parsed = extractJson(child.stdout) || extractJson(child.stderr);

if (!parsed) {
  process.stdout.write(JSON.stringify({
    ok: false,
    available: child.status === 0,
    error: String(child.stderr || child.stdout || 'OpenClaw returned invalid output').trim()
  }));
  process.exit(child.status || 1);
}

process.stdout.write(`${JSON.stringify({
  ok: Boolean(parsed.ok),
  available: true,
  result: parsed.result || parsed,
  error: parsed.error || null
})}\n`);
process.exit(parsed.ok ? 0 : 1);
