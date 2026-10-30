'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { site } = require('./fixtures');
const m = require('../lib/model');

test('the independent Home Assistant public fixture decodes override, room temperature and timer mode', () => {
  const data = require('./public-site.json');
  const state = m.zoneState(data, 1);
  assert.equal(state.current, 17);
  assert.equal(state.target, 18.5);
  assert.equal(state.applied, 18.5);
  assert.equal(state.profile, 'reduced_override');
  assert.equal(state.boostAvailable, true);
  assert.equal(m.hotWater(data).current, 2);
  assert.equal(m.hotWater(data).key, 'MODE_ECS');
  assert.deepEqual(m.temperatureOrders(data, 1, 19), [{ cle: 'CONS_RED_Z1', valeur: '190' }]);
});

test('Boost toggle off does not modify modes or other zones, including during a holiday', () => {
  const data = site();
  data.zones[0].carac_zone.ACTIVITE_BOOST = true;
  data.vacances.MODE_VACANCES = true;
  assert.deepEqual(m.boostOrders(data, 1, false), [{ cle: 'ACTIVITE_BOOST_Z1', valeur: '0' }]);
  assert.throws(() => m.boostOrders(data, 1, true), { code: 'holiday' });
  assert.throws(() => m.boostOrders(data, 1, 'false'), { code: 'unsupported' });
});

test('solar hot water uses the solar command only when the installation reports solar', () => {
  const data = site();
  data.ecs.MODE_ECS_SOLAIRE = { id: 0 };
  data.ecs.solaire = true;
  assert.deepEqual(m.hotWaterOrders(data, '1'), [{ cle: 'MODE_ECS_SOLAIRE', valeur: '1' }]);
  assert.equal(m.hotWater(m.applyOrders(data, m.hotWaterOrders(data, '1'))).current, 1);
  data.ecs.solaire = false;
  assert.equal(m.hotWater(data).key, 'MODE_ECS');
});

test('telemetry uses tenths of degrees, profile setpoints, and preserves missing values', () => {
  const data = site();
  assert.equal(m.zoneState(data, 1).current, 19.8);
  assert.equal(m.zoneState(data, 2).target, 17);
  assert.equal(m.zoneState(data, 1).applied, 21);
  assert.equal(m.temperature(null), null);
  assert.equal(m.temperature(''), null);
  assert.equal(m.temperature(-35), -3.5);
  data.zones[0].carac_zone.TAMB = null;
  assert.equal(m.zoneState(data, 1).current, null);
});

test('zone-specific permanent modes and boost never use the global override key', () => {
  assert.deepEqual(m.modeOrders(site(), 2, 'comfort'), [{ cle: 'SELECTEUR_Z2', valeur: '6' }]);
  assert.deepEqual(m.modeOrders(site(), 2, 'frost'), [{ cle: 'SELECTEUR_Z2', valeur: '8' }]);
  assert.deepEqual(m.modeOrders(site(), 1, 'boost'), [
    { cle: 'SELECTEUR_Z1', valeur: '5' }, { cle: 'ACTIVITE_BOOST_Z1', valeur: '1' },
  ]);
  assert.throws(() => m.modeOrders(site(), 2, 'boost'), { code: 'unsupported' });
});

test('resuming schedules disables boost and explicitly clears installation overrides', () => {
  const data = site();
  data.zones[0].carac_zone.DERO = true;
  data.zones[0].carac_zone.ACTIVITE_BOOST = true;
  assert.deepEqual(m.modeOrders(data, 1, 'auto'), [
    { cle: 'ACTIVITE_BOOST_Z1', valeur: '0' },
    { cle: 'SELECTEUR_Z1', valeur: '5' },
    { cle: 'MODE_DERO', valeur: '0' },
  ]);
  assert.deepEqual(m.overrideOrders(data, 'reduced'), [{ cle: 'MODE_DERO', valeur: '7' }]);
});

test('temperature writes edit the correct stored profile without changing mode', () => {
  assert.deepEqual(m.temperatureOrders(site(), 1, 20.5), [{ cle: 'CONS_CONF_Z1', valeur: '205' }]);
  assert.deepEqual(m.temperatureOrders(site(), 2, 16.5), [{ cle: 'CONS_RED_Z2', valeur: '165' }]);
  assert.deepEqual(m.temperatureOrders(site(), 2, 8, 'frost'), [{ cle: 'CONS_HG_Z2', valeur: '80' }]);
  for (const value of [NaN, Infinity, '20', 4, 26, 20.25]) {
    assert.throws(() => m.temperatureOrders(site(), 1, value), { code: 'temperature' });
  }
});

test('rapid mode then temperature uses the requested profile without altering the read snapshot', () => {
  const original = site();
  const desired = m.applyOrders(original, m.modeOrders(original, 2, 'comfort'));
  assert.deepEqual(m.temperatureOrders(desired, 2, 21.5), [{ cle: 'CONS_CONF_Z2', valeur: '215' }]);
  assert.equal(m.zoneState(original, 2).mode, 'reduced');
  assert.equal(m.zoneState(desired, 2).mode, 'comfort');
});

test('holiday and unknown-profile states cannot accidentally change heating settings', () => {
  const data = site();
  data.vacances.MODE_VACANCES = true;
  assert.equal(m.zoneState(data, 1).profile, 'holiday');
  assert.throws(() => m.modeOrders(data, 1, 'comfort'), { code: 'holiday' });
  assert.throws(() => m.temperatureOrders(data, 1, 21), { code: 'holiday' });
  assert.throws(() => m.overrideOrders(data, 'comfort'), { code: 'holiday' });
  data.vacances.MODE_VACANCES = false;
  data.zones[0].carac_zone.MODE = null;
  data.zones[0].programmation = [];
  assert.throws(() => m.temperatureOrders(data, 1, 20), { code: 'state' });
});

test('schedule fallback uses installation timezone across a daylight-saving transition', () => {
  const data = site();
  // Paris is UTC+1 on 25 October 2026 after the autumn clock change.
  assert.equal(m.scheduledProfile(data, data.zones[0], new Date('2026-10-25T04:30:00Z')), 'reduced');
  assert.equal(m.scheduledProfile(data, data.zones[0], new Date('2026-10-25T05:00:00Z')), 'comfort');
});

test('a global override flag does not relabel a zone in permanent mode', () => {
  const data = site();
  data.zones[1].carac_zone.DERO = true;
  assert.equal(m.zoneState(data, 2).profile, 'reduced');
  data.zones[1].carac_zone.SELECTEUR = 5;
  assert.equal(m.zoneState(data, 2).profile, 'reduced_override');
});

test('hot-water mode IDs come from the installation, including zero and timer glyphs', () => {
  assert.equal(m.hotWater(site()).modes[2].name, 'Eco Timer');
  assert.deepEqual(m.hotWaterOrders(site(), '0'), [{ cle: 'MODE_ECS', valeur: '0' }]);
  const data = site();
  data.ecs = { MODE_ECS_PAC: { id: 15 } };
  data.modes_ecs = [{ id: 15, nom: 'On' }, { id: 19, nom: 'Stop' }];
  assert.deepEqual(m.hotWaterOrders(data, '19'), [{ cle: 'MODE_ECS_PAC', valeur: '19' }]);
  assert.throws(() => m.hotWaterOrders(data, '4'), { code: 'unsupported' });
  assert.equal(m.hotWater({}), null);
});
