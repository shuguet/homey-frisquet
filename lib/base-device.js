'use strict';

const Homey = require('homey');
const { FrisquetError, safeError } = require('./errors');

class FrisquetDevice extends Homey.Device {
  async onInit() {
    this.homey.app.devices.add(this);
    this.updateQueue = Promise.resolve();
    this.generation = 0;
    // Upgrade existing devices too; periodic polling owns all refreshes.
    if (this.hasCapability('button.refresh')) await this.removeCapability('button.refresh');
    await this.registerControls();
    await this.connect();
  }

  async connect() {
    this.disconnect();
    const generation = this.generation;
    await this.setUnavailable(this.homey.__('status.connecting'));
    try {
      this.lease = this.homey.app.acquire(this.getStoreValue('credentials'), this.getData().siteId);
      this.connection = this.lease.connection;
      const enqueue = fn => {
        this.updateQueue = this.updateQueue.then(async () => {
          if (this.generation === generation) await fn();
        }).catch(() => this.error('Could not update Frisquet device capabilities'));
      };
      this.handlers = {
        data: site => enqueue(async () => {
          try {
            await this.updateFromSite(site);
            await this.setAvailable();
          } catch (error) { await this.setUnavailable(this.userError(error).message); }
        }),
        failure: error => enqueue(() => this.setUnavailable(this.userError(error).message)),
        controls: () => enqueue(async () => {
          if (this.connection?.snapshot) await this.updateFromSite(this.connection.snapshot);
        }),
        command: state => enqueue(async () => {
          const previous = this.getCapabilityValue('frisquet_command_state');
          await this.value('frisquet_command_state', state);
          if (previous !== null && previous !== state) {
            await this.homey.flow.getDeviceTriggerCard('command_state_changed').trigger(this, { state });
          }
        }),
      };
      for (const [event, handler] of Object.entries(this.handlers)) this.connection.on(event, handler);
      this.handlers.command(this.connection.commandState);
      // Register event handlers before starting the shared initial request.
      if (this.connection.snapshot) this.handlers.data(this.connection.snapshot);
      this.connection.refresh().catch(() => {});
    } catch (error) { await this.setUnavailable(this.userError(error).message); }
  }

  userError(error) { return safeError(error, this.homey.__.bind(this.homey)); }

  async runControl(action) {
    try { return await action(); }
    catch (error) { throw this.userError(error); }
  }

  async value(capability, value) {
    if (this.hasCapability(capability) && this.getCapabilityValue(capability) !== value) {
      await this.setCapabilityValue(capability, value);
    }
  }

  getConnection() {
    if (!this.connection) throw new FrisquetError('stopped');
    return this.connection;
  }

  async capability(id, needed) {
    if (needed && !this.hasCapability(id)) await this.addCapability(id);
    // Preserve optional sensors once paired; null means data is unavailable.
  }

  disconnect() {
    this.generation = (this.generation || 0) + 1;
    if (this.connection && this.handlers) {
      for (const [event, handler] of Object.entries(this.handlers)) this.connection.off(event, handler);
    }
    this.lease?.release();
    this.lease = null;
    this.handlers = null;
    this.connection = null;
  }

  async onDeleted() {
    this.disconnect();
    this.homey.app.devices.delete(this);
  }

  async onUninit() {
    this.disconnect();
    this.homey.app.devices.delete(this);
  }
}

module.exports = FrisquetDevice;
