const { routeMessage } = require('../core/router');
const { validateTask } = require('../core/taskValidator');
const { canExecute } = require('../core/permissions');
const { dispatchTask } = require('./taskDispatch');
const { getTaskResult, getPairedDevicesForUser } = require('./deviceRegistry');
const { askClaude, hasAnthropic } = require('./anthropic');
const { startOnboarding } = require('../skills/onboarding');
const { startQuote } = require('../skills/quote');
const { startPromo } = require('../skills/promo');
const { calendarMock } = require('../skills/calendar');

function normalizeNaturalIntent(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (!lower) {
    return null;
  }

  if (lower === 'status' || lower.includes('are you online') || lower.includes('assistant status')) {
    return { type: 'assistant_status' };
  }

  if (lower.includes('what can you do') || lower.includes('help me') || lower === 'help') {
    return { type: 'assistant_help' };
  }

  const writeMatch = text.match(/(?:write|save|create)\s+([A-Za-z0-9._/-]+)\s*(?:with|:)?\s+(.+)/i);
  if (writeMatch) {
    return {
      type: 'structured_task',
      task: {
        type: 'write_file',
        payload: {
          filename: writeMatch[1].trim(),
          content: writeMatch[2].trim()
        }
      }
    };
  }

  const readMatch = text.match(/(?:read|show)\s+(?:file\s+)?([A-Za-z0-9._/-]+)/i);
  if (readMatch) {
    return {
      type: 'structured_task',
      task: {
        type: 'read_file',
        payload: {
          filename: readMatch[1].trim()
        }
      }
    };
  }

  const listIntent = lower.includes('list files') || lower === 'list' || lower.includes('show files');
  if (listIntent) {
    return {
      type: 'structured_task',
      task: {
        type: 'list_files',
        payload: {}
      }
    };
  }

  return null;
}

function parseAssistantTask(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (lower === 'list' || lower === 'list files') {
    return { type: 'list_files', payload: {} };
  }

  if (lower.startsWith('read ')) {
    return { type: 'read_file', payload: { filename: text.slice(5).trim() } };
  }

  if (lower.startsWith('write ')) {
    if (!text.includes('|')) {
      return null;
    }
    const [filename, ...rest] = text.slice(6).split('|');
    return {
      type: 'write_file',
      payload: {
        filename: String(filename || '').trim(),
        content: rest.join('|').trim()
      }
    };
  }

  if (lower.startsWith('delete ')) {
    return { type: 'delete_file', payload: { filename: text.slice(7).trim() } };
  }

  if (lower.startsWith('move ')) {
    if (!text.includes('|')) {
      return null;
    }
    const [from, to] = text.slice(5).split('|');
    return {
      type: 'move_file',
      payload: {
        from: String(from || '').trim(),
        to: String(to || '').trim()
      }
    };
  }

  if (lower.startsWith('result ')) {
    return { type: 'get_result', payload: { taskId: text.slice(7).trim() } };
  }

  return null;
}

function resolveAssistantDevice(chatId, message) {
  const devices = getPairedDevicesForUser(chatId);
  if (!devices.length) {
    return { ok: false, error: 'No paired assistant found. Use /pair DEVICE_ID first.' };
  }

  if (devices.length === 1) {
    return { ok: true, device: devices[0], prompt: String(message || '').trim() };
  }

  const text = String(message || '').trim();
  const [candidate, ...rest] = text.split(/\s+/);
  const device = devices.find((entry) => entry.deviceId === candidate);

  if (!device) {
    return { ok: false, error: 'Multiple paired assistants. Use /ask DEVICE_ID <message>.' };
  }

  return { ok: true, device, prompt: rest.join(' ').trim() };
}

async function handleStructuredAssistantTask(chatId, device, task) {
  const validation = validateTask(task);
  if (!validation.ok) {
    return validation.error;
  }

  const permission = canExecute({ chatId, device, task });
  if (!permission.ok) {
    return permission.error;
  }

  if (task.type === 'get_result') {
    const result = getTaskResult(device.deviceId, task.payload.taskId);
    return result ? JSON.stringify(result, null, 2) : 'Result not found.';
  }

  const dispatched = await dispatchTask({ deviceId: device.deviceId, task, source: 'assistant' });
  if (!dispatched.ok) {
    return dispatched.error || 'Dispatch failed.';
  }

  if (dispatched.mode === 'openclaw') {
    return [
      `Assistant task completed: ${dispatched.taskId}`,
      JSON.stringify(dispatched.result, null, 2)
    ].join('\n');
  }

  return `Assistant task queued on ${device.deviceId}:\n${dispatched.task.id}`;
}

async function replyToAssistant({ chatId, message }) {
  const resolved = resolveAssistantDevice(chatId, message);
  if (!resolved.ok) {
    return resolved.error;
  }

  const device = resolved.device;
  const prompt = resolved.prompt;
  if (!prompt) {
    return 'Usage: /ask <message>';
  }

  const task = parseAssistantTask(prompt);
  if (task) {
    return handleStructuredAssistantTask(chatId, device, task);
  }

  const naturalIntent = normalizeNaturalIntent(prompt);
  if (naturalIntent?.type === 'structured_task') {
    return handleStructuredAssistantTask(chatId, device, naturalIntent.task);
  }

  if (naturalIntent?.type === 'assistant_status') {
    return [
      `${device.businessName || device.deviceId} assistant status:`,
      `Device: ${device.deviceId}`,
      `Online: ${device.online ? 'yes' : 'no'}`,
      `Sync: ${device.syncStatus || 'pending'}`,
      `Manifest: ${device.manifestVersion || 'unknown'}`
    ].join('\n');
  }

  if (naturalIntent?.type === 'assistant_help') {
    return [
      `${device.businessName || device.deviceId} assistant can help with:`,
      '- onboarding',
      '- quote',
      '- promo',
      '- calendar',
      '- safe file requests like "write note.txt hello" or "read note.txt"',
      '- status questions'
    ].join('\n');
  }

  const route = routeMessage(prompt);
  switch (route.action) {
    case 'onboarding_start':
      return startOnboarding(chatId);
    case 'quote':
      return startQuote(chatId);
    case 'promo':
      return startPromo(chatId);
    case 'calendar':
      return calendarMock();
    default:
      break;
  }

  if (!hasAnthropic()) {
    return [
      `${device.businessName || device.deviceId} assistant ready.`,
      'Structured execution still requires validated commands.',
      'Use quote, promo, or calendar to start a workflow.',
      'Use write/read/list/delete/move/result for safe local assistant actions.'
    ].join('\n');
  }

  try {
    return await askClaude({
      system: [
        'You are a deployed WicClaw assistant for one business.',
        'You can converse, summarize, and guide workflows.',
        'You must not claim to execute file or command actions unless they were translated into validated structured tasks.',
        'If the user requests an unsafe or unsupported action, state that structured validated dispatch is required.'
      ].join(' '),
      user: [
        `Assistant device: ${device.deviceId}`,
        `Business: ${device.businessName || 'Unknown'}`,
        `User message: ${prompt}`
      ].join('\n')
    });
  } catch {
    return [
      `${device.businessName || device.deviceId} assistant ready.`,
      'I can handle conversation, workflows, and safe validated local actions.',
      'Use quote, promo, or calendar to start a workflow.'
    ].join('\n');
  }
}

module.exports = {
  replyToAssistant,
  parseAssistantTask,
  resolveAssistantDevice,
  normalizeNaturalIntent
};
