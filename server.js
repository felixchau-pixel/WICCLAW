require('dotenv').config();

const express = require('express');
const fs = require('fs');

const { isUnsetOrPlaceholder } = require('./core/env');
const { startTelegram, getTelegramBotIdentity } = require('./services/telegram');
const { validateTask } = require('./core/taskValidator');
const { canExecute } = require('./core/permissions');
const {
  upsertHeartbeat,
  getAllDeviceStatuses,
  getDeviceStatus,
  getDeviceById,
  pullNextTask,
  saveTaskResult,
  getTaskResult
} = require('./services/deviceRegistry');
const { dispatchTask } = require('./services/taskDispatch');
const { getMasterManifest } = require('./services/syncManifest');
const { buildOnboardingAsset, getQrFilePath } = require('./services/onboardingLink');
const { validateState, updateConnectRequest, getChatConnectState } = require('./services/googleConnect');

function createApp() {
  const app = express();
  const masterApiToken = process.env.MASTER_API_TOKEN || '';

  app.use(express.json({ limit: '1mb' }));

  function requireMasterToken(req, res, next) {
    if (isUnsetOrPlaceholder(masterApiToken)) {
      return res.status(503).json({ ok: false, error: 'MASTER_API_TOKEN is not configured' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (token !== masterApiToken) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    return next();
  }

  function requireKnownDevice(req, res, next) {
    const deviceId = req.params.deviceId || req.params.id || req.body?.deviceId || req.headers['x-device-id'];
    const deviceSecret = req.headers['x-device-secret'];

    if (!deviceId || !deviceSecret) {
      return res.status(401).json({ ok: false, error: 'Device authentication required' });
    }

    const device = getDeviceById(String(deviceId));
    if (!device) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    if (String(device.deviceSecret) !== String(deviceSecret)) {
      return res.status(401).json({ ok: false, error: 'Secret mismatch' });
    }

    req.device = device;
    return next();
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/manifest', requireMasterToken, (_req, res) => {
    res.json({ ok: true, manifest: getMasterManifest() });
  });

  app.get('/api/manifest/:deviceId', requireMasterToken, requireKnownDevice, (req, res) => {
    const device = getDeviceStatus(req.params.deviceId);

    if (!device) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    return res.json({
      ok: true,
      manifest: getMasterManifest(),
      device
    });
  });

  app.get('/api/onboarding/:deviceId', requireMasterToken, async (req, res) => {
    const device = getDeviceStatus(req.params.deviceId);

    if (!device) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    const identity = await getTelegramBotIdentity();
    const asset = buildOnboardingAsset({
      deviceId: req.params.deviceId,
      botUsername: identity.username
    });

    return res.json({
      ok: true,
      device,
      onboarding: {
        ...asset,
        qrApiPath: `/api/onboarding/${req.params.deviceId}/qr.svg`
      }
    });
  });

  app.get('/api/onboarding/:deviceId/qr.svg', requireMasterToken, async (req, res) => {
    const device = getDeviceStatus(req.params.deviceId);

    if (!device) {
      return res.status(404).type('text/plain').send('Device not found');
    }

    const identity = await getTelegramBotIdentity();
    const asset = buildOnboardingAsset({
      deviceId: req.params.deviceId,
      botUsername: identity.username
    });

    const svg = fs.readFileSync(getQrFilePath(req.params.deviceId), 'utf8');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('X-Telegram-Deep-Link', asset.deepLink);
    return res.send(svg);
  });

  app.get('/auth/google/start', (req, res) => {
    const validated = validateState(req.query.state);
    if (!validated.ok) {
      return res.status(400).type('text/plain').send(validated.error);
    }

    const clientPath = `${process.env.HOME || '/home/wicma'}/.config/gogcli/credentials.json`;
    if (!fs.existsSync(clientPath)) {
      updateConnectRequest(validated.request.token, {
        status: 'blocked',
        blocker: 'OAuth client credentials missing',
        chatState: {
          google: {
            connected: false,
            status: 'blocked',
            blocker: 'OAuth client credentials missing',
            service: validated.request.service
          }
        }
      });
      return res.status(503).type('text/plain').send('OAuth client credentials missing on the master host.');
    }

    updateConnectRequest(validated.request.token, {
      status: 'ready_for_oauth',
      chatState: {
        google: {
          connected: false,
          status: 'ready_for_oauth',
          service: validated.request.service
        }
      }
    });
    return res.type('text/plain').send('Google OAuth start endpoint is ready. Complete the gog auth flow on the master host.');
  });

  app.get('/auth/google/callback', (req, res) => {
    const validated = validateState(req.query.state);
    if (!validated.ok) {
      return res.status(400).type('text/plain').send(validated.error);
    }

    updateConnectRequest(validated.request.token, {
      status: 'callback_received',
      callbackUrl: req.originalUrl,
      chatState: {
        google: {
          connected: false,
          status: 'callback_received',
          service: validated.request.service
        }
      }
    });

    return res.type('text/plain').send('Google callback received. Complete token exchange on the master host.');
  });

  app.get('/api/google/connect-state/:chatId', requireMasterToken, (req, res) => {
    return res.json({ ok: true, state: getChatConnectState(req.params.chatId) });
  });

  app.post('/api/heartbeat', (req, res) => {
    const result = upsertHeartbeat(req.body || {});
    res.status(result.ok ? 200 : 401).json(result);
  });

  app.get('/api/devices', requireMasterToken, (_req, res) => {
    res.json({ ok: true, devices: getAllDeviceStatuses() });
  });

  app.get('/api/device-status/:id', requireMasterToken, (req, res) => {
    const device = getDeviceStatus(req.params.id);

    if (!device) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    return res.json({ ok: true, device });
  });

  app.get('/api/task/:deviceId', requireMasterToken, requireKnownDevice, (req, res) => {
    const task = pullNextTask(req.params.deviceId);
    res.json({ ok: true, task });
  });

  app.post('/api/task/result', requireMasterToken, requireKnownDevice, (req, res) => {
    const { deviceId, taskId, result } = req.body || {};

    if (!deviceId || !taskId) {
      return res.status(400).json({ ok: false, error: 'deviceId and taskId are required' });
    }

    const saved = saveTaskResult(deviceId, taskId, result);

    if (!saved.ok) {
      return res.status(404).json(saved);
    }

    return res.json(saved);
  });

  app.get('/api/task/result/:deviceId/:taskId', requireMasterToken, (req, res) => {
    const result = getTaskResult(req.params.deviceId, req.params.taskId);

    if (!result) {
      return res.status(404).json({ ok: false, error: 'Result not found' });
    }

    return res.json({ ok: true, result });
  });

  app.post('/run', requireMasterToken, async (req, res) => {
    const { deviceId, task, chatId } = req.body || {};

    if (!deviceId) {
      return res.status(400).json({ ok: false, error: 'deviceId is required' });
    }

    const validation = validateTask(task);
    if (!validation.ok) {
      return res.status(400).json(validation);
    }

    const device = getDeviceById(deviceId);
    const permission = canExecute({ chatId, device, task });
    if (!permission.ok) {
      return res.status(403).json(permission);
    }

    const result = await dispatchTask({ deviceId, task, source: 'http' });
    return res.status(result.ok ? 200 : 503).json(result);
  });

  return app;
}

function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    console.log(`WicClaw master listening on port ${port}`);
  });

  if (process.env.DISABLE_TELEGRAM_POLLING !== 'true') {
    startTelegram();
  }

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
