'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FrisquetApi = require('../lib/frisquet-api');
const { site, auth } = require('./fixtures');
const credentials = { email: 'test@example.invalid', password: 'only-a-test', appId: 'fixed-test-app-id' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('login, site reads, and orders use the upstream wire format and stable app ID', async () => {
  const calls = [];
  const api = new FrisquetApi(credentials, { fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (url.includes('authentifications')) return json(auth('test-token+&='), 201);
    if (url.includes('/sites/')) return json({ ...site(), emails_alerte: ['private@example.invalid'] });
    return json({ ok: true }, 201);
  } });
  const data = await api.getSite('TEST-BOILER-01');
  assert.deepEqual(data.emails_alerte, ['private@example.invalid']);
  assert.equal(data.token, undefined);
  await api.order('TEST-BOILER-01', [{ cle: 'CONS_CONF_Z2', valeur: '205' }]);
  assert.equal(calls[0].url.pathname, '/api/v1/authentifications');
  assert.equal(calls[0].url.searchParams.get('app_id'), credentials.appId);
  assert.deepEqual(JSON.parse(calls[0].options.body), { locale: 'fr', email: credentials.email, password: credentials.password, type_client: 'IOS' });
  assert.equal(calls[1].url.searchParams.get('token'), 'test-token+&=');
  assert.equal(calls[2].url.pathname, '/api/v1/ordres/TEST-BOILER-01');
  assert.deepEqual(JSON.parse(calls[2].options.body), [{ cle: 'CONS_CONF_Z2', valeur: '205' }]);
  assert.equal(calls[2].options.redirect, 'error');
  api.close();
});

test('installation information preserves requested fields and excludes account secrets', async () => {
  const data = {
    ...site(), produit: { chaudiere: 'Hydromotrix', gamme: 'Condensation', puissance: '32 kW', secret: 'not-for-display' },
    agi: 'EXAMPLE-SERIAL', sigmacom: 'EXAMPLE-CONNECT', code_postal: '01234', code_pays: 'FR',
    emails_alerte: ['alerts@example.invalid'], telephones_alerte: ['+33000000000'],
    alarmes_pro: [{ nom: 'Service required', private_data: 'not-for-display' }],
    token: 'private-token', utilisateur: { password: 'private-password' },
  };
  const api = new FrisquetApi(credentials, { fetchImpl: async () => json(data) });
  api.token = 'test-token';
  const result = await api.getSite('example');
  assert.equal(result.produit.chaudiere, 'Hydromotrix');
  assert.equal(result.produit.secret, undefined);
  assert.equal(result.agi, 'EXAMPLE-SERIAL');
  assert.equal(result.code_postal, '01234');
  assert.deepEqual(result.emails_alerte, ['alerts@example.invalid']);
  assert.deepEqual(result.telephones_alerte, ['+33000000000']);
  assert.deepEqual(result.alarmes_pro, [{ nom: 'Service required' }]);
  assert.equal(result.token, undefined);
  assert.equal(result.utilisateur, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-token|private-password|not-for-display/);
  api.close();
});

test('parallel first reads share one login', async () => {
  let logins = 0;
  const api = new FrisquetApi(credentials, { fetchImpl: async url => {
    if (url.includes('authentifications')) { logins++; await new Promise(r => setImmediate(r)); return json(auth()); }
    return json(site());
  } });
  await Promise.all([api.getSite('one'), api.getSite('two')]);
  assert.equal(logins, 1);
});

test('parallel 401/403 responses share one token renewal', async () => {
  let logins = 0;
  let reads = 0;
  const api = new FrisquetApi(credentials, { fetchImpl: async url => {
    if (url.includes('authentifications')) { logins++; return json(auth(`token-${logins}`)); }
    reads++;
    if (new URL(url).searchParams.get('token') === 'token-1') return json({}, reads % 2 ? 401 : 403);
    return json(site());
  } });
  await api.login();
  await Promise.all([api.getSite('one'), api.getSite('two')]);
  assert.equal(logins, 2);
  assert.equal(reads, 4);
});

test('an expired token on a write is refreshed and the exact body is retried once', async () => {
  let writes = 0;
  let logins = 0;
  const bodies = [];
  const api = new FrisquetApi(credentials, { fetchImpl: async (url, opts) => {
    if (url.includes('authentifications')) return json(auth(`token-${++logins}`));
    bodies.push(opts.body);
    return json({}, ++writes === 1 ? 401 : 201);
  } });
  await api.order('one', [{ cle: 'MODE_ECS', valeur: '4' }]);
  assert.equal(logins, 2);
  assert.equal(writes, 2);
  assert.equal(bodies[0], bodies[1]);
});

test('persistent unauthorized responses stop after one renewal', async () => {
  let logins = 0;
  let reads = 0;
  const api = new FrisquetApi(credentials, { fetchImpl: async url => {
    if (url.includes('authentifications')) return json(auth(`token-${++logins}`));
    reads++;
    return json({ secret: credentials.password }, 401);
  } });
  await assert.rejects(api.getSite('one'), { code: 'credentials' });
  assert.equal(logins, 2);
  assert.equal(reads, 2);
});

test('ambiguous network errors on writes never replay orders or expose secrets', async () => {
  let writes = 0;
  const api = new FrisquetApi(credentials, { fetchImpl: async url => {
    if (url.includes('authentifications')) return json(auth());
    writes++;
    throw new Error(`${url} password=${credentials.password}`);
  } });
  await assert.rejects(api.order('one', [{ cle: 'MODE_ECS', valeur: '4' }]), error => {
    assert.equal(error.code, 'network');
    assert.doesNotMatch(error.stack, /test-token|only-a-test|https:/);
    return true;
  });
  assert.equal(writes, 1);
});

test('timeouts abort requests and are not replayed', async () => {
  const api = new FrisquetApi(credentials, { timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  await assert.rejects(api.login(), { code: 'timeout' });
});

test('closing an account aborts in-flight requests and discards authentication', async () => {
  const api = new FrisquetApi(credentials, { fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('closed')));
  }) });
  const login = api.login();
  api.close();
  await assert.rejects(login, { code: 'stopped' });
  assert.equal(api.token, null);
  assert.equal(api.password, null);
  assert.equal(api.controllers.size, 0);
});

test('rate limiting, HTML errors, and malformed site responses do not masquerade as devices', async () => {
  for (const [response, code] of [[json({}, 429), 'rate_limit'], [new Response('<html>error</html>'), 'response'], [json({}), 'response']]) {
    const api = new FrisquetApi(credentials, { fetchImpl: async () => response });
    api.token = 'test-token';
    await assert.rejects(api.getSite('one'), { code });
  }
});

test('only known order keys and integer values can reach the service', async () => {
  const api = new FrisquetApi(credentials, { fetchImpl: () => assert.fail('must not send') });
  await assert.rejects(api.order('one', [{ cle: 'RESET_BOILER', valeur: '1' }]), { code: 'unsupported' });
  await assert.rejects(api.order('one', [{ cle: 'CONS_CONF_Z1', valeur: 'NaN' }]), { code: 'unsupported' });
});

test('WebSocket sends ORDRE_EN_ATTENTE and recognizes ORDRE_OK', async () => {
  let usedUrl;
  let sent;
  class Socket extends EventTarget {
    constructor(url) { super(); usedUrl = new URL(url); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(data) {
      sent = JSON.parse(data);
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ORDRE_EN_ATTENTE' }) }));
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ORDRE_OK' }) }));
    }
    close() {}
  }
  const api = new FrisquetApi(credentials, { WebSocketImpl: Socket });
  api.token = 'test-token';
  assert.equal(await api.watchOrder('one').promise, 'confirmed');
  assert.equal(usedUrl.origin, 'wss://fcappcom.frisquet.com');
  assert.equal(usedUrl.searchParams.get('identifiant_chaudiere'), 'one');
  assert.deepEqual(sent, { type: 'ORDRE_EN_ATTENTE' });
  assert.equal(api.watchers.size, 0);
});

test('WebSocket timeout or disposal remains unconfirmed and closes the watcher', async () => {
  let closed = 0;
  class Socket extends EventTarget { close() { closed++; } }
  const api = new FrisquetApi(credentials, { WebSocketImpl: Socket, confirmationMs: 5 });
  assert.equal(await api.watchOrder('one').promise, 'unconfirmed');
  const second = api.watchOrder('one');
  api.close();
  assert.equal(await second.promise, 'unconfirmed');
  assert.equal(closed, 2);
  assert.equal(api.watchers.size, 0);
});
