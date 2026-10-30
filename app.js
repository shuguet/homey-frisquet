'use strict';

const Homey = require('homey');
const { createHash } = require('node:crypto');
const FrisquetApi = require('./lib/frisquet-api');
const { SiteConnection } = require('./lib/site-connection');
const { FrisquetError } = require('./lib/errors');

function accountKey(credentials) {
  return createHash('sha256').update(JSON.stringify([credentials.email.toLowerCase(), credentials.password])).digest('hex');
}

class FrisquetApp extends Homey.App {
  async onInit() {
    this.accounts = new Map();
    this.connections = new Map();
    this.devices = new Set();
    this.stopping = false;
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
        account = { api: new FrisquetApi(credentials), sites: 0 };
        this.accounts.set(key, account);
      }
      account.sites += 1;
      const connection = new SiteConnection(account.api, siteId, {
        setTimer: this.homey.setTimeout.bind(this.homey), clearTimer: this.homey.clearTimeout.bind(this.homey),
      });
      entry = { connection, refs: 0 };
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
    for (const { connection } of this.connections?.values() || []) connection.stop();
    for (const { api } of this.accounts?.values() || []) api.close();
  }
}

module.exports = FrisquetApp;
