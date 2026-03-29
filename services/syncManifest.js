const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getApprovedOpenClawSkills } = require('../core/openclawSkills');

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');

const manifestFiles = [
  'CLAUDE.md',
  'core/permissions.js',
  'core/openclawSkills.js',
  'core/taskValidator.js',
  'prompts/telegram-live.md',
  'services/chatProfiles.js',
  'services/googleConnect.js',
  'services/onboardingLink.js',
  'services/fileSummary.js',
  'services/telegram.js',
  'services/taskDispatch.js',
  'services/openclawAdapter.js',
  'scripts/openclaw-master-chat.js',
  'scripts/openclaw-master.js',
  'skills/onboarding.js',
  'skills/quote.js',
  'skills/promo.js',
  'skills/calendar.js',
  'skills/word-docx/SKILL.md',
  'skills/excel-xlsx/SKILL.md',
  'skills/productivity/SKILL.md',
  'skills/productivity/setup.md',
  'skills/productivity/frameworks.md',
  'skills/productivity/traps.md',
  'skills/productivity/memory-template.md',
  'skills/productivity/system-template.md',
  'bin/gog',
  'bin/himalaya'
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
    commands: ['/start', '/pair', '/run', '/devices', '/status', '/agent', '/ask', '/openclaw', '/reset'],
    approvedOpenClawSkills: getApprovedOpenClawSkills(),
    publishedRuntime: {
      telegramStartPayloadVersion: 1,
      approvedRuntimeAssets: [
        'prompts/telegram-live.md',
        'core/openclawSkills.js',
        'services/chatProfiles.js',
        'services/googleConnect.js',
        'services/fileSummary.js',
        'skills/word-docx/SKILL.md',
        'skills/excel-xlsx/SKILL.md',
        'skills/productivity/SKILL.md',
        'skills/productivity/setup.md',
        'skills/productivity/frameworks.md',
        'skills/productivity/traps.md',
        'skills/productivity/memory-template.md',
        'skills/productivity/system-template.md',
        'bin/gog',
        'bin/himalaya'
      ],
      approvedWorkspaceSkills: [
        'word-docx',
        'excel-xlsx',
        'productivity'
      ]
    },
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
