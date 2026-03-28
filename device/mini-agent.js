const fs = require('fs');
const os = require('os');
const path = require('path');

const { isUnsetOrPlaceholder } = require('../core/env');
const { executeTask } = require('./executor');

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getMiniConfig() {
  loadDotEnv(`${__dirname}/.env`);
  const rawCloudUrl = process.env.CLOUD_URL;
  const defaultCloudUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
  let resolvedCloudUrl = rawCloudUrl;

  if (isUnsetOrPlaceholder(rawCloudUrl)) {
    resolvedCloudUrl = defaultCloudUrl;
  } else if (/<[^>]+>/.test(String(rawCloudUrl || ''))) {
    resolvedCloudUrl = String(rawCloudUrl).replace(/<[^>]+>/g, '127.0.0.1');
  }

  return {
    cloudUrl: resolvedCloudUrl,
    deviceId: process.env.DEVICE_ID,
    deviceSecret: process.env.DEVICE_SECRET,
    masterApiToken: process.env.MASTER_API_TOKEN,
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS || 30000),
    deviceVersion: process.env.DEVICE_VERSION || 'mini-v1',
    businessName: process.env.BUSINESS_NAME || 'WicClaw Mini',
    approvedFolder: process.env.APPROVED_FOLDER || `${__dirname}/approved`,
    runtimeDir: process.env.DEVICE_RUNTIME_DIR || path.join(__dirname, 'runtime'),
    assistantMode: 'master-mediated'
  };
}

function ensureMiniConfig(config) {
  if (
    isUnsetOrPlaceholder(config.cloudUrl) ||
    isUnsetOrPlaceholder(config.deviceId) ||
    isUnsetOrPlaceholder(config.deviceSecret) ||
    isUnsetOrPlaceholder(config.masterApiToken)
  ) {
    throw new Error('Missing required mini env values');
  }
}

function ensureRuntimeFolders(config) {
  const approvedFolder = path.resolve(__dirname, config.approvedFolder);
  const runtimeDir = path.resolve(__dirname, config.runtimeDir);
  const syncDir = path.join(runtimeDir, 'sync');
  const stateDir = path.join(runtimeDir, 'state');

  fs.mkdirSync(approvedFolder, { recursive: true });
  fs.mkdirSync(syncDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  return {
    approvedFolder,
    runtimeDir,
    syncDir,
    stateDir
  };
}

function createRequester(config, fetchImpl = fetch) {
  return async function requestJson(pathname, options = {}) {
    const response = await fetchImpl(`${config.cloudUrl}${pathname}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.masterApiToken}`,
        'X-Device-Id': config.deviceId,
        'X-Device-Secret': config.deviceSecret,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || `HTTP ${response.status}`);
    }

    return json;
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getLastIpAddress() {
  try {
    return Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address || '';
  } catch {
    return '';
  }
}

function createMiniAgent(options = {}) {
  const config = { ...getMiniConfig(), ...(options.config || {}) };
  ensureMiniConfig(config);

  const runtime = ensureRuntimeFolders(config);
  const requestJson = options.requestJson || createRequester(config, options.fetchImpl);
  const manifestPath = path.join(runtime.syncDir, 'master-manifest.json');
  const statePath = path.join(runtime.stateDir, 'device-state.json');

  async function fetchManifest() {
    const response = await requestJson(`/api/manifest/${config.deviceId}`, { method: 'GET' });
    writeJson(manifestPath, response);
    return response;
  }

  function getLocalManifestVersion() {
    if (!fs.existsSync(manifestPath)) {
      return '';
    }

    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))?.manifest?.manifestVersion || '';
    } catch {
      return '';
    }
  }

  async function syncWithMaster() {
    const response = await fetchManifest();
    const state = {
      deviceId: config.deviceId,
      assistantMode: config.assistantMode,
      manifestVersion: response.manifest?.manifestVersion || '',
      syncedAt: new Date().toISOString(),
      runtimeReady: true
    };

    writeJson(statePath, state);
    return state;
  }

  async function sendHeartbeat() {
    const localManifestVersion = getLocalManifestVersion();
    const payload = {
      deviceId: config.deviceId,
      deviceSecret: config.deviceSecret,
      version: config.deviceVersion,
      status: 'online',
      businessName: config.businessName,
      approvedFolder: runtime.approvedFolder,
      manifestVersion: localManifestVersion,
      syncStatus: localManifestVersion ? 'synced' : 'pending',
      runtimeReady: true,
      assistantMode: config.assistantMode,
      lastIp: getLastIpAddress()
    };

    return requestJson('/api/heartbeat', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async function pollTask() {
    const response = await requestJson(`/api/task/${config.deviceId}`, { method: 'GET' });
    return response.task || null;
  }

  async function postResult(taskId, result) {
    return requestJson('/api/task/result', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: config.deviceId,
        taskId,
        result
      })
    });
  }

  async function runOnce() {
    await sendHeartbeat();
    await syncWithMaster();
    const taskRecord = await pollTask();

    if (!taskRecord) {
      return { ok: true, taskProcessed: false };
    }

    const result = await executeTask(taskRecord.input, { approvedFolder: runtime.approvedFolder });
    await postResult(taskRecord.id, result);
    return { ok: true, taskProcessed: true, taskId: taskRecord.id, result };
  }

  async function start() {
    await runOnce();

    setInterval(async () => {
      try {
        await runOnce();
      } catch (error) {
        console.error(`mini-agent error: ${error.message}`);
      }
    }, config.heartbeatIntervalMs);
  }

  return {
    config,
    runtime,
    manifestPath,
    statePath,
    fetchManifest,
    syncWithMaster,
    sendHeartbeat,
    pollTask,
    postResult,
    runOnce,
    start
  };
}

async function main() {
  const agent = createMiniAgent();
  await agent.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`mini-agent failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createMiniAgent,
  ensureRuntimeFolders,
  getMiniConfig,
  loadDotEnv
};
