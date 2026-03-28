const { getSession, clearRetry } = require('../core/session');
const { askClaude, hasAnthropic } = require('../services/anthropic');

function startPromo(chatId) {
  const session = getSession(chatId);

  if (!session.data.businessType) {
    return 'Setup required. Type /start first.';
  }

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

  const basicReply = [
    'Promotion ready:',
    `Goal: ${session.data.promoGoal}`,
    `Offer: ${session.data.promoOffer}`,
    `Timing: ${session.data.promoTime}`
  ].join('\n');

  if (!hasAnthropic()) {
    return `${basicReply}\n\nAI unavailable.`;
  }

  try {
    const aiDraft = await askClaude({
      system: 'Give short practical promotion copy and rollout advice in plain text.',
      user: [
        `Business type: ${session.data.businessType}`,
        `Goal: ${session.data.promoGoal}`,
        `Offer: ${session.data.promoOffer}`,
        `Timing: ${session.data.promoTime}`
      ].join('\n')
    });

    return `${basicReply}\n\nAI:\n${aiDraft}`;
  } catch {
    return `${basicReply}\n\nAI failed.`;
  }
}

module.exports = {
  startPromo,
  handlePromo
};
