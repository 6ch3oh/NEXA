// NEXA JSON File Expense Repository — 实现 V0.1 契约，持久化到显式文件路径。
// 边界声明：
//   - 构造/工厂必须要求显式 filePath；绝不检查 AppData/userData/HOME/USERPROFILE/Electron 或任何系统路径。
//   - 缺失显式文件 = 空仓库；首次写入只允许创建其父目录与目标文件。
//   - 损坏 JSON 必须以稳定错误失败，绝不被当作空仓库或覆盖。
//   - 持久化 = 同目录临时文件 + rename 的 best-effort 策略（BEST_EFFORT_TEMP_RENAME），
//     不声明 fsync/崩溃一致性/事务。
//   - 记录内容经 legacy adapter（domainToLegacyDocument）写回，保持 Phase1 extensions.legacy 兼容。
// 仅使用 Node 内置模块与 ESM。
import fs from 'node:fs';
import path from 'node:path';

import {
  assertRepositoryContract,
  cloneRecord,
  replaceAllRecords,
  snapshotRecords,
  upsertManyRecords,
  upsertRecordInto,
} from './expenseRepository.mjs';
import {
  decodeLegacyExpenseJson,
  encodeLegacyExpenseJson,
} from '../storage/legacyExpenseJsonCodec.mjs';

export const JSON_FILE_REPOSITORY_PERSISTENCE = 'BEST_EFFORT_TEMP_RENAME';

function makeStableError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// 读取并解码显式文件。文件缺失 => 空记录集；损坏 JSON => 抛稳定错误（不当作空）。
function loadRecordsFromFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (readError) {
    if (readError && readError.code === 'ENOENT') return [];
    throw readError;
  }
  const decoded = decodeLegacyExpenseJson(text);
  if (!decoded.ok) {
    throw makeStableError(decoded.error.code, `cannot load expense repository from ${filePath}: ${decoded.error.message}`);
  }
  return decoded.domainRecords;
}

// Best-effort 同目录临时文件 + rename 持久化。
function persistRecordsToFile(filePath, records, opts = {}) {
  const encoded = encodeLegacyExpenseJson(records, opts);
  if (!encoded.ok) {
    throw makeStableError(encoded.error.code, `cannot encode expense repository for ${filePath}: ${encoded.error.message}`);
  }
  const directory = path.dirname(filePath);
  // 首次写入仅创建父目录与目标文件。
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryPath, encoded.jsonText, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (renameError) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (_) {
      // best-effort 清理；不承诺 fsync/崩溃一致性。
    }
    throw renameError;
  }
}

// 创建 JSON 文件仓库。必须提供显式 filePath（非空字符串）。
// opts 支持 { now } 时钟注入，传递给领域规范化与 legacy 容器 updatedAt。
export function createJsonFileExpenseRepository(filePath, opts = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw makeStableError('INVALID_FILE_PATH', 'jsonFileExpenseRepository requires an explicit non-empty filePath');
  }

  const records = loadRecordsFromFile(filePath);

  const repository = {
    get filePath() {
      return filePath;
    },
    list() {
      return snapshotRecords(records);
    },
    all() {
      return snapshotRecords(records);
    },
    getById(id) {
      const found = records.find((record) => record.id === id);
      if (!found) {
        return { ok: false, error: { code: 'NOT_FOUND', message: `no expense record with id ${String(id)}` } };
      }
      return { ok: true, record: cloneRecord(found) };
    },
    getByDedupeKey(dedupeKey) {
      const found = records.find((record) => record.dedupeKey === dedupeKey);
      if (!found) {
        return { ok: false, error: { code: 'NOT_FOUND', message: `no expense record with dedupeKey ${String(dedupeKey)}` } };
      }
      return { ok: true, record: cloneRecord(found) };
    },
    upsert(input, writeOpts = {}) {
      const result = upsertRecordInto(records, input, { ...opts, ...writeOpts });
      if (result.ok) persistRecordsToFile(filePath, records, { ...opts, ...writeOpts });
      return result;
    },
    upsertMany(inputs, writeOpts = {}) {
      const result = upsertManyRecords(records, inputs, { ...opts, ...writeOpts });
      if (result.ok) persistRecordsToFile(filePath, records, { ...opts, ...writeOpts });
      return result;
    },
    replaceAll(inputs, writeOpts = {}) {
      const result = replaceAllRecords(records, inputs, { ...opts, ...writeOpts });
      if (result.ok) persistRecordsToFile(filePath, records, { ...opts, ...writeOpts });
      return result;
    },
    clear() {
      const cleared = records.length;
      records.length = 0;
      persistRecordsToFile(filePath, records, opts);
      return { ok: true, cleared };
    },
  };

  assertRepositoryContract(repository);
  return repository;
}
