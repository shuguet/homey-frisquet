'use strict';

const { randomBytes } = require('node:crypto');
const { FrisquetError } = require('./errors');
const { text } = require('./information');

const ORIGIN = 'https://fcutappli.frisquet.com/api/v1/';
const WS_ORIGIN = 'wss://fcappcom.frisquet.com/';
const HEADERS = {
  'Accept-Language': 'FR',
  'Android-Version': '2.8.1',
  'Content-Type': 'application/json; charset=UTF-8',
  'User-Agent': 'okhttp/4.12.0',
};

class FrisquetApi {
  constructor(credentials, { fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket,
    timeoutMs = 15000, confirmationMs = 20000, diagnostics = null } = {}) {
    this.email = String(credentials.email || '').trim();
    this.password = credentials.password;
    this.appId = credentials.appId || randomBytes(16).toString('base64url');
    this.fetch = fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.timeoutMs = timeoutMs;
    this.confirmationMs = confirmationMs;
    this.token = null;
    this.sites = [];
    this.loginPromise = null;
    this.watchers = new Set();
    this.controllers = new Set();
    this.closed = false;
    this.diagnostics = diagnostics;
  }

  async request(path, { method = 'GET', body, authenticated = true } = {}, retry = true) {
    if (this.closed) throw new FrisquetError('stopped');
    if (authenticated && !this.token) await this.login();
    const usedToken = this.token;
    const url = new URL(path, ORIGIN);
    if (authenticated) url.searchParams.set('token', usedToken);
    const abort = new AbortController();
    this.controllers.add(abort);
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let response;
    let data;
    let failure;
    const started = Date.now();
    try {
      response = await this.fetch(url.toString(), {
        method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: abort.signal,
      });
      // The response is deliberately never included in exception text.
      if (response.ok) {
        const text = await response.text();
        try { data = text ? JSON.parse(text) : null; }
        catch { throw new FrisquetError('response'); }
      } else {
        // Preserve structured error responses for support without exposing them
        // in errors. HTML and other non-JSON bodies are deliberately not saved.
        try { data = JSON.parse(await response.text()); } catch { data = null; }
      }
    } catch (error) {
      failure = error instanceof FrisquetError ? error
        : new FrisquetError(this.closed ? 'stopped' : (abort.signal.aborted ? 'timeout' : 'network'));
      throw failure;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(abort);
      try {
        this.diagnostics?.exchange({ path, method, request: body, response: data,
          status: response?.status ?? null, durationMs: Date.now() - started,
          error: failure?.code ?? null, attempt: retry ? 1 : 2,
        }, [this.email, this.password, this.appId, this.token, usedToken]);
      } catch { /* Support capture must not affect requests or retry semantics. */ }
    }
    if (response.status === 401 || response.status === 403) {
      if (!authenticated || !retry) throw new FrisquetError('credentials', response.status);
      // Another concurrent request may already have renewed the token.
      if (this.token === usedToken) this.token = null;
      if (!this.token) await this.login();
      return this.request(path, { method, body, authenticated }, false);
    }
    if (response.status === 429) throw new FrisquetError('rate_limit', 429);
    if (!response.ok) throw new FrisquetError('service', response.status);
    if (data && (data.success === false || data.error || data.erreur
      || (Array.isArray(data.errors) && data.errors.length))) throw new FrisquetError('service');
    return data;
  }

  async login() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      if (!this.email || typeof this.password !== 'string' || !this.password) {
        throw new FrisquetError('credentials');
      }
      const data = await this.request(`authentifications?app_id=${encodeURIComponent(this.appId)}`, {
        method: 'POST', authenticated: false,
        body: { locale: 'fr', email: this.email, password: this.password, type_client: 'IOS' },
      });
      if (this.closed) throw new FrisquetError('stopped');
      if (!data || typeof data.token !== 'string' || !data.token || !Array.isArray(data.utilisateur?.sites)) {
        throw new FrisquetError('response');
      }
      this.token = data.token;
      this.sites = data.utilisateur.sites.filter(s => s.identifiant_chaudiere != null)
        .map(s => ({ id: String(s.identifiant_chaudiere), name: String(s.nom || 'Frisquet') }));
      if (!this.sites.length) throw new FrisquetError('no_sites');
      return this.sites;
    })();
    try { return await this.loginPromise; }
    finally { this.loginPromise = null; }
  }

  async getSite(siteId) {
    const data = await this.request(`sites/${encodeURIComponent(siteId)}`);
    if (!data || !Array.isArray(data.zones) || data.zones.some(z => !z || !z.carac_zone)) {
      this.diagnostics?.failure('installation_response', new FrisquetError('response'), siteId);
      throw new FrisquetError('response');
    }
    // Keep the control/telemetry fields and explicitly requested installation
    // information. Credentials and unrelated account fields are never copied.
    const product = data.produit || {};
    const contactList = list => Array.isArray(list) ? list.map(text).filter(Boolean) : null;
    return {
      identifiant_chaudiere: String(siteId), nom: data.nom || 'Frisquet',
      timezone: data.timezone, zones: data.zones, ecs: data.ecs || {},
      modes_ecs: data.modes_ecs || [], vacances: data.vacances || {},
      environnement: data.environnement || {}, alarmes: Array.isArray(data.alarmes) ? data.alarmes : null,
      carac_site: data.carac_site || {},
      produit: Object.fromEntries(['chaudiere', 'gamme', 'version1', 'version2', 'puissance'].map(key => [key, text(product[key])])),
      agi: text(data.agi), sigmacom: text(data.sigmacom),
      code_postal: text(data.code_postal), code_pays: text(data.code_pays),
      emails_alerte: contactList(data.emails_alerte), telephones_alerte: contactList(data.telephones_alerte),
      alarmes_pro: Array.isArray(data.alarmes_pro)
        ? data.alarmes_pro.map(alarm => ({ nom: text(typeof alarm === 'string' ? alarm : alarm?.nom) })) : null,
      siteFields: Object.keys(data).sort(),
      date_derniere_remontee: data.date_derniere_remontee,
    };
  }

  async order(siteId, orders) {
    if (!Array.isArray(orders) || !orders.length || orders.some(o =>
      !/^(?:(?:SELECTEUR|CONS_CONF|CONS_RED|CONS_HG|ACTIVITE_BOOST)_Z[1-3]|MODE_DERO|MODE_ECS|MODE_ECS_PAC|MODE_ECS_SOLAIRE)$/.test(o.cle)
      || !/^-?\d+$/.test(o.valeur))) throw new FrisquetError('unsupported');
    // Auth expiry is retried once. Timeouts and transport errors are NEVER
    // replayed: a failed response does not mean the boiler missed the order.
    return this.request(`ordres/${encodeURIComponent(siteId)}`, { method: 'POST', body: orders });
  }

  watchOrder(siteId) {
    let socket;
    let timer;
    let settled = false;
    let finish;
    const promise = new Promise(resolve => {
      finish = status => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.watchers.delete(finish);
        try { socket?.close(); } catch { /* No credential-bearing errors. */ }
        this.diagnostics?.record('acknowledgement', {
          installation: this.diagnostics.reference(siteId), status,
        });
        resolve(status);
      };
      this.watchers.add(finish);
      timer = setTimeout(() => finish('unconfirmed'), this.confirmationMs);
      try {
        if (this.closed || !this.WebSocket) return finish('unconfirmed');
        const url = new URL(WS_ORIGIN);
        url.searchParams.set('token', this.token);
        url.searchParams.set('identifiant_chaudiere', siteId);
        socket = new this.WebSocket(url.toString());
        socket.addEventListener('open', () => {
          if (settled) return;
          try {
            socket.send(JSON.stringify({ type: 'ORDRE_EN_ATTENTE' }));
            this.diagnostics?.record('websocket_send', {
              installation: this.diagnostics.reference(siteId), request: { type: 'ORDRE_EN_ATTENTE' },
            });
          }
          catch { finish('unconfirmed'); }
        });
        socket.addEventListener('message', event => {
          let data;
          try { data = JSON.parse(String(event.data)); } catch { return; }
          this.diagnostics?.record('websocket_receive', {
            installation: this.diagnostics.reference(siteId), response: data,
          }, [this.email, this.password, this.appId, this.token, String(siteId)]);
          if (data.type === 'ORDRE_OK') finish('confirmed');
        });
        socket.addEventListener('error', () => finish('unconfirmed'));
        socket.addEventListener('close', () => finish('unconfirmed'));
      } catch { finish('unconfirmed'); }
    });
    return { promise, cancel: () => finish('unconfirmed') };
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const finish of [...this.watchers]) finish('unconfirmed');
    this.token = null;
    this.password = null;
  }
}

module.exports = FrisquetApi;
