import { assertNoSensitiveData } from '../credential-provider.mjs';
import { importRawResult } from '../raw-result-importer.mjs';
import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { normalizeIdentityTokenUsage } from './identity-token-accounting.mjs';
import {
  AMD_QUICK_CLAIMED_MODEL,
  AMD_QUICK_MAX_REQUESTS,
  AMD_QUICK_OBSERVED_TOKEN_STOP,
  AMD_QUICK_TARGET_URL,
  AmdQuickGateError,
} from './amd-quick-capability-contracts.mjs';

export const AMD_QUICK_REQUEST_LEDGER_VERSION = '0.1.0';
export const AMD_QUICK_REQUEST_DECISIONS = Object.freeze(['CONTINUE', 'STOP']);

function fail(code, message, cause = null) { throw new AmdQuickGateError(code, message, cause); }
function exact(value, keys, code) {
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) fail(code, 'AMD QUICK Request Ledger shape is invalid.');
}
function nullableInteger(value) { return value === null || (Number.isInteger(value) && value >= 0); }

export function normalizeAmdProviderUsage(value, { sourceClass = 'PROVIDER_RESPONSE', usageRequired = true } = {}) {
  if (value === null || value === undefined) {
    if (usageRequired) fail('STOP_USAGE_UNAVAILABLE', 'AMD usage is required.');
    return normalizeIdentityTokenUsage(null);
  }
  if (!plain(value)) fail('STOP_USAGE_MALFORMED', 'AMD usage must be an object.');
  const reasoning = value.completion_tokens_details?.reasoning_tokens ?? null;
  const cached = value.prompt_tokens_details?.cached_tokens ?? null;
  const completion = value.completion_tokens ?? null;
  if (reasoning !== null && (!(Number.isInteger(reasoning) && reasoning >= 0) || !(Number.isInteger(completion) && completion >= reasoning))) fail('STOP_USAGE_MALFORMED', 'AMD reasoning usage is inconsistent with completion_tokens.');
  let normalized;
  try {
    normalized = normalizeIdentityTokenUsage({
      source_class: sourceClass,
      input_tokens: value.prompt_tokens ?? null,
      output_tokens: reasoning === null ? completion : completion - reasoning,
      reasoning_tokens: reasoning,
      cached_input_tokens: cached,
      total_tokens: value.total_tokens ?? null,
    });
  } catch (error) {
    fail('STOP_USAGE_MALFORMED', 'AMD usage is malformed or internally inconsistent.', error);
  }
  if (normalized.total_tokens === null) fail('STOP_USAGE_UNAVAILABLE', 'AMD usage.total_tokens is required.');
  return normalized;
}

export function makeAmdQuickLedgerEntry({
  pilotId,
  sequence,
  role,
  taskIdentity,
  rawResult,
  canonicalEvaluation,
  usage,
  cumulativeBefore,
  decision,
  decisionReason,
  nextRequestAllowed,
  rawArtifactReference,
} = {}) {
  if (typeof pilotId !== 'string' || !pilotId || !Number.isInteger(sequence) || sequence < 1 || sequence > AMD_QUICK_MAX_REQUESTS || !['PREFLIGHT', 'LEGACY_ANCHOR'].includes(role)) fail('REQUEST_LEDGER_INPUT_INVALID', 'Request Ledger identity is invalid.');
  if (!plain(taskIdentity) || typeof taskIdentity.task_id !== 'string' || typeof taskIdentity.task_version !== 'string') fail('REQUEST_LEDGER_TASK_INVALID', 'Request Ledger task identity is invalid.');
  const imported = importRawResult(rawResult);
  if (!plain(canonicalEvaluation) || canonicalEvaluation.evaluation_id !== imported.evaluation_id || canonicalEvaluation.raw_source_identity?.raw_record_sha256 !== imported.raw_source_identity.raw_record_sha256 || canonicalEvaluation.raw_source_identity?.raw_run_id !== rawResult.run_id) fail('REQUEST_LEDGER_CANONICAL_MISMATCH', 'Canonical Evaluation does not match RAW_RESULT authority.');
  const normalizedUsage = typeof usage?.usage_id === 'string' && typeof usage?.status === 'string' ? structuredClone(usage) : normalizeAmdProviderUsage(usage);
  if (!Number.isInteger(cumulativeBefore) || cumulativeBefore < 0) fail('REQUEST_LEDGER_CUMULATIVE_INVALID', 'Cumulative Token state is invalid.');
  const current = normalizedUsage.total_tokens;
  const cumulativeAfter = current === null ? cumulativeBefore : cumulativeBefore + current;
  if (!AMD_QUICK_REQUEST_DECISIONS.includes(decision) || typeof decisionReason !== 'string' || !decisionReason || typeof nextRequestAllowed !== 'boolean' || (decision === 'CONTINUE') !== nextRequestAllowed) fail('REQUEST_LEDGER_DECISION_INVALID', 'Request continuation decision is invalid.');
  if (sequence === AMD_QUICK_MAX_REQUESTS && decision !== 'STOP') fail('REQUEST_LEDGER_REQUEST_CEILING_INVALID', 'Request 4 must stop the QUICK Pilot.');
  if (cumulativeAfter >= AMD_QUICK_OBSERVED_TOKEN_STOP && (decision !== 'STOP' || decisionReason !== 'STOP_TOKEN_CEILING_REACHED')) fail('REQUEST_LEDGER_TOKEN_STOP_INVALID', 'Observed Token ceiling must create an immediate stop.');
  if (!plain(rawArtifactReference) || rawArtifactReference.run_id !== rawResult.run_id || rawArtifactReference.sha256 !== imported.raw_source_identity.raw_record_sha256 || rawArtifactReference.canonical_evaluation_id !== canonicalEvaluation.evaluation_id || !(rawArtifactReference.path === null || typeof rawArtifactReference.path === 'string') || typeof rawArtifactReference.artifact_id !== 'string') fail('REQUEST_LEDGER_RAW_REFERENCE_INVALID', 'RAW_RESULT reference is invalid.');
  const http = rawResult.metadata?.http_evidence;
  if (!plain(http) || !['HTTP_RESPONSE_RECEIVED', 'FAILED_BEFORE_HTTP'].includes(http.transport_status) || !(http.status_code === null || Number.isInteger(http.status_code)) || typeof http.response_timestamp !== 'string' || Number.isNaN(Date.parse(http.response_timestamp)) || !(http.content_type === null || typeof http.content_type === 'string') || !(http.redirect_status === null || Number.isInteger(http.redirect_status))) fail('REQUEST_LEDGER_HTTP_EVIDENCE_INVALID', 'HTTP evidence is incomplete.');
  if (http.transport_status === 'HTTP_RESPONSE_RECEIVED' && !Number.isInteger(http.status_code)) fail('REQUEST_LEDGER_HTTP_STATUS_MISSING', 'HTTP response status is required.');
  if (rawResult.success && (http.status_code < 200 || http.status_code >= 300)) fail('REQUEST_LEDGER_HTTP_STATUS_INVALID', 'Successful RAW_RESULT requires a 2xx HTTP status.');
  const started = rawResult.timestamp;
  const ended = new Date(Date.parse(started) + rawResult.latency_ms).toISOString();
  const semantic = {
    pilot_id: pilotId,
    request_sequence: sequence,
    request_role: role,
    request_id: `${pilotId}:request:${sequence}`,
    task_identity: structuredClone(taskIdentity),
    timestamp_start: started,
    timestamp_end: ended,
    latency_ms: rawResult.latency_ms,
    target_identity: { url: AMD_QUICK_TARGET_URL, endpoint_class: rawResult.request_provenance.endpoint_class },
    claimed_model: AMD_QUICK_CLAIMED_MODEL,
    http_evidence: structuredClone(http),
    response_schema_status: rawResult.metadata?.response_schema_status ?? 'INVALID',
    output_byte_count: rawResult.metadata?.output_bytes ?? null,
    output_token_limit: rawResult.parameters?.max_output_tokens ?? null,
    usage: normalizedUsage,
    observed_request_tokens: current,
    cumulative_tokens: { before: cumulativeBefore, current, after: cumulativeAfter },
    token_ceiling: AMD_QUICK_OBSERVED_TOKEN_STOP,
    continuation_decision: decision,
    decision_reason: decisionReason,
    next_request_allowed: nextRequestAllowed,
    raw_evidence_reference: structuredClone(rawArtifactReference),
  };
  const entry = {
    schema_version: '0.1',
    record_type: 'AMD_QUICK_REQUEST_LEDGER_ENTRY',
    ledger_version: AMD_QUICK_REQUEST_LEDGER_VERSION,
    evidence_hash: stableSha256(semantic),
    ...semantic,
  };
  assertNoSensitiveData(entry, 'AMD QUICK Request Ledger entry');
  return entry;
}

export function validateAmdQuickRequestLedger({ entries, rawResults, canonicalEvaluations } = {}) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > AMD_QUICK_MAX_REQUESTS || !Array.isArray(rawResults) || !Array.isArray(canonicalEvaluations)) fail('REQUEST_LEDGER_INVALID', 'Request Ledger collections are invalid.');
  const rawByRun = new Map(rawResults.map((item) => [item.run_id, item]));
  const canonicalById = new Map(canonicalEvaluations.map((item) => [item.evaluation_id, item]));
  if (rawByRun.size !== rawResults.length || canonicalById.size !== canonicalEvaluations.length) fail('REQUEST_LEDGER_DUPLICATE_EVIDENCE', 'Request Ledger evidence identities must be unique.');
  let cumulative = 0;
  let pilotId = null;
  const requestIds = new Set();
  for (const [index, entry] of entries.entries()) {
    const keys = ['schema_version', 'record_type', 'ledger_version', 'evidence_hash', 'pilot_id', 'request_sequence', 'request_role', 'request_id', 'task_identity', 'timestamp_start', 'timestamp_end', 'latency_ms', 'target_identity', 'claimed_model', 'http_evidence', 'response_schema_status', 'output_byte_count', 'output_token_limit', 'usage', 'observed_request_tokens', 'cumulative_tokens', 'token_ceiling', 'continuation_decision', 'decision_reason', 'next_request_allowed', 'raw_evidence_reference'];
    exact(entry, keys, 'REQUEST_LEDGER_ENTRY_INVALID');
    if (entry.schema_version !== '0.1' || entry.record_type !== 'AMD_QUICK_REQUEST_LEDGER_ENTRY' || entry.ledger_version !== AMD_QUICK_REQUEST_LEDGER_VERSION || entry.request_sequence !== index + 1) fail('REQUEST_LEDGER_SEQUENCE_INVALID', 'Request sequence must be contiguous from 1.');
    pilotId ??= entry.pilot_id;
    if (entry.pilot_id !== pilotId || requestIds.has(entry.request_id)) fail('REQUEST_LEDGER_DUPLICATE_REQUEST', 'Pilot and request identities must be unique and consistent.');
    requestIds.add(entry.request_id);
    if (!nullableInteger(entry.observed_request_tokens) || !plain(entry.cumulative_tokens) || entry.cumulative_tokens.before !== cumulative || entry.cumulative_tokens.current !== entry.observed_request_tokens || entry.cumulative_tokens.after !== cumulative + (entry.observed_request_tokens ?? 0)) fail('REQUEST_LEDGER_CUMULATIVE_CONFLICT', 'Cumulative Token arithmetic is inconsistent.');
    cumulative = entry.cumulative_tokens.after;
    if (entry.token_ceiling !== AMD_QUICK_OBSERVED_TOKEN_STOP || (cumulative >= AMD_QUICK_OBSERVED_TOKEN_STOP && (entry.continuation_decision !== 'STOP' || entry.decision_reason !== 'STOP_TOKEN_CEILING_REACHED'))) fail('REQUEST_LEDGER_TOKEN_STOP_INVALID', 'Token stop decision is inconsistent.');
    if (!AMD_QUICK_REQUEST_DECISIONS.includes(entry.continuation_decision) || typeof entry.decision_reason !== 'string' || !entry.decision_reason || (entry.continuation_decision === 'CONTINUE') !== entry.next_request_allowed) fail('REQUEST_LEDGER_DECISION_INVALID', 'Request decision evidence is missing or inconsistent.');
    if (index < entries.length - 1 && entry.continuation_decision !== 'CONTINUE') fail('REQUEST_LEDGER_CONTINUATION_INVALID', 'A stopped request cannot have a later request.');
    if (entry.request_sequence === AMD_QUICK_MAX_REQUESTS && entry.continuation_decision !== 'STOP') fail('REQUEST_LEDGER_REQUEST_CEILING_INVALID', 'Request 4 must stop.');
    const ref = entry.raw_evidence_reference;
    const raw = rawByRun.get(ref?.run_id);
    const canonical = canonicalById.get(ref?.canonical_evaluation_id);
    if (!raw || !canonical) fail('REQUEST_LEDGER_REFERENCE_NOT_FOUND', 'Request Ledger evidence reference does not exist.');
    const imported = importRawResult(raw);
    if (imported.raw_source_identity.raw_record_sha256 !== ref.sha256 || imported.evaluation_id !== canonical.evaluation_id || canonical.raw_source_identity?.raw_record_sha256 !== ref.sha256 || canonical.raw_source_identity?.raw_run_id !== raw.run_id) fail('REQUEST_LEDGER_EVIDENCE_HASH_MISMATCH', 'RAW_RESULT or Canonical Evaluation evidence does not match its ledger reference.');
    const semantic = Object.fromEntries(keys.filter((key) => !['schema_version', 'record_type', 'ledger_version', 'evidence_hash'].includes(key)).map((key) => [key, entry[key]]));
    if (entry.evidence_hash !== stableSha256(semantic)) fail('REQUEST_LEDGER_ENTRY_HASH_MISMATCH', 'Request Ledger evidence hash is invalid.');
    const http = entry.http_evidence;
    if (!plain(http) || !['HTTP_RESPONSE_RECEIVED', 'FAILED_BEFORE_HTTP'].includes(http.transport_status) || (http.transport_status === 'HTTP_RESPONSE_RECEIVED' && !Number.isInteger(http.status_code))) fail('REQUEST_LEDGER_HTTP_STATUS_MISSING', 'HTTP status evidence is missing.');
  }
  return { status: 'VALID', pilot_id: pilotId, request_count: entries.length, cumulative_total_tokens: cumulative, final_decision: entries.at(-1).continuation_decision };
}
