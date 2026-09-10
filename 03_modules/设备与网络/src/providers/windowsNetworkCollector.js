'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const DEFAULT_NETWORK_SAMPLE_INTERVAL_MS = 500;
const DEFAULT_NETWORK_TIMEOUT_MS = 5_000;
const VIRTUAL_INTERFACE_PATTERN = /(?:virtual|hyper-v|vethernet|wsl|vmware|virtualbox|docker|bluetooth|\bvpn\b|radmin|\btap\b|\btun\b|npcap|clash|mihomo|zerotier|tailscale)/i;
const POWERSHELL_UTF8_OUTPUT = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)';
const NETWORK_QUERY_SCRIPT = [
  POWERSHELL_UTF8_OUTPUT,
  "$ErrorActionPreference = 'Stop'",
  '$items = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object { $sent = $null; $received = $null; $interfaceIndex = $null; $gatewayPresent = $null; $dnsPresent = $null; $addressPresent = $null; try { $stats = $_.GetIPv4Statistics(); $sent = [string]$stats.BytesSent; $received = [string]$stats.BytesReceived } catch { }; try { $ipProperties = $_.GetIPProperties(); $interfaceIndex = $ipProperties.GetIPv4Properties().Index; $gatewayPresent = @($ipProperties.GatewayAddresses).Count -gt 0; $dnsPresent = @($ipProperties.DnsAddresses).Count -gt 0; $addressPresent = @($ipProperties.UnicastAddresses).Count -gt 0 } catch { } [PSCustomObject]@{ InterfaceId = $_.Id; InterfaceIndex = $interfaceIndex; Name = $_.Name; Description = $_.Description; Status = $_.OperationalStatus.ToString(); Type = $_.NetworkInterfaceType.ToString(); BytesSent = $sent; BytesReceived = $received; GatewayPresent = $gatewayPresent; DnsPresent = $dnsPresent; AddressPresent = $addressPresent } })',
  'ConvertTo-Json -InputObject @($items) -Compress'
].join('; ');

function buildNetworkSamplePairScript(sampleIntervalMs) {
  if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 0 || sampleIntervalMs > 5_000) {
    throw new RangeError('Network sample interval must be an integer between 0 and 5000 ms.');
  }
  return [
    POWERSHELL_UTF8_OUTPUT,
    "$ErrorActionPreference = 'Stop'",
    `$sampleIntervalMs = ${sampleIntervalMs}`,
    'function Get-NexaNetworkSample { try { $items = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object { $sent = $null; $received = $null; $interfaceIndex = $null; $gatewayPresent = $null; $dnsPresent = $null; $addressPresent = $null; try { $stats = $_.GetIPv4Statistics(); $sent = [string]$stats.BytesSent; $received = [string]$stats.BytesReceived } catch { }; try { $ipProperties = $_.GetIPProperties(); $interfaceIndex = $ipProperties.GetIPv4Properties().Index; $gatewayPresent = @($ipProperties.GatewayAddresses).Count -gt 0; $dnsPresent = @($ipProperties.DnsAddresses).Count -gt 0; $addressPresent = @($ipProperties.UnicastAddresses).Count -gt 0 } catch { } [PSCustomObject]@{ InterfaceId = $_.Id; InterfaceIndex = $interfaceIndex; Name = $_.Name; Description = $_.Description; Status = $_.OperationalStatus.ToString(); Type = $_.NetworkInterfaceType.ToString(); BytesSent = $sent; BytesReceived = $received; GatewayPresent = $gatewayPresent; DnsPresent = $dnsPresent; AddressPresent = $addressPresent } }); $capturedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); return [PSCustomObject]@{ Available = $true; CapturedAtUnixMs = $capturedAt; Interfaces = @($items) } } catch { $capturedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); return [PSCustomObject]@{ Available = $false; CapturedAtUnixMs = $capturedAt; Interfaces = @() } } }',
    '$sample1 = Get-NexaNetworkSample',
    'if ($sampleIntervalMs -gt 0) { Start-Sleep -Milliseconds $sampleIntervalMs }',
    '$sample2 = Get-NexaNetworkSample',
    '[PSCustomObject]@{ Sample1 = $sample1; Sample2 = $sample2 } | ConvertTo-Json -Depth 5 -Compress'
  ].join('; ');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeReason(error, fallback) {
  const message = String(error?.stderr || error?.message || fallback || 'Unknown network collector error')
    .replace(/\s+/g, ' ').trim();
  return message.slice(0, 240) || fallback;
}

function resolvePowerShellExecutable(systemRoot = process.env.SystemRoot) {
  if (typeof systemRoot === 'string' && systemRoot.trim() !== '') {
    return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }
  return 'powershell.exe';
}

function runNetworkPowerShell({
  execFileImpl = execFile,
  executable = resolvePowerShellExecutable(),
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', NETWORK_QUERY_SCRIPT];
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

function runNetworkSamplePairPowerShell({
  execFileImpl = execFile,
  executable = resolvePowerShellExecutable(),
  sampleIntervalMs = DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS + sampleIntervalMs
} = {}) {
  const script = buildNetworkSamplePairScript(sampleIntervalMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) {
    throw new RangeError('Network pair timeout must be an integer between 1 and 15000 ms.');
  }
  return new Promise((resolve, reject) => {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script];
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

function parseCounter(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = BigInt(value.trim());
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}

function normalizeCategory(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('wireless')) return 'wireless';
  if (value.includes('ethernet')) return 'ethernet';
  if (value === 'ppp') return 'ppp';
  if (value === 'tunnel') return 'tunnel';
  if (value === 'loopback') return 'loopback';
  return value || 'unknown';
}

function normalizeNetworkInterfaceEntries(parsed) {
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => {
    const id = typeof entry?.InterfaceId === 'string' ? entry.InterfaceId.trim() : '';
    const name = typeof entry?.Name === 'string' ? entry.Name.trim().slice(0, 128) : '';
    const description = typeof entry?.Description === 'string' ? entry.Description.trim().slice(0, 256) : '';
    const status = typeof entry?.Status === 'string' ? entry.Status.trim() : '';
    const type = typeof entry?.Type === 'string' ? entry.Type.trim() : '';
    if (!id || !name || !status || !type) return [];
    const bytesSent = parseCounter(entry.BytesSent);
    const bytesReceived = parseCounter(entry.BytesReceived);
    const interfaceIndex = entry.InterfaceIndex !== null && entry.InterfaceIndex !== undefined &&
      Number.isInteger(Number(entry.InterfaceIndex)) && Number(entry.InterfaceIndex) >= 0
      ? Number(entry.InterfaceIndex) : null;
    const gatewayPresent = typeof entry.GatewayPresent === 'boolean' ? entry.GatewayPresent : null;
    const dnsPresent = typeof entry.DnsPresent === 'boolean' ? entry.DnsPresent : null;
    const addressPresent = typeof entry.AddressPresent === 'boolean' ? entry.AddressPresent : null;
    return [{
      id,
      interfaceIndex,
      name,
      description,
      status,
      type,
      category: normalizeCategory(type),
      virtual: isObviousVirtual({ name, description }) || ['loopback', 'tunnel'].includes(normalizeCategory(type)),
      bytesSent,
      bytesReceived,
      gatewayPresent,
      dnsPresent,
      addressPresent,
      countersAvailable: bytesSent !== null && bytesReceived !== null
    }];
  });
}

function parseNetworkInterfaceJson(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') throw new Error('Network query returned empty output.');
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Network query returned invalid JSON.');
  }
  return normalizeNetworkInterfaceEntries(parsed);
}

function parsePairSample(value, field) {
  if (!value || typeof value !== 'object' || typeof value.Available !== 'boolean') {
    throw new Error(`Network sample pair ${field} is missing or invalid.`);
  }
  const capturedAtMs = value.CapturedAtUnixMs;
  if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0) {
    throw new Error(`Network sample pair ${field} timestamp is invalid.`);
  }
  if (!value.Available) {
    return {
      availability: 'unavailable',
      entries: [],
      reason: `Network ${field} query failed.`,
      capturedAtMs
    };
  }
  if (!Object.hasOwn(value, 'Interfaces')) {
    throw new Error(`Network sample pair ${field} interfaces are missing.`);
  }
  return {
    availability: 'available',
    entries: normalizeNetworkInterfaceEntries(value.Interfaces),
    reason: null,
    capturedAtMs
  };
}

function parseNetworkSamplePairJson(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') throw new Error('Network sample pair returned empty output.');
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Network sample pair returned invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Network sample pair output is invalid.');
  }
  const sample1 = parsePairSample(parsed.Sample1, 'sample1');
  const sample2 = parsePairSample(parsed.Sample2, 'sample2');
  if (sample2.capturedAtMs < sample1.capturedAtMs) {
    throw new Error('Network sample pair timestamps are out of order.');
  }
  return { sample1, sample2 };
}

async function queryNetworkInterfaces({ runCommand = runNetworkPowerShell } = {}) {
  const result = await runCommand();
  if (!result || typeof result !== 'object') throw new Error('Network command result is invalid.');
  if (String(result.stderr || '').trim() !== '') throw new Error('Network query wrote to stderr.');
  return parseNetworkInterfaceJson(result.stdout);
}

async function queryNetworkInterfacePair({
  sampleIntervalMs = DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
  runCommand = (options) => runNetworkSamplePairPowerShell(options)
} = {}) {
  const result = await runCommand({ sampleIntervalMs });
  if (!result || typeof result !== 'object') throw new Error('Network sample pair command result is invalid.');
  if (String(result.stderr || '').trim() !== '') throw new Error('Network sample pair wrote to stderr.');
  return parseNetworkSamplePairJson(result.stdout);
}

function isLoopbackOrTunnel(entry) {
  const type = String(entry.type || '').toLowerCase();
  return type === 'loopback' || type === 'tunnel' || type.includes('loopback');
}

function isObviousVirtual(entry) {
  return VIRTUAL_INTERFACE_PATTERN.test(`${entry.name || ''} ${entry.description || ''}`);
}

function interfaceSort(left, right) {
  return left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en');
}

function selectActiveInterfaces(entries) {
  if (!Array.isArray(entries)) return [];
  const upDataInterfaces = entries.filter((entry) => String(entry?.status).toLowerCase() === 'up'
    && !isLoopbackOrTunnel(entry));
  const physicalCandidates = upDataInterfaces.filter((entry) => !isObviousVirtual(entry));
  return [...(physicalCandidates.length > 0 ? physicalCandidates : upDataInterfaces)].sort(interfaceSort);
}

function availableValue(value) {
  return { availability: 'available', value, reason: null };
}

function unavailableValue(reason) {
  return { availability: 'unavailable', value: null, reason };
}

function aggregateCumulative(activeInterfaces, field) {
  const usable = activeInterfaces.filter((entry) => entry.countersAvailable && Number.isSafeInteger(entry[field]) && entry[field] >= 0);
  if (usable.length === 0) return unavailableValue('No active interface exposed valid cumulative counters.');
  const total = usable.reduce((sum, entry) => sum + entry[field], 0);
  if (!Number.isSafeInteger(total) || total < 0) return unavailableValue('Aggregated cumulative counter exceeds the safe numeric range.');
  return availableValue(total);
}

function calculateAggregateRates(beforeEntries, activeAfter, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return {
      uploadRate: unavailableValue('Network sample elapsed time must be positive.'),
      downloadRate: unavailableValue('Network sample elapsed time must be positive.')
    };
  }
  const beforeById = new Map((Array.isArray(beforeEntries) ? beforeEntries : []).map((entry) => [entry.id, entry]));
  let sentDelta = 0;
  let receivedDelta = 0;
  let validPairs = 0;
  for (const after of activeAfter) {
    const before = beforeById.get(after.id);
    if (!before?.countersAvailable || !after.countersAvailable) continue;
    const nextSent = after.bytesSent - before.bytesSent;
    const nextReceived = after.bytesReceived - before.bytesReceived;
    if (!Number.isSafeInteger(nextSent) || !Number.isSafeInteger(nextReceived)
      || nextSent < 0 || nextReceived < 0) continue;
    sentDelta += nextSent;
    receivedDelta += nextReceived;
    validPairs += 1;
  }
  if (validPairs === 0 || !Number.isSafeInteger(sentDelta) || !Number.isSafeInteger(receivedDelta)) {
    return {
      uploadRate: unavailableValue('No stable interface counter pair was available for upload rate.'),
      downloadRate: unavailableValue('No stable interface counter pair was available for download rate.')
    };
  }
  const seconds = elapsedMs / 1000;
  const upload = sentDelta / seconds;
  const download = receivedDelta / seconds;
  if (!Number.isFinite(upload) || !Number.isFinite(download) || upload < 0 || download < 0) {
    return {
      uploadRate: unavailableValue('Calculated upload rate is invalid.'),
      downloadRate: unavailableValue('Calculated download rate is invalid.')
    };
  }
  return { uploadRate: availableValue(upload), downloadRate: availableValue(download) };
}

async function safeInterfaceQuery(provider) {
  try {
    const entries = await provider();
    if (!Array.isArray(entries)) throw new Error('Network interface provider returned invalid data.');
    return { availability: 'available', entries, reason: null };
  } catch (error) {
    return { availability: 'unavailable', entries: [], reason: safeReason(error, 'Network interfaces are unavailable.') };
  }
}

async function safeSamplePairQuery(provider, sampleIntervalMs) {
  try {
    const pair = await provider(sampleIntervalMs);
    if (!pair?.sample1 || !pair?.sample2) throw new Error('Network sample pair provider returned invalid data.');
    return { availability: 'available', ...pair, reason: null };
  } catch (error) {
    return { availability: 'unavailable', sample1: null, sample2: null, reason: 'Network sample pair is unavailable.' };
  }
}

function unavailableRawSample(collectedAt, reason) {
  return {
    collectedAt,
    interfaces: { availability: 'unavailable', active: [], reason },
    traffic: {
      uploadRate: unavailableValue(reason),
      downloadRate: unavailableValue(reason),
      cumulativeSent: unavailableValue(reason),
      cumulativeReceived: unavailableValue(reason)
    }
  };
}

class WindowsNetworkCollector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_NETWORK_SAMPLE_INTERVAL_MS;
    this.interfaceProvider = options.interfaceProvider || null;
    this.samplePairProvider = options.samplePairProvider
      || (this.interfaceProvider ? null : ((sampleIntervalMs) => queryNetworkInterfacePair({ sampleIntervalMs })));
    this.sleep = options.sleep || delay;
    this.nowMs = options.nowMs || (() => Date.now());
  }

  async collectRaw() {
    if (!Number.isInteger(this.sampleIntervalMs) || this.sampleIntervalMs < 0 || this.sampleIntervalMs > 5_000) {
      throw new RangeError('Network sample interval must be an integer between 0 and 5000 ms.');
    }
    if (this.platform !== 'win32') {
      const collectedAt = new Date(this.nowMs()).toISOString();
      return {
        collectedAt,
        interfaces: { availability: 'unavailable', active: [], reason: 'Windows network collection requires win32.' },
        traffic: {
          uploadRate: unavailableValue('Windows network collection requires win32.'),
          downloadRate: unavailableValue('Windows network collection requires win32.'),
          cumulativeSent: unavailableValue('Windows network collection requires win32.'),
          cumulativeReceived: unavailableValue('Windows network collection requires win32.')
        }
      };
    }

    let beforeSample;
    let afterSample;
    let beforeAt;
    let afterAt;
    if (this.samplePairProvider) {
      const pair = await safeSamplePairQuery(this.samplePairProvider, this.sampleIntervalMs);
      if (pair.availability !== 'available') {
        return unavailableRawSample(new Date(this.nowMs()).toISOString(), pair.reason);
      }
      beforeSample = pair.sample1;
      afterSample = pair.sample2;
      beforeAt = pair.sample1.capturedAtMs;
      afterAt = pair.sample2.capturedAtMs;
    } else {
      beforeSample = await safeInterfaceQuery(this.interfaceProvider);
      beforeAt = this.nowMs();
      await this.sleep(this.sampleIntervalMs);
      afterSample = await safeInterfaceQuery(this.interfaceProvider);
      afterAt = this.nowMs();
    }
    const collectedAt = Number.isFinite(afterAt) ? new Date(afterAt).toISOString() : new Date().toISOString();

    if (afterSample.availability !== 'available') {
      return unavailableRawSample(collectedAt, afterSample.reason);
    }

    const active = selectActiveInterfaces(afterSample.entries);
    const observed = afterSample.entries.filter((entry) => String(entry?.status).toLowerCase() === 'up')
      .sort(interfaceSort);
    const beforeById = new Map((beforeSample.entries || []).map((entry) => [entry.id, entry]));
    const elapsedSeconds = (afterAt - beforeAt) / 1000;
    const projectObserved = (entry) => {
      const before = beforeById.get(entry.id);
      const uploadRate = before?.countersAvailable && entry.countersAvailable && elapsedSeconds > 0
        ? Math.max(0, (entry.bytesSent - before.bytesSent) / elapsedSeconds) : null;
      const downloadRate = before?.countersAvailable && entry.countersAvailable && elapsedSeconds > 0
        ? Math.max(0, (entry.bytesReceived - before.bytesReceived) / elapsedSeconds) : null;
      return {
        id: entry.id,
        interfaceIndex: entry.interfaceIndex,
        name: entry.name,
        description: entry.description,
        status: entry.status,
        category: entry.category,
        virtual: entry.virtual === true,
        gatewayPresent: entry.gatewayPresent,
        dnsPresent: entry.dnsPresent,
        addressPresent: entry.addressPresent,
        uploadRate: Number.isFinite(uploadRate) ? uploadRate : null,
        downloadRate: Number.isFinite(downloadRate) ? downloadRate : null
      };
    };
    const cumulativeSent = aggregateCumulative(active, 'bytesSent');
    const cumulativeReceived = aggregateCumulative(active, 'bytesReceived');
    const rates = beforeSample.availability === 'available'
      ? calculateAggregateRates(beforeSample.entries, active, afterAt - beforeAt)
      : {
          uploadRate: unavailableValue(beforeSample.reason),
          downloadRate: unavailableValue(beforeSample.reason)
        };
    return {
      collectedAt,
      interfaces: {
        availability: 'available',
        observed: observed.map(projectObserved),
        active: active.map((entry) => ({
          id: entry.id,
          interfaceIndex: entry.interfaceIndex,
          name: entry.name,
          description: entry.description,
          status: entry.status,
          category: entry.category,
          virtual: entry.virtual === true,
          gatewayPresent: entry.gatewayPresent,
          dnsPresent: entry.dnsPresent,
          addressPresent: entry.addressPresent
        })),
        reason: null
      },
      traffic: { ...rates, cumulativeSent, cumulativeReceived }
    };
  }
}

module.exports = {
  DEFAULT_NETWORK_SAMPLE_INTERVAL_MS,
  DEFAULT_NETWORK_TIMEOUT_MS,
  NETWORK_QUERY_SCRIPT,
  WindowsNetworkCollector,
  aggregateCumulative,
  buildNetworkSamplePairScript,
  calculateAggregateRates,
  parseNetworkInterfaceJson,
  parseNetworkSamplePairJson,
  queryNetworkInterfacePair,
  queryNetworkInterfaces,
  runNetworkSamplePairPowerShell,
  runNetworkPowerShell,
  selectActiveInterfaces
};
