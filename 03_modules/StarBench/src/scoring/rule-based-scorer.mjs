import { assertNoSensitiveData } from '../credential-provider.mjs';
import { plain, ScoringContractError } from './score-contracts.mjs';

const ruleTypes = new Set(['contains', 'not_contains', 'regex', 'numeric_range', 'required_fields']);

function validateRule(rule) {
  if (!plain(rule) || typeof rule.rule_id !== 'string' || rule.rule_id.length === 0 || !ruleTypes.has(rule.type)) throw new ScoringContractError('RULE_CONFIG_INVALID', 'Each rule requires rule_id and a supported type.');
  if (['contains', 'not_contains'].includes(rule.type) && typeof rule.value !== 'string') throw new ScoringContractError('RULE_CONFIG_INVALID', `${rule.type} requires string value.`);
  if (rule.type === 'regex') {
    if (typeof rule.pattern !== 'string' || typeof rule.flags !== 'string' || /[^dgimsuvy]/u.test(rule.flags)) throw new ScoringContractError('RULE_CONFIG_INVALID', 'regex requires a pattern and valid explicit flags.');
    try { new RegExp(rule.pattern, rule.flags); } catch (error) { throw new ScoringContractError('RULE_CONFIG_INVALID', 'Invalid regular expression.', [], error); }
  }
  if (rule.type === 'numeric_range' && (!(typeof rule.min === 'number' && Number.isFinite(rule.min)) || !(typeof rule.max === 'number' && Number.isFinite(rule.max)) || rule.max < rule.min)) throw new ScoringContractError('RULE_CONFIG_INVALID', 'numeric_range requires finite min <= max.');
  if (rule.type === 'required_fields' && (!Array.isArray(rule.fields) || rule.fields.length === 0 || !rule.fields.every((field) => typeof field === 'string' && field.length > 0) || new Set(rule.fields).size !== rule.fields.length)) throw new ScoringContractError('RULE_CONFIG_INVALID', 'required_fields requires unique field names.');
}

function evaluateRule(actual, rule) {
  if (rule.type === 'contains') return typeof actual === 'string' && actual.includes(rule.value);
  if (rule.type === 'not_contains') return typeof actual === 'string' && !actual.includes(rule.value);
  if (rule.type === 'regex') return typeof actual === 'string' && new RegExp(rule.pattern, rule.flags).test(actual);
  if (rule.type === 'numeric_range') return typeof actual === 'number' && Number.isFinite(actual) && actual >= rule.min && actual <= rule.max;
  if (rule.type === 'required_fields') return plain(actual) && rule.fields.every((field) => Object.hasOwn(actual, field));
  return false;
}

export function scoreRules({ actual, rules }) {
  assertNoSensitiveData({ actual, rules }, 'Rule-based scoring input');
  if (!Array.isArray(rules) || rules.length === 0) throw new ScoringContractError('RULE_CONFIG_INVALID', 'At least one rule is required.');
  for (const rule of rules) validateRule(rule);
  if (new Set(rules.map((rule) => rule.rule_id)).size !== rules.length) throw new ScoringContractError('RULE_CONFIG_INVALID', 'rule_id values must be unique.');
  const results = rules.map((rule) => ({ rule_id: rule.rule_id, type: rule.type, passed: evaluateRule(actual, rule) }));
  const passed = results.filter((result) => result.passed).length;
  return {
    raw_value: { passed, total: results.length, results },
    normalized_score: passed / results.length,
    provenance: { aggregation: 'equal_rule_fraction', rule_count: results.length },
  };
}
