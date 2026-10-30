'use strict';

const { HeatingDevice } = require('../../lib/heating-device');

// Compatibility driver for previously paired zone devices and their Flows.
class ZoneDevice extends HeatingDevice {
  async updateFromSite(site) { await this.updateHeating(site, this.getData().zone); }
}

module.exports = ZoneDevice;
