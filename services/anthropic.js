const Anthropic = require('@anthropic-ai/sdk');
const { isUnsetOrPlaceholder } = require('../core/env');

function getClient() {
  if (isUnsetOrPlaceholder(process.env.ANTHROPIC_API_KEY)) {
    return null;
  }

  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function hasAnthropic() {
  return !isUnsetOrPlaceholder(process.env.ANTHROPIC_API_KEY);
}

function extractText(response) {
  const parts = Array.isArray(response?.content) ? response.content : [];
  return parts
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

async function askClaude({ system, user, maxTokens = 500 }) {
  const client = getClient();

  if (!client) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || process.env.OPENCLAW_MODEL || 'claude-sonnet-4-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }]
  });

  return extractText(response);
}

async function pingAnthropic() {
  return askClaude({
    system: 'Reply with exactly: pong',
    user: 'ping',
    maxTokens: 20
  });
}

module.exports = {
  askClaude,
  hasAnthropic,
  pingAnthropic
};
