'use strict';

function onHomeyReady(Homey) {
  const elements = Object.fromEntries(['prepare', 'clear', 'status', 'result', 'report', 'download', 'copy']
    .map(id => [id, document.getElementById(id)]));
  let report;
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = Homey.__(element.dataset.i18n); });
  Homey.ready();
  const status = key => { elements.status.textContent = Homey.__(`support.${key}`); };

  const form = document.getElementById('preferences');
  const fields = document.getElementById('preferences-fields');
  const poll = document.getElementById('poll-minutes');
  const connection = document.getElementById('connection-notifications');
  const delay = document.getElementById('connection-delay');
  const alarms = document.getElementById('alarm-notifications');
  const preferencesStatus = key => {
    document.getElementById('preferences-status').textContent = key ? Homey.__(`preferences.${key}`) : '';
  };
  const showPreferences = preferences => {
    poll.value = preferences.pollMinutes;
    connection.checked = preferences.connectionNotifications;
    delay.value = preferences.connectionDelayMinutes;
    alarms.checked = preferences.alarmNotifications;
    delay.disabled = !connection.checked;
  };
  connection.addEventListener('change', () => { delay.disabled = !connection.checked; });
  preferencesStatus('loading');
  Homey.api('GET', '/preferences', {}, (error, preferences) => {
    if (error) { preferencesStatus('load_failed'); return; }
    showPreferences(preferences);
    fields.disabled = false;
    preferencesStatus(null);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const preferences = {
      pollMinutes: Number(poll.value),
      connectionNotifications: connection.checked,
      connectionDelayMinutes: Number(delay.value),
      alarmNotifications: alarms.checked,
    };
    // A disabled delay field retains its last valid value.
    if (!connection.checked && (!Number.isInteger(preferences.connectionDelayMinutes)
      || preferences.connectionDelayMinutes < 5 || preferences.connectionDelayMinutes > 120)) preferences.connectionDelayMinutes = 30;
    fields.disabled = true;
    preferencesStatus('saving');
    Homey.api('PUT', '/preferences', preferences, (error, saved) => {
      fields.disabled = false;
      if (error) { preferencesStatus('save_failed'); return; }
      showPreferences(saved);
      preferencesStatus('saved');
    });
  });

  elements.prepare.addEventListener('click', () => {
    elements.prepare.disabled = true;
    status('preparing');
    Homey.api('POST', '/support-report', {}, (error, result) => {
      elements.prepare.disabled = false;
      if (error) { status('failed'); return; }
      report = result;
      elements.report.value = JSON.stringify(report, null, 2);
      elements.result.hidden = false;
      status('ready');
    });
  });

  elements.clear.addEventListener('click', () => {
    elements.clear.disabled = true;
    Homey.api('DELETE', '/support-report', {}, error => {
      elements.clear.disabled = false;
      if (error) { status('failed'); return; }
      report = null; elements.report.value = ''; elements.result.hidden = true;
      status('cleared');
    });
  });

  elements.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(elements.report.value); status('copied'); }
    catch {
      elements.report.focus(); elements.report.select();
      status('select_copy');
    }
  });

  elements.download.addEventListener('click', () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([elements.report.value], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `frisquet-support-${report.id}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
