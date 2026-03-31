const { getSession, clearRetry } = require('../core/session');
const { getOrCreateProfile, setProfile } = require('../services/chatProfiles');

function startOnboarding(chatId) {
  const session = getSession(chatId);
  session.flow = 'onboarding';
  session.step = 'ask_name';
  clearRetry(chatId);

  return "Hey \u2014 I'm your assistant. Before we get going, what should I call you?";
}

function handleOnboarding(chatId, text) {
  const session = getSession(chatId);
  const trimmed = String(text || '').trim();

  if (!trimmed) {
    return null;
  }

  if (session.step === 'ask_name') {
    const profile = getOrCreateProfile(chatId);
    profile.responses.userName = trimmed;
    profile.updatedAt = new Date().toISOString();
    setProfile(chatId, profile);

    session.step = 'ask_assistant_name';
    clearRetry(chatId);
    return `Got it, ${trimmed}. And what would you like to call me?`;
  }

  if (session.step === 'ask_assistant_name') {
    const profile = getOrCreateProfile(chatId);
    profile.responses.assistantName = trimmed;
    profile.updatedAt = new Date().toISOString();
    setProfile(chatId, profile);

    session.step = 'ask_help_style';
    clearRetry(chatId);
    return `${trimmed}, I like it. One more thing \u2014 how do you like your help delivered? For example: short and direct, detailed, step-by-step, or whatever works for you.`;
  }

  if (session.step === 'ask_help_style') {
    const profile = getOrCreateProfile(chatId);
    profile.responses.responseStyle = trimmed;
    profile.onboardedAt = new Date().toISOString();
    profile.updatedAt = new Date().toISOString();
    setProfile(chatId, profile);

    session.flow = null;
    session.step = null;
    clearRetry(chatId);

    const userName = profile.responses.userName || '';
    const assistantName = profile.responses.assistantName || 'your assistant';
    return `Perfect, ${userName}. I'm ${assistantName} and I've got the basics saved. What do you want to work on?`;
  }

  return null;
}

module.exports = {
  startOnboarding,
  handleOnboarding
};
