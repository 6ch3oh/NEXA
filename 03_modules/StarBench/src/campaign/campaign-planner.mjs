import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';

const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const scenarios = new Set(['planning', 'coding', 'instruction_following']);

function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function text(value) { return typeof value === 'string' && value.length > 0; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha256(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function bounded(rootDir, filePath) {
  const root = resolve(rootDir); const target = resolve(filePath); const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new CampaignContractError('CAMPAIGN_PATH_ESCAPE', 'Campaign asset path must stay below rootDir.');
  return target;
}

export class CampaignContractError extends Error {
  constructor(code, message, errors = [], cause = null) { super(message, cause ? { cause } : undefined); this.name = 'CampaignContractError'; this.code = code; this.errors = errors; }
}

export function validateCampaignDefinition(value) {
  const errors = [];
  try { assertNoSensitiveData(value, 'Campaign Definition'); } catch (error) { errors.push(error.message); }
  if (!plain(value)) return { valid: false, errors: [...errors, 'Campaign Definition must be an object.'] };
  if (value.schema_version !== '0.1' || value.record_type !== 'CAMPAIGN_DEFINITION') errors.push('Campaign schema/record type mismatch.');
  if (!idPattern.test(value.campaign_id ?? '') || !versionPattern.test(value.version ?? '')) errors.push('Campaign identity is invalid.');
  if (!text(value.suite_id) || !versionPattern.test(value.suite_version ?? '')) errors.push('Suite reference is invalid.');
  if (!Array.isArray(value.candidate_refs) || value.candidate_refs.length === 0 || value.candidate_refs.some((ref) => !plain(ref) || !idPattern.test(ref.candidate_id ?? '') || !versionPattern.test(ref.version ?? '')) || new Set(value.candidate_refs?.map((ref) => `${ref.candidate_id}@${ref.version}`)).size !== value.candidate_refs?.length) errors.push('Candidate references must be unique stable identities.');
  if (!Number.isInteger(value.runs_per_task) || value.runs_per_task < 1) errors.push('runs_per_task must be positive.');
  if (!Array.isArray(value.scenario_scope) || value.scenario_scope.length === 0 || value.scenario_scope.some((item) => !scenarios.has(item)) || new Set(value.scenario_scope).size !== value.scenario_scope.length) errors.push('Scenario scope is invalid.');
  if (!(value.budget_policy_ref === null || text(value.budget_policy_ref)) || !['NOT_AUTHORIZED_REAL_EXECUTION', 'AUTHORIZED', 'COMPLETED'].includes(value.budget_status)) errors.push('Budget declaration is invalid.');
  if (!plain(value.stop_policy) || !['CONTINUE', 'STOP'].includes(value.stop_policy?.on_failure) || !(value.stop_policy?.max_failures === null || (Number.isInteger(value.stop_policy?.max_failures) && value.stop_policy.max_failures >= 1))) errors.push('Stop policy is invalid.');
  if (!plain(value.retry_policy) || !Number.isInteger(value.retry_policy?.retry_budget) || value.retry_policy.retry_budget < 0) errors.push('Retry policy is invalid.');
  if (!['NOT_AUTHORIZED', 'TEST_ONLY', 'AUTHORIZED', 'RUNNING', 'COMPLETED', 'STOPPED'].includes(value.campaign_state)) errors.push('Campaign state is invalid.');
  if (!['TEST_FIXTURE', 'AUTHORED_DEFINITION'].includes(value.source_class) || !text(value.created_at) || Number.isNaN(Date.parse(value.created_at)) || !plain(value.metadata)) errors.push('Campaign source, timestamp, or metadata is invalid.');
  return { valid: errors.length === 0, errors };
}

export function assertValidCampaignDefinition(value) { const checked = validateCampaignDefinition(value); if (!checked.valid) throw new CampaignContractError('CAMPAIGN_DEFINITION_INVALID', 'Campaign Definition validation failed.', checked.errors); return value; }

export function validateCandidateDefinition(value) {
  const errors = [];
  try { assertNoSensitiveData(value, 'Candidate Definition'); } catch (error) { errors.push(error.message); }
  if (!plain(value)) return { valid: false, errors: [...errors, 'Candidate Definition must be an object.'] };
  if (value.schema_version !== '0.1' || value.record_type !== 'CANDIDATE_DEFINITION') errors.push('Candidate schema/record type mismatch.');
  if (!idPattern.test(value.candidate_id ?? '') || !versionPattern.test(value.version ?? '')) errors.push('Candidate identity is invalid.');
  if (!text(value.provider) || !text(value.model) || !(value.variant === null || text(value.variant)) || !plain(value.parameters)) errors.push('Candidate runtime profile is invalid.');
  if (!['NOT_AUTHORIZED', 'TEST_ONLY', 'ACTIVE', 'RETIRED'].includes(value.status) || !['TEST_FIXTURE', 'AUTHORED_DEFINITION'].includes(value.source_class)) errors.push('Candidate status/source is invalid.');
  if (!text(value.created_at) || Number.isNaN(Date.parse(value.created_at)) || !plain(value.metadata)) errors.push('Candidate timestamp or metadata is invalid.');
  return { valid: errors.length === 0, errors };
}

export function assertValidCandidateDefinition(value) { const checked = validateCandidateDefinition(value); if (!checked.valid) throw new CampaignContractError('CANDIDATE_DEFINITION_INVALID', 'Candidate Definition validation failed.', checked.errors); return value; }

async function loadJson(filePath, rootDir, label) {
  try { return JSON.parse(await readFile(bounded(rootDir, filePath), 'utf8')); } catch (error) { throw new CampaignContractError('CAMPAIGN_ASSET_READ_FAILED', `${label} could not be loaded.`, [], error); }
}
export async function loadCampaignDefinition(filePath, { rootDir = process.cwd() } = {}) { return assertValidCampaignDefinition(await loadJson(filePath, rootDir, 'Campaign Definition')); }
export async function loadCandidateDefinition(filePath, { rootDir = process.cwd() } = {}) { return assertValidCandidateDefinition(await loadJson(filePath, rootDir, 'Candidate Definition')); }

export function observationIdentity({ campaign_id, candidate_id, benchmark_task_id, scenario_id, repeat_index }) {
  return `slot_${sha256({ campaign_id, candidate_id, benchmark_task_id, scenario_id, repeat_index })}`;
}

export function createCampaignPlan({ campaign, resolvedSuite, candidates }) {
  assertValidCampaignDefinition(campaign);
  if (!resolvedSuite?.definition || !resolvedSuite?.suite_identity || !Array.isArray(resolvedSuite.tasks)) throw new CampaignContractError('RESOLVED_SUITE_REQUIRED', 'A resolved Benchmark Suite is required.');
  if (campaign.suite_id !== resolvedSuite.definition.suite_id || campaign.suite_version !== resolvedSuite.definition.version) throw new CampaignContractError('CAMPAIGN_SUITE_MISMATCH', 'Campaign and Suite identities do not match.');
  const candidateMap = new Map();
  for (const candidate of candidates ?? []) { assertValidCandidateDefinition(candidate); const key = `${candidate.candidate_id}@${candidate.version}`; if (candidateMap.has(key)) throw new CampaignContractError('CANDIDATE_DUPLICATE', `Duplicate Candidate ${key}.`); candidateMap.set(key, candidate); }
  const declaredCandidates = campaign.candidate_refs.map((ref) => { const candidate = candidateMap.get(`${ref.candidate_id}@${ref.version}`); if (!candidate) throw new CampaignContractError('CANDIDATE_REFERENCE_MISSING', `Missing Candidate ${ref.candidate_id}@${ref.version}.`); return candidate; });
  if (campaign.source_class === 'TEST_FIXTURE' && declaredCandidates.some((candidate) => candidate.source_class !== 'TEST_FIXTURE' || candidate.status !== 'TEST_ONLY')) throw new CampaignContractError('FIXTURE_CANDIDATE_REQUIRED', 'Fixture Campaigns accept TEST_ONLY fixture Candidates only.');
  const orderedTasks = [...resolvedSuite.tasks].sort((left, right) => left.order - right.order);
  if (orderedTasks.some(({ task }) => !campaign.scenario_scope.includes(task.category))) throw new CampaignContractError('SCENARIO_SCOPE_MISMATCH', 'Suite contains a task outside Campaign scenario scope.');
  const slots = [];
  for (const candidate of declaredCandidates) for (const entry of orderedTasks) for (let repeatIndex = 1; repeatIndex <= campaign.runs_per_task; repeatIndex += 1) {
    const identity = { campaign_id: campaign.campaign_id, candidate_id: candidate.candidate_id, benchmark_task_id: entry.task.benchmark_task_id, scenario_id: entry.task.category, repeat_index: repeatIndex };
    slots.push({ schema_version: '0.1', record_type: 'CAMPAIGN_OBSERVATION', observation_id: observationIdentity(identity), ...identity, task_version: entry.task.version, prompt_id: entry.task.prompt_identity.prompt_id, suite_order: entry.order, schedule_index: slots.length, status: 'PLANNED', run_id: null, attempt_count: 0, score_status: null, artifacts: {}, error: null, source_class: 'TEST_FIXTURE', updated_at: campaign.created_at });
  }
  if (new Set(slots.map((slot) => slot.observation_id)).size !== slots.length) throw new CampaignContractError('OBSERVATION_ID_DUPLICATE', 'Campaign plan contains duplicate observation identities.');
  return { schema_version: '0.1', record_type: 'CAMPAIGN_PLAN', campaign: structuredClone(campaign), suite_identity: structuredClone(resolvedSuite.suite_identity), suite_default_parameters: structuredClone(resolvedSuite.definition.default_parameters), candidates: declaredCandidates.map((candidate) => structuredClone(candidate)), slots, planned_observations: slots.length, plan_sha256: sha256(slots.map(({ observation_id, schedule_index }) => ({ observation_id, schedule_index }))) };
}
