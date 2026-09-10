import { createHash } from 'node:crypto';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { plain } from '../scoring/score-contracts.mjs';
import {
  assertValidCanonicalIdentityObservation,
  CANONICAL_IDENTITY_RECORD_TYPE,
  CANONICAL_IDENTITY_SCHEMA_VERSION,
  computeCanonicalIdentityObservationId,
  EXTERNAL_EVIDENCE_SOURCE_CLASS,
  ExternalIdentityContractError,
  IDENTITY_NORMALIZATION_VERSION,
  OFFICIALITY_INFERENCE,
} from './contracts.mjs';

export const KBF_ENGINE_ID = 'KBF';
export const KBF_ENGINE_VERSION = '0.1.0';
export const KBF_SOURCE_COMMIT = 'b789b4b7abe119e28ec6260142564b2189ff5449';
export const KBF_SOURCE_FORMATS = Object.freeze(['KBF_LEGACY_CLOZE_CONSENSUS', 'KBF_SLIM_VALUE']);
export const KBF_SOURCE_VERDICTS = Object.freeze(['SAME', 'DIFF', 'UNDETERMINED', 'UNKNOWN']);

const verdictMap = Object.freeze({ SAME: 'CONSISTENT_WITH_REFERENCE', DIFF: 'INCONSISTENT_WITH_REFERENCE', UNDETERMINED: 'INSUFFICIENT_EVIDENCE', UNKNOWN: 'INSUFFICIENT_EVIDENCE' });
const referenceKnownKeys = new Set(['reference_model', 'probes', 'self_error', 'target_results', 'protocol', 'timestamp', 'contrast_model', 'n_original_probes', 'n_config_invariant', 'n_final_probes', 'consensus_configs', 'cloze_templates', 'user_prompt_template', 'domain_tolerances', 'provider_pinning', 'batch_size', 'adaptive_p0', 'config_invariant_indices', 'config_variant_indices', 'total_probes', 'generation_mode', 'verification_mode', 'numbering_format', 'min_probes_target', 'contrast_screening', 'provider_map', 'domains', 'frontier_stats']);
const resultKnownKeys = new Set(['target_model', 'reference_model', 'reference_probe_file', 'timestamp', 'api_base', 'protocol', 'test_config', 'cosplay_prompt', 'values', 'match_vector', 'correct', 'total', 'hamming', 'error_rate', 'usage', 'self_hamming', 'self_total', 'self_coverage', 'target_coverage', 'p0_cp99', 'p_value_binomial', 'verdict', 'verdict_reason', 'raw_log']);

function fail(code, message, errors = [], cause = null) { throw new ExternalIdentityContractError(code, message, errors, cause); }
function text(value) { return typeof value === 'string' && value.length > 0; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function unit(value) { return finite(value) && value >= 0 && value <= 1; }
function count(value) { return Number.isInteger(value) && value >= 0; }
function close(actual, expected, tolerance = 0.00011) { return Math.abs(actual - expected) <= tolerance; }
function rawSha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

function parseArtifact(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail('KBF_ARTIFACT_TEXT_REQUIRED', `${label} must be non-empty JSON text.`);
  let parsed;
  try { parsed = JSON.parse(value); } catch (error) { fail('KBF_ARTIFACT_JSON_INVALID', `${label} is malformed JSON.`, [{ path: '/', code: 'json' }], error); }
  if (!plain(parsed)) fail('KBF_ARTIFACT_OBJECT_REQUIRED', `${label} must contain one JSON object.`);
  try { assertNoSensitiveData(parsed, label); } catch (error) { fail('KBF_ARTIFACT_SENSITIVE_DATA_REJECTED', `${label} contains sensitive material.`, [{ path: '/', code: error.code }], error); }
  return parsed;
}

function verifyExpectedHash(textValue, expected, label) {
  if (typeof textValue !== 'string' || textValue.length === 0) fail('KBF_ARTIFACT_TEXT_REQUIRED', `${label} must be non-empty JSON text.`);
  if (!/^[a-f0-9]{64}$/u.test(expected ?? '')) fail('KBF_EXPECTED_HASH_INVALID', `${label} expected SHA-256 is invalid.`);
  const observed = rawSha256(textValue);
  if (observed !== expected) fail('KBF_ARTIFACT_HASH_MISMATCH', `${label} SHA-256 does not match the expected immutable artifact hash.`, [{ path: '/', code: 'hash_mismatch' }]);
  return observed;
}

function detectSourceFormat(reference) {
  if (!Array.isArray(reference.probes) || reference.probes.length === 0) fail('KBF_REFERENCE_PROBES_REQUIRED', 'KBF reference probes are required.');
  let legacy = 0; let slim = 0;
  for (const [index, probe] of reference.probes.entries()) {
    if (!plain(probe) || !text(probe.name) || !text(probe.domain)) fail('KBF_REFERENCE_PROBE_INVALID', 'Every KBF probe requires name and domain.', [{ path: `/probes/${index}`, code: 'probe' }]);
    const hasLegacy = Object.hasOwn(probe, 'cloze_consensus');
    const hasSlim = Object.hasOwn(probe, 'value');
    if (hasLegacy === hasSlim) fail('KBF_SOURCE_FORMAT_UNSUPPORTED', 'Probe layout is mixed, ambiguous, or unsupported.', [{ path: `/probes/${index}`, code: 'source_format' }]);
    const canonicalValue = hasLegacy ? probe.cloze_consensus : probe.value;
    if (!finite(canonicalValue)) fail('KBF_REFERENCE_VALUE_INVALID', 'Probe canonical values must be finite numbers.', [{ path: `/probes/${index}`, code: 'range' }]);
    if (hasLegacy) legacy += 1; else slim += 1;
  }
  if (legacy === reference.probes.length) return 'KBF_LEGACY_CLOZE_CONSENSUS';
  if (slim === reference.probes.length) return 'KBF_SLIM_VALUE';
  fail('KBF_SOURCE_FORMAT_UNSUPPORTED', 'KBF reference layout is unsupported.');
}

function normalizeReferencePath(value) {
  if (!text(value) || value.includes(':') || value.startsWith('/') || value.startsWith('\\')) fail('KBF_REFERENCE_PATH_UNSAFE', 'reference_probe_file must be a safe relative KBF reference path.');
  const normalized = value.replaceAll('\\', '/');
  if (!normalized.endsWith('.json') || !normalized.startsWith('probes/reference/') || !/^[A-Za-z0-9._/-]+$/u.test(normalized) || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')) fail('KBF_REFERENCE_PATH_UNSAFE', 'reference_probe_file must be a safe relative KBF reference path.');
  return normalized;
}

function validateAggregate({ correct, total, hamming, error_rate: errorRate }, label) {
  if (![correct, total, hamming].every(count) || !unit(errorRate) || correct + hamming !== total || !close(errorRate, total === 0 ? 0 : hamming / total)) fail('KBF_AGGREGATE_INVALID', `${label} aggregate counts or error rate are inconsistent.`);
}

function validateVector(result, probeCount) {
  if (!Array.isArray(result.values) || !Array.isArray(result.match_vector) || result.values.length !== probeCount || result.match_vector.length !== probeCount) fail('KBF_RESULT_VECTOR_INVALID', 'KBF values and match_vector must align with all reference probes.');
  if (!result.values.every((value) => value === null || finite(value)) || !result.match_vector.every((value) => value === null || value === 0 || value === 1)) fail('KBF_RESULT_VECTOR_INVALID', 'KBF result vectors contain an invalid value.');
  const answered = result.match_vector.filter((value) => value !== null).length;
  const correct = result.match_vector.filter((value) => value === 1).length;
  const hamming = result.match_vector.filter((value) => value === 0).length;
  if (answered !== result.total || correct !== result.correct || hamming !== result.hamming) fail('KBF_RESULT_VECTOR_INVALID', 'KBF result vectors do not reconcile with aggregate counts.');
  for (let index = 0; index < probeCount; index += 1) if ((result.values[index] === null) !== (result.match_vector[index] === null)) fail('KBF_RESULT_VECTOR_INVALID', 'KBF values and match_vector null positions must align.');
}

function selfEvidence(reference, verdict, probeCount) {
  const key = reference.reference_model.split('/').at(-1);
  const entry = plain(reference.target_results) ? reference.target_results[key] : null;
  if (!plain(entry)) {
    if (verdict === 'UNKNOWN') return { selfTotal: null, selfHamming: null, selfCoverage: null, selfError: null };
    fail('KBF_REFERENCE_SELF_TEST_REQUIRED', 'KBF reference self-test evidence is required for this verdict.');
  }
  validateAggregate(entry, 'KBF reference self-test');
  if (entry.total > probeCount) fail('KBF_REFERENCE_SELF_TEST_INVALID', 'KBF reference self-test answered count exceeds total probes.');
  const selfCoverage = entry.total / probeCount;
  const selfError = entry.total === 0 ? 0 : entry.hamming / entry.total;
  if (!unit(reference.self_error) || !close(reference.self_error, selfError)) fail('KBF_REFERENCE_SELF_ERROR_INVALID', 'KBF top-level self_error does not match self-test evidence.');
  return { selfTotal: entry.total, selfHamming: entry.hamming, selfCoverage, selfError };
}

function validateCore(reference, result) {
  if (!text(reference.reference_model) || !text(result.reference_model) || !text(result.target_model) || reference.reference_model !== result.reference_model) fail('KBF_MODEL_CLAIM_INVALID', 'Reference and target model claims are missing or inconsistent.');
  if (!KBF_SOURCE_VERDICTS.includes(result.verdict)) fail('KBF_SOURCE_VERDICT_UNKNOWN', 'KBF source verdict is unknown and cannot be normalized.');
  if (!text(result.timestamp) || Number.isNaN(Date.parse(result.timestamp)) || !text(result.protocol) || !plain(result.test_config)) fail('KBF_PROVENANCE_INVALID', 'KBF result provenance is incomplete or malformed.');
  const referenceProbeFile = normalizeReferencePath(result.reference_probe_file);
  const sourceFormat = detectSourceFormat(reference);
  const probeCount = reference.probes.length;
  if (Object.hasOwn(reference, 'total_probes') && (!count(reference.total_probes) || reference.total_probes !== probeCount)) fail('KBF_REFERENCE_PROBE_COUNT_INVALID', 'KBF total_probes does not match probes.');
  if (Object.hasOwn(reference, 'n_final_probes') && (!count(reference.n_final_probes) || reference.n_final_probes !== probeCount)) fail('KBF_REFERENCE_PROBE_COUNT_INVALID', 'KBF n_final_probes does not match probes.');
  validateAggregate(result, 'KBF target result');
  if (result.total > probeCount) fail('KBF_PROBE_COUNT_INVALID', 'KBF target answered count exceeds total probes.');
  validateVector(result, probeCount);
  const self = selfEvidence(reference, result.verdict, probeCount);
  const expectedTargetCoverage = result.total / probeCount;
  if (!unit(result.target_coverage) || !close(result.target_coverage, expectedTargetCoverage)) fail('KBF_COVERAGE_INVALID', 'KBF target coverage is outside range or inconsistent with counts.');
  if (self.selfCoverage !== null && (!unit(result.self_coverage) || !close(result.self_coverage, self.selfCoverage) || result.self_total !== self.selfTotal || result.self_hamming !== self.selfHamming)) fail('KBF_SELF_EVIDENCE_INVALID', 'KBF result self-test facts differ from the reference artifact.');
  if (result.verdict === 'UNKNOWN') {
    if (!text(result.verdict_reason)) fail('KBF_VERDICT_REASON_REQUIRED', 'UNKNOWN requires a source verdict reason.');
  } else if (result.verdict === 'UNDETERMINED') {
    if (!text(result.verdict_reason) || !((self.selfCoverage ?? 0) < 0.5 || expectedTargetCoverage < 0.5)) fail('KBF_UNDETERMINED_INCONSISTENT', 'UNDETERMINED requires insufficient coverage evidence.');
    if (finite(result.p0_cp99) || finite(result.p_value_binomial)) fail('KBF_UNDETERMINED_STATISTICS_CONFLICT', 'UNDETERMINED must not carry decisive statistics.');
  } else {
    if (!unit(result.p0_cp99) || !unit(result.p_value_binomial)) fail('KBF_STATISTICAL_EVIDENCE_INVALID', 'SAME and DIFF require bounded KBF statistical evidence.');
    if ((result.verdict === 'DIFF') !== (result.p_value_binomial < 0.05)) fail('KBF_VERDICT_STATISTICS_CONFLICT', 'KBF verdict conflicts with its pinned alpha rule.');
  }
  return { sourceFormat, probeCount, referenceProbeFile, ...self };
}

function warningsFor(reference, result) {
  const warnings = ['REFERENCE_CONSISTENCY_IS_NOT_OFFICIALITY'];
  if (Object.keys(reference).some((key) => !referenceKnownKeys.has(key))) warnings.push('UNRECOGNIZED_REFERENCE_FIELDS_IGNORED');
  if (Object.keys(result).some((key) => !resultKnownKeys.has(key))) warnings.push('UNRECOGNIZED_RESULT_FIELDS_IGNORED');
  if (Object.hasOwn(result, 'raw_log')) warnings.push('KBF_RAW_LOG_NOT_CANONICALIZED');
  if (Object.hasOwn(result, 'api_base')) warnings.push('KBF_ENDPOINT_METADATA_NOT_EXECUTED');
  if (['UNDETERMINED', 'UNKNOWN'].includes(result.verdict)) warnings.push('KBF_REPORTED_INSUFFICIENT_EVIDENCE');
  return [...new Set(warnings)].sort();
}

export function normalizeKbfOfflineEvidence({ referenceArtifact, targetArtifact, expectedReferenceSha256, expectedRawArtifactSha256, engineSourceCommit = KBF_SOURCE_COMMIT } = {}) {
  if (engineSourceCommit !== KBF_SOURCE_COMMIT) fail('KBF_SOURCE_COMMIT_UNSUPPORTED', 'KBF evidence must identify the pinned audited source commit.');
  const referenceHash = verifyExpectedHash(referenceArtifact, expectedReferenceSha256, 'KBF reference artifact');
  const rawHash = verifyExpectedHash(targetArtifact, expectedRawArtifactSha256, 'KBF target artifact');
  const reference = parseArtifact(referenceArtifact, 'KBF reference artifact');
  const result = parseArtifact(targetArtifact, 'KBF target artifact');
  const facts = validateCore(reference, result);
  const normalizedVerdict = verdictMap[result.verdict];
  const sufficient = normalizedVerdict !== 'INSUFFICIENT_EVIDENCE';
  const observation = {
    schema_version: CANONICAL_IDENTITY_SCHEMA_VERSION,
    record_type: CANONICAL_IDENTITY_RECORD_TYPE,
    observation_id: '',
    engine: { engine_id: KBF_ENGINE_ID, engine_class: 'EXTERNAL_IDENTITY_ENGINE', engine_version: KBF_ENGINE_VERSION, source_commit: KBF_SOURCE_COMMIT, source_format: facts.sourceFormat },
    model_claims: { reference_model: reference.reference_model, target_model: result.target_model },
    source_verdict: result.verdict,
    normalized_verdict: normalizedVerdict,
    coverage: { reference_self: facts.selfCoverage === null ? null : Number(facts.selfCoverage.toFixed(4)), target: result.target_coverage },
    errors: { reference_self: facts.selfError === null ? null : Number(facts.selfError.toFixed(4)), target: result.error_rate },
    statistical_evidence: { method: 'KBF_CP99_ONE_SIDED_BINOMIAL', confidence_level: 0.99, alpha: 0.05, reference_error_upper_bound: sufficient ? result.p0_cp99 : null, p_value: sufficient ? result.p_value_binomial : null },
    probe_counts: { reference_answered: facts.selfTotal, target_answered: result.total, total: facts.probeCount },
    artifact_integrity: { algorithm: 'SHA-256', status: 'VERIFIED', raw_artifact_sha256: rawHash, reference_artifact_sha256: referenceHash },
    provenance: { source_class: EXTERNAL_EVIDENCE_SOURCE_CLASS, adapter_identity: 'starbench.kbf-offline-adapter', adapter_version: '0.1.0', source_record_timestamp: result.timestamp, reference_probe_file: facts.referenceProbeFile, protocol: result.protocol },
    normalization_version: IDENTITY_NORMALIZATION_VERSION,
    evidence_sufficiency: sufficient ? 'SUFFICIENT' : 'INSUFFICIENT',
    officiality_inference: OFFICIALITY_INFERENCE,
    warnings: warningsFor(reference, result),
  };
  observation.observation_id = computeCanonicalIdentityObservationId(observation);
  return structuredClone(assertValidCanonicalIdentityObservation(observation));
}

export function computeKbfArtifactSha256(artifactText) {
  if (typeof artifactText !== 'string') fail('KBF_ARTIFACT_TEXT_REQUIRED', 'KBF artifact must be JSON text.');
  return rawSha256(artifactText);
}
