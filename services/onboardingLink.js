const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const rootDir = path.join(__dirname, '..');
const onboardingDir = path.join(rootDir, 'data', 'onboarding');
const payloadPrefix = 'wc1';
const qrScale = 8;
const qrMargin = 4;

function ensureOnboardingDir() {
  fs.mkdirSync(onboardingDir, { recursive: true });
}

function base64urlEncode(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function getSigningKey() {
  return process.env.MASTER_API_TOKEN || '';
}

function signDeviceId(deviceId) {
  return crypto.createHmac('sha256', getSigningKey()).update(`pair:${deviceId}`).digest('base64url').slice(0, 16);
}

function buildPairingPayload(deviceId) {
  const encodedId = base64urlEncode(deviceId);
  const signature = signDeviceId(deviceId);
  return `${payloadPrefix}_${encodedId}_${signature}`;
}

function parsePairingPayload(payload) {
  const raw = String(payload || '').trim();
  if (!raw) {
    return { ok: false, error: 'Missing start payload' };
  }

  if (/^mini_[A-Za-z0-9_-]+$/.test(raw)) {
    return { ok: true, deviceId: raw, mode: 'raw' };
  }

  const match = raw.match(/^wc1_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)$/);
  if (!match) {
    return { ok: false, error: 'Invalid start payload' };
  }

  let deviceId = '';
  try {
    deviceId = base64urlDecode(match[1]);
  } catch {
    return { ok: false, error: 'Invalid start payload' };
  }

  if (!/^mini_[A-Za-z0-9_-]+$/.test(deviceId)) {
    return { ok: false, error: 'Invalid start payload' };
  }

  const expected = signDeviceId(deviceId);
  const actual = match[2];
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, error: 'Invalid start payload' };
  }

  return { ok: true, deviceId, mode: 'signed' };
}

function buildDeepLink(botUsername, payload) {
  return `https://t.me/${botUsername}?start=${payload}`;
}

function buildQrSvg(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const size = (moduleCount + qrMargin * 2) * qrScale;
  const rects = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) {
        continue;
      }

      rects.push(
        `<rect x="${(col + qrMargin) * qrScale}" y="${(row + qrMargin) * qrScale}" width="${qrScale}" height="${qrScale}" />`
      );
    }
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<g fill="#000000">`,
    ...rects,
    `</g>`,
    `</svg>`
  ].join('\n');
}

function getQrFilePath(deviceId) {
  ensureOnboardingDir();
  return path.join(onboardingDir, `${deviceId}.svg`);
}

function writeQrFile(deviceId, svg) {
  const qrFilePath = getQrFilePath(deviceId);
  fs.writeFileSync(qrFilePath, svg, 'utf8');
  return qrFilePath;
}

function buildOnboardingAsset({ deviceId, botUsername }) {
  const payload = buildPairingPayload(deviceId);
  const deepLink = buildDeepLink(botUsername, payload);
  const svg = buildQrSvg(deepLink);
  const qrFilePath = writeQrFile(deviceId, svg);

  return {
    deviceId,
    botUsername,
    payload,
    deepLink,
    qrFilePath
  };
}

module.exports = {
  onboardingDir,
  buildPairingPayload,
  parsePairingPayload,
  buildDeepLink,
  buildQrSvg,
  getQrFilePath,
  buildOnboardingAsset
};
