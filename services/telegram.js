const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const { isUnsetOrPlaceholder } = require('../core/env');
const { routeMessage } = require('../core/router');
const { validateTask } = require('../core/taskValidator');
const { canExecute } = require('../core/permissions');
const { getSession, resetSession, incrementRetry, clearRetry } = require('../core/session');
const { writeApprovedFile } = require('../local-box/files/executor');
const {
  getDeviceById,
  getAllDeviceStatuses,
  getDeviceStatus,
  pairDevice,
  getTaskResult
} = require('./deviceRegistry');
const { dispatchTask } = require('./taskDispatch');
const { getOpenClawStatus } = require('./openclawAdapter');
const { replyToMasterAgent } = require('./masterAgent');
const { replyToAssistant } = require('./assistantAgent');
const { startOnboarding, handleOnboarding } = require('../skills/onboarding');
const { startQuote, handleQuote } = require('../skills/quote');
const { startPromo, handlePromo } = require('../skills/promo');
const { calendarMock } = require('../skills/calendar');

let botInstance = null;
const telegramLockPath = path.join(__dirname, '..', '.telegram-polling.lock');

function isLivePid(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePollingLock() {
  const pid = process.pid;

  try {
    fs.writeFileSync(telegramLockPath, `${pid}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    const currentPid = String(fs.readFileSync(telegramLockPath, 'utf8') || '').trim();
    if (isLivePid(currentPid)) {
      throw new Error(`Telegram polling already active under pid ${currentPid}`);
    }

    fs.writeFileSync(telegramLockPath, `${pid}\n`);
  }

  const release = () => {
    try {
      const currentPid = String(fs.readFileSync(telegramLockPath, 'utf8') || '').trim();
      if (String(currentPid) === String(pid)) {
        fs.unlinkSync(telegramLockPath);
      }
    } catch {}
  };

  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    release();
    process.exit(143);
  });
}

function logTelegramEvent(chatId, text) {
  const command = String(text || '').trim().split(/\s+/)[0] || '<empty>';
  console.log(`telegram chat=${chatId} command=${command}`);
}

function getBot() {
  if (botInstance) {
    return botInstance;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (isUnsetOrPlaceholder(token)) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const polling = process.env.DISABLE_TELEGRAM_POLLING === 'true' ? false : true;
  botInstance = new TelegramBot(token, { polling });
  return botInstance;
}

function isAdmin(chatId) {
  const adminChatId = process.env.ADMIN_CHAT_ID || '';
  if (!adminChatId) {
    return true;
  }

  return String(chatId) === String(adminChatId);
}

function tooManyRetries(chatId) {
  return incrementRetry(chatId) >= 3;
}

function formatDevice(device) {
  if (!device) {
    return 'Device not found.';
  }

  return [
    `Device: ${device.deviceId}`,
    `Business: ${device.businessName || '-'}`,
    `Online: ${device.online ? 'YES' : 'NO'}`,
    `Status: ${device.status || '-'}`,
    `Version: ${device.version || '-'}`,
    `Manifest: ${device.manifestVersion || '-'}`,
    `Sync: ${device.syncStatus || '-'}`,
    `Last seen: ${device.lastSeen || '-'}`,
    `Pending tasks: ${device.pendingTaskCount}`,
    `Results: ${device.resultCount}`
  ].join('\n');
}

function formatDeviceList(devices) {
  if (!devices.length) {
    return 'No devices registered yet.';
  }

  return devices
    .map((device) => {
      const online = device.online ? 'ONLINE' : 'OFFLINE';
      return `${device.deviceId} | ${online} | ${device.version || '-'} | manifest=${device.manifestVersion || '-'} | ${device.lastSeen || '-'}`;
    })
    .join('\n');
}

function parseRunCommand(raw) {
  const trimmed = String(raw || '').trim();

  if (trimmed.startsWith('write ')) {
    const [filename, ...rest] = trimmed.slice(6).split('|');
    return {
      type: 'write_file',
      payload: {
        filename: String(filename || '').trim(),
        content: rest.join('|').trim()
      }
    };
  }

  if (trimmed.startsWith('read ')) {
    return {
      type: 'read_file',
      payload: { filename: trimmed.slice(5).trim() }
    };
  }

  if (trimmed.startsWith('move ')) {
    const [from, to] = trimmed.slice(5).split('|');
    return {
      type: 'move_file',
      payload: {
        from: String(from || '').trim(),
        to: String(to || '').trim()
      }
    };
  }

  if (trimmed.startsWith('delete ')) {
    return {
      type: 'delete_file',
      payload: { filename: trimmed.slice(7).trim() }
    };
  }

  if (trimmed === 'list') {
    return { type: 'list_files', payload: {} };
  }

  if (trimmed.startsWith('result ')) {
    return {
      type: 'get_result',
      payload: { taskId: trimmed.slice(7).trim() }
    };
  }

  if (trimmed.startsWith('exec ')) {
    return {
      type: 'exec_cmd',
      payload: { command: trimmed.slice(5).trim() }
    };
  }

  return null;
}

async function handleSession(chatId, text) {
  const session = getSession(chatId);

  if (!session.step) {
    return null;
  }

  if (session.flow === 'onboarding') {
    return handleOnboarding(chatId, text);
  }

  if (session.flow === 'quote') {
    return handleQuote(chatId, text);
  }

  if (session.flow === 'promo') {
    return handlePromo(chatId, text);
  }

  return null;
}

async function handleRun(chatId, text) {
  const parts = text.split(/\s+/);
  const deviceId = parts[1];
  const rawTask = parts.slice(2).join(' ').trim();

  if (!deviceId || !rawTask) {
    return 'Usage: /run DEVICE_ID write filename|content';
  }

  const task = parseRunCommand(rawTask);
  if (!task) {
    return 'Unsupported task';
  }

  const validation = validateTask(task);
  if (!validation.ok) {
    return validation.error;
  }

  const device = getDeviceById(deviceId);
  const permission = canExecute({ chatId, device, task });
  if (!permission.ok) {
    return permission.error;
  }

  if (task.type === 'get_result') {
    const result = getTaskResult(deviceId, task.payload.taskId);
    return result ? JSON.stringify(result, null, 2) : 'Result not found';
  }

  const dispatched = await dispatchTask({ deviceId, task, source: 'telegram' });
  if (!dispatched.ok) {
    return dispatched.error || 'Dispatch failed';
  }

  if (dispatched.mode === 'openclaw') {
    return [
      `Completed via OpenClaw: ${dispatched.taskId}`,
      JSON.stringify(dispatched.result, null, 2)
    ].join('\n');
  }

  return `Queued:\n${dispatched.task.id}`;
}

async function handleTelegramText({ bot, chatId, text }) {
  const trimmed = String(text || '').trim();

  if (!trimmed) {
    return null;
  }

  logTelegramEvent(chatId, trimmed);

  if (trimmed === '/openclaw') {
    return bot.sendMessage(chatId, JSON.stringify(getOpenClawStatus(), null, 2));
  }

  if (trimmed.startsWith('/agent')) {
    if (!isAdmin(chatId)) {
      return bot.sendMessage(chatId, 'Not authorized.');
    }

    const reply = await replyToMasterAgent(trimmed.replace(/^\/agent\s*/, ''));
    return bot.sendMessage(chatId, reply);
  }

  if (trimmed.startsWith('/ask')) {
    const reply = await replyToAssistant({
      chatId,
      message: trimmed.replace(/^\/ask\s*/, '')
    });
    return bot.sendMessage(chatId, reply);
  }

  if (trimmed.startsWith('/pair')) {
    const deviceId = trimmed.split(/\s+/)[1];
    if (!deviceId) {
      return bot.sendMessage(chatId, 'Usage: /pair DEVICE_ID');
    }

    const paired = pairDevice(deviceId, chatId, { force: isAdmin(chatId) });
    if (!paired.ok) {
      return bot.sendMessage(chatId, paired.error);
    }

    return bot.sendMessage(chatId, `Device paired:\n${paired.device.deviceId}`);
  }

  if (trimmed.startsWith('/run')) {
    return bot.sendMessage(chatId, await handleRun(chatId, trimmed));
  }

  if (trimmed === '/devices') {
    if (!isAdmin(chatId)) {
      return bot.sendMessage(chatId, 'Not authorized.');
    }

    return bot.sendMessage(chatId, formatDeviceList(getAllDeviceStatuses()));
  }

  if (trimmed.startsWith('/status')) {
    if (!isAdmin(chatId)) {
      return bot.sendMessage(chatId, 'Not authorized.');
    }

    const deviceId = trimmed.split(/\s+/)[1];
    if (!deviceId) {
      return bot.sendMessage(chatId, 'Usage: /status DEVICE_ID');
    }

    return bot.sendMessage(chatId, formatDevice(getDeviceStatus(deviceId)));
  }

  if (trimmed === '/reset') {
    resetSession(chatId);
    return bot.sendMessage(chatId, 'Session reset.');
  }

  const sessionReply = await handleSession(chatId, trimmed);
  if (sessionReply) {
    return bot.sendMessage(chatId, sessionReply);
  }

  if (getSession(chatId).step && tooManyRetries(chatId)) {
    resetSession(chatId);
    return bot.sendMessage(chatId, 'Session reset.');
  }

  const decision = routeMessage(trimmed);

  if (decision.action === 'onboarding_start') {
    return bot.sendMessage(chatId, startOnboarding(chatId));
  }

  if (decision.action === 'quote') {
    return bot.sendMessage(chatId, startQuote(chatId));
  }

  if (decision.action === 'promo') {
    return bot.sendMessage(chatId, startPromo(chatId));
  }

  if (decision.action === 'calendar') {
    return bot.sendMessage(chatId, calendarMock());
  }

  if (decision.action === 'local_write') {
    const result = writeApprovedFile('sample.txt', trimmed);
    return bot.sendMessage(chatId, result.message);
  }

  return bot.sendMessage(chatId, 'Unknown request');
}

function startTelegram() {
  acquirePollingLock();
  const bot = getBot();
  console.log('Telegram polling started');

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    try {
      await handleTelegramText({
        bot,
        chatId,
        text: msg.text
      });
    } catch (error) {
      console.error(error.message);
      await bot.sendMessage(chatId, 'Internal error');
    }
  });

  bot.on('polling_error', (error) => {
    console.error(`Telegram polling error: ${error.message}`);
  });

  return bot;
}

module.exports = {
  startTelegram,
  getBot,
  handleTelegramText,
  parseRunCommand,
  isAdmin
};
