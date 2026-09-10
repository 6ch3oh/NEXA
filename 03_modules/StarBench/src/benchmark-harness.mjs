import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { assertNoSensitiveData, sanitizeErrorMessage } from './credential-provider.mjs';

function nullableInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function nullableNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeError(error, fallbackCategory = 'adapter_error') {
  return {
    category: typeof error?.category === 'string' && error.category ? error.category : fallbackCategory,
    safe_message: sanitizeErrorMessage(error?.message),
    status_code: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    retryable: error?.retryable === true,
  };
}

export class BenchmarkHarness {
  constructor({ adapter, credentialProvider, writer, recordType = 'TEST_FIXTURE', runIdFactory = () => `run_${randomUUID()}`, clock = null, executionEnvironment = null }) {
    if (!adapter || !credentialProvider || !writer) throw new TypeError('adapter, credentialProvider, and writer are required.');
    if (!['RAW_RESULT', 'TEST_FIXTURE'].includes(recordType)) throw new TypeError('Harness recordType must be RAW_RESULT or TEST_FIXTURE.');
    this.adapter = adapter;
    this.credentialProvider = credentialProvider;
    this.writer = writer;
    this.recordType = recordType;
    this.runIdFactory = runIdFactory;
    this.clock = clock ?? { now: () => new Date(), monotonicNow: () => performance.now() };
    this.executionEnvironment = executionEnvironment ?? { runtime: 'node', network: 'disabled' };
  }

  async run(task) {
    const runId = this.runIdFactory();
    const timestamp = this.clock.now().toISOString();
    let started = null;
    let ended = null;
    let outcome;
    let failure = null;
    try {
      const credential = await this.credentialProvider.getCredential({ run_id: runId, provider: this.adapter.providerIdentity });
      started = this.clock.monotonicNow();
      try {
        outcome = await this.adapter.execute({
          credential,
          task: structuredClone(task),
          parameters: structuredClone(task.parameters ?? {}),
          runContext: Object.freeze({ run_id: runId, timestamp }),
        });
      } finally {
        ended = this.clock.monotonicNow();
      }
      assertNoSensitiveData(outcome, 'Provider outcome');
    } catch (error) {
      failure = safeError(error, error?.code === 'CREDENTIAL_SERIALIZATION_FORBIDDEN' ? 'credential_error' : 'adapter_error');
      outcome = {};
    }
    const latencyMs = started === null || ended === null ? null : Math.max(0, ended - started);
    const success = failure === null && outcome?.success !== false;
    const promptTokens = nullableInteger(outcome?.usage?.prompt_tokens);
    const completionTokens = nullableInteger(outcome?.usage?.completion_tokens);
    const totalTokens = nullableInteger(outcome?.usage?.total_tokens);
    const throughput = completionTokens !== null && latencyMs !== null && latencyMs > 0 ? completionTokens / (latencyMs / 1000) : null;
    const cost = outcome?.cost === undefined ? null : structuredClone(outcome.cost);
    const error = success ? null : failure ?? safeError(outcome?.error ?? new Error('Provider reported failure.'));
    const measurementProvenance = {
      latency: latencyMs === null
        ? { state: 'UNAVAILABLE', source: null, boundary_start: null, boundary_end: null, unit: 'ms' }
        : {
            state: 'OBSERVED',
            source: 'local_monotonic_clock',
            boundary_start: 'immediately_before_provider_adapter_execute',
            boundary_end: 'immediately_after_provider_adapter_execute',
            unit: 'ms',
          },
      throughput: throughput === null
        ? { state: 'UNAVAILABLE', source: null, formula: null }
        : { state: 'OBSERVED', source: 'computed', formula: 'completion_tokens / (latency_ms / 1000)', input_fields: ['completion_tokens', 'latency_ms'] },
      cost: cost === null
        ? { state: 'UNAVAILABLE', source: null }
        : { state: 'OBSERVED', source: 'provider_reported' },
    };
    const responseReference = typeof outcome?.request_metadata?.response_reference === 'string' ? outcome.request_metadata.response_reference : null;
    const rawResult = {
      schema_version: '0.1',
      record_type: this.recordType,
      run_id: runId,
      timestamp,
      provider: this.adapter.providerIdentity,
      model: this.adapter.modelIdentity,
      benchmark_task: task.benchmark_task,
      task_identity: structuredClone(task.task_identity),
      prompt_identity: structuredClone(task.prompt_identity),
      parameters: structuredClone(task.parameters ?? {}),
      success,
      latency_ms: latencyMs,
      ttft_ms: nullableNumber(outcome?.ttft_ms),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      throughput_tokens_per_second: throughput,
      cost,
      request_provenance: {
        provider_identity: this.adapter.providerIdentity,
        adapter_identity: this.adapter.adapterIdentity,
        adapter_version: this.adapter.adapterVersion,
        endpoint_class: this.adapter.endpointClass,
        request_id: typeof outcome?.request_metadata?.request_id === 'string' ? outcome.request_metadata.request_id : null,
        execution_environment: structuredClone(this.executionEnvironment),
      },
      error,
      source_class: this.recordType === 'TEST_FIXTURE' ? 'TEST_FIXTURE' : 'PROVIDER_EXECUTION',
      metadata: {
        ...structuredClone(task.metadata ?? {}),
        ...(outcome?.metadata && typeof outcome.metadata === 'object' ? structuredClone(outcome.metadata) : {}),
        measurement_provenance: measurementProvenance,
        response_reference: responseReference,
      },
    };
    assertNoSensitiveData(rawResult, 'RAW_RESULT');
    await this.writer.write(rawResult);
    return rawResult;
  }
}
