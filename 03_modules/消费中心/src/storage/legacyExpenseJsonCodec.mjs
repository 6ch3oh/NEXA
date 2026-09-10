// NEXA Legacy Expense JSON Codec V0.1 — 存储层 JSON 文本编解码。
// 职责边界：
//   JSON.parse 责任 = YES（本 Codec 负责 JSON 文本反序列化）；
//   Expense parser 责任 = NO（不复制任何 parser/NLU/AI/CSV 能力）；
//   legacy 映射复用 = YES（decode 委托 legacyToDomainDocument()，encode 委托 domainToLegacyDocument()，
//   绝不重复实现别名或 legacy 字段映射）。
// 仅使用 Node 内置模块与 ESM。
import {
  domainToLegacyDocument,
  legacyToDomainDocument,
} from '../adapters/legacyExpenseRecordsAdapter.mjs';

export const LEGACY_JSON_CODEC_VERSION = '0.1';

// JSON text -> JSON.parse -> structured legacy document -> 既有 legacyToDomainDocument()。
// 返回与 legacyToDomainDocument() 一致的结果形状：{ ok:true, domainRecords, rejected, duplicates, byDedupeKey }。
// 稳定错误码：INVALID_INPUT（非字符串输入）、INVALID_JSON（JSON 语法损坏）、
// 以及来自 Adapter 的结构/领域错误（NOT_AN_OBJECT / RECORDS_NOT_ARRAY / INVALID_RECORD / ...）。
export function decodeLegacyExpenseJson(jsonText, opts = {}) {
  if (typeof jsonText !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'legacy JSON must be provided as a string' },
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseError) {
    return {
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: 'malformed legacy JSON document',
        detail: parseError.message,
      },
    };
  }
  // 复用 Phase1 legacy adapter 的结构化文档映射，绝不重复字段/别名映射。
  return legacyToDomainDocument(parsed, opts);
}

// Domain records -> 既有 domainToLegacyDocument() -> JSON.stringify。
// 返回 { ok:true, jsonText, document } 或 { ok:false, error }。
// 稳定错误码：INVALID_RECORDS（非数组输入）、STRINGIFY_ERROR（序列化失败）。
export function encodeLegacyExpenseJson(domainRecords, opts = {}) {
  const converted = domainToLegacyDocument(domainRecords, opts);
  if (!converted.ok) return converted;

  let jsonText;
  try {
    jsonText = JSON.stringify(converted.document, null, 2);
  } catch (stringifyError) {
    return {
      ok: false,
      error: {
        code: 'STRINGIFY_ERROR',
        message: 'failed to stringify legacy expense JSON document',
        detail: stringifyError.message,
      },
    };
  }
  return { ok: true, jsonText, document: converted.document };
}
