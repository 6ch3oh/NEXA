'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const DEFAULT_INVENTORY_TTL_MS = 5 * 60_000;
const DEFAULT_INVENTORY_RETRY_MS = 30_000;

// DXGI supplies the authoritative physical-adapter name, LUID and memory
// budgets. The LUID joins that inventory to Windows GPU performance counters.
const GPU_INVENTORY_SCRIPT = String.raw`$ErrorActionPreference='Stop'
$source=@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct NexaLuid { public uint LowPart; public int HighPart; }

[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct NexaDxgiAdapterDesc1 {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Description;
  public uint VendorId;
  public uint DeviceId;
  public uint SubSysId;
  public uint Revision;
  public UIntPtr DedicatedVideoMemory;
  public UIntPtr DedicatedSystemMemory;
  public UIntPtr SharedSystemMemory;
  public NexaLuid AdapterLuid;
  public uint Flags;
}

[ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface INexaDxgiAdapter1 {
  [PreserveSig] int SetPrivateData(ref Guid name, uint dataSize, IntPtr data);
  [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
  [PreserveSig] int GetPrivateData(ref Guid name, ref uint dataSize, IntPtr data);
  [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
  [PreserveSig] int EnumOutputs(uint output, out IntPtr value);
  [PreserveSig] int GetDesc(IntPtr desc);
  [PreserveSig] int CheckInterfaceSupport(ref Guid name, out long version);
  [PreserveSig] int GetDesc1(out NexaDxgiAdapterDesc1 desc);
}

[ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface INexaDxgiFactory1 {
  [PreserveSig] int SetPrivateData(ref Guid name, uint dataSize, IntPtr data);
  [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
  [PreserveSig] int GetPrivateData(ref Guid name, ref uint dataSize, IntPtr data);
  [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
  [PreserveSig] int EnumAdapters(uint adapter, out IntPtr value);
  [PreserveSig] int MakeWindowAssociation(IntPtr window, uint flags);
  [PreserveSig] int GetWindowAssociation(out IntPtr window);
  [PreserveSig] int CreateSwapChain(IntPtr device, IntPtr desc, out IntPtr swapChain);
  [PreserveSig] int CreateSoftwareAdapter(IntPtr module, out IntPtr adapter);
  [PreserveSig] int EnumAdapters1(uint adapter, out INexaDxgiAdapter1 value);
  [PreserveSig] int IsCurrent();
}

public sealed class NexaGpuAdapter {
  public string Name { get; set; }
  public string Luid { get; set; }
  public ulong DedicatedVideoMemory { get; set; }
  public ulong DedicatedSystemMemory { get; set; }
  public ulong SharedSystemMemory { get; set; }
  public uint VendorId { get; set; }
  public uint DeviceId { get; set; }
  public uint Flags { get; set; }
}

public static class NexaDxgiInventory {
  [DllImport("dxgi.dll", ExactSpelling=true)]
  private static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out INexaDxgiFactory1 factory);

  private static ulong ToUInt64(UIntPtr value) {
    return UIntPtr.Size == 8 ? value.ToUInt64() : value.ToUInt32();
  }

  public static NexaGpuAdapter[] Read() {
    var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    INexaDxgiFactory1 factory;
    int hr = CreateDXGIFactory1(ref iid, out factory);
    if (hr < 0 || factory == null) Marshal.ThrowExceptionForHR(hr);
    var rows = new List<NexaGpuAdapter>();
    try {
      for (uint index = 0; ; index++) {
        INexaDxgiAdapter1 adapter;
        hr = factory.EnumAdapters1(index, out adapter);
        if (hr == unchecked((int)0x887A0002)) break;
        if (hr < 0 || adapter == null) Marshal.ThrowExceptionForHR(hr);
        try {
          NexaDxgiAdapterDesc1 desc;
          hr = adapter.GetDesc1(out desc);
          if (hr < 0) Marshal.ThrowExceptionForHR(hr);
          rows.Add(new NexaGpuAdapter {
            Name = desc.Description == null ? "" : desc.Description.Trim(),
            Luid = string.Format("0x{0:x8}_0x{1:x8}", unchecked((uint)desc.AdapterLuid.HighPart), desc.AdapterLuid.LowPart),
            DedicatedVideoMemory = ToUInt64(desc.DedicatedVideoMemory),
            DedicatedSystemMemory = ToUInt64(desc.DedicatedSystemMemory),
            SharedSystemMemory = ToUInt64(desc.SharedSystemMemory),
            VendorId = desc.VendorId,
            DeviceId = desc.DeviceId,
            Flags = desc.Flags
          });
        } finally { Marshal.ReleaseComObject(adapter); }
      }
    } finally { Marshal.ReleaseComObject(factory); }
    return rows.ToArray();
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
[NexaDxgiInventory]::Read() | ConvertTo-Json -Compress`;

const GPU_SCRIPT = String.raw`$ErrorActionPreference='Stop'
$module=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Diagnostics\Microsoft.PowerShell.Diagnostics.psd1'
Import-Module $module -ErrorAction Stop
$paths=@('\GPU Engine(*)\Utilization Percentage','\GPU Adapter Memory(*)\Dedicated Usage','\GPU Adapter Memory(*)\Shared Usage')
$samples=@((Get-Counter -Counter $paths -MaxSamples 1 -ErrorAction Stop).CounterSamples | Where-Object { $null -ne $_.CookedValue -and -not [double]::IsNaN([double]$_.CookedValue) -and -not [double]::IsInfinity([double]$_.CookedValue) })
function Get-AdapterLuid([string]$path) { if ($path -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_\d+') { return $matches[1].ToLowerInvariant() }; return $null }
$luids=@($samples | ForEach-Object { Get-AdapterLuid $_.Path } | Where-Object { $_ } | Sort-Object -Unique)
$items=@($luids | ForEach-Object { $luid=$_; $eng=@($samples | Where-Object { $_.Path -like '*\gpu engine(*' -and (Get-AdapterLuid $_.Path) -eq $luid }); $ded=@($samples | Where-Object { $_.Path -like '*\gpu adapter memory(*\dedicated usage' -and (Get-AdapterLuid $_.Path) -eq $luid }); $shr=@($samples | Where-Object { $_.Path -like '*\gpu adapter memory(*\shared usage' -and (Get-AdapterLuid $_.Path) -eq $luid }); [PSCustomObject]@{ Luid=$luid; EngineSampleCount=$eng.Count; Utilization=if($eng.Count){[Math]::Min([double]100,[Math]::Max([double]0,[double](($eng|Measure-Object CookedValue -Maximum).Maximum)))}else{$null}; DedicatedUsedBytes=if($ded.Count){[Math]::Max([double]0,[double](($ded|Measure-Object CookedValue -Sum).Sum))}else{$null}; SharedUsedBytes=if($shr.Count){[Math]::Max([double]0,[double](($shr|Measure-Object CookedValue -Sum).Sum))}else{$null} } })
[PSCustomObject]@{ObservedAt=[DateTimeOffset]::UtcNow.ToString('o');Items=$items}|ConvertTo-Json -Depth 4 -Compress`;

const NVIDIA_TEMPERATURE_ARGS = Object.freeze(['--query-gpu=index,name,temperature.gpu', '--format=csv,noheader,nounits']);

function run(executable, args, timeout = 8_000) {
  return new Promise((resolve, reject) => execFile(executable, args, {
    timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024
  }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

function safeGpuName(value) {
  const text = String(value || '').trim().replace(/[\r\n\t]/g, ' ');
  return text && text.length <= 120 && !/[<>]/.test(text) ? text : 'Windows GPU';
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseJson(stdout, label) {
  try { return JSON.parse(String(stdout || '')); } catch { throw new Error(`${label} returned invalid JSON.`); }
}

function parseGpuInventoryJson(stdout) {
  const parsed = parseJson(stdout, 'GPU inventory');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set();
  return rows.flatMap((row) => {
    const luid = typeof row?.Luid === 'string' ? row.Luid.toLowerCase() : '';
    const flags = safeNumber(row?.Flags);
    const dedicatedVideoMemory = safeNumber(row?.DedicatedVideoMemory);
    const sharedSystemMemory = safeNumber(row?.SharedSystemMemory);
    if (!/^0x[0-9a-f]{8}_0x[0-9a-f]{8}$/.test(luid) || seen.has(luid) || flags === null ||
        (flags & 2) !== 0 || dedicatedVideoMemory === null || sharedSystemMemory === null) return [];
    seen.add(luid);
    return [{
      gpuId: `dxgi-${luid.slice(2).replace('_0x', '-')}`,
      luid,
      name: safeGpuName(row?.Name),
      dedicatedVideoMemory,
      sharedSystemMemory,
      vendorId: safeNumber(row?.VendorId),
      deviceId: safeNumber(row?.DeviceId)
    }];
  }).slice(0, 4);
}

function parseGpuMetricsJson(stdout) {
  const parsed = parseJson(stdout, 'GPU performance counters');
  const observedAt = new Date(parsed?.ObservedAt);
  if (!Number.isFinite(observedAt.getTime()) || !parsed?.Items) throw new Error('GPU performance counters returned an invalid observation.');
  const items = new Map();
  const rows = Array.isArray(parsed.Items) ? parsed.Items : [parsed.Items];
  for (const row of rows) {
    const luid = typeof row?.Luid === 'string' ? row.Luid.toLowerCase() : '';
    const engineSampleCount = Number(row?.EngineSampleCount);
    const utilization = Number(row?.Utilization);
    const dedicatedUsedBytes = Number(row?.DedicatedUsedBytes);
    const sharedUsedBytes = Number(row?.SharedUsedBytes);
    if (!/^0x[0-9a-f]{8}_0x[0-9a-f]{8}$/.test(luid) || !Number.isInteger(engineSampleCount) || engineSampleCount < 0) continue;
    items.set(luid, {
      engineSampleCount,
      utilization: engineSampleCount > 0 && Number.isFinite(utilization) && utilization >= 0 && utilization <= 100 ? utilization : null,
      dedicatedUsedBytes: Number.isSafeInteger(dedicatedUsedBytes) && dedicatedUsedBytes >= 0 ? dedicatedUsedBytes : null,
      sharedUsedBytes: Number.isSafeInteger(sharedUsedBytes) && sharedUsedBytes >= 0 ? sharedUsedBytes : null
    });
  }
  return { observedAt: observedAt.toISOString(), items };
}

function unavailableMetric(reason) { return { availability: 'unavailable', value: null, unit: 'percent', reason }; }
function utilizationMetric(value) { return Number.isFinite(value) && value >= 0 && value <= 100 ? { availability: 'available', value, unit: 'percent', reason: null } : unavailableMetric('GPU_UTILIZATION_COUNTER_UNAVAILABLE'); }
function unavailableCapacity(reason) { return { availability: 'unavailable', total: null, used: null, available: null, utilization: null, reason }; }
function memoryCapacity(totalBytes, usedBytes, reason) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || !Number.isSafeInteger(usedBytes) || usedBytes < 0 || usedBytes > totalBytes) return unavailableCapacity(reason);
  const availableBytes = totalBytes - usedBytes;
  return {
    availability: 'available',
    total: { value: totalBytes, unit: 'bytes' }, used: { value: usedBytes, unit: 'bytes' },
    available: { value: availableBytes, unit: 'bytes' }, utilization: { value: usedBytes / totalBytes * 100, unit: 'percent' }, reason: null
  };
}

function mergeGpuObservations(inventory, metrics) {
  return inventory.map((adapter) => {
    const sample = metrics.items.get(adapter.luid);
    return {
      gpuId: adapter.gpuId,
      name: adapter.name,
      utilization: utilizationMetric(sample?.utilization),
      dedicatedMemory: memoryCapacity(adapter.dedicatedVideoMemory, sample?.dedicatedUsedBytes, 'DEDICATED_GPU_MEMORY_COUNTER_UNAVAILABLE'),
      sharedMemory: memoryCapacity(adapter.sharedSystemMemory, sample?.sharedUsedBytes, 'SHARED_GPU_MEMORY_COUNTER_UNAVAILABLE')
    };
  });
}

function parseNvidiaTemperatureCsv(stdout, observedAt) {
  const rows = String(stdout || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const sensors = [];
  for (const row of rows) {
    const parts = row.split(',').map((value) => value.trim());
    if (parts.length < 3) continue;
    const index = Number(parts[0]);
    const temperature = Number(parts.at(-1));
    const name = safeGpuName(parts.slice(1, -1).join(','));
    if (!Number.isInteger(index) || index < 0 || !Number.isFinite(temperature) || temperature < -100 || temperature > 250) continue;
    sensors.push({ sensor_id: `gpu:nvidia:${index}:core`, component: 'gpu', sensor_name: `${name} GPU Core`, temperature_celsius: temperature, availability: 'available', source: 'nvidia-smi', observed_at: observedAt, confidence: 'high', sensor_class: 'gpu_core', freshness: { state: 'fresh', age_ms: 0, stale_after_ms: 300000 }, current: { value: temperature, unit: 'celsius' }, reason: null });
  }
  return sensors;
}

class WindowsGpuCollector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    const root = options.systemRoot || process.env.SystemRoot || 'C:\\Windows';
    const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.legacyProvider = options.provider || null;
    this.metricsProvider = options.metricsProvider || (() => run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', GPU_SCRIPT]));
    this.inventoryProvider = options.inventoryProvider || (() => run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', GPU_INVENTORY_SCRIPT], 10_000));
    this.temperatureProvider = options.temperatureProvider || (() => run('nvidia-smi.exe', NVIDIA_TEMPERATURE_ARGS, 5_000));
    this.now = options.now || (() => new Date());
    this.nowMs = options.nowMs || (() => Date.now());
    this.monotonic = options.monotonic || (() => performance.now());
    this.inventoryTtlMs = options.inventoryTtlMs ?? DEFAULT_INVENTORY_TTL_MS;
    this.inventoryRetryMs = options.inventoryRetryMs ?? DEFAULT_INVENTORY_RETRY_MS;
    this.inventoryCache = null;
  }

  async loadInventory() {
    const now = this.nowMs();
    if (this.inventoryCache && now < this.inventoryCache.expiresAt) {
      if (this.inventoryCache.error) throw this.inventoryCache.error;
      return this.inventoryCache.value;
    }
    try {
      const result = await this.inventoryProvider();
      if (String(result?.stderr || '').trim()) throw new Error('GPU inventory wrote to stderr.');
      const value = parseGpuInventoryJson(result?.stdout);
      if (!value.length) throw new Error('GPU inventory returned no physical adapters.');
      this.inventoryCache = { value, error: null, expiresAt: now + this.inventoryTtlMs };
      return value;
    } catch {
      const error = new Error('GPU adapter inventory is unavailable.');
      this.inventoryCache = { value: null, error, expiresAt: now + this.inventoryRetryMs };
      throw error;
    }
  }

  async collectLegacy(observedAt) {
    try {
      const result = await this.legacyProvider();
      if (String(result?.stderr || '').trim()) throw new Error('stderr');
      const value = parseJson(result?.stdout, 'GPU performance counter');
      if (!Number.isInteger(value.SampleCount) || value.SampleCount < 1 || !Number.isFinite(value.Utilization) || value.Utilization < 0 || value.Utilization > 100) throw new Error('invalid');
      return { availability: 'available', utilization: { value: value.Utilization, unit: 'percent' }, memory: null, adapters: [], observedAt: new Date(value.ObservedAt).toISOString(), provider: 'windows-gpu-engine-counter', reason: null };
    } catch {
      return { availability: 'unavailable', utilization: null, memory: null, adapters: [], observedAt, provider: 'windows-gpu-engine-counter', reason: 'GPU performance counters are unavailable.' };
    }
  }

  async collect() {
    const observedAt = this.now().toISOString();
    if (this.platform !== 'win32') return { availability: 'unsupported', utilization: null, memory: null, adapters: [], observedAt, reason: 'Windows GPU counters require win32.' };
    if (this.legacyProvider) return this.collectLegacy(observedAt);
    try {
      const [inventory, metricsResult] = await Promise.all([this.loadInventory(), this.metricsProvider()]);
      if (String(metricsResult?.stderr || '').trim()) throw new Error('GPU metrics wrote to stderr.');
      const metrics = parseGpuMetricsJson(metricsResult?.stdout);
      const adapters = mergeGpuObservations(inventory, metrics);
      const values = adapters.filter((adapter) => adapter.utilization.availability === 'available').map((adapter) => adapter.utilization.value);
      return {
        availability: values.length ? 'available' : 'partial',
        utilization: values.length ? { value: Math.max(...values), unit: 'percent' } : null,
        memory: null,
        adapters,
        observedAt: metrics.observedAt,
        provider: 'windows-dxgi-performance-counters',
        reason: values.length ? null : 'GPU utilization counters are unavailable.',
        networkRequests: 0,
        adminRequired: false
      };
    } catch {
      return { availability: 'unavailable', utilization: null, memory: null, adapters: [], observedAt, provider: 'windows-dxgi-performance-counters', reason: 'GPU adapter metrics are unavailable.', networkRequests: 0, adminRequired: false };
    }
  }

  async collectTemperatureSensors() {
    const observedAt = this.now().toISOString();
    const started = this.monotonic();
    if (this.platform !== 'win32') return { availability: 'unsupported', sensors: [], provider: 'nvidia-smi', observed_at: observedAt, duration_ms: 0, reason: 'NVIDIA temperature query requires win32.' };
    try {
      const result = await this.temperatureProvider();
      if (String(result?.stderr || '').trim()) throw new Error('stderr');
      const sensors = parseNvidiaTemperatureCsv(result.stdout, observedAt);
      if (!sensors.length) throw new Error('empty');
      return { availability: 'available', sensors, provider: 'nvidia-smi', observed_at: observedAt, duration_ms: Math.max(0, this.monotonic() - started), reason: null };
    } catch {
      return { availability: 'unavailable', sensors: [], provider: 'nvidia-smi', observed_at: observedAt, duration_ms: Math.max(0, this.monotonic() - started), reason: 'NVIDIA GPU temperature is unavailable.' };
    }
  }
}

module.exports = {
  DEFAULT_INVENTORY_RETRY_MS, DEFAULT_INVENTORY_TTL_MS, GPU_INVENTORY_SCRIPT, GPU_SCRIPT,
  NVIDIA_TEMPERATURE_ARGS, WindowsGpuCollector, memoryCapacity, mergeGpuObservations,
  parseGpuInventoryJson, parseGpuMetricsJson, parseNvidiaTemperatureCsv, safeGpuName
};
