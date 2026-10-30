'use strict';

// Protocol and temperature semantics ported from TheGui01's MIT-licensed
// Frisquet Connect integration. See THIRD_PARTY_NOTICES.md for provenance.
const { FrisquetError } = require('./errors');

const MODE_VALUES = [
  { id: 'auto', title: { en: 'Schedule', fr: 'Programmation' } },
  { id: 'comfort', title: { en: 'Comfort always', fr: 'Confort permanent' } },
  { id: 'reduced', title: { en: 'Reduced always', fr: 'Réduit permanent' } },
  { id: 'frost', title: { en: 'Frost protection', fr: 'Hors gel' } },
  { id: 'boost', title: { en: 'Boost', fr: 'Boost' } },
];
const PROFILE_KEYS = { comfort: 'CONS_CONF', reduced: 'CONS_RED', frost: 'CONS_HG' };

function number(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flag(value) { return value === true || value === 1 || value === '1' || value === 'true'; }
function temperature(value) { const n = number(value); return n === null ? null : n / 10; }
function modeId(value) { return number(value && typeof value === 'object' ? value.id : value); }
function holiday(site) { return flag(site.vacances?.MODE_VACANCES); }

function zoneFor(site, zoneNumber) {
  const zone = site.zones?.find(z => Number(z.numero) === Number(zoneNumber));
  if (!zone || !zone.carac_zone) throw new FrisquetError('no_zone');
  return zone;
}

function scheduledProfile(site, zone, now = new Date()) {
  if (!site.timezone) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: site.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const program = zone.programmation?.find(p => Number(p.jour) === day);
    const slot = Number(parts.hour) * 2 + Math.floor(Number(parts.minute) / 30);
    const value = program?.plages?.[slot];
    if (value === undefined || value === null) return null;
    return Number(value) === 1 ? 'comfort' : 'reduced';
  } catch { return null; }
}

function activeProfile(site, zone, now) {
  const c = zone.carac_zone;
  if (holiday(site)) return 'frost';
  if (flag(c.ACTIVITE_BOOST)) return 'comfort';
  const selector = number(c.SELECTEUR);
  if (selector === 6) return 'comfort';
  if (selector === 7) return 'reduced';
  if (selector === 8) return 'frost';
  // MODE reports the active schedule/override. Use the site's timezone only
  // as a fallback; Homey's timezone need not match a remote installation.
  const reported = { 6: 'comfort', 7: 'reduced', 8: 'frost' }[number(c.MODE)];
  return reported || scheduledProfile(site, zone, now);
}

function zoneState(site, zoneNumber) {
  const zone = zoneFor(site, zoneNumber);
  const c = zone.carac_zone;
  const profile = activeProfile(site, zone);
  const mode = flag(c.ACTIVITE_BOOST) ? 'boost'
    : ({ 5: 'auto', 6: 'comfort', 7: 'reduced', 8: 'frost' }[number(c.SELECTEUR)] || null);
  return {
    current: temperature(c.TAMB),
    target: profile ? temperature(c[PROFILE_KEYS[profile]]) : null,
    applied: temperature(c.CAMB),
    mode,
    profile: holiday(site) ? 'holiday'
      : (number(c.SELECTEUR) === 5 && flag(c.DERO) && profile ? `${profile}_override` : profile),
    boostAvailable: flag(zone.boost_disponible),
    boost: flag(c.ACTIVITE_BOOST),
    temperatures: Object.fromEntries(Object.entries(PROFILE_KEYS).map(([profile, key]) => [profile, temperature(c[key])])),
  };
}

function hotWater(site) {
  const ecs = site.ecs || {};
  const key = flag(ecs.solaire) && ecs.MODE_ECS_SOLAIRE != null ? 'MODE_ECS_SOLAIRE'
    : ecs.MODE_ECS != null ? 'MODE_ECS' : (ecs.MODE_ECS_PAC != null ? 'MODE_ECS_PAC' : null);
  const modes = (Array.isArray(site.modes_ecs) ? site.modes_ecs : [])
    .filter(m => Number.isInteger(number(m.id)) && typeof m.nom === 'string')
    .map(m => ({ id: String(Number(m.id)), name: m.nom.replace(/\ue809/g, 'Timer').trim() }));
  return key && modes.length ? { key, modes, current: modeId(ecs[key]) } : null;
}

function order(key, value) { return { cle: key, valeur: String(value) }; }
function checkZone(zoneNumber) {
  if (!Number.isInteger(Number(zoneNumber)) || Number(zoneNumber) < 1 || Number(zoneNumber) > 3) {
    throw new FrisquetError('unsupported');
  }
}

function modeOrders(site, zoneNumber, mode) {
  checkZone(zoneNumber);
  const zone = zoneFor(site, zoneNumber);
  if (holiday(site)) throw new FrisquetError('holiday');
  if (!MODE_VALUES.some(v => v.id === mode)) throw new FrisquetError('unsupported');
  if (mode === 'boost' && !flag(zone.boost_disponible)) throw new FrisquetError('unsupported');
  const orders = [];
  if (flag(zone.carac_zone.ACTIVITE_BOOST) && mode !== 'boost') {
    orders.push(order(`ACTIVITE_BOOST_Z${zoneNumber}`, 0));
  }
  if (mode === 'auto' || mode === 'boost') {
    orders.push(order(`SELECTEUR_Z${zoneNumber}`, 5));
    // MODE_DERO has no zone suffix. Resuming the schedule clears the
    // installation-wide temporary override, as documented in the UI/README.
    if (mode === 'auto' && site.zones.some(z => flag(z.carac_zone?.DERO))) {
      orders.push(order('MODE_DERO', 0));
    }
    if (mode === 'boost') orders.push(order(`ACTIVITE_BOOST_Z${zoneNumber}`, 1));
  } else {
    orders.push(order(`SELECTEUR_Z${zoneNumber}`, { comfort: 6, reduced: 7, frost: 8 }[mode]));
  }
  return orders;
}

function temperatureOrders(site, zoneNumber, value, profile) {
  checkZone(zoneNumber);
  const zone = zoneFor(site, zoneNumber);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 5 || value > 25
    || !Number.isInteger(value * 2)) throw new FrisquetError('temperature');
  if (!profile && holiday(site)) throw new FrisquetError('holiday');
  const targetProfile = profile || activeProfile(site, zone);
  if (!PROFILE_KEYS[targetProfile]) throw new FrisquetError('state');
  // This edits the selected profile's stored setpoint, not a timed override.
  return [order(`${PROFILE_KEYS[targetProfile]}_Z${zoneNumber}`, Math.round(value * 10))];
}

function boostOrders(site, zoneNumber, enabled) {
  checkZone(zoneNumber);
  if (typeof enabled !== 'boolean') throw new FrisquetError('unsupported');
  if (enabled) return modeOrders(site, zoneNumber, 'boost');
  // Turning Boost off must not cancel an installation-wide override or
  // change the zone's underlying permanent mode.
  const zone = zoneFor(site, zoneNumber);
  if (!flag(zone.boost_disponible) && !flag(zone.carac_zone.ACTIVITE_BOOST)) throw new FrisquetError('unsupported');
  return [order(`ACTIVITE_BOOST_Z${zoneNumber}`, 0)];
}

function hotWaterOrders(site, selected) {
  const water = hotWater(site);
  if (!water) throw new FrisquetError('no_water');
  const mode = water.modes.find(m => m.id === String(selected));
  if (!mode) throw new FrisquetError('unsupported');
  return [order(water.key, mode.id)];
}

function overrideOrders(site, mode) {
  if (holiday(site)) throw new FrisquetError('holiday');
  const value = { auto: 0, comfort: 6, reduced: 7 }[mode];
  if (value === undefined) throw new FrisquetError('unsupported');
  return [order('MODE_DERO', value)];
}

// A private desired-state copy routes successive mode + temperature commands
// correctly while the cloud is catching up. It is never emitted as telemetry.
function applyOrders(site, orders) {
  const next = structuredClone(site);
  for (const { cle, valeur } of orders) {
    const value = Number(valeur);
    const match = /^(SELECTEUR|ACTIVITE_BOOST|CONS_CONF|CONS_RED|CONS_HG)_Z([1-3])$/.exec(cle);
    if (match) {
      const zone = zoneFor(next, match[2]);
      zone.carac_zone[match[1]] = value;
      if (match[1] === 'SELECTEUR') {
        const profile = value === 5 ? scheduledProfile(next, zone) : null;
        zone.carac_zone.MODE = value === 5 ? ({ comfort: 6, reduced: 7 }[profile] ?? null) : value;
      }
    } else if (cle === 'MODE_DERO') {
      for (const zone of next.zones) {
        if (Number(zone.carac_zone.SELECTEUR) !== 5) continue;
        zone.carac_zone.DERO = value !== 0;
        zone.carac_zone.MODE = value || ({ comfort: 6, reduced: 7 }[scheduledProfile(next, zone)] ?? null);
      }
    } else if (['MODE_ECS', 'MODE_ECS_PAC', 'MODE_ECS_SOLAIRE'].includes(cle)) {
      next.ecs[cle] = { id: value };
    }
  }
  return next;
}

module.exports = {
  MODE_VALUES, PROFILE_KEYS, number, flag, temperature, holiday, zoneFor,
  scheduledProfile, activeProfile, zoneState, hotWater, modeOrders,
  temperatureOrders, boostOrders, hotWaterOrders, overrideOrders, applyOrders,
};
