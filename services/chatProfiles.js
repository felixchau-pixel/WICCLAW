const fs = require('fs');
const path = require('path');

const profilePath = path.join(__dirname, '..', 'data', 'chat-profiles.json');

const PROFILE_QUESTIONS = [
  { key: 'userName', prompt: 'What should I call you?' },
  { key: 'assistantName', prompt: 'What do you want to call me?' },
  { key: 'businessName', prompt: 'What is your business name?' },
  { key: 'businessType', prompt: 'What type of business is it?' },
  { key: 'topGoals', prompt: 'What are your top goals right now?' },
  { key: 'responseStyle', prompt: 'What response style do you want from me?' },
  { key: 'timezoneHours', prompt: 'What timezone and working hours should I use?' },
  { key: 'wantsReminders', prompt: 'Do you want reminders? Reply yes or no.' },
  { key: 'wantsCalendarEmail', prompt: 'Do you want calendar and email help? Reply yes or no.' },
  { key: 'topJobs', prompt: 'What top jobs do you want help with most?' }
];

function ensureStore() {
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  if (!fs.existsSync(profilePath)) {
    fs.writeFileSync(profilePath, JSON.stringify({ chats: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(profilePath, JSON.stringify(store, null, 2));
}

function getProfile(chatId) {
  const store = readStore();
  return store.chats[String(chatId)] || null;
}

function setProfile(chatId, profile) {
  const store = readStore();
  store.chats[String(chatId)] = profile;
  writeStore(store);
  return store.chats[String(chatId)];
}

function getOrCreateProfile(chatId) {
  const existing = getProfile(chatId);
  if (existing) {
    return existing;
  }

  return setProfile(chatId, {
    chatId: String(chatId),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    responses: {},
    complete: false
  });
}

function isProfileComplete(profile) {
  return Boolean(profile?.complete);
}

function getNextProfileQuestion(profile) {
  const responses = profile?.responses || {};
  return PROFILE_QUESTIONS.find((question) => !String(responses[question.key] || '').trim()) || null;
}

function startProfileIntake(chatId) {
  const profile = getOrCreateProfile(chatId);
  profile.intakeStartedAt = profile.intakeStartedAt || new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
  setProfile(chatId, profile);
  return getNextProfileQuestion(profile);
}

function saveProfileAnswer(chatId, answer) {
  const profile = getOrCreateProfile(chatId);
  const next = getNextProfileQuestion(profile);

  if (!next) {
    profile.complete = true;
    profile.updatedAt = new Date().toISOString();
    setProfile(chatId, profile);
    return { profile, nextQuestion: null };
  }

  profile.responses[next.key] = String(answer || '').trim();
  profile.updatedAt = new Date().toISOString();
  profile.complete = !getNextProfileQuestion(profile);
  setProfile(chatId, profile);
  return {
    profile,
    nextQuestion: getNextProfileQuestion(profile)
  };
}

function summarizeProfile(profile) {
  if (!profile?.responses) {
    return null;
  }

  return {
    userName: profile.responses.userName || '',
    assistantName: profile.responses.assistantName || '',
    businessName: profile.responses.businessName || '',
    businessType: profile.responses.businessType || '',
    topGoals: profile.responses.topGoals || '',
    responseStyle: profile.responses.responseStyle || '',
    timezoneHours: profile.responses.timezoneHours || '',
    wantsReminders: profile.responses.wantsReminders || '',
    wantsCalendarEmail: profile.responses.wantsCalendarEmail || '',
    topJobs: profile.responses.topJobs || ''
  };
}

module.exports = {
  PROFILE_QUESTIONS,
  getProfile,
  getOrCreateProfile,
  isProfileComplete,
  getNextProfileQuestion,
  startProfileIntake,
  saveProfileAnswer,
  summarizeProfile
};
