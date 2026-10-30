'use strict';

const fs = require('node:fs');
const { gunzipSync } = require('node:zlib');

// Accept exported Homey logs as plain text or JSON. Reassembly and inspection
// happen on the maintainer's computer, never on the customer's Homey.
function decode(text) {
  const groups = new Map();
  function inspect(value) {
    if (typeof value === 'string') {
      for (const line of value.split('\n')) {
        const match = /FRISQUET_(SUPPORT|TRACE) (\{.*\})/.exec(line);
        if (!match) continue;
        let chunk;
        try { chunk = JSON.parse(match[2]); } catch { continue; }
        if (typeof chunk.id !== 'string' || !Number.isInteger(chunk.part) || !Number.isInteger(chunk.total)
          || chunk.total < 1 || chunk.total > 256 || chunk.part < 1 || chunk.part > chunk.total
          || typeof chunk.data !== 'string' || !/^[A-Za-z0-9+/=]{1,1800}$/.test(chunk.data)) continue;
        const key = `${match[1]}:${chunk.id}`;
        if (!groups.has(key)) groups.set(key, { type: match[1], total: chunk.total, parts: new Map() });
        const group = groups.get(key);
        if (group.total === chunk.total) group.parts.set(chunk.part, chunk.data);
      }
    } else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.format === 'frisquet-support-v1') return parsed;
    inspect(parsed);
  } catch { inspect(text); }
  const reports = [], entries = [];
  let incomplete = 0;
  for (const group of groups.values()) {
    if (group.parts.size !== group.total) { incomplete++; continue; }
    try {
      const encoded = Array.from({ length: group.total }, (_, index) => group.parts.get(index + 1)).join('');
      const data = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 512 * 1024 }));
      if (group.type === 'SUPPORT') reports.push(data); else entries.push(data);
    } catch { incomplete++; }
  }
  if (!reports.length && !entries.length) throw new Error('No complete Frisquet report found. Export the JSON report from the app settings.');
  const latest = reports.at(-1);
  return latest ? { ...latest, incompleteLogRecords: incomplete }
    : { format: 'frisquet-trace-v1', incompleteLogRecords: incomplete, entries: entries.sort((a, b) => a.at - b.at) };
}

if (require.main === module) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node scripts/decode-report.js <report.json-or-log.txt>');
    process.stdout.write(`${JSON.stringify(decode(fs.readFileSync(file, 'utf8')), null, 2)}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { decode };
