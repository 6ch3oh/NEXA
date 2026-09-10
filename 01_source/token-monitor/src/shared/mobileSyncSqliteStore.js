'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  STATUS_ACK_REASONS,
  mobileStatusFingerprint,
  validateMobileStatusRequest,
  validateMobileSyncRequest
} = require('./mobileSyncProtocol');
const {
  BUSINESS_DELIVERY_STATUSES,
  MOBILE_SYNC_STORE_VERSION,
  eventKey
} = require('./mobileSyncStore');

let builtInSqlite = null;
try {
  builtInSqlite = require('node:sqlite');
} catch (_) {
  builtInSqlite = null;
}

const SQLITE_STORE_SCHEMA_VERSION = 1;
const NOTIFICATION_PENDING_STATUSES = Object.freeze(['PENDING', 'AI_PENDING', 'RETRY_PENDING']);
const NOTIFICATION_TERMINAL_STATUSES = Object.freeze(['CLASSIFIED', 'SENSITIVE_SKIPPED']);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function pendingNotificationClassification() {
  return {
    status: 'PENDING',
    semantic_category: null,
    confidence: null,
    classification_source: null,
    model_id: null,
    processed_at: null,
    classification_version: 'notification-semantic-v0.1',
    reason_code: null
  };
}

function acknowledgement(event, status, reason = null) {
  return {
    event_type: event.event_type,
    event_id: event.event_id,
    status,
    reason,
    error_message: null
  };
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function sourcePackage(payload) {
  return String(payload?.package_name || payload?.source_package || '') || null;
}

function identityKey(event) {
  return eventKey(event.device_id, event.event_type, event.event_id);
}

function appIdentityJson(value, present = true) {
  return present ? JSON.stringify(value ?? null) : null;
}

function appIdentityFromJson(value) {
  if (value === null || value === undefined) return null;
  return parseJson(value, value);
}

function initializeSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA wal_autocheckpoint = 1000;
    CREATE TABLE IF NOT EXISTS mobile_store_metadata (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mobile_events (
      row_order INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_time INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      source_package TEXT,
      posted_at INTEGER,
      sequence_number INTEGER,
      UNIQUE (device_id, event_type, event_id)
    );
    CREATE TABLE IF NOT EXISTS mobile_batches (
      row_order INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE (device_id, batch_id)
    );
    CREATE TABLE IF NOT EXISTS mobile_batch_events (
      device_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_order INTEGER NOT NULL,
      PRIMARY KEY (device_id, batch_id, event_type, event_id),
      FOREIGN KEY (device_id, batch_id) REFERENCES mobile_batches (device_id, batch_id),
      FOREIGN KEY (device_id, event_type, event_id) REFERENCES mobile_events (device_id, event_type, event_id)
    );
    CREATE TABLE IF NOT EXISTS business_delivery (
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT,
      reason_code TEXT,
      PRIMARY KEY (device_id, event_type, event_id),
      FOREIGN KEY (device_id, event_type, event_id) REFERENCES mobile_events (device_id, event_type, event_id)
    );
    CREATE TABLE IF NOT EXISTS notification_classification (
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      app_identity_json TEXT,
      semantic_category TEXT,
      confidence REAL,
      classification_source TEXT,
      model_id TEXT,
      processed_at TEXT,
      classification_version TEXT NOT NULL,
      reason_code TEXT,
      PRIMARY KEY (device_id, event_type, event_id),
      FOREIGN KEY (device_id, event_type, event_id) REFERENCES mobile_events (device_id, event_type, event_id)
    );
    CREATE TABLE IF NOT EXISTS mobile_status (
      device_id TEXT PRIMARY KEY,
      captured_at_epoch_ms INTEGER NOT NULL,
      snapshot_fingerprint TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_events_type_time
      ON mobile_events (event_type, event_time);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_source_posted
      ON mobile_events (source_package, posted_at);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_device_sequence
      ON mobile_events (device_id, sequence_number);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_type_sequence
      ON mobile_events (event_type, sequence_number);
    CREATE INDEX IF NOT EXISTS idx_mobile_events_type_posted
      ON mobile_events (event_type, posted_at);
    CREATE INDEX IF NOT EXISTS idx_notification_classification_status
      ON notification_classification (status);
    CREATE INDEX IF NOT EXISTS idx_notification_classification_app_category
      ON notification_classification (app_identity_json, semantic_category);
    CREATE INDEX IF NOT EXISTS idx_business_delivery_status
      ON business_delivery (status);
    PRAGMA user_version = ${SQLITE_STORE_SCHEMA_VERSION};
  `);
}

function createMobileSyncSqliteStore({
  filePath,
  sqliteModule = builtInSqlite,
  now = () => new Date().toISOString(),
  faultInjector = null,
  onTransaction = null
} = {}) {
  if (!filePath) throw new Error('mobile sync SQLite store filePath is required');
  if (!sqliteModule?.DatabaseSync) throw new Error('Reliable node:sqlite DatabaseSync runtime is unavailable');
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new sqliteModule.DatabaseSync(filePath);
  const journalMode = String(db.prepare('PRAGMA journal_mode = WAL').get().journal_mode || '').toLowerCase();
  if (journalMode !== 'wal' && filePath !== ':memory:') {
    db.close();
    throw new Error(`Mobile sync SQLite WAL mode unavailable: ${journalMode || 'unknown'}`);
  }
  db.exec('PRAGMA synchronous = FULL');
  initializeSchema(db);
  const synchronousMode = Number(db.prepare('PRAGMA synchronous').get().synchronous);
  if (synchronousMode !== 2) {
    db.close();
    throw new Error(`Mobile sync SQLite FULL synchronous mode unavailable: ${synchronousMode}`);
  }

  const pendingClassifications = new Map();
  const transactionHistory = [];
  let closed = false;

  const eventSelect = `
    SELECT e.row_order, e.device_id, e.event_type, e.event_id, e.event_time, e.attempt,
      e.received_at, e.payload_json, e.batch_id, e.sent_at,
      bd.status AS business_status, bd.updated_at AS business_updated_at,
      bd.reason_code AS business_reason_code,
      nc.status AS classification_status, nc.app_identity_json,
      nc.semantic_category, nc.confidence, nc.classification_source, nc.model_id,
      nc.processed_at, nc.classification_version, nc.reason_code AS classification_reason_code
    FROM mobile_events e
    LEFT JOIN business_delivery bd
      ON bd.device_id = e.device_id AND bd.event_type = e.event_type AND bd.event_id = e.event_id
    LEFT JOIN notification_classification nc
      ON nc.device_id = e.device_id AND nc.event_type = e.event_type AND nc.event_id = e.event_id`;

  const statements = {
    eventByIdentity: db.prepare(`${eventSelect}
      WHERE e.device_id = ? AND e.event_type = ? AND e.event_id = ?`),
    allEvents: db.prepare(`${eventSelect} ORDER BY e.row_order`),
    eventsByType: db.prepare(`${eventSelect} WHERE e.event_type = ? ORDER BY e.row_order`),
    rawEvents: db.prepare(`${eventSelect} WHERE e.event_type = 'RAW_NOTIFICATION' ORDER BY e.row_order`),
    pendingRawEvents: db.prepare(`${eventSelect}
      WHERE e.event_type = 'RAW_NOTIFICATION' AND nc.status IN ('PENDING', 'AI_PENDING', 'RETRY_PENDING')
      ORDER BY e.sequence_number, e.row_order`),
    pendingParsedEvents: db.prepare(`${eventSelect}
      WHERE e.event_type = 'PARSED_TRANSACTION' AND bd.status IN ('PENDING', 'RETRY_PENDING')
      ORDER BY e.row_order`),
    insertEvent: db.prepare(`INSERT INTO mobile_events (
      device_id, event_type, event_id, event_time, attempt, received_at, payload_json,
      batch_id, sent_at, source_package, posted_at, sequence_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    upsertBatch: db.prepare(`INSERT INTO mobile_batches (device_id, batch_id, sent_at, received_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (device_id, batch_id) DO UPDATE SET
        sent_at = excluded.sent_at, received_at = excluded.received_at`),
    insertBatchEvent: db.prepare(`INSERT INTO mobile_batch_events (
      device_id, batch_id, event_type, event_id, event_order
    ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (device_id, batch_id, event_type, event_id) DO NOTHING`),
    insertBusiness: db.prepare(`INSERT INTO business_delivery (
      device_id, event_type, event_id, status, updated_at, reason_code
    ) VALUES (?, ?, ?, ?, ?, ?)`),
    insertClassification: db.prepare(`INSERT INTO notification_classification (
      device_id, event_type, event_id, status, app_identity_json, semantic_category,
      confidence, classification_source, model_id, processed_at, classification_version, reason_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateClassification: db.prepare(`UPDATE notification_classification SET
      status = ?, app_identity_json = ?, semantic_category = ?, confidence = ?,
      classification_source = ?, model_id = ?, processed_at = ?, classification_version = ?, reason_code = ?
      WHERE device_id = ? AND event_type = ? AND event_id = ?`),
    updateBusiness: db.prepare(`UPDATE business_delivery SET status = ?, updated_at = ?, reason_code = ?
      WHERE device_id = ? AND event_type = ? AND event_id = ?`),
    statusByDevice: db.prepare(`SELECT device_id, captured_at_epoch_ms, snapshot_fingerprint, snapshot_json
      FROM mobile_status WHERE device_id = ?`),
    upsertStatus: db.prepare(`INSERT INTO mobile_status (
      device_id, captured_at_epoch_ms, snapshot_fingerprint, snapshot_json
    ) VALUES (?, ?, ?, ?)
      ON CONFLICT (device_id) DO UPDATE SET
        captured_at_epoch_ms = excluded.captured_at_epoch_ms,
        snapshot_fingerprint = excluded.snapshot_fingerprint,
        snapshot_json = excluded.snapshot_json`),
    batchByIdentity: db.prepare(`SELECT device_id, batch_id, sent_at, received_at
      FROM mobile_batches WHERE device_id = ? AND batch_id = ?`),
    batchEvents: db.prepare(`SELECT event_type, event_id FROM mobile_batch_events
      WHERE device_id = ? AND batch_id = ? ORDER BY event_order`),
    metadata: db.prepare('SELECT value_json FROM mobile_store_metadata WHERE key = ?'),
    upsertMetadata: db.prepare(`INSERT INTO mobile_store_metadata (key, value_json) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`),
    countEvents: db.prepare('SELECT COUNT(*) AS count FROM mobile_events'),
    countBatches: db.prepare('SELECT COUNT(*) AS count FROM mobile_batches'),
    countStatuses: db.prepare('SELECT COUNT(*) AS count FROM mobile_status')
  };

  function assertOpen() {
    if (closed) throw new Error('Mobile sync SQLite store is closed');
  }

  function injectFault(stage, context) {
    if (typeof faultInjector === 'function') faultInjector(stage, context);
  }

  function runTransaction(kind, work, context = {}) {
    assertOpen();
    injectFault('before_transaction', { kind, ...context });
    const started = performance.now();
    let committed = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      injectFault('mid_transaction', { kind, ...context });
      db.exec('COMMIT');
      committed = true;
      const measurement = Object.freeze({ kind, duration_ms: performance.now() - started, ...context });
      transactionHistory.push(measurement);
      if (transactionHistory.length > 1000) transactionHistory.shift();
      if (typeof onTransaction === 'function') onTransaction(measurement);
      injectFault('after_commit_before_response', { kind, ...context });
      return result;
    } catch (error) {
      if (!committed) {
        try { db.exec('ROLLBACK'); } catch (_) {}
      }
      throw error;
    }
  }

  function classificationFromRow(row) {
    if (!row || row.event_type !== 'RAW_NOTIFICATION') return null;
    const classification = {
      status: row.classification_status || 'PENDING',
      semantic_category: row.semantic_category ?? null,
      confidence: Number.isFinite(row.confidence) ? row.confidence : null,
      classification_source: row.classification_source ?? null,
      model_id: row.model_id ?? null,
      processed_at: row.processed_at ?? null,
      classification_version: row.classification_version || 'notification-semantic-v0.1',
      reason_code: row.classification_reason_code ?? null
    };
    if (row.app_identity_json !== null && row.app_identity_json !== undefined) {
      classification.app_identity = appIdentityFromJson(row.app_identity_json);
    }
    return classification;
  }

  function rowToEvent(row) {
    if (!row) return null;
    const event = {
      device_id: row.device_id,
      event_type: row.event_type,
      event_id: row.event_id,
      payload: parseJson(row.payload_json, {}),
      event_time: Number(row.event_time),
      attempt: Number(row.attempt),
      received_at: row.received_at,
      batch: { batch_id: row.batch_id, sent_at: Number(row.sent_at) },
      business_delivery: {
        status: row.business_status || (row.event_type === 'PARSED_TRANSACTION' ? 'PENDING' : 'NOT_APPLICABLE'),
        updated_at: row.business_updated_at ?? null,
        reason_code: row.business_reason_code ?? null
      }
    };
    if (row.event_type === 'RAW_NOTIFICATION') {
      const buffered = pendingClassifications.get(eventKey(row.device_id, row.event_type, row.event_id));
      event.notification_classification = buffered
        ? cloneJson(buffered)
        : classificationFromRow(row) || pendingNotificationClassification();
    }
    return event;
  }

  function getEvent(deviceId, eventType, eventId) {
    assertOpen();
    return rowToEvent(statements.eventByIdentity.get(deviceId, eventType, eventId));
  }

  function hasEvent(deviceId, eventType, eventId) {
    return Boolean(statements.eventByIdentity.get(deviceId, eventType, eventId));
  }

  function insertStoredEvent(storedEvent) {
    const payload = storedEvent.payload || {};
    statements.insertEvent.run(
      storedEvent.device_id,
      storedEvent.event_type,
      storedEvent.event_id,
      storedEvent.event_time,
      storedEvent.attempt,
      storedEvent.received_at,
      JSON.stringify(payload),
      storedEvent.batch.batch_id,
      storedEvent.batch.sent_at,
      sourcePackage(payload),
      safeInteger(payload.posted_at),
      safeInteger(payload.sequence_number)
    );
    const delivery = storedEvent.business_delivery || {
      status: storedEvent.event_type === 'PARSED_TRANSACTION' ? 'PENDING' : 'NOT_APPLICABLE',
      updated_at: null,
      reason_code: null
    };
    statements.insertBusiness.run(
      storedEvent.device_id, storedEvent.event_type, storedEvent.event_id,
      delivery.status, delivery.updated_at ?? null, delivery.reason_code ?? null
    );
    if (storedEvent.event_type === 'RAW_NOTIFICATION') {
      const classification = storedEvent.notification_classification || pendingNotificationClassification();
      statements.insertClassification.run(
        storedEvent.device_id, storedEvent.event_type, storedEvent.event_id,
        classification.status, appIdentityJson(
          classification.app_identity,
          Object.hasOwn(classification, 'app_identity')
        ),
        classification.semantic_category ?? null,
        Number.isFinite(classification.confidence) ? classification.confidence : null,
        classification.classification_source ?? null, classification.model_id ?? null,
        classification.processed_at ?? null,
        classification.classification_version || 'notification-semantic-v0.1',
        classification.reason_code ?? null
      );
    }
  }

  function statusResult(request, status, reason, fingerprint) {
    return {
      ok: true,
      result: {
        contract_version: request.contract_version,
        device_id: request.identity.device_id,
        captured_at_epoch_ms: request.captured_at_epoch_ms,
        status,
        reason,
        fingerprint
      }
    };
  }

  function receiveValidatedStatusRequest(request) {
    assertOpen();
    const deviceId = request.identity.device_id;
    const fingerprint = mobileStatusFingerprint(request);
    const current = getLatestStatus(deviceId);
    if (current) {
      if (request.captured_at_epoch_ms < current.captured_at_epoch_ms) {
        return statusResult(request, 'STALE_IGNORED', STATUS_ACK_REASONS.STALE_IGNORED, fingerprint);
      }
      if (request.captured_at_epoch_ms === current.captured_at_epoch_ms) {
        if (fingerprint === current.snapshot_fingerprint) {
          return statusResult(request, 'DUPLICATE', STATUS_ACK_REASONS.DUPLICATE, fingerprint);
        }
        return statusResult(request, 'TIMESTAMP_CONFLICT', STATUS_ACK_REASONS.TIMESTAMP_CONFLICT, fingerprint);
      }
    }
    runTransaction('status', () => {
      statements.upsertStatus.run(
        deviceId, request.captured_at_epoch_ms, fingerprint, JSON.stringify(request)
      );
    }, { device_id: deviceId });
    return statusResult(request, 'APPLIED', null, fingerprint);
  }

  function receiveStatusRequest(input) {
    const validation = validateMobileStatusRequest(input);
    if (!validation.ok) return validation;
    return receiveValidatedStatusRequest(validation.value);
  }

  function receiveValidatedRequest(request) {
    assertOpen();
    const receivedAt = now();
    const acknowledgements = [];
    const acceptedEvents = [];
    const deliveryEvents = [];
    const notificationEvents = [];

    for (const event of request.events) {
      if (event.rejection_reason) {
        acknowledgements.push(acknowledgement(event, 'REJECTED', event.rejection_reason));
        continue;
      }
      const existing = getEvent(request.device_id, event.event_type, event.event_id);
      if (existing) {
        acknowledgements.push(acknowledgement(event, 'DUPLICATE'));
        if (existing.event_type === 'PARSED_TRANSACTION' &&
            ['PENDING', 'RETRY_PENDING'].includes(existing.business_delivery?.status)) {
          deliveryEvents.push(existing);
        }
        if (existing.event_type === 'RAW_NOTIFICATION' &&
            NOTIFICATION_PENDING_STATUSES.includes(existing.notification_classification?.status)) {
          notificationEvents.push(existing);
        }
        continue;
      }
      const storedEvent = {
        device_id: request.device_id,
        event_type: event.event_type,
        event_id: event.event_id,
        payload: cloneJson(event.payload),
        event_time: event.event_time,
        attempt: event.attempt,
        received_at: receivedAt,
        batch: { batch_id: request.batch_id, sent_at: request.sent_at },
        business_delivery: {
          status: event.event_type === 'PARSED_TRANSACTION' ? 'PENDING' : 'NOT_APPLICABLE',
          updated_at: null,
          reason_code: null
        },
        ...(event.event_type === 'RAW_NOTIFICATION'
          ? { notification_classification: pendingNotificationClassification() }
          : {})
      };
      acceptedEvents.push(storedEvent);
      if (storedEvent.event_type === 'PARSED_TRANSACTION') deliveryEvents.push(cloneJson(storedEvent));
      if (storedEvent.event_type === 'RAW_NOTIFICATION') notificationEvents.push(cloneJson(storedEvent));
      acknowledgements.push(acknowledgement(event, 'ACCEPTED'));
    }

    if (acceptedEvents.length > 0) {
      runTransaction('ingress', () => {
        statements.upsertBatch.run(request.device_id, request.batch_id, request.sent_at, receivedAt);
        acceptedEvents.forEach((storedEvent, index) => {
          insertStoredEvent(storedEvent);
          statements.insertBatchEvent.run(
            request.device_id, request.batch_id, storedEvent.event_type, storedEvent.event_id, index
          );
        });
      }, { accepted_event_count: acceptedEvents.length, batch_id: request.batch_id });
    }

    return { ok: true, result: { acknowledgements, delivery_events: deliveryEvents, notification_events: notificationEvents } };
  }

  function receiveRequest(input) {
    const validation = validateMobileSyncRequest(input);
    if (!validation.ok) return validation;
    return receiveValidatedRequest(validation.value);
  }

  function listEvents() {
    assertOpen();
    return statements.allEvents.all().map(rowToEvent);
  }

  function *iterateEvents({ eventType = '' } = {}) {
    assertOpen();
    const iterator = eventType ? statements.eventsByType.iterate(eventType) : statements.allEvents.iterate();
    for (const row of iterator) yield rowToEvent(row);
  }

  function listPendingBusinessEvents() {
    assertOpen();
    return statements.pendingParsedEvents.all().map(rowToEvent);
  }

  function listPendingNotificationEvents({ limit = Number.MAX_SAFE_INTEGER, offset = 0 } = {}) {
    assertOpen();
    const boundedLimit = Number.isSafeInteger(limit) && limit >= 0 ? limit : Number.MAX_SAFE_INTEGER;
    const boundedOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const rows = boundedLimit === Number.MAX_SAFE_INTEGER && boundedOffset === 0
      ? statements.pendingRawEvents.all()
      : db.prepare(`${eventSelect}
        WHERE e.event_type = 'RAW_NOTIFICATION' AND nc.status IN ('PENDING', 'AI_PENDING', 'RETRY_PENDING')
        ORDER BY e.sequence_number, e.row_order LIMIT ? OFFSET ?`).all(boundedLimit, boundedOffset);
    const pending = rows
      .map(rowToEvent)
      .filter((event) => NOTIFICATION_PENDING_STATUSES.includes(event.notification_classification?.status));
    const identities = new Set(pending.map(identityKey));
    for (const [key, classification] of pendingClassifications) {
      if (!NOTIFICATION_PENDING_STATUSES.includes(classification.status) || identities.has(key)) continue;
      const [deviceId, eventType, eventId] = JSON.parse(key);
      const event = getEvent(deviceId, eventType, eventId);
      if (event) pending.push(event);
    }
    return pending.sort((left, right) =>
      Number(left.payload?.sequence_number || 0) - Number(right.payload?.sequence_number || 0))
      .slice(0, boundedLimit);
  }

  function normalizedClassification(classification) {
    const status = String(classification?.status || 'CLASSIFIED');
    if (![...NOTIFICATION_TERMINAL_STATUSES, 'AI_PENDING', 'RETRY_PENDING'].includes(status)) {
      throw new Error(`Unsupported notification classification status: ${status}`);
    }
    return {
      status,
      app_identity: classification?.app_identity || null,
      semantic_category: classification?.semantic_category || null,
      confidence: Number.isFinite(classification?.confidence) ? classification.confidence : null,
      classification_source: classification?.classification_source || null,
      model_id: classification?.model_id || null,
      processed_at: now(),
      classification_version: classification?.classification_version || 'notification-semantic-v0.1',
      reason_code: typeof classification?.reason_code === 'string' ? classification.reason_code.slice(0, 64) : null
    };
  }

  function persistClassification(event, classification) {
    const result = statements.updateClassification.run(
      classification.status, appIdentityJson(classification.app_identity),
      classification.semantic_category, classification.confidence,
      classification.classification_source, classification.model_id,
      classification.processed_at, classification.classification_version, classification.reason_code,
      event.device_id, event.event_type, event.event_id
    );
    if (Number(result.changes) !== 1) throw new Error('Mobile notification event was not found');
  }

  function markNotificationClassification(event, classification, options = {}) {
    const stored = getEvent(event?.device_id, event?.event_type, event?.event_id);
    if (!stored || stored.event_type !== 'RAW_NOTIFICATION') throw new Error('Mobile notification event was not found');
    const normalized = normalizedClassification(classification);
    const key = eventKey(event.device_id, event.event_type, event.event_id);
    if (options.persist === false) {
      pendingClassifications.set(key, normalized);
    } else {
      runTransaction('classification', () => persistClassification(event, normalized), { update_count: 1 });
      pendingClassifications.delete(key);
    }
    return cloneJson(normalized);
  }

  function flush() {
    if (pendingClassifications.size === 0) return false;
    const entries = [...pendingClassifications.entries()];
    runTransaction('classification_flush', () => {
      for (const [key, classification] of entries) {
        const [deviceId, eventType, eventId] = JSON.parse(key);
        persistClassification({ device_id: deviceId, event_type: eventType, event_id: eventId }, classification);
      }
    }, { update_count: entries.length });
    for (const [key, classification] of entries) {
      if (pendingClassifications.get(key) === classification) pendingClassifications.delete(key);
    }
    return true;
  }

  function queryNotificationArchive({
    packageName, appIdentity, semanticCategory, deviceId, date,
    timezone = 'Asia/Shanghai', startAt, endAt
  } = {}) {
    const start = startAt ? Date.parse(startAt) : Number.NEGATIVE_INFINITY;
    const end = endAt ? Date.parse(endAt) : Number.POSITIVE_INFINITY;
    const clauses = ["e.event_type = 'RAW_NOTIFICATION'"];
    const parameters = [];
    if (deviceId) {
      clauses.push('e.device_id = ?');
      parameters.push(deviceId);
    }
    if (packageName) {
      clauses.push('e.source_package = ?');
      parameters.push(packageName);
    }
    if (Number.isFinite(start)) {
      clauses.push('COALESCE(e.posted_at, e.event_time) >= ?');
      parameters.push(start);
    }
    if (Number.isFinite(end)) {
      clauses.push('COALESCE(e.posted_at, e.event_time) <= ?');
      parameters.push(end);
    }
    const classificationBuffered = pendingClassifications.size > 0;
    if (appIdentity && !classificationBuffered) {
      clauses.push('nc.app_identity_json = ?');
      parameters.push(appIdentityJson(appIdentity));
    }
    if (semanticCategory && !classificationBuffered) {
      clauses.push('nc.semantic_category = ?');
      parameters.push(semanticCategory);
    }
    return db.prepare(`${eventSelect} WHERE ${clauses.join(' AND ')}
      ORDER BY COALESCE(e.posted_at, e.event_time) DESC, e.row_order DESC`).all(...parameters)
      .map(rowToEvent)
      .filter((event) => {
        const payload = event.payload || {};
        const occurred = Number(payload.posted_at || event.event_time);
        const localDate = Number.isFinite(occurred)
          ? new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
          }).format(new Date(occurred))
          : '';
        if (appIdentity && event.notification_classification?.app_identity !== appIdentity) return false;
        if (semanticCategory && event.notification_classification?.semantic_category !== semanticCategory) return false;
        if (date && localDate !== date) return false;
        return true;
      });
  }

  function markBusinessEventDelivery(event, status, reasonCode = null) {
    if (!BUSINESS_DELIVERY_STATUSES.includes(status)) {
      throw new Error(`Unsupported mobile business delivery status: ${String(status)}`);
    }
    const stored = getEvent(event?.device_id, event?.event_type, event?.event_id);
    if (!stored) throw new Error('Mobile business event was not found');
    const delivery = {
      status,
      updated_at: now(),
      reason_code: typeof reasonCode === 'string' ? reasonCode.slice(0, 64) : null
    };
    runTransaction('business_delivery', () => {
      const result = statements.updateBusiness.run(
        delivery.status, delivery.updated_at, delivery.reason_code,
        event.device_id, event.event_type, event.event_id
      );
      if (Number(result.changes) !== 1) throw new Error('Mobile business event was not found');
    }, { update_count: 1 });
    return cloneJson(delivery);
  }

  function getLatestStatus(deviceId) {
    assertOpen();
    const row = statements.statusByDevice.get(deviceId);
    if (!row) return null;
    return {
      captured_at_epoch_ms: Number(row.captured_at_epoch_ms),
      snapshot_fingerprint: row.snapshot_fingerprint,
      snapshot: parseJson(row.snapshot_json, {})
    };
  }

  function getLedgerReconciliation(deviceId) {
    const status = getLatestStatus(deviceId);
    const mobile = status?.snapshot?.ledger || null;
    const row = db.prepare(`SELECT COUNT(*) AS total_event_count,
      MAX(sequence_number) AS latest_sequence_number FROM mobile_events
      WHERE device_id = ? AND event_type = 'RAW_NOTIFICATION'`).get(deviceId);
    const head = db.prepare(`SELECT sequence_number, posted_at, received_at FROM mobile_events
      WHERE device_id = ? AND event_type = 'RAW_NOTIFICATION'
      ORDER BY COALESCE(sequence_number, -1) DESC, COALESCE(posted_at, -1) DESC LIMIT 1`).get(deviceId);
    const pc = {
      total_event_count: Number(row.total_event_count),
      latest_sequence_number: head?.sequence_number === null || head?.sequence_number === undefined
        ? null : Number(head.sequence_number),
      latest_posted_at_epoch_ms: head?.posted_at === null || head?.posted_at === undefined
        ? null : Number(head.posted_at),
      latest_received_at: head?.received_at || null
    };
    let comparison = 'UNKNOWN';
    let reason = 'MOBILE_LEDGER_STATUS_UNAVAILABLE';
    if (mobile) {
      const mobileTotal = mobile.total_event_count;
      const mobileSequence = mobile.latest_sequence_number;
      const mobilePostedAt = mobile.latest_posted_at_epoch_ms;
      if (!(mobileTotal === 0 || mobileSequence !== null)) {
        reason = 'MOBILE_HEAD_SEQUENCE_UNAVAILABLE';
      } else if (mobileTotal > pc.total_event_count ||
        (mobileSequence !== null && (pc.latest_sequence_number === null || mobileSequence > pc.latest_sequence_number)) ||
        (mobilePostedAt !== null && pc.latest_posted_at_epoch_ms !== null && mobilePostedAt > pc.latest_posted_at_epoch_ms)) {
        comparison = 'MOBILE_AHEAD';
        reason = 'MOBILE_LEDGER_HAS_UNACCEPTED_EVENTS';
      } else if (pc.total_event_count > mobileTotal ||
        (pc.latest_sequence_number !== null && (mobileSequence === null || pc.latest_sequence_number > mobileSequence)) ||
        (pc.latest_posted_at_epoch_ms !== null && mobilePostedAt !== null && pc.latest_posted_at_epoch_ms > mobilePostedAt)) {
        comparison = 'PC_AHEAD_INVALID';
        reason = 'PC_LEDGER_EXCEEDS_MOBILE_SOURCE_LEDGER';
      } else {
        comparison = 'IN_SYNC';
        reason = 'LEDGER_HEADS_MATCH';
      }
    }
    return Object.freeze({
      comparison,
      reason,
      difference_count: mobile ? mobile.total_event_count - pc.total_event_count : null,
      mobile: mobile ? Object.freeze(cloneJson(mobile)) : null,
      pc: Object.freeze(pc)
    });
  }

  function pipelineEventDate(event, timezone) {
    const occurred = Number(event?.payload?.posted_at || event?.event_time);
    if (!Number.isFinite(occurred)) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(occurred));
  }

  function getPipelineDiagnostics({ date = '', timezone = 'Asia/Shanghai' } = {}) {
    const events = listEvents().filter((event) => !date || pipelineEventDate(event, timezone) === date);
    const notifications = events.filter((event) => event.event_type === 'RAW_NOTIFICATION');
    const transactions = events.filter((event) => event.event_type === 'PARSED_TRANSACTION');
    const classified = notifications.filter((event) => NOTIFICATION_TERMINAL_STATUSES.includes(event.notification_classification?.status));
    const classificationPending = notifications.filter((event) => NOTIFICATION_PENDING_STATUSES.includes(event.notification_classification?.status));
    const classificationFailed = notifications.filter((event) => event.notification_classification?.status === 'RETRY_PENDING');
    const delivered = transactions.filter((event) => ['DRAFTED', 'IMPORTED', 'IGNORED'].includes(event.business_delivery?.status));
    const deliveryPending = transactions.filter((event) => ['PENDING', 'RETRY_PENDING'].includes(event.business_delivery?.status));
    const deliveryFailed = transactions.filter((event) => event.business_delivery?.status === 'RETRY_PENDING');
    const newest = (items, selector) => items.reduce((latest, item) => {
      const value = selector(item);
      const comparable = typeof value === 'number' ? value : Date.parse(value);
      return Number.isFinite(comparable) && comparable > latest.comparable ? { value, comparable, item } : latest;
    }, { value: null, comparable: Number.NEGATIVE_INFINITY, item: null });
    const phoneEvent = newest(events, (event) => Number(event?.payload?.posted_at || event?.event_time));
    const pcReceive = newest(events, (event) => event.received_at);
    const classification = newest(notifications, (event) => event.notification_classification?.processed_at);
    const business = newest(transactions, (event) => event.business_delivery?.updated_at);
    const evidence = pcReceive.item || phoneEvent.item;
    const firstIncompleteStage = events.length === 0 ? 'PC_RECEIVE'
      : classificationPending.length > 0 ? 'CLASSIFICATION'
        : deliveryPending.length > 0 ? 'BUSINESS_DELIVERY' : null;
    return Object.freeze({
      scope: Object.freeze({ date: date || null, timezone }),
      latest_event_time_epoch_ms: phoneEvent.value,
      latest_pc_received_at: pcReceive.value,
      latest_classification_at: classification.value,
      latest_business_delivery_at: business.value,
      latest_evidence: evidence ? Object.freeze({
        event_id: String(evidence.event_id || '').slice(0, 160),
        batch_id: String(evidence.batch?.batch_id || '').slice(0, 160) || null,
        attempt_id: Number.isInteger(evidence.attempt) ? evidence.attempt : null
      }) : null,
      first_incomplete_stage: firstIncompleteStage,
      clock_semantics: 'PHONE_EVENT_AND_PC_STAGE_TIMES_REPORTED_SEPARATELY',
      stages: Object.freeze([
        Object.freeze({ stage: 'PHONE_LOCAL_QUEUE', passed_count: null, rejected_count: null, pending_count: null, latest_success_at: phoneEvent.value }),
        Object.freeze({ stage: 'PC_RECEIVE', passed_count: events.length, rejected_count: null, pending_count: null, latest_success_at: pcReceive.value }),
        Object.freeze({ stage: 'ACK_PREPARED', passed_count: events.length, rejected_count: null, pending_count: null, latest_success_at: pcReceive.value }),
        Object.freeze({ stage: 'CLASSIFICATION', passed_count: classified.length, rejected_count: classificationFailed.length, pending_count: classificationPending.length, latest_success_at: classification.value }),
        Object.freeze({ stage: 'CONSUMPTION_PARSE', passed_count: transactions.length, rejected_count: null, pending_count: null, latest_success_at: phoneEvent.value }),
        Object.freeze({ stage: 'BUSINESS_DELIVERY', passed_count: delivered.length, rejected_count: deliveryFailed.length, pending_count: deliveryPending.length, latest_success_at: business.value }),
        Object.freeze({ stage: 'HOME_REFRESH', passed_count: null, rejected_count: null, pending_count: null, latest_success_at: null })
      ]),
      ledgers: Object.freeze({
        notification_event_count: notifications.length,
        transaction_event_count: transactions.length,
        imported_expense_count: transactions.filter((event) => event.business_delivery?.status === 'IMPORTED').length
      }),
      evidence_gaps: Object.freeze([
        'phone_queue_counts_require_current_mobile_status',
        'rejected_and_duplicate_ack_counts_are_not_persisted_in_v3_store',
        'renderer_home_refresh_ack_not_available'
      ])
    });
  }

  function metadataValue(key, fallback = null) {
    const row = statements.metadata.get(key);
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  function getState() {
    assertOpen();
    const counts = db.prepare(`SELECT
      COUNT(*) AS event_count,
      SUM(CASE WHEN e.event_type = 'RAW_NOTIFICATION' THEN 1 ELSE 0 END) AS raw_count,
      SUM(CASE WHEN e.event_type = 'PARSED_TRANSACTION' AND bd.status IN ('PENDING', 'RETRY_PENDING') THEN 1 ELSE 0 END) AS pending_business,
      SUM(CASE WHEN e.event_type = 'PARSED_TRANSACTION' AND bd.status IN ('PENDING', 'DRAFTED', 'RETRY_PENDING') THEN 1 ELSE 0 END) AS pending_expense,
      SUM(CASE WHEN e.event_type = 'PARSED_TRANSACTION' AND bd.status = 'IMPORTED' THEN 1 ELSE 0 END) AS imported,
      SUM(CASE WHEN e.event_type = 'RAW_NOTIFICATION' AND nc.status IN ('PENDING', 'AI_PENDING', 'RETRY_PENDING') THEN 1 ELSE 0 END) AS pending_notification
      FROM mobile_events e
      LEFT JOIN business_delivery bd ON bd.device_id=e.device_id AND bd.event_type=e.event_type AND bd.event_id=e.event_id
      LEFT JOIN notification_classification nc ON nc.device_id=e.device_id AND nc.event_type=e.event_type AND nc.event_id=e.event_id`).get();
    const legacy = metadataValue('legacy', null);
    const pendingOverlayDelta = [...pendingClassifications.entries()].reduce((delta, [key, value]) => {
      const [deviceId, eventType, eventId] = JSON.parse(key);
      const persisted = classificationFromRow(statements.eventByIdentity.get(deviceId, eventType, eventId));
      const wasPending = NOTIFICATION_PENDING_STATUSES.includes(persisted?.status);
      const isPending = NOTIFICATION_PENDING_STATUSES.includes(value.status);
      return delta + Number(isPending) - Number(wasPending);
    }, 0);
    return {
      version: MOBILE_SYNC_STORE_VERSION,
      batch_count: Number(statements.countBatches.get().count),
      event_count: Number(counts.event_count),
      pending_business_event_count: Number(counts.pending_business || 0),
      pending_expense_draft_count: Number(counts.pending_expense || 0),
      auto_posted_count: Number(counts.imported || 0),
      pending_notification_classification_count: Number(counts.pending_notification || 0) + pendingOverlayDelta,
      acked_notification_count: Number(counts.raw_count || 0),
      pipeline_diagnostics: getPipelineDiagnostics(),
      status_count: Number(statements.countStatuses.get().count),
      legacy: {
        present: Boolean(legacy),
        disposition: legacy?.disposition || null,
        event_count: legacy?.events && typeof legacy.events === 'object' ? Object.keys(legacy.events).length : 0,
        batch_count: legacy?.batches && typeof legacy.batches === 'object' ? Object.keys(legacy.batches).length : 0
      }
    };
  }

  function getBatch(deviceId, batchId) {
    const row = statements.batchByIdentity.get(deviceId, batchId);
    if (!row) return null;
    return {
      device_id: row.device_id,
      batch_id: row.batch_id,
      sent_at: Number(row.sent_at),
      received_at: row.received_at,
      accepted_event_identities: statements.batchEvents.all(deviceId, batchId).map((item) => ({
        event_type: item.event_type,
        event_id: item.event_id
      }))
    };
  }

  function getMigrationSummary() {
    const eventTypes = Object.fromEntries(db.prepare(`SELECT event_type, COUNT(*) AS count
      FROM mobile_events GROUP BY event_type`).all().map((row) => [row.event_type, Number(row.count)]));
    const classifications = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS count
      FROM notification_classification GROUP BY status`).all().map((row) => [row.status, Number(row.count)]));
    const deliveries = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS count
      FROM business_delivery GROUP BY status`).all().map((row) => [row.status, Number(row.count)]));
    const ranges = db.prepare(`SELECT MIN(event_time) AS min_event_time, MAX(event_time) AS max_event_time,
      MIN(posted_at) AS min_posted_at, MAX(posted_at) AS max_posted_at,
      SUM(CASE WHEN event_type='RAW_NOTIFICATION' AND posted_at IS NOT NULL THEN 1 ELSE 0 END) AS posted_at_count
      FROM mobile_events`).get();
    const latestNotification = db.prepare(`SELECT device_id, event_type, event_id FROM mobile_events
      WHERE event_type='RAW_NOTIFICATION'
      ORDER BY posted_at DESC, event_time DESC, row_order DESC LIMIT 1`).get() || null;
    const latestStatus = db.prepare(`SELECT device_id, captured_at_epoch_ms FROM mobile_status
      ORDER BY captured_at_epoch_ms DESC, device_id ASC LIMIT 1`).get() || null;
    return {
      migration_state: metadataValue('migration_state', null),
      total_events: Number(statements.countEvents.get().count),
      unique_identities: Number(statements.countEvents.get().count),
      batch_count: Number(statements.countBatches.get().count),
      status_device_count: Number(statements.countStatuses.get().count),
      event_types: eventTypes,
      classification_statuses: classifications,
      business_delivery_statuses: deliveries,
      min_event_time: ranges.min_event_time === null ? null : Number(ranges.min_event_time),
      max_event_time: ranges.max_event_time === null ? null : Number(ranges.max_event_time),
      min_posted_at: ranges.min_posted_at === null ? null : Number(ranges.min_posted_at),
      max_posted_at: ranges.max_posted_at === null ? null : Number(ranges.max_posted_at),
      posted_at_count: Number(ranges.posted_at_count || 0),
      latest_notification_identity: latestNotification,
      latest_status: latestStatus ? {
        device_id: latestStatus.device_id,
        captured_at_epoch_ms: Number(latestStatus.captured_at_epoch_ms)
      } : null
    };
  }

  function getStorageDiagnostics() {
    assertOpen();
    const databaseSize = filePath === ':memory:' || !fs.existsSync(filePath) ? 0 : fs.statSync(filePath).size;
    const walPath = `${filePath}-wal`;
    return {
      implementation: 'node:sqlite DatabaseSync',
      schema_version: SQLITE_STORE_SCHEMA_VERSION,
      journal_mode: journalMode,
      synchronous_mode: synchronousMode,
      database_size_bytes: databaseSize,
      wal_size_bytes: filePath === ':memory:' || !fs.existsSync(walPath) ? 0 : fs.statSync(walPath).size,
      pending_classification_updates: pendingClassifications.size,
      last_transaction: transactionHistory.at(-1) || null,
      transaction_count: transactionHistory.length
    };
  }

  function checkpoint(mode = 'PASSIVE') {
    const normalized = String(mode).toUpperCase();
    if (!['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'].includes(normalized)) {
      throw new Error(`Unsupported WAL checkpoint mode: ${normalized}`);
    }
    return db.prepare(`PRAGMA wal_checkpoint(${normalized})`).get();
  }

  function importDocument(document, { batchSize = 500 } = {}) {
    assertOpen();
    if (!document || typeof document !== 'object') throw new Error('Mobile sync migration document is required');
    if (Number(statements.countEvents.get().count) !== 0 || Number(statements.countBatches.get().count) !== 0 ||
        Number(statements.countStatuses.get().count) !== 0) {
      throw new Error('Mobile sync SQLite migration target must be empty');
    }
    const boundedBatchSize = Math.max(1, Math.min(5000, Number(batchSize) || 500));
    const batches = Object.values(document.batches || {});
    const events = Object.values(document.events || {});
    const statuses = Object.entries(document.latest_status_by_device || {});
    runTransaction('migration_start', () => {
      statements.upsertMetadata.run('migration_state', JSON.stringify('IN_PROGRESS'));
      statements.upsertMetadata.run('source_store_version', JSON.stringify(document.version));
      if (document.legacy) statements.upsertMetadata.run('legacy', JSON.stringify(document.legacy));
    });
    for (let offset = 0; offset < batches.length; offset += boundedBatchSize) {
      const chunk = batches.slice(offset, offset + boundedBatchSize);
      runTransaction('migration_batches', () => {
        for (const batch of chunk) {
          statements.upsertBatch.run(batch.device_id, batch.batch_id, batch.sent_at, batch.received_at);
        }
      }, { row_count: chunk.length });
    }
    for (let offset = 0; offset < events.length; offset += boundedBatchSize) {
      const chunk = events.slice(offset, offset + boundedBatchSize);
      runTransaction('migration_events', () => {
        for (const event of chunk) insertStoredEvent(event);
      }, { row_count: chunk.length });
    }
    for (let offset = 0; offset < batches.length; offset += boundedBatchSize) {
      const chunk = batches.slice(offset, offset + boundedBatchSize);
      runTransaction('migration_batch_events', () => {
        for (const batch of chunk) {
          (batch.accepted_event_identities || []).forEach((identity, index) => {
            statements.insertBatchEvent.run(
              batch.device_id, batch.batch_id, identity.event_type, identity.event_id, index
            );
          });
        }
      }, { row_count: chunk.length });
    }
    for (let offset = 0; offset < statuses.length; offset += boundedBatchSize) {
      const chunk = statuses.slice(offset, offset + boundedBatchSize);
      runTransaction('migration_statuses', () => {
        for (const [deviceId, status] of chunk) {
          statements.upsertStatus.run(
            deviceId, status.captured_at_epoch_ms, status.snapshot_fingerprint, JSON.stringify(status.snapshot)
          );
        }
      }, { row_count: chunk.length });
    }
    runTransaction('migration_complete', () => {
      statements.upsertMetadata.run('migration_state', JSON.stringify('COMPLETE'));
    });
    return getMigrationSummary();
  }

  function close() {
    if (closed) return;
    flush();
    db.close();
    closed = true;
  }

  return {
    checkpoint,
    close,
    flush,
    getBatch,
    getEvent,
    getLatestStatus,
    getLedgerReconciliation,
    getMigrationSummary,
    getPipelineDiagnostics,
    getState,
    getStorageDiagnostics,
    hasEvent,
    importDocument,
    iterateEvents,
    listEvents,
    listPendingBusinessEvents,
    listPendingNotificationEvents,
    markBusinessEventDelivery,
    markNotificationClassification,
    queryNotificationArchive,
    receiveRequest,
    receiveStatusRequest,
    receiveValidatedRequest,
    receiveValidatedStatusRequest
  };
}

module.exports = {
  SQLITE_STORE_SCHEMA_VERSION,
  createMobileSyncSqliteStore
};
