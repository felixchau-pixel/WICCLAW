const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const { isUnsetOrPlaceholder } = require('../core/env');
const { routeMessage } = require('../core/router');
const { validateTask } = require('../core/taskValidator');
const { canExecute } = require('../core/permissions');
const {
  getSession,
  resetSession,
  getOpenClawSessionId,
  resetOpenClawSession,
  incrementRetry,
  clearRetry
} = require('../core/session');
const { writeApprovedFile } = require('../local-box/files/executor');
const {
  getDeviceById,
  getAllDeviceStatuses,
  getDeviceStatus,
  pairDevice,
  getTaskResult
} = require('./deviceRegistry');
const { dispatchTask } = require('./taskDispatch');
const { getOpenClawStatus, converseWithOpenClaw } = require('./openclawAdapter');
const { replyToMasterAgent } = require('./masterAgent');
const { replyToAssistant } = require('./assistantAgent');
const { parsePairingPayload } = require('./onboardingLink');
const { getProfile, saveProfileAnswer, summarizeProfile } = require('./chatProfiles');
const { buildConnectLink, getChatConnectState } = require('./googleConnect');
const { startOnboarding, handleOnboarding } = require('../skills/onboarding');
const { startQuote, handleQuote } = require('../skills/quote');
const { startPromo, handlePromo } = require('../skills/promo');
const { calendarMock } = require('../skills/calendar');

let botInstance = null;
let botIdentityPromise = null;
let botMode = 'idle';
let pollingStarted = false;
const telegramLockPath = path.join(__dirname, '..', '.telegram-polling.lock');
const TELEGRAM_MESSAGE_LIMIT = 3500;

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

function getBot(options = {}) {
  const requestedPolling = Boolean(options.polling);

  if (botInstance && (!requestedPolling || botMode === 'polling')) {
    return botInstance;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (isUnsetOrPlaceholder(token)) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const polling = requestedPolling && process.env.DISABLE_TELEGRAM_POLLING !== 'true';

  if (botInstance && botMode === 'idle' && polling) {
    try {
      botInstance.stopPolling();
    } catch {}
    botInstance = null;
  }

  botInstance = new TelegramBot(token, { polling });
  botMode = polling ? 'polling' : 'idle';
  return botInstance;
}

async function getTelegramBotIdentity() {
  if (!botIdentityPromise) {
    botIdentityPromise = getBot().getMe();
  }

  return botIdentityPromise;
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

async function sendTelegramReply(bot, chatId, text) {
  const normalized = String(text ?? '').trim() || 'Empty reply';
  const chunks = [];

  for (let offset = 0; offset < normalized.length; offset += TELEGRAM_MESSAGE_LIMIT) {
    chunks.push(normalized.slice(offset, offset + TELEGRAM_MESSAGE_LIMIT));
  }

  if (!chunks.length) {
    chunks.push('Empty reply');
  }

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
  }
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

  if (trimmed.startsWith('summarize ')) {
    return {
      type: 'summarize_file',
      payload: { filename: trimmed.slice(10).trim() }
    };
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

async function handleOpenClawChat({ chatId, text, mode = 'telegram_chat' }) {
  const sessionId = getOpenClawSessionId(chatId);
  const profile = summarizeProfile(getProfile(chatId));
  const connectState = getChatConnectState(chatId);
  const prompt = isConnectIntent(text)
    ? [
        String(text || '').trim(),
        '',
        'Google connect context for this Telegram chat:',
        buildConnectReply(chatId, text),
        'If the user wants to connect Google, calendar, or email, include the exact bound link above in your reply.'
      ].join('\n')
    : text;
  const result = await converseWithOpenClaw({
    mode,
    chatId: String(chatId),
    sessionId,
    message: prompt,
    profile,
    connectState
  });

  if (!result.ok) {
    if (isConnectIntent(text)) {
      return buildConnectReply(chatId, text);
    }
    return `OpenClaw chat unavailable: ${result.error || 'unknown error'}`;
  }

  const reply = String(result.reply || '').trim();
  if (!reply) {
    if (isConnectIntent(text)) {
      return buildConnectReply(chatId, text);
    }
    return 'OpenClaw chat unavailable: empty reply';
  }

  return reply;
}

function isConnectIntent(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('connect my google') || lower.includes('connect my calendar') || lower.includes('connect my email');
}

function getConnectService(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('calendar')) {
    return 'calendar';
  }
  if (lower.includes('email')) {
    return 'email';
  }
  return 'google';
}

function buildConnectReply(chatId, text) {
  const service = getConnectService(text);
  const link = buildConnectLink({ chatId, service });
  const status = getChatConnectState(chatId)?.google?.status || 'disconnected';
  return [
    `Google connect link for this chat (${service}):`,
    link.url,
    `Current Google state: ${status}`,
    'This link is bound to this Telegram chat only.'
  ].join('\n');
}

function buildProfileCompleteMessage(profile) {
  const summary = summarizeProfile(profile);
  return [
    'Profile saved.',
    `I will call you: ${summary.userName || '-'}`,
    `You call me: ${summary.assistantName || '-'}`,
    `Business: ${summary.businessName || '-'} (${summary.businessType || '-'})`
  ].join('\n');
}

async function handleStartCommand(chatId, text) {
  const payload = String(text || '').replace(/^\/start\s*/, '').trim();

  if (!payload) {
    return handleOpenClawChat({
      chatId,
      text: 'Introduce yourself as the live WicClaw Telegram assistant and summarize what you can do in this chat.',
      mode: 'telegram_start'
    });
  }

  const parsed = parsePairingPayload(payload);
  if (!parsed.ok) {
    return parsed.error;
  }

  const paired = pairDevice(parsed.deviceId, chatId, { force: isAdmin(chatId) });
  if (!paired.ok) {
    return paired.error;
  }

  const intro = await handleOpenClawChat({
    chatId,
    text: `Acknowledge that this Telegram chat is now paired to device ${parsed.deviceId} and summarize what the assistant can do for that device.`,
    mode: 'telegram_start_pair'
  });

  return [`Device paired: ${parsed.deviceId}`, intro].join('\n\n');
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
    return sendTelegramReply(bot, chatId, JSON.stringify(await getOpenClawStatus(), null, 2));
  }

  if (trimmed === '/start' || trimmed.startsWith('/start ')) {
    const reply = await handleStartCommand(chatId, trimmed);
    return sendTelegramReply(bot, chatId, reply);
  }

  if (trimmed.startsWith('/agent')) {
    if (!isAdmin(chatId)) {
      return sendTelegramReply(bot, chatId, 'Not authorized.');
    }

    const reply = await replyToMasterAgent(trimmed.replace(/^\/agent\s*/, ''));
    return sendTelegramReply(bot, chatId, reply);
  }

  if (trimmed.startsWith('/ask')) {
    const reply = await replyToAssistant({
      chatId,
      message: trimmed.replace(/^\/ask\s*/, '')
    });
    return sendTelegramReply(bot, chatId, reply);
  }

  if (trimmed.startsWith('/pair')) {
    const deviceId = trimmed.split(/\s+/)[1];
    if (!deviceId) {
      return sendTelegramReply(bot, chatId, 'Usage: /pair DEVICE_ID');
    }

    const paired = pairDevice(deviceId, chatId, { force: isAdmin(chatId) });
    if (!paired.ok) {
      return sendTelegramReply(bot, chatId, paired.error);
    }

    return sendTelegramReply(bot, chatId, `Device paired:\n${paired.device.deviceId}`);
  }

  if (trimmed.startsWith('/run')) {
    return sendTelegramReply(bot, chatId, await handleRun(chatId, trimmed));
  }

  if (trimmed === '/devices') {
    if (!isAdmin(chatId)) {
      return sendTelegramReply(bot, chatId, 'Not authorized.');
    }

    return sendTelegramReply(bot, chatId, formatDeviceList(getAllDeviceStatuses()));
  }

  if (trimmed.startsWith('/status')) {
    if (!isAdmin(chatId)) {
      return sendTelegramReply(bot, chatId, 'Not authorized.');
    }

    const deviceId = trimmed.split(/\s+/)[1];
    if (!deviceId) {
      return sendTelegramReply(bot, chatId, 'Usage: /status DEVICE_ID');
    }

    return sendTelegramReply(bot, chatId, formatDevice(getDeviceStatus(deviceId)));
  }

  if (trimmed === '/reset') {
    resetSession(chatId);
    resetOpenClawSession(chatId);
    return sendTelegramReply(bot, chatId, 'Session reset.');
  }

  const session = getSession(chatId);
  if (session.flow === 'profile_intake') {
    const result = saveProfileAnswer(chatId, trimmed);
    if (result.nextQuestion) {
      return sendTelegramReply(bot, chatId, result.nextQuestion.prompt);
    }

    session.flow = null;
    session.step = null;
    return sendTelegramReply(bot, chatId, buildProfileCompleteMessage(result.profile));
  }

  const sessionReply = await handleSession(chatId, trimmed);
  if (sessionReply) {
    return sendTelegramReply(bot, chatId, sessionReply);
  }

  if (getSession(chatId).step && tooManyRetries(chatId)) {
    resetSession(chatId);
    resetOpenClawSession(chatId);
    return sendTelegramReply(bot, chatId, 'Session reset.');
  }

  if (!trimmed.startsWith('/')) {
    console.log(`telegram chat=${chatId} route=openclaw_default`);
    const reply = await handleOpenClawChat({
      chatId,
      text: trimmed
    });
    return sendTelegramReply(bot, chatId, reply);
  }

  console.log(`telegram chat=${chatId} route=legacy_router_fallback`);
  const decision = routeMessage(trimmed);

  if (decision.action === 'onboarding_start') {
    return sendTelegramReply(bot, chatId, startOnboarding(chatId));
  }

  if (decision.action === 'quote') {
    return sendTelegramReply(bot, chatId, startQuote(chatId));
  }

  if (decision.action === 'promo') {
    return sendTelegramReply(bot, chatId, startPromo(chatId));
  }

  if (decision.action === 'calendar') {
    return sendTelegramReply(bot, chatId, calendarMock());
  }

  if (decision.action === 'local_write') {
    const result = writeApprovedFile('sample.txt', trimmed);
    return sendTelegramReply(bot, chatId, result.message);
  }

  return sendTelegramReply(bot, chatId, `Unsupported command: ${trimmed}`);
}

function startTelegram() {
  if (pollingStarted && botInstance && botMode === 'polling') {
    return botInstance;
  }

  acquirePollingLock();
  const bot = getBot({ polling: true });
  if (pollingStarted) {
    return bot;
  }

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
      try {
        await sendTelegramReply(bot, chatId, 'Internal error');
      } catch (sendError) {
        console.error(sendError.message);
      }
    }
  });

  bot.on('polling_error', (error) => {
    console.error(`Telegram polling error: ${error.message}`);
  });

  pollingStarted = true;
  return bot;
}

module.exports = {
  startTelegram,
  getBot,
  getTelegramBotIdentity,
  handleTelegramText,
  parseRunCommand,
  isAdmin
};
