// NEXA Expense Repository Contract V0.1 — 通用契约、校验/规范化/upsert 助手。
// 不创建 ORM。所有写路径统一委托 sealed normalizeExpenseRecord() 作为唯一领域规范化来源，
// 仓库层绝不创建第二个 expense normalizer，也绝不生成仓库级 UUID。
// 仅使用 Node 内置模块与 ESM。
import {
  isPlainObject,
  normalizeExpenseRecord,
  validateExpenseRecord,
} from '../domain/expenseRecord.mjs';

export const EXPENSE_REPOSITORY_CONTRACT_VERSION = '0.1';

// V0.1 公共契约方法面（list/all 为等价别名）。
export const REPOSITORY_METHODS = Object.freeze([
  'list',
  'all',
  'getById',
  'getByDedupeKey',
  'upsert',
  'upsertMany',
  'replaceAll',
  'clear',
]);

// 可复用契约断言：验证实现对象具备 V0.1 必需方法面。
export function assertRepositoryContract(repo) {
  if (!isPlainObject(repo)) {
    throw new TypeError('expense repository must be a plain object');
  }
  for (const method of REPOSITORY_METHODS) {
    if (typeof repo[method] !== 'function') {
      throw new TypeError(`expense repository is missing required method: ${method}`);
    }
  }
  return repo;
}

// 唯一领域规范化入口：写路径一律委托 sealed normalizeExpenseRecord()。
export function normalizeWriteInput(input, opts = {}) {
  const result = normalizeExpenseRecord(input, opts);
  if (result.ok && isPlainObject(input) && isPlainObject(input.extensions)) {
    // Repository 接收已规范化 Domain record 时，extensions 已是隔离后的兼容元数据。
    // 重新规范化 canonical 字段后显式保留它，避免把 extensions 再当作 legacy unknown 嵌套。
    result.record.extensions = cloneRecord(input.extensions);
  }
  return result;
}

// 可复用的领域校验（诊断），委托 validateExpenseRecord()。
export function validateWriteRecord(record) {
  return validateExpenseRecord(record);
}

// 深拷贝，用于安全快照（不泄漏内部可变数组/记录）。
export function cloneRecord(record) {
  return structuredClone(record);
}

export function snapshotRecords(records) {
  return records.map(cloneRecord);
}

// 确定性 upsert 助手（原地操作 records 数组）：
// 1) 先按 dedupeKey 匹配；2) 其次按 canonical id 匹配；3) 均未命中则追加。
// 匹配顺序固定；替换行为为“整体替换为新规范化记录”，完全确定且可测试。
// 绝不生成仓库级 UUID（id 由领域模型确定：有 raw.id 保留，否则 id=dedupeKey）。
export function upsertRecordInto(records, input, opts = {}) {
  const result = normalizeWriteInput(input, opts);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const record = result.record;

  const keyIndex = records.findIndex((existing) => existing.dedupeKey === record.dedupeKey);
  if (keyIndex !== -1) {
    records[keyIndex] = record;
    return { ok: true, record: cloneRecord(record), operation: 'update', matched: 'dedupeKey' };
  }

  const idIndex = records.findIndex((existing) => existing.id === record.id && record.id !== '');
  if (idIndex !== -1) {
    records[idIndex] = record;
    return { ok: true, record: cloneRecord(record), operation: 'update', matched: 'id' };
  }

  records.push(record);
  return { ok: true, record: cloneRecord(record), operation: 'insert' };
}

// 批量 upsert：按输入顺序逐条确定性应用，汇总 added/updated/rejected。
export function upsertManyRecords(records, inputs, opts = {}) {
  if (!Array.isArray(inputs)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'inputs must be an array' } };
  }
  const results = [];
  let added = 0;
  let updated = 0;
  let rejected = 0;
  for (const input of inputs) {
    const result = upsertRecordInto(records, input, opts);
    results.push(result);
    if (!result.ok) rejected += 1;
    else if (result.operation === 'insert') added += 1;
    else updated += 1;
  }
  return { ok: true, results, added, updated, rejected };
}

// 整体替换：清空后按顺序重建（去重语义与 upsert 一致，保持首见确定性）。
export function replaceAllRecords(records, inputs, opts = {}) {
  if (!Array.isArray(inputs)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'inputs must be an array' }, cleared: 0 };
  }
  const cleared = records.length;
  records.length = 0;
  const outcome = upsertManyRecords(records, inputs, opts);
  return { ...outcome, cleared };
}
