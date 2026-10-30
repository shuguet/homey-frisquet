'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FrisquetError, safeError } = require('../lib/errors');
const french = require('../locales/fr.json');

test('localization preserves retry codes without mutating shared errors or exposing unknown errors', () => {
  const translate = key => key.split('.').reduce((value, part) => value?.[part], french) || key;
  const shared = new FrisquetError('rate_limit', 429);
  const original = shared.message;
  const localized = safeError(shared, translate);
  assert.notEqual(localized, shared);
  assert.equal(shared.message, original);
  assert.equal(localized.code, 'rate_limit');
  assert.equal(localized.status, 429);
  assert.equal(localized.message, french.errors.rate_limit);
  const unexpected = safeError(new Error('private-password-in-a-library-error'), translate);
  assert.equal(unexpected.message, french.errors.service);
  assert.equal(unexpected.code, 'service');
  assert.equal(safeError(shared, key => key).message, original);
});
