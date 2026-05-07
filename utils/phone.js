function getPhoneDigits(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function normalizePhoneNumber(value = '') {
  const digits = getPhoneDigits(value);
  if (digits.length !== 10) return '';
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatPhoneNumber(value = '') {
  return normalizePhoneNumber(value) || (value || 'not set');
}

function formatPhoneLink(value = '') {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return value || 'not set';
  const digits = getPhoneDigits(value);
  return `[${normalized}](tel:+1${digits})`;
}

module.exports = {
  getPhoneDigits,
  normalizePhoneNumber,
  formatPhoneNumber,
  formatPhoneLink
};
