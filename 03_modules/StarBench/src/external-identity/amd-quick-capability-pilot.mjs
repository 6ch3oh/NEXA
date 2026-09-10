import { createHash } from 'node:crypto';

import { BenchmarkHarness } from '../benchmark-harness.mjs';
import { assertNoSensitiveData } from '../credential-provider.mjs';
import { importRawResult } from '../raw-result-importer.mjs';
import { scoreRules } from '../scoring/rule-based-scorer.mjs';
import { stableSha256 } from '../scoring/score-contracts.mjs';
import {
  AMD_QUICK_CLAIMED_MODEL,
  AMD_QUICK_MAX_REQUESTS,
  AMD_QUICK_OBSERVED_TOKEN_STOP,
  AMD_QUICK_TARGET_URL,
  AmdQuickGateError,
  createAmdQuickCapabilityPlan,
  validatePilotAuthorization,
} from './amd-quick-capability-contracts.mjs';
import { sendAmdQuickRequest } from './amd-quick-https-transport.mjs';
import {
  makeAmdQuickLedgerEntry,
  normalizeAmdProviderUsage,
  validateAmdQuickRequestLedger,
} from './amd-quick-request-ledger.mjs';

function fail(code, message, cause = null) { throw new AmdQuickGateError(code, message, cause); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

class MemoryWriter {
  records = [];
  filePath = null;
  async write(record) { this.records.push(structuredClone(record)); return { status: 'memory_only', run_id: record.run_id }; }
}

function preflightHarnessTask(plan) {
  return {
    benchmark_task: 'amd.quick.preflight.v0.1',
    task_identity: { task_id: 'amd.quick.preflight.v0.1', task_version: '1.0.0' },
    prompt_identity: { prompt_id: `prompt_${stableSha256({ prompt: plan.preflight.prompt, version: '1.0.0' })}`, prompt_version: '1.0.0' },
    prompt: { instruction: plan.preflight.prompt, input_template: ' ' },
    input_definition: {},
    parameters: {
      temperature: 0,
      max_output_tokens: plan.preflight.max_output_tokens,
      long_context_enabled: false,
      attachments_allowed: false,
      history_messages_allowed: false,
      thinking_fallback_allowed: false,
    },
    metadata: { request_sequence: 1, request_role: 'PREFLIGHT', quick_projection: true, identity_verification: 'NOT_PERFORMED', officiality: 'NOT_ESTABLISHED' },
  };
}

function anchorHarnessTask(anchor) {
  const { task } = anchor;
  return {
    benchmark_task: task.benchmark_task_id,
    task_identity: { task_id: task.benchmark_task_id, task_version: task.version },
    prompt_identity: structuredClone(task.prompt_identity),
    prompt: structuredClone(task.prompt),
    input_definition: structuredClone(task.input_definition),
    parameters: {
      temperature: 0,
      max_output_tokens: anchor.max_output_tokens,
      long_context_enabled: false,
      attachments_allowed: false,
      history_messages_allowed: false,
      thinking_fallback_allowed: false,
    },
    metadata: {
      request_sequence: anchor.order,
      request_role: 'LEGACY_ANCHOR',
      quick_projection: true,
      legacy_anchor_definition_sha256: anchor.task_definition_sha256,
      original_execution_allowed: task.metadata.execution_allowed,
      source_evaluation_method: task.evaluation_method.type,
      identity_verification: 'NOT_PERFORMED',
      officiality: 'NOT_ESTABLISHED',
    },
  };
}

function stageForTask(plan, taskId) {
  if (taskId === 'amd.quick.preflight.v0.1') return {
    order: 1, role: 'PREFLIGHT', prompt: plan.preflight.prompt,
    max_output_tokens: plan.preflight.max_output_tokens,
    max_output_bytes: plan.preflight.max_output_bytes,
    max_input_bytes: plan.preflight.input_ceiling_bytes,
    scoring: 'NOT_SCORED_PREFLIGHT', task: null,
  };
  const anchor = plan.runtime_anchors.find((item) => item.task.benchmark_task_id === taskId);
  return anchor ? { ...anchor, role: 'LEGACY_ANCHOR', prompt: anchor.task.prompt.instruction, max_input_bytes: 512 } : null;
}

function safeHttpFailureEvidence(error) {
  return error?.httpEvidence ?? {
    status_code: null,
    response_timestamp: new Date().toISOString(),
    content_type: null,
    redirect_status: null,
    transport_status: 'FAILED_BEFORE_HTTP',
  };
}

function decideRequest({ sequence, rawResult, cumulativeAfter }) {
  if (!rawResult.success) return { decision: 'STOP', reason: rawResult.metadata?.gate_stop_reason ?? 'STOP_RAW_RESULT_FAILED', next: false };
  if (cumulativeAfter >= AMD_QUICK_OBSERVED_TOKEN_STOP) return { decision: 'STOP', reason: 'STOP_TOKEN_CEILING_REACHED', next: false };
  if (sequence === AMD_QUICK_MAX_REQUESTS) return { decision: 'STOP', reason: 'PILOT_COMPLETE_MAX_REQUESTS', next: false };
  return { decision: 'CONTINUE', reason: sequence === 1 ? 'PREFLIGHT_PASS' : 'WITHIN_BUDGET_AND_VALID_RESULT', next: true };
}

function capabilityStatus(anchorResults) {
  const successful = anchorResults.filter((item) => item.raw_result.success).length;
  if (successful === 0) return 'INCONCLUSIVE';
  if (anchorResults.some((item) => !item.raw_result.success)) return 'DEGRADED';
  return successful === 3 ? 'NORMAL' : 'INCONCLUSIVE';
}

export async function runAmdQuickCapabilityPilot({
  projectRoot,
  authorization,
  accessHandle,
  fixture = false,
  resolver,
  requestImpl,
  writer = null,
  clock = null,
  runIdFactory = null,
} = {}) {
  validatePilotAuthorization(authorization, { fixture });
  if (!fixture && (!writer || typeof writer.write !== 'function')) fail('AMD_REAL_WRITER_REQUIRED', 'A real AMD QUICK Pilot requires the existing persistent RAW_RESULT writer.');
  const plan = await createAmdQuickCapabilityPlan({ projectRoot });
  if (!accessHandle || typeof accessHandle.useAuthorization !== 'function' || typeof accessHandle.destroy !== 'function') fail('AMD_ACCESS_BOUNDARY_REQUIRED', 'One-shot access boundary is required.');
  const persistedWriter = writer ?? new MemoryWriter();
  const pilotId = `amd_quick_pilot_${stableSha256({ plan_id: plan.plan_id, fixture, target: AMD_QUICK_TARGET_URL })}`;
  const quickScores = new Map();
  const rawResults = [];
  const canonicalEvaluations = [];
  const ledger = [];
  const anchorResults = [];
  let preflightEvidence = null;
  let cumulative = 0;
  let returnedModel = null;

  const adapter = {
    providerIdentity: 'amd-radeon-cloud', modelIdentity: AMD_QUICK_CLAIMED_MODEL,
    adapterIdentity: 'starbench.amd-quick-capability-adapter', adapterVersion: '0.1.0',
    endpointClass: 'AMD_AUTHORIZED_REMOTE_QUICK_EXACT_TARGET',
    execute: async ({ credential, task }) => {
      const stage = stageForTask(plan, task.benchmark_task);
      if (!stage) fail('ANCHOR_NOT_ALLOWLISTED', 'Only Preflight and the three frozen Legacy Anchors are allowed.');
      const runtimeAccess = credential.use((opaque) => ({ useAuthorization: opaque.useAuthorization }));
      try {
        const response = await sendAmdQuickRequest({
          targetUrl: AMD_QUICK_TARGET_URL,
          model: AMD_QUICK_CLAIMED_MODEL,
          prompt: task.prompt.instruction,
          maxTokens: stage.max_output_tokens,
          maxInputBytes: stage.max_input_bytes,
          maxOutputBytes: stage.max_output_bytes,
          accessHandle: runtimeAccess,
          resolver,
          requestImpl,
        });
        const normalized = normalizeAmdProviderUsage(response.data.usage, { sourceClass: fixture ? 'TEST_FIXTURE_PROVIDER_RESPONSE' : 'PROVIDER_RESPONSE' });
        const providerCompletion = response.data.usage?.completion_tokens ?? null;
        if (providerCompletion !== null && (!Number.isInteger(providerCompletion) || providerCompletion > stage.max_output_tokens)) fail('STOP_OUTPUT_CAP_VIOLATION', 'AMD reported completion usage above the requested max_tokens.');
        returnedModel ??= typeof response.data.model === 'string' ? response.data.model : null;
        const outputHash = sha256(response.content);
        let score = { status: 'NOT_SCORED_PREFLIGHT', raw_value: null, normalized_score: null, provenance: { evaluation_method: 'none' } };
        if (stage.task?.evaluation_method.type === 'rule_based') score = { status: 'SCORED', ...scoreRules({ actual: response.content, rules: stage.task.evaluation_method.config.rules }) };
        else if (stage.task) score = { status: 'MANUAL_REVIEW_REQUIRED', raw_value: null, normalized_score: null, provenance: { evaluation_method: stage.task.evaluation_method.type } };
        quickScores.set(task.benchmark_task, structuredClone(score));
        return {
          success: true,
          usage: {
            prompt_tokens: response.data.usage?.prompt_tokens ?? null,
            completion_tokens: response.data.usage?.completion_tokens ?? null,
            total_tokens: response.data.usage?.total_tokens ?? null,
          },
          request_metadata: { request_id: `${pilotId}:request:${stage.order}`, response_reference: `sha256:${outputHash}` },
          metadata: {
            request_sequence: stage.order,
            request_role: stage.role,
            http_evidence: response.http_evidence,
            response_schema_status: 'VALID_OPENAI_CHAT_COMPLETION',
            normalized_usage: normalized,
            output_sha256: outputHash,
            output_bytes: response.output_bytes,
            output_limit_behavior: 'PASS',
            transport_latency_ms: response.latency_ms,
            resolved_address: response.resolved_address,
            quick_scoring_status: score.status,
            returned_model: typeof response.data.model === 'string' ? response.data.model : null,
            gate_stop_reason: null,
            identity_verification: 'NOT_PERFORMED',
            officiality: 'NOT_ESTABLISHED',
          },
        };
      } catch (error) {
        return {
          success: false,
          error,
          usage: null,
          metadata: {
            request_sequence: stage.order,
            request_role: stage.role,
            http_evidence: safeHttpFailureEvidence(error),
            response_schema_status: 'INVALID_OR_UNAVAILABLE',
            normalized_usage: normalizeAmdProviderUsage(null, { usageRequired: false }),
            output_sha256: null,
            output_bytes: null,
            output_limit_behavior: error?.code === 'AMD_OUTPUT_LIMIT_VIOLATION' || error?.code === 'STOP_OUTPUT_CAP_VIOLATION' ? 'FAIL' : 'UNKNOWN',
            quick_scoring_status: 'NOT_SCORED',
            returned_model: null,
            gate_stop_reason: error?.code ?? 'STOP_UNEXPECTED_FAILURE',
            identity_verification: 'NOT_PERFORMED',
            officiality: 'NOT_ESTABLISHED',
          },
        };
      }
    },
  };
  const provider = { getCredential: async () => accessHandle.asRuntimeCredential() };
  let generatedRun = 1;
  const harness = new BenchmarkHarness({
    adapter, credentialProvider: provider, writer: persistedWriter,
    recordType: fixture ? 'TEST_FIXTURE' : 'RAW_RESULT',
    runIdFactory: runIdFactory ?? (() => `run_amd_quick_${generatedRun++}`),
    clock,
    executionEnvironment: { runtime: 'node', network: fixture ? 'localhost_synthetic_amd' : 'authorized_remote_quick', target_contract: 'AMD_EXACT_V0.1' },
  });

  const stages = [preflightHarnessTask(plan), ...plan.runtime_anchors.map(anchorHarnessTask)];
  try {
    for (const task of stages) {
      const sequence = task.metadata.request_sequence;
      if (ledger.length > 0 && ledger.at(-1).next_request_allowed !== true) break;
      if (sequence !== ledger.length + 1 || sequence > AMD_QUICK_MAX_REQUESTS) fail('REQUEST_LEDGER_SEQUENCE_INVALID', 'Pilot request sequence is invalid before transport.');
      const rawResult = await harness.run(task);
      const canonical = importRawResult(rawResult);
      const normalizedUsage = rawResult.metadata?.normalized_usage ?? normalizeAmdProviderUsage(null, { usageRequired: false });
      const current = normalizedUsage.total_tokens;
      const cumulativeAfter = cumulative + (current ?? 0);
      const decision = decideRequest({ sequence, rawResult, cumulativeAfter });
      const rawReference = {
        artifact_id: `raw_result:${rawResult.run_id}`,
        path: typeof persistedWriter.filePath === 'string' ? persistedWriter.filePath : null,
        run_id: rawResult.run_id,
        sha256: canonical.raw_source_identity.raw_record_sha256,
        canonical_evaluation_id: canonical.evaluation_id,
      };
      const entry = makeAmdQuickLedgerEntry({
        pilotId,
        sequence,
        role: task.metadata.request_role,
        taskIdentity: task.task_identity,
        rawResult,
        canonicalEvaluation: canonical,
        usage: normalizedUsage,
        cumulativeBefore: cumulative,
        decision: decision.decision,
        decisionReason: decision.reason,
        nextRequestAllowed: decision.next,
        rawArtifactReference: rawReference,
      });
      cumulative = entry.cumulative_tokens.after;
      rawResults.push(rawResult);
      canonicalEvaluations.push(canonical);
      ledger.push(entry);
      const nativeScore = quickScores.get(task.benchmark_task) ?? { status: rawResult.success ? 'UNSCORED' : 'FAILED' };
      const scoreData = nativeScore.status === 'SCORED'
        ? { ...nativeScore, status: 'SCORED_BY_EXISTING_RULES', source_status: nativeScore.status }
        : nativeScore;
      const evidence = { order: sequence, benchmark_task_id: task.benchmark_task, raw_result: rawResult, canonical_evaluation: canonical, ledger_entry: entry, score: scoreData };
      if (sequence === 1) preflightEvidence = evidence;
      else anchorResults.push(evidence);
    }
  } finally {
    accessHandle.destroy();
  }

  const ledgerValidation = validateAmdQuickRequestLedger({ entries: ledger, rawResults, canonicalEvaluations });
  const finalEntry = ledger.at(-1);
  const preflightPass = preflightEvidence?.raw_result.success === true;
  const stopCode = finalEntry?.continuation_decision === 'STOP' ? finalEntry.decision_reason : null;
  const stopTriggered = stopCode !== null && stopCode !== 'PILOT_COMPLETE_MAX_REQUESTS';
  const preflight = preflightPass ? {
    status: 'PASS',
    returned_model: returnedModel,
    usage: structuredClone(preflightEvidence.ledger_entry.usage),
    output_limit_behavior: preflightEvidence.raw_result.metadata.output_limit_behavior,
    latency_ms: preflightEvidence.raw_result.latency_ms,
    output_sha256: preflightEvidence.raw_result.metadata.output_sha256,
    raw_result_reference: structuredClone(preflightEvidence.ledger_entry.raw_evidence_reference),
    canonical_evaluation_id: preflightEvidence.canonical_evaluation.evaluation_id,
    http_status: preflightEvidence.ledger_entry.http_evidence.status_code,
  } : { status: 'FAIL', stop_code: stopCode, raw_result_reference: preflightEvidence?.ledger_entry.raw_evidence_reference ?? null, http_status: preflightEvidence?.ledger_entry.http_evidence.status_code ?? null };
  const semantic = {
    pilot_id: pilotId,
    plan_id: plan.plan_id,
    target_claim: AMD_QUICK_CLAIMED_MODEL,
    request_ledger_hashes: ledger.map((item) => item.evidence_hash),
    observed_total_tokens: cumulative,
    final_decision: finalEntry?.continuation_decision ?? 'STOP',
    stop_reason: stopCode,
    capability_screening: capabilityStatus(anchorResults),
  };
  const report = {
    schema_version: '0.1', record_type: 'AMD_QUICK_CAPABILITY_SCREENING',
    report_id: `amd_quick_report_${stableSha256(semantic)}`,
    pilot_id: pilotId,
    target: AMD_QUICK_TARGET_URL, claimed_model: AMD_QUICK_CLAIMED_MODEL,
    api_health: preflightPass ? 'PASS' : 'FAIL',
    api_compatibility: preflightPass ? 'PASS' : 'FAIL',
    usage_reporting: preflightPass ? 'PASS' : 'FAIL',
    output_limit_behavior: preflight.output_limit_behavior ?? 'FAIL',
    legacy_anchor_completed: anchorResults.filter((item) => item.raw_result.success).length,
    capability_screening: semantic.capability_screening,
    observed_total_tokens: cumulative || null,
    latency_ms: rawResults.map((item) => item.latency_ms),
    identity_verification: 'NOT_PERFORMED', officiality: 'NOT_ESTABLISHED',
    pricing_status: 'WITHHELD_PRICING_SNAPSHOT_REQUIRED',
    requests_used: ledger.length, max_requests: AMD_QUICK_MAX_REQUESTS,
    early_stop: { triggered: stopTriggered, code: stopCode },
    preflight,
    preflight_evidence: preflightEvidence,
    anchor_results: anchorResults,
    request_ledger_version: ledger[0]?.ledger_version ?? null,
    request_ledger: ledger,
    request_ledger_validation: ledgerValidation,
    provenance: { planner: plan.plan_id, gate_version: plan.gate_version, evidence_boundary: 'EXISTING_HARNESS_RAW_RESULT_CANONICAL_EVALUATION_REQUEST_LEDGER', source_class: fixture ? 'TEST_FIXTURE' : 'PROVIDER_EXECUTION' },
  };
  assertNoSensitiveData(report, 'AMD QUICK Capability Report');
  return report;
}
