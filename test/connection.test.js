'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SiteConnection } = require('../lib/site-connection');
const { FrisquetError } = require('../lib/errors');
const { modeOrders, temperatureOrders, applyOrders } = require('../lib/model');
const { site } = require('./fixtures');

function harness() {
  let data = site();
  let now = 0;
  let reads = 0;
  const orders = [];
  const timers = new Map();
  const confirmations = [];
  const api = {
    getSite: async () => { reads++; return structuredClone(data); },
    order: async (_id, payload) => { orders.push(payload); },
    watchOrder: () => {
      let finish;
      const promise = new Promise(resolve => { finish = resolve; });
      confirmations.push(finish);
      return { promise, cancel: () => finish('unconfirmed') };
    },
  };
  const connection = new SiteConnection(api, 'TEST-BOILER-01', {
    now: () => now,
    setTimer: (fn, delay) => { const id = {}; timers.set(id, { fn, delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { connection, api, orders, timers, confirmations, get reads() { return reads; },
    setData(value) { data = value; }, advance(ms) { now += ms; } };
}

test('multiple zone subscribers share one read and polling timer', async () => {
  const h = harness();
  let received = 0;
  h.connection.on('data', () => { received++; });
  await Promise.all([h.connection.refresh(), h.connection.refresh(), h.connection.refresh()]);
  assert.equal(h.reads, 1);
  assert.equal(received, 1);
  assert.equal(h.timers.size, 1);
  await h.connection.refresh();
  assert.equal(h.reads, 1);
  h.connection.stop();
  assert.equal(h.timers.size, 0);
});

test('queued mode + temperature orders use desired state, not stale cloud telemetry', async () => {
  const h = harness();
  await h.connection.refresh();
  await Promise.all([
    h.connection.command(s => modeOrders(s, 2, 'comfort')),
    h.connection.command(s => temperatureOrders(s, 2, 22)),
  ]);
  assert.deepEqual(h.orders, [[{ cle: 'SELECTEUR_Z2', valeur: '6' }], [{ cle: 'CONS_CONF_Z2', valeur: '220' }]]);
  assert.equal(h.connection.snapshot.zones[1].carac_zone.SELECTEUR, 7);
  assert.equal(h.connection.commandState, 'pending');
  h.confirmations[1]('confirmed');
  await new Promise(r => setImmediate(r));
  assert.equal(h.connection.commandState, 'confirmed');
  h.setData(applyOrders(site(), h.orders.flat()));
  await h.connection.refresh(true);
  assert.equal(h.connection.desired, null);
  h.connection.stop();
});

test('HTTP acceptance alone never marks a command confirmed', async () => {
  const h = harness();
  await h.connection.command(s => modeOrders(s, 1, 'reduced'));
  assert.equal(h.connection.commandState, 'pending');
  h.confirmations[0]('unconfirmed');
  await new Promise(r => setImmediate(r));
  assert.equal(h.connection.commandState, 'unconfirmed');
  h.connection.stop();
});

test('failed writes do not poison the queue or leave optimistic state behind', async () => {
  const h = harness();
  const originalOrder = h.api.order;
  h.api.order = async () => { throw new FrisquetError('network'); };
  await assert.rejects(h.connection.command(s => modeOrders(s, 1, 'comfort')), { code: 'network' });
  assert.equal(h.connection.commandState, 'unconfirmed');
  assert.equal(h.connection.desired, null);
  h.api.order = originalOrder;
  await h.connection.command(s => modeOrders(s, 1, 'frost'));
  assert.equal(h.orders.length, 1);
  h.connection.stop();
});

test('offline reads report unavailable, back off, and can recover', async () => {
  const h = harness();
  const states = [];
  const originalRead = h.api.getSite;
  h.connection.on('failure', error => states.push(error.code));
  h.api.getSite = async () => { throw new FrisquetError('network'); };
  await assert.rejects(h.connection.refresh(), { code: 'network' });
  await assert.rejects(h.connection.refresh(), { code: 'network' });
  assert.deepEqual(states, ['network', 'network']);
  assert.equal([...h.timers.values()][0].delay, 600000);
  h.api.getSite = originalRead;
  await h.connection.refresh();
  assert.equal(h.connection.failures, 0);
  h.connection.stop();
});

test('disconnect cancels timers and prevents queued commands from sending', async () => {
  const h = harness();
  const pending = h.connection.command(s => modeOrders(s, 1, 'comfort'));
  h.connection.stop();
  await assert.rejects(pending, { code: 'stopped' });
  assert.equal(h.orders.length, 0);
  assert.equal(h.timers.size, 0);
});
