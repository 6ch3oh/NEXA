export const REPOSITORY_METHODS = Object.freeze(['create', 'getById', 'update', 'delete', 'list']);

export function assertRepositoryContract(impl, label = 'repository') {
  if (!impl || typeof impl !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }
  for (const method of REPOSITORY_METHODS) {
    if (typeof impl[method] !== 'function') {
      throw new TypeError(`${label} is missing required repository method "${method}"`);
    }
  }
  return impl;
}

export function normalizeListOptions(options = {}) {
  const src = options ?? {};
  return {
    start_at: typeof src.start_at === 'string' ? src.start_at : null,
    end_at: typeof src.end_at === 'string' ? src.end_at : null,
    status: typeof src.status === 'string' ? src.status : null,
    source: typeof src.source === 'string' ? src.source : null,
  };
}

function lowerBoundary(value) {
  if (value == null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
}

function upperBoundary(value) {
  if (value == null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999` : value;
}

export function entityTimeWindow(entity) {
  if (!entity || typeof entity !== 'object') return Object.freeze({ start_at: null, end_at: null });
  const isEvent = Object.hasOwn(entity, 'all_day') || Object.hasOwn(entity, 'end_at');
  const start = isEvent ? (entity.start_at ?? null) : (entity.start_at ?? entity.due_at ?? null);
  const end = isEvent
    ? (entity.end_at ?? entity.start_at ?? null)
    : (entity.due_at ?? entity.start_at ?? null);
  return Object.freeze({
    start_at: lowerBoundary(start),
    end_at: upperBoundary(end),
  });
}

export function matchesListFilters(entity, options = {}) {
  const { start_at, end_at, status, source } = normalizeListOptions(options);
  if (status != null && entity.status !== status) return false;
  if (source != null && entity.source !== source) return false;
  const window = entityTimeWindow(entity);
  const queryStart = lowerBoundary(start_at);
  const queryEnd = upperBoundary(end_at);
  if (queryStart != null && (window.end_at == null || window.end_at < queryStart)) return false;
  if (queryEnd != null && (window.start_at == null || window.start_at > queryEnd)) return false;
  return true;
}
