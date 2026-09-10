function knownTotal(record) { return Number.isInteger(record.total_tokens) ? record.total_tokens : null; }

function comparableScore(unit, record) {
  let score = 0;
  if (unit.task_type === record.task_type) score += 4;
  if (unit.execution_role === record.execution_role) score += 3;
  if (record.files_read !== null && Math.abs(record.files_read - unit.estimated_files_read) <= 2) score += 1;
  if (record.files_changed !== null && Math.abs(record.files_changed - unit.estimated_files_changed) <= 2) score += 1;
  return score;
}

export function calibrateGraphs(graphs, historyRecords = []) {
  const dataStatus = historyRecords.length === 0 ? 'EMPTY' : historyRecords.some((record) => knownTotal(record) === null) ? 'PARTIAL' : 'AVAILABLE';
  const calibrated = {};
  for (const [key, graph] of Object.entries(graphs)) {
    const next = structuredClone(graph);
    for (const unit of next.work_units) {
      const matches = historyRecords.map((record) => ({ record, score: comparableScore(unit, record) })).filter((item) => item.score >= 7).sort((a,b) => b.score - a.score || a.record.usage_record_id.localeCompare(b.record.usage_record_id)).slice(0,3);
      const known = matches.filter((item) => knownTotal(item.record) !== null);
      unit.historical_evidence_refs = matches.map((item) => item.record.usage_record_id);
      const semanticTotal = unit.call_estimates.reduce((total, call) => total + call.total_tokens, 0);
      let assessment = 'NO_COMPARABLE_HISTORY';
      if (known.length) {
        const totals = known.map((item) => knownTotal(item.record));
        const lower = Math.min(...totals); const upper = Math.max(...totals);
        assessment = semanticTotal < lower ? 'SEMANTIC_ESTIMATE_BELOW_OBSERVED_RANGE' : semanticTotal > upper ? 'SEMANTIC_ESTIMATE_ABOVE_OBSERVED_RANGE' : 'SEMANTIC_ESTIMATE_WITHIN_OBSERVED_RANGE';
        unit.confidence = assessment === 'SEMANTIC_ESTIMATE_WITHIN_OBSERVED_RANGE' ? 'HIGH' : 'MEDIUM';
      } else unit.confidence = dataStatus === 'EMPTY' ? 'LOW' : 'MEDIUM';
      unit.estimate_basis.push({ basis:'historical_calibration', data_status:dataStatus, comparable_records:matches.map((item)=>item.record.usage_record_id), known_total_records:known.length, assessment, semantic_total_preserved:semanticTotal });
    }
    next.historical_evidence_refs = [...new Set(next.work_units.flatMap((unit)=>unit.historical_evidence_refs))].sort();
    next.metadata.historical_data_status = dataStatus;
    next.metadata.historical_calibration_changes_graph = false;
    calibrated[key] = next;
  }
  return { graphs: calibrated, historical_data_status:dataStatus, historical_export_required:dataStatus !== 'AVAILABLE' };
}

export { calibrateForecastWithHistoricalSeeds } from './historical-seed-calibrator.mjs';
