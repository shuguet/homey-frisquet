'use strict';

function onHomeyReady(Homey) {
  const elements = Object.fromEntries(['prepare', 'clear', 'status', 'result', 'report', 'download', 'copy']
    .map(id => [id, document.getElementById(id)]));
  let report;
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = Homey.__(element.dataset.i18n); });
  Homey.ready();
  const status = key => { elements.status.textContent = Homey.__(`support.${key}`); };

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
