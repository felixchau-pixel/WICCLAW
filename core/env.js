function isUnsetOrPlaceholder(value) {
  const trimmed = String(value || '').trim();
  return !trimmed || /^<[^>]+>$/.test(trimmed);
}

module.exports = {
  isUnsetOrPlaceholder
};
