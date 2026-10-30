'use strict';

const { EventEmitter } = require('node:events');
const { applyOrders, flag } = require('./model');
const { FrisquetError, safeError } = require('./errors');

function ordersMatch(site, orders) {
  return orders.every(({ cle, valeur }) => {
    const match = /^(.*)_Z([1-3])$/.exec(cle);
    if (match) {
      const zone = site.zones.find(z => Number(z.numero) === Number(match[2]));
      if (match[1] === 'ACTIVITE_BOOST') return zone?.carac_zone?.ACTIVITE_BOOST != null
        && flag(zone.carac_zone.ACTIVITE_BOOST) === (Number(valeur) === 1);
      return zone?.carac_zone?.[match[1]] != null && Number(zone.carac_zone[match[1]]) === Number(valeur);
    }
    if (cle === 'MODE_DERO') {
      return site.zones.filter(z => Number(z.carac_zone.SELECTEUR) === 5).every(z =>
        Number(valeur) === 0 ? !flag(z.carac_zone.DERO)
          : flag(z.carac_zone.DERO) && Number(z.carac_zone.MODE) === Number(valeur));
    }
    const current = site.ecs?.[cle];
    return current != null && Number(typeof current === 'object' ? current.id : current) === Number(valeur);
  });
}

class SiteConnection extends EventEmitter {
  constructor(api, siteId, { pollMs = 300000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super();
    this.api = api;
    this.siteId = siteId;
    this.pollMs = pollMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.snapshot = null;
    this.desired = null;
    this.pendingOrders = [];
    this.lastRead = -Infinity;
    this.lastCommand = -Infinity;
    this.readPromise = null;
    this.queue = Promise.resolve();
    this.revision = 0;
    this.failures = 0;
    this.timer = null;
    this.timerPurpose = null;
    this.watcher = null;
    this.commandState = 'idle';
    this.stopped = false;
  }

  schedule(ms, purpose = 'command') {
    if (this.stopped) return;
    this.clearTimer(this.timer);
    this.timerPurpose = purpose;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.timerPurpose = null;
      this.refresh(true).catch(() => {}); // refresh emits a sanitized failure.
    }, ms);
  }

  setPollInterval(ms) {
    this.pollMs = ms;
    if (!this.stopped && !this.readPromise && this.timerPurpose === 'poll') {
      this.schedule(Math.max(0, this.lastRead + ms - this.now()), 'poll');
    }
  }

  async refresh(force = false) {
    if (this.stopped) throw new FrisquetError('stopped');
    if (this.readPromise) return this.readPromise;
    if (!force && this.snapshot && this.now() - this.lastRead < 10000) return this.snapshot;
    this.readPromise = (async () => {
      try {
        const data = await this.api.getSite(this.siteId);
        if (this.stopped) throw new FrisquetError('stopped');
        this.snapshot = data;
        this.lastRead = this.now();
        this.failures = 0;
        if (this.desired && (ordersMatch(data, this.pendingOrders) || this.now() - this.lastCommand > 120000)) {
          this.desired = null;
          this.pendingOrders = [];
        }
        this.emit('data', data);
        // Poll once more soon if accepted orders have not appeared yet.
        this.schedule(this.desired ? 30000 : this.pollMs, this.desired ? 'command' : 'poll');
        return data;
      } catch (error) {
        const safe = safeError(error);
        if (!this.stopped) {
          this.failures += 1;
          this.emit('failure', safe);
          const delay = safe.code === 'credentials' ? 900000
            : Math.min(3600000, this.pollMs * 2 ** Math.min(this.failures - 1, 4));
          this.schedule(delay, 'retry');
        }
        throw safe;
      }
    })();
    try { return await this.readPromise; }
    finally { this.readPromise = null; }
  }

  setCommandState(state) {
    if (this.stopped) return;
    this.commandState = state;
    this.emit('command', state);
  }

  command(buildOrders) {
    const execute = async () => {
      if (this.stopped) throw new FrisquetError('stopped');
      if (this.desired && this.now() - this.lastCommand > 120000) {
        this.desired = null;
        this.pendingOrders = [];
      }
      if (!this.snapshot || (!this.desired && this.now() - this.lastRead > 30000)) await this.refresh(true);
      const basis = this.desired || this.snapshot;
      const orders = buildOrders(basis);
      const revision = ++this.revision;
      this.watcher?.cancel();
      this.setCommandState('pending');
      try {
        await this.api.order(this.siteId, orders);
      } catch (error) {
        const safe = safeError(error);
        const ambiguous = ['network', 'timeout', 'response'].includes(safe.code) || safe.status >= 500;
        this.setCommandState(ambiguous ? 'unconfirmed' : 'failed');
        this.desired = null;
        this.pendingOrders = [];
        this.lastRead = -Infinity;
        this.emit('controls');
        this.schedule(10000);
        throw safe;
      }
      if (this.stopped) return;
      this.desired = applyOrders(basis, orders);
      const pending = new Map(this.pendingOrders.map(o => [o.cle, o]));
      for (const o of orders) pending.set(o.cle, o);
      this.pendingOrders = [...pending.values()];
      this.lastCommand = this.now();
      this.emit('controls');
      this.watcher = this.api.watchOrder(this.siteId);
      this.watcher.promise.then(state => {
        if (this.stopped || this.revision !== revision) return;
        this.setCommandState(state);
        this.schedule(state === 'confirmed' ? 1000 : 10000);
      }).catch(() => {
        if (this.stopped || this.revision !== revision) return;
        this.setCommandState('unconfirmed');
        this.schedule(10000);
      });
      this.schedule(10000);
      return true;
    };
    const result = this.queue.then(execute);
    this.queue = result.catch(() => {});
    return result;
  }

  stop() {
    this.stopped = true;
    this.revision += 1;
    this.clearTimer(this.timer);
    this.watcher?.cancel();
    this.removeAllListeners();
  }
}

module.exports = { SiteConnection, ordersMatch };
