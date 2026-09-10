import { assertNoSensitiveData } from '../credential-provider.mjs';
import { plain, ScoringContractError, stableSha256 } from '../scoring/score-contracts.mjs';
import { aggregateScenarioEvidence } from './profile-aggregator.mjs';

const profileKeys = new Set([
  'schema_version', 'record_type', 'profile_id', 'subject', 'provider', 'model', 'scenario_id',
  'scenario_version', 'capability_score', 'coverage', 'evidence_count', 'included_tasks',
  'excluded_tasks', 'metric_summary', 'profile_status', 'confidence_state', 'source_class',
  'provenance', 'generated_at', 'metadata',
]);
const sourceClasses = new Set(['TEST_FIXTURE', 'RAW_RESULT', 'REAL_EVALUATION']);

function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function unit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }

export class CapabilityProfileError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CapabilityProfileError';
    this.code = code;
    this.errors = errors;
  }
}

export function validateCapabilityProfile(profile) {
  const errors = [];
  try { assertNoSensitiveData(profile, 'Capability Profile'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(profile)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Capability Profile must be an object.' }] };
  for (const key of Object.keys(profile)) if (!profileKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of profileKeys) if (!(key in profile)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (profile.schema_version !== '0.1' || profile.record_type !== 'CAPABILITY_PROFILE') errors.push({ path: '/', code: 'contract', message: 'Expected Capability Profile V0.1.' });
  if (!/^profile_[a-f0-9]{64}$/u.test(profile.profile_id ?? '')) errors.push({ path: '/profile_id', code: 'pattern', message: 'Invalid profile_id.' });
  if (!plain(profile.subject) || profile.subject?.subject_type !== 'provider_model' || !nonEmptyString(profile.subject?.subject_id) || Object.keys(profile.subject ?? {}).some((key) => !['subject_type', 'subject_id'].includes(key))) errors.push({ path: '/subject', code: 'type', message: 'Invalid provider_model subject.' });
  for (const key of ['provider', 'model', 'scenario_id', 'scenario_version']) if (!nonEmptyString(profile[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!(profile.capability_score === null || unit(profile.capability_score)) || !unit(profile.coverage)) errors.push({ path: '/', code: 'range', message: 'Capability score must be null or [0,1], and coverage must be [0,1].' });
  if (!Number.isInteger(profile.evidence_count) || profile.evidence_count < 0 || !Array.isArray(profile.included_tasks) || !Array.isArray(profile.excluded_tasks)) errors.push({ path: '/', code: 'type', message: 'Invalid evidence counts or task arrays.' });
  if (profile.evidence_count !== profile.included_tasks?.length) errors.push({ path: '/evidence_count', code: 'semantic', message: 'evidence_count must equal included task count.' });
  const summary = profile.metric_summary;
  if (!plain(summary) || !Number.isInteger(summary?.valid_metric_count) || summary.valid_metric_count < 0 || !Number.isInteger(summary?.total_metric_count) || summary.total_metric_count < summary.valid_metric_count || !Array.isArray(summary?.metric_ids) || !summary.metric_ids.every(nonEmptyString)) errors.push({ path: '/metric_summary', code: 'type', message: 'Invalid metric summary.' });
  if (!['COMPLETE', 'PARTIAL', 'INSUFFICIENT_EVIDENCE'].includes(profile.profile_status) || !['INSUFFICIENT_EVIDENCE', 'LOW', 'MEDIUM', 'HIGH'].includes(profile.confidence_state)) errors.push({ path: '/', code: 'enum', message: 'Invalid profile or confidence state.' });
  if (profile.profile_status === 'INSUFFICIENT_EVIDENCE' && profile.confidence_state !== 'INSUFFICIENT_EVIDENCE') errors.push({ path: '/confidence_state', code: 'semantic', message: 'Insufficient profile requires insufficient confidence.' });
  if (profile.profile_status === 'COMPLETE' && profile.coverage !== 1) errors.push({ path: '/coverage', code: 'semantic', message: 'Complete profile requires full coverage.' });
  if (!sourceClasses.has(profile.source_class)) errors.push({ path: '/source_class', code: 'enum', message: 'Invalid source class.' });
  const provenance = profile.provenance;
  if (!plain(provenance) || provenance?.builder !== 'starbench.capability-profile-builder' || provenance?.builder_version !== '0.1' || !/^[a-f0-9]{64}$/u.test(provenance?.scenario_definition_sha256 ?? '') || !Array.isArray(provenance?.task_score_ids) || !Array.isArray(provenance?.evaluation_ids) || !Array.isArray(provenance?.suite_score_ids)) errors.push({ path: '/provenance', code: 'traceability', message: 'Invalid profile provenance.' });
  if (!nonEmptyString(profile.generated_at) || Number.isNaN(Date.parse(profile.generated_at))) errors.push({ path: '/generated_at', code: 'format', message: 'Invalid generated_at.' });
  if (!plain(profile.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  if (profile.source_class === 'TEST_FIXTURE' && profile.metadata?.fixture_only !== true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'TEST_FIXTURE Profile must be fixture_only.' });
  if (profile.source_class !== 'TEST_FIXTURE' && profile.metadata?.fixture_only === true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Non-fixture Profile cannot be fixture_only.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidCapabilityProfile(profile) {
  const checked = validateCapabilityProfile(profile);
  if (!checked.valid) throw new CapabilityProfileError('CAPABILITY_PROFILE_INVALID', 'Capability Profile validation failed.', checked.errors);
  return profile;
}

function profileSourceClass(resolvedScenario, evidence) {
  const sources = new Set(evidence.map((item) => item.task_score?.source_class).filter(Boolean));
  if (sources.has('LEGACY_SUMMARY')) throw new CapabilityProfileError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter Capability Profile.');
  if (sources.size > 1) throw new CapabilityProfileError('PROFILE_SOURCE_MIXED', 'Capability Profile cannot mix source classes.');
  const source = sources.size === 1 ? [...sources][0] : resolvedScenario.definition.metadata?.source_class;
  if (source === 'TEST_FIXTURE') return 'TEST_FIXTURE';
  if (source === 'RAW_RESULT') return 'RAW_RESULT';
  if (source === 'IMPORTED_REAL_RESULT' || source === 'REAL_EVALUATION') return 'REAL_EVALUATION';
  throw new CapabilityProfileError('PROFILE_SOURCE_INVALID', 'Capability Profile source class is invalid or unavailable.');
}

export class CapabilityProfileBuilder {
  constructor({ clock = { now: () => new Date() } } = {}) { this.clock = clock; }

  build({ resolvedScenario, provider, model, evidence, suiteScores = [] }) {
    assertNoSensitiveData({ resolvedScenario, provider, model, evidence, suiteScores }, 'Capability Profile input');
    if (!nonEmptyString(provider) || !nonEmptyString(model)) throw new CapabilityProfileError('PROFILE_SUBJECT_INVALID', 'Provider and model are required.');
    for (const item of evidence) {
      if (item.task_score?.record_type === 'LEGACY_SUMMARY') throw new CapabilityProfileError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter Capability Profile.');
      if (item.provider !== provider || item.model !== model) throw new CapabilityProfileError('PROFILE_SUBJECT_MISMATCH', 'All evidence must match Profile provider and model.');
    }
    for (const suiteScore of suiteScores) if (suiteScore?.record_type === 'LEGACY_SUMMARY') throw new CapabilityProfileError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter Capability Profile provenance.');
    const aggregate = aggregateScenarioEvidence({ resolvedScenario, evidence });
    const sourceClass = profileSourceClass(resolvedScenario, evidence);
    const taskScoreIds = aggregate.included_tasks.map((task) => task.task_score_id).sort();
    const evaluationIds = aggregate.included_tasks.map((task) => task.evaluation_id).sort();
    const suiteScoreIds = suiteScores.map((score) => score.suite_score_id).filter(nonEmptyString).sort();
    const subject = { subject_type: 'provider_model', subject_id: `${provider}/${model}` };
    const profile = {
      schema_version: '0.1',
      record_type: 'CAPABILITY_PROFILE',
      profile_id: `profile_${stableSha256({ subject, scenario_identity: resolvedScenario.scenario_identity, task_score_ids: taskScoreIds, suite_score_ids: suiteScoreIds })}`,
      subject,
      provider,
      model,
      scenario_id: resolvedScenario.scenario_identity.scenario_id,
      scenario_version: resolvedScenario.scenario_identity.scenario_version,
      capability_score: aggregate.capability_score,
      coverage: aggregate.coverage,
      evidence_count: aggregate.evidence_count,
      included_tasks: aggregate.included_tasks,
      excluded_tasks: aggregate.excluded_tasks,
      metric_summary: aggregate.metric_summary,
      profile_status: aggregate.profile_status,
      confidence_state: aggregate.confidence_state,
      source_class: sourceClass,
      provenance: {
        builder: 'starbench.capability-profile-builder',
        builder_version: '0.1',
        scenario_definition_sha256: resolvedScenario.scenario_identity.scenario_definition_sha256,
        task_score_ids: taskScoreIds,
        evaluation_ids: evaluationIds,
        suite_score_ids: suiteScoreIds,
      },
      generated_at: this.clock.now().toISOString(),
      metadata: { fixture_only: sourceClass === 'TEST_FIXTURE', confidence_rule: 'coverage_evidence_required_v0.1' },
    };
    assertValidCapabilityProfile(profile);
    return profile;
  }
}
