'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { SCHEMA_VERSION } = require('./contracts');
const { ApplicationByteAccounting } = require('./applicationNetworkContracts');

const HISTORY_SEMANTICS = 'windows_application_network_observation';
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;
const LARGE_HISTORY_COMPACTION_THRESHOLD = 1_000;
const RECENT_RAW_RETENTION_MS = 60 * 60 * 1000;
const LONG_TERM_BUCKET_MS = 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
}

function validateHistoryEntry(value) {
  requireObject(value, 'historyEntry');
  if (value.schema_version !== SCHEMA_VERSION) throw new TypeError(`historyEntry.schema_version must be ${SCHEMA_VERSION}.`);
  if (value.semantics !== HISTORY_SEMANTICS) throw new TypeError(`historyEntry.semantics must be ${HISTORY_SEMANTICS}.`);
  if (!Number.isFinite(Date.parse(value.observed_at))) throw new TypeError('historyEntry.observed_at must be an ISO date-time.');
  if (typeof value.snapshot_id !== 'string' || value.snapshot_id === '') throw new TypeError('historyEntry.snapshot_id is required.');
  requireObject(value.summary, 'historyEntry.summary');
  for (const field of ['active_application_count', 'network_observed_application_count', 'connection_count']) {
    if (!Number.isInteger(value.summary[field]) || value.summary[field] < 0) throw new TypeError(`historyEntry.summary.${field} must be a non-negative integer.`);
  }
  if (!Object.values(ApplicationByteAccounting).includes(value.byte_accounting_status)) throw new TypeError('historyEntry.byte_accounting_status is invalid.');
  if (!Array.isArray(value.applications)) throw new TypeError('historyEntry.applications must be an array.');
  for (const item of value.applications) {
    requireObject(item, 'historyEntry.application');
    if (typeof item.application_id !== 'string' || item.application_id === '') throw new TypeError('history application_id is required.');
    if (!Number.isInteger(item.active_connection_count) || item.active_connection_count < 0) throw new TypeError('history active_connection_count is invalid.');
    if (Object.hasOwn(item, 'traffic') && value.byte_accounting_status !== ApplicationByteAccounting.READY) {
      throw new TypeError('history traffic requires ready byte accounting.');
    }
  }
  return value;
}

function projectHistoryEntry(snapshot) {
  requireObject(snapshot, 'snapshot');
  const ready = snapshot.byte_accounting?.status === ApplicationByteAccounting.READY;
  const applications = (Array.isArray(snapshot.applications) ? snapshot.applications : []).map((item) => {
    const projected = {
      application_id: item.application.application_id,
      process_name: item.application.process_name,
      display_name: item.application.display_name,
      active_connection_count: item.active_connection_count,
      protocol_counts: clone(item.protocol_counts),
      remote_endpoint_counts: clone(item.remote_endpoints),
      attribution_quality: item.attribution_quality
    };
    if (ready && item.traffic) projected.traffic = clone(item.traffic);
    return projected;
  }).sort((a, b) => a.application_id.localeCompare(b.application_id));
  return validateHistoryEntry({
    schema_version: SCHEMA_VERSION,
    semantics: HISTORY_SEMANTICS,
    snapshot_id: snapshot.snapshot_id,
    observed_at: snapshot.observed_at,
    availability: snapshot.availability,
    summary: {
      active_application_count: snapshot.application_summary.active_application_count,
      network_observed_application_count: snapshot.application_summary.network_observed_application_count,
      connection_count: snapshot.connection_observation.count
    },
    byte_accounting_status: snapshot.byte_accounting.status,
    applications
  });
}

function compactLargeApplicationHistory(entries, nowMs) {
  if (entries.length <= LARGE_HISTORY_COMPACTION_THRESHOLD) return entries;
  const rawCutoff = nowMs - RECENT_RAW_RETENTION_MS;
  const raw = [];
  const hourly = new Map();
  for (const entry of entries) {
    const observedAt = Date.parse(entry.observed_at);
    if (observedAt >= rawCutoff) raw.push(entry);
    else hourly.set(Math.floor(observedAt / LONG_TERM_BUCKET_MS), entry);
  }
  return [...hourly.values(), ...raw]
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at) || a.snapshot_id.localeCompare(b.snapshot_id))
    .slice(-DEFAULT_MAX_ENTRIES);
}

class InMemoryApplicationNetworkHistoryStore {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.entries = [];
    if (!Number.isInteger(this.retentionMs) || this.retentionMs < 1) throw new RangeError('retentionMs must be a positive integer.');
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) throw new RangeError('maxEntries must be a positive integer.');
  }

  prune(entries = this.entries) {
    const cutoff = this.now().getTime() - this.retentionMs;
    return entries.filter((entry) => Date.parse(entry.observed_at) >= cutoff)
      .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at) || a.snapshot_id.localeCompare(b.snapshot_id))
      .slice(-this.maxEntries);
  }

  async append(entry) {
    const value = clone(validateHistoryEntry(entry));
    this.entries = this.prune([...this.entries.filter((item) => item.snapshot_id !== value.snapshot_id), value]);
    return clone(value);
  }

  async list({ since, until, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('limit must be between 1 and 1000.');
    const sinceMs = since === undefined ? -Infinity : Date.parse(since);
    const untilMs = until === undefined ? Infinity : Date.parse(until);
    if (Number.isNaN(sinceMs) || Number.isNaN(untilMs)) throw new TypeError('since/until must be ISO date-times.');
    this.entries = this.prune();
    return clone(this.entries.filter((entry) => {
      const time = Date.parse(entry.observed_at);
      return time >= sinceMs && time <= untilMs;
    }).slice(-limit).reverse());
  }

  async latest() {
    const values = await this.list({ limit: 1 });
    return values[0] || null;
  }
}

class JsonFileApplicationNetworkHistoryStore extends InMemoryApplicationNetworkHistoryStore {
  constructor(options = {}) {
    super(options);
    if (typeof options.filePath !== 'string' || !path.isAbsolute(options.filePath)) throw new TypeError('filePath must be absolute.');
    this.filePath = options.filePath;
    this.loaded = false;
    this.writeQueue = Promise.resolve();
    this.storeStatus = 'healthy';
    this.fs = options.fs || fs;
  }

  async load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) throw new TypeError('History file root must be an array.');
      this.entries = compactLargeApplicationHistory(
        this.prune(parsed.map((entry) => clone(validateHistoryEntry(entry)))),
        this.now().getTime()
      );
      this.storeStatus = 'healthy';
    } catch (error) {
      this.entries = [];
      if (error?.code === 'ENOENT') this.storeStatus = 'healthy';
      else {
        this.storeStatus = 'recovered';
        try { await this.fs.rename(this.filePath, `${this.filePath}.corrupt`); } catch { /* evidence best effort */ }
      }
    }
    this.loaded = true;
  }

  async persist() {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await this.fs.mkdir(directory, { recursive: true });
    await this.fs.writeFile(temporary, `${JSON.stringify(this.entries)}\n`, { encoding: 'utf8', mode: 0o600 });
    await this.fs.rename(temporary, this.filePath);
  }

  async append(entry) {
    await this.load();
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const before = this.entries;
      const value = await super.append(entry);
      this.entries = compactLargeApplicationHistory(this.entries, this.now().getTime());
      try { await this.persist(); this.storeStatus = 'healthy'; return value; }
      catch (error) { this.entries = before; this.storeStatus = 'degraded'; throw error; }
    });
    return this.writeQueue;
  }

  async list(options) {
    await this.load();
    return super.list(options);
  }
  status() { return { status: this.storeStatus, entry_count: this.entries.length, max_entries: this.maxEntries, retention_ms: this.retentionMs }; }
}

class ApplicationNetworkObservationRecorder {
  constructor(options = {}) {
    if (!options.collector?.collect || !options.store?.append) throw new TypeError('collector and store are required.');
    this.collector = options.collector;
    this.store = options.store;
  }

  async collectAndRecord() {
    const snapshot = await this.collector.collect();
    const historyEntry = await this.store.append(projectHistoryEntry(snapshot));
    return { snapshot, history_entry: historyEntry };
  }
}

class ApplicationNetworkLongTermObserver {
  constructor(options = {}) {
    if (!options.recorder?.collectAndRecord) throw new TypeError('recorder is required.');
    this.recorder = options.recorder;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || (() => {});
    this.setInterval = options.setInterval || globalThis.setInterval;
    this.clearInterval = options.clearInterval || globalThis.clearInterval;
    this.timer = null;
    this.inFlight = null;
    if (!Number.isInteger(this.intervalMs) || this.intervalMs < 1000) throw new RangeError('intervalMs must be at least 1000.');
  }

  async observeOnce() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.recorder.collectAndRecord().then((result) => {
      this.onResult(result);
      return result;
    }).catch((error) => {
      this.onError(error);
      throw error;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  start({ immediate = true } = {}) {
    if (this.timer) return false;
    this.timer = this.setInterval(() => { this.observeOnce().catch(() => {}); }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
    if (immediate) this.observeOnce().catch(() => {});
    return true;
  }

  stop() {
    if (!this.timer) return false;
    this.clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  get running() { return this.timer !== null; }
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_RETENTION_MS,
  HISTORY_SEMANTICS,
  LARGE_HISTORY_COMPACTION_THRESHOLD,
  compactLargeApplicationHistory,
  ApplicationNetworkObservationRecorder,
  ApplicationNetworkLongTermObserver,
  InMemoryApplicationNetworkHistoryStore,
  JsonFileApplicationNetworkHistoryStore,
  projectHistoryEntry,
  validateHistoryEntry
};
