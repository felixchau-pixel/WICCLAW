const { getSession, clearRetry } = require('../core/session');

function startOnboarding(chatId) {
  const session = getSession(chatId);
  session.flow = 'onboarding';
  session.step = 'ask_business_type';
  clearRetry(chatId);

  return [
    'Welcome.',
    'Step 1: What is your business type?',
    'Examples:',
    '- nail salon',
    '- dentist',
    '- construction'
  ].join('\n');
}

function handleOnboarding(chatId, text) {
  const session = getSession(chatId);

  if (session.step !== 'ask_business_type') {
    return null;
  }

  session.data.businessType = text;
  session.flow = null;
  session.step = null;
  clearRetry(chatId);

  return [
    `Setup complete for: ${text}`,
    '',
    'Available workflows:',
    '- quote',
    '- promo',
    '- calendar'
  ].join('\n');
}

module.exports = {
  startOnboarding,
  handleOnboarding
};
