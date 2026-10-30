'use strict';

// Read-only information supplied by the installation response. Definitions
// share Homey's sensor view with the applied setpoint.
const INFORMATION_TITLES = {
  frisquet_model: { en: 'Boiler model', fr: 'Modèle de chaudière' },
  frisquet_product_range: { en: 'Product range', fr: 'Gamme' },
  frisquet_product_variant: { en: 'Equipment variant', fr: 'Version de l’équipement' },
  frisquet_rated_power: { en: 'Rated power', fr: 'Puissance nominale' },
  frisquet_serial: { en: 'Boiler serial number', fr: 'Numéro de série chaudière' },
  frisquet_connect_id: { en: 'Frisquet Connect ID', fr: 'Identifiant Frisquet Connect' },
  frisquet_boiler_clock: { en: 'Boiler clock', fr: 'Horloge chaudière' },
  'alarm_generic.service': { en: 'Service alarm active', fr: 'Alarme de maintenance active' },
  frisquet_service_alarms: { en: 'Service alarms', fr: 'Alarmes de maintenance' },
  frisquet_water_type: { en: 'Hot-water equipment', fr: 'Équipement eau chaude' },
  frisquet_water_solar: { en: 'Solar hot water', fr: 'Eau chaude solaire' },
  frisquet_water_equipped: { en: 'Hot-water equipment present', fr: 'Production d’eau chaude installée' },
  frisquet_installation_name: { en: 'Installation name', fr: 'Nom de l’installation' },
  frisquet_installation_postcode: { en: 'Installation postcode', fr: 'Code postal de l’installation' },
  frisquet_installation_country: { en: 'Installation country', fr: 'Pays de l’installation' },
  frisquet_installation_timezone: { en: 'Installation time zone', fr: 'Fuseau horaire de l’installation' },
  frisquet_alert_emails: { en: 'Alert email addresses', fr: 'Adresses e-mail d’alerte' },
  frisquet_alert_phones: { en: 'Alert phone numbers', fr: 'Numéros de téléphone d’alerte' },
};
const INFORMATION_CAPABILITIES = Object.keys(INFORMATION_TITLES);

function text(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function reportedBoolean(value) {
  if ([true, 1, '1', 'true'].includes(value)) return true;
  if ([false, 0, '0', 'false'].includes(value)) return false;
  return null;
}

function formatReportedTime(value, timezone, language = 'en', timeStyle = 'medium') {
  const seconds = Number(text(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    // Do not silently interpret an unknown installation timezone as Homey's.
    if (!text(timezone)) throw new Error('No timezone');
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'short', timeStyle, timeZone: timezone,
    }).format(date);
  } catch { return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`; }
}

function informationValues(site, translate, language = 'en') {
  const unknown = translate('information.not_reported');
  const display = value => text(value) ?? unknown;
  const boolean = value => {
    const flag = reportedBoolean(value);
    return flag === null ? unknown : translate(`information.${flag ? 'yes' : 'no'}`);
  };
  const contacts = list => Array.isArray(list)
    ? list.length ? list.map(text).filter(Boolean).join('; ') || unknown : translate('information.none_configured')
    : unknown;
  const product = site.produit || {};
  const ecs = site.ecs || {};
  const type = text(ecs.TYPE_ECS);
  const waterType = type === '0' ? translate('information.without_tank')
    : type === '1' ? translate('information.with_tank') : unknown;
  const serviceAlarms = Array.isArray(site.alarmes_pro) ? site.alarmes_pro : null;
  let country = text(site.code_pays);
  if (country) {
    try { country = new Intl.DisplayNames([language], { type: 'region' }).of(country.toUpperCase()); }
    catch { /* Preserve the reported country code if it cannot be translated. */ }
  }
  return {
    frisquet_model: display(product.chaudiere),
    frisquet_product_range: display(product.gamme),
    frisquet_product_variant: [text(product.version1), text(product.version2)].filter(Boolean).join(' · ') || unknown,
    frisquet_rated_power: display(product.puissance),
    frisquet_serial: display(site.agi),
    frisquet_connect_id: display(site.sigmacom),
    frisquet_boiler_clock: formatReportedTime(site.carac_site?.DATE_HEURE_CHAUDIERE, site.timezone, language) || unknown,
    'alarm_generic.service': serviceAlarms === null ? null : serviceAlarms.length > 0,
    frisquet_service_alarms: serviceAlarms === null ? unknown : serviceAlarms.length
      ? serviceAlarms.map(alarm => text(typeof alarm === 'string' ? alarm : alarm?.nom) || translate('information.unspecified_alarm')).join('; ')
      : translate('information.no_service_alarms'),
    frisquet_water_type: waterType,
    frisquet_water_solar: boolean(ecs.solaire),
    frisquet_water_equipped: boolean(ecs.AVEC_ECS),
    frisquet_installation_name: display(site.nom),
    frisquet_installation_postcode: display(site.code_postal),
    frisquet_installation_country: display(country),
    frisquet_installation_timezone: display(site.timezone),
    frisquet_alert_emails: contacts(site.emails_alerte),
    frisquet_alert_phones: contacts(site.telephones_alerte),
  };
}

module.exports = { INFORMATION_CAPABILITIES, INFORMATION_TITLES, text, formatReportedTime, informationValues };
