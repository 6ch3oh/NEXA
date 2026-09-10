import { join, resolve } from 'node:path';

import { EvaluationStore } from '../evaluation-store.mjs';
import { ScoreStore } from '../scoring/score-store.mjs';
import { HistoricalUsageStore } from '../token-intelligence/historical-usage-store.mjs';
import { createStarBenchProductStateSummary } from './starbench-product-state-projection.mjs';

export const STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION = '0.1.0';

const capabilityNames = Object.freeze([
  'evaluation_results',
  'evaluation_history',
  'evidence',
  'request_records',
  'token_cost_observations',
  'external_identity_evidence',
]);
const optionKeys = Object.freeze(['dataRoot', 'clock', 'staleAfterMs', 'defaultLimit']);
const maxItems = 200;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

const EXTERNAL_IDENTITY_WARNING = '外部身份参考不得证明官方身份。';

function checkedAt(clock) {
  const value = clock();
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function unavailable(reasonCode, clock, safetyNotice = null) {
  return { status: 'unavailable', items: [], as_of: null, cursor: null, summary: createStarBenchProductStateSummary('unavailable', { checkedAt: checkedAt(clock), reasonCode, safetyNotice }) };
}

function readFailure(reasonCode, clock) {
  return { status: 'error', items: [], as_of: null, cursor: null, summary: createStarBenchProductStateSummary('error', { checkedAt: checkedAt(clock), reasonCode }) };
}

function timestampOf(item) {
  const candidates = [item?.timestamp, item?.recorded_at, item?.source_record_timestamp, item?.provenance?.recorded_at, item?.provenance?.source_record_timestamp];
  return candidates.find((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))) ?? null;
}

function page(records, query, { clock, staleAfterMs, defaultLimit }) {
  if (!plain(query)) throw new TypeError('Runtime reader query must be a plain object.');
  const limit = query.limit ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxItems) throw new TypeError('Runtime reader limit is invalid.');
  const hasCursor = query.cursor !== undefined && query.cursor !== null;
  const offset = hasCursor ? Number(query.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || (hasCursor && String(offset) !== String(query.cursor))) throw new TypeError('Runtime reader cursor is invalid.');
  const checked_at = checkedAt(clock);
  if (records.length === 0) return { status: 'empty', items: [], as_of: null, cursor: null, summary: createStarBenchProductStateSummary('empty', { checkedAt: checked_at, baseSummary: { total: 0, returned: 0 } }) };
  const items = structuredClone(records.slice(offset, offset + limit));
  const nextOffset = offset + items.length;
  const more = nextOffset < records.length;
  const timestamps = records.map(timestampOf).filter(Boolean).sort();
  const asOf = timestamps.at(-1) ?? null;
  const isStale = staleAfterMs !== null && asOf !== null && checked_at !== null && Date.parse(checked_at) - Date.parse(asOf) > staleAfterMs;
  const status = more ? 'partial' : isStale ? 'stale' : 'ready';
  return {
    status,
    items,
    as_of: asOf,
    cursor: more ? String(nextOffset) : null,
    summary: createStarBenchProductStateSummary(status, { checkedAt: checked_at, baseSummary: { total: records.length, returned: items.length } }),
  };
}

function storedReader(store, configuration, project = (records) => records) {
  return async (query = {}) => {
    try { return page(project(await store.readAll()), query, configuration); }
    catch { return readFailure('STARBENCH_RUNTIME_READ_FAILED', configuration.clock); }
  };
}

function fixedUnavailableReader(reasonCode, clock, safetyNotice = null) {
  return async () => unavailable(reasonCode, clock, safetyNotice);
}

function absentRootBindings(clock) {
  return Object.freeze(Object.fromEntries(capabilityNames.map((name) => [name, fixedUnavailableReader('STARBENCH_RUNTIME_DATA_ROOT_NOT_CONFIGURED', clock, name === 'external_identity_evidence' ? EXTERNAL_IDENTITY_WARNING : null)])));
}

export const STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT = freeze({
  contract_id: 'starbench.desktop-runtime-reader-bindings.v0.1',
  contract_version: STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION,
  public_entrypoint: 'src/public/starbench-desktop-entry.mjs',
  factory_export: 'createStarBenchDesktopRuntimeReaderBindings',
  configuration: { data_root: 'OPTIONAL_OPAQUE_ROOT', clock: 'OPTIONAL_READ_ONLY_CLOCK', stale_after_ms: 'OPTIONAL_NON_NEGATIVE_INTEGER', default_limit: 'OPTIONAL_1_TO_200' },
  capabilities: capabilityNames,
  ownership: 'STARBENCH_INTERNAL_COMPOSITION',
  private_store_exposure: false,
  write_capability_exposed: false,
  canonical_identity_authority: 'STARBENCH',
  external_identity_engine_role: 'UNTRUSTED_EXTERNAL_EVIDENCE',
  officiality_inference: 'NOT_ALLOWED',
  provider_calls: false,
  network_required: false,
});

export function createStarBenchDesktopRuntimeReaderBindings(options = {}) {
  if (!plain(options) || Object.keys(options).some((key) => !optionKeys.includes(key))) throw new TypeError('StarBench runtime reader binding options are invalid.');
  const { dataRoot = null, clock = () => new Date().toISOString(), staleAfterMs = null, defaultLimit = 50 } = options;
  if (typeof clock !== 'function' || !(staleAfterMs === null || (Number.isInteger(staleAfterMs) && staleAfterMs >= 0)) || !Number.isInteger(defaultLimit) || defaultLimit < 1 || defaultLimit > maxItems) throw new TypeError('StarBench runtime reader binding configuration is invalid.');
  if (dataRoot === null || dataRoot === undefined) return absentRootBindings(clock);
  if (typeof dataRoot !== 'string' || dataRoot.length === 0) throw new TypeError('StarBench runtime dataRoot must be one opaque root path.');
  const root = resolve(dataRoot);
  const configuration = { clock, staleAfterMs, defaultLimit };
  const evaluationStore = new EvaluationStore({ rootDir: root, filePath: join(root, 'evaluations', 'evaluations.jsonl') });
  const scoreStore = new ScoreStore({ rootDir: root, filePath: join(root, 'evidence', 'scores.jsonl') });
  const usageStore = new HistoricalUsageStore({ rootDir: root, filePath: join(root, 'token-accounting', 'historical-usage.jsonl') });
  const evaluationReader = storedReader(evaluationStore, configuration);
  const scoreReader = storedReader(scoreStore, configuration);
  return Object.freeze({
    evaluation_results: scoreReader,
    evaluation_history: evaluationReader,
    evidence: scoreReader,
    request_records: fixedUnavailableReader('REQUEST_LEDGER_RUNTIME_SOURCE_NOT_AVAILABLE', clock),
    token_cost_observations: storedReader(usageStore, configuration, (records) => records.map((record) => ({ ...record, cost: null }))),
    external_identity_evidence: fixedUnavailableReader('EXTERNAL_IDENTITY_RUNTIME_SOURCE_NOT_AVAILABLE', clock, EXTERNAL_IDENTITY_WARNING),
  });
}
