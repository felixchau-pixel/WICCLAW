const { getSession, clearRetry } = require('../core/session');
const { askClaude, hasAnthropic } = require('../services/anthropic');
const { getProfile } = require('../services/chatProfiles');

function startQuote(chatId) {
  const session = getSession(chatId);
  session.flow = 'quote';
  session.step = 'quote_service';
  clearRetry(chatId);
  return 'What service does the customer need a quote for?';
}

async function handleQuote(chatId, text) {
  const session = getSession(chatId);

  if (session.step === 'quote_service') {
    session.data.quoteService = text;
    session.step = 'quote_price';
    clearRetry(chatId);
    return 'What is the price?';
  }

  if (session.step !== 'quote_price') {
    return null;
  }

  session.data.quotePrice = text;
  session.flow = null;
  session.step = null;
  clearRetry(chatId);

  const service = session.data.quoteService;
  const price = session.data.quotePrice;
  const profile = getProfile(chatId);
  const businessType = profile?.responses?.businessType || session.data.businessType || '';

  if (hasAnthropic()) {
    try {
      const aiDraft = await askClaude({
        system: 'Write a concise, friendly, customer-ready quote in plain text. No headers or labels, just the quote text ready to send.',
        user: [
          businessType ? `Business type: ${businessType}` : '',
          `Service: ${service}`,
          `Price: ${price}`
        ].filter(Boolean).join('\n')
      });

      if (aiDraft) {
        return `Here's your quote:\n\n${aiDraft}`;
      }
    } catch (err) {
      console.error(`quote ai_error=${err.message}`);
    }
  }

  return [
    "Here's your quote:",
    '',
    `Service: ${service}`,
    `Price: ${price}`,
    '',
    'You can copy this and send it to your customer.'
  ].join('\n');
}

module.exports = {
  startQuote,
  handleQuote
};
