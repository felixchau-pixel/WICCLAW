const sessions = new Map();

function buildSession() {
  return {
    step: null,
    flow: null,
    data: {},
    retries: 0,
    openclawRevision: 0
  };
}

function getSession(chatId) {
  const key = String(chatId);

  if (!sessions.has(key)) {
    sessions.set(key, buildSession());
  }

  return sessions.get(key);
}

function resetSession(chatId) {
  const key = String(chatId);
  sessions.set(key, buildSession());
  return sessions.get(key);
}

function getOpenClawSessionId(chatId) {
  const session = getSession(chatId);
  const safeChatId = String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `telegram-chat-${safeChatId}-r${session.openclawRevision}`;
}

function resetOpenClawSession(chatId) {
  const session = getSession(chatId);
  session.openclawRevision += 1;
  return getOpenClawSessionId(chatId);
}

function incrementRetry(chatId) {
  const session = getSession(chatId);
  session.retries += 1;
  return session.retries;
}

function clearRetry(chatId) {
  const session = getSession(chatId);
  session.retries = 0;
}

module.exports = {
  getSession,
  resetSession,
  getOpenClawSessionId,
  resetOpenClawSession,
  incrementRetry,
  clearRetry
};
