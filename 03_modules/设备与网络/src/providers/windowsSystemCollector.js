'use strict';

const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CPU_SAMPLE_INTERVAL_MS = 200;
const DEFAULT_DISK_TIMEOUT_MS = 5_000;
const DEFAULT_TOPOLOGY_TIMEOUT_MS = 5_000;
const DISK_QUERY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$items = @([System.IO.DriveInfo]::GetDrives() | ForEach-Object { if ($_.DriveType -eq [System.IO.DriveType]::Fixed -and $_.IsReady) { try { [PSCustomObject]@{ DeviceID = $_.Name.Substring(0, 2); Size = [uint64]$_.TotalSize; FreeSpace = [uint64]$_.AvailableFreeSpace } } catch { } } })',
  'ConvertTo-Json -InputObject @($items) -Compress'
].join('; ');
const CPU_TOPOLOGY_QUERY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$source = @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class NexaCpuTopology {',
  '  [DllImport("kernel32.dll", SetLastError=true)]',
  '  static extern bool GetLogicalProcessorInformationEx(int relationshipType, IntPtr buffer, ref uint returnedLength);',
  '  public static int PhysicalCoreCount() {',
  '    uint length = 0; GetLogicalProcessorInformationEx(0, IntPtr.Zero, ref length); if (length == 0) return 0;',
  '    IntPtr buffer = Marshal.AllocHGlobal((int)length);',
  '    try {',
  '      if (!GetLogicalProcessorInformationEx(0, buffer, ref length)) return 0;',
  '      int count = 0; int offset = 0;',
  '      while (offset + 8 <= length) { int relationship = Marshal.ReadInt32(buffer, offset); int size = Marshal.ReadInt32(buffer, offset + 4); if (size <= 0 || offset + size > length) break; if (relationship == 0) count++; offset += size; }',
  '      return count;',
  '    } finally { Marshal.FreeHGlobal(buffer); }',
  '  }',
  '}',
  "'@",
  'Add-Type -TypeDefinition $source',
  '[PSCustomObject]@{ PhysicalCores = [NexaCpuTopology]::PhysicalCoreCount(); LogicalProcessors = [Environment]::ProcessorCount } | ConvertTo-Json -Compress'
].join('\n');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeReason(error, fallback) {
  const message = String(error?.stderr || error?.message || fallback || 'Unknown collector error').replace(/\s+/g, ' ').trim();
  return message.slice(0, 240) || fallback;
}

function readCpuTickSnapshot(readCpus) {
  const entries = readCpus();
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('os.cpus() returned no processors.');
  let total = 0;
  let idle = 0;
  for (const entry of entries) {
    const times = entry?.times;
    if (!times || typeof times !== 'object') throw new Error('CPU tick data is missing.');
    for (const name of ['user', 'nice', 'sys', 'idle', 'irq']) {
      const value = times[name];
      if (!Number.isFinite(value) || value < 0) throw new Error(`CPU tick ${name} is invalid.`);
      total += value;
      if (name === 'idle') idle += value;
    }
  }
  return { total, idle, logicalProcessors: entries.length };
}

function calculateCpuUtilization(before, after) {
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0 || !Number.isFinite(idleDelta)
    || idleDelta < 0 || idleDelta > totalDelta) {
    throw new Error('CPU tick delta is invalid.');
  }
  return Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
}

async function sampleCpu({
  readCpus = () => os.cpus(),
  sleep = delay,
  sampleIntervalMs = DEFAULT_CPU_SAMPLE_INTERVAL_MS
} = {}) {
  try {
    if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 0 || sampleIntervalMs > 5_000) {
      throw new Error('CPU sample interval must be an integer between 0 and 5000 ms.');
    }
    const before = readCpuTickSnapshot(readCpus);
    await sleep(sampleIntervalMs);
    const after = readCpuTickSnapshot(readCpus);
    return {
      availability: 'available',
      utilizationPercent: calculateCpuUtilization(before, after),
      logicalProcessors: after.logicalProcessors,
      physicalCores: null,
      reason: null
    };
  } catch (error) {
    return {
      availability: 'unavailable',
      utilizationPercent: null,
      logicalProcessors: null,
      physicalCores: null,
      reason: safeReason(error, 'CPU sample is unavailable.')
    };
  }
}

function collectMemory({ totalmem = () => os.totalmem(), freemem = () => os.freemem() } = {}) {
  try {
    const totalBytes = totalmem();
    const availableBytes = freemem();
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(availableBytes)
      || availableBytes < 0 || availableBytes > totalBytes) {
      throw new Error('Memory capacity values are invalid.');
    }
    return {
      availability: 'available',
      totalBytes,
      usedBytes: totalBytes - availableBytes,
      availableBytes,
      utilizationPercent: (totalBytes - availableBytes) / totalBytes * 100,
      reason: null
    };
  } catch (error) {
    return {
      availability: 'unavailable',
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      utilizationPercent: null,
      reason: safeReason(error, 'RAM sample is unavailable.')
    };
  }
}

function resolvePowerShellExecutable(systemRoot = process.env.SystemRoot) {
  if (typeof systemRoot === 'string' && systemRoot.trim() !== '') {
    return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }
  return 'powershell.exe';
}

function runDiskPowerShell({
  execFileImpl = execFile,
  executable = resolvePowerShellExecutable(),
  timeoutMs = DEFAULT_DISK_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DISK_QUERY_SCRIPT];
    execFileImpl(executable, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function runCpuTopologyPowerShell({
  execFileImpl = execFile,
  executable = resolvePowerShellExecutable(),
  timeoutMs = DEFAULT_TOPOLOGY_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CPU_TOPOLOGY_QUERY_SCRIPT];
    execFileImpl(executable, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); return; }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function parseCpuTopologyJson(stdout) {
  let value;
  try { value = JSON.parse(String(stdout || '')); } catch { throw new Error('CPU topology query returned invalid JSON.'); }
  const physicalCores = Number(value?.PhysicalCores);
  const logicalProcessors = Number(value?.LogicalProcessors);
  if (!Number.isInteger(physicalCores) || physicalCores < 1 || !Number.isInteger(logicalProcessors) || logicalProcessors < physicalCores) {
    throw new Error('CPU topology query returned invalid core counts.');
  }
  return { physicalCores, logicalProcessors };
}

async function queryCpuTopology({ runCommand = runCpuTopologyPowerShell } = {}) {
  const result = await runCommand();
  if (!result || typeof result !== 'object' || String(result.stderr || '').trim()) throw new Error('CPU topology query failed.');
  return parseCpuTopologyJson(result.stdout);
}

function windowsBuild(release) {
  const match = String(release || '').match(/(?:^|\.)(\d+)$/);
  return match ? match[1] : null;
}

function asFiniteNumber(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseFixedDiskJson(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') throw new Error('Disk query returned empty output.');
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Disk query returned invalid JSON.');
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const volumes = entries.flatMap((entry) => {
    const deviceId = typeof entry?.DeviceID === 'string' ? entry.DeviceID.trim().toUpperCase() : '';
    const totalBytes = asFiniteNumber(entry?.Size);
    const availableBytes = asFiniteNumber(entry?.FreeSpace);
    if (!/^[A-Z]:$/.test(deviceId) || totalBytes === null || totalBytes <= 0
      || availableBytes === null || availableBytes < 0 || availableBytes > totalBytes) {
      return [];
    }
    return [{ deviceId, totalBytes, availableBytes }];
  });
  if (volumes.length === 0) throw new Error('Disk query returned no valid fixed volumes.');
  return volumes;
}

async function queryFixedDisks({ runCommand = runDiskPowerShell } = {}) {
  const result = await runCommand();
  if (!result || typeof result !== 'object') throw new Error('Disk command result is invalid.');
  if (String(result.stderr || '').trim() !== '') throw new Error('Disk query wrote to stderr.');
  return parseFixedDiskJson(result.stdout);
}

async function collectDisks(options = {}) {
  try {
    const query = options.query || (() => queryFixedDisks(options));
    const volumes = await query();
    if (!Array.isArray(volumes) || volumes.length === 0) throw new Error('Disk provider returned no fixed volumes.');
    for (const volume of volumes) {
      if (typeof volume?.deviceId !== 'string' || !Number.isFinite(volume.totalBytes)
        || volume.totalBytes <= 0 || !Number.isFinite(volume.availableBytes)
        || volume.availableBytes < 0 || volume.availableBytes > volume.totalBytes) {
        throw new Error('Disk provider returned an invalid fixed volume.');
      }
    }
    return { availability: 'available', volumes, reason: null };
  } catch (error) {
    return {
      availability: 'unavailable',
      volumes: [],
      reason: safeReason(error, 'Fixed disk data is unavailable.')
    };
  }
}

class WindowsSystemCollector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_CPU_SAMPLE_INTERVAL_MS;
    this.readCpus = options.readCpus || (() => os.cpus());
    this.sleep = options.sleep || delay;
    this.totalmem = options.totalmem || (() => os.totalmem());
    this.freemem = options.freemem || (() => os.freemem());
    this.diskProvider = options.diskProvider || (() => queryFixedDisks());
    this.cpuTopologyProvider = options.cpuTopologyProvider || (() => queryCpuTopology());
    this.cpuTopologyPromise = null;
    this.hostProvider = options.hostProvider || (() => ({
      name: os.hostname(),
      platform: os.platform(),
      version: os.version(),
      release: os.release(),
      build: windowsBuild(os.release()),
      cpuModel: os.cpus()?.[0]?.model || null
    }));
    this.now = options.now || (() => new Date());
  }

  async collectRaw() {
    const cpuPromise = sampleCpu({
      readCpus: this.readCpus,
      sleep: this.sleep,
      sampleIntervalMs: this.sampleIntervalMs
    });
    const memory = collectMemory({ totalmem: this.totalmem, freemem: this.freemem });
    const disksPromise = this.platform === 'win32'
      ? collectDisks({ query: this.diskProvider })
      : Promise.resolve({ availability: 'unavailable', volumes: [], reason: 'Windows fixed disk collection requires win32.' });
    if (!this.cpuTopologyPromise && this.platform === 'win32') {
      this.cpuTopologyPromise = Promise.resolve().then(() => this.cpuTopologyProvider()).catch(() => null);
    }
    const [cpu, disks, topology] = await Promise.all([cpuPromise, disksPromise, this.cpuTopologyPromise || Promise.resolve(null)]);
    if (topology && Number.isInteger(topology.physicalCores) && topology.physicalCores > 0 &&
        Number.isInteger(topology.logicalProcessors) && topology.logicalProcessors >= topology.physicalCores) {
      cpu.physicalCores = topology.physicalCores;
      cpu.logicalProcessors = topology.logicalProcessors;
    }
    let host;
    try {
      const value = this.hostProvider();
      host = {
        availability: value && typeof value.name === 'string' && value.name.trim() ? 'available' : 'unavailable',
        name: typeof value?.name === 'string' ? value.name.trim().slice(0, 128) : null,
        platform: typeof value?.platform === 'string' ? value.platform.trim().slice(0, 64) : null,
        version: typeof value?.version === 'string' ? value.version.trim().slice(0, 160) : null,
        release: typeof value?.release === 'string' ? value.release.trim().slice(0, 64) : null,
        build: typeof value?.build === 'string' && /^\d{1,10}$/.test(value.build) ? value.build : windowsBuild(value?.release),
        cpuModel: typeof value?.cpuModel === 'string' ? value.cpuModel.trim().slice(0, 160) : null,
        reason: null
      };
    } catch (error) {
      host = { availability: 'unavailable', name: null, platform: null, version: null, release: null, build: null, cpuModel: null, reason: safeReason(error, 'Host identity is unavailable.') };
    }
    const observed = this.now();
    const collectedAt = observed instanceof Date && Number.isFinite(observed.getTime())
      ? observed.toISOString()
      : new Date().toISOString();
    return {
      provider: { id: 'windows-system', kind: 'windows' },
      collectedAt,
      host,
      cpu,
      memory,
      disks
    };
  }
}

module.exports = {
  DEFAULT_CPU_SAMPLE_INTERVAL_MS,
  DEFAULT_DISK_TIMEOUT_MS,
  DEFAULT_TOPOLOGY_TIMEOUT_MS,
  CPU_TOPOLOGY_QUERY_SCRIPT,
  DISK_QUERY_SCRIPT,
  WindowsSystemCollector,
  calculateCpuUtilization,
  collectDisks,
  collectMemory,
  parseFixedDiskJson,
  parseCpuTopologyJson,
  queryCpuTopology,
  queryFixedDisks,
  readCpuTickSnapshot,
  resolvePowerShellExecutable,
  runDiskPowerShell,
  runCpuTopologyPowerShell,
  sampleCpu,
  windowsBuild
};
