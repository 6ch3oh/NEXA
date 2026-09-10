import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluateEstimatorApplicability, renderApplicabilityMarkdown } from './estimator-applicability.mjs';
import { compareConditionalReplay, createConditionalForecast } from './conditional-estimator.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const graphPath = value => value?.expected ?? value?.optimistic ?? value;

export async function runGoalHCommand(options, { rootDir, bounded, readJson }) {
  if (!['estimator-applicability', 'conditional-forecast', 'conditional-compare'].includes(options.command)) return null;
  if (options.command === 'estimator-applicability') {
    if (!options.graphs || !options.output) return 2;
    const graphs = await readJson(bounded(rootDir, options.graphs));
    const graph = graphs[options.path ?? 'expected'] ?? graphPath(graphs);
    const result = evaluateEstimatorApplicability({ graph });
    const output = bounded(rootDir, options.output); await mkdir(dirname(output), { recursive: true });
    await writeFile(output, json(result), 'utf8');
    if (options.report) { const report = bounded(rootDir, options.report); await mkdir(dirname(report), { recursive: true }); await writeFile(report, renderApplicabilityMarkdown(result), 'utf8'); }
    process.stdout.write(`${JSON.stringify({ status: result.decision.status, selected_estimator: result.decision.selected_estimator, decision_id: result.decision.decision_id })}\n`); return result.decision.status === 'INVALID_INPUT' ? 3 : 0;
  }
  if (options.command === 'conditional-forecast') {
    if (!options.graphs || !options.forecast || !options.shadow || !options.output) return 2;
    const [graphs, productionForecast, shadowForecast] = await Promise.all([options.graphs, options.forecast, options.shadow].map(path => readJson(bounded(rootDir, path))));
    const graph = graphs[options.path ?? 'expected'] ?? graphPath(graphs);
    const result = createConditionalForecast({ graph, productionForecast, shadowForecast, source_refs: { production: options.forecast, shadow_v1: options.shadow } });
    const output = bounded(rootDir, options.output); await mkdir(dirname(output), { recursive: true }); await writeFile(output, json(result), 'utf8');
    process.stdout.write(`${JSON.stringify({ status: result.status, applicability_status: result.decision.status, selected_estimator: result.decision.selected_estimator, conditional_forecast_id: result.conditional_forecast?.conditional_forecast_id ?? null })}\n`); return result.status === 'READY' ? 0 : 3;
  }
  if (!options.decision || !options.production || !options.shadow || !options.actual_total || !options.evidence_class || !options.evidence_source || !options.output) return 2;
  const [decisionDocument, productionForecast, shadowForecast] = await Promise.all([options.decision, options.production, options.shadow].map(path => readJson(bounded(rootDir, path))));
  const decision = decisionDocument.decision ?? decisionDocument;
  const replay = compareConditionalReplay({ decision, production_forecast: productionForecast, shadow_forecast: shadowForecast, actual_total_tokens: Number.parseInt(options.actual_total, 10), evidence_class: options.evidence_class, evidence_source_ref: options.evidence_source });
  const output = bounded(rootDir, options.output); await mkdir(dirname(output), { recursive: true }); await writeFile(output, json(replay), 'utf8');
  process.stdout.write(`${JSON.stringify({ status: 'READY', replay_id: replay.replay_id, selected_estimator: replay.selected_estimator, replay_outcome: replay.replay_outcome })}\n`); return 0;
}
