'use strict';

// Synthetic protocol fixtures derived from the upstream source, not captured
// traffic or credentials from a real installation.
function site() {
  const zone = (numero, nom, selector, mode, boost) => ({
    numero, nom, identifiant: `zone-${numero}`, boost_disponible: boost,
    carac_zone: { SELECTEUR: selector, MODE: mode, DERO: false, ACTIVITE_BOOST: false,
      TAMB: 198, CAMB: 210, CONS_CONF: 210, CONS_RED: 170, CONS_HG: 70 },
    programmation: Array.from({ length: 7 }, (_, jour) => ({ jour, plages: Array.from({ length: 48 }, (_, n) => n >= 12 && n < 44 ? 1 : 0) })),
  });
  return {
    identifiant_chaudiere: 'TEST-BOILER-01', nom: 'Test home', timezone: 'Europe/Paris',
    zones: [zone(1, 'Ground floor', 5, 6, true), zone(2, 'Upstairs', 7, 7, false)],
    ecs: { TYPE_ECS: 1, MODE_ECS: { id: 1 } },
    modes_ecs: [{ id: 0, nom: 'MAX' }, { id: 1, nom: 'Eco' }, { id: 2, nom: 'Eco \ue809' }, { id: 4, nom: 'Stop' }],
    environnement: { T_EXT: 85 }, vacances: { MODE_VACANCES: false }, alarmes: [],
  };
}

function auth(token = 'test-token') {
  return { token, utilisateur: { sites: [{ identifiant_chaudiere: 'TEST-BOILER-01', nom: 'Test home' }] } };
}

module.exports = { site, auth };
