import { assertNoSensitiveData, sanitizeErrorMessage } from '../credential-provider.mjs';
import { buildCampaignSummary } from './campaign-summary.mjs';

export class CampaignRunnerError extends Error { constructor(code, message, cause = null) { super(message, cause ? { cause } : undefined); this.name = 'CampaignRunnerError'; this.code = code; } }

export class CampaignRunner {
  constructor({ plan, matrix, taskRegistry, harnessAdapters, requirements, clock = { now: () => new Date() } }) {
    if (plan?.record_type !== 'CAMPAIGN_PLAN' || !matrix || typeof matrix.list !== 'function' || !taskRegistry || typeof taskRegistry.get !== 'function' || !(harnessAdapters instanceof Map) || !requirements) throw new CampaignRunnerError('CAMPAIGN_RUNTIME_INPUT_INVALID', 'Plan, Observation Matrix, Task Registry, Harness Adapter registry, and evidence requirements are required.');
    const campaign = plan.campaign;
    if (campaign.source_class !== 'TEST_FIXTURE' || campaign.campaign_state !== 'TEST_ONLY' || campaign.budget_status !== 'NOT_AUTHORIZED_REAL_EXECUTION') throw new CampaignRunnerError('REAL_CAMPAIGN_NOT_AUTHORIZED', 'V0.1 runtime executes only TEST_ONLY Campaigns and never grants real execution.');
    if (campaign.retry_policy.retry_budget !== 0) throw new CampaignRunnerError('RETRY_UNSUPPORTED', 'V0.1 fixture runtime requires retry_budget = 0; planned repeats are not retries.');
    if (Number.isInteger(campaign.metadata?.max_requests) && plan.planned_observations > campaign.metadata.max_requests) throw new CampaignRunnerError('PLANNED_BUDGET_EXCEEDED', 'Planned observations exceed the declared fixture limit.');
    this.plan = plan; this.matrix = matrix; this.taskRegistry = taskRegistry; this.harnessAdapters = harnessAdapters; this.requirements = requirements; this.clock = clock;
  }

  async run({ maxSlots = Number.POSITIVE_INFINITY } = {}) {
    if (!(maxSlots === Number.POSITIVE_INFINITY || (Number.isInteger(maxSlots) && maxSlots >= 0))) throw new CampaignRunnerError('MAX_SLOTS_INVALID', 'maxSlots must be a non-negative integer or Infinity.');
    let executed = 0; let stopped = false;
    for (const plannedSlot of this.plan.slots) {
      if (executed >= maxSlots || stopped) break;
      const current = this.matrix.get(plannedSlot.observation_id);
      if (!current) throw new CampaignRunnerError('OBSERVATION_MATRIX_INCOMPLETE', `Missing planned slot ${plannedSlot.observation_id}.`);
      if (this.matrix.isTerminal(current.observation_id)) continue;
      if (current.status === 'RUNNING') throw new CampaignRunnerError('OBSERVATION_INDETERMINATE', `Slot ${current.observation_id} is already RUNNING and requires operator reconciliation.`);
      const adapter = this.harnessAdapters.get(current.candidate_id);
      if (!adapter) { this.matrix.block(current.observation_id, { code: 'HARNESS_ADAPTER_MISSING', safe_message: 'No fixture Harness Adapter is registered.' }); executed += 1; continue; }
      this.matrix.begin(current.observation_id); executed += 1;
      try {
        const task = this.taskRegistry.get(current.benchmark_task_id, current.task_version);
        if (!task) throw new CampaignRunnerError('BENCHMARK_TASK_MISSING', `Task ${current.benchmark_task_id}@${current.task_version} is missing.`);
        const result = await adapter.executeObservation({ slot: current, task, plan: this.plan });
        if (!['SUCCEEDED', 'FAILED', 'PARTIAL'].includes(result.observation_status)) throw new CampaignRunnerError('OBSERVATION_STATUS_INVALID', 'Harness Adapter returned an invalid status.');
        this.matrix.complete(current.observation_id, { status: result.observation_status, run_id: result.run_id, score_status: result.score_status, artifacts: result.artifacts, error: result.error });
      } catch (error) {
        this.matrix.complete(current.observation_id, { status: 'FAILED', error: { code: error?.code ?? 'CAMPAIGN_SLOT_FAILED', safe_message: sanitizeErrorMessage(error?.message) } });
      }
      const observations = this.matrix.list();
      const failures = observations.filter((slot) => slot.status === 'FAILED').length;
      const policy = this.plan.campaign.stop_policy;
      if ((policy.on_failure === 'STOP' && failures > 0) || (policy.max_failures !== null && failures >= policy.max_failures)) stopped = true;
    }
    const observations = this.matrix.list(); assertNoSensitiveData(observations, 'Campaign Runner observations');
    return { executed_slots: executed, stopped, observations, summary: buildCampaignSummary({ campaign: this.plan.campaign, observations, requirements: this.requirements, generatedAt: this.clock.now().toISOString() }) };
  }
}
