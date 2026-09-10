'use strict';

const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PROCESS_SAMPLE_INTERVAL_MS = 200;
const DEFAULT_PROCESS_TIMEOUT_MS = 8_000;

function buildProcessSampleScript(sampleIntervalMs) {
  if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 0 || sampleIntervalMs > 5_000) {
    throw new RangeError('Process sample interval must be an integer between 0 and 5000 ms.');
  }
  return [
    "$ErrorActionPreference = 'Stop'",
    `$sampleIntervalMs = ${sampleIntervalMs}`,
    'function Get-NexaProcessSample { $items = @(Get-Process -ErrorAction Stop | ForEach-Object { try { $started = $null; try { $started = $_.StartTime.ToUniversalTime().ToString(\'o\') } catch { } [PSCustomObject]@{ ProcessId = $_.Id; ProcessName = $_.ProcessName; CpuTicks = [string]$_.TotalProcessorTime.Ticks; WorkingSetBytes = [string]$_.WorkingSet64; StartedAt = $started } } catch { } }); [PSCustomObject]@{ CapturedAtUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); Processes = @($items) } }',
    '$sample1 = Get-NexaProcessSample',
    'if ($sampleIntervalMs -gt 0) { Start-Sleep -Milliseconds $sampleIntervalMs }',
    '$sample2 = Get-NexaProcessSample',
    '[PSCustomObject]@{ Sample1 = $sample1; Sample2 = $sample2 } | ConvertTo-Json -Depth 5 -Compress'
  ].join('; ');
}

function resolvePowerShellExecutable(systemRoot = process.env.SystemRoot) {
  return typeof systemRoot === 'string' && systemRoot.trim() !== ''
    ? path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runProcessPowerShell({
  execFileImpl = execFile,
  executable = resolvePowerShellExecutable(),
  sampleIntervalMs = DEFAULT_PROCESS_SAMPLE_INTERVAL_MS,
  timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS
} = {}) {
  const script = buildProcessSampleScript(sampleIntervalMs);
  return new Promise((resolve, reject) => {
    execFileImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function parseCounter(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = BigInt(value.trim());
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}

function normalizeProcessName(value) {
  if (typeof value !== 'string' || /[\\/]/.test(value)) return null;
  const name = value.trim().slice(0, 180);
  if (!name) return null;
  return /\.exe$/i.test(name) ? name : `${name}.exe`;
}

function parseSample(value, pathName) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.CapturedAtUnixMs)) {
    throw new Error(`${pathName} is invalid.`);
  }
  const source = Array.isArray(value.Processes) ? value.Processes : (value.Processes ? [value.Processes] : []);
  const processes = source.flatMap((entry) => {
    const processId = Number(entry?.ProcessId);
    const processName = normalizeProcessName(entry?.ProcessName);
    const cpuTicks = parseCounter(entry?.CpuTicks);
    const memoryBytes = parseCounter(entry?.WorkingSetBytes);
    const startedAt = typeof entry?.StartedAt === 'string' && Number.isFinite(Date.parse(entry.StartedAt))
      ? new Date(entry.StartedAt).toISOString() : null;
    if (!Number.isInteger(processId) || processId < 0 || !processName || cpuTicks === null || memoryBytes === null) return [];
    return [{ processId, processName, cpuTicks, memoryBytes, startedAt }];
  });
  return { capturedAtMs: value.CapturedAtUnixMs, processes };
}

function parseProcessSamplePairJson(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') throw new Error('Process query returned empty output.');
  let value;
  try { value = JSON.parse(stdout); } catch { throw new Error('Process query returned invalid JSON.'); }
  const sample1 = parseSample(value?.Sample1, 'Sample1');
  const sample2 = parseSample(value?.Sample2, 'Sample2');
  if (sample2.capturedAtMs < sample1.capturedAtMs) throw new Error('Process sample timestamps are out of order.');
  return { sample1, sample2 };
}

function calculateProcessCpuPercent(beforeTicks, afterTicks, elapsedMs, logicalProcessors) {
  if (![beforeTicks, afterTicks, elapsedMs, logicalProcessors].every(Number.isFinite)
    || beforeTicks < 0 || afterTicks < beforeTicks || elapsedMs <= 0 || logicalProcessors < 1) return null;
  const percent = ((afterTicks - beforeTicks) / 10_000) / elapsedMs / logicalProcessors * 100;
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null;
}

function normalizeProcessPair(pair, logicalProcessors) {
  const before = new Map(pair.sample1.processes.map((item) => [item.processId, item]));
  const elapsedMs = pair.sample2.capturedAtMs - pair.sample1.capturedAtMs;
  const observedAt = new Date(pair.sample2.capturedAtMs).toISOString();
  return pair.sample2.processes.map((item) => {
    const cpuPercent = calculateProcessCpuPercent(before.get(item.processId)?.cpuTicks, item.cpuTicks, elapsedMs, logicalProcessors);
    return {
      processId: item.processId,
      processName: item.processName,
      displayName: null,
      startedAt: item.startedAt,
      cpuUtilization: cpuPercent === null
        ? { availability: 'unavailable', value: null, reason: 'No stable two-point sample for this PID.' }
        : { availability: 'available', value: cpuPercent, reason: null },
      memoryBytes: item.memoryBytes,
      availability: 'available',
      observedAt,
      source: { id: 'windows-get-process', kind: 'windows' }
    };
  }).sort((left, right) => left.processId - right.processId);
}

class WindowsProcessCollector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_PROCESS_SAMPLE_INTERVAL_MS;
    this.logicalProcessors = options.logicalProcessors || (() => os.cpus().length);
    this.provider = options.provider || ((sampleIntervalMs) => runProcessPowerShell({ sampleIntervalMs }));
    this.now = options.now || (() => new Date());
  }

  async collectRaw() {
    const fallbackObservedAt = this.now().toISOString();
    if (this.platform !== 'win32') return { availability: 'unavailable', observedAt: fallbackObservedAt, processes: [], reason: 'Windows process collection requires win32.' };
    try {
      const result = await this.provider(this.sampleIntervalMs);
      if (String(result?.stderr || '').trim()) throw new Error('Process query wrote to stderr.');
      const pair = parseProcessSamplePairJson(result?.stdout);
      const logicalProcessors = Number(this.logicalProcessors());
      if (!Number.isInteger(logicalProcessors) || logicalProcessors < 1) throw new Error('Logical processor count is invalid.');
      return { availability: 'available', observedAt: new Date(pair.sample2.capturedAtMs).toISOString(), processes: normalizeProcessPair(pair, logicalProcessors), reason: null };
    } catch (error) {
      return { availability: 'unavailable', observedAt: fallbackObservedAt, processes: [], reason: String(error?.message || 'Process collection failed.').slice(0, 240) };
    }
  }
}

module.exports = {
  DEFAULT_PROCESS_SAMPLE_INTERVAL_MS,
  DEFAULT_PROCESS_TIMEOUT_MS,
  WindowsProcessCollector,
  buildProcessSampleScript,
  calculateProcessCpuPercent,
  normalizeProcessName,
  normalizeProcessPair,
  parseProcessSamplePairJson,
  runProcessPowerShell
};
