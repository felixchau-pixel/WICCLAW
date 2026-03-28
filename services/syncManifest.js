const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');

const manifestFiles = [
  'CLAUDE.md',
  'core/permissions.js',
  'core/taskValidator.js',
  'services/taskDispatch.js',
  'services/openclawAdapter.js',
  'skills/onboarding.js',
  'skills/quote.js',
  'skills/promo.js',
  'skills/calendar.js'
];

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, filePath))).digest('hex');
}

function buildManifestVersion() {
  const hash = crypto.createHash('sha256');

  for (const filePath of manifestFiles) {
    hash.update(filePath);
    hash.update(fileDigest(filePath));
  }

  return hash.digest('hex').slice(0, 16);
}

function getOpenClawPackageVersion() {
  const pkg = readPackageJson();
  return pkg.dependencies?.openclaw || '';
}

function getMasterManifest() {
  const pkg = readPackageJson();
  const manifestVersion = buildManifestVersion();

  return {
    applianceModel: 'wicclaw-mini',
    manifestVersion,
    generatedAt: new Date().toISOString(),
    packageVersion: pkg.version,
    openclawVersion: getOpenClawPackageVersion(),
    assistantMode: 'master-mediated',
    workflows: ['onboarding', 'quote', 'promo', 'calendar'],
    commands: ['/pair', '/run', '/devices', '/status', '/agent', '/ask'],
    syncFiles: manifestFiles,
    policies: {
      validatorRequired: true,
      permissionsRequired: true,
      openclawFirstDispatch: true,
      fallbackQueue: true,
      approvedFolderRestricted: true,
      pairingRequired: true
    }
  };
}

module.exports = {
  getMasterManifest
};
