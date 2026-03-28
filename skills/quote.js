const { getSession, clearRetry } = require('../core/session');
const { askClaude, hasAnthropic } = require('../services/anthropic');

function startQuote(chatId) {
  const session = getSession(chatId);

  if (!session.data.businessType) {
    return 'Setup required. Type /start first.';
  }

  session.flow = 'quote';
  session.step = 'quote_service';
  clearRetry(chatId);
  return 'What service does the customer need?';
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

  const businessType = session.data.businessType;
  const service = session.data.quoteService;
  const price = session.data.quotePrice;
  const basicReply = `Quote ready:\nService: ${service}\nPrice: ${price}`;

  if (!hasAnthropic()) {
    return `${basicReply}\n\nAI unavailable. Add ANTHROPIC_API_KEY.`;
  }

  try {
    const aiDraft = await askClaude({
      system: 'Write a concise customer-ready quote in plain text.',
      user: `Business type: ${businessType}\nService: ${service}\nPrice: ${price}`
    });

    return `${basicReply}\n\nAI:\n${aiDraft}`;
  } catch {
    return `${basicReply}\n\nAI failed.`;
  }
}

module.exports = {
  startQuote,
  handleQuote
};
