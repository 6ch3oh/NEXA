import { assertValidHistoricalTaskUsage } from './contracts.mjs';

export class HistoricalUsageImporterError extends Error {
  constructor(code, message, cause = null) { super(message, cause ? { cause } : undefined); this.name = 'HistoricalUsageImporterError'; this.code = code; }
}

export function importHistoricalUsageRecord(record) {
  try { return structuredClone(assertValidHistoricalTaskUsage(structuredClone(record))); }
  catch (error) { throw new HistoricalUsageImporterError('HISTORICAL_USAGE_IMPORT_REJECTED', 'Historical usage record was rejected without repair.', error); }
}

export function importHistoricalUsageJsonl(content) {
  if (typeof content !== 'string') throw new HistoricalUsageImporterError('HISTORICAL_USAGE_JSONL_REQUIRED', 'Historical usage import requires JSONL text.');
  const records = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let parsed; try { parsed = JSON.parse(line); } catch (error) { throw new HistoricalUsageImporterError('HISTORICAL_USAGE_JSON_INVALID', `Historical usage JSONL line ${index + 1} is invalid.`, error); }
    try { records.push(importHistoricalUsageRecord(parsed)); } catch (error) { throw new HistoricalUsageImporterError('HISTORICAL_USAGE_JSONL_RECORD_REJECTED', `Historical usage JSONL line ${index + 1} failed validation.`, error); }
  }
  return records;
}
