'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { site, auth } = require('./fixtures');
const manifest = require('../app.json');

// A small SDK boundary mock. Production classes and their shared connection
// logic run unchanged; only Homey's storage/capability/Flow APIs are supplied.
function sdkHarness(language = 'en') {
  const cards = new Map();
  const timers = new Map();
  const triggered = [];
  const translations = require(`../locales/${language}.json`);
  const card = (kind, id) => {
    assert.ok(manifest.flow[kind].some(c => c.id === id), `Unknown Flow card ${id}`);
    if (!cards.has(id)) cards.set(id, {
      registerRunListener(fn) { this.run = fn; return this; },
      registerArgumentAutocompleteListener(name, fn) { this.autocomplete = fn; return this; },
      async trigger(device, tokens) { triggered.push({ id, device, tokens }); },
    });
    return cards.get(id);
  };
  const context = {
    i18n: { getLanguage: () => language },
    flow: { getActionCard: id => card('actions', id), getConditionCard: id => card('conditions', id), getDeviceTriggerCard: id => card('triggers', id) },
    setTimeout(fn, delay) { const id = {}; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    __(key) { return key.split('.').reduce((v, k) => v?.[k], translations) || key; },
  };
  class Base {
    constructor() { this.homey = context; }
    log() {}
    error() {}
  }
  class Device extends Base {
    constructor(pairing, driverId) {
      super();
      this.pairing = structuredClone(pairing);
      const driver = manifest.drivers.find(d => d.id === driverId);
      this.capabilities = new Map((pairing.capabilities || driver.capabilities).map(c => [c, null]));
      this.options = { ...driver.capabilitiesOptions, ...pairing.capabilitiesOptions };
      this.listeners = {};
    }
    getData() { return this.pairing.data; }
    getStoreValue(key) { return this.pairing.store[key]; }
    async setStoreValue(key, value) { this.pairing.store[key] = value; }
    hasCapability(id) { return this.capabilities.has(id); }
    getCapabilityValue(id) { return this.capabilities.get(id); }
    async addCapability(id) { this.capabilities.set(id, null); }
    async removeCapability(id) { this.capabilities.delete(id); delete this.listeners[id]; }
    async setCapabilityValue(id, value) {
      assert.ok(this.hasCapability(id), `Missing capability ${id}`);
      this.capabilities.set(id, value);
    }
    async setCapabilityOptions(id, options) { this.options[id] = { ...this.options[id], ...options }; }
    registerCapabilityListener(id, fn) { this.listeners[id] = fn; }
    async setUnavailable(message) { this.available = false; this.unavailableMessage = message; }
    async setAvailable() { this.available = true; }
  }
  const Homey = { App: Base, Driver: Base, Device };
  const cache = new Map();
  const root = path.resolve(__dirname, '..');
  function load(file) {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.js';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const nativeRequire = createRequire(file);
    const localRequire = name => name === 'homey' ? Homey
      : name.startsWith('.') && !name.endsWith('.json') ? load(path.resolve(path.dirname(file), name)) : nativeRequire(name);
    const wrapper = vm.runInThisContext(`(function(require,module,exports,__dirname,__filename){\n${fs.readFileSync(file, 'utf8')}\n})`, { filename: file });
    wrapper(localRequire, mod, mod.exports, path.dirname(file), file);
    return mod.exports;
  }
  return { context, cards, timers, triggered, load };
}

const credentials = { email: 'sdk@example.invalid', password: 'fake-sdk-password', appId: 'fake-app-id' };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('native devices pair with stable IDs, register Flows, share polling, and reject invalid repairs', async t => {
  const h = sdkHarness();
  const App = h.load('app.js');
  const app = new App();
  h.context.app = app;
  await app.onInit();
  t.after(() => app.onUninit());
  const zoneDriver = new (h.load('drivers/zone/driver.js'))();
  const boilerDriver = new (h.load('drivers/boiler/driver.js'))();
  const zones = zoneDriver.pairDevices(site(), credentials);
  const boilers = boilerDriver.pairDevices(site(), credentials);
  assert.deepEqual(zones.map(z => z.data.id), ['TEST-BOILER-01:zone:1', 'TEST-BOILER-01:zone:2']);
  assert.equal(zones[1].capabilitiesOptions.frisquet_mode.values.some(v => v.id === 'boost'), false);
  assert.equal(boilers[0].capabilitiesOptions.frisquet_water_mode.values[0].id, '0');

  // Seed a connection through the real account pool, substituting HTTP only.
  const seed = app.acquire(credentials, 'TEST-BOILER-01');
  let reads = 0;
  const api = seed.connection.api;
  api.getSite = async () => { reads++; return site(); };
  const zone = new (h.load('drivers/zone/device.js'))(zones[0], 'zone');
  const boiler = new (h.load('drivers/boiler/device.js'))(boilers[0], 'boiler');
  await Promise.all([zone.onInit(), boiler.onInit()]);
  seed.release();
  await tick();
  await Promise.all([zone.updateQueue, boiler.updateQueue]);
  assert.equal(app.connections.size, 1);
  assert.equal(app.accounts.size, 1);
  assert.equal(reads, 1);
  assert.equal(zone.available, true);
  assert.equal(boiler.available, true);
  assert.equal(zone.getCapabilityValue('measure_temperature'), 19.8);
  assert.equal(boiler.getCapabilityValue('measure_temperature.outdoor'), 8.5);
  assert.equal(boiler.getCapabilityValue('frisquet_water_mode'), '1');
  assert.equal(h.cards.get('zone_mode_is').run({ device: zone, mode: 'auto' }), true);

  const sent = [];
  api.order = async (_id, payload) => { sent.push(payload); };
  api.watchOrder = () => ({ promise: Promise.resolve('confirmed'), cancel() {} });
  assert.equal(await h.cards.get('set_zone_mode').run({ device: zone, mode: 'reduced' }), true);
  await h.cards.get('set_hot_water_mode').run({ device: boiler, mode: { id: '4' } });
  await h.cards.get('set_profile_temperature').run({ device: zone, profile: 'comfort', temperature: 20.5 });
  await h.cards.get('set_installation_override').run({ device: boiler, mode: 'auto' });
  await tick();
  assert.deepEqual(sent.map(s => s[0].cle), ['SELECTEUR_Z1', 'MODE_ECS', 'CONS_CONF_Z1', 'MODE_DERO']);
  assert.ok(h.triggered.some(e => e.id === 'command_state_changed' && e.tokens.state === 'confirmed'));
  const modes = await h.cards.get('set_hot_water_mode').autocomplete('eco', { device: boiler });
  assert.equal(modes.length, 2);

  // A bad account repair must not replace any stored passwords.
  await assert.rejects(app.repairCredentials(zone, { ...credentials, password: 'new' }, [{ id: 'another-site' }]), { code: 'credentials' });
  assert.equal(zone.getStoreValue('credentials').password, credentials.password);

  await zone.onDeleted();
  assert.equal(app.connections.size, 1);
  await boiler.onDeleted();
  assert.equal(app.connections.size, 0);
  assert.equal(app.accounts.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(api.closed, true);
});

test('upgrading the old boiler adds both mode lists, temperature controls and Boost without re-pairing', async t => {
  const h = sdkHarness();
  const app = new (h.load('app.js'))();
  h.context.app = app;
  await app.onInit();
  t.after(() => app.onUninit());
  const pairing = {
    data: { id: 'TEST-BOILER-01:boiler', siteId: 'TEST-BOILER-01' }, store: { credentials },
    capabilities: ['frisquet_water_mode', 'alarm_generic', 'frisquet_command_state', 'button.refresh'],
  };
  const lease = app.acquire(credentials, 'TEST-BOILER-01');
  const sent = [];
  lease.connection.api.getSite = async () => site();
  lease.connection.api.order = async (_id, orders) => sent.push(orders);
  lease.connection.api.watchOrder = () => ({ promise: Promise.resolve('unconfirmed'), cancel() {} });
  const device = new (h.load('drivers/boiler/device.js'))(pairing, 'boiler');
  await device.onInit();
  lease.release();
  await tick();
  await device.updateQueue;
  assert.equal(device.available, true);
  assert.equal(device.getData().id, pairing.data.id);
  assert.equal(device.getStoreValue('credentials').password, credentials.password);
  assert.equal(device.getStoreValue('primaryZone'), 1);
  assert.equal(device.getCapabilityValue('measure_temperature'), 19.8);
  assert.equal(device.getCapabilityValue('target_temperature'), 21);
  assert.equal(device.getCapabilityValue('frisquet_mode'), 'auto');
  assert.equal(device.getCapabilityValue('frisquet_water_mode'), '1');
  assert.equal(device.getCapabilityValue('frisquet_boost'), false);
  assert.equal(device.getCapabilityValue('frisquet_comfort_temperature'), 21);
  assert.equal(device.getCapabilityValue('frisquet_reduced_temperature'), 17);
  assert.equal(device.getCapabilityValue('frisquet_frost_temperature'), 7);
  assert.equal(device.getCapabilityValue('target_temperature.comfort'), 21);
  assert.equal(device.getCapabilityValue('target_temperature.reduced'), 17);
  assert.equal(device.getCapabilityValue('target_temperature.frost'), 7);
  assert.equal(device.hasCapability('button.refresh'), false);
  assert.equal(device.listeners['button.refresh'], undefined);

  await device.listeners.target_temperature(22);
  await tick(); await device.updateQueue;
  assert.equal(device.getCapabilityValue('target_temperature'), 22);
  assert.equal(device.getCapabilityValue('frisquet_comfort_temperature'), 22);
  assert.equal(device.getCapabilityValue('measure_temperature.applied'), 21);
  assert.equal(device.getCapabilityValue('measure_temperature'), 19.8);
  // A stale cloud response must not undo the accepted request in the UI.
  await device.connection.refresh(true); await device.updateQueue;
  assert.equal(device.getCapabilityValue('target_temperature'), 22);
  await device.listeners.frisquet_water_mode('0');
  await device.listeners.frisquet_boost(true);
  await device.listeners.frisquet_boost(false);
  await device.listeners['target_temperature.reduced'](16);
  await device.listeners['target_temperature.frost'](8.5);
  await tick(); await device.updateQueue;
  assert.deepEqual(sent, [
    [{ cle: 'CONS_CONF_Z1', valeur: '220' }],
    [{ cle: 'MODE_ECS', valeur: '0' }],
    [{ cle: 'SELECTEUR_Z1', valeur: '5' }, { cle: 'ACTIVITE_BOOST_Z1', valeur: '1' }],
    [{ cle: 'ACTIVITE_BOOST_Z1', valeur: '0' }],
    [{ cle: 'CONS_RED_Z1', valeur: '160' }],
    [{ cle: 'CONS_HG_Z1', valeur: '85' }],
  ]);
  assert.equal(h.triggered.some(e => e.id === 'water_mode_changed' || e.id === 'zone_mode_changed'), false);
  assert.equal(device.getCapabilityValue('frisquet_water_mode'), '0');
  assert.equal(device.getCapabilityValue('target_temperature.reduced'), 16);
  assert.equal(device.getCapabilityValue('frisquet_reduced_temperature'), 16);
  assert.equal(device.getCapabilityValue('target_temperature.frost'), 8.5);
  assert.equal(device.getCapabilityValue('frisquet_frost_temperature'), 8.5);
  await device.onDeleted();
});

test('all heating zones are present on the combined device and controls address the correct zone', async t => {
  const h = sdkHarness();
  const app = new (h.load('app.js'))();
  h.context.app = app;
  await app.onInit();
  t.after(() => app.onUninit());
  const pairing = new (h.load('drivers/boiler/driver.js'))().pairDevices(site(), credentials)[0];
  const lease = app.acquire(credentials, 'TEST-BOILER-01');
  const sent = [];
  lease.connection.api.getSite = async () => site();
  lease.connection.api.order = async (_id, orders) => sent.push(orders);
  lease.connection.api.watchOrder = () => ({ promise: Promise.resolve('confirmed'), cancel() {} });
  const device = new (h.load('drivers/boiler/device.js'))(pairing, 'boiler');
  await device.onInit(); lease.release();
  await tick(); await device.updateQueue;
  assert.equal(device.getCapabilityValue('target_temperature.zone2'), 17);
  assert.equal(device.getCapabilityValue('measure_temperature.zone2'), 19.8);
  assert.equal(device.getCapabilityValue('measure_temperature.applied_zone2'), 21);
  assert.equal(device.hasCapability('frisquet_boost.zone2'), false);
  await device.listeners['frisquet_mode.zone2']('comfort');
  await device.listeners['target_temperature.zone2'](22.5);
  await device.listeners['target_temperature.frost_zone2'](8);
  assert.deepEqual(sent, [[{ cle: 'SELECTEUR_Z2', valeur: '6' }], [{ cle: 'CONS_CONF_Z2', valeur: '225' }], [{ cle: 'CONS_HG_Z2', valeur: '80' }]]);
  await device.onDeleted();
});

test('diagnostics expose only thermostat readings and structural field names', async () => {
  const h = sdkHarness();
  const data = site();
  data.emails_alerte = ['private@example.invalid'];
  data.token = 'private-token';
  data.telephones_alerte = ['private-phone'];
  data.agi = 'private-serial';
  data.sigmacom = 'private-connect-id';
  data.code_postal = 'private-postcode';
  data.carac_site = { DATE_HEURE_CHAUDIERE: '1234' };
  const homey = { app: { devices: new Set(), connections: new Map([['account-secret', { connection: { snapshot: data, commandState: 'idle' } }]]) } };
  const result = await h.load('api.js').getDiagnostics({ homey });
  assert.equal(result[0].zones[0].current, 19.8);
  assert.deepEqual(result[0].reportedFields.boiler, ['DATE_HEURE_CHAUDIERE']);
  assert.doesNotMatch(JSON.stringify(result), /TEST-BOILER|private|@|password|account-secret|nom/);
});

test('periodic polling updates the information view without a Refresh capability or manual requests', async t => {
  const h = sdkHarness();
  const app = new (h.load('app.js'))();
  h.context.app = app;
  await app.onInit();
  t.after(() => app.onUninit());
  const pairing = new (h.load('drivers/boiler/driver.js'))().pairDevices(site(), credentials)[0];
  assert.equal(pairing.capabilities.includes('button.refresh'), false);
  const seed = app.acquire(credentials, 'TEST-BOILER-01');
  let data = {
    ...site(), produit: { chaudiere: 'Hydromotrix', puissance: '32 kW' },
    carac_site: { DATE_HEURE_CHAUDIERE: '1793360519' },
    emails_alerte: ['alerts@example.invalid'], telephones_alerte: [], alarmes_pro: [{ nom: 'Maintenance due' }],
  };
  let reads = 0;
  seed.connection.api.getSite = async () => { reads++; return structuredClone(data); };
  const device = new (h.load('drivers/boiler/device.js'))(pairing, 'boiler');
  await device.onInit(); seed.release();
  await tick(); await device.updateQueue;
  assert.equal(device.available, true);
  assert.equal(device.getCapabilityValue('frisquet_model'), 'Hydromotrix');
  assert.equal(device.getCapabilityValue('frisquet_alert_emails'), 'alerts@example.invalid');
  assert.equal(device.getCapabilityValue('alarm_generic.service'), true);
  const firstClock = device.getCapabilityValue('frisquet_boiler_clock');
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 300000);
  data.carac_site.DATE_HEURE_CHAUDIERE = '1793360819';
  data.alarmes_pro = [];
  data.emails_alerte = [];
  data.zones[0].carac_zone.TAMB = 200;
  timer.fn(); // Simulate the scheduled five-minute poll, not a user action.
  await tick(); await device.updateQueue;
  assert.equal(reads, 2);
  assert.equal(device.getCapabilityValue('measure_temperature'), 20);
  assert.notEqual(device.getCapabilityValue('frisquet_boiler_clock'), firstClock);
  assert.equal(device.getCapabilityValue('frisquet_service_alarms'), 'No service alarms');
  assert.equal(device.getCapabilityValue('alarm_generic.service'), false);
  assert.equal(device.getCapabilityValue('frisquet_alert_emails'), 'None configured');
  assert.equal(device.hasCapability('button.refresh'), false);
  await device.onDeleted();
});

test('pairing login and repair use Homey session handlers without putting credentials in device IDs', async t => {
  const h = sdkHarness();
  const driver = new (h.load('drivers/zone/driver.js'))();
  const handlers = new Map();
  const session = { setHandler: (id, fn) => handlers.set(id, fn) };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(JSON.stringify(url.includes('authentifications') ? auth() : site()));
  t.after(() => { globalThis.fetch = originalFetch; });
  await driver.onPair(session);
  assert.equal(await handlers.get('login')({ username: credentials.email, password: credentials.password }), true);
  const devices = await handlers.get('list_devices')();
  assert.equal(devices.length, 2);
  assert.doesNotMatch(JSON.stringify(devices.map(d => d.data)), /password|@|token/);
  assert.equal(devices[0].store.credentials.password, credentials.password);
  await handlers.get('disconnect')();
  await assert.rejects(handlers.get('list_devices')(), { code: 'credentials' });

  let repaired;
  h.context.app = { repairCredentials: async (device, creds, sites) => { repaired = { device, creds, sites }; } };
  await driver.onRepair(session, 'paired-device');
  await handlers.get('login')({ username: credentials.email, password: 'updated-fake' });
  assert.equal(repaired.device, 'paired-device');
  assert.equal(repaired.creds.password, 'updated-fake');
  assert.equal(repaired.sites[0].id, 'TEST-BOILER-01');
});

test('a boiler without DHW or outdoor telemetry can still be paired without fake controls', () => {
  const h = sdkHarness();
  const driver = new (h.load('drivers/boiler/driver.js'))();
  const data = site();
  data.ecs = {};
  data.modes_ecs = [];
  data.environnement = {};
  const paired = driver.pairDevices(data, credentials)[0];
  assert.equal(paired.capabilities.includes('frisquet_water_mode'), false);
  assert.equal(paired.capabilities.includes('measure_temperature.outdoor'), false);
});

test('French pairing, control and offline errors stay localized and do not reveal transport details', async t => {
  const h = sdkHarness('fr');
  const app = new (h.load('app.js'))();
  h.context.app = app;
  await app.onInit();
  t.after(() => app.onUninit());
  const driver = new (h.load('drivers/boiler/driver.js'))();
  const handlers = new Map();
  await driver.onPair({ setHandler: (id, fn) => handlers.set(id, fn) });
  await assert.rejects(handlers.get('login')({ username: '', password: '' }), error =>
    error.code === 'credentials' && error.message.startsWith('Vérifiez votre e-mail'));

  const pairing = driver.pairDevices(site(), credentials)[0];
  const seed = app.acquire(credentials, 'TEST-BOILER-01');
  seed.connection.api.getSite = async () => site();
  const device = new (h.load('drivers/boiler/device.js'))(pairing, 'boiler');
  await device.onInit(); seed.release();
  await tick(); await device.updateQueue;
  await assert.rejects(device.listeners['target_temperature.comfort'](99), error =>
    error.code === 'temperature' && error.message.startsWith('Choisissez une température'));
  await assert.rejects(h.cards.get('set_hot_water_mode').run({ device, mode: { id: 'not-supported' } }), error =>
    error.code === 'unsupported' && error.message.startsWith('Cette commande'));

  const leaked = new Error('https://example.invalid/?token=private-transport-token');
  device.connection.api.getSite = async () => { throw leaked; };
  await assert.rejects(device.connection.refresh(true));
  await tick(); await device.updateQueue;
  assert.equal(device.available, false);
  assert.equal(device.unavailableMessage, 'Frisquet Connect n’a pas pu traiter la demande.');
  assert.doesNotMatch(device.unavailableMessage, /private-transport-token|https:/);
  await device.onDeleted();
});

test('repair updates all devices on the account and renews one shared connection', async t => {
  const originalFetch = globalThis.fetch;
  const passwordsUsed = [];
  globalThis.fetch = async (url, opts) => {
    if (url.includes('authentifications')) {
      const password = JSON.parse(opts.body).password;
      passwordsUsed.push(password);
      return new Response(JSON.stringify(auth(password === 'new-test-password' ? 'new-token' : 'old-token')));
    }
    return new Response(JSON.stringify(site()));
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const h = sdkHarness();
  const app = new (h.load('app.js'))();
  h.context.app = app;
  await app.onInit();
  t.after(() => app.onUninit());
  const driver = new (h.load('drivers/zone/driver.js'))();
  const paired = driver.pairDevices(site(), credentials);
  const Device = h.load('drivers/zone/device.js');
  const devices = paired.map(p => new Device(p, 'zone'));
  await Promise.all(devices.map(d => d.onInit()));
  await devices[0].connection.refresh();
  await tick();
  const oldApi = devices[0].connection.api;
  await app.repairCredentials(devices[0], { ...credentials, password: 'new-test-password' }, [{ id: 'TEST-BOILER-01' }]);
  await devices[0].connection.refresh();
  await tick();
  await Promise.all(devices.map(d => d.updateQueue));
  assert.equal(oldApi.closed, true);
  assert.equal(app.accounts.size, 1);
  assert.equal(app.connections.size, 1);
  assert.equal(devices[0].connection, devices[1].connection);
  assert.deepEqual(passwordsUsed, [credentials.password, 'new-test-password']);
  for (const device of devices) {
    assert.equal(device.getStoreValue('credentials').password, 'new-test-password');
    assert.equal(device.available, true);
    await device.onDeleted();
  }
  assert.equal(h.timers.size, 0);
});
