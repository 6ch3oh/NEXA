import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildActualConstraintDiagnosis } from './actual-constraint-diagnosis.mjs';
import { refineSessionCandidateRules, renderCandidateRuleRefinement } from './candidate-rule-refinement.mjs';
import { buildForecastDriverAttribution, renderForecastDriverAttribution } from './forecast-driver-attribution.mjs';
import { buildProductionTokenDriverLedger, buildShadowTokenDriverLedger, TokenDriverLedgerStore } from './token-driver-ledger.mjs';
import { executeGoalGCloseout } from './goal-g-closeout.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const pathKeys = { optimistic: 'optimistic_path', expected: 'expected_path', conservative: 'conservative_path' };
const authorityTokens = (authority, name, forecast) => authority ? authority[name] : forecast[pathKeys[name]].total_tokens;

export async function runGoalGCommand(options, { rootDir, bounded, readJson }) {
  if (!['forecast-drivers','constraint-diagnosis','rule-refinement','goal-g-closeout'].includes(options.command)) return null;
  if (options.command === 'goal-g-closeout') {
    const result = await executeGoalGCloseout({ rootDir, recordedAt: options.recorded_at ?? new Date().toISOString() });
    process.stdout.write(`${JSON.stringify(result)}\n`); return 0;
  }
  if (options.command === 'rule-refinement') {
    if (!options.rules || !options.attributions || !options.output) return 2;
    const [registry, ...attributions] = await Promise.all([readJson(bounded(rootDir, options.rules)), ...options.attributions.split(',').map((path) => readJson(bounded(rootDir, path)))]);
    const value = refineSessionCandidateRules({ registry, attributions, evidence_refs: options.attributions.split(',') }), output = bounded(rootDir, options.output);
    await mkdir(output, { recursive: true }); await writeFile(join(output, 'candidate-rule-refinement.json'), json(value), 'utf8'); await writeFile(join(output, 'candidate-rule-refinement.md'), renderCandidateRuleRefinement(value), 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', refinement_id: value.refinement_id, shadow_v2_decision: value.shadow_v2_decision, promotion_status: value.promotion_status })}\n`); return 0;
  }
  if (options.command === 'constraint-diagnosis') {
    if (!options.ledger || options.actual_total === undefined || !options.output || !options.actual_source_ref) return 2;
    const ledger = await readJson(bounded(rootDir, options.ledger)), diagnosis = buildActualConstraintDiagnosis({ ledger, actual_total_tokens: Number.parseInt(options.actual_total, 10), actual_source_ref: options.actual_source_ref });
    const output = bounded(rootDir, options.output); await mkdir(dirname(output), { recursive: true }); await writeFile(output, json(diagnosis), 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'READY', diagnosis_id: diagnosis.diagnosis_id })}\n`); return 0;
  }
  if (!options.forecast || !options.graphs || !options.shadow || !options.case_id || !options.evidence_class || !options.output) return 2;
  const [forecast, graphs, shadow, authority] = await Promise.all([readJson(bounded(rootDir, options.forecast)), readJson(bounded(rootDir, options.graphs)), readJson(bounded(rootDir, options.shadow)), options.production_authority ? readJson(bounded(rootDir, options.production_authority)) : null]);
  const output = bounded(rootDir, options.output); await mkdir(output, { recursive: true });
  const actual = options.actual_total === undefined ? null : Number.parseInt(options.actual_total, 10), actualRef = options.actual_source_ref ?? null;
  const ledgers = {};
  for (const name of Object.keys(pathKeys)) {
    const graph = graphs[name], productionPath = forecast[pathKeys[name]], shadowPath = shadow.paths?.[name] ?? shadow[name];
    const structural = buildProductionTokenDriverLedger({ case_id: options.case_id, forecast_id: forecast.forecast_id, estimator_version: forecast.engine_version ?? 'PROJECT_SEMANTIC_WORK_GRAPH/V0.1', path: productionPath, graph, evidence_class: options.evidence_class, authority: 'FORECAST_BUNDLE' });
    const authoritative = authorityTokens(authority, name, forecast) === structural.forecast_total_tokens;
    const productionDir = authoritative ? 'production' : 'production-structural-reference';
    await new TokenDriverLedgerStore({ rootDir, filePath: join(output, productionDir, `${name}-ledger.json`) }).write(structural);
    const shadowLedger = buildShadowTokenDriverLedger({ case_id: options.case_id, forecast_id: shadow.shadow_forecast_id ?? shadow.forecast_id ?? shadowPath.shadow_id, estimator_version: shadow.estimator_version ?? shadowPath.metadata?.engine ?? 'SESSION_AWARE_SHADOW/V0.1', path: shadowPath, graph, evidence_class: options.evidence_class });
    await new TokenDriverLedgerStore({ rootDir, filePath: join(output, 'shadow-v1', `${name}-ledger.json`) }).write(shadowLedger);
    ledgers[name] = { production: authoritative ? structural : null, structural, shadow: shadowLedger, authoritative };
  }
  let productionDiagnosis = null, shadowDiagnosis = null;
  if (actual !== null) {
    if (ledgers.expected.production) productionDiagnosis = buildActualConstraintDiagnosis({ ledger: ledgers.expected.production, actual_total_tokens: actual, actual_source_ref: actualRef });
    shadowDiagnosis = buildActualConstraintDiagnosis({ ledger: ledgers.expected.shadow, actual_total_tokens: actual, actual_source_ref: actualRef });
    await mkdir(join(output, 'diagnosis'), { recursive: true });
    if (productionDiagnosis) await writeFile(join(output, 'diagnosis', 'production-expected.json'), json(productionDiagnosis), 'utf8');
    await writeFile(join(output, 'diagnosis', 'shadow-v1-expected.json'), json(shadowDiagnosis), 'utf8');
  }
  const productionAuthority = { optimistic: authorityTokens(authority, 'optimistic', forecast), expected: authorityTokens(authority, 'expected', forecast), conservative: authorityTokens(authority, 'conservative', forecast), authority: authority?.authority ?? options.forecast };
  const attribution = buildForecastDriverAttribution({ case_id: options.case_id, evidence_class: options.evidence_class, actual_tokens: actual, actual_source_ref: actualRef, production_authority: productionAuthority, production_ledger: ledgers.expected.production, production_structural_reference: ledgers.expected.authoritative ? null : ledgers.expected.structural, shadow_ledger: ledgers.expected.shadow, production_diagnosis: productionDiagnosis, shadow_diagnosis: shadowDiagnosis });
  const audit = { schema_version: '0.1', record_type: 'FORECAST_DRIVER_AUDIT', case_id: options.case_id, production: ledgers.expected.production ? { ...ledgers.expected.production.audit, top_overestimation_pressure: productionDiagnosis?.top_overestimation_pressure ?? [] } : null, shadow_v1: { ...ledgers.expected.shadow.audit, top_overestimation_pressure: shadowDiagnosis?.top_overestimation_pressure ?? [] }, conservation: { production: ledgers.expected.production?.conservation.status ?? 'UNKNOWN_TOTAL_ONLY_AUTHORITY', shadow_v1: ledgers.expected.shadow.conservation.status }, actual_component_status: 'UNKNOWN', metadata: { fixed_multiplier: false, production_estimator_changed: false } };
  await writeFile(join(output, 'attribution.json'), json(attribution), 'utf8'); await writeFile(join(output, 'attribution.md'), renderForecastDriverAttribution(attribution), 'utf8'); await writeFile(join(output, 'forecast-driver-audit.json'), json(audit), 'utf8');
  process.stdout.write(`${JSON.stringify({ status: 'READY', attribution_id: attribution.attribution_id, production_detail_status: attribution.production_detail_status, conservation: audit.conservation, actual_component_status: 'UNKNOWN' })}\n`); return 0;
}
