import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { assessResourceBudget } from '../token-intelligence/resource-budget-consumer.mjs';
import { ExternalIdentityRunnerError } from './external-identity-runner-contracts.mjs';
import { validateIdentityTestBudget } from './adaptive-identity-budget-contracts.mjs';

const usageKeys = Object.freeze(['source_class', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_input_tokens', 'total_tokens']);
function fail(code, message) { throw new ExternalIdentityRunnerError(code, message); }
function nullableCount(value) { return value === null || (Number.isInteger(value) && value >= 0); }
function decimalParts(value) { const [whole, fraction = ''] = value.split('.'); return { digits: BigInt(whole + fraction), scale: fraction.length }; }
function compareDecimals(left, right) {
  const a = decimalParts(left); const b = decimalParts(right); const scale = Math.max(a.scale, b.scale);
  const av = a.digits * 10n ** BigInt(scale - a.scale); const bv = b.digits * 10n ** BigInt(scale - b.scale);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

export function normalizeIdentityTokenUsage(value) {
  if (value === null || value === undefined) return {
    usage_id: `identity_usage_${stableSha256({ status: 'UNKNOWN', source_class: 'NOT_REPORTED' })}`,
    status: 'UNKNOWN', source_class: 'NOT_REPORTED', input_tokens: null, output_tokens: null,
    reasoning_tokens: null, cached_input_tokens: null, total_tokens: null,
  };
  if (!plain(value) || Object.keys(value).some((key) => !usageKeys.includes(key)) || typeof value.source_class !== 'string' || !value.source_class) fail('IDENTITY_TOKEN_USAGE_MALFORMED', 'Token usage must be an explicit bounded object.');
  const usage = Object.fromEntries(usageKeys.map((key) => [key, key === 'source_class' ? value.source_class : value[key] ?? null]));
  for (const key of usageKeys.slice(1)) if (!nullableCount(usage[key])) fail('IDENTITY_TOKEN_USAGE_MALFORMED', `${key} must be null or a non-negative integer.`);
  if (usage.cached_input_tokens !== null && usage.input_tokens === null) fail('IDENTITY_TOKEN_USAGE_MALFORMED', 'Cached input cannot be known while input is unknown.');
  if (usage.cached_input_tokens !== null && usage.cached_input_tokens > usage.input_tokens) fail('IDENTITY_TOKEN_USAGE_MALFORMED', 'Cached input cannot exceed input.');
  if ([usage.input_tokens, usage.output_tokens, usage.reasoning_tokens, usage.total_tokens].every((item) => item !== null) && usage.input_tokens + usage.output_tokens + usage.reasoning_tokens !== usage.total_tokens) fail('IDENTITY_TOKEN_USAGE_MALFORMED', 'Explicit token components do not reconcile with total_tokens.');
  const known = usageKeys.slice(1).filter((key) => usage[key] !== null);
  const status = known.length === 0 ? 'UNKNOWN' : known.length === 1 && usage.total_tokens !== null ? 'TOTAL_ONLY' : known.length === 5 ? 'COMPLETE' : 'PARTIAL';
  const semantic = { status, ...usage };
  return { usage_id: `identity_usage_${stableSha256(semantic)}`, status, ...structuredClone(usage) };
}

export function assessIdentityUsageAgainstBudget({ budget, usage, requestsUsed = 0, monetaryAssessment = null, usageRequired = true } = {}) {
  const frozen = validateIdentityTestBudget(budget);
  const normalized = normalizeIdentityTokenUsage(usage);
  if (!Number.isInteger(requestsUsed) || requestsUsed < 0) fail('IDENTITY_REQUEST_USAGE_INVALID', 'requestsUsed must be a non-negative integer.');
  const violations = [];
  if (requestsUsed >= frozen.request_ceiling) violations.push('REQUEST_BUDGET_EXHAUSTED');
  for (const [component, ceiling] of Object.entries(frozen.token_ceiling)) {
    if (ceiling.value !== null) {
      const observed = normalized[`${component}_tokens`];
      if (observed === null && usageRequired) violations.push(`TOKEN_${component.toUpperCase()}_USAGE_UNKNOWN`);
      else if (observed >= ceiling.value) violations.push(`TOKEN_${component.toUpperCase()}_BUDGET_EXHAUSTED`);
    }
  }
  if (frozen.monetary_ceiling.amount !== null) {
    if (monetaryAssessment?.status !== 'CALCULATED' || monetaryAssessment.currency !== frozen.monetary_ceiling.currency) violations.push('MONETARY_USAGE_UNKNOWN');
    else if (compareDecimals(monetaryAssessment.total_amount, frozen.monetary_ceiling.amount) >= 0) violations.push('MONETARY_BUDGET_EXHAUSTED');
  }
  return {
    status: violations.length ? 'STOP_BUDGET_EXHAUSTED' : 'WITHIN_BUDGET',
    requests_used: requestsUsed,
    request_ceiling: frozen.request_ceiling,
    token_usage: normalized,
    violations,
  };
}

function resourceProposal({ usage, pricingSnapshot, entitlementSnapshot, billingMode, modelClass, calls }) {
  const api = billingMode === 'API_TOKEN_BILLED' && usage.status === 'COMPLETE' ? usage : null;
  const subscriptionTokens = usage.total_tokens ?? 0;
  const semantic = { usage_id: usage.usage_id, billingMode, modelClass, calls, pricing: pricingSnapshot?.snapshot_ref ?? null, entitlement: entitlementSnapshot?.snapshot_ref ?? null };
  return {
    schema_version: '0.1', record_type: 'RESOURCE_USAGE_PROPOSAL', resource_proposal_id: `resource_${stableSha256(semantic)}`,
    forecast_id: `identity_budget_${stableSha256(semantic)}`,
    api_token_billed: {
      input_tokens: api?.input_tokens ?? 0, cached_input_tokens: api?.cached_input_tokens ?? 0,
      output_tokens: api?.output_tokens ?? 0, reasoning_tokens: api?.reasoning_tokens ?? 0,
      total_tokens: api?.total_tokens ?? 0, calls: billingMode === 'API_TOKEN_BILLED' ? calls : 0,
      tokens_by_model: billingMode === 'API_TOKEN_BILLED' ? { [modelClass]: api?.total_tokens ?? 0 } : {},
    },
    subscription_quota: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: billingMode === 'SUBSCRIPTION_QUOTA' ? subscriptionTokens : 0, calls: billingMode === 'SUBSCRIPTION_QUOTA' ? calls : 0, tokens_by_model: billingMode === 'SUBSCRIPTION_QUOTA' ? { [modelClass]: subscriptionTokens } : {}, task_count: billingMode === 'SUBSCRIPTION_QUOTA' ? 1 : 0, context_tokens: 0, monetary_cost: null },
    pricing_snapshot_ref: billingMode === 'API_TOKEN_BILLED' ? pricingSnapshot?.snapshot_ref ?? null : null,
    entitlement_snapshot_ref: billingMode === 'SUBSCRIPTION_QUOTA' ? entitlementSnapshot?.snapshot_ref ?? null : null,
    pricing_authority: '03-01 AI资产成本', entitlement_authority: '03-01 AI资产成本',
    monetary_forecast_status: pricingSnapshot ? 'READY_FOR_EXTERNAL_CALCULATION' : 'PRICING_SNAPSHOT_REQUIRED',
    metadata: { source_class: 'TEST_FIXTURE', external_identity_budget_consumer: true },
  };
}

export function assessIdentityTestCost({ usage, pricingSnapshot = null, entitlementSnapshot = null, billingMode = 'API_TOKEN_BILLED', modelClass = 'OTHER_API_MODEL', calls = 0 } = {}) {
  const normalized = normalizeIdentityTokenUsage(usage);
  if (!['API_TOKEN_BILLED', 'SUBSCRIPTION_QUOTA'].includes(billingMode)) fail('IDENTITY_BILLING_MODE_INVALID', 'Identity billing mode is invalid.');
  if (billingMode === 'API_TOKEN_BILLED' && normalized.status !== 'COMPLETE') return { status: 'WITHHELD', reason: pricingSnapshot ? 'TOKEN_COMPONENTS_REQUIRED' : 'PRICING_SNAPSHOT_REQUIRED', total_amount: null, currency: pricingSnapshot?.currency ?? null, subscription_api_price_conversion: false };
  const assessment = assessResourceBudget({ resourceProposal: resourceProposal({ usage: normalized, pricingSnapshot, entitlementSnapshot, billingMode, modelClass, calls }), pricingSnapshot: billingMode === 'API_TOKEN_BILLED' ? pricingSnapshot : null, entitlementSnapshot: billingMode === 'SUBSCRIPTION_QUOTA' ? entitlementSnapshot : null });
  if (billingMode === 'SUBSCRIPTION_QUOTA') return { status: assessment.entitlement.status, reason: assessment.entitlement.reason, total_amount: null, currency: null, monetary_cost: null, subscription_api_price_conversion: false, entitlement: assessment.entitlement };
  return { ...assessment.pricing, subscription_api_price_conversion: false };
}
