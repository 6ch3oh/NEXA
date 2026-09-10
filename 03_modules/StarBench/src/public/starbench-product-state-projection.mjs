const PRODUCT_STATE_SEMANTICS = Object.freeze({
  ready: Object.freeze({ product_state: 'READY', source_health: 'HEALTHY', freshness: 'CURRENT', label: '可用', message: '数据源正常。' }),
  empty: Object.freeze({ product_state: 'EMPTY', source_health: 'HEALTHY', freshness: 'CURRENT', label: '暂无记录', message: '数据源正常，当前没有可显示记录。' }),
  partial: Object.freeze({ product_state: 'PARTIAL', source_health: 'HEALTHY', freshness: 'CURRENT', label: '部分可用', message: '数据源正常，当前仅显示部分记录。' }),
  unavailable: Object.freeze({ product_state: 'UNAVAILABLE', source_health: 'NOT_AVAILABLE', freshness: 'UNKNOWN', label: '能力尚不可用', message: '当前尚未接入可读取的数据来源，不需要你进行配置。' }),
  stale: Object.freeze({ product_state: 'STALE', source_health: 'STALE', freshness: 'STALE', label: '数据可能已过期', message: '当前显示的是较早数据，请结合最近更新时间判断。' }),
  error: Object.freeze({ product_state: 'ERROR', source_health: 'ERROR', freshness: 'UNKNOWN', label: '读取暂时失败', message: '本次读取未成功，请稍后重试。' }),
});

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function timestampOrNull(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const STARBENCH_DESKTOP_PRODUCT_STATE_SEMANTICS = PRODUCT_STATE_SEMANTICS;

export function createStarBenchProductStateSummary(status, {
  baseSummary = null,
  checkedAt = null,
  reasonCode = null,
  safetyNotice = null,
} = {}) {
  const semantics = PRODUCT_STATE_SEMANTICS[status];
  if (!semantics) throw new TypeError('Unsupported StarBench product state.');
  const base = plain(baseSummary) ? structuredClone(baseSummary) : {};
  const summary = {
    ...base,
    ...(typeof reasonCode === 'string' && reasonCode.length > 0 ? { reason_code: reasonCode } : {}),
    product_state: semantics.product_state,
    source_health: semantics.source_health,
    checked_at: timestampOrNull(checkedAt),
    freshness: semantics.freshness,
    user_configuration_required: false,
    user_status: {
      label: semantics.label,
      message: semantics.message,
    },
    ...(typeof safetyNotice === 'string' && safetyNotice.length > 0 ? { safety_notice: safetyNotice } : {}),
  };
  return deepFreeze(summary);
}
