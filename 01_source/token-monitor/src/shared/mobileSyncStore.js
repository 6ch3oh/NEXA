'use strict';

const { readJson, writeJsonAtomic } = require('./config');
const {
  STATUS_ACK_REASONS,
  mobileStatusFingerprint,
  validateMobileStatusRequest,
  validateMobileSyncRequest
} = require('./mobileSyncProtocol');

const MOBILE_SYNC_STORE_VERSION = 3;
const LEGACY_STORE_VERSION = 1;
const PREVIOUS_STORE_VERSION = 2;
const BUSINESS_DELIVERY_STATUSES = Object.freeze([
  'PENDING', 'DRAFTED', 'IMPORTED', 'RETRY_PENDING', 'IGNORED', 'NOT_APPLICABLE'
]);
const MOBILE_SYNC_STORAGE_MODES = Object.freeze({
  JSON_LEGACY: 'JSON_LEGACY',
  SQLITE_V0_1: 'SQLITE_V0_1'
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyDocument() {
  return {
    version: MOBILE_SYNC_STORE_VERSION,
    batches: {},
    events: {},
    latest_status_by_device: {},
    legacy: null
  };
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

function legacyNotificationClassification(event) {
  const packageName = String(event?.payload?.package_name || event?.payload?.source_package || '');
  const appIdentity = packageName === 'com.tencent.mm' ? 'wechat'
    : packageName === 'com.eg.android.AlipayGphone' ? 'alipay'
      : packageName === 'com.taobao.idlefish' ? 'xianyu'
        : /(?:icbc|ccb|cmb|abchina|bankcomm|boc|psbc|spdb|cib|citic|pingan)/iu.test(packageName) ? 'bank' : 'other';
  return {
    status: 'CLASSIFIED', app_identity: appIdentity, semantic_category: 'other', confidence: 0,
    classification_source: 'legacy_archive', model_id: null,
    processed_at: event?.received_at || null, classification_version: 'notification-semantic-v0.1', reason_code: null
  };
}

function legacySnapshot(value) {
  const batches = isPlainObject(value.batches) ? cloneJson(value.batches) : {};
  const events = isPlainObject(value.events) ? cloneJson(value.events) : {};
  return {
    source_version: LEGACY_STORE_VERSION,
    disposition: 'IDENTITY_UNMAPPABLE_ISOLATED',
    reason: 'Legacy records do not carry device_id and event_type',
    batches,
    events
  };
}

function normalizeDocument(value) {
  if (!isPlainObject(value)) return emptyDocument();
  if (value.version === LEGACY_STORE_VERSION) {
    return { ...emptyDocument(), legacy: legacySnapshot(value) };
  }
  if (value.version !== PREVIOUS_STORE_VERSION && value.version !== MOBILE_SYNC_STORE_VERSION) {
    throw new Error(`Unsupported mobile sync store version: ${String(value.version)}`);
  }
  const migratedFromPrevious = value.version === PREVIOUS_STORE_VERSION;
  const events = isPlainObject(value.events) ? cloneJson(value.events) : {};
  for (const event of Object.values(events)) {
    if (!isPlainObject(event)) continue;
    if (!isPlainObject(event.business_delivery)) {
      event.business_delivery = {
        status: event.event_type === 'PARSED_TRANSACTION' ? 'PENDING' : 'NOT_APPLICABLE',
        updated_at: null,
        reason_code: null
      };
    }
    if (event.event_type === 'RAW_NOTIFICATION' && !isPlainObject(event.notification_classification)) {
      event.notification_classification = migratedFromPrevious
        ? legacyNotificationClassification(event)
        : pendingNotificationClassification();
    }
  }
  return {
    version: MOBILE_SYNC_STORE_VERSION,
    batches: isPlainObject(value.batches) ? cloneJson(value.batches) : {},
    events,
    latest_status_by_device: isPlainObject(value.latest_status_by_device)
      ? cloneJson(value.latest_status_by_device)
      : {},
    legacy: isPlainObject(value.legacy) ? cloneJson(value.legacy) : null
  };
}

function eventKey(deviceId, eventType, eventId) {
  return JSON.stringify([deviceId, eventType, eventId]);
}

function batchKey(deviceId, batchId) {
  return JSON.stringify([deviceId, batchId]);
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

function createMobileSyncStore(options = {}) {
  const storageMode = options.storageMode || MOBILE_SYNC_STORAGE_MODES.JSON_LEGACY;
  if (storageMode === MOBILE_SYNC_STORAGE_MODES.SQLITE_V0_1) {
    const { createMobileSyncSqliteStore } = require('./mobileSyncSqliteStore');
    return createMobileSyncSqliteStore(options);
  }
  if (storageMode !== MOBILE_SYNC_STORAGE_MODES.JSON_LEGACY) {
    throw new Error(`Unsupported mobile sync storage mode: ${String(storageMode)}`);
  }
  const {
    filePath,
    readStoreJson = readJson,
    writeStoreJsonAtomic = writeJsonAtomic,
    now = () => new Date().toISOString()
  } = options;
  if (!filePath) throw new Error('mobile sync store filePath is required');
  const loadedDocument = readStoreJson(filePath, null);
  let document = normalizeDocument(loadedDocument);
  let dirty = isPlainObject(loadedDocument) && loadedDocument.version === PREVIOUS_STORE_VERSION;

  function persist() {
    if (!dirty) return false;
    document.version = MOBILE_SYNC_STORE_VERSION;
    writeStoreJsonAtomic(filePath, document);
    dirty = false;
    return true;
  }
  if (isPlainObject(loadedDocument) && loadedDocument.version === PREVIOUS_STORE_VERSION) persist();

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
    const deviceId = request.identity.device_id;
    const fingerprint = mobileStatusFingerprint(request);
    const current = document.latest_status_by_device[deviceId] || null;

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

    const nextDocument = {
      ...document,
      version: MOBILE_SYNC_STORE_VERSION,
      latest_status_by_device: {
        ...document.latest_status_by_device,
        [deviceId]: {
          captured_at_epoch_ms: request.captured_at_epoch_ms,
          snapshot_fingerprint: fingerprint,
          snapshot: cloneJson(request)
        }
      }
    };
    writeStoreJsonAtomic(filePath, nextDocument);
    document = nextDocument;
    dirty = false;
    return statusResult(request, 'APPLIED', null, fingerprint);
  }

  function receiveStatusRequest(input) {
    const validation = validateMobileStatusRequest(input);
    if (!validation.ok) return validation;
    return receiveValidatedStatusRequest(validation.value);
  }

  function receiveValidatedRequest(request) {
    const receivedAt = now();
    const acknowledgements = [];
    const accepted = [];
    const deliveryEvents = [];
    const notificationEvents = [];

    for (const event of request.events) {
      if (event.rejection_reason) {
        acknowledgements.push(acknowledgement(event, 'REJECTED', event.rejection_reason));
        continue;
      }
      const key = eventKey(request.device_id, event.event_type, event.event_id);
      if (Object.hasOwn(document.events, key)) {
        acknowledgements.push(acknowledgement(event, 'DUPLICATE'));
        const existing = document.events[key];
        if (existing.event_type === 'PARSED_TRANSACTION' &&
            ['PENDING', 'RETRY_PENDING'].includes(existing.business_delivery?.status)) {
          deliveryEvents.push(cloneJson(existing));
        }
        if (existing.event_type === 'RAW_NOTIFICATION' &&
            ['PENDING', 'AI_PENDING', 'RETRY_PENDING'].includes(existing.notification_classification?.status)) {
          notificationEvents.push(cloneJson(existing));
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
        batch: {
          batch_id: request.batch_id,
          sent_at: request.sent_at
        },
        business_delivery: {
          status: event.event_type === 'PARSED_TRANSACTION' ? 'PENDING' : 'NOT_APPLICABLE',
          updated_at: null,
          reason_code: null
        },
        ...(event.event_type === 'RAW_NOTIFICATION'
          ? { notification_classification: pendingNotificationClassification() }
          : {})
      };
      document.events[key] = storedEvent;
      if (event.event_type === 'PARSED_TRANSACTION') deliveryEvents.push(cloneJson(storedEvent));
      if (event.event_type === 'RAW_NOTIFICATION') notificationEvents.push(cloneJson(storedEvent));
      accepted.push(event);
      acknowledgements.push(acknowledgement(event, 'ACCEPTED'));
    }

    if (accepted.length > 0) {
      document.batches[batchKey(request.device_id, request.batch_id)] = {
        device_id: request.device_id,
        batch_id: request.batch_id,
        sent_at: request.sent_at,
        received_at: receivedAt,
        accepted_event_identities: accepted.map((event) => ({
          event_type: event.event_type,
          event_id: event.event_id
        }))
      };
      dirty = true;
      persist();
    }

    return { ok: true, result: { acknowledgements, delivery_events: deliveryEvents, notification_events: notificationEvents } };
  }

  function receiveRequest(input) {
    const validation = validateMobileSyncRequest(input);
    if (!validation.ok) return validation;
    return receiveValidatedRequest(validation.value);
  }

  function hasEvent(deviceId, eventType, eventId) {
    return Object.hasOwn(document.events, eventKey(deviceId, eventType, eventId));
  }

  function listEvents() {
    return Object.values(document.events).map(cloneJson);
  }

  function *iterateEvents({ eventType = '' } = {}) {
    for (const event of Object.values(document.events)) {
      if (eventType && event.event_type !== eventType) continue;
      yield cloneJson(event);
    }
  }

  function listPendingBusinessEvents() {
    return Object.values(document.events)
      .filter((event) => event.event_type === 'PARSED_TRANSACTION' &&
        ['PENDING', 'RETRY_PENDING'].includes(event.business_delivery?.status))
      .map(cloneJson);
  }

  function listPendingNotificationEvents() {
    return Object.values(document.events)
      .filter((event) => event.event_type === 'RAW_NOTIFICATION' &&
        ['PENDING', 'AI_PENDING', 'RETRY_PENDING'].includes(event.notification_classification?.status))
      .sort((left, right) => Number(left.payload?.sequence_number || 0) - Number(right.payload?.sequence_number || 0))
      .map(cloneJson);
  }

  function markNotificationClassification(event, classification, options = {}) {
    const key = eventKey(event?.device_id, event?.event_type, event?.event_id);
    const stored = document.events[key];
    if (!stored || stored.event_type !== 'RAW_NOTIFICATION') throw new Error('Mobile notification event was not found');
    const status = String(classification?.status || 'CLASSIFIED');
    if (!['CLASSIFIED', 'AI_PENDING', 'RETRY_PENDING', 'SENSITIVE_SKIPPED'].includes(status)) {
      throw new Error(`Unsupported notification classification status: ${status}`);
    }
    stored.notification_classification = {
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
    dirty = true;
    if (options.persist !== false) persist();
    return cloneJson(stored.notification_classification);
  }

  function flush() {
    return persist();
  }

  function queryNotificationArchive({ packageName, appIdentity, semanticCategory, deviceId, date, timezone = 'Asia/Shanghai', startAt, endAt } = {}) {
    const start = startAt ? Date.parse(startAt) : Number.NEGATIVE_INFINITY;
    const end = endAt ? Date.parse(endAt) : Number.POSITIVE_INFINITY;
    return Object.values(document.events)
      .filter((event) => {
        if (event.event_type !== 'RAW_NOTIFICATION') return false;
        const payload = event.payload || {};
        const occurred = Number(payload.posted_at || event.event_time);
        const localDate = Number.isFinite(occurred)
          ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(occurred))
          : '';
        if (deviceId && event.device_id !== deviceId) return false;
        if (packageName && (payload.package_name || payload.source_package) !== packageName) return false;
        if (appIdentity && event.notification_classification?.app_identity !== appIdentity) return false;
        if (semanticCategory && event.notification_classification?.semantic_category !== semanticCategory) return false;
        if (date && localDate !== date) return false;
        if (Number.isFinite(start) && occurred < start) return false;
        if (Number.isFinite(end) && occurred > end) return false;
        return true;
      })
      .sort((left, right) => Number(right.payload?.posted_at || right.event_time) - Number(left.payload?.posted_at || left.event_time))
      .map(cloneJson);
  }

  function markBusinessEventDelivery(event, status, reasonCode = null) {
    if (!BUSINESS_DELIVERY_STATUSES.includes(status)) {
      throw new Error(`Unsupported mobile business delivery status: ${String(status)}`);
    }
    const key = eventKey(event?.device_id, event?.event_type, event?.event_id);
    const stored = document.events[key];
    if (!stored) throw new Error('Mobile business event was not found');
    stored.business_delivery = {
      status,
      updated_at: now(),
      reason_code: typeof reasonCode === 'string' ? reasonCode.slice(0, 64) : null
    };
    dirty = true;
    persist();
    return cloneJson(stored.business_delivery);
  }

  function getLatestStatus(deviceId) {
    const value = document.latest_status_by_device[deviceId];
    return value ? cloneJson(value) : null;
  }

  function getLedgerReconciliation(deviceId) {
    const status = getLatestStatus(deviceId);
    const mobile = status?.snapshot?.ledger || null;
    const pcEvents = Object.values(document.events).filter((event) =>
      event.device_id === deviceId && event.event_type === 'RAW_NOTIFICATION');
    const pcHead = pcEvents.reduce((head, event) => {
      const sequence = Number(event.payload?.sequence_number);
      const postedAt = Number(event.payload?.posted_at ?? event.event_time);
      const safeSequence = Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
      const safePostedAt = Number.isSafeInteger(postedAt) && postedAt >= 0 ? postedAt : null;
      if (!head || (safeSequence ?? -1) > (head.sequence_number ?? -1) ||
          ((safeSequence ?? -1) === (head.sequence_number ?? -1) &&
            (safePostedAt ?? -1) > (head.posted_at_epoch_ms ?? -1))) {
        return {
          sequence_number: safeSequence,
          posted_at_epoch_ms: safePostedAt,
          received_at: event.received_at || null
        };
      }
      return head;
    }, null);
    const pc = {
      total_event_count: pcEvents.length,
      latest_sequence_number: pcHead?.sequence_number ?? null,
      latest_posted_at_epoch_ms: pcHead?.posted_at_epoch_ms ?? null,
      latest_received_at: pcHead?.received_at ?? null
    };
    let comparison = 'UNKNOWN';
    let reason = 'MOBILE_LEDGER_STATUS_UNAVAILABLE';
    if (mobile) {
      const mobileTotal = mobile.total_event_count;
      const mobileSequence = mobile.latest_sequence_number;
      const mobilePostedAt = mobile.latest_posted_at_epoch_ms;
      const hasComparableHead = mobileTotal === 0 || mobileSequence !== null;
      if (!hasComparableHead) {
        reason = 'MOBILE_HEAD_SEQUENCE_UNAVAILABLE';
      } else if (
        mobileTotal > pc.total_event_count ||
        (mobileSequence !== null && (pc.latest_sequence_number === null ||
          mobileSequence > pc.latest_sequence_number)) ||
        (mobilePostedAt !== null && pc.latest_posted_at_epoch_ms !== null &&
          mobilePostedAt > pc.latest_posted_at_epoch_ms)
      ) {
        comparison = 'MOBILE_AHEAD';
        reason = 'MOBILE_LEDGER_HAS_UNACCEPTED_EVENTS';
      } else if (
        pc.total_event_count > mobileTotal ||
        (pc.latest_sequence_number !== null && (mobileSequence === null ||
          pc.latest_sequence_number > mobileSequence)) ||
        (pc.latest_posted_at_epoch_ms !== null && mobilePostedAt !== null &&
          pc.latest_posted_at_epoch_ms > mobilePostedAt)
      ) {
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
    const events = Object.values(document.events).filter((event) => !date || pipelineEventDate(event, timezone) === date);
    const notifications = events.filter((event) => event.event_type === 'RAW_NOTIFICATION');
    const transactions = events.filter((event) => event.event_type === 'PARSED_TRANSACTION');
    const classified = notifications.filter((event) => ['CLASSIFIED', 'SENSITIVE_SKIPPED'].includes(event.notification_classification?.status));
    const classificationPending = notifications.filter((event) => ['PENDING', 'AI_PENDING', 'RETRY_PENDING'].includes(event.notification_classification?.status));
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
        attempt_id: Number.isInteger(evidence.attempt) ? evidence.attempt : null,
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
        Object.freeze({ stage: 'HOME_REFRESH', passed_count: null, rejected_count: null, pending_count: null, latest_success_at: null }),
      ]),
      ledgers: Object.freeze({
        notification_event_count: notifications.length,
        transaction_event_count: transactions.length,
        imported_expense_count: transactions.filter((event) => event.business_delivery?.status === 'IMPORTED').length,
      }),
      evidence_gaps: Object.freeze([
        'phone_queue_counts_require_current_mobile_status',
        'rejected_and_duplicate_ack_counts_are_not_persisted_in_v3_store',
        'renderer_home_refresh_ack_not_available',
      ]),
    });
  }

  function getState() {
    const legacyEvents = isPlainObject(document.legacy?.events) ? Object.keys(document.legacy.events).length : 0;
    const legacyBatches = isPlainObject(document.legacy?.batches) ? Object.keys(document.legacy.batches).length : 0;
    return {
      version: document.version,
      batch_count: Object.keys(document.batches).length,
      event_count: Object.keys(document.events).length,
      pending_business_event_count: listPendingBusinessEvents().length,
      pending_expense_draft_count: Object.values(document.events).filter((event) => event.event_type === 'PARSED_TRANSACTION' && ['PENDING', 'DRAFTED', 'RETRY_PENDING'].includes(event.business_delivery?.status)).length,
      auto_posted_count: Object.values(document.events).filter((event) => event.event_type === 'PARSED_TRANSACTION' && event.business_delivery?.status === 'IMPORTED').length,
      pending_notification_classification_count: Object.values(document.events).filter((event) =>
        event.event_type === 'RAW_NOTIFICATION' &&
        ['PENDING', 'AI_PENDING', 'RETRY_PENDING'].includes(event.notification_classification?.status)
      ).length,
      acked_notification_count: Object.values(document.events).filter((event) => event.event_type === 'RAW_NOTIFICATION').length,
      pipeline_diagnostics: getPipelineDiagnostics(),
      status_count: Object.keys(document.latest_status_by_device).length,
      legacy: {
        present: Boolean(document.legacy),
        disposition: document.legacy?.disposition || null,
        event_count: legacyEvents,
        batch_count: legacyBatches
      }
    };
  }

  return {
    flush,
    getLatestStatus,
    getLedgerReconciliation,
    getPipelineDiagnostics,
    getState,
    hasEvent,
    iterateEvents,
    listEvents,
    listPendingBusinessEvents,
    listPendingNotificationEvents,
    markNotificationClassification,
    queryNotificationArchive,
    markBusinessEventDelivery,
    receiveRequest,
    receiveStatusRequest,
    receiveValidatedRequest,
    receiveValidatedStatusRequest
  };
}

module.exports = {
  BUSINESS_DELIVERY_STATUSES,
  LEGACY_STORE_VERSION,
  MOBILE_SYNC_STORAGE_MODES,
  PREVIOUS_STORE_VERSION,
  MOBILE_SYNC_STORE_VERSION,
  createMobileSyncStore,
  eventKey,
  normalizeMobileSyncDocument: normalizeDocument
};
