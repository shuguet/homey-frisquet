'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { gzipSync } = require('node:zlib');

const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 128;
const MAX_AGE = 24 * 60 * 60 * 1000;
const PRIVATE_KEY = /password|passwd|(?:^|_)pwd(?:$|_)|(?:^|_)mdp(?:$|_)|mot.?de.?passe|secret|token|cookie|authorization|credential|session|api.?key|access.?key|bearer|csrf|e.?mail|courriel|telephone|^tel$|phone|mobile|address|adresse|postal|postcode|zip.?code|^city$|^ville$|^street$|^rue$|latitude|longitude|geolocation|serial|numero.?serie|identifiant|sigmacom|^agi$|^mac$|^ip$|uuid|user.?id|username|^user$|utilisateur|account|compte|login|owner|proprietaire|prenom|first.?name|last.?name|^url$|^uri$/i;
const EMAIL = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE = /(?:\+\d[\d ().-]{7,}\d|\b0[1-9](?:[ .-]?\d{2}){4}\b)/g;

function publicLabel(path) {
  return /(?:^|\.)(?:modes_ecs\.\d+|ecs\.MODE_ECS(?:_PAC|_SOLAIRE)?|alarmes(?:_pro)?\.\d+)\.(?:id|nom|name|label)$/.test(path)
    || /(?:^|\.)produit\./.test(path) || path === 'error.name';
}

function privateField(key, path) {
  if (PRIVATE_KEY.test(key)) return true;
  if (/(?:^|_)(?:id|nom|name|label|prenom|commentaire|comment|description)(?:$|_)/i.test(key)) {
    return !publicLabel(path) && !/(?:model|modele|brand|marque|firmware|manufacturer)/i.test(key);
  }
  return /(?:^|\.)vacances\..*(?:date|debut|fin)/i.test(path);
}

// Keep the response structure and unknown fields intact. Only privacy filtering
// and resource bounds belong here; protocol analysis happens off the device.
function anonymize(input, { salt, secrets = [] } = {}) {
  const known = new Set(secrets.filter(v => typeof v === 'string' && v));
  const explicit = new Set(known);
  const alias = value => `anonymous-${createHash('sha256').update(`${salt}\0${value}`).digest('hex').slice(0, 12)}`;
  let visits = 0;
  function collect(value, path = '', depth = 0, hidden = false) {
    if (++visits > 10000 || depth > 12 || !value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value).slice(0, Array.isArray(value) ? 1024 : 128)) {
      const next = path ? `${path}.${key}` : key;
      const sensitive = hidden || privateField(key, next);
      if (sensitive && (typeof child === 'string' || typeof child === 'number')) {
        if (String(child).length >= 4) known.add(String(child));
      } else collect(child, next, depth + 1, sensitive);
    }
  }
  collect(input);
  const sensitive = [...known].sort((a, b) => b.length - a.length);
  function cleanString(value) {
    let out = value;
    for (const secret of sensitive) {
      if (out === secret) return alias(secret);
      if (secret.length >= 4 || explicit.has(secret)) out = out.split(secret).join(alias(secret));
    }
    return out.replace(EMAIL, alias).replace(UUID, alias).replace(IP, alias).replace(PHONE, alias)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, alias)
      .replace(/((?:token|password|secret|authorization)=)[^\s&"<>]+/gi, '$1[redacted]');
  }
  let budget = 64 * 1024;
  visits = 0;
  function walk(value, path = '', depth = 0) {
    if (++visits > 10000 || depth > 12 || budget < 32) return '[truncated]';
    budget -= 8;
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'string') {
      const limited = value.length > 4096 ? `${value.slice(0, 4096)}[truncated]` : value;
      const result = cleanString(limited);
      budget -= Buffer.byteLength(result);
      return result;
    }
    if (typeof value !== 'object') {
      if (known.has(String(value))) return alias(String(value));
      return typeof value === 'number' && !Number.isFinite(value) ? null : value;
    }
    if (Array.isArray(value)) {
      const result = [];
      for (let i = 0; i < Math.min(value.length, 1024); i++) {
        if (budget < 32) break;
        result.push(walk(value[i], `${path}.${i}`, depth + 1));
      }
      if (result.length < value.length) result.push(`[truncated:${value.length - result.length} items]`);
      return result;
    }
    const result = Object.create(null);
    const entries = Object.entries(value);
    for (const [key, child] of entries.slice(0, 128)) {
      if (budget < 32) { result._truncated = true; break; }
      const next = path ? `${path}.${key}` : key;
      const safeKey = cleanString(key.slice(0, 128));
      budget -= Buffer.byteLength(safeKey);
      if (privateField(key, next)) {
        result[safeKey] = child === null ? null
          : typeof child === 'string' || typeof child === 'number' ? alias(String(child)) : '[redacted]';
      } else result[safeKey] = walk(child, next, depth + 1);
    }
    if (entries.length > 128) result._truncated = true;
    return result;
  }
  return walk(input);
}

function errorDetails(error) {
  return {
    name: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'FrisquetError'].includes(error?.name) ? error.name : 'Error',
    code: Object.hasOwn(require('../locales/en.json').errors, error?.code || '') ? error.code : 'unexpected',
    status: Number.isInteger(error?.status) ? error.status : null,
    // Error messages can contain response bodies or credential-bearing URLs.
    frames: [...String(error?.stack || '').matchAll(/\bat [^\n]*?\b((?:app|api|lib\/(?:diagnostics|frisquet-api|site-connection|base-device|base-driver|heating-device|model|information|errors)|drivers\/(?:boiler|zone)\/(?:device|driver))\.js:\d+:\d+)/g)]
      .slice(0, 8).map(match => match[1]),
  };
}

class Diagnostics {
  constructor({ getState = () => null, setState = () => {}, log = () => {}, context = () => ({}), now = Date.now } = {}) {
    this.setState = setState; this.log = log; this.context = context; this.now = now;
    this.session = randomUUID(); this.closed = false;
    let saved;
    try { saved = getState(); } catch { /* Diagnostics must not prevent startup. */ }
    this.salt = typeof saved?.salt === 'string' && /^[a-f0-9]{32}$/.test(saved.salt) ? saved.salt : randomBytes(16).toString('hex');
    this.entries = saved?.format === 1 && Array.isArray(saved.entries)
      ? saved.entries.slice(-MAX_ENTRIES).filter(entry => Number.isFinite(entry?.at) && typeof entry?.kind === 'string') : [];
    try { this.trim(); } catch { this.entries = []; }
  }

  reference(value) { return createHash('sha256').update(`${this.salt}\0${value}`).digest('hex').slice(0, 12); }

  trim() {
    this.entries = this.entries.filter(entry => entry.at >= this.now() - MAX_AGE).slice(-MAX_ENTRIES);
    while (this.entries.length && Buffer.byteLength(JSON.stringify(this.entries)) > MAX_BYTES) this.entries.shift();
  }

  record(kind, data, secrets = []) {
    if (this.closed) return;
    try {
      const entry = { at: this.now(), session: this.session, kind, context: this.context(), data: anonymize(data, { salt: this.salt, secrets }) };
      this.entries.push(entry); this.trim();
      this.emit('FRISQUET_TRACE', entry);
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 10000);
        this.flushTimer.unref?.();
      }
    } catch { /* A report must never interfere with heating or pairing. */ }
  }

  exchange({ path, method, request, response, status, durationMs, error, attempt }, secrets) {
    const match = /^(sites|ordres)\/([^?]+)/.exec(path);
    const authentication = path.startsWith('authentifications');
    this.record('exchange', {
      endpoint: authentication ? '/authentifications' : match ? `/${match[1]}/:installation` : '/unknown',
      installation: match ? this.reference(decodeURIComponent(match[2])) : null,
      method, status, durationMs, attempt, error,
      // Authentication contains account data, not equipment protocol samples.
      ...(authentication ? {} : { request: request ?? null, response: response ?? null }),
    }, match ? [...secrets, decodeURIComponent(match[2])] : secrets);
  }

  failure(stage, error, installation) {
    this.record('error', { stage, installation: installation ? this.reference(installation) : null, error: errorDetails(error) });
    this.flush();
  }

  emit(prefix, value) {
    const encoded = gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
    const id = randomUUID();
    const total = Math.ceil(encoded.length / 1800);
    for (let index = 0; index < total; index++) {
      this.log(`${prefix} ${JSON.stringify({ id, part: index + 1, total, data: encoded.slice(index * 1800, (index + 1) * 1800) })}`);
    }
  }

  report(devices = []) {
    this.trim();
    const report = {
      format: 'frisquet-support-v1', id: randomUUID(), createdAt: new Date(this.now()).toISOString(),
      context: this.context(), retention: { hours: 24, maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES },
      devices, entries: this.entries,
    };
    return structuredClone(report);
  }

  prepare(devices) {
    const report = this.report(devices);
    this.emit('FRISQUET_SUPPORT', report);
    this.flush();
    return report;
  }

  flush() {
    try { this.trim(); this.setState({ format: 1, salt: this.salt, entries: this.entries }); }
    catch { /* Storage failures must not stop normal app operation. */ }
  }

  clear() {
    this.entries = []; this.flush();
  }

  close() {
    clearTimeout(this.flushTimer); this.flushTimer = null;
    this.flush(); this.closed = true;
  }
}

module.exports = { Diagnostics, anonymize, errorDetails, MAX_BYTES, MAX_ENTRIES };
