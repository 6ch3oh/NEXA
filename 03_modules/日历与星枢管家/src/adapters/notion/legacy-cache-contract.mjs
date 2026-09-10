import { isValidIsoTimestamp } from '../../date/deterministic-parser.mjs';
import { LEGACY_FAILURE_CODES, normalizeLegacyFailure } from './legacy-capability-contract.mjs';

export const LEGACY_CACHE_SOURCE = 'legacy_notion_todo_cache';

export class LegacyCacheContractError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'LegacyCacheContractError';
    this.code = LEGACY_FAILURE_CODES.MALFORMED_DATA;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, deepFreeze(child)]),
    ));
  }
  return value;
}

function normalizeDue(due, index) {
  if (due == null) return null;
  if (!due || typeof due !== 'object' || Array.isArray(due)) {
    throw new LegacyCacheContractError(`items[${index}].due must be an object or null`);
  }
  if (typeof due.start !== 'string' || due.start.trim() === '') {
    throw new LegacyCacheContractError(`items[${index}].due.start must be non-empty`);
  }
  for (const field of ['end', 'timeZone']) {
    if (due[field] != null && typeof due[field] !== 'string') {
      throw new LegacyCacheContractError(`items[${index}].due.${field} must be a string or null`);
    }
  }
  if (due.hasTime != null && typeof due.hasTime !== 'boolean') {
    throw new LegacyCacheContractError(`items[${index}].due.hasTime must be boolean when present`);
  }
  return {
    start: due.start,
    end: due.end ?? null,
    timeZone: due.timeZone ?? null,
    hasTime: due.hasTime ?? due.start.includes('T'),
  };
}

function normalizeItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new LegacyCacheContractError(`items[${index}] must be an object`);
  }
  for (const field of ['id', 'title', 'status']) {
    if (typeof item[field] !== 'string' || item[field].trim() === '') {
      throw new LegacyCacheContractError(`items[${index}].${field} must be non-empty`);
    }
  }
  for (const field of ['url', 'priority', 'category']) {
    if (item[field] != null && typeof item[field] !== 'string') {
      throw new LegacyCacheContractError(`items[${index}].${field} must be a string when present`);
    }
  }
  return {
    id: item.id,
    url: item.url ?? '',
    title: item.title,
    priority: item.priority ?? '',
    due: normalizeDue(item.due ?? null, index),
    status: item.status,
    category: item.category ?? null,
  };
}

function count(value, field) {
  if (value == null) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new LegacyCacheContractError(`${field} must be a non-negative integer`);
  }
  return value;
}

export function createLegacyCacheSnapshot(raw, { observedAt } = {}) {
  if (!isValidIsoTimestamp(observedAt)) {
    throw new LegacyCacheContractError('observedAt must be an explicit ISO timestamp');
  }
  if (raw == null) {
    return deepFreeze({
      items: [], source: LEGACY_CACHE_SOURCE, refreshed_at: null, observed_at: observedAt,
      stale: false,
      error: {
        code: LEGACY_FAILURE_CODES.CACHE_MISS, legacy_code: null, cause_code: null,
        retry_after_ms: null, message: 'Legacy Notion Todo cache is absent.',
      },
      legacy_status: null,
      counts: { overdue: 0, today: 0, later: 0 },
    });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LegacyCacheContractError('Legacy cache snapshot must be an object or null');
  }
  if (!Array.isArray(raw.items)) {
    throw new LegacyCacheContractError('Legacy cache snapshot.items must be an array');
  }
  if (raw.updatedAt != null && (!Number.isFinite(raw.updatedAt) || raw.updatedAt < 0)) {
    throw new LegacyCacheContractError('Legacy cache snapshot.updatedAt must be a non-negative epoch value');
  }
  const items = raw.items.map(normalizeItem);
  const stale = raw.ok === false && items.length > 0;
  const refreshedAt = raw.updatedAt > 0 ? new Date(raw.updatedAt).toISOString() : null;
  return deepFreeze({
    items,
    source: LEGACY_CACHE_SOURCE,
    refreshed_at: refreshedAt,
    observed_at: observedAt,
    stale,
    error: raw.ok === false ? normalizeLegacyFailure(raw, { hasCachedItems: stale }) : null,
    legacy_status: typeof raw.status === 'string' ? raw.status : null,
    counts: {
      overdue: count(raw.overdueCount, 'overdueCount'),
      today: count(raw.todayCount, 'todayCount'),
      later: count(raw.laterCount, 'laterCount'),
    },
  });
}
