import { isIP } from 'node:net';
import { resolve } from 'node:path';

import { computeTaskDefinitionSha256, loadBenchmarkTask } from '../benchmark-task-loader.mjs';
import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { createIdentityTestBudget } from './adaptive-identity-budget-contracts.mjs';

export const AMD_QUICK_CAPABILITY_GATE_VERSION = '0.1.0';
export const AMD_QUICK_TARGET_URL = 'https://developer.amd.com.cn/radeon/api/v1/chat/completions';
export const AMD_QUICK_TARGET_HOST = 'developer.amd.com.cn';
export const AMD_QUICK_TARGET_PATH = '/radeon/api/v1/chat/completions';
export const AMD_QUICK_CLAIMED_MODEL = 'DeepSeek-V4-Flash';
export const AMD_QUICK_MAX_REQUESTS = 4;
export const AMD_QUICK_OBSERVED_TOKEN_STOP = 1_800;

const anchorDefinitions = Object.freeze([
  Object.freeze({
    order: 2,
    task_id: 'phase2.instruction-following.legacy-anchor',
    relative_path: 'benchmarks/phase2/instruction-following/legacy-anchor-instruction-v0.1.json',
    prompt_id: 'prompt_2dc59ec2b79057188eeb6b4b15df188db97ee0fd104f4195f55e9cc7c73affc8',
    max_output_tokens: 128,
    max_output_bytes: 2_048,
    scoring: 'EXISTING_RULE_BASED',
  }),
  Object.freeze({
    order: 3,
    task_id: 'phase2.coding.legacy-anchor',
    relative_path: 'benchmarks/phase2/coding/legacy-anchor-coding-v0.1.json',
    prompt_id: 'prompt_7bb4cca02f2bb6731f918a18394b02b3168e79ee7da63da052abff8fd92a24c9',
    max_output_tokens: 384,
    max_output_bytes: 8_192,
    scoring: 'MANUAL_REVIEW_REQUIRED',
  }),
  Object.freeze({
    order: 4,
    task_id: 'phase2.planning.legacy-anchor',
    relative_path: 'benchmarks/phase2/planning/legacy-anchor-planning-v0.1.json',
    prompt_id: 'prompt_5f314499bbfc9eeffc56a1c0e00b861ad5a611b3f6f1943ad851ec5e710b818f',
    max_output_tokens: 384,
    max_output_bytes: 8_192,
    scoring: 'MANUAL_REVIEW_REQUIRED',
  }),
]);

export class AmdQuickGateError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AmdQuickGateError';
    this.code = code;
  }
}

function fail(code, message, cause = null) { throw new AmdQuickGateError(code, message, cause); }

export function validateAmdQuickTarget(value) {
  let parsed;
  try { parsed = new URL(value); } catch (error) { fail('AMD_TARGET_INVALID', 'AMD target must be a valid URL.', error); }
  if (parsed.protocol !== 'https:') fail('AMD_TARGET_HTTPS_REQUIRED', 'AMD QUICK target requires HTTPS.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) fail('AMD_TARGET_AUTHORITY_INVALID', 'AMD target cannot contain userinfo, query, or fragment.');
  if (parsed.hostname !== AMD_QUICK_TARGET_HOST || parsed.pathname !== AMD_QUICK_TARGET_PATH || !['', '443'].includes(parsed.port)) fail('AMD_TARGET_NOT_ALLOWLISTED', 'AMD QUICK target does not match the frozen host, path, and port contract.');
  if (parsed.href !== AMD_QUICK_TARGET_URL) fail('AMD_TARGET_NOT_CANONICAL', 'AMD QUICK target must use the canonical frozen URL.');
  return { url: parsed.href, protocol: 'OPENAI_CHAT_COMPLETIONS_COMPATIBLE', redirect_policy: 'REJECT', hostname: parsed.hostname, path: parsed.pathname, port: 443 };
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 2, 168].includes(b))
    || (a === 198 && [18, 19, 51].includes(b))
    || (a === 203 && b === 0);
}

export function assertPublicAmdResolution(address) {
  const family = isIP(address);
  if (family === 4 && !privateIpv4(address)) return { address, family: 4 };
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower !== '::' && lower !== '::1' && !lower.startsWith('fe8') && !lower.startsWith('fe9') && !lower.startsWith('fea') && !lower.startsWith('feb') && !lower.startsWith('fc') && !lower.startsWith('fd') && !lower.startsWith('ff') && !lower.startsWith('::ffff:')) return { address, family: 6 };
  }
  fail('AMD_TARGET_RESOLUTION_REJECTED', 'AMD target resolved to a non-public or invalid address.');
}

export async function loadAmdQuickAnchors({ projectRoot } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot) fail('PROJECT_ROOT_REQUIRED', 'StarBench project root is required.');
  const anchors = [];
  for (const definition of anchorDefinitions) {
    const task = await loadBenchmarkTask(resolve(projectRoot, definition.relative_path), { rootDir: projectRoot });
    if (task.benchmark_task_id !== definition.task_id || task.version !== '1.0.0' || task.prompt_identity.prompt_id !== definition.prompt_id || task.metadata?.task_origin !== 'LEGACY_ANCHOR' || task.metadata?.legacy_instruction_changed !== false) fail('LEGACY_ANCHOR_IDENTITY_MISMATCH', 'Legacy Anchor identity no longer matches the frozen QUICK projection.');
    const promptBytes = Buffer.byteLength(task.prompt.instruction, 'utf8');
    if (promptBytes > 512) fail('ANCHOR_REVIEW_REQUIRED', 'Legacy Anchor exceeds the QUICK input gate.');
    anchors.push({
      order: definition.order,
      task,
      task_definition_sha256: computeTaskDefinitionSha256(task),
      prompt_bytes: promptBytes,
      max_output_tokens: definition.max_output_tokens,
      max_output_bytes: definition.max_output_bytes,
      scoring: definition.scoring,
    });
  }
  return anchors;
}

export async function createAmdQuickCapabilityPlan({ projectRoot } = {}) {
  const target = validateAmdQuickTarget(AMD_QUICK_TARGET_URL);
  const anchors = await loadAmdQuickAnchors({ projectRoot });
  const reusedBudget = createIdentityTestBudget({ mode: 'QUICK', maxRequests: AMD_QUICK_MAX_REQUESTS });
  const semantic = {
    target,
    target_claim: AMD_QUICK_CLAIMED_MODEL,
    pilot_type: 'QUICK_CAPABILITY_AND_API_HEALTH_SCREENING',
    request_budget_id: reusedBudget.budget_id,
    max_requests: AMD_QUICK_MAX_REQUESTS,
    preflight: {
      order: 1,
      prompt: 'Reply exactly: OK',
      prompt_bytes: Buffer.byteLength('Reply exactly: OK', 'utf8'),
      input_ceiling_bytes: 512,
      request_body_ceiling_bytes: 2_048,
      max_output_tokens: 8,
      max_output_bytes: 256,
    },
    anchors: anchors.map(({ task, ...item }) => ({ ...item, task_id: task.benchmark_task_id, task_version: task.version, prompt_id: task.prompt_identity.prompt_id })),
    observed_total_tokens_stop: AMD_QUICK_OBSERVED_TOKEN_STOP,
    token_ceiling_status: 'OPERATIONAL_OBSERVED_STOP_NOT_PROVIDER_HARD_GUARANTEE',
    usage_requirement: 'TOTAL_TOKENS_REQUIRED_FROM_REQUEST_1',
    long_context_enabled: false,
    attachments_allowed: false,
    history_messages_allowed: false,
    thinking_fallback_allowed: false,
    automatic_retry_allowed: false,
    identity_verification: 'NOT_PERFORMED',
    officiality: 'NOT_ESTABLISHED',
    pricing_status: 'WITHHELD_PRICING_SNAPSHOT_REQUIRED',
  };
  return {
    schema_version: '0.1',
    record_type: 'AMD_QUICK_CAPABILITY_PLAN',
    gate_version: AMD_QUICK_CAPABILITY_GATE_VERSION,
    plan_id: `amd_quick_plan_${stableSha256(semantic)}`,
    ...structuredClone(semantic),
    runtime_anchors: anchors,
  };
}

export function validatePilotAuthorization(value, { fixture = false } = {}) {
  if (!plain(value)) fail('AMD_QUICK_AUTHORIZATION_REQUIRED', 'Explicit AMD QUICK authorization is required.');
  const expected = fixture
    ? { execution_class: 'TEST_FIXTURE', target: AMD_QUICK_TARGET_URL, claimed_model: AMD_QUICK_CLAIMED_MODEL, max_requests: AMD_QUICK_MAX_REQUESTS, acknowledged_identity_not_performed: true }
    : { execution_class: 'AUTHORIZED_REMOTE_QUICK', target: AMD_QUICK_TARGET_URL, claimed_model: AMD_QUICK_CLAIMED_MODEL, max_requests: AMD_QUICK_MAX_REQUESTS, acknowledged_identity_not_performed: true, operator_command: '开始真实AMD QUICK测试' };
  const keys = Object.keys(expected).sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys) || keys.some((key) => value[key] !== expected[key])) fail('AMD_QUICK_AUTHORIZATION_INVALID', 'AMD QUICK authorization does not exactly match the frozen pilot contract.');
  return structuredClone(expected);
}
