import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';

export const MODEL_CLASSES = Object.freeze(['CHAT_REASONING', 'CODEX', 'GENERAL_API_EXECUTOR', 'OTHER_API_MODEL', 'SUBSCRIPTION_MODEL']);
export const BILLING_MODES = Object.freeze(['API_TOKEN_BILLED', 'SUBSCRIPTION_QUOTA']);
export const TASK_TYPES = Object.freeze(['PRODUCT_PLANNING', 'ARCHITECTURE', 'CODE_IMPLEMENTATION', 'DEBUG', 'TEST_GENERATION', 'TEST_ANALYSIS', 'INTEGRATION', 'LEGACY_RECONCILIATION', 'CODE_REVIEW', 'FINAL_ACCEPTANCE', 'DOCUMENTATION']);
export const PATH_TYPES = Object.freeze(['OPTIMISTIC_PATH', 'EXPECTED_PATH', 'CONSERVATIVE_PATH']);

const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value) => typeof value === 'string' && value.length > 0;
const strings = (value) => Array.isArray(value) && value.every(text);
const nullableNonNegativeInteger = (value) => value === null || (Number.isInteger(value) && value >= 0);

function normalized(value) {
  if (typeof value === 'string') return value.normalize('NFC').replace(/\r\n?/gu, '\n');
  if (Array.isArray(value)) return value.map(normalized);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
}

export function stableSha256(value) { return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex'); }

function boundedFile(rootDir, filePath) {
  const root = resolve(rootDir); const target = resolve(filePath); const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new TokenIntelligenceContractError('TOKEN_INTELLIGENCE_PATH_ESCAPE', 'File must be below rootDir.');
  return target;
}

function exactKeys(value, keys, errors) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push({ path: `/${key}`, code: 'additional_property' });
  for (const key of keys) if (!(key in value)) errors.push({ path: `/${key}`, code: 'required' });
}

export class TokenIntelligenceContractError extends Error {
  constructor(code, message, errors = [], cause = null) { super(message, cause ? { cause } : undefined); this.name = 'TokenIntelligenceContractError'; this.code = code; this.errors = errors; }
}

const briefKeys = ['schema_version','record_type','project_id','project_name','project_goal','product_scope','known_modules','planned_features','existing_assets','legacy_assets','dependencies','technical_constraints','risk_constraints','expected_deliverables','known_task_plan','preferred_models','resource_constraints','pricing_snapshot_ref','entitlement_snapshot_ref','metadata'];
export function validateProjectEstimateBrief(brief) {
  const errors = []; try { assertNoSensitiveData(brief, 'Project Estimate Brief'); } catch (error) { errors.push({ path: '/', code: error.code }); }
  if (!plain(brief)) return { valid: false, errors: [{ path: '/', code: 'type' }] };
  exactKeys(brief, briefKeys, errors);
  if (brief.schema_version !== '0.1' || brief.record_type !== 'PROJECT_ESTIMATE_BRIEF') errors.push({ path: '/', code: 'contract' });
  if (!(brief.project_id === null || text(brief.project_id)) || !text(brief.project_name) || !text(brief.project_goal)) errors.push({ path: '/project', code: 'identity' });
  for (const key of ['product_scope','known_modules','planned_features','existing_assets','legacy_assets','dependencies','technical_constraints','risk_constraints','expected_deliverables']) if (!strings(brief[key])) errors.push({ path: `/${key}`, code: 'strings' });
  if (!Array.isArray(brief.expected_deliverables) || brief.expected_deliverables.length === 0) errors.push({ path: '/expected_deliverables', code: 'min_items' });
  if (!(brief.known_task_plan === null || (Array.isArray(brief.known_task_plan) && brief.known_task_plan.every((task) => plain(task) && text(task.task_id) && text(task.phase) && text(task.task_type) && text(task.description) && strings(task.dependencies) && text(task.expected_output) && typeof task.tests_required === 'boolean' && typeof task.review_required === 'boolean')))) errors.push({ path: '/known_task_plan', code: 'task_plan' });
  if (!(brief.preferred_models === null || (Array.isArray(brief.preferred_models) && brief.preferred_models.every((item) => MODEL_CLASSES.includes(item))))) errors.push({ path: '/preferred_models', code: 'model_class' });
  if (!plain(brief.resource_constraints) || !plain(brief.metadata)) errors.push({ path: '/metadata', code: 'object' });
  return { valid: errors.length === 0, errors };
}

export function assertValidProjectEstimateBrief(value) { const result = validateProjectEstimateBrief(value); if (!result.valid) throw new TokenIntelligenceContractError('PROJECT_ESTIMATE_BRIEF_INVALID', 'Project Estimate Brief V0.1 validation failed.', result.errors); return value; }

const historyKeys = ['schema_version','record_type','usage_record_id','task_id','project_id','module','task_type','task_summary','provider','model','execution_role','billing_mode','input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','calls','first_attempt_success','codex_intervention','failure_reason','files_read','files_changed','tests_run','tests_passed','tests_failed','duration','result_status','context_size_or_proxy','source','provenance','metadata'];
export function validateHistoricalTaskUsage(record) {
  const errors = []; try { assertNoSensitiveData(record, 'Historical Task Usage'); } catch (error) { errors.push({ path: '/', code: error.code }); }
  if (!plain(record)) return { valid: false, errors: [{ path: '/', code: 'type' }] }; exactKeys(record, historyKeys, errors);
  if (record.schema_version !== '0.1' || record.record_type !== 'HISTORICAL_TASK_USAGE' || !/^usage_[a-f0-9]{64}$/u.test(record.usage_record_id ?? '')) errors.push({ path: '/', code: 'contract' });
  for (const key of ['task_id','module','task_type','task_summary','execution_role','source']) if (!text(record[key])) errors.push({ path: `/${key}`, code: 'string' });
  if (!BILLING_MODES.includes(record.billing_mode)) errors.push({ path: '/billing_mode', code: 'enum' });
  for (const key of ['input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','calls','files_read','files_changed','tests_run','tests_passed','tests_failed']) if (!nullableNonNegativeInteger(record[key])) errors.push({ path: `/${key}`, code: 'nullable_integer' });
  if (record.total_tokens !== null && record.input_tokens !== null && record.output_tokens !== null && record.reasoning_tokens !== null && record.total_tokens !== record.input_tokens + record.output_tokens + record.reasoning_tokens) errors.push({ path: '/total_tokens', code: 'arithmetic' });
  if (!['PASS','PARTIAL','FAILED','UNKNOWN'].includes(record.result_status) || !plain(record.provenance) || !Array.isArray(record.provenance?.observed_fields) || !Array.isArray(record.provenance?.unknown_fields) || !plain(record.metadata)) errors.push({ path: '/provenance', code: 'contract' });
  return { valid: errors.length === 0, errors };
}
export function assertValidHistoricalTaskUsage(value) { const result = validateHistoricalTaskUsage(value); if (!result.valid) throw new TokenIntelligenceContractError('HISTORICAL_TASK_USAGE_INVALID', 'Historical Task Usage V0.1 validation failed.', result.errors); return value; }

export function computeHistoricalUsageId(record) { const copy = structuredClone(record); delete copy.usage_record_id; return `usage_${stableSha256(copy)}`; }

export function assertValidWorkUnit(unit) {
  assertNoSensitiveData(unit, 'AI Work Unit');
  if (!plain(unit) || unit.schema_version !== '0.1' || unit.record_type !== 'AI_WORK_UNIT' || !TASK_TYPES.includes(unit.task_type) || !MODEL_CLASSES.includes(unit.recommended_model_class) || !BILLING_MODES.includes(unit.billing_mode) || !Number.isInteger(unit.expected_calls) || unit.expected_calls < 1 || !strings(unit.source_facts) || unit.source_facts.length === 0 || !Array.isArray(unit.call_estimates)) throw new TokenIntelligenceContractError('AI_WORK_UNIT_INVALID', 'AI Work Unit V0.1 validation failed.');
  for (const call of unit.call_estimates) if (!plain(call) || !Number.isInteger(call.input_tokens) || !Number.isInteger(call.cached_input_tokens) || !Number.isInteger(call.output_tokens) || !(call.reasoning_tokens === null || Number.isInteger(call.reasoning_tokens)) || call.cached_input_tokens > call.input_tokens || call.total_tokens !== call.input_tokens + call.output_tokens + (call.reasoning_tokens ?? 0)) throw new TokenIntelligenceContractError('CALL_TOKEN_ESTIMATE_INVALID', 'Call token arithmetic is invalid.');
  return unit;
}

export function assertValidWorkGraph(graph) {
  assertNoSensitiveData(graph, 'AI Work Graph');
  if (!plain(graph) || graph.schema_version !== '0.1' || graph.record_type !== 'AI_WORK_GRAPH' || !PATH_TYPES.includes(graph.path_type) || !/^graph_[a-f0-9]{64}$/u.test(graph.graph_id ?? '') || !Array.isArray(graph.work_units) || graph.work_units.length === 0) throw new TokenIntelligenceContractError('AI_WORK_GRAPH_INVALID', 'AI Work Graph V0.1 validation failed.');
  const ids = new Set(); for (const unit of graph.work_units) { assertValidWorkUnit(unit); if (ids.has(unit.work_unit_id)) throw new TokenIntelligenceContractError('AI_WORK_GRAPH_DUPLICATE_UNIT', 'Duplicate work unit.'); ids.add(unit.work_unit_id); }
  for (const unit of graph.work_units) for (const dep of unit.dependencies) if (!ids.has(dep)) throw new TokenIntelligenceContractError('AI_WORK_GRAPH_DEPENDENCY_MISSING', 'Work Unit dependency is missing.');
  return graph;
}

export function assertValidTokenForecast(value) { assertNoSensitiveData(value, 'Token Forecast'); if (!plain(value) || value.schema_version !== '0.1' || value.record_type !== 'TOKEN_FORECAST' || !/^forecast_[a-f0-9]{64}$/u.test(value.forecast_id ?? '') || value.forecast_version !== '0.1.0' || !['EMPTY','PARTIAL','AVAILABLE'].includes(value.historical_data_status)) throw new TokenIntelligenceContractError('TOKEN_FORECAST_INVALID', 'Token Forecast V0.1 validation failed.'); return value; }
export function assertValidAllocationProposal(value) { assertNoSensitiveData(value, 'Model Allocation Proposal'); if (!plain(value) || value.record_type !== 'MODEL_ALLOCATION_PROPOSAL' || value.proposal_status !== 'ADVISORY_ONLY' || !Array.isArray(value.allocations)) throw new TokenIntelligenceContractError('MODEL_ALLOCATION_PROPOSAL_INVALID', 'Allocation proposal is invalid.'); return value; }
export function assertValidResourceProposal(value) { assertNoSensitiveData(value, 'Resource Usage Proposal'); if (!plain(value) || value.record_type !== 'RESOURCE_USAGE_PROPOSAL' || value.subscription_quota?.monetary_cost !== null || value.pricing_authority !== '03-01 AI资产成本' || value.entitlement_authority !== '03-01 AI资产成本') throw new TokenIntelligenceContractError('RESOURCE_USAGE_PROPOSAL_INVALID', 'Resource proposal is invalid.'); return value; }

export async function loadProjectEstimateBrief(filePath, { rootDir = process.cwd() } = {}) { let value; try { value = JSON.parse(await readFile(boundedFile(rootDir, filePath), 'utf8')); } catch (error) { throw new TokenIntelligenceContractError('PROJECT_ESTIMATE_BRIEF_READ_FAILED', 'Project brief could not be loaded.', [], error); } return structuredClone(assertValidProjectEstimateBrief(value)); }
export async function loadHistoricalTaskUsage(filePath, { rootDir = process.cwd() } = {}) { let value; try { value = JSON.parse(await readFile(boundedFile(rootDir, filePath), 'utf8')); } catch (error) { throw new TokenIntelligenceContractError('HISTORICAL_TASK_USAGE_READ_FAILED', 'Historical usage could not be loaded.', [], error); } return structuredClone(assertValidHistoricalTaskUsage(value)); }
