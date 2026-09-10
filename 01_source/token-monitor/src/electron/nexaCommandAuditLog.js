'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SECRET_KEY = /(?:secret|password|credential|authorization|cookie|access[_-]?token|refresh[_-]?token|api[_-]?key)/iu;
const SECRET_VALUE = /(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|(?:sk|ds)-[A-Za-z0-9_-]{12,}|(?:authorization|password|secret|credential|api[_-]?key|token)\s*[:=]\s*\S+)/iu;
const ALLOWED_FIELDS = Object.freeze([
  'command_id', 'origin_device', 'text', 'domain', 'plan', 'capabilities_used',
  'proposal', 'confirmation', 'result', 'diagnostic', 'status', 'timestamp',
]);
const DEFAULT_SUCCESS_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ERROR_RETENTION_MS = 7 * DEFAULT_SUCCESS_RETENTION_MS;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const ERROR_STATUSES = new Set(['failed', 'confirmation_failed', 'persistence_failed', 'render_failed']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function sanitize(value, depth = 0) {
  if (depth > 8 || value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[REDACTED]' : value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!isPlainObject(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).slice(0, 100)
    .map(([key, entry]) => [key, sanitize(entry, depth + 1)]));
}
function normalizeRecord(value, clock) {
  if (!isPlainObject(value)) throw new TypeError('audit record must be an object');
  const projected = {};
  for (const key of ALLOWED_FIELDS) if (Object.hasOwn(value, key)) projected[key] = sanitize(value[key]);
  projected.command_id = typeof projected.command_id === 'string' ? projected.command_id.slice(0, 200) : '';
  projected.origin_device = typeof projected.origin_device === 'string' ? projected.origin_device.slice(0, 100) : 'desktop';
  // Diagnostic persistence never stores prompt text. The in-memory product history owns
  // its separately redacted display copy.
  projected.text = typeof projected.text === 'string' && projected.text ? '[REDACTED]' : '';
  projected.status = typeof projected.status === 'string' ? projected.status.slice(0, 100) : 'unknown';
  projected.timestamp = typeof projected.timestamp === 'string' ? projected.timestamp.slice(0, 64) : clock();
  return Object.freeze(projected);
}

function createNexaCommandAuditLog({
  filePath = '', fsImpl = fs.promises, clock = () => new Date().toISOString(),
  now = () => Date.now(), memoryLimit = 100,
  successRetentionMs = DEFAULT_SUCCESS_RETENTION_MS,
  errorRetentionMs = DEFAULT_ERROR_RETENTION_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maintenanceIntervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
} = {}) {
  if (typeof filePath !== 'string' || typeof fsImpl?.appendFile !== 'function' || typeof clock !== 'function') throw new TypeError('audit log options are invalid');
  if (!Number.isInteger(memoryLimit) || memoryLimit < 1 || memoryLimit > 1000) throw new TypeError('memoryLimit is invalid');
  if (typeof now !== 'function' || !Number.isInteger(successRetentionMs) || successRetentionMs < 1 ||
      !Number.isInteger(errorRetentionMs) || errorRetentionMs < successRetentionMs ||
      !Number.isInteger(maxBytes) || maxBytes < 1024 ||
      !Number.isInteger(maintenanceIntervalMs) || maintenanceIntervalMs < 1) throw new TypeError('audit retention options are invalid');
  const records = [];
  let lane = Promise.resolve();
  let lastError = null;
  let lastMaintenanceAt = 0;

  function retainedLine(line, currentTime) {
    try {
      const record = JSON.parse(line);
      const timestamp = Date.parse(record?.timestamp);
      if (!Number.isFinite(timestamp)) return null;
      const retention = ERROR_STATUSES.has(record.status) ? errorRetentionMs : successRetentionMs;
      return currentTime - timestamp <= retention ? JSON.stringify(normalizeRecord(record, clock)) : null;
    } catch (_) {
      return null;
    }
  }

  function boundedLines(lines, pendingLine) {
    const candidates = [...lines, pendingLine].filter(Boolean);
    const retained = [];
    let bytes = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const entry = `${candidates[index]}\n`;
      const entryBytes = Buffer.byteLength(entry, 'utf8');
      if (entryBytes > maxBytes) continue;
      if (bytes + entryBytes > maxBytes) break;
      retained.unshift(candidates[index]);
      bytes += entryBytes;
    }
    return retained.length ? `${retained.join('\n')}\n` : '';
  }

  async function compactAndWrite(record, pendingLine) {
    const currentTime = now();
    let existing = '';
    try { existing = await fsImpl.readFile(filePath, 'utf8'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const lines = existing.split(/\r?\n/u).filter(Boolean).map((line) => retainedLine(line, currentTime)).filter(Boolean);
    await fsImpl.writeFile(filePath, boundedLines(lines, pendingLine), { encoding: 'utf8', mode: 0o600 });
    lastMaintenanceAt = currentTime;
  }

  async function persist(record) {
    if (!filePath) return;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    const pendingLine = JSON.stringify(record);
    const canCompact = typeof fsImpl.readFile === 'function' && typeof fsImpl.writeFile === 'function' && typeof fsImpl.stat === 'function';
    if (canCompact) {
      let size = 0;
      try { size = Number((await fsImpl.stat(filePath)).size) || 0; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      if (now() - lastMaintenanceAt >= maintenanceIntervalMs || size + Buffer.byteLength(`${pendingLine}\n`, 'utf8') > maxBytes) {
        await compactAndWrite(record, pendingLine);
        return;
      }
    }
    await fsImpl.appendFile(filePath, `${pendingLine}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  async function record(value) {
    const normalized = normalizeRecord(value, clock);
    records.unshift(normalized);
    records.splice(memoryLimit);
    lane = lane.then(() => persist(normalized)).then(() => { lastError = null; }, (error) => {
      lastError = typeof error?.code === 'string' ? error.code : 'AUDIT_WRITE_FAILED';
    });
    await lane;
    return normalized;
  }
  return Object.freeze({
    record,
    list() { return Object.freeze(records.map((item) => JSON.parse(JSON.stringify(item)))); },
    getState() { return Object.freeze({
      local_only: true, persistent: Boolean(filePath), file_configured: Boolean(filePath),
      status: lastError ? 'error' : 'ready', error_code: lastError,
      prompt_text_persisted: false, success_retention_ms: successRetentionMs,
      error_retention_ms: errorRetentionMs, max_bytes: maxBytes,
    }); },
    flush() { return lane; },
  });
}

module.exports = {
  ALLOWED_FIELDS, DEFAULT_ERROR_RETENTION_MS, DEFAULT_MAX_BYTES,
  DEFAULT_SUCCESS_RETENTION_MS, createNexaCommandAuditLog, normalizeRecord, sanitize,
};
