#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const { getApprovedOpenClawSkills } = require('../core/openclawSkills');
const openclawHome =
  process.env.OPENCLAW_STATE_DIR ||
  process.env.OPENCLAW_HOME ||
  path.join(projectRoot, '.openclaw');
const openclawConfigPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  process.env.OPENCLAW_CONFIG ||
  path.join(openclawHome, 'openclaw.json');
const approvedFolder = process.env.APPROVED_FOLDER || path.join(projectRoot, 'local-box', 'files', 'approved');
const projectBinDir = path.join(projectRoot, 'bin');

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function ensureConfig() {
  ensureDir(openclawHome);
  ensureDir(path.dirname(openclawConfigPath));
  ensureDir(path.join(openclawHome, 'memory'));
  ensureDir(path.join(openclawHome, 'skills'));
  ensureDir(path.join(openclawHome, 'logs'));
  ensureDir(approvedFolder);

  const provider = process.env.OPENCLAW_PROVIDER || 'anthropic';
  const model = process.env.OPENCLAW_MODEL || 'claude-sonnet-4-5';

  const config = {
    logging: {
      level: 'info',
      file: path.join(openclawHome, 'openclaw.log')
    },
    agents: {
      defaults: {
        workspace: projectRoot,
        heartbeat: { every: '0m' },
        model: {
          primary: `${provider}/${model}`
        },
        models: {
          [`${provider}/${model}`]: {}
        }
      },
      list: [
        {
          id: 'main',
          default: true,
          skills: getApprovedOpenClawSkills()
        }
      ]
    },
    channels: {
      telegram: {
        enabled: false
      }
    },
    gateway: {
      mode: 'local',
      bind: 'custom',
      customBindHost: '127.0.0.1',
      auth: {
        mode: 'token',
        token: '${MASTER_API_TOKEN}'
      },
      port: Number(process.env.OPENCLAW_PORT || 18789)
    }
  };

  fs.writeFileSync(openclawConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function findOpenClawBinary() {
  if (process.env.OPENCLAW_BIN) {
    return { command: process.env.OPENCLAW_BIN, fixedArgs: [] };
  }

  const localBinary = path.join(projectRoot, 'node_modules', '.bin', 'openclaw');
  if (fs.existsSync(localBinary)) {
    return { command: localBinary, fixedArgs: [] };
  }

  const localEntrypoint = path.join(projectRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  if (fs.existsSync(localEntrypoint)) {
    return { command: process.execPath, fixedArgs: [localEntrypoint] };
  }

  return { command: 'openclaw', fixedArgs: [] };
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(args) {
  ensureConfig();

  const binary = findOpenClawBinary();
  const command = [binary.command, ...binary.fixedArgs, ...args].map(shellEscape).join(' ');
  const child = spawnSync('bash', ['-lc', command], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: openclawHome,
      OPENCLAW_CONFIG_PATH: openclawConfigPath,
      OPENCLAW_SKILLS_PATH: path.join(projectRoot, 'skills'),
      OPENCLAW_MEMORY_PATH: path.join(openclawHome, 'memory'),
      HOME: process.env.HOME || os.homedir(),
      PATH: `${projectBinDir}:${process.env.PATH || ''}`
    },
    encoding: 'utf8'
  });

  if (child.error && child.status === null) {
    throw child.error;
  }

  if (child.stdout) {
    process.stdout.write(child.stdout);
  }

  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  process.exitCode = child.status || 0;
}

run(
  process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['gateway', 'run', '--allow-unconfigured', '--port', String(Number(process.env.OPENCLAW_PORT || 18789))]
);
