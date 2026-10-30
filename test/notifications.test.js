'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InstallationNotifications } = require('../lib/notifications');
const { DEFAULTS } = require('../lib/preferences');

function harness({ preferences = {}, state = {}, start = 0 } = {}) {
  let now = start;
  let persisted = state;
  let failSend = false;
  const timers = new Map();
  const sent = [];
  const errors = [];
  const monitor = new InstallationNotifications({
    preferences: { ...DEFAULTS, connectionNotifications: true, alarmNotifications: true, ...preferences },
    state,
    save: value => { persisted = structuredClone(value); },
    send: async (kind, tokens) => { if (failSend) throw new Error('Notification unavailable'); sent.push({ kind, tokens }); },
    onError: () => errors.push('failed'),
    now: () => now,
    setTimer: (fn, delay) => { const id = {}; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return {
    monitor, timers, sent, errors,
    get persisted() { return persisted; },
    set failSend(value) { failSend = value; },
    async advance(minutes) {
      now += minutes * 60000;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await monitor.queue;
    },
  };
}

test('a prolonged outage warns once at the deadline and recovers once', async () => {
  const h = harness();
  await h.monitor.failure();
  await h.advance(29);
  await h.monitor.failure();
  assert.equal(h.sent.length, 0);
  await h.advance(1);
  assert.deepEqual(h.sent, [{ kind: 'connection_lost', tokens: { minutes: 30 } }]);
  await h.monitor.failure();
  await h.advance(120);
  assert.equal(h.sent.length, 1);
  await h.monitor.success({ alarmes: [] });
  await h.monitor.success({ alarmes: [] });
  assert.deepEqual(h.sent.map(n => n.kind), ['connection_lost', 'connection_restored']);
  assert.equal(h.persisted.failedSince, null);
  assert.equal(h.timers.size, 0);
});

test('short failures and disabled notifications stay silent; settings apply to an active outage', async () => {
  const h = harness();
  await h.monitor.failure();
  await h.advance(5);
  await h.monitor.success({});
  await h.advance(30);
  assert.equal(h.sent.length, 0);
  await h.monitor.setPreferences({ ...DEFAULTS });
  await h.monitor.failure();
  await h.advance(35);
  assert.equal(h.timers.size, 0);
  await h.monitor.setPreferences({ ...DEFAULTS, connectionNotifications: true, connectionDelayMinutes: 60 });
  await h.advance(24);
  assert.equal(h.sent.length, 0);
  await h.advance(1);
  assert.equal(h.sent.length, 1);
  await h.monitor.setPreferences(DEFAULTS);
  await h.monitor.success({});
  assert.equal(h.sent.length, 1, 'Disabling must also suppress recovery');
  h.monitor.stop();
});

test('notification state survives restarts without repeating outages or unchanged alarms', async () => {
  const h = harness();
  const alarms = { alarmes: [{ nom: 'Connection lost' }], alarmes_pro: ['Maintenance due'] };
  await h.monitor.success(alarms);
  await h.monitor.failure();
  await h.advance(30);
  h.monitor.stop();
  const restarted = harness({ state: h.persisted, start: 31 * 60000 });
  assert.equal(restarted.timers.size, 0, 'An old outage needs a new read before warning');
  await restarted.monitor.failure();
  await restarted.advance(30);
  assert.equal(restarted.sent.length, 0);
  await restarted.monitor.success(alarms);
  assert.deepEqual(restarted.sent.map(n => n.kind), ['connection_restored']);
  assert.doesNotMatch(JSON.stringify(h.persisted), /Connection lost|Maintenance due/);
  restarted.monitor.stop();
});

test('alarms deduplicate by name, survive omitted fields, and notify again after clearing', async () => {
  const h = harness();
  await h.monitor.success({ alarmes: [{ nom: 'A', timestamp: 1 }, { nom: 'B' }], alarmes_pro: [] });
  await h.monitor.success({ alarmes: [{ nom: 'B' }, { nom: 'A', timestamp: 2 }, { nom: 'A' }] });
  await h.monitor.success({ alarmes: null, alarmes_pro: null });
  await h.monitor.success({ alarmes: [{ unexpected_field: 'A' }] });
  await h.monitor.success({ alarmes: [{ nom: 'A' }, { nom: 'B' }], alarmes_pro: [{ nom: 'Service' }] });
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent.map(n => n.kind), ['boiler_alarm', 'service_alarm']);
  await h.monitor.success({ alarmes: [], alarmes_pro: [] });
  await h.monitor.success({ alarmes: ['A'], alarmes_pro: ['Service'] });
  assert.equal(h.sent.length, 4);
  h.monitor.stop();
});

test('enabling alarms does not replay already observed alarms and separate installations stay independent', async () => {
  const h = harness({ preferences: DEFAULTS });
  await h.monitor.success({ alarmes: ['A'] });
  await h.monitor.setPreferences({ ...DEFAULTS, alarmNotifications: true });
  await h.monitor.success({ alarmes: ['A'] });
  assert.equal(h.sent.length, 0);
  await h.monitor.success({ alarmes: ['A', 'B'] });
  assert.equal(h.sent[0].tokens.alarms, 'B');
  const other = harness();
  await other.monitor.success({ alarmes: ['B'] });
  assert.equal(other.sent.length, 1);
  h.monitor.stop(); other.monitor.stop();
});

test('failed notifications retry on the next read without interrupting updates or creating a timer loop', async () => {
  const h = harness();
  h.failSend = true;
  await h.monitor.success({ alarmes: ['A'] });
  await h.monitor.failure();
  await h.advance(30);
  assert.equal(h.sent.length, 0);
  assert.equal(h.errors.length, 2);
  assert.equal(h.timers.size, 0);
  h.failSend = false;
  await h.monitor.failure();
  await h.advance(0);
  await h.monitor.success({ alarmes: ['A'] });
  assert.deepEqual(h.sent.map(n => n.kind), ['connection_lost', 'connection_restored', 'boiler_alarm']);
  h.monitor.stop();
});

test('queued reads do not duplicate alarms, and stopping cancels pending warnings', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 5 }, () => h.monitor.success({ alarmes: ['A'] })));
  assert.equal(h.sent.length, 1);
  await h.monitor.failure();
  h.monitor.stop();
  await h.advance(30);
  await h.monitor.success({ alarmes: ['B'] });
  assert.equal(h.sent.length, 1);
  assert.equal(h.timers.size, 0);
});
