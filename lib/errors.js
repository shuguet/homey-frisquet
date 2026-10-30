'use strict';

// Only these fixed messages reach Homey's UI/logs. Never include HTTP bodies,
// request URLs, passwords or tokens in errors (the API puts tokens in URLs).
const messages = require('../locales/en.json').errors;

class FrisquetError extends Error {
  constructor(code, status) {
    super(messages[code] || messages.service);
    this.name = 'FrisquetError';
    this.code = Object.hasOwn(messages, code) ? code : 'service';
    if (status !== undefined) this.status = status;
  }
}

function safeError(error, translate) {
  const safe = error instanceof FrisquetError ? error : new FrisquetError('service');
  if (!translate) return safe;
  // Localize at the SDK boundary without mutating a shared connection error.
  const localized = new FrisquetError(safe.code, safe.status);
  const key = `errors.${safe.code}`;
  const message = translate(key);
  if (typeof message === 'string' && message && message !== key) localized.message = message;
  return localized;
}

module.exports = { FrisquetError, safeError };
