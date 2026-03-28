function routeMessage(text) {
  const lower = String(text || '').trim().toLowerCase();

  if (!lower) {
    return { action: 'empty' };
  }

  if (lower === '/start') {
    return { action: 'onboarding_start' };
  }

  if (lower === '/reset') {
    return { action: 'reset' };
  }

  if (lower.includes('quote')) {
    return { action: 'quote' };
  }

  if (lower.includes('promo') || lower.includes('promotion')) {
    return { action: 'promo' };
  }

  if (lower.includes('calendar') || lower.includes('schedule')) {
    return { action: 'calendar' };
  }

  if (lower.includes('write file') || lower.includes('save file')) {
    return { action: 'local_write' };
  }

  return { action: 'unknown' };
}

module.exports = { routeMessage };
