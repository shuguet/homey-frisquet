'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { informationValues, formatReportedTime } = require('../lib/information');
const en = require('../locales/en.json');
const fr = require('../locales/fr.json');
const translate = locale => key => key.split('.').reduce((v, k) => v?.[k], locale);

test('equipment information, clocks, contact lists and service alarms are displayed in readable form', () => {
  const data = {
    produit: { chaudiere: 'Hydromotrix', gamme: 'Condensation', version1: 'Mixte', version2: 'Version B', puissance: '32 kW' },
    agi: 'TEST-SERIAL', sigmacom: 'TEST-CONNECT', nom: 'Test home', code_postal: '01234', code_pays: 'FR', timezone: 'Europe/Paris',
    carac_site: { DATE_HEURE_CHAUDIERE: String(Date.parse('2026-10-30T12:34:56Z') / 1000) },
    ecs: { TYPE_ECS: 0, solaire: false, AVEC_ECS: null },
    emails_alerte: ['first@example.invalid', 'second@example.invalid'], telephones_alerte: [],
    alarmes_pro: [{ nom: 'Maintenance due' }, { nom: 'Service needed' }],
  };
  const values = informationValues(data, translate(en), 'en-GB');
  assert.equal(values.frisquet_model, 'Hydromotrix');
  assert.equal(values.frisquet_product_variant, 'Mixte · Version B');
  assert.equal(values.frisquet_rated_power, '32 kW');
  assert.equal(values.frisquet_serial, 'TEST-SERIAL');
  assert.equal(values.frisquet_connect_id, 'TEST-CONNECT');
  assert.match(values.frisquet_boiler_clock, /13:34:56/);
  assert.equal(values.frisquet_water_type, 'Without storage tank');
  assert.equal(values.frisquet_water_solar, 'No');
  assert.equal(values.frisquet_water_equipped, 'Not reported');
  assert.equal(values['alarm_generic.service'], true);
  assert.equal(values.frisquet_service_alarms, 'Maintenance due; Service needed');
  assert.equal(values.frisquet_installation_postcode, '01234');
  assert.equal(values.frisquet_installation_country, 'France');
  assert.equal(values.frisquet_alert_emails, 'first@example.invalid; second@example.invalid');
  assert.equal(values.frisquet_alert_phones, 'None configured');
});

test('missing information is distinct from false flags, empty contact lists and cleared alarms', () => {
  const missing = informationValues({}, translate(en));
  assert.equal(missing['alarm_generic.service'], null);
  for (const [id, value] of Object.entries(missing)) if (id !== 'alarm_generic.service') assert.equal(value, 'Not reported', id);
  const reported = informationValues({
    alarmes_pro: [], emails_alerte: [], telephones_alerte: [],
    ecs: { TYPE_ECS: '1', solaire: 'true', AVEC_ECS: '0' },
  }, translate(fr), 'fr');
  assert.equal(reported['alarm_generic.service'], false);
  assert.equal(reported.frisquet_service_alarms, 'Aucune alarme de maintenance');
  assert.equal(reported.frisquet_water_type, 'Avec ballon de stockage');
  assert.equal(reported.frisquet_water_solar, 'Oui');
  assert.equal(reported.frisquet_water_equipped, 'Non');
  assert.equal(reported.frisquet_alert_emails, 'Aucun contact configuré');
  const unknownAlarm = informationValues({ alarmes_pro: [{}] }, translate(en));
  assert.equal(unknownAlarm['alarm_generic.service'], true);
  assert.equal(unknownAlarm.frisquet_service_alarms, 'Service alarm (details unavailable)');
});

test('boiler clock respects daylight saving and never fabricates an epoch date for missing data', () => {
  for (const value of [undefined, null, '', false, true, 'invalid', 0, Infinity]) assert.equal(formatReportedTime(value, 'Europe/Paris'), null);
  const summer = Date.parse('2026-06-01T12:00:00Z') / 1000;
  const winter = Date.parse('2026-12-01T12:00:00Z') / 1000;
  assert.match(formatReportedTime(summer, 'Europe/Paris', 'en-GB'), /14:00:00/);
  assert.match(formatReportedTime(winter, 'Europe/Paris', 'en-GB'), /13:00:00/);
  assert.equal(formatReportedTime(winter, 'invalid'), '2026-12-01 12:00:00 UTC');
});
