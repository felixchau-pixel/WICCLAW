const { askClaude, hasAnthropic } = require('./anthropic');
const { getAllDeviceStatuses, getDeviceStatus, getDeviceById } = require('./deviceRegistry');
const { converseWithOpenClaw, getOpenClawStatus } = require('./openclawAdapter');
const { getMasterManifest } = require('./syncManifest');
const { validateTask } = require('../core/taskValidator');

function summarizeDevices(devices) {
  if (!devices.length) {
    return 'Devices: none';
  }

  return [
    `Devices: ${devices.length}`,
    ...devices.map((device) => {
      const online = device.online ? 'online' : 'offline';
      return `${device.deviceId}: ${online}, status=${device.status || '-'}, manifest=${device.manifestVersion || '-'}, sync=${device.syncStatus || '-'}`;
    })
  ].join('\n');
}

function parseDeviceId(message) {
  const match = String(message || '').match(/\b(mini_[a-zA-Z0-9_-]+)\b/);
  return match ? match[1] : '';
}

function buildSystemState() {
  const devices = getAllDeviceStatuses();
  const openclaw = getOpenClawStatus();
  const manifest = getMasterManifest();

  return {
    manifest,
    devices,
    openclaw
  };
}

function buildDeterministicSystemReport(state) {
  const deviceCount = state.devices.length;
  return [
    `WicClaw system report`,
    `Manifest: ${state.manifest.manifestVersion}`,
    `OpenClaw enabled: ${state.openclaw.enabled ? 'yes' : 'no'}`,
    `OpenClaw ready: ${state.openclaw.ready ? 'yes' : 'no'}`,
    `OpenClaw running: ${state.openclaw.running ? 'yes' : 'no'}`,
    `Registered devices: ${deviceCount}`,
    deviceCount ? summarizeDevices(state.devices) : 'Devices: none',
    state.openclaw.blockers?.length ? `OpenClaw blockers: ${state.openclaw.blockers.join(' | ')}` : 'OpenClaw blockers: none'
  ].join('\n');
}

function summarizeResult(deviceId) {
  const device = getDeviceById(deviceId);
  const latest = device?.results?.[0];
  return latest ? JSON.stringify(latest, null, 2) : 'No results found.';
}

function formatProposals(proposedActions) {
  if (!Array.isArray(proposedActions) || !proposedActions.length) {
    return '';
  }

  const valid = proposedActions.filter((entry) => validateTask(entry.task || {}).ok);
  if (!valid.length) {
    return '';
  }

  return [
    '',
    'Proposed validated actions:',
    ...valid.map((entry, index) => {
      return `${index + 1}. device=${entry.deviceId || '-'} task=${JSON.stringify(entry.task)} why=${entry.why || '-'}`;
    }),
    'Use /run DEVICE_ID ... to execute explicitly.'
  ].join('\n');
}

async function fallbackReply(input, state) {
  if (!hasAnthropic()) {
    return [
      'Master agent summary:',
      `Manifest: ${state.manifest.manifestVersion}`,
      summarizeDevices(state.devices),
      `OpenClaw ready: ${state.openclaw.ready ? 'yes' : 'no'}`
    ].join('\n');
  }

  try {
    return await askClaude({
      system: [
        'You are the WicClaw master orchestrator.',
        'You report state, planning, blockers, and safe next actions.',
        'You do not execute actions directly.',
        'You refer execution to explicit validated /run flows.'
      ].join(' '),
      user: [
        `Operator message: ${input}`,
        `Manifest: ${JSON.stringify(state.manifest)}`,
        `Devices: ${JSON.stringify(state.devices)}`,
        `OpenClaw: ${JSON.stringify(state.openclaw)}`
      ].join('\n')
    });
  } catch {
    return [
      'Master agent summary:',
      `Manifest: ${state.manifest.manifestVersion}`,
      summarizeDevices(state.devices),
      `OpenClaw ready: ${state.openclaw.ready ? 'yes' : 'no'}`
    ].join('\n');
  }
}

async function replyToMasterAgent(message) {
  const input = String(message || '').trim();
  const lower = input.toLowerCase();
  const deviceId = parseDeviceId(input);

  if (!input) {
    return 'Usage: /agent <message>';
  }

  if (deviceId && lower.includes('result')) {
    return summarizeResult(deviceId);
  }

  if (deviceId && (lower.includes('status') || lower.includes('inspect'))) {
    const device = getDeviceStatus(deviceId);
    return device ? JSON.stringify(device, null, 2) : 'Device not found.';
  }

  if (lower.includes('device') || lower.includes('devices')) {
    return summarizeDevices(getAllDeviceStatuses());
  }

  if (lower.includes('openclaw')) {
    return JSON.stringify(getOpenClawStatus(), null, 2);
  }

  const state = buildSystemState();
  if (lower.includes('report') || lower.includes('system status') || lower === 'status' || lower.includes('report system')) {
    return buildDeterministicSystemReport(state);
  }

  if (state.openclaw.enabled) {
    const openclawReply = await converseWithOpenClaw({
      message: input,
      manifest: state.manifest,
      devices: state.devices,
      openclaw: state.openclaw
    });

    if (openclawReply.ok && openclawReply.reply) {
      const suffix = formatProposals(openclawReply.proposedActions);
      const blockers = Array.isArray(openclawReply.blockers) && openclawReply.blockers.length
        ? `\n\nBlockers:\n- ${openclawReply.blockers.join('\n- ')}`
        : '';
      return `${openclawReply.reply}${suffix}${blockers}`;
    }
  }

  return fallbackReply(input, state);
}

module.exports = {
  replyToMasterAgent
};
