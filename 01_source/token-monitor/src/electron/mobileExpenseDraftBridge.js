'use strict';

const crypto = require('node:crypto');

const TRANSACTION_DIRECTIONS = Object.freeze({
  PAYMENT: 'expense',
  TRANSFER_OUT: 'expense',
  COLLECTION: 'income',
  TRANSFER_IN: 'income',
  REFUND: 'income'
});

function bridgeError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!normalized) return fallback;
  return Array.from(normalized).slice(0, max).join('');
}

function localDateKey(epochMs, fallbackIso) {
  let date = Number.isSafeInteger(epochMs) && epochMs >= 946684800000
    ? new Date(epochMs)
    : new Date(fallbackIso);
  if (Number.isNaN(date.getTime())) date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function platformFor(channel) {
  const normalized = String(channel || '').toUpperCase();
  if (normalized.includes('WECHAT') || normalized.includes('WEIXIN')) return 'wechat';
  if (normalized.includes('ALIPAY')) return 'alipay';
  if (normalized.includes('BANK') || normalized.includes('CARD')) return 'bank';
  return 'android_notification';
}

function oneWayReference(deviceId, eventId) {
  return crypto.createHash('sha256').update(`${deviceId}\u0000${eventId}`, 'utf8').digest('hex');
}

function projectMobileEventToExpenseDraft(event) {
  if (!isPlainObject(event) || event.event_type !== 'PARSED_TRANSACTION') {
    throw bridgeError('NOT_PAYMENT_EVENT', 'only parsed transaction events can create expense drafts');
  }
  const payload = event.payload;
  if (!isPlainObject(payload) || payload.payload_version !== 1) {
    throw bridgeError('UNSUPPORTED_PAYMENT_PAYLOAD', 'parsed transaction payload version is not supported');
  }
  const direction = TRANSACTION_DIRECTIONS[payload.transaction_type];
  if (!direction) throw bridgeError('UNSUPPORTED_TRANSACTION_TYPE', 'transaction type is not supported');
  if (!Number.isSafeInteger(payload.amount_minor) || payload.amount_minor <= 0) {
    throw bridgeError('INVALID_PAYMENT_AMOUNT', 'transaction amount must be a positive safe integer');
  }
  const currency = safeText(payload.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw bridgeError('INVALID_PAYMENT_CURRENCY', 'transaction currency is invalid');
  if (!Number.isSafeInteger(payload.confidence) || payload.confidence < 0 || payload.confidence > 10000) {
    throw bridgeError('INVALID_PAYMENT_CONFIDENCE', 'transaction confidence is invalid');
  }
  const deviceId = safeText(event.device_id, 256);
  const eventId = safeText(event.event_id, 256);
  if (!deviceId || !eventId) throw bridgeError('INVALID_PAYMENT_IDENTITY', 'transaction event identity is invalid');
  const sourceReference = oneWayReference(deviceId, eventId);
  const transactionTime = Number.isSafeInteger(payload.transaction_time)
    ? payload.transaction_time
    : event.event_time;
  return Object.freeze({
    draftId: `mobile:${sourceReference}`,
    sourceReference,
    receivedAt: typeof event.received_at === 'string' ? event.received_at : new Date().toISOString(),
    occurredAt: localDateKey(transactionTime, event.received_at),
    occurredAtEpochMs: Number.isSafeInteger(transactionTime) ? transactionTime : null,
    amountCents: payload.amount_minor,
    currency,
    merchant: safeText(payload.merchant, 120) || safeText(payload.counterparty, 120) || '移动端支付通知',
    direction,
    category: 'other',
    platform: platformFor(payload.payment_channel),
    sourceApplication: safeText(payload.source_application, 160) || null,
    confidence: payload.confidence / 10000,
    parserVersion: safeText(payload.parser_version, 64) || null,
    evidenceReferences: [sourceReference],
    classificationSource: 'deterministic_parser'
  });
}

module.exports = {
  TRANSACTION_DIRECTIONS,
  oneWayReference,
  platformFor,
  projectMobileEventToExpenseDraft
};
