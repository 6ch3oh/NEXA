import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { stableSha256 } from './contracts.mjs';

const bounded = (rootDir, target) => {
  const root = resolve(rootDir), path = resolve(target), rel = relative(root, path);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    const error = new Error('Evidence Ledger path escape.'); error.code = 'ESTIMATOR_EVIDENCE_PATH_ESCAPE'; throw error;
  }
  return path;
};
const classes = new Set(['RETROSPECTIVE_SUPPORT', 'PROSPECTIVE_SUPPORT', 'PROSPECTIVE_COUNTEREVIDENCE', 'SEMANTIC_SUPPORT', 'SEMANTIC_COUNTEREVIDENCE', 'PROJECT_SCALE_ONLY']);

export class EstimatorEvidenceLedger {
  constructor({ rootDir = process.cwd(), filePath }) { this.filePath = bounded(rootDir, filePath); }
  async readAll() { try { return (await readFile(this.filePath, 'utf8')).split(/\r?\n/u).filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
  async append(input) {
    if (!classes.has(input.evidence_class)) { const error = new Error('Promotion evidence class invalid.'); error.code = 'PROMOTION_EVIDENCE_INVALID'; throw error; }
    const entry = { schema_version: '0.1', record_type: 'ESTIMATOR_EVIDENCE_ENTRY', evidence_id: '', case_id: input.case_id, evidence_class: input.evidence_class, comparison_status: input.comparison_status ?? 'INCONCLUSIVE', production_error: input.production_error ?? null, shadow_error: input.shadow_error ?? null, production_band_result: input.production_band_result ?? null, shadow_band_result: input.shadow_band_result ?? null, semantic_integrity: input.semantic_integrity ?? 'UNKNOWN', candidate_rule_refs: [...new Set(input.candidate_rule_refs ?? [])], source_ref: input.source_ref, recorded_at: input.recorded_at, metadata: { counterevidence_retained: true, automatic_promotion: false, ...input.metadata } };
    entry.evidence_id = `estimator_evidence_${stableSha256({ ...entry, evidence_id: undefined })}`;
    const all = await this.readAll(); if (all.some((item) => item.evidence_id === entry.evidence_id)) return { status: 'DUPLICATE_SKIPPED', entry };
    await mkdir(dirname(this.filePath), { recursive: true }); await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8'); return { status: 'APPENDED', entry };
  }
}

export function buildPromotionGateV02({ rules, evidence, governance_review = null }) {
  const explicitReview = governance_review?.mode === 'EXPLICIT_CLOSEOUT_GOVERNANCE_REVIEW';
  const results = rules.map((rule) => {
    const related = evidence.filter((item) => item.candidate_rule_refs.includes(rule.rule_id));
    const prospective = related.filter((item) => ['PROSPECTIVE_SUPPORT', 'PROSPECTIVE_COUNTEREVIDENCE'].includes(item.evidence_class));
    const prospectiveSupport = prospective.filter((item) => item.evidence_class === 'PROSPECTIVE_SUPPORT' && item.comparison_status === 'SHADOW_BETTER');
    const support = related.filter((item) => ['RETROSPECTIVE_SUPPORT', 'PROSPECTIVE_SUPPORT', 'SEMANTIC_SUPPORT'].includes(item.evidence_class));
    const counter = related.filter((item) => ['PROSPECTIVE_COUNTEREVIDENCE', 'SEMANTIC_COUNTEREVIDENCE'].includes(item.evidence_class) || item.comparison_status === 'PRODUCTION_BETTER');
    const integrityPass = prospective.length > 0 && prospective.every((item) => item.semantic_integrity === 'PASS');
    const semanticTrigger = rule.semantic_trigger_refinement ?? rule.semantic_trigger ?? null;
    const counterTrigger = rule.counter_trigger_refinement ?? ((rule.counterexamples ?? []).join('; ') || null);
    const scopeExplicit = Boolean(semanticTrigger && counterTrigger && counter.length > 0);
    const eligible = explicitReview && prospectiveSupport.length >= 2 && integrityPass && scopeExplicit;
    return {
      rule_id: rule.rule_id, rule_name: rule.name, current_status: rule.status,
      promotion_status: eligible ? 'SHADOW_VALIDATED' : 'CANDIDATE_RULE',
      gate_decision: eligible ? 'PROMOTE_TO_SHADOW_VALIDATED' : 'KEEP_CANDIDATE_RULE',
      supporting_evidence_ids: support.map((item) => item.evidence_id), counterevidence_ids: counter.map((item) => item.evidence_id),
      prospective_evidence_count: prospective.length, prospective_support_count: prospectiveSupport.length,
      retrospective_evidence_count: related.filter((item) => item.evidence_class === 'RETROSPECTIVE_SUPPORT').length,
      semantic_trigger: semanticTrigger, counter_trigger: counterTrigger,
      applicability_scope: rule.applicability_scope ?? 'EXPLICIT_RULE_SEMANTICS', affected_execution_modes: ['CODEX_DIRECT_LONG_GOAL_SESSION'],
      semantic_trigger_consistent: integrityPass, work_graph_integrity_pass: integrityPass,
      error_improvement_cases: related.filter((item) => item.shadow_error !== null && item.production_error !== null && item.shadow_error < item.production_error).map((item) => item.case_id),
      band_improvement_cases: related.filter((item) => item.shadow_band_result === 'COVERED' && item.production_band_result !== 'COVERED').map((item) => item.case_id),
      automatic_promotion: false, production_effect: false,
      reason: eligible ? 'Two independent closed prospective dual-estimator trials support the narrowed semantic scope with complete Work Graph integrity; retained counterevidence defines the counter-trigger. Shadow validation does not promote Production.' : prospective.length === 0 ? 'No closed independent prospective dual-estimator trial.' : 'Explicit governance review retains candidate status until prospective, integrity, scope, and counterevidence requirements are jointly satisfied.',
    };
  });
  const promoted = results.some((item) => item.promotion_status === 'SHADOW_VALIDATED');
  const report = {
    schema_version: '0.2', record_type: 'PROMOTION_GATE_REPORT', report_id: '', rules: results,
    gate_status: promoted ? 'PROMOTE_TO_SHADOW_VALIDATED' : 'NO_AUTOMATIC_PROMOTION',
    decision_mode: explicitReview ? 'EXPLICIT_CLOSEOUT_GOVERNANCE_REVIEW' : 'EVIDENCE_SUMMARY_ONLY',
    goal_b_counterexample_retained: evidence.some((item) => item.case_id === 'NEXA-SB-GOAL-B'),
    truthfulness: { fixed_multiplier: false, goal_specific_rule: false, history_deleted: false, production_estimator_changed: false, automatic_promotion: false },
    metadata: { real_api_calls: 0, business_runtime_network: 0 },
  };
  report.report_id = `promotion_gate_v02_${stableSha256({ ...report, report_id: undefined })}`;
  return report;
}
