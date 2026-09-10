import { assertNoSensitiveData } from '../credential-provider.mjs';
import { evaluateEvidenceSufficiency } from './evidence-sufficiency.mjs';

const attemptedStatuses = new Set(['RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'SKIPPED', 'BLOCKED']);
function groupBy(values, keyOf) { const groups = new Map(); for (const value of values) { const key = keyOf(value); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(value); } return groups; }
function counts(slots) { return { planned: slots.length, attempted: slots.filter((slot) => attemptedStatuses.has(slot.status)).length, successful: slots.filter((slot) => slot.status === 'SUCCEEDED').length, failed: slots.filter((slot) => slot.status === 'FAILED').length, partial: slots.filter((slot) => slot.status === 'PARTIAL').length, skipped: slots.filter((slot) => slot.status === 'SKIPPED').length, blocked: slots.filter((slot) => slot.status === 'BLOCKED').length, remaining: slots.filter((slot) => slot.status === 'PLANNED').length }; }
function summaries(slots, keyOf, field) { return [...groupBy(slots, keyOf)].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => ({ [field]: key, ...counts(values) })); }

export function buildCampaignSummary({ campaign, observations, requirements, generatedAt = new Date().toISOString() }) {
  assertNoSensitiveData({ campaign, observations }, 'Campaign Summary input');
  const totals = counts(observations);
  const repeatCoverage = [...groupBy(observations, (slot) => `${slot.candidate_id}|${slot.benchmark_task_id}`)].sort(([a], [b]) => a.localeCompare(b)).map(([key, slots]) => {
    const [candidateId, benchmarkTaskId] = key.split('|'); const terminalRepeats = [...new Set(slots.filter((slot) => ['SUCCEEDED', 'FAILED', 'PARTIAL', 'SKIPPED', 'BLOCKED'].includes(slot.status)).map((slot) => slot.repeat_index))].sort();
    return { candidate_id: candidateId, benchmark_task_id: benchmarkTaskId, planned_repeats: [...new Set(slots.map((slot) => slot.repeat_index))].sort(), terminal_repeats: terminalRepeats, complete: terminalRepeats.length === campaign.runs_per_task };
  });
  const readiness = evaluateEvidenceSufficiency({ observations, requirements });
  const summary = {
    schema_version: '0.1', record_type: 'CAMPAIGN_SUMMARY', campaign_id: campaign.campaign_id,
    planned_observations: totals.planned, attempted_observations: totals.attempted, successful_observations: totals.successful, failed_observations: totals.failed, partial_observations: totals.partial, skipped_observations: totals.skipped, blocked_observations: totals.blocked, remaining_observations: totals.remaining,
    candidate_summary: summaries(observations, (slot) => slot.candidate_id, 'candidate_id'), scenario_summary: summaries(observations, (slot) => slot.scenario_id, 'scenario_id'), task_summary: summaries(observations, (slot) => slot.benchmark_task_id, 'benchmark_task_id'), repeat_coverage: repeatCoverage, evidence_readiness: readiness,
    campaign_complete: totals.remaining === 0 && totals.attempted === totals.planned, source_class: 'TEST_FIXTURE', real_recommendation_ready: false, real_model_ranking_ready: false, generated_at: generatedAt,
  };
  assertNoSensitiveData(summary, 'Campaign Summary'); return summary;
}
