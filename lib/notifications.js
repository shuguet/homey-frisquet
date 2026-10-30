'use strict';

const { createHash } = require('node:crypto');

function shortText(value, max = 160) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f*_`<>\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function alarmList(value) {
  if (!Array.isArray(value)) return null; // An omitted field does not mean cleared.
  const alarms = new Map();
  for (const item of value.slice(0, 128)) {
    const name = typeof item === 'string' ? item : item?.nom;
    if (typeof name !== 'string' || !name.trim()) return null; // Unknown alarm schema; retain the baseline.
    const normalized = name.trim().replace(/\s+/g, ' ');
    const id = createHash('sha256').update(normalized).digest('hex');
    alarms.set(id, shortText(normalized));
  }
  return alarms;
}

class InstallationNotifications {
  constructor({ preferences, state = {}, save, send, onError = () => {}, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.preferences = preferences;
    this.state = {
      failedSince: Number.isFinite(state.failedSince) ? Math.min(now(), state.failedSince) : null,
      outageNotified: state.outageNotified === true,
      boiler: Array.isArray(state.boiler) ? state.boiler.filter(id => /^[a-f0-9]{64}$/.test(id)).slice(0, 128) : [],
      service: Array.isArray(state.service) ? state.service.filter(id => /^[a-f0-9]{64}$/.test(id)).slice(0, 128) : [],
    };
    this.save = save;
    this.send = send;
    this.onError = onError;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.lastSaved = JSON.stringify(this.state);
    this.timer = null;
    this.failing = false; // Confirm a persisted outage with a new read first.
    this.stopped = false;
    this.queue = Promise.resolve();
  }

  enqueue(action) {
    this.queue = this.queue.then(() => this.stopped ? undefined : action()).catch(() => this.onError());
    return this.queue;
  }

  persist() {
    const serialized = JSON.stringify(this.state);
    if (serialized === this.lastSaved) return;
    try { this.save(JSON.parse(serialized)); this.lastSaved = serialized; }
    catch { this.onError(); }
  }

  async notify(kind, tokens = {}) {
    if (this.stopped) return false;
    try { await this.send(kind, tokens); return true; }
    catch { this.onError(); return false; }
  }

  setPreferences(preferences) {
    this.preferences = preferences;
    return this.enqueue(() => {
      if (!preferences.connectionNotifications) this.state.outageNotified = false;
      this.scheduleWarning();
      this.persist();
    });
  }

  scheduleWarning() {
    this.clearTimer(this.timer);
    this.timer = null;
    if (this.stopped || !this.failing || !this.preferences.connectionNotifications || this.state.outageNotified) return;
    const remaining = this.preferences.connectionDelayMinutes * 60000 - (this.now() - this.state.failedSince);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.enqueue(() => this.warn());
    }, Math.max(0, remaining));
  }

  async warn() {
    if (!this.failing || !this.preferences.connectionNotifications || this.state.outageNotified) return;
    if (this.now() - this.state.failedSince < this.preferences.connectionDelayMinutes * 60000) {
      this.scheduleWarning();
      return;
    }
    if (await this.notify('connection_lost', { minutes: Math.floor((this.now() - this.state.failedSince) / 60000) })) {
      this.state.outageNotified = true;
      this.persist();
    }
  }

  failure() {
    return this.enqueue(() => {
      this.failing = true;
      if (this.state.failedSince === null) this.state.failedSince = this.now();
      if (!this.preferences.connectionNotifications) this.state.outageNotified = false;
      this.persist();
      this.scheduleWarning();
    });
  }

  success(site) {
    return this.enqueue(async () => {
      this.failing = false;
      this.clearTimer(this.timer);
      this.timer = null;
      this.state.failedSince = null;
      if (!this.preferences.connectionNotifications || (this.state.outageNotified && await this.notify('connection_restored'))) {
        this.state.outageNotified = false;
      }
      for (const [kind, field] of [['boiler', 'alarmes'], ['service', 'alarmes_pro']]) {
        const alarms = alarmList(site[field]);
        if (alarms === null) continue;
        const known = new Set(this.state[kind]);
        const added = [...alarms].filter(([id]) => !known.has(id));
        if (!this.preferences.alarmNotifications || added.length === 0
          || await this.notify(`${kind}_alarm`, { alarms: shortText(added.map(([, name]) => name).join('; '), 240) })) {
          this.state[kind] = [...alarms.keys()];
        } else {
          // Retry unsent new alarms at the next successful poll, while retaining
          // the baseline for alarms that were already reported.
          this.state[kind] = [...alarms.keys()].filter(id => known.has(id));
        }
      }
      this.persist();
    });
  }

  stop() {
    this.stopped = true;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}

module.exports = { InstallationNotifications, shortText };
