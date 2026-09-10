'use strict';

const { execFile } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;
const CONNECTION_QUERY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$tcpAvailable = $true; $udpAvailable = $true; $tcp = @(); $udp = @()',
  'try { $tcp = @(Get-NetTCPConnection -ErrorAction Stop | ForEach-Object { [PSCustomObject]@{ Protocol = \'tcp\'; LocalAddress = $_.LocalAddress; LocalPort = $_.LocalPort; RemoteAddress = $_.RemoteAddress; RemotePort = $_.RemotePort; State = $_.State.ToString(); OwningProcessId = $_.OwningProcess } }) } catch { $tcpAvailable = $false }',
  'try { $udp = @(Get-NetUDPEndpoint -ErrorAction Stop | ForEach-Object { [PSCustomObject]@{ Protocol = \'udp\'; LocalAddress = $_.LocalAddress; LocalPort = $_.LocalPort; RemoteAddress = $null; RemotePort = $null; State = \'none\'; OwningProcessId = $_.OwningProcess } }) } catch { $udpAvailable = $false }',
  '[PSCustomObject]@{ ObservedAt = [DateTimeOffset]::UtcNow.ToString(\'o\'); TcpAvailable = $tcpAvailable; UdpAvailable = $udpAvailable; Connections = @($tcp) + @($udp) } | ConvertTo-Json -Depth 5 -Compress'
].join('; ');

function resolvePowerShellExecutable(systemRoot = process.env.SystemRoot) {
  return typeof systemRoot === 'string' && systemRoot.trim() !== ''
    ? path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runConnectionPowerShell({ execFileImpl = execFile, executable = resolvePowerShellExecutable(), timeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CONNECTION_QUERY_SCRIPT], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); }
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function resolveNetstatExecutable(systemRoot = process.env.SystemRoot) {
  return typeof systemRoot === 'string' && systemRoot.trim() !== ''
    ? path.join(systemRoot, 'System32', 'netstat.exe')
    : 'netstat.exe';
}

function runConnectionNetstat({ execFileImpl = execFile, executable = resolveNetstatExecutable(), timeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, ['-ano'], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); }
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function safeAddress(value, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  return net.isIP(trimmed) ? trimmed : null;
}

function safePort(value, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null;
}

function parseConnectionJson(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') throw new Error('Connection query returned empty output.');
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new Error('Connection query returned invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || !Number.isFinite(Date.parse(parsed.ObservedAt))) throw new Error('Connection query envelope is invalid.');
  const observedAt = new Date(parsed.ObservedAt).toISOString();
  const rows = Array.isArray(parsed.Connections) ? parsed.Connections : (parsed.Connections ? [parsed.Connections] : []);
  const connections = rows.flatMap((entry) => {
    const protocol = String(entry?.Protocol || '').toLowerCase();
    const localAddress = safeAddress(entry?.LocalAddress);
    const localPort = safePort(entry?.LocalPort);
    const remoteAddress = safeAddress(entry?.RemoteAddress, protocol === 'udp');
    const remotePort = safePort(entry?.RemotePort, protocol === 'udp');
    const owningProcessId = Number(entry?.OwningProcessId);
    if (!['tcp', 'udp'].includes(protocol) || !localAddress || localPort === null
      || (protocol === 'tcp' && (!remoteAddress || remotePort === null))
      || !Number.isInteger(owningProcessId) || owningProcessId < 0) return [];
    return [{
      protocol,
      localAddress,
      localPort,
      remoteAddress,
      remotePort,
      state: typeof entry?.State === 'string' ? entry.State.trim().toLowerCase().slice(0, 48) : 'unknown',
      owningProcessId,
      observedAt,
      addressFamily: net.isIP(localAddress) === 6 || net.isIP(remoteAddress) === 6 ? 'ipv6' : 'ipv4'
    }];
  }).sort((a, b) => a.protocol.localeCompare(b.protocol) || a.owningProcessId - b.owningProcessId || a.localPort - b.localPort);
  const tcpAvailable = parsed.TcpAvailable === true;
  const udpAvailable = parsed.UdpAvailable === true;
  return { availability: tcpAvailable || udpAvailable ? 'available' : 'unavailable', observedAt, tcpAvailable, udpAvailable, connections };
}

function parseNetstatEndpoint(value, nullable = false) {
  if (nullable && value === '*:*') return { address: null, port: null };
  if (typeof value !== 'string') return null;
  const bracket = value.match(/^\[([^\]]+)]:(\d+)$/);
  const plain = value.match(/^(.*):(\d+)$/);
  const address = bracket?.[1] ?? plain?.[1];
  const port = Number(bracket?.[2] ?? plain?.[2]);
  if (!address || !net.isIP(address) || !Number.isInteger(port) || port < 0 || port > 65535) return null;
  return { address, port };
}

function parseNetstatOutput(stdout, observedAt = new Date().toISOString()) {
  if (typeof stdout !== 'string') throw new Error('netstat output must be a string.');
  const connections = [];
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    const protocol = String(fields[0] || '').toLowerCase();
    if (!['tcp', 'udp'].includes(protocol)) continue;
    const local = parseNetstatEndpoint(fields[1]);
    const remote = parseNetstatEndpoint(fields[2], protocol === 'udp');
    const state = protocol === 'tcp' ? fields[3] : 'none';
    const owningProcessId = Number(protocol === 'tcp' ? fields[4] : fields[3]);
    if (!local || !remote || !Number.isInteger(owningProcessId) || owningProcessId < 0) continue;
    connections.push({
      protocol,
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      state: String(state || 'unknown').toLowerCase().slice(0, 48),
      owningProcessId,
      observedAt,
      addressFamily: net.isIP(local.address) === 6 || net.isIP(remote.address) === 6 ? 'ipv6' : 'ipv4'
    });
  }
  connections.sort((a, b) => a.protocol.localeCompare(b.protocol) || a.owningProcessId - b.owningProcessId || a.localPort - b.localPort);
  return { availability: 'available', observedAt, tcpAvailable: true, udpAvailable: true, connections };
}

class WindowsApplicationConnectionCollector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.provider = options.provider || (() => runConnectionNetstat());
    this.parser = options.parser || (options.provider ? parseConnectionJson : parseNetstatOutput);
    this.now = options.now || (() => new Date());
  }

  async collectRaw() {
    const observedAt = this.now().toISOString();
    if (this.platform !== 'win32') return { availability: 'unavailable', observedAt, tcpAvailable: false, udpAvailable: false, connections: [], reason: 'Windows connection collection requires win32.' };
    try {
      const result = await this.provider();
      if (String(result?.stderr || '').trim()) throw new Error('Connection query wrote to stderr.');
      return { ...this.parser(result?.stdout, this.now().toISOString()), reason: null };
    } catch (error) {
      return { availability: 'unavailable', observedAt, tcpAvailable: false, udpAvailable: false, connections: [], reason: String(error?.message || 'Connection collection failed.').slice(0, 240) };
    }
  }
}

module.exports = {
  CONNECTION_QUERY_SCRIPT,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  WindowsApplicationConnectionCollector,
  parseConnectionJson,
  parseNetstatOutput,
  runConnectionNetstat,
  runConnectionPowerShell
};
