'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Diagnostics, anonymize, errorDetails, MAX_BYTES, MAX_ENTRIES } = require('../lib/diagnostics');
const { decode } = require('../scripts/decode-report');
const FrisquetApi = require('../lib/frisquet-api');
const { site } = require('./fixtures');

const salt = '00112233445566778899aabbccddeeff00';

test('anonymization preserves unknown hardware fields and mode IDs while removing identifiers and credentials everywhere', () => {
  const raw = {
    identifiant_chaudiere: 'PRIVATE-BOILER-123', nom: 'Private home name', agi: 'PRIVATE-SERIAL-123',
    code_postal: '75001', emails_alerte: ['owner@example.invalid'], telephones_alerte: ['+33612345678'],
    token: 'raw-response-token', access_tokens: ['opaque-array-credential'], ville: 'Private town',
    utilisateur: { username: 'private-user', password: 'private-password' },
    produit: { chaudiere: 'Hydromotrix', version1: 'v9.8.7', unknown_future_feature: { variant: 'new-hardware', value: 42 } },
    modes_ecs: [{ id: 7, nom: 'ECO+ Timer' }],
    zones: [{ numero: 2, nom: 'Private bedroom name', carac_zone: { NEW_SENSOR: 192, CONS_CONF: '205' } }],
    future_device: { configured: true, firmware_version: 'v8.0', opaque_response: [1, 2, 'unrecognized-enum'],
      echo: 'raw-response-token PRIVATE-SERIAL-123 private-password owner@example.invalid +33612345678 opaque-array-credential Private town' },
  };
  const result = anonymize(raw, { salt, secrets: ['private-password'] });
  const json = JSON.stringify(result);
  for (const secret of ['PRIVATE-BOILER-123', 'Private home name', 'PRIVATE-SERIAL-123', '75001',
    'owner@example.invalid', '+33612345678', 'raw-response-token', 'private-user', 'private-password', 'Private bedroom name',
    'opaque-array-credential', 'Private town']) {
    assert.ok(!json.includes(secret), `A private value escaped filtering: ${secret}`);
  }
  assert.equal(result.produit.unknown_future_feature.variant, 'new-hardware');
  assert.equal(result.produit.unknown_future_feature.value, 42);
  assert.equal(result.modes_ecs[0].id, 7);
  assert.equal(result.modes_ecs[0].nom, 'ECO+ Timer');
  assert.equal(result.zones[0].carac_zone.NEW_SENSOR, 192);
  assert.equal(result.zones[0].carac_zone.CONS_CONF, '205');
  assert.deepEqual(result.future_device.opaque_response, [1, 2, 'unrecognized-enum']);
  assert.equal(raw.agi, 'PRIVATE-SERIAL-123'); // Capture never changes live API data.
  assert.equal(anonymize(raw, { salt }).agi, result.agi); // Stable aliases within an installation.
});

test('raw responses are captured before parsing rejects an unfamiliar device; authentication bodies are omitted', async t => {
  const logs = [];
  const diagnostics = new Diagnostics({ log: line => logs.push(line), context: () => ({ appVersion: 'test' }) });
  t.after(() => diagnostics.close());
  const unfamiliar = { produit: { chaudiere: 'Future heat pump' }, circuits: [{ type: 'new-type', watts: 2400 }], token: 'should-not-leak' };
  const api = new FrisquetApi({ email: 'private@example.invalid', password: 'private-password' }, {
    diagnostics,
    fetchImpl: async url => new Response(JSON.stringify(url.includes('authentifications')
      ? { token: 'private-token', utilisateur: { sites: [{ identifiant_chaudiere: 'PRIVATE-ID', nom: 'Private site' }] } }
      : unfamiliar)),
  });
  t.after(() => api.close());
  await assert.rejects(api.getSite('PRIVATE-ID'), { code: 'response' });
  const report = diagnostics.prepare([]);
  const login = report.entries.find(entry => entry.data.endpoint === '/authentifications');
  assert.equal(login.data.request, undefined);
  assert.equal(login.data.response, undefined);
  const exchange = report.entries.find(entry => entry.data.endpoint === '/sites/:installation');
  assert.equal(exchange.data.response.circuits[0].type, 'new-type');
  assert.equal(exchange.data.response.circuits[0].watts, 2400);
  assert.equal(exchange.data.response.produit.chaudiere, 'Future heat pump');
  assert.doesNotMatch(JSON.stringify(report), /private@example|private-password|private-token|PRIVATE-ID|should-not-leak/);
  const decoded = decode(JSON.stringify({ logs }));
  assert.equal(decoded.id, report.id);
  assert.equal(decoded.entries.length, report.entries.length);
});

test('commands, failure responses and transport timing survive capture without affecting the request', async t => {
  const diagnostics = new Diagnostics();
  t.after(() => diagnostics.close());
  const api = new FrisquetApi({ email: 'private@example.invalid', password: 'private-password' }, {
    diagnostics, fetchImpl: async () => new Response(JSON.stringify({ error: 'unsupported_variant', new_code: 52 }), { status: 422 }),
  });
  api.token = 'private-token';
  t.after(() => api.close());
  await assert.rejects(api.order('PRIVATE-ID', [{ cle: 'MODE_ECS', valeur: '7' }]), { code: 'service', status: 422 });
  const data = diagnostics.report().entries[0].data;
  assert.equal(data.status, 422);
  assert.equal(data.response.new_code, 52);
  assert.equal(data.response.error, 'unsupported_variant');
  assert.equal(data.request[0].cle, 'MODE_ECS');
  assert.equal(data.request[0].valeur, '7');
  assert.ok(data.durationMs >= 0);
});

test('history is bounded, survives restart and can be cleared without making network requests', () => {
  let now = 100000000;
  let persisted;
  const options = { now: () => now, getState: () => persisted, setState: state => { persisted = structuredClone(state); } };
  const first = new Diagnostics(options);
  for (let index = 0; index < 140; index++) first.record('sample', { index, raw: 'x'.repeat(3000) });
  const original = first.report();
  assert.ok(original.entries.length <= MAX_ENTRIES);
  assert.ok(Buffer.byteLength(JSON.stringify(original.entries)) <= MAX_BYTES);
  first.close();
  const second = new Diagnostics(options);
  assert.deepEqual(second.report().entries, original.entries);
  now += 25 * 60 * 60 * 1000;
  assert.equal(second.report().entries.length, 0);
  second.record('new_sample', { value: 42 });
  second.clear();
  assert.equal(second.report().entries.length, 0);
  second.close();
  assert.equal(persisted.entries.length, 0);
});

test('capture failures do not break API access and exception records omit raw messages', async t => {
  const diagnostics = new Diagnostics({ setState: () => { throw new Error('storage failure'); }, log: () => { throw new Error('log failure'); } });
  t.after(() => diagnostics.close());
  const api = new FrisquetApi({ email: 'private@example.invalid', password: 'private-password' }, { diagnostics, fetchImpl: async () => new Response(JSON.stringify(site())) });
  api.token = 'private-token'; t.after(() => api.close());
  assert.equal((await api.getSite('PRIVATE-ID')).zones.length, 2);
  const error = new Error('private-password in a library response');
  error.stack = 'Error: private-password\n    at method (/app/lib/model.js:12:3)\n    at method (/private-person-name.js:12:3)';
  assert.deepEqual(errorDetails(error).frames, ['lib/model.js:12:3']);
  assert.doesNotMatch(JSON.stringify(errorDetails(error)), /private-password|private-person-name/);
});

test('log decoder detects incomplete records and raw traces remain usable without a prepared report', () => {
  const logs = [];
  const diagnostics = new Diagnostics({ log: line => logs.push(line) });
  diagnostics.record('sample', { new_field: 42 });
  diagnostics.close();
  const decoded = decode(logs.join('\n'));
  assert.equal(decoded.format, 'frisquet-trace-v1');
  assert.equal(decoded.entries[0].data.new_field, 42);
  const chunk = JSON.parse(logs[0].split('FRISQUET_TRACE ')[1]);
  chunk.total++;
  assert.throws(() => decode(`FRISQUET_TRACE ${JSON.stringify(chunk)}`), /No complete Frisquet report/);
});
