#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');

function parseInput() {
  return JSON.parse(fs.readFileSync(0, 'utf8'));
}

function buildPrompt(input) {
  return [
    'You are the WicClaw master OpenClaw brain.',
    'You can reason, summarize state, plan next steps, and propose safe structured actions.',
    'You must not claim that actions already executed.',
    'You must not produce shell commands.',
    'Any proposed action must be a task proposal only, not execution.',
    'Return JSON only.',
    'Required JSON shape:',
    '{"reply":"string","proposedActions":[{"deviceId":"string","task":{"type":"string","payload":{}},"why":"string"}],"blockers":["string"]}',
    `Input JSON: ${JSON.stringify(input)}`
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
const prompt = buildPrompt(input);
const command = [
  `'${process.execPath.replace(/'/g, `'\\''`)}'`,
  `'${path.join(__dirname, 'openclaw-master.js').replace(/'/g, `'\\''`)}'`,
  'agent',
  '--agent',
  'main',
  '--session-id',
  'wicclaw-master-admin',
  '--local',
  '--json',
  '--message',
  `'${prompt.replace(/'/g, `'\\''`)}'`,
  '--thinking',
  'high',
  '--timeout',
  String(Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS || 120))
].join(' ');

const child = spawnSync('bash', ['-lc', command], {
  cwd: projectRoot,
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
    error: String(child.stderr || child.stdout || 'OpenClaw returned invalid output').trim()
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
