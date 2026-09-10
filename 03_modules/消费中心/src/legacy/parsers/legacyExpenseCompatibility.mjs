// Legacy source: src/shared/expense.js @ 7d4e3830ddf5e786d85499571e10086a9cc518f4
// Asset: LEGACY-PARSER-COMPAT-NORMALIZER-V1 (EXTRACT_AND_ADAPT).
// Migration: behavior-preserving parser-only compatibility kernel; do not independently rewrite.

import { createHash, randomUUID } from 'node:crypto';
import {
  classifyExpense,
  isObject,
  normalizeCategory,
  normalizeDirection,
} from '../classification/legacyExpenseCategoryRules.mjs';

export { isObject, normalizeCategory, normalizeDirection };

export const LEGACY_COMPATIBILITY_ASSET_ID = 'LEGACY-PARSER-COMPAT-NORMALIZER-V1';

export const PLATFORM_ALIASES = Object.freeze({
  wechat: 'wechat',
  weixin: 'wechat',
  '微信': 'wechat',
  wx: 'wechat',
  alipay: 'alipay',
  '支付宝': 'alipay',
  zhifubao: 'alipay',
});

export function normalizePlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PLATFORM_ALIASES[raw] || (raw ? raw : '');
}

export function normalizeMerchant(value) {
  return String(value || '').trim();
}

export function normalizeAmountCents(value, options = {}) {
  const asCents = options.asCents === true;
  let number = Number(value);
  if (!Number.isFinite(number)) {
    if (typeof value !== 'string') return 0;
    const cleaned = value.replace(/[^\d.-]/g, '');
    if (!cleaned) return 0;
    number = Number(cleaned);
    if (!Number.isFinite(number)) return 0;
  }
  const cents = asCents ? number : Math.round(number * 100);
  if (!Number.isFinite(cents)) return 0;
  return Math.trunc(cents);
}

export function normalizeCurrency(value, fallback = 'CNY') {
  const raw = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : fallback;
}

export function normalizeOccurredAt(value) {
  if (typeof value === 'number') {
    const date = new Date(value);
    return localDateKey(date);
  }
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
        return localDateKey(date);
      }
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return localDateKey(parsed);
}

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeSourceId(value) {
  return String(value || '').trim();
}

export function normalizeNote(value) {
  return String(value || '').slice(0, 512).trim();
}

export function clampText(value, max) {
  const raw = String(value || '').trim();
  return max && max > 0 ? raw.slice(0, max) : raw;
}

export function normalizeExpenseRecord(raw, options = {}) {
  const source = isObject(raw) ? raw : {};
  const platform = normalizePlatform(source.platform || source.source);
  const occurredAt = normalizeOccurredAt(source.occurredAt || source.transactionTime || source.time || source.tradeTime);
  const direction = normalizeDirection(source.direction || source.type);
  let amountCents = Number(source.amountCents);
  if (Number.isFinite(amountCents)) {
    amountCents = Math.trunc(amountCents);
  } else {
    amountCents = normalizeAmountCents(source.amount, { asCents: options.amountsAsCents === true });
    if (amountCents === 0 && source.amountCents !== undefined) {
      amountCents = Math.trunc(Number(source.amountCents) || 0);
    }
  }
  if (direction === 'income' && amountCents > 0) amountCents = -Math.abs(amountCents);
  const merchant = clampText(normalizeMerchant(source.merchant || source.opposite || source.store || source.business || source.payee), 120);
  const category = normalizeCategory(source.category);
  const note = normalizeNote(source.note || source.description || source.comment || source.remark);
  const sourceId = normalizeSourceId(source.sourceId || source.tradeId || source.orderId || source.transactionId || (source.id !== undefined ? String(source.id) : ''));
  const currency = normalizeCurrency(source.currency, options.defaultCurrency || 'CNY');
  const autoCategorize = options.autoCategorize !== false;
  const effectiveCategory = category === 'other'
    ? classifyExpense({ direction, category, merchant }, { autoCategorize })
    : category;

  return {
    id: String(source.id || '').trim() || createExpenseId(),
    platform,
    sourceId,
    occurredAt,
    amountCents,
    currency,
    merchant,
    direction,
    category: effectiveCategory,
    note,
    createdAt: source.createdAt || new Date().toISOString(),
    dedupeKey: dedupeKeyFor({ platform, sourceId, occurredAt, amountCents, merchant, direction }),
  };
}

export function dedupeKeyFor({ platform, sourceId, occurredAt, amountCents, merchant, direction }) {
  const normPlatform = normalizePlatform(platform);
  const normSourceId = normalizeSourceId(sourceId);
  if (normPlatform && normSourceId) return `src:${normPlatform}:${normSourceId}`;
  const fingerprint = [
    normalizePlatform(platform || 'manual') || 'manual',
    normalizeOccurredAt(occurredAt),
    Math.trunc(Number(amountCents) || 0),
    normalizeMerchant(merchant),
    normalizeDirection(direction),
  ];
  const hash = createHash('sha256');
  for (const part of fingerprint) hash.update(String(part)).update('\0');
  return `fp:${hash.digest('hex')}`;
}

export function createExpenseId() {
  return randomUUID();
}
