// NEXA InMemory Expense Repository — 实现 V0.1 契约，无任何文件系统依赖。
// 完整保留领域校验与确定性 dedupe/upsert 行为；读写均返回安全快照，不泄漏内部可变数组。
import {
  assertRepositoryContract,
  cloneRecord,
  replaceAllRecords,
  snapshotRecords,
  upsertManyRecords,
  upsertRecordInto,
} from './expenseRepository.mjs';

export const IN_MEMORY_REPOSITORY_IMPLEMENTATION = 'in-memory';

// 构造内存仓库。可选的 initialInputs 为结构化候选/legacy 输入，经唯一领域规范化后种子化。
export function createInMemoryExpenseRepository(initialInputs = []) {
  const records = [];

  if (Array.isArray(initialInputs) && initialInputs.length > 0) {
    const seeded = upsertManyRecords(records, initialInputs);
    if (!seeded.ok) {
      const error = new Error(`cannot seed in-memory expense repository: ${seeded.error.code}`);
      error.code = 'SEED_FAILED';
      throw error;
    }
  }

  const repository = {
    // 返回当前记录数组的安全快照。
    list() {
      return snapshotRecords(records);
    },
    // list 的等价别名（契约要求）。
    all() {
      return snapshotRecords(records);
    },
    // 按 canonical id 精确匹配；未命中返回稳定 NOT_FOUND。
    getById(id) {
      const found = records.find((record) => record.id === id);
      if (!found) {
        return { ok: false, error: { code: 'NOT_FOUND', message: `no expense record with id ${String(id)}` } };
      }
      return { ok: true, record: cloneRecord(found) };
    },
    // 按 dedupeKey 精确匹配；未命中返回稳定 NOT_FOUND。
    getByDedupeKey(dedupeKey) {
      const found = records.find((record) => record.dedupeKey === dedupeKey);
      if (!found) {
        return { ok: false, error: { code: 'NOT_FOUND', message: `no expense record with dedupeKey ${String(dedupeKey)}` } };
      }
      return { ok: true, record: cloneRecord(found) };
    },
    // 写入：委托唯一领域规范化，再按 dedupeKey 优先、canonical id 次之确定性 upsert。
    upsert(input, opts = {}) {
      return upsertRecordInto(records, input, opts);
    },
    upsertMany(inputs, opts = {}) {
      return upsertManyRecords(records, inputs, opts);
    },
    replaceAll(inputs, opts = {}) {
      return replaceAllRecords(records, inputs, opts);
    },
    clear() {
      const cleared = records.length;
      records.length = 0;
      return { ok: true, cleared };
    },
  };

  assertRepositoryContract(repository);
  return repository;
}
