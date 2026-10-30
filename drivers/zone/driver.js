'use strict';

const FrisquetDriver = require('../../lib/base-driver');
const { MODE_VALUES, flag } = require('../../lib/model');

class ZoneDriver extends FrisquetDriver {
  pairDevices(site, credentials) {
    return site.zones.filter(z => [1, 2, 3].includes(Number(z.numero))).map(zone => ({
      name: `${site.nom} — ${zone.nom || `Zone ${zone.numero}`}`,
      data: { id: `${site.identifiant_chaudiere}:zone:${zone.numero}`, siteId: site.identifiant_chaudiere, zone: Number(zone.numero) },
      store: { credentials },
      capabilitiesOptions: { frisquet_mode: { values: MODE_VALUES.filter(v => v.id !== 'boost' || flag(zone.boost_disponible)) } },
    }));
  }
}

module.exports = ZoneDriver;
