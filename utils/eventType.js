function normalizeList(values = []) {
  return (values || [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function titleEqualsOneOf(title = '', candidates = []) {
  const normalizedTitle = String(title || '').trim().toLowerCase();
  return normalizeList(candidates).includes(normalizedTitle);
}

function titleContainsOneOf(title = '', candidates = []) {
  const normalizedTitle = String(title || '').toLowerCase();
  return normalizeList(candidates).some((candidate) => normalizedTitle.includes(candidate));
}

function getEventTypeConfig(config = {}) {
  const defaults = {
    autoDetect: true,
    practiceExactNames: ['Practice'],
    matchExactNames: [],
    otherExactNames: [],
    practiceKeywords: ['practice', 'training', 'session'],
    matchKeywords: ['match', 'game', 'fixture']
  };
  return {
    ...defaults,
    ...(config.eventTypes || {})
  };
}

function determineEventType(event = {}, config = {}) {
  if (event.type && ['practice', 'match', 'other'].includes(event.type)) return event.type;
  const rules = getEventTypeConfig(config);
  const title = event.title || '';

  if (titleEqualsOneOf(title, rules.practiceExactNames)) return 'practice';
  if (titleEqualsOneOf(title, rules.matchExactNames)) return 'match';
  if (titleEqualsOneOf(title, rules.otherExactNames)) return 'other';

  if (!rules.autoDetect) return 'other';

  if (titleContainsOneOf(title, rules.matchKeywords)) return 'match';
  if (titleContainsOneOf(title, rules.practiceKeywords)) return 'practice';
  return 'other';
}

function eventTypeLabel(type) {
  if (type === 'match') return 'Match';
  if (type === 'practice') return 'Practice';
  return 'Other';
}

module.exports = {
  determineEventType,
  eventTypeLabel,
  getEventTypeConfig
};
