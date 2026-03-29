const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const connectPath = path.join(__dirname, '..', 'data', 'google-connect.json');

function ensureStore() {
  fs.mkdirSync(path.dirname(connectPath), { recursive: true });
  if (!fs.existsSync(connectPath)) {
    fs.writeFileSync(connectPath, JSON.stringify({ requests: {}, chatStates: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(connectPath, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(connectPath, JSON.stringify(store, null, 2));
}

function getSigningKey() {
  return process.env.MASTER_API_TOKEN || 'wicclaw-connect';
}

function signValue(value) {
  return crypto.createHmac('sha256', getSigningKey()).update(value).digest('base64url').slice(0, 24);
}

function normalizeBaseUrl(raw) {
  if (!raw) {
    return '';
  }
  const text = String(raw).trim();
  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(text) ? text : `http://${text.replace(/\/$/, '')}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.port && ![80, 443].includes(Number(process.env.PORT || 3000))) {
      parsed.port = String(process.env.PORT || 3000);
    } else if (!parsed.port && parsed.protocol === 'http:' && String(process.env.PORT || 3000) !== '80') {
      parsed.port = String(process.env.PORT || 3000);
    } else if (!parsed.port && parsed.protocol === 'https:' && String(process.env.PORT || 3000) !== '443') {
      parsed.port = String(process.env.PORT || 3000);
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return withScheme.replace(/\/$/, '');
  }
}

function inferPublicBaseUrl() {
  const explicit = process.env.MASTER_PUBLIC_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL;
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  const deviceEnvPath = path.join(__dirname, '..', 'device', '.env');
  try {
    const cloudLine = fs.readFileSync(deviceEnvPath, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('CLOUD_URL='));
    if (cloudLine) {
      return normalizeBaseUrl(cloudLine.slice('CLOUD_URL='.length));
    }
  } catch {}

  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

function createConnectRequest({ chatId, service }) {
  const token = crypto.randomBytes(18).toString('base64url');
  const store = readStore();
  store.requests[token] = {
    token,
    chatId: String(chatId),
    service,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  writeStore(store);
  return store.requests[token];
}

function getConnectRequest(token) {
  const store = readStore();
  return store.requests[String(token)] || null;
}

function updateConnectRequest(token, patch) {
  const store = readStore();
  if (!store.requests[String(token)]) {
    return null;
  }
  store.requests[String(token)] = {
    ...store.requests[String(token)],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  if (patch.chatState) {
    store.chatStates[String(store.requests[String(token)].chatId)] = {
      ...(store.chatStates[String(store.requests[String(token)].chatId)] || {}),
      ...patch.chatState,
      updatedAt: new Date().toISOString()
    };
  }
  writeStore(store);
  return store.requests[String(token)];
}

function getChatConnectState(chatId) {
  const store = readStore();
  return store.chatStates[String(chatId)] || {
    google: {
      connected: false,
      status: 'disconnected'
    }
  };
}

function buildConnectLink({ chatId, service }) {
  const request = createConnectRequest({ chatId, service });
  const state = `${request.token}.${signValue(request.token)}`;
  return {
    request,
    state,
    url: `${inferPublicBaseUrl()}/auth/google/start?state=${encodeURIComponent(state)}`
  };
}

function validateState(state) {
  const raw = String(state || '');
  const [token, signature] = raw.split('.');
  if (!token || !signature) {
    return { ok: false, error: 'Invalid auth state' };
  }

  const expected = signValue(token);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid auth state' };
  }

  const request = getConnectRequest(token);
  if (!request) {
    return { ok: false, error: 'Auth request not found' };
  }

  return { ok: true, request };
}

module.exports = {
  inferPublicBaseUrl,
  buildConnectLink,
  validateState,
  updateConnectRequest,
  getChatConnectState
};
