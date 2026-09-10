'use strict';

const { performance } = require('node:perf_hooks');

const {
  DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
  WindowsNetworkCollector,
  WindowsNetworkCollectorAdapter,
  parseNetworkInterfaceJson,
  parseNetworkSamplePairJson,
  runNetworkSamplePairPowerShell,
  runNetworkPowerShell,
  validateNetworkMetrics
} = require('../src');

const mode = process.argv[2] || 'baseline';
const runs = Number(process.argv[3] || 5);

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summary(values) {
  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values)
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function roundedSummary(values) {
  const valuesSummary = summary(values);
  return Object.fromEntries(Object.entries(valuesSummary).map(([key, value]) => [key, round(value)]));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function baselineRun() {
  const processDurations = [];
  const parseDurations = [];
  let intervalDuration = 0;
  const interfaceProvider = async () => {
    const processStarted = performance.now();
    const result = await runNetworkPowerShell();
    processDurations.push(performance.now() - processStarted);
    if (String(result.stderr || '').trim() !== '') throw new Error('Network query wrote to stderr.');
    const parseStarted = performance.now();
    const entries = parseNetworkInterfaceJson(result.stdout);
    parseDurations.push(performance.now() - parseStarted);
    return entries;
  };
  const sleep = async (milliseconds) => {
    const intervalStarted = performance.now();
    await delay(milliseconds);
    intervalDuration = performance.now() - intervalStarted;
  };
  const collector = new WindowsNetworkCollector({
    sampleIntervalMs: DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
    interfaceProvider,
    sleep
  });
  const adapter = new WindowsNetworkCollectorAdapter(collector);
  const started = performance.now();
  const network = await adapter.collectNetworkMetrics();
  validateNetworkMetrics(network);
  const total = performance.now() - started;
  return {
    total_ms: round(total),
    sample_1_process_ms: round(processDurations[0]),
    sampling_interval_ms: round(intervalDuration),
    sample_2_process_ms: round(processDurations[1]),
    json_parse_total_ms: round(parseDurations.reduce((sum, value) => sum + value, 0)),
    remaining_adapter_overhead_ms: round(total
      - processDurations.reduce((sum, value) => sum + value, 0)
      - intervalDuration
      - parseDurations.reduce((sum, value) => sum + value, 0)),
    powershell_process_count: processDurations.length
  };
}

async function optimizedRun() {
  let processDuration = 0;
  let parseDuration = 0;
  let sampleTimestampDelta = 0;
  const samplePairProvider = async (sampleIntervalMs) => {
    const processStarted = performance.now();
    const result = await runNetworkSamplePairPowerShell({ sampleIntervalMs });
    processDuration = performance.now() - processStarted;
    if (String(result.stderr || '').trim() !== '') throw new Error('Network sample pair wrote to stderr.');
    const parseStarted = performance.now();
    const pair = parseNetworkSamplePairJson(result.stdout);
    parseDuration = performance.now() - parseStarted;
    sampleTimestampDelta = pair.sample2.capturedAtMs - pair.sample1.capturedAtMs;
    return pair;
  };
  const collector = new WindowsNetworkCollector({
    sampleIntervalMs: DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
    samplePairProvider
  });
  const adapter = new WindowsNetworkCollectorAdapter(collector);
  const started = performance.now();
  const network = await adapter.collectNetworkMetrics();
  validateNetworkMetrics(network);
  const total = performance.now() - started;
  return {
    total_ms: round(total),
    pair_process_ms: round(processDuration),
    sampling_interval_ms: DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
    sample_timestamp_delta_ms: round(sampleTimestampDelta),
    json_parse_total_ms: round(parseDuration),
    remaining_adapter_overhead_ms: round(total - processDuration - parseDuration),
    powershell_process_count: 1
  };
}

async function main() {
  if (!['baseline', 'optimized'].includes(mode)) throw new Error(`Unsupported benchmark mode: ${mode}`);
  if (!Number.isInteger(runs) || runs < 5 || runs > 20) throw new RangeError('Benchmark runs must be an integer between 5 and 20.');
  const results = [];
  const runOnce = mode === 'baseline' ? baselineRun : optimizedRun;
  for (let index = 0; index < runs; index += 1) results.push(await runOnce());
  const evidence = {
    mode,
    runs,
    sampling_interval_configured_ms: DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
    powershell_processes_per_collection: mode === 'baseline' ? 2 : 1,
    wall_clock_ms: roundedSummary(results.map((result) => result.total_ms)),
    json_parse_total_ms: roundedSummary(results.map((result) => result.json_parse_total_ms)),
    remaining_adapter_overhead_ms: roundedSummary(results.map((result) => result.remaining_adapter_overhead_ms)),
    samples: results
  };
  if (mode === 'baseline') {
    evidence.sample_1_process_ms = roundedSummary(results.map((result) => result.sample_1_process_ms));
    evidence.sampling_interval_observed_ms = roundedSummary(results.map((result) => result.sampling_interval_ms));
    evidence.sample_2_process_ms = roundedSummary(results.map((result) => result.sample_2_process_ms));
  } else {
    evidence.pair_process_ms = roundedSummary(results.map((result) => result.pair_process_ms));
    evidence.sample_timestamp_delta_ms = roundedSummary(results.map((result) => result.sample_timestamp_delta_ms));
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Network collector benchmark failed: ${error.message}\n`);
  process.exitCode = 1;
});
