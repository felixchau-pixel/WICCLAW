#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const promptPath = path.join(projectRoot, 'prompts', 'telegram-live.md');
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
  if (fs.existsSync(localBinary)) {
    return [localBinary];
  }

  const localEntrypoint = path.join(projectRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  if (fs.existsSync(localEntrypoint)) {
    return [process.execPath, localEntrypoint];
  }

  return ['openclaw'];
}

function parseInput() {
  const raw = String(fs.readFileSync(0, 'utf8') || '').trim();
  return raw ? JSON.parse(raw) : {};
}

function readPromptTemplate() {
  return fs.readFileSync(promptPath, 'utf8').trim();
}

function buildPrompt(template, input) {
  return [
    template,
    '',
    'Input JSON:',
    JSON.stringify(input)
  ].join('\n');
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
const template = readPromptTemplate();
const prompt = buildPrompt(template, input);
const sessionId = String(input.sessionId || input.chatId || 'telegram-chat-default')
  .replace(/[^a-zA-Z0-9_-]/g, '_')
  .slice(0, 120);
const command = [
  ...findOpenClawCommand(),
  'agent',
  '--agent',
  'main',
  '--session-id',
  sessionId,
  '--local',
  '--json',
  '--message',
  prompt,
  '--thinking',
  process.env.OPENCLAW_CHAT_THINKING || 'minimal',
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
  process.stdout.write(`${JSON.stringify({ ok: false, available: false, error: child.error.message })}\n`);
  process.exit(1);
}

const parsed = extractJson(child.stdout) || extractJson(child.stderr);

if (!parsed) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    available: child.status === 0,
    error: String(child.stderr || child.stdout || 'OpenClaw chat failed').trim()
  })}\n`);
  process.exit(child.status || 1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  available: true,
  reply: String(parsed.reply || '').trim(),
  proposedActions: Array.isArray(parsed.proposedActions) ? parsed.proposedActions : [],
  blockers: Array.isArray(parsed.blockers) ? parsed.blockers : []
})}\n`);
