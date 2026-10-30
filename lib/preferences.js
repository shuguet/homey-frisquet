'use strict';

const DEFAULTS = Object.freeze({
  pollMinutes: 15,
  connectionNotifications: false,
  connectionDelayMinutes: 30,
  alarmNotifications: false,
});

function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isInteger(value.pollMinutes) || value.pollMinutes < 5 || value.pollMinutes > 60
    || !Number.isInteger(value.connectionDelayMinutes) || value.connectionDelayMinutes < 5 || value.connectionDelayMinutes > 120
    || typeof value.connectionNotifications !== 'boolean' || typeof value.alarmNotifications !== 'boolean') {
    throw new Error('Invalid app settings');
  }
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, value[key]]));
}

function loadPreferences(settings) {
  const saved = settings.get('preferences');
  try { return validatePreferences(saved); }
  catch {
    // Existing installations already have a local support journal. Preserve
    // their five-minute polling when migrating to configurable settings.
    const defaults = { ...DEFAULTS, pollMinutes: settings.get('supportJournal') ? 5 : DEFAULTS.pollMinutes };
    settings.set('preferences', defaults);
    return defaults;
  }
}

module.exports = { DEFAULTS, loadPreferences, validatePreferences };
