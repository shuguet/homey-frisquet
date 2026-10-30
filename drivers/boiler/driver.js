'use strict';

const FrisquetDriver = require('../../lib/base-driver');
const { hotWater, temperature, zoneState } = require('../../lib/model');
const { heatingCapabilities, heatingOptions } = require('../../lib/heating-device');
const { INFORMATION_CAPABILITIES, INFORMATION_TITLES } = require('../../lib/information');

class BoilerDriver extends FrisquetDriver {
  pairDevices(site, credentials) {
    const water = hotWater(site);
    const capabilities = [];
    const capabilitiesOptions = {};
    const zones = site.zones.filter(z => [1, 2, 3].includes(Number(z.numero))).sort((a, b) => a.numero - b.numero);
    const primaryZone = Number(zones[0]?.numero) || null;
    for (const zone of zones) {
      const suffix = Number(zone.numero) === primaryZone ? '' : `.zone${zone.numero}`;
      const state = zoneState(site, zone.numero);
      capabilities.push(...heatingCapabilities(state.boostAvailable || state.boost, suffix));
      Object.assign(capabilitiesOptions, heatingOptions(state, suffix, zones.length > 1 ? (zone.nom || `Zone ${zone.numero}`) : ''));
    }
    if (water) {
      capabilities.push('frisquet_water_mode');
      capabilitiesOptions.frisquet_water_mode = { values: water.modes.map(m => ({ id: m.id, title: { en: m.name, fr: m.name } })) };
    }
    if (temperature(site.environnement?.T_EXT) !== null) capabilities.push('measure_temperature.outdoor');
    capabilities.push('alarm_generic', 'frisquet_alarm', 'frisquet_holiday', 'frisquet_last_update', 'frisquet_command_state', ...INFORMATION_CAPABILITIES);
    capabilitiesOptions['alarm_generic.service'] = { title: INFORMATION_TITLES['alarm_generic.service'] };
    return [{
      name: `${site.nom} — ${this.homey.__('devices.boiler')}`,
      data: { id: `${site.identifiant_chaudiere}:boiler`, siteId: site.identifiant_chaudiere },
      store: { credentials, primaryZone }, capabilities, capabilitiesOptions,
    }];
  }
}

module.exports = BoilerDriver;
