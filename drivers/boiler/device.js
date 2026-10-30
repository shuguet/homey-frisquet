'use strict';

const { HeatingDevice } = require('../../lib/heating-device');
const { hotWater, temperature, hotWaterOrders, overrideOrders, holiday } = require('../../lib/model');
const { INFORMATION_CAPABILITIES, INFORMATION_TITLES, informationValues, formatReportedTime } = require('../../lib/information');

class BoilerDevice extends HeatingDevice {
  async registerControls() {
    await super.registerControls();
    if (this.hasCapability('frisquet_water_mode')) {
      this.registerCapabilityListener('frisquet_water_mode', mode => this.setWaterMode(mode));
    }
  }

  async updateFromSite(site) {
    const zones = site.zones.filter(z => [1, 2, 3].includes(Number(z.numero))).sort((a, b) => a.numero - b.numero);
    if (!this.primaryZone() && zones.length) await this.setStoreValue('primaryZone', Number(zones[0].numero));
    for (const zone of zones) {
      const primary = Number(zone.numero) === this.primaryZone();
      await this.updateHeating(site, Number(zone.numero), primary ? '' : `.zone${zone.numero}`,
        zones.length > 1 ? (zone.nom || `Zone ${zone.numero}`) : '');
    }
    const water = hotWater(site);
    if (water) {
      if (!this.hasCapability('frisquet_water_mode')) {
        await this.addCapability('frisquet_water_mode');
        this.registerCapabilityListener('frisquet_water_mode', mode => this.setWaterMode(mode));
      }
      const values = water.modes.map(m => ({ id: m.id, title: { en: m.name, fr: m.name } }));
      const signature = JSON.stringify(values);
      if (signature !== this.waterSignature) {
        await this.setCapabilityOptions('frisquet_water_mode', { values });
        this.waterSignature = signature;
      }
      const requested = hotWater(this.connection?.desired || site);
      const current = requested?.current == null ? null : String(requested.current);
      await this.value('frisquet_water_mode', water.modes.some(m => m.id === current) ? current : null);
      if (this.reportedWaterMode != null && water.current != null && this.reportedWaterMode !== water.current) {
        await this.homey.flow.getDeviceTriggerCard('water_mode_changed').trigger(this, {
          mode: String(water.current), name: water.modes.find(m => m.id === String(water.current))?.name || String(water.current),
        });
      }
      this.reportedWaterMode = water.current;
    } else await this.value('frisquet_water_mode', null);
    const outdoor = temperature(site.environnement?.T_EXT);
    await this.capability('measure_temperature.outdoor', outdoor !== null);
    await this.value('measure_temperature.outdoor', outdoor);
    await this.value('alarm_generic', Array.isArray(site.alarmes) ? site.alarmes.length > 0 : null);
    for (const id of ['frisquet_alarm', 'frisquet_holiday', 'frisquet_last_update']) await this.capability(id, true);
    await this.value('frisquet_alarm', (site.alarmes || []).map(a => typeof a.nom === 'string' ? a.nom : '').filter(Boolean).join('; ') || this.homey.__('status.no_alarm'));
    await this.value('frisquet_holiday', holiday(site));
    const language = this.homey.i18n.getLanguage();
    await this.value('frisquet_last_update', formatReportedTime(site.date_derniere_remontee, site.timezone, language, 'short'));
    if (!this.informationReady) {
      for (const id of INFORMATION_CAPABILITIES) await this.capability(id, true);
      await this.setCapabilityOptions('alarm_generic.service', { title: INFORMATION_TITLES['alarm_generic.service'] });
      this.informationReady = true;
    }
    const values = informationValues(site, this.homey.__.bind(this.homey), language);
    for (const [id, value] of Object.entries(values)) await this.value(id, value);
  }

  setWaterMode(mode) { return this.runControl(() => this.getConnection().command(site => hotWaterOrders(site, mode))); }
  setOverride(mode) { return this.runControl(() => this.getConnection().command(site => overrideOrders(site, mode))); }
  async getWaterModes() {
    return this.runControl(async () => {
      const site = await this.getConnection().refresh();
      return hotWater(site)?.modes || [];
    });
  }
}

module.exports = BoilerDevice;
