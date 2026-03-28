const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const tempDir = path.join(rootDir, '.tmp-assistant-test');

process.env.MASTER_API_TOKEN = 'test-master-token';
process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
process.env.ADMIN_CHAT_ID = '999';
process.env.ALLOW_EXEC_CMD = 'false';
process.env.DISABLE_TELEGRAM_POLLING = 'true';
process.env.PORT = '0';
process.env.DEVICE_REGISTRY_PATH = path.join(tempDir, 'devices.json');
process.env.APPROVED_FOLDER = path.join(tempDir, 'master-approved');
process.env.OPENCLAW_HOME = path.join(rootDir, '.openclaw');
process.env.OPENCLAW_STATE_DIR = path.join(rootDir, '.openclaw');
process.env.OPENCLAW_CONFIG_PATH = path.join(rootDir, '.openclaw', 'openclaw.json');

fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

const { startServer } = require('../server');
const { startTelegram, handleTelegramText } = require('../services/telegram');
const {
  upsertHeartbeat,
  pairDevice,
  pullNextTask,
  saveTaskResult,
  getTaskResult,
  getDeviceStatus,
  getDeviceById
} = require('../services/deviceRegistry');
const { createMiniAgent } = require('../device/mini-agent');
const { validateTask } = require('../core/taskValidator');
const { canExecute } = require('../core/permissions');
const { getMasterManifest } = require('../services/syncManifest');

function createFakeBot() {
  return {
    sent: [],
    sendMessage(chatId, text) {
      this.sent.push({ chatId, text: String(text) });
      return Promise.resolve({ chatId, text });
    }
  };
}

async function sendText(bot, chatId, text) {
  bot.sent = [];
  await handleTelegramText({ bot, chatId, text });
  return bot.sent[bot.sent.length - 1]?.text || '';
}

function createMiniRequestJson() {
  return async function requestJson(pathname, options = {}) {
    if (pathname === '/api/manifest/mini_001' && options.method === 'GET') {
      return {
        ok: true,
        manifest: getMasterManifest(),
        device: getDeviceStatus('mini_001')
      };
    }

    if (pathname === '/api/heartbeat' && options.method === 'POST') {
      return upsertHeartbeat(JSON.parse(options.body));
    }

    if (pathname === '/api/task/mini_001' && options.method === 'GET') {
      return { ok: true, task: pullNextTask('mini_001') };
    }

    if (pathname === '/api/task/result' && options.method === 'POST') {
      const payload = JSON.parse(options.body);
      return saveTaskResult(payload.deviceId, payload.taskId, payload.result);
    }

    throw new Error(`Unhandled mini request: ${options.method || 'GET'} ${pathname}`);
  };
}

async function main() {
  const bot = createFakeBot();
  const results = [];

  async function record(name, fn) {
    try {
      const details = await fn();
      results.push({ name, status: 'PASS', details: details || '' });
    } catch (error) {
      results.push({ name, status: 'FAIL', details: error.message });
    }
  }

  upsertHeartbeat({
    deviceId: 'mini_001',
    deviceSecret: 'mini-secret',
    version: 'mini-v1',
    status: 'online',
    businessName: 'Test Business',
    approvedFolder: path.join(tempDir, 'device-approved')
  });

  await record('A.server starts', async () => {
    await new Promise((resolve, reject) => {
      let finished = false;
      const server = startServer();
      server.once('listening', () => {
        finished = true;
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.once('error', (error) => {
        if (!finished) {
          reject(error);
        }
      });
    });
    return 'startServer bound and closed cleanly';
  });

  await record('A.telegram starts', async () => {
    const botInstance = startTelegram();
    if (!botInstance || typeof botInstance.on !== 'function') {
      throw new Error('Telegram bot instance not created');
    }
    return 'startTelegram returned a bot instance with polling disabled';
  });

  await record('A./pair works', async () => {
    const reply = await sendText(bot, 111, '/pair mini_001');
    if (!reply.includes('Device paired')) {
      throw new Error(reply || 'pair failed');
    }
    return reply;
  });

  await record('A.non-admin re-pair is blocked', async () => {
    const reply = await sendText(bot, 222, '/pair mini_001');
    if (!reply.includes('already paired')) {
      throw new Error(reply || 're-pair guardrail failed');
    }
    return reply;
  });

  await record('A./devices works', async () => {
    const reply = await sendText(bot, 999, '/devices');
    if (!reply.includes('mini_001')) {
      throw new Error(reply || 'devices list missing mini_001');
    }
    return reply;
  });

  await record('A./status works', async () => {
    const reply = await sendText(bot, 999, '/status mini_001');
    if (!reply.includes('Device: mini_001')) {
      throw new Error(reply || 'status failed');
    }
    return reply;
  });

  await record('A./run write works', async () => {
    const reply = await sendText(bot, 111, '/run mini_001 write note.txt|hello appliance');
    if (!reply.includes('Queued:')) {
      throw new Error(reply || 'run did not queue');
    }

    const requestJson = createMiniRequestJson();
    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved'),
        runtimeDir: path.join(tempDir, 'runtime')
      },
      requestJson
    });

    const runResult = await agent.runOnce();
    if (!runResult.taskProcessed) {
      throw new Error('mini did not process queued task');
    }

    const writtenPath = path.join(agent.runtime.approvedFolder, 'note.txt');
    if (!fs.existsSync(writtenPath)) {
      throw new Error('approved file not written');
    }

    return `processed ${runResult.taskId}`;
  });

  await record('A.result lookup works', async () => {
    const device = getDeviceById('mini_001');
    const taskId = device.results?.[0]?.taskId;
    if (!taskId) {
      throw new Error('no stored result found');
    }

    const reply = await sendText(bot, 111, `/run mini_001 result ${taskId}`);
    if (!reply.includes(taskId)) {
      throw new Error(reply || 'result lookup failed');
    }
    return taskId;
  });

  await record('A.onboarding works', async () => {
    const startReply = await sendText(bot, 111, '/start');
    const doneReply = await sendText(bot, 111, 'nail salon');
    if (!startReply.includes('Step 1') || !doneReply.includes('Setup complete')) {
      throw new Error(`${startReply}\n${doneReply}`);
    }
    return doneReply;
  });

  await record('A.quote works', async () => {
    const first = await sendText(bot, 111, 'quote');
    const second = await sendText(bot, 111, 'gel manicure');
    const third = await sendText(bot, 111, '$45');
    if (!first.includes('What service') || !second.includes('What is the price') || !third.includes('Quote ready')) {
      throw new Error(`${first}\n${second}\n${third}`);
    }
    return third;
  });

  await record('A.promo works', async () => {
    const first = await sendText(bot, 111, 'promo');
    const second = await sendText(bot, 111, 'bring in new customers');
    const third = await sendText(bot, 111, '20% off');
    const fourth = await sendText(bot, 111, 'next week');
    if (!first.includes('goal') || !second.includes('offer') || !third.includes('When should this run') || !fourth.includes('Promotion ready')) {
      throw new Error(`${first}\n${second}\n${third}\n${fourth}`);
    }
    return fourth;
  });

  await record('A.calendar works', async () => {
    const reply = await sendText(bot, 111, 'calendar');
    if (!reply.includes('Calendar workflow started.')) {
      throw new Error(reply || 'calendar failed');
    }
    return reply;
  });

  await record('B./agent returns a master-agent reply', async () => {
    const reply = await sendText(bot, 999, '/agent show devices');
    if (!reply.includes('Devices:')) {
      throw new Error(reply || 'agent reply missing devices');
    }
    return reply;
  });

  await record('B.admin-only protection works', async () => {
    const reply = await sendText(bot, 111, '/agent show devices');
    if (reply !== 'Not authorized.') {
      throw new Error(reply || 'admin protection failed');
    }
    return reply;
  });

  await record('B.master can report system state', async () => {
    const reply = await sendText(bot, 999, '/agent openclaw status');
    if (!reply.includes('"enabled"')) {
      throw new Error(reply || 'openclaw state missing');
    }
    return 'openclaw status returned';
  });

  await record('B.master can inspect device state', async () => {
    const reply = await sendText(bot, 999, '/agent inspect mini_001');
    if (!reply.includes('"deviceId": "mini_001"')) {
      throw new Error(reply || 'device inspection failed');
    }
    return reply;
  });

  await record('C./ask returns assistant reply', async () => {
    const reply = await sendText(bot, 111, '/ask hello assistant');
    if (!reply.toLowerCase().includes('assistant')) {
      throw new Error(reply || 'assistant reply missing');
    }
    return reply;
  });

  await record('C.paired-user restriction works', async () => {
    const reply = await sendText(bot, 222, '/ask hello assistant');
    if (!reply.includes('No paired assistant found')) {
      throw new Error(reply || 'paired-user restriction failed');
    }
    return reply;
  });

  await record('C.assistant path does not bypass structured task guardrails', async () => {
    const reply = await sendText(bot, 111, '/ask write ../bad.txt|blocked');
    if (!reply.includes('approved folder')) {
      throw new Error(reply || 'guardrail reply missing');
    }
    return reply;
  });

  await record('D.mini starts automatically via defined boot mechanism', async () => {
    const serviceFile = fs.readFileSync(path.join(rootDir, 'device', 'wicclaw-mini.service'), 'utf8');
    if (!serviceFile.includes('ExecStart=/home/wicma/wicclaw/device/start-mini.sh --run')) {
      throw new Error('service ExecStart missing');
    }
    return 'systemd service file points to start-mini.sh --run';
  });

  await record('D.mini heartbeats after start', async () => {
    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved'),
        runtimeDir: path.join(tempDir, 'runtime-heartbeat')
      },
      requestJson: createMiniRequestJson()
    });
    await agent.syncWithMaster();
    await agent.sendHeartbeat();
    const device = getDeviceStatus('mini_001');
    if (!device.lastSeen || !device.runtimeReady) {
      throw new Error('heartbeat did not persist runtime state');
    }
    return `manifest=${device.manifestVersion}`;
  });

  await record('D.mini polls after start', async () => {
    const device = getDeviceById('mini_001');
    const before = device.resultCount || device.results?.length || 0;
    const queued = await sendText(bot, 111, '/run mini_001 write poll.txt|from poll test');
    if (!queued.includes('Queued:')) {
      throw new Error(queued || 'task not queued');
    }

    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved'),
        runtimeDir: path.join(tempDir, 'runtime-poll')
      },
      requestJson: createMiniRequestJson()
    });
    const runResult = await agent.runOnce();
    if (!runResult.taskProcessed) {
      throw new Error('poll loop did not process queued work');
    }
    return runResult.taskId;
  });

  await record('D.mini runtime folders auto-create', async () => {
    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved-auto'),
        runtimeDir: path.join(tempDir, 'runtime-auto')
      },
      requestJson: createMiniRequestJson()
    });

    for (const folder of [agent.runtime.approvedFolder, agent.runtime.syncDir, agent.runtime.stateDir]) {
      if (!fs.existsSync(folder)) {
        throw new Error(`missing runtime folder: ${folder}`);
      }
    }

    return 'approved, sync, and state directories created';
  });

  await record('D.no manual node command required after OS boot', async () => {
    const script = fs.readFileSync(path.join(rootDir, 'device', 'start-mini.sh'), 'utf8');
    if (!script.includes('systemctl enable --now')) {
      throw new Error('service enable command missing');
    }
    return 'start-mini.sh installs and enables the systemd service';
  });

  await record('E.mini can inspect master version/skill manifest', async () => {
    const manifest = getMasterManifest();
    if (!manifest.manifestVersion || !manifest.workflows.includes('quote')) {
      throw new Error('manifest missing expected data');
    }
    return manifest.manifestVersion;
  });

  await record('E.mini can store synced metadata/config locally', async () => {
    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved-sync'),
        runtimeDir: path.join(tempDir, 'runtime-sync')
      },
      requestJson: createMiniRequestJson()
    });

    await agent.syncWithMaster();
    if (!fs.existsSync(agent.manifestPath) || !fs.existsSync(agent.statePath)) {
      throw new Error('manifest/state files not stored');
    }
    return `${agent.manifestPath} | ${agent.statePath}`;
  });

  await record('E.version/status visible to master', async () => {
    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved-visible'),
        runtimeDir: path.join(tempDir, 'runtime-visible')
      },
      requestJson: createMiniRequestJson()
    });

    await agent.syncWithMaster();
    await agent.sendHeartbeat();
    const device = getDeviceStatus('mini_001');
    if (!device.manifestVersion || device.syncStatus !== 'synced') {
      throw new Error('master cannot see sync status');
    }
    return `${device.manifestVersion} ${device.syncStatus}`;
  });

  await record('E.mini requester sends device auth headers', async () => {
    let seenHeaders = null;
    const agent = createMiniAgent({
      config: {
        cloudUrl: 'http://example.invalid',
        deviceId: 'mini_001',
        deviceSecret: 'mini-secret',
        masterApiToken: 'test-master-token',
        approvedFolder: path.join(tempDir, 'device-approved-visible'),
        runtimeDir: path.join(tempDir, 'runtime-headers')
      },
      fetchImpl: async (_url, options = {}) => {
        seenHeaders = options.headers || {};
        return {
          ok: true,
          async json() {
            return { ok: true, device: getDeviceStatus('mini_001'), manifest: getMasterManifest(), task: null };
          }
        };
      }
    });

    await agent.fetchManifest();
    if (seenHeaders['X-Device-Id'] !== 'mini_001' || seenHeaders['X-Device-Secret'] !== 'mini-secret') {
      throw new Error('device auth headers missing');
    }
    return 'X-Device-Id and X-Device-Secret present';
  });

  await record('F.path traversal blocked', async () => {
    const result = validateTask({ type: 'write_file', payload: { filename: '../bad.txt', content: 'x' } });
    if (result.ok) {
      throw new Error('traversal unexpectedly allowed');
    }
    return result.error;
  });

  await record('F.unauthorized device access blocked', async () => {
    const permission = canExecute({
      chatId: 222,
      device: getDeviceById('mini_001'),
      task: { type: 'write_file', payload: { filename: 'ok.txt', content: 'x' } }
    });
    if (permission.ok) {
      throw new Error('unauthorized access unexpectedly allowed');
    }
    return permission.error;
  });

  await record('F.unsupported task type blocked', async () => {
    const result = validateTask({ type: 'shell_root', payload: {} });
    if (result.ok) {
      throw new Error('unsupported task unexpectedly allowed');
    }
    return result.error;
  });

  await record('F.free-chat path cannot directly execute unsafe actions outside validated dispatch', async () => {
    const before = getDeviceById('mini_001').pendingTasks.length;
    const reply = await sendText(bot, 111, '/ask exec rm -rf /');
    const after = getDeviceById('mini_001').pendingTasks.length;
    if (after !== before) {
      throw new Error('unsafe free-chat created a queued task');
    }
    if (!reply.toLowerCase().includes('validated') && !reply.toLowerCase().includes('structured')) {
      throw new Error(reply || 'unsafe action was not redirected');
    }
    return reply;
  });

  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
