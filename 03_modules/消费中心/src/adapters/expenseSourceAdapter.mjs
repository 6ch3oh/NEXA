// NEXA 消费中心结构化候选源接缝（minimal structured-candidate seam）。
// 仅提供：四种来源种类常量、种类校验、接缝描述与统一候选规范化 normalizeSourceCandidate。
// 已移除 registerSourceParser 与 parser 注册表。
// 不包含任何具体 parser、OCR、NLP、AI 分类器、自然语言解析、CSV 解析或源特定解析。
import { isPlainObject, normalizeExpenseRecord } from '../domain/expenseRecord.mjs';

export const SOURCE_KINDS = Object.freeze([
  'android_notification',
  'wechat',
  'alipay',
  'bank',
]);

export function isSupportedSourceKind(kind) {
  return SOURCE_KINDS.includes(kind);
}

export function assertSupportedSourceKind(kind) {
  if (!isSupportedSourceKind(kind)) {
    const error = new Error(`unsupported source kind: ${String(kind)}`);
    error.code = 'UNSUPPORTED_SOURCE_KIND';
    throw error;
  }
}

// 获取结构化候选源接缝描述。不返回任何解析能力；已无 parser 注册表，故不再有 parserBound。
export function getSourceSeam(kind) {
  assertSupportedSourceKind(kind);
  return {
    kind,
    sourceKind: kind,
    phase: 'structured-candidate-seam',
    capabilities: [],
    note: 'structured-candidate seam only; no parser/OCR/NLP/AI/CSV parsing is implemented in this phase',
  };
}

// 统一候选规范化接缝：
// 1) 校验 sourceKind 属于四种已确认来源；
// 2) 校验 candidate 为结构化对象；
// 3) 委托既有统一 normalizeExpenseRecord() 完成全部领域规范化；
// 4) 返回领域结果，并附带 source-kind 兼容性元数据（仅作为结果元数据，
//    不写入规范记录，因此不会新增第 13 个规范 legacy 字段）。
// 无任何具体解析器/源特定解析逻辑。
export function normalizeSourceCandidate(sourceKind, candidate, options) {
  if (!isSupportedSourceKind(sourceKind)) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_SOURCE_KIND', message: `unsupported source kind: ${String(sourceKind)}` },
    };
  }
  if (!isPlainObject(candidate)) {
    return {
      ok: false,
      error: { code: 'INVALID_CANDIDATE', message: 'source candidate must be a structured object' },
    };
  }
  const result = normalizeExpenseRecord(candidate, options);
  if (!result.ok) return result;
  return {
    ok: true,
    record: result.record,
    issues: result.issues,
    // 简单一致性提示：规范化后的 platform 与来源种类一致时标记兼容；仅作元数据，不拦截、不改写。
    source: {
      sourceKind,
      compatible: result.record.platform === sourceKind,
    },
  };
}
