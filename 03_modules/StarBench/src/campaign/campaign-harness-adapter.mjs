import { assertNoSensitiveData } from '../credential-provider.mjs';

function runtimeMetricDefinitions(task) {
  const method = task.evaluation_method.type;
  const weight = 1 / task.metrics.length;
  return task.metrics.map((metricId) => {
    const manual = method === 'manual';
    const scorer = manual ? 'manual' : method;
    if (!['manual', 'exact_match', 'rule_based'].includes(scorer)) throw new CampaignHarnessAdapterError('EVALUATION_METHOD_UNSUPPORTED', `Campaign Harness Adapter cannot bind ${method}.`);
    return {
      schema_version: '0.1', record_type: 'METRIC_DEFINITION', metric_id: metricId,
      name: `Campaign runtime binding for ${metricId}`,
      description: `Fixture-only execution binding derived from the formal task ${task.evaluation_method.type} declaration without changing the task definition.`,
      metric_type: manual ? 'manual' : 'binary', direction: 'higher_is_better', weight,
      range: manual ? null : { min: 0, max: 1 },
      normalization: manual ? { method: 'none', min: null, max: null, clamp: false } : { method: 'identity', min: 0, max: 1, clamp: true },
      scorer,
      parameters: manual ? {} : scorer === 'exact_match' ? { normalization: structuredClone(task.evaluation_method.config.normalization ?? []) } : { rules: structuredClone(task.evaluation_method.config.rules ?? []) },
      required: true, metadata: { fixture_only: true, derived_runtime_binding: true, formal_task_id: task.benchmark_task_id },
    };
  });
}

function executableScoringView(task) {
  const value = structuredClone(task);
  value.evaluation_method.config = { ...value.evaluation_method.config, metric_definitions: runtimeMetricDefinitions(task) };
  return value;
}

export class CampaignHarnessAdapterError extends Error { constructor(code, message) { super(message); this.name = 'CampaignHarnessAdapterError'; this.code = code; } }

export class CampaignHarnessAdapter {
  constructor({ candidate, benchmarkRunner, scoreEngine, scoreStore }) {
    if (candidate?.source_class !== 'TEST_FIXTURE' || candidate?.status !== 'TEST_ONLY') throw new CampaignHarnessAdapterError('FIXTURE_CANDIDATE_REQUIRED', 'Campaign Harness Adapter accepts TEST_ONLY fixture Candidates only.');
    if (!benchmarkRunner || typeof benchmarkRunner.runSuite !== 'function' || !scoreEngine || typeof scoreEngine.scoreEvaluation !== 'function' || !scoreStore || typeof scoreStore.write !== 'function') throw new CampaignHarnessAdapterError('EXISTING_PIPELINE_REQUIRED', 'Existing Benchmark Runner, Score Engine, and Score Store are required.');
    if (benchmarkRunner.harness?.recordType !== 'TEST_FIXTURE') throw new CampaignHarnessAdapterError('FIXTURE_HARNESS_REQUIRED', 'Harness must emit TEST_FIXTURE records.');
    if (benchmarkRunner.harness?.adapter?.providerIdentity !== candidate.provider || benchmarkRunner.harness?.adapter?.modelIdentity !== candidate.model) throw new CampaignHarnessAdapterError('CANDIDATE_ADAPTER_MISMATCH', 'Candidate identity and runtime Adapter identity must match without becoming the same object.');
    this.candidate = structuredClone(candidate); this.benchmarkRunner = benchmarkRunner; this.scoreEngine = scoreEngine; this.scoreStore = scoreStore;
  }

  async executeObservation({ slot, task, plan }) {
    if (slot.candidate_id !== this.candidate.candidate_id || task.benchmark_task_id !== slot.benchmark_task_id) throw new CampaignHarnessAdapterError('OBSERVATION_BINDING_MISMATCH', 'Observation slot, Candidate, and Task do not match.');
    const taskView = structuredClone(task);
    taskView.metadata = { ...taskView.metadata, campaign_observation: { observation_id: slot.observation_id, campaign_id: slot.campaign_id, candidate_id: slot.candidate_id, repeat_index: slot.repeat_index, schedule_index: slot.schedule_index } };
    const resolvedSingleTaskSuite = { definition: { default_parameters: structuredClone(plan.suite_default_parameters) }, suite_identity: structuredClone(plan.suite_identity), tasks: [{ order: slot.suite_order, task: taskView }] };
    const run = await this.benchmarkRunner.runSuite(resolvedSingleTaskSuite, { parameterOverrides: { ...structuredClone(this.candidate.parameters), campaign_observation: { observation_id: slot.observation_id, campaign_id: slot.campaign_id, candidate_id: slot.candidate_id, repeat_index: slot.repeat_index, schedule_index: slot.schedule_index } } });
    const item = run.results[0];
    if (item.raw_result.record_type !== 'TEST_FIXTURE' || item.raw_result.source_class !== 'TEST_FIXTURE' || item.evaluation.raw_source_identity.source_class !== 'TEST_FIXTURE') throw new CampaignHarnessAdapterError('SOURCE_ISOLATION_FAILED', 'Campaign runtime admitted a non-fixture artifact.');
    const observation = item.raw_result.metadata?.scoring_observation ?? null;
    const scored = this.scoreEngine.scoreEvaluation({ evaluation: item.evaluation, benchmarkTask: executableScoringView(task), observation });
    for (const metricScore of scored.metric_scores) await this.scoreStore.write(metricScore);
    await this.scoreStore.write(scored.task_score);
    const requestedStatus = item.raw_result.metadata?.campaign_observation_status;
    const observationStatus = item.raw_result.success === false ? 'FAILED' : requestedStatus === 'PARTIAL' ? 'PARTIAL' : 'SUCCEEDED';
    const result = {
      observation_status: observationStatus, run_id: item.raw_result.run_id, score_status: scored.task_score.status,
      artifacts: { raw_run_id: item.raw_result.run_id, evaluation_id: item.evaluation.evaluation_id, task_score_id: scored.task_score.task_score_id, metric_score_ids: scored.metric_scores.map((score) => score.score_id) },
      error: item.raw_result.error,
      raw_result: item.raw_result, evaluation: item.evaluation, task_score: scored.task_score,
    };
    assertNoSensitiveData(result, 'Campaign Harness Adapter result'); return result;
  }
}

export function buildRuntimeScoringViewForTest(task) { return executableScoringView(task); }
