'use strict';

const Homey = require('homey');
const FrisquetApi = require('./frisquet-api');
const { FrisquetError, safeError } = require('./errors');

class FrisquetDriver extends Homey.Driver {
  userError(error) {
    this.homey.app?.diagnostics?.failure('pairing_or_repair', error);
    return safeError(error, this.homey.__.bind(this.homey));
  }

  async onPair(session) {
    let api;
    let credentials;
    let sites;
    session.setHandler('login', async data => {
      api?.close();
      credentials = undefined;
      sites = undefined;
      const candidate = { email: String(data.username || '').trim(), password: data.password };
      api = new FrisquetApi(candidate, { diagnostics: this.homey.app?.diagnostics });
      try {
        sites = await api.login();
        credentials = { ...candidate, appId: api.appId };
        return true;
      } catch (error) { throw this.userError(error); }
    });
    session.setHandler('list_devices', async () => {
      try {
        if (!credentials || !sites) throw new FrisquetError('credentials');
        const devices = [];
        for (const site of sites) {
          const snapshot = await api.getSite(site.id);
          devices.push(...this.pairDevices(snapshot, credentials));
        }
        return devices;
      } catch (error) { throw this.userError(error); }
    });
    session.setHandler('disconnect', async () => { api?.close(); credentials = undefined; });
  }

  async onRepair(session, device) {
    session.setHandler('login', async data => {
      const credentials = { email: String(data.username || '').trim(), password: data.password };
      const api = new FrisquetApi(credentials, { diagnostics: this.homey.app?.diagnostics });
      try {
        const sites = await api.login();
        credentials.appId = api.appId;
        await this.homey.app.repairCredentials(device, credentials, sites);
        return true;
      } catch (error) { throw this.userError(error); }
      finally { api.close(); }
    });
  }
}

module.exports = FrisquetDriver;
