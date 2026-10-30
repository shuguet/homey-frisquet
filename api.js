'use strict';

const { zoneState, hotWater, holiday } = require('./lib/model');

module.exports = {
  // Authenticated, read-only diagnostics. No credentials, tokens, names,
  // installation IDs, alert contacts or arbitrary raw server values.
  async getDiagnostics({ homey }) {
    return [...homey.app.connections.values()].map(({ connection }) => {
      const site = connection.snapshot;
      if (!site) return { connected: false, commandState: connection.commandState };
      return {
        connected: true, commandState: connection.commandState,
        zones: site.zones.filter(z => [1, 2, 3].includes(Number(z.numero))).map(z => ({
          number: Number(z.numero), ...zoneState(site, z.numero), fields: Object.keys(z.carac_zone).sort(),
        })),
        water: hotWater(site), holiday: holiday(site),
        reportedFields: {
          installation: site.siteFields || [],
          water: Object.keys(site.ecs).sort(),
          environment: Object.keys(site.environnement).sort(),
          boiler: Object.keys(site.carac_site || {}).sort(),
        },
        lastReport: site.date_derniere_remontee || null,
      };
    });
  },
};
