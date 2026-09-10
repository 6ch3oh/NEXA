import { assertNoSensitiveData } from '../credential-provider.mjs';
import { ScenarioRegistry } from '../profile/scenario-registry.mjs';
import { assertValidRecommendationRequest } from '../recommendation/policy-loader.mjs';
import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { IntentRuleRegistry } from './intent-rule-registry.mjs';

const requestKeys = new Set(['schema_version', 'record_type', 'request_id', 'task_text', 'structured_hints', 'allowed_scenarios', 'excluded_scenarios', 'language', 'source_class', 'requested_at', 'metadata']);
const decisionKeys = new Set(['schema_version', 'record_type', 'decision_id', 'request_id', 'status', 'selected_scenario_id', 'candidate_scenarios', 'matched_rules', 'matched_signals', 'routing_score', 'confidence', 'reason_codes', 'explanation', 'source_class', 'generated_at', 'metadata']);
const statuses = new Set(['ROUTED', 'AMBIGUOUS', 'NO_MATCH', 'ABSTAINED', 'INVALID_REQUEST']);
const hintKeys = new Set(['task_type', 'domain', 'priority', 'cost_sensitivity', 'latency_sensitivity']);

function nonEmpty(value) { return typeof value === 'string' && value.length > 0; }
function uniqueStrings(value) { return Array.isArray(value) && value.every(nonEmpty) && new Set(value).size === value.length; }
function normalized(value, caseSensitive = false) { const text = String(value ?? '').normalize('NFC'); return caseSensitive ? text : text.toLocaleLowerCase('und'); }

export class IntentRouterError extends Error {
  constructor(code, message, errors = [], cause = null) { super(message, cause ? { cause } : undefined); this.name = 'IntentRouterError'; this.code = code; this.errors = errors; }
}

export function validateIntentRequest(request) {
  const errors = [];
  try { assertNoSensitiveData(request, 'Intent Request'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(request)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Intent Request must be an object.' }] };
  for (const key of Object.keys(request)) if (!requestKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of requestKeys) if (!(key in request)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (request.schema_version !== '0.1' || request.record_type !== 'INTENT_REQUEST' || !/^intent_[A-Za-z0-9_-]+$/u.test(request.request_id ?? '')) errors.push({ path: '/', code: 'contract', message: 'Expected Intent Request V0.1.' });
  if (typeof request.task_text !== 'string' || !plain(request.structured_hints) || Object.keys(request.structured_hints ?? {}).some((key) => !hintKeys.has(key)) || Object.values(request.structured_hints ?? {}).some((value) => !(value === null || typeof value === 'string')) || !uniqueStrings(request.allowed_scenarios) || !uniqueStrings(request.excluded_scenarios)) errors.push({ path: '/', code: 'type', message: 'Invalid task text, hints, or Scenario filters.' });
  if (request.task_text.trim() === '' && Object.values(request.structured_hints ?? {}).every((value) => value === null || value === '')) errors.push({ path: '/', code: 'signal_required', message: 'Task text or at least one structured hint is required.' });
  if (request.allowed_scenarios?.some((scenarioId) => request.excluded_scenarios?.includes(scenarioId))) errors.push({ path: '/', code: 'scenario_filter_conflict', message: 'A Scenario cannot be both allowed and excluded.' });
  if (!['zh', 'en', 'mixed', 'unspecified'].includes(request.language) || !['TEST_FIXTURE', 'REAL_USER_INPUT'].includes(request.source_class) || !nonEmpty(request.requested_at) || Number.isNaN(Date.parse(request.requested_at)) || !plain(request.metadata)) errors.push({ path: '/', code: 'source_or_time', message: 'Invalid language, source, time, or metadata.' });
  if (request.source_class === 'TEST_FIXTURE' && request.metadata?.fixture_only !== true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Fixture Intent Request must be fixture_only.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidIntentRequest(request) {
  if (request?.record_type === 'LEGACY_SUMMARY') throw new IntentRouterError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot become an Intent Request.');
  const checked = validateIntentRequest(request);
  if (!checked.valid) throw new IntentRouterError('INTENT_REQUEST_INVALID', 'Intent Request validation failed.', checked.errors);
  return request;
}

function textMatch(text, value, type, caseSensitive) {
  const source = normalized(text, caseSensitive); const needle = normalized(value, caseSensitive);
  if (type === 'phrase' || /[^\u0000-\u007f]/u.test(needle)) return source.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, caseSensitive ? 'u' : 'iu').test(source);
}

function signalEvidence(signal, request) {
  let observed;
  let matches;
  if (['keyword', 'phrase'].includes(signal.signal_type)) {
    observed = request.task_text;
    matches = signal.values.map((value) => textMatch(request.task_text, value, signal.signal_type, signal.case_sensitive));
  } else {
    observed = request.structured_hints[signal.field] ?? null;
    matches = signal.values.map((value) => normalized(observed, signal.case_sensitive) === normalized(value, signal.case_sensitive));
  }
  const matched = signal.match === 'ALL' ? matches.every(Boolean) : signal.match === 'EQUALS' ? matches[0] === true : matches.some(Boolean);
  return { signal_id: signal.signal_id, signal_type: signal.signal_type, field: signal.field, matched, matched_values: signal.values.filter((value, index) => matches[index]), observed: observed === null ? null : String(observed), weight: signal.weight };
}

function assessRule(rule, request) {
  const signals = rule.signals.map((signal) => signalEvidence(signal, request));
  const exclusions = rule.excluded_signals.map((signal) => signalEvidence(signal, request));
  const requiredSatisfied = rule.required_signals.every((signalId) => signals.find((item) => item.signal_id === signalId)?.matched === true);
  const excluded = exclusions.some((item) => item.matched);
  const matched = signals.filter((item) => item.matched);
  const totalWeight = rule.signals.reduce((total, signal) => total + signal.weight, 0);
  const matchStrength = matched.reduce((total, signal) => total + signal.weight, 0) / totalWeight;
  return { rule_id: rule.rule_id, rule_version: rule.version, target_scenario_id: rule.target_scenario_id, priority: rule.priority, rule_weight: rule.weight, eligible: matched.length > 0 && requiredSatisfied && !excluded, required_satisfied: requiredSatisfied, excluded, match_strength: matchStrength, weighted_score: matchStrength * rule.weight, reason_code: rule.reason_code, signals, excluded_signal_evidence: exclusions };
}

function candidateScenarios(assessments, request) {
  const byScenario = new Map();
  for (const assessment of assessments.filter((item) => item.eligible)) {
    const list = byScenario.get(assessment.target_scenario_id) ?? [];
    list.push(assessment); byScenario.set(assessment.target_scenario_id, list);
  }
  return [...byScenario.entries()].map(([scenarioId, rules]) => {
    const maxPriority = Math.max(...rules.map((rule) => rule.priority));
    const priorityRules = rules.filter((rule) => rule.priority === maxPriority);
    const totalRuleWeight = priorityRules.reduce((total, rule) => total + rule.rule_weight, 0);
    const score = priorityRules.reduce((total, rule) => total + rule.weighted_score, 0) / totalRuleWeight;
    const allowed = request.allowed_scenarios.length === 0 || request.allowed_scenarios.includes(scenarioId);
    const excluded = request.excluded_scenarios.includes(scenarioId);
    return { scenario_id: scenarioId, eligible: allowed && !excluded, filter_reason: !allowed ? 'SCENARIO_NOT_ALLOWED' : excluded ? 'SCENARIO_EXCLUDED' : null, priority: maxPriority, score, rule_ids: rules.map((rule) => rule.rule_id).sort() };
  }).sort((left, right) => right.priority - left.priority || right.score - left.score || left.scenario_id.localeCompare(right.scenario_id));
}

function confidence(score, config) { return score >= config.confidence_thresholds.high ? 'HIGH' : score >= config.confidence_thresholds.medium ? 'MEDIUM' : 'LOW'; }

export function validateIntentRoutingDecision(decision) {
  const errors = [];
  try { assertNoSensitiveData(decision, 'Intent Routing Decision'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(decision)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Routing Decision must be an object.' }] };
  for (const key of Object.keys(decision)) if (!decisionKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of decisionKeys) if (!(key in decision)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (decision.schema_version !== '0.1' || decision.record_type !== 'INTENT_ROUTING_DECISION' || !/^intentdecision_[a-f0-9]{64}$/u.test(decision.decision_id ?? '') || !statuses.has(decision.status)) errors.push({ path: '/', code: 'contract', message: 'Expected Intent Routing Decision V0.1.' });
  if ((decision.status === 'ROUTED') !== nonEmpty(decision.selected_scenario_id) || !Array.isArray(decision.candidate_scenarios) || !Array.isArray(decision.matched_rules) || !Array.isArray(decision.matched_signals) || !Array.isArray(decision.reason_codes)) errors.push({ path: '/', code: 'semantic', message: 'Invalid routing outcome or evidence collections.' });
  if (!(decision.routing_score === null || (typeof decision.routing_score === 'number' && decision.routing_score >= 0 && decision.routing_score <= 1)) || !['LOW', 'MEDIUM', 'HIGH'].includes(decision.confidence) || !['TEST_FIXTURE', 'REAL_USER_INTENT'].includes(decision.source_class) || !nonEmpty(decision.generated_at) || Number.isNaN(Date.parse(decision.generated_at)) || !plain(decision.metadata)) errors.push({ path: '/', code: 'type', message: 'Invalid score, confidence, source, time, or metadata.' });
  if (decision.source_class === 'TEST_FIXTURE' && decision.metadata.fixture_only !== true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Fixture Routing Decision must be fixture_only.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidIntentRoutingDecision(decision) { const checked = validateIntentRoutingDecision(decision); if (!checked.valid) throw new IntentRouterError('INTENT_ROUTING_DECISION_INVALID', 'Intent Routing Decision validation failed.', checked.errors); return decision; }

export class IntentRouter {
  constructor({ ruleRegistry, clock = { now: () => new Date() } }) { if (!(ruleRegistry instanceof IntentRuleRegistry)) throw new IntentRouterError('INTENT_RULE_REGISTRY_REQUIRED', 'Intent Rule Registry is required.'); this.ruleRegistry = ruleRegistry; this.clock = clock; }

  route(request) {
    assertNoSensitiveData(request, 'Intent Router input');
    const checked = validateIntentRequest(request);
    if (!checked.valid) return this.#invalidDecision(request, checked.errors);
    const config = this.ruleRegistry.routingConfig;
    const assessments = this.ruleRegistry.list({ enabledOnly: true }).map((rule) => assessRule(rule, request));
    const candidates = candidateScenarios(assessments, request);
    const eligible = candidates.filter((candidate) => candidate.eligible && candidate.score >= config.minimum_score);
    const filterReasons = candidates.map((candidate) => candidate.filter_reason).filter(Boolean);
    let status; let selected = null; let score = null; let reasons = [];
    if (eligible.length === 0) {
      status = candidates.some((candidate) => candidate.score >= config.minimum_score) ? 'ABSTAINED' : 'NO_MATCH';
      reasons.push(status === 'ABSTAINED' ? 'ROUTING_SCOPE_ABSTAINED' : 'NO_RULE_MATCH');
    } else if (eligible.length > 1 && eligible[0].priority === eligible[1].priority && eligible[0].score - eligible[1].score < config.ambiguity_margin) {
      status = 'AMBIGUOUS'; score = eligible[0].score; reasons.push('AMBIGUOUS_MATCH');
    } else {
      status = 'ROUTED'; selected = eligible[0].scenario_id; score = eligible[0].score; reasons.push('SCENARIO_ROUTED');
      if (eligible.length > 1 && eligible[0].priority > eligible[1].priority) reasons.push('RULE_PRIORITY_OVERRIDE');
    }
    reasons.push(...filterReasons);
    const matchedSignals = assessments.flatMap((assessment) => assessment.signals.filter((signal) => signal.matched).map((signal) => ({ rule_id: assessment.rule_id, target_scenario_id: assessment.target_scenario_id, signal_id: signal.signal_id, signal_type: signal.signal_type, matched_values: signal.matched_values, weight: signal.weight, contribution: signal.weight * assessment.rule_weight })));
    if (matchedSignals.some((signal) => signal.signal_type === 'keyword')) reasons.push('KEYWORD_MATCH');
    if (matchedSignals.some((signal) => signal.signal_type === 'phrase')) reasons.push('PHRASE_MATCH');
    if (matchedSignals.some((signal) => ['structured_hint', 'task_type', 'domain_hint'].includes(signal.signal_type))) reasons.push('STRUCTURED_HINT_MATCH');
    if (assessments.some((assessment) => assessment.signals.filter((signal) => signal.matched).length > 1)) reasons.push('MULTI_SIGNAL_MATCH');
    if (assessments.some((assessment) => assessment.excluded)) reasons.push('RULE_EXCLUDED_SIGNAL');
    if (assessments.some((assessment) => assessment.signals.some((signal) => signal.matched) && !assessment.required_satisfied)) reasons.push('REQUIRED_SIGNAL_MISSING');
    const semantic = { request, registry_rules: this.ruleRegistry.list({ enabledOnly: true }).map(({ rule_id, version }) => ({ rule_id, version })), candidates, assessments, status, selected, score, reasons: [...new Set(reasons)] };
    const decision = {
      schema_version: '0.1', record_type: 'INTENT_ROUTING_DECISION', decision_id: `intentdecision_${stableSha256(semantic)}`, request_id: request.request_id,
      status, selected_scenario_id: selected, candidate_scenarios: candidates,
      matched_rules: assessments.filter((assessment) => assessment.signals.some((signal) => signal.matched) || assessment.excluded_signal_evidence.some((signal) => signal.matched)),
      matched_signals: matchedSignals, routing_score: score, confidence: status === 'ROUTED' ? confidence(score, config) : 'LOW', reason_codes: [...new Set(reasons)],
      explanation: status === 'ROUTED' ? `Scenario ${selected} is selected from explicit rule evidence at priority ${eligible[0].priority} with routing score ${score.toFixed(6)}.` : status === 'AMBIGUOUS' ? 'The top permitted Scenario matches are within the configured ambiguity margin; no Scenario is selected.' : status === 'ABSTAINED' ? 'Rule evidence exists, but request Scenario filters permit no qualifying route.' : 'No enabled rule produced sufficient permitted evidence.',
      source_class: request.source_class === 'TEST_FIXTURE' ? 'TEST_FIXTURE' : 'REAL_USER_INTENT', generated_at: this.clock.now().toISOString(),
      metadata: { fixture_only: request.source_class === 'TEST_FIXTURE', router: 'starbench.deterministic-intent-router', router_version: '0.1', ambiguity_margin: config.ambiguity_margin, minimum_score: config.minimum_score },
    };
    assertValidIntentRoutingDecision(decision); return decision;
  }

  #invalidDecision(request, errors) {
    const safeRequestId = /^intent_[A-Za-z0-9_-]+$/u.test(request?.request_id ?? '') ? request.request_id : 'intent_invalid_request';
    const semantic = { safe_request_id: safeRequestId, errors: errors.map(({ path, code }) => ({ path, code })) };
    const fixture = request?.source_class === 'TEST_FIXTURE';
    const decision = { schema_version: '0.1', record_type: 'INTENT_ROUTING_DECISION', decision_id: `intentdecision_${stableSha256(semantic)}`, request_id: safeRequestId, status: 'INVALID_REQUEST', selected_scenario_id: null, candidate_scenarios: [], matched_rules: [], matched_signals: [], routing_score: null, confidence: 'LOW', reason_codes: ['INVALID_INTENT_REQUEST'], explanation: 'Intent Request validation failed; no routing was attempted.', source_class: fixture ? 'TEST_FIXTURE' : 'REAL_USER_INTENT', generated_at: this.clock.now().toISOString(), metadata: { fixture_only: fixture, router: 'starbench.deterministic-intent-router', router_version: '0.1', validation_errors: semantic.errors } };
    assertValidIntentRoutingDecision(decision); return decision;
  }
}

export function buildRecommendationRequestFromRouting({ routingDecision, scenarioRegistry, recommendationRequest }) {
  assertValidIntentRoutingDecision(routingDecision);
  if (routingDecision.status !== 'ROUTED') throw new IntentRouterError('ROUTING_NOT_RECOMMENDABLE', 'Only ROUTED Intent Decisions may construct a Recommendation Request.');
  if (!(scenarioRegistry instanceof ScenarioRegistry)) throw new IntentRouterError('SCENARIO_REGISTRY_REQUIRED', 'Scenario Registry validation is required.');
  if (!scenarioRegistry.list().some((scenario) => scenario.scenario_id === routingDecision.selected_scenario_id)) throw new IntentRouterError('ROUTED_SCENARIO_NOT_REGISTERED', 'Selected Scenario is not present in the existing Scenario Registry.');
  const result = structuredClone(recommendationRequest);
  result.scenario_id = routingDecision.selected_scenario_id;
  result.metadata = { ...result.metadata, intent_routing_decision_id: routingDecision.decision_id };
  assertValidRecommendationRequest(result);
  return result;
}
