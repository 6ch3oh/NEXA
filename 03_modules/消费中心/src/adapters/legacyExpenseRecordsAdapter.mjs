// NEXA Legacy Expense Records Container Adapter。
// legacy -> domain：接受已经反序列化的结构化 legacy 文档/对象，逐条规范化、拒绝与去重；
// domain -> legacy：重建 V1 容器，仅在证据支持范围内写回（含 NEXA 推荐的未知键保留）。
// 公共边界：本 Adapter 不承担任何 JSON 文本解析/解码、文件 I/O、CSV 或自然语言解析责任
// （Evidence Pack §10 Parser 边界）。
import {
  CANONICAL_FIELDS,
  dedupeKeyFor,
  isKnownInputKey,
  isPlainObject,
  normalizeExpenseRecord,
} from '../domain/expenseRecord.mjs';

export const LEGACY_CONTAINER_VERSION = 1;

// Evidence Pack §2：recordShape() = { version: 1, records: [], byDedupeKey: {} }（无 updatedAt）。
export function emptyLegacyDocument() {
  return {
    version: LEGACY_CONTAINER_VERSION,
    records: [],
    byDedupeKey: {},
  };
}

// legacy -> domain：接受已经反序列化的结构化 legacy 文档/对象（非 JSON 文本）。
// 稳定结构错误码：NOT_AN_OBJECT（非对象文档）、RECORDS_NOT_ARRAY（records 非数组）；
// 非对象记录与无效记录进入 rejected，带稳定错误码（INVALID_RECORD / EMPTY_PLATFORM / ...）。
// 对每条记录调用单一集中规范化；拒绝无效、跳过重复去重键、重建 byDedupeKey。
export function legacyToDomainDocument(legacyDoc, opts = {}) {
  if (!isPlainObject(legacyDoc)) {
    return {
      ok: false,
      error: { code: 'NOT_AN_OBJECT', message: 'legacy document must be an object' },
      domainRecords: [],
      rejected: [],
      duplicates: [],
      byDedupeKey: {},
    };
  }
  if (!Array.isArray(legacyDoc.records)) {
    return {
      ok: false,
      error: { code: 'RECORDS_NOT_ARRAY', message: 'legacy document records must be an array' },
      domainRecords: [],
      rejected: [],
      duplicates: [],
      byDedupeKey: {},
    };
  }
  const rawRecords = legacyDoc.records;
  const domainRecords = [];
  const rejected = [];
  const duplicates = [];
  const seen = new Set();

  for (const raw of rawRecords) {
    const result = normalizeExpenseRecord(raw, opts);
    if (!result.ok) {
      rejected.push({ input: raw, error: result.error });
      continue;
    }
    const key = result.record.dedupeKey;
    if (seen.has(key)) {
      duplicates.push(result.record);
      continue;
    }
    seen.add(key);
    domainRecords.push(result.record);
  }

  const byDedupeKey = {};
  for (const record of domainRecords) {
    byDedupeKey[record.dedupeKey] = true;
  }

  return { ok: true, domainRecords, rejected, duplicates, byDedupeKey };
}

// domain -> legacy：以原始记录（extensions.legacy.raw）为底，仅保留真未知键，
// 再写入 12 个规范 legacy 字段并重算 dedupeKey；byDedupeKey 重建；updatedAt 生成或保留。
export function domainToLegacyDocument(domainRecords, opts = {}) {
  if (!Array.isArray(domainRecords)) {
    return {
      ok: false,
      error: { code: 'INVALID_RECORDS', message: 'domainRecords must be an array' },
    };
  }
  const records = [];
  const byDedupeKey = {};
  const seen = new Set();

  for (const domain of domainRecords) {
    if (!isPlainObject(domain)) continue;
    const raw = domain.extensions && isPlainObject(domain.extensions.legacy) ? domain.extensions.legacy.raw : null;

    // 底 = 真未知键（已知键/别名键不保留，避免别名与规范字段重复出现）。
    const base = {};
    if (isPlainObject(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (!isKnownInputKey(key)) base[key] = value;
      }
    }

    // 写入 12 个规范字段。
    for (const field of CANONICAL_FIELDS) {
      base[field] = domain[field];
    }
    // 去重键永远重算，不信任 domain 或输入中的旧 dedupeKey。
    base.dedupeKey = dedupeKeyFor(domain);

    if (seen.has(base.dedupeKey)) continue;
    seen.add(base.dedupeKey);
    byDedupeKey[base.dedupeKey] = true;
    records.push(base);
  }

  const updatedAt =
    opts.updatedAt !== undefined
      ? opts.updatedAt
      : typeof opts.now === 'function'
        ? opts.now()
        : new Date().toISOString();

  return {
    ok: true,
    document: {
      version: LEGACY_CONTAINER_VERSION,
      records,
      byDedupeKey,
      updatedAt,
    },
  };
}
