import { plain, stableSha256 } from '../scoring/score-contracts.mjs';

export const CANONICAL_IDENTITY_SCHEMA_VERSION = '0.1';
export const CANONICAL_IDENTITY_RECORD_TYPE = 'CANONICAL_IDENTITY_OBSERVATION';
export const IDENTITY_NORMALIZATION_VERSION = '0.1.0';
export const EXTERNAL_EVIDENCE_SOURCE_CLASS = 'UNTRUSTED_EXTERNAL_EVIDENCE';
export const OFFICIALITY_INFERENCE = 'NOT_ALLOWED';
export const NORMALIZED_IDENTITY_VERDICTS = Object.freeze([
  'CONSISTENT_WITH_REFERENCE',
  'INCONSISTENT_WITH_REFERENCE',
  'INSUFFICIENT_EVIDENCE',
]);

const observationKeys = Object.freeze([
  'schema_version', 'record_type', 'observation_id', 'engine', 'model_claims',
  'source_verdict', 'normalized_verdict', 'coverage', 'errors', 'statistical_evidence',
  'probe_counts', 'artifact_integrity', 'provenance', 'normalization_version',
  'evidence_sufficiency', 'officiality_inference', 'warnings',
]);

function text(value) { return typeof value === 'string' && value.length > 0; }
function finiteUnit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function nullableUnit(value) { return value === null || finiteUnit(value); }
function nullableCount(value) { return value === null || (Number.isInteger(value) && value >= 0); }
function exactKeys(value, keys, errors, path) {
  if (!plain(value)) { errors.push({ path, code: 'type' }); return; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push({ path: `${path}/${key}`, code: 'additional_property' });
  for (const key of keys) if (!(key in value)) errors.push({ path: `${path}/${key}`, code: 'required' });
}

export class ExternalIdentityContractError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ExternalIdentityContractError';
    this.code = code;
    this.errors = errors;
  }
}

export function computeCanonicalIdentityObservationId(observation) {
  const payload = structuredClone(observation);
  delete payload.observation_id;
  return `identity_observation_${stableSha256(payload)}`;
}

export function validateCanonicalIdentityObservation(observation) {
  const errors = [];
  exactKeys(observation, observationKeys, errors, '');
  if (!plain(observation)) return { valid: false, errors };
  if (observation.schema_version !== CANONICAL_IDENTITY_SCHEMA_VERSION || observation.record_type !== CANONICAL_IDENTITY_RECORD_TYPE) errors.push({ path: '/', code: 'contract' });
  if (!/^identity_observation_[a-f0-9]{64}$/u.test(observation.observation_id ?? '') || computeCanonicalIdentityObservationId(observation) !== observation.observation_id) errors.push({ path: '/observation_id', code: 'identity' });

  exactKeys(observation.engine, ['engine_id', 'engine_class', 'engine_version', 'source_commit', 'source_format'], errors, '/engine');
  if (!text(observation.engine?.engine_id) || observation.engine?.engine_class !== 'EXTERNAL_IDENTITY_ENGINE' || !text(observation.engine?.engine_version) || !/^[a-f0-9]{40}$/u.test(observation.engine?.source_commit ?? '') || !text(observation.engine?.source_format)) errors.push({ path: '/engine', code: 'identity' });

  exactKeys(observation.model_claims, ['reference_model', 'target_model'], errors, '/model_claims');
  if (!text(observation.model_claims?.reference_model) || !text(observation.model_claims?.target_model)) errors.push({ path: '/model_claims', code: 'claim' });
  if (!text(observation.source_verdict) || !NORMALIZED_IDENTITY_VERDICTS.includes(observation.normalized_verdict)) errors.push({ path: '/normalized_verdict', code: 'verdict' });

  exactKeys(observation.coverage, ['reference_self', 'target'], errors, '/coverage');
  if (!nullableUnit(observation.coverage?.reference_self) || !nullableUnit(observation.coverage?.target)) errors.push({ path: '/coverage', code: 'range' });
  exactKeys(observation.errors, ['reference_self', 'target'], errors, '/errors');
  if (!nullableUnit(observation.errors?.reference_self) || !nullableUnit(observation.errors?.target)) errors.push({ path: '/errors', code: 'range' });

  exactKeys(observation.statistical_evidence, ['method', 'confidence_level', 'alpha', 'reference_error_upper_bound', 'p_value'], errors, '/statistical_evidence');
  if (observation.statistical_evidence?.method !== 'KBF_CP99_ONE_SIDED_BINOMIAL' || observation.statistical_evidence?.confidence_level !== 0.99 || observation.statistical_evidence?.alpha !== 0.05 || !nullableUnit(observation.statistical_evidence?.reference_error_upper_bound) || !nullableUnit(observation.statistical_evidence?.p_value)) errors.push({ path: '/statistical_evidence', code: 'contract' });

  exactKeys(observation.probe_counts, ['reference_answered', 'target_answered', 'total'], errors, '/probe_counts');
  if (!nullableCount(observation.probe_counts?.reference_answered) || !nullableCount(observation.probe_counts?.target_answered) || !nullableCount(observation.probe_counts?.total) || (observation.probe_counts?.target_answered !== null && observation.probe_counts?.total !== null && observation.probe_counts.target_answered > observation.probe_counts.total)) errors.push({ path: '/probe_counts', code: 'range' });

  exactKeys(observation.artifact_integrity, ['algorithm', 'status', 'raw_artifact_sha256', 'reference_artifact_sha256'], errors, '/artifact_integrity');
  if (observation.artifact_integrity?.algorithm !== 'SHA-256' || observation.artifact_integrity?.status !== 'VERIFIED' || !/^[a-f0-9]{64}$/u.test(observation.artifact_integrity?.raw_artifact_sha256 ?? '') || !/^[a-f0-9]{64}$/u.test(observation.artifact_integrity?.reference_artifact_sha256 ?? '')) errors.push({ path: '/artifact_integrity', code: 'hash' });

  exactKeys(observation.provenance, ['source_class', 'adapter_identity', 'adapter_version', 'source_record_timestamp', 'reference_probe_file', 'protocol'], errors, '/provenance');
  if (observation.provenance?.source_class !== EXTERNAL_EVIDENCE_SOURCE_CLASS || observation.provenance?.adapter_identity !== 'starbench.kbf-offline-adapter' || observation.provenance?.adapter_version !== '0.1.0' || !text(observation.provenance?.source_record_timestamp) || Number.isNaN(Date.parse(observation.provenance.source_record_timestamp)) || !text(observation.provenance?.reference_probe_file) || !text(observation.provenance?.protocol)) errors.push({ path: '/provenance', code: 'provenance' });

  if (observation.normalization_version !== IDENTITY_NORMALIZATION_VERSION || !['SUFFICIENT', 'INSUFFICIENT'].includes(observation.evidence_sufficiency) || observation.officiality_inference !== OFFICIALITY_INFERENCE || !Array.isArray(observation.warnings) || !observation.warnings.every(text) || new Set(observation.warnings).size !== observation.warnings.length) errors.push({ path: '/', code: 'governance' });
  if (observation.normalized_verdict === 'INSUFFICIENT_EVIDENCE' && observation.evidence_sufficiency !== 'INSUFFICIENT') errors.push({ path: '/evidence_sufficiency', code: 'semantic' });
  if (observation.normalized_verdict !== 'INSUFFICIENT_EVIDENCE' && observation.evidence_sufficiency !== 'SUFFICIENT') errors.push({ path: '/evidence_sufficiency', code: 'semantic' });
  return { valid: errors.length === 0, errors };
}

export function assertValidCanonicalIdentityObservation(observation) {
  const checked = validateCanonicalIdentityObservation(observation);
  if (!checked.valid) throw new ExternalIdentityContractError('CANONICAL_IDENTITY_OBSERVATION_INVALID', 'Canonical Identity Observation V0.1 validation failed.', checked.errors);
  return observation;
}
