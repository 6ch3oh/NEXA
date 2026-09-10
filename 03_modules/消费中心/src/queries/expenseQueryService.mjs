import { assertRepositoryContract } from '../repositories/expenseRepository.mjs';

export const EXPENSE_QUERY_SERVICE_VERSION = '0.1';

const FILTER_FIELDS = Object.freeze(['category', 'merchant', 'platform']);
const VALID_DIRECTIONS = new Set(['expense', 'income']);
const VALID_SORT_ORDERS = new Set(['asc', 'desc']);

function queryError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isStrictDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeQueryOptions(options) {
  if (!isPlainObject(options)) {
    throw queryError('INVALID_QUERY', 'query options must be a plain object');
  }

  const {
    startDate,
    endDate,
    category,
    merchant,
    platform,
    direction,
    sortOrder = 'desc',
    offset = 0,
    limit,
  } = options;

  for (const [name, value] of [['startDate', startDate], ['endDate', endDate]]) {
    if (value !== undefined && !isStrictDate(value)) {
      throw queryError('INVALID_DATE', `${name} must be a valid YYYY-MM-DD date`);
    }
  }
  if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
    throw queryError('INVALID_DATE_RANGE', 'startDate must be less than or equal to endDate');
  }

  for (const field of FILTER_FIELDS) {
    const value = { category, merchant, platform }[field];
    if (value !== undefined && typeof value !== 'string') {
      throw queryError('INVALID_FILTER', `${field} must be a string`);
    }
  }
  if (direction !== undefined && !VALID_DIRECTIONS.has(direction)) {
    throw queryError('INVALID_DIRECTION', 'direction must be expense or income');
  }
  if (!VALID_SORT_ORDERS.has(sortOrder)) {
    throw queryError('INVALID_SORT_ORDER', 'sortOrder must be asc or desc');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw queryError('INVALID_OFFSET', 'offset must be a non-negative integer');
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw queryError('INVALID_LIMIT', 'limit must be a positive integer');
  }

  return { startDate, endDate, category, merchant, platform, direction, sortOrder, offset, limit };
}

function matches(record, options) {
  if (options.startDate !== undefined && record.occurredAt < options.startDate) return false;
  if (options.endDate !== undefined && record.occurredAt > options.endDate) return false;
  for (const field of FILTER_FIELDS) {
    if (options[field] !== undefined && record[field] !== options[field]) return false;
  }
  if (options.direction !== undefined && record.direction !== options.direction) return false;
  return true;
}

function compareRecords(left, right, sortOrder) {
  const dateOrder = compareText(left.occurredAt, right.occurredAt);
  if (dateOrder !== 0) return sortOrder === 'asc' ? dateOrder : -dateOrder;
  const idOrder = compareText(String(left.id), String(right.id));
  if (idOrder !== 0) return idOrder;
  return compareText(String(left.dedupeKey ?? ''), String(right.dedupeKey ?? ''));
}

export function createExpenseQueryService(repository) {
  const repo = assertRepositoryContract(repository);

  return Object.freeze({
    query(options = {}) {
      const normalized = normalizeQueryOptions(options);
      const snapshot = repo.list();
      if (!Array.isArray(snapshot)) {
        throw queryError('INVALID_REPOSITORY_RESULT', 'repository.list() must return an array');
      }

      const ordered = snapshot
        .filter((record) => matches(record, normalized))
        .slice()
        .sort((left, right) => compareRecords(left, right, normalized.sortOrder));
      const end = normalized.limit === undefined ? undefined : normalized.offset + normalized.limit;
      return ordered.slice(normalized.offset, end).map((record) => structuredClone(record));
    },
  });
}
