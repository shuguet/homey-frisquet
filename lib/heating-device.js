'use strict';

const FrisquetDevice = require('./base-device');
const { MODE_VALUES, PROFILE_KEYS, zoneState, modeOrders, temperatureOrders, boostOrders } = require('./model');

const TITLES = {
  measure_temperature: { en: 'Room temperature', fr: 'Température ambiante' },
  target_temperature: { en: 'Heating temperature', fr: 'Température de chauffage' },
  'target_temperature.comfort': { en: 'Comfort temperature', fr: 'Température Confort' },
  'target_temperature.reduced': { en: 'Reduced temperature', fr: 'Température Réduit' },
  'target_temperature.frost': { en: 'Frost temperature', fr: 'Température Hors gel' },
  frisquet_mode: { en: 'Heater mode', fr: 'Mode chauffage' },
  frisquet_profile: { en: 'Active profile', fr: 'Profil actif' },
  'measure_temperature.applied': { en: 'Applied setpoint', fr: 'Consigne appliquée' },
  frisquet_boost: { en: 'Boost', fr: 'Boost' },
  frisquet_comfort_temperature: { en: 'Comfort temperature', fr: 'Température Confort' },
  frisquet_reduced_temperature: { en: 'Reduced temperature', fr: 'Température Réduit' },
  frisquet_frost_temperature: { en: 'Frost temperature', fr: 'Température Hors gel' },
};

function capabilityId(base, suffix) { return base.includes('.') ? `${base}${suffix.replace('.', '_')}` : `${base}${suffix}`; }

function heatingCapabilities(boost = false, suffix = '') {
  return Object.keys(TITLES).filter(id => id !== 'frisquet_boost' || boost).map(id => capabilityId(id, suffix));
}

function heatingOptions(state, suffix = '', name = '') {
  return Object.fromEntries(Object.entries(TITLES).map(([id, title]) => {
    const options = { title: Object.fromEntries(Object.entries(title).map(([lang, text]) => [lang, name ? `${text} · ${name}` : text])) };
    if (id.split('.')[0] === 'target_temperature' || id.endsWith('_temperature') && id.startsWith('frisquet_')) {
      Object.assign(options, { min: 5, max: 25, step: 0.5, decimals: 1 });
    }
    if (id === 'frisquet_mode') options.values = MODE_VALUES.filter(v => v.id !== 'boost' || state.boostAvailable);
    if (id === 'measure_temperature.applied') options.preventInsights = true;
    return [capabilityId(id, suffix), options];
  }));
}

class HeatingDevice extends FrisquetDevice {
  async registerControls() {
    this.heatingListeners = new Set();
    this.heatingOptionsCache = new Map();
    if (this.getData().zone) this.registerHeatingListeners(this.getData().zone, '');
  }

  primaryZone() { return Number(this.getData().zone || this.getStoreValue('primaryZone')); }

  registerHeatingListeners(zone, suffix) {
    const listeners = {
      target_temperature: value => this.setTemperature(value, undefined, zone),
      frisquet_mode: value => this.setMode(value, zone),
      frisquet_boost: value => this.setBoost(value, zone),
      ...Object.fromEntries(Object.keys(PROFILE_KEYS).flatMap(profile => {
        const set = value => this.setTemperature(value, profile, zone);
        // Preserve existing numeric capability IDs and Flow tags. Native
        // target-temperature sub-capabilities provide the editable UI.
        return [[`frisquet_${profile}_temperature`, set], [`target_temperature.${profile}`, set]];
      })),
    };
    for (const [base, fn] of Object.entries(listeners)) {
      const id = capabilityId(base, suffix);
      if (this.hasCapability(id) && !this.heatingListeners.has(id)) {
        this.registerCapabilityListener(id, fn);
        this.heatingListeners.add(id);
      }
    }
  }

  async updateHeating(site, zone, suffix = '', name = '') {
    const reported = zoneState(site, zone);
    const requested = zoneState(this.connection?.desired || site, zone);
    for (const id of heatingCapabilities(reported.boostAvailable || reported.boost, suffix)) await this.capability(id, true);
    const options = heatingOptions(reported, suffix, name);
    const signature = JSON.stringify(options);
    if (this.heatingOptionsCache.get(suffix) !== signature) {
      for (const [id, option] of Object.entries(options)) if (this.hasCapability(id)) await this.setCapabilityOptions(id, option);
      this.heatingOptionsCache.set(suffix, signature);
    }
    this.registerHeatingListeners(zone, suffix);
    // Writable controls show accepted requests while Frisquet catches up.
    // Room temperature, applied setpoint and active profile always use telemetry.
    const values = {
      measure_temperature: reported.current,
      target_temperature: requested.target,
      'measure_temperature.applied': reported.applied,
      frisquet_mode: requested.mode,
      frisquet_boost: requested.boost,
      frisquet_profile: reported.profile ? this.homey.__(`profiles.${reported.profile}`) : null,
      ...Object.fromEntries(Object.entries(requested.temperatures).flatMap(([profile, value]) => [
        [`frisquet_${profile}_temperature`, value], [`target_temperature.${profile}`, value],
      ])),
    };
    for (const [id, value] of Object.entries(values)) await this.value(capabilityId(id, suffix), value);
    // Observed mode changes trigger automation, never optimistic requests.
    this.reportedModes ||= new Map();
    const previous = this.reportedModes.get(zone);
    this.reportedModes.set(zone, reported.mode);
    if (!suffix && previous != null && reported.mode != null && previous !== reported.mode) {
      await this.homey.flow.getDeviceTriggerCard('zone_mode_changed').trigger(this, { mode: reported.mode });
    }
  }

  setMode(mode, zone = this.primaryZone()) {
    return this.runControl(() => this.getConnection().command(site => modeOrders(site, zone, mode)));
  }

  setTemperature(value, profile, zone = this.primaryZone()) {
    return this.runControl(() => this.getConnection().command(site => temperatureOrders(site, zone, value, profile)));
  }

  setBoost(enabled, zone = this.primaryZone()) {
    return this.runControl(() => this.getConnection().command(site => boostOrders(site, zone, enabled)));
  }
}

module.exports = { HeatingDevice, heatingCapabilities, heatingOptions };
