import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { plain } from '../scoring/score-contracts.mjs';

const confidence = new Set(['INSUFFICIENT_EVIDENCE', 'LOW', 'MEDIUM', 'HIGH']);
const preferenceKeys = ['capability', 'cost_efficiency', 'latency', 'throughput', 'confidence', 'coverage'];

function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function unit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function nonNegative(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function uniqueStrings(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string') && new Set(value).size === value.length; }
function boundedFile(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new RecommendationPolicyError('POLICY_PATH_ESCAPE', 'Policy path must be a file below rootDir.');
  return target;
}

export class RecommendationPolicyError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RecommendationPolicyError';
    this.code = code;
    this.errors = errors;
  }
}

export function validateRecommendationRequest(request) {
  const errors = [];
  try { assertNoSensitiveData(request, 'Recommendation Request'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(request)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Request must be an object.' }] };
  if (request.schema_version !== '0.1' || request.record_type !== 'RECOMMENDATION_REQUEST') errors.push({ path: '/', code: 'contract', message: 'Expected Recommendation Request V0.1.' });
  if (!/^request_[A-Za-z0-9_-]+$/u.test(request.request_id ?? '') || !nonEmptyString(request.scenario_id)) errors.push({ path: '/', code: 'identity', message: 'Explicit request and scenario identity are required.' });
  if (!plain(request.task_context) || !(request.task_context.summary === null || typeof request.task_context.summary === 'string') || !plain(request.task_context.attributes)) errors.push({ path: '/task_context', code: 'type', message: 'Invalid non-routing task context.' });
  if (!plain(request.candidate_scope) || !Array.isArray(request.candidate_scope.candidates) || request.candidate_scope.candidates.some((item) => !plain(item) || !nonEmptyString(item.provider) || !nonEmptyString(item.model) || !nonEmptyString(item.profile_id))) errors.push({ path: '/candidate_scope', code: 'type', message: 'Invalid candidate scope.' });
  const hard = request.hard_constraints;
  if (!plain(hard) || !(hard.minimum_capability_score === null || unit(hard.minimum_capability_score)) || !(hard.maximum_latency_ms === null || nonNegative(hard.maximum_latency_ms)) || !(hard.maximum_cost === null || nonNegative(hard.maximum_cost)) || !['provider_allowlist', 'provider_denylist', 'model_allowlist', 'model_denylist', 'required_metrics'].every((key) => uniqueStrings(hard[key]))) errors.push({ path: '/hard_constraints', code: 'type', message: 'Invalid hard constraints.' });
  if (!plain(request.preferences) || !plain(request.preferences.weight_overrides) || Object.entries(request.preferences.weight_overrides).some(([key, value]) => !preferenceKeys.includes(key) || !nonNegative(value))) errors.push({ path: '/preferences', code: 'type', message: 'Invalid preference overrides.' });
  if (!confidence.has(request.minimum_confidence) || !unit(request.minimum_coverage) || !Number.isInteger(request.minimum_evidence) || request.minimum_evidence < 1) errors.push({ path: '/', code: 'evidence_gate', message: 'Invalid request evidence gates.' });
  if (!plain(request.source_policy) || !Array.isArray(request.source_policy.allowed_source_classes) || request.source_policy.allowed_source_classes.length === 0 || !request.source_policy.allowed_source_classes.every((item) => ['TEST_FIXTURE', 'RAW_RESULT', 'REAL_EVALUATION'].includes(item)) || typeof request.source_policy.fixture_decision_only !== 'boolean') errors.push({ path: '/source_policy', code: 'type', message: 'Invalid source policy.' });
  if (!nonEmptyString(request.requested_at) || Number.isNaN(Date.parse(request.requested_at)) || !plain(request.metadata)) errors.push({ path: '/', code: 'type', message: 'Invalid timestamp or metadata.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidRecommendationRequest(request) {
  if (request?.record_type === 'LEGACY_SUMMARY') throw new RecommendationPolicyError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot become a Recommendation Request.');
  const checked = validateRecommendationRequest(request);
  if (!checked.valid) throw new RecommendationPolicyError('RECOMMENDATION_REQUEST_INVALID', 'Recommendation Request validation failed.', checked.errors);
  return request;
}

function validBounds(value) { return plain(value) && typeof value.min === 'number' && Number.isFinite(value.min) && typeof value.max === 'number' && Number.isFinite(value.max) && value.max > value.min && ['higher_is_better', 'lower_is_better'].includes(value.direction) && typeof value.clamp === 'boolean'; }

export function validateRecommendationPolicy(policy) {
  const errors = [];
  try { assertNoSensitiveData(policy, 'Recommendation Policy'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(policy)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Policy must be an object.' }] };
  if (policy.schema_version !== '0.1' || policy.record_type !== 'RECOMMENDATION_POLICY') errors.push({ path: '/', code: 'contract', message: 'Expected Recommendation Policy V0.1.' });
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(policy.policy_id ?? '') || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(policy.version ?? '')) errors.push({ path: '/', code: 'identity', message: 'Invalid policy identity or version.' });
  for (const key of ['name', 'description']) if (!nonEmptyString(policy[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!Array.isArray(policy.applicable_scenarios) || policy.applicable_scenarios.length === 0 || !policy.applicable_scenarios.every(nonEmptyString)) errors.push({ path: '/applicable_scenarios', code: 'type', message: 'At least one explicit Scenario is required.' });
  if (!plain(policy.hard_gates) || !unit(policy.hard_gates.minimum_capability_score) || !['REJECT_UNKNOWN', 'ABSTAIN_UNKNOWN'].includes(policy.hard_gates.unknown_constraint_behavior)) errors.push({ path: '/hard_gates', code: 'type', message: 'Invalid hard gates.' });
  if (!plain(policy.evidence_gates) || !confidence.has(policy.evidence_gates.minimum_confidence) || !unit(policy.evidence_gates.minimum_coverage) || !Number.isInteger(policy.evidence_gates.minimum_evidence) || policy.evidence_gates.minimum_evidence < 1) errors.push({ path: '/evidence_gates', code: 'type', message: 'Invalid evidence gates.' });
  if (!plain(policy.preference_weights) || preferenceKeys.some((key) => !nonNegative(policy.preference_weights[key])) || Object.keys(policy.preference_weights).some((key) => !preferenceKeys.includes(key)) || preferenceKeys.every((key) => policy.preference_weights[key] === 0)) errors.push({ path: '/preference_weights', code: 'type', message: 'Preference weights must be explicit non-negative values with positive total.' });
  const normalization = policy.normalization_rules;
  if (!plain(normalization) || !validBounds(normalization.cost) || !validBounds(normalization.latency) || !validBounds(normalization.throughput) || !plain(normalization.confidence_values) || [...confidence].some((key) => !unit(normalization.confidence_values[key]))) errors.push({ path: '/normalization_rules', code: 'type', message: 'Invalid normalization rules.' });
  if (!['RENORMALIZE_AVAILABLE', 'REJECT_CANDIDATE', 'ABSTAIN'].includes(policy.missing_preference_handling)) errors.push({ path: '/missing_preference_handling', code: 'enum', message: 'Invalid missing preference behavior.' });
  if (!plain(policy.tie_policy) || !unit(policy.tie_policy.epsilon) || policy.tie_policy.outcome !== 'TIE' || !Array.isArray(policy.tie_policy.secondary_keys)) errors.push({ path: '/tie_policy', code: 'type', message: 'Invalid tie policy.' });
  if (!plain(policy.abstain_policy) || !['REJECT_UNKNOWN', 'ABSTAIN_UNKNOWN'].includes(policy.abstain_policy.on_unknown_hard_constraint) || !['NO_ELIGIBLE_CANDIDATE', 'ABSTAINED'].includes(policy.abstain_policy.on_no_eligible) || policy.abstain_policy.on_all_insufficient !== 'INSUFFICIENT_EVIDENCE' || policy.abstain_policy.on_unknown_hard_constraint !== policy.hard_gates.unknown_constraint_behavior) errors.push({ path: '/abstain_policy', code: 'type', message: 'Invalid or inconsistent abstain policy.' });
  if (!plain(policy.explanation_rules) || typeof policy.explanation_rules.include_gate_results !== 'boolean' || typeof policy.explanation_rules.include_contributions !== 'boolean' || !Number.isInteger(policy.explanation_rules.maximum_reason_codes) || policy.explanation_rules.maximum_reason_codes < 1 || !plain(policy.metadata)) errors.push({ path: '/', code: 'type', message: 'Invalid explanation rules or metadata.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidRecommendationPolicy(policy) {
  if (policy?.record_type === 'LEGACY_SUMMARY') throw new RecommendationPolicyError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot become a Recommendation Policy.');
  const checked = validateRecommendationPolicy(policy);
  if (!checked.valid) throw new RecommendationPolicyError('RECOMMENDATION_POLICY_INVALID', 'Recommendation Policy validation failed.', checked.errors);
  return policy;
}

export async function loadRecommendationPolicy(filePath, { rootDir = process.cwd() } = {}) {
  const target = boundedFile(rootDir, filePath);
  let policy;
  try { policy = JSON.parse(await readFile(target, 'utf8')); } catch (error) { throw new RecommendationPolicyError(error instanceof SyntaxError ? 'POLICY_JSON_INVALID' : 'POLICY_READ_FAILED', 'Recommendation Policy could not be loaded.', [], error); }
  assertValidRecommendationPolicy(policy);
  return structuredClone(policy);
}
