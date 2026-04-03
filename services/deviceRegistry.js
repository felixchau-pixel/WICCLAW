const fs = require('fs');
const path = require('path');

const heartbeatWindowMs = Number(process.env.HEARTBEAT_WINDOW_MS || 120000);
const maxResultsPerDevice = Number(process.env.MAX_RESULTS_PER_DEVICE || 50);

function getRegistryPath() {
  return process.env.DEVICE_REGISTRY_PATH || path.join(__dirname, '..', 'data', 'devices.json');
}

function getDataDir() {
  return path.dirname(getRegistryPath());
}

function ensureRegistryFile() {
  fs.mkdirSync(getDataDir(), { recursive: true });

  if (!fs.existsSync(getRegistryPath())) {
    fs.writeFileSync(getRegistryPath(), JSON.stringify({ devices: {} }, null, 2));
  }
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { devices: {} };
  }

  if (raw.devices && typeof raw.devices === 'object' && !Array.isArray(raw.devices)) {
    return { devices: raw.devices };
  }

  return { devices: raw };
}

function readStore() {
  ensureRegistryFile();
  const content = fs.readFileSync(getRegistryPath(), 'utf8').trim() || '{}';
  return normalizeStore(JSON.parse(content));
}

function writeStore(store) {
  ensureRegistryFile();
  fs.writeFileSync(getRegistryPath(), JSON.stringify(store, null, 2));
}

function isOnline(device) {
  if (!device?.lastSeen) {
    return false;
  }

  return Date.now() - new Date(device.lastSeen).getTime() <= heartbeatWindowMs;
}

function buildPublicDevice(device) {
  if (!device) {
    return null;
  }

  const online = isOnline(device);
  const status = online ? (device.status || 'online') : 'offline';

  return {
    deviceId: device.deviceId,
    businessName: device.businessName || '',
    pairedTelegramUser: device.pairedTelegramUser || '',
    status,
    version: device.version || '',
    approvedFolder: device.approvedFolder || '',
    assistantMode: device.assistantMode || 'master-mediated',
    lastSeen: device.lastSeen || null,
    lastIp: device.lastIp || '',
    manifestVersion: device.manifestVersion || '',
    syncStatus: device.syncStatus || '',
    syncUpdatedAt: device.syncUpdatedAt || null,
    runtimeReady: Boolean(device.runtimeReady),
    online,
    pendingTaskCount: Array.isArray(device.pendingTasks) ? device.pendingTasks.length : 0,
    resultCount: Array.isArray(device.results) ? device.results.length : 0
  };
}

function getDevicesMap() {
  return readStore().devices;
}

function writeDevicesMap(devices) {
  writeStore({ devices });
}

function upsertHeartbeat(payload) {
  const {
    deviceId,
    deviceSecret,
    version,
    status,
    businessName,
    lastIp,
    approvedFolder,
    manifestVersion,
    syncStatus,
    runtimeReady,
    assistantMode
  } = payload || {};

  if (!deviceId || !deviceSecret) {
    return { ok: false, error: 'deviceId and deviceSecret are required' };
  }

  const devices = getDevicesMap();
  const existing = devices[deviceId];

  if (existing && existing.deviceSecret !== deviceSecret) {
    return { ok: false, error: 'Secret mismatch' };
  }

  const now = new Date().toISOString();
  devices[deviceId] = {
    deviceId,
    deviceSecret,
    businessName: businessName || existing?.businessName || '',
    pairedTelegramUser: existing?.pairedTelegramUser || '',
    status: status || 'online',
    version: version || existing?.version || '',
    approvedFolder: approvedFolder || existing?.approvedFolder || '',
    assistantMode: assistantMode || existing?.assistantMode || 'master-mediated',
    lastSeen: now,
    lastIp: lastIp || existing?.lastIp || '',
    manifestVersion: manifestVersion || existing?.manifestVersion || '',
    syncStatus: syncStatus || existing?.syncStatus || '',
    syncUpdatedAt: manifestVersion || syncStatus ? now : existing?.syncUpdatedAt || null,
    runtimeReady: typeof runtimeReady === 'boolean' ? runtimeReady : Boolean(existing?.runtimeReady),
    createdAt: existing?.createdAt || now,
    pendingTasks: Array.isArray(existing?.pendingTasks) ? existing.pendingTasks : [],
    results: Array.isArray(existing?.results) ? existing.results : []
  };

  writeDevicesMap(devices);
  return { ok: true, device: buildPublicDevice(devices[deviceId]) };
}

function getDeviceById(deviceId) {
  return getDevicesMap()[deviceId] || null;
}

function getDeviceStatus(deviceId) {
  return buildPublicDevice(getDeviceById(deviceId));
}

function getAllDeviceStatuses() {
  return Object.values(getDevicesMap())
    .sort((left, right) => String(left.deviceId).localeCompare(String(right.deviceId)))
    .map(buildPublicDevice);
}

function getPairedDevicesForUser(telegramUserId) {
  const target = String(telegramUserId);
  return Object.values(getDevicesMap())
    .filter((device) => String(device.pairedTelegramUser || '') === target)
    .sort((left, right) => String(left.deviceId).localeCompare(String(right.deviceId)))
    .map(buildPublicDevice);
}

function verifyDeviceSecret(deviceId, deviceSecret) {
  const device = getDeviceById(deviceId);

  if (!device) {
    return { ok: false, error: 'Device not found' };
  }

  if (!deviceSecret || String(device.deviceSecret) !== String(deviceSecret)) {
    return { ok: false, error: 'Secret mismatch' };
  }

  return { ok: true, device };
}

function updateDeviceSync(deviceId, syncState = {}) {
  const devices = getDevicesMap();
  const device = devices[deviceId];

  if (!device) {
    return { ok: false, error: 'Device not found' };
  }

  if (syncState.manifestVersion) {
    device.manifestVersion = syncState.manifestVersion;
  }

  if (syncState.syncStatus) {
    device.syncStatus = syncState.syncStatus;
  }

  if (typeof syncState.runtimeReady === 'boolean') {
    device.runtimeReady = syncState.runtimeReady;
  }

  if (syncState.assistantMode) {
    device.assistantMode = syncState.assistantMode;
  }

  device.syncUpdatedAt = new Date().toISOString();
  writeDevicesMap(devices);
  return { ok: true, device: buildPublicDevice(device) };
}

function pairDevice(deviceId, telegramUserId, options = {}) {
  const devices = getDevicesMap();
  const force = Boolean(options.force);
  const targetUser = String(telegramUserId);

  if (!devices[deviceId]) {
    return { ok: false, error: 'Device not found' };
  }

  const current = String(devices[deviceId].pairedTelegramUser || '');
  if (current && current !== targetUser && !force) {
    return { ok: false, error: 'Device already paired to another Telegram user' };
  }

  devices[deviceId].pairedTelegramUser = targetUser;
  writeDevicesMap(devices);
  return { ok: true, device: buildPublicDevice(devices[deviceId]) };
}

function buildTaskRecord(task, taskId) {
  return {
    id: taskId,
    input: task,
    status: 'queued',
    createdAt: new Date().toISOString()
  };
}

function enqueueTask(deviceId, task, options = {}) {
  const devices = getDevicesMap();
  const device = devices[deviceId];

  if (!device) {
    return null;
  }

  const taskId = options.taskId || `task_${Date.now()}`;
  const record = buildTaskRecord(task, taskId);

  device.pendingTasks = Array.isArray(device.pendingTasks) ? device.pendingTasks : [];
  device.pendingTasks.push(record);
  writeDevicesMap(devices);

  return record;
}

function peekNextTask(deviceId) {
  const device = getDevicesMap()[deviceId];

  if (!device || !Array.isArray(device.pendingTasks) || device.pendingTasks.length === 0) {
    return null;
  }

  return device.pendingTasks[0];
}

function claimNextTask(deviceId) {
  const devices = getDevicesMap();
  const device = devices[deviceId];

  if (!device || !Array.isArray(device.pendingTasks) || device.pendingTasks.length === 0) {
    return null;
  }

  const nextTask = device.pendingTasks[0];
  if (nextTask.status !== 'dispatched') {
    nextTask.status = 'dispatched';
    nextTask.dispatchedAt = new Date().toISOString();
    writeDevicesMap(devices);
  }
  return nextTask;
}

function saveTaskResult(deviceId, taskId, result) {
  const devices = getDevicesMap();
  const device = devices[deviceId];

  if (!device) {
    return { ok: false, error: 'Device not found' };
  }

  device.pendingTasks = Array.isArray(device.pendingTasks) ? device.pendingTasks : [];
  device.pendingTasks = device.pendingTasks.filter((entry) => entry.id !== taskId);
  device.results = Array.isArray(device.results) ? device.results : [];
  device.results = device.results.filter((entry) => entry.taskId !== taskId);
  device.results.unshift({
    taskId,
    receivedAt: new Date().toISOString(),
    result
  });
  device.results = device.results.slice(0, maxResultsPerDevice);
  writeDevicesMap(devices);

  return { ok: true };
}

function getTaskResult(deviceId, taskId) {
  const device = getDeviceById(deviceId);

  if (!device || !Array.isArray(device.results)) {
    return null;
  }

  return device.results.find((entry) => entry.taskId === taskId) || null;
}

module.exports = {
  upsertHeartbeat,
  getDeviceById,
  getDeviceStatus,
  getAllDeviceStatuses,
  getPairedDevicesForUser,
  verifyDeviceSecret,
  pairDevice,
  enqueueTask,
  peekNextTask,
  claimNextTask,
  saveTaskResult,
  getTaskResult,
  updateDeviceSync
};
