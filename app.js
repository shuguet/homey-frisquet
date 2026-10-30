'use strict';

const Homey = require('homey');
const { createHash } = require('node:crypto');
const FrisquetApi = require('./lib/frisquet-api');
const { SiteConnection } = require('./lib/site-connection');
const { FrisquetError } = require('./lib/errors');
const { Diagnostics } = require('./lib/diagnostics');
const { loadPreferences, validatePreferences } = require('./lib/preferences');
const { InstallationNotifications, shortText } = require('./lib/notifications');

function accountKey(credentials) {
  return createHash('sha256').update(JSON.stringify([credentials.email.toLowerCase(), credentials.password])).digest('hex');
}

class FrisquetApp extends Homey.App {
  async onInit() {
    this.accounts = new Map();
    this.connections = new Map();
    this.devices = new Set();
    this.stopping = false;
    this.preferences = loadPreferences(this.homey.settings);
    this.diagnostics = new Diagnostics({
      getState: () => this.homey.settings?.get('supportJournal'),
      setState: state => this.homey.settings?.set('supportJournal', state),
      log: line => this.log(line),
      context: () => ({ appVersion: require('./app.json').version, homeyVersion: this.homey.version ?? null,
        platform: this.homey.platform ?? null, platformVersion: this.homey.platformVersion ?? null,
        nodeVersion: process.version, architecture: process.arch, devices: this.supportDevices() }),
    });
    this.diagnostics.record('app_start', {});
    this.crashMonitor = error => this.diagnostics.failure('uncaught_exception', error);
    process.on('uncaughtExceptionMonitor', this.crashMonitor);
    this.resourceListeners = Object.fromEntries(['memwarn', 'cpuwarn'].map(event => [event,
      data => this.diagnostics.record(event, data ?? {})]));
    for (const [event, listener] of Object.entries(this.resourceListeners)) this.homey.on?.(event, listener);
    this.homey.flow.getActionCard('set_zone_mode').registerRunListener(({ device, mode }) => device.setMode(mode));
    this.homey.flow.getActionCard('set_boost').registerRunListener(({ device, enabled }) => device.setBoost(enabled === 'on'));
    this.homey.flow.getActionCard('set_profile_temperature').registerRunListener(
      ({ device, profile, temperature }) => device.setTemperature(temperature, profile));
    this.homey.flow.getActionCard('set_installation_override').registerRunListener(
      ({ device, mode }) => device.setOverride(mode));
    const waterCard = this.homey.flow.getActionCard('set_hot_water_mode');
    waterCard.registerRunListener(({ device, mode }) => device.setWaterMode(mode.id));
    waterCard.registerArgumentAutocompleteListener('mode', async (query, { device }) => {
      const modes = await device.getWaterModes();
      return modes.filter(m => m.name.toLowerCase().includes(query.toLowerCase()));
    });
    this.homey.flow.getConditionCard('zone_mode_is').registerRunListener(
      ({ device, mode }) => device.getCapabilityValue('frisquet_mode') === mode);
    this.homey.flow.getConditionCard('boost_is_enabled').registerRunListener(
      ({ device }) => device.getCapabilityValue('frisquet_boost') === true);
    this.log('Frisquet Connect initialized');
  }

  acquire(credentials, siteId) {
    if (!credentials?.email || !credentials?.password) throw new FrisquetError('credentials');
    const key = accountKey(credentials);
    const siteKey = `${key}:${siteId}`;
    let entry = this.connections.get(siteKey);
    if (!entry) {
      let account = this.accounts.get(key);
      if (!account) {
        account = { api: new FrisquetApi(credentials, { diagnostics: this.diagnostics }), sites: 0 };
        this.accounts.set(key, account);
      }
      account.sites += 1;
      const connection = new SiteConnection(account.api, siteId, {
        pollMs: this.preferences.pollMinutes * 60000,
        setTimer: this.homey.setTimeout.bind(this.homey), clearTimer: this.homey.clearTimeout.bind(this.homey),
      });
      const stateKey = `notifications_${this.diagnostics.reference(siteId)}`;
      const notifications = new InstallationNotifications({
        preferences: this.preferences,
        state: this.homey.settings.get(stateKey) || {},
        save: state => this.homey.settings.set(stateKey, state),
        send: (kind, tokens) => {
          const devices = [...this.devices].filter(device => device.getData().siteId === siteId);
          const device = devices.find(d => !d.getData().zone) || devices[0];
          const installation = shortText(device?.getName?.() || this.homey.__('notifications.installation'), 60);
          return this.homey.notifications.createNotification({
            excerpt: this.homey.__(`notifications.${kind}`, { ...tokens, installation }),
          });
        },
        onError: () => this.error('Could not deliver or save a Frisquet notification'),
        setTimer: this.homey.setTimeout.bind(this.homey), clearTimer: this.homey.clearTimeout.bind(this.homey),
      });
      connection.on('data', site => { notifications.success(site); });
      connection.on('failure', () => { notifications.failure(); });
      entry = { connection, notifications, refs: 0 };
      this.connections.set(siteKey, entry);
    }
    entry.refs += 1;
    let released = false;
    return {
      connection: entry.connection,
      release: () => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        if (entry.refs > 0) return;
        entry.notifications.stop();
        entry.connection.stop();
        this.connections.delete(siteKey);
        const account = this.accounts.get(key);
        if (account && --account.sites === 0) {
          account.api.close();
          this.accounts.delete(key);
        }
      },
    };
  }

  async repairCredentials(device, credentials, sites) {
    const old = device.getStoreValue('credentials');
    const allowed = new Set(sites.map(s => s.id));
    if (!allowed.has(device.getData().siteId)) throw new FrisquetError('credentials');
    const affected = [...this.devices].filter(d =>
      d.getStoreValue('credentials')?.email?.toLowerCase() === old?.email?.toLowerCase()
      && allowed.has(d.getData().siteId));
    for (const d of affected) await d.setStoreValue('credentials', credentials);
    for (const d of affected) await d.connect();
  }

  async onUninit() {
    this.stopping = true;
    for (const { connection, notifications } of this.connections?.values() || []) {
      notifications.stop();
      connection.stop();
    }
    for (const { api } of this.accounts?.values() || []) api.close();
    process.removeListener('uncaughtExceptionMonitor', this.crashMonitor);
    for (const [event, listener] of Object.entries(this.resourceListeners || {})) this.homey.removeListener?.(event, listener);
    this.diagnostics?.record('app_stop', {});
    this.diagnostics?.close();
  }

  supportDevices() {
    return [...this.devices].map(device => ({
      installation: this.diagnostics.reference(device.getData().siteId),
      driver: device.getData().zone ? 'zone' : 'boiler',
      available: device.getAvailable?.() ?? null,
      capabilities: device.getCapabilities?.() ?? [],
    }));
  }

  prepareSupportReport() {
    return this.diagnostics.prepare(this.supportDevices());
  }

  getPreferences() { return { ...this.preferences }; }

  savePreferences(value) {
    let preferences;
    try { preferences = validatePreferences(value); }
    catch { throw new Error(this.homey.__('preferences.invalid')); }
    // Save the complete validated object before changing active connections.
    this.homey.settings.set('preferences', preferences);
    this.preferences = preferences;
    for (const { connection, notifications } of this.connections.values()) {
      connection.setPollInterval(preferences.pollMinutes * 60000);
      notifications.setPreferences(preferences);
    }
    return this.getPreferences();
  }
}

module.exports = FrisquetApp;
