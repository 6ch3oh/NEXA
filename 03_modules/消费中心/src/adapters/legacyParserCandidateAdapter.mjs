// Legacy sources: confirmed parser assets from src/shared/expense.js
// Legacy HEAD: 7d4e3830ddf5e786d85499571e10086a9cc518f4
// Migration: thin NEXA adapter only; parser logic and persistence are intentionally absent.

import { normalizeExpenseClassification } from '../classification/expenseClassification.mjs';
import { createExpenseSourceCandidate } from '../contracts/expenseSourceCandidate.mjs';
import {
  LEGACY_CLASSIFICATION_ASSET_ID,
  LEGACY_RULE_SET,
  classifyExpense,
  normalizeCategory,
} from '../legacy/classification/legacyExpenseCategoryRules.mjs';
import {
  LEGACY_COMPATIBILITY_ASSET_ID,
  isObject,
  normalizeExpenseRecord,
  normalizePlatform,
} from '../legacy/parsers/legacyExpenseCompatibility.mjs';
import {
  LEGACY_CSV_PREVIEW_ASSET_ID,
  parseLegacyExpenseCsv,
} from '../legacy/parsers/legacyExpenseCsvParser.mjs';
import {
  LEGACY_INBOX_JSON_ASSET_ID,
  parseLegacyInboxJson,
} from '../legacy/parsers/legacyInboxJsonParser.mjs';
import {
  LEGACY_WECHAT_BILL_CSV_ASSET_ID,
  parseLegacyWeChatBillCsv,
} from '../legacy/parsers/wechatBillCsvParser.mjs';

export const LEGACY_PARSER_CANDIDATE_ADAPTER_VERSION = '0.1';

const CHANNELS = new Set(['inbox_json', 'csv', 'wechat_bill_csv']);

function adapterError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function resolveChannel(context) {
  const inputChannel = context.inputChannel ?? 'inbox_json';
  if (!CHANNELS.has(inputChannel)) {
    throw adapterError('INVALID_LEGACY_INPUT_CHANNEL', `unsupported legacy input channel: ${String(inputChannel)}`);
  }
  return inputChannel;
}

function resolveSourceKind(platform, inputChannel, detectedPlatform) {
  if (inputChannel === 'csv' && detectedPlatform === 'unknown') return 'import';
  if (platform === 'wechat' || platform === 'alipay' || platform === 'bank' || platform === 'manual') return platform;
  return 'legacy';
}

function classificationOrigin(inputChannel) {
  return inputChannel === 'inbox_json'
    ? { source: 'legacy', method: 'legacy_mapping' }
    : { source: 'imported', method: 'imported_value' };
}

function withoutLegacyConfidence(candidate) {
  const {
    confidence: _legacyConfidenceMustRemainAbsent,
    id,
    createdAt,
    ...requiredFields
  } = candidate;
  const source = Object.fromEntries(
    Object.entries(requiredFields.source).filter(([, value]) => value !== null),
  );
  const classification = requiredFields.classification === null
    ? null
    : Object.fromEntries(
      Object.entries(requiredFields.classification).filter(([, value]) => value !== null),
    );
  const withoutAbsentOptionals = {
    ...requiredFields,
    source: Object.freeze(source),
  };
  if (classification === null) delete withoutAbsentOptionals.classification;
  else withoutAbsentOptionals.classification = Object.freeze(classification);
  if (id !== null) withoutAbsentOptionals.id = id;
  if (createdAt !== null) withoutAbsentOptionals.createdAt = createdAt;
  return Object.freeze(withoutAbsentOptionals);
}

export function applyLegacyClassificationToCandidate(record, context = {}) {
  if (!isObject(record)) throw adapterError('INVALID_LEGACY_RECORD', 'legacy classification input must be an object');
  const inputChannel = resolveChannel(context);
  const rawCategory = normalizeCategory(context.rawRecord?.category ?? record.category);
  const hasExplicitCategory = rawCategory !== 'other';
  const autoCategorize = context.autoCategorize !== false;

  let category;
  let origin;
  if (hasExplicitCategory) {
    category = rawCategory;
    origin = classificationOrigin(inputChannel);
  } else if (autoCategorize) {
    category = classifyExpense(record, { autoCategorize: true });
    origin = { source: 'rule', method: 'deterministic_rule' };
  } else {
    category = 'other';
    origin = classificationOrigin(inputChannel);
  }

  const validatedClassification = normalizeExpenseClassification({
    category,
    source: origin.source,
    method: origin.method,
    confirmed: false,
    provenance: {
      engineAssetId: LEGACY_CLASSIFICATION_ASSET_ID,
      ruleSet: LEGACY_RULE_SET,
      autoCategorize,
      inputChannel,
    },
  });
  const { confidenceReference: _absentLegacyConfidenceReference, ...classification } = validatedClassification;
  return Object.freeze({ category, classification });
}

export function adaptLegacyParsedRecordToExpenseSourceCandidate(record, context = {}) {
  if (!isObject(record)) throw adapterError('INVALID_LEGACY_RECORD', 'legacy parsed record must be an object');
  const inputChannel = resolveChannel(context);
  const normalized = normalizeExpenseRecord(record, {
    amountsAsCents: context.amountsAsCents === true,
    autoCategorize: context.autoCategorize,
    defaultCurrency: context.defaultCurrency,
  });
  if (!normalized.platform) throw adapterError('MISSING_LEGACY_PLATFORM', 'legacy record platform is required');
  if (!normalized.occurredAt) throw adapterError('MISSING_OCCURRED_AT', 'legacy record date is required');
  if (!Number.isInteger(normalized.amountCents) || normalized.amountCents === 0) {
    throw adapterError('INVALID_AMOUNT', 'legacy record amount must normalize to non-zero integer cents');
  }

  const classification = applyLegacyClassificationToCandidate(normalized, {
    ...context,
    inputChannel,
    rawRecord: record,
  });
  const parserAssetId = context.parserAssetId ?? LEGACY_COMPATIBILITY_ASSET_ID;
  const platform = normalizePlatform(normalized.platform);
  const source = {
    sourceKind: resolveSourceKind(platform, inputChannel, context.detectedPlatform),
    platform,
    externalReference: normalized.dedupeKey,
    provenance: {
      parserContract: '0.1',
      parserAssetId,
      inputChannel,
      legacyPlatform: platform,
    },
  };
  if (normalized.sourceId) source.sourceId = normalized.sourceId;

  const candidateInput = {
    source,
    occurredAt: normalized.occurredAt,
    amountCents: normalized.amountCents,
    merchant: normalized.merchant,
    direction: normalized.direction,
    category: classification.category,
    note: normalized.note,
    currency: normalized.currency,
    classification: classification.classification,
  };
  const originalId = String(record.id ?? '').trim();
  if (originalId) candidateInput.id = originalId;
  if (typeof record.createdAt === 'string' && record.createdAt.trim()) {
    candidateInput.createdAt = record.createdAt;
  }

  return withoutLegacyConfidence(createExpenseSourceCandidate(candidateInput));
}

function diagnosticFrom(error, index) {
  return Object.freeze({
    index,
    code: error?.code ?? 'LEGACY_ADAPTER_FAILED',
    message: error?.message ?? 'legacy record adaptation failed',
  });
}

function adaptBatch(records, context) {
  const candidates = [];
  const diagnostics = [];
  records.forEach((record, index) => {
    try {
      candidates.push(adaptLegacyParsedRecordToExpenseSourceCandidate(record, context));
    } catch (error) {
      diagnostics.push(diagnosticFrom(error, index));
    }
  });
  return {
    candidates: Object.freeze(candidates),
    diagnostics: Object.freeze(diagnostics),
  };
}

export function parseLegacyInboxJsonToCandidateBatch(text, context = {}) {
  const parsed = parseLegacyInboxJson(text);
  if (!parsed.ok) return parsed;
  const adapted = adaptBatch(parsed.data.records, {
    ...context,
    inputChannel: 'inbox_json',
    parserAssetId: LEGACY_INBOX_JSON_ASSET_ID,
  });
  return Object.freeze({
    ok: true,
    assetId: LEGACY_INBOX_JSON_ASSET_ID,
    data: Object.freeze({ candidates: adapted.candidates }),
    diagnostics: adapted.diagnostics,
  });
}

function adaptCsvPreview(parsed, context) {
  if (!parsed.ok) return parsed;
  const adapted = adaptBatch(parsed.data.drafts, {
    ...context,
    amountsAsCents: true,
    detectedPlatform: parsed.data.platform,
  });
  return Object.freeze({
    ok: true,
    assetId: parsed.assetId,
    data: Object.freeze({
      ...parsed.data,
      candidates: adapted.candidates,
      adapterDiagnostics: adapted.diagnostics,
    }),
    diagnostics: parsed.diagnostics,
  });
}

export function parseLegacyCsvToCandidatePreview(text, context = {}) {
  const parsed = parseLegacyExpenseCsv(text, context);
  return adaptCsvPreview(parsed, {
    ...context,
    inputChannel: 'csv',
    parserAssetId: LEGACY_CSV_PREVIEW_ASSET_ID,
  });
}

export function parseLegacyWeChatBillCsvToCandidatePreview(text, context = {}) {
  const parsed = parseLegacyWeChatBillCsv(text, context);
  return adaptCsvPreview(parsed, {
    ...context,
    inputChannel: 'wechat_bill_csv',
    parserAssetId: LEGACY_WECHAT_BILL_CSV_ASSET_ID,
  });
}
