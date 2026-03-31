const { getSession, clearRetry } = require('../core/session');
const { askClaude, hasAnthropic } = require('../services/anthropic');
const { getProfile } = require('../services/chatProfiles');

function startPromo(chatId) {
  const session = getSession(chatId);
  session.flow = 'promo';
  session.step = 'promo_goal';
  clearRetry(chatId);
  return 'What is the goal of this promotion?';
}

async function handlePromo(chatId, text) {
  const session = getSession(chatId);

  if (session.step === 'promo_goal') {
    session.data.promoGoal = text;
    session.step = 'promo_offer';
    clearRetry(chatId);
    return 'What is the offer?';
  }

  if (session.step === 'promo_offer') {
    session.data.promoOffer = text;
    session.step = 'promo_time';
    clearRetry(chatId);
    return 'When should this run?';
  }

  if (session.step !== 'promo_time') {
    return null;
  }

  session.data.promoTime = text;
  session.flow = null;
  session.step = null;
  clearRetry(chatId);

  const goal = session.data.promoGoal;
  const offer = session.data.promoOffer;
  const timing = session.data.promoTime;
  const profile = getProfile(chatId);
  const businessType = profile?.responses?.businessType || session.data.businessType || '';

  if (hasAnthropic()) {
    try {
      const aiDraft = await askClaude({
        system: 'Write short, practical promotion copy and rollout advice in plain text. Keep it ready to use.',
        user: [
          businessType ? `Business type: ${businessType}` : '',
          `Goal: ${goal}`,
          `Offer: ${offer}`,
          `Timing: ${timing}`
        ].filter(Boolean).join('\n')
      });

      if (aiDraft) {
        return `Here's your promo plan:\n\n${aiDraft}`;
      }
    } catch (err) {
      console.error(`promo ai_error=${err.message}`);
    }
  }

  return [
    "Here's your promo plan:",
    '',
    `Goal: ${goal}`,
    `Offer: ${offer}`,
    `Timing: ${timing}`,
    '',
    'You can use this as a starting point for your campaign.'
  ].join('\n');
}

module.exports = {
  startPromo,
  handlePromo
};
