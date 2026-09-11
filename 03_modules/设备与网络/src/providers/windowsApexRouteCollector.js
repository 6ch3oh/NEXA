'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const { buildApexRouteObservation } = require('../apexRouteObservation');
const { buildApexRouteBinding } = require('../apexRouteBinding');
const { ApexRuntimeConfigDiscovery, projectSafeApexProcessLaunch } = require('../apexRuntimeConfig');
const MAX_ROUTE_OUTPUT_CHARS = 1024 * 1024;
const MAX_ROUTE_LINE_CHARS = 4096;

const APEX_NAMES = new Set(['Apex.exe', 'ApexCore.exe', 'ApexHelperService.exe']);
const PROCESS_SCRIPT = "$items=@(Get-Process -Name Apex,ApexCore,ApexHelperService -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{Name=($_.ProcessName+'.exe');Pid=$_.Id;Path=$_.Path} }); $dirs=@($items.Path|Where-Object{$_}|ForEach-Object{Split-Path -Parent $_}|Sort-Object -Unique); $runtime=[PSCustomObject]@{ProxyComponentPresent=[bool]@($dirs|Where-Object{Test-Path -LiteralPath (Join-Path $_ 'proxy_plugin.dll')}).Count;HelperComponentPresent=[bool]@($dirs|Where-Object{Test-Path -LiteralPath (Join-Path $_ 'ApexHelperService.exe')}).Count}; [PSCustomObject]@{Items=$items;RuntimeEvidence=$runtime}|ConvertTo-Json -Depth 3 -Compress";
const PROXY_SCRIPT = "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue; $server=[string]$p.ProxyServer; if($server.Length -gt 512){$server=''}; [PSCustomObject]@{Enabled=($p.ProxyEnable -eq 1);Server=$server;PacPresent=(-not [string]::IsNullOrWhiteSpace([string]$p.AutoConfigURL));BypassPresent=(-not [string]::IsNullOrWhiteSpace([string]$p.ProxyOverride));AutoDetect=($p.AutoDetect -eq 1)}|ConvertTo-Json -Compress";
const LAUNCH_SCRIPT = "$rows=@(Get-CimInstance Win32_Process -Filter \"Name='Apex.exe' OR Name='ApexCore.exe' OR Name='ApexHelperService.exe'\" -ErrorAction SilentlyContinue|ForEach-Object{[PSCustomObject]@{Name=$_.Name;Pid=[int]$_.ProcessId;CommandLine=[string]$_.CommandLine}});[PSCustomObject]@{Items=$rows}|ConvertTo-Json -Depth 3 -Compress";

function exec(executable, args, timeout = 5000) {
  return new Promise((resolve, reject) => execFile(executable, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })));
}

function parseEndpoint(text) {
  const bracket = text.match(/^\[([^\]]+)]:(\d+)$/); const plain = text.match(/^(.*):(\d+)$/);
  const address = bracket?.[1] ?? plain?.[1]; const port = Number(bracket?.[2] ?? plain?.[2]);
  return net.isIP(address) && Number.isInteger(port) ? { address, port } : null;
}

function parseNetstat(stdout, pids) {
  const listeners = []; const connections = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/); const protocol = fields[0]?.toLowerCase();
    if (!['tcp', 'udp'].includes(protocol)) continue;
    const pid = Number(protocol === 'tcp' ? fields[4] : fields[3]); if (!pids.has(pid)) continue;
    const local = parseEndpoint(fields[1]); const remote = protocol === 'tcp' ? parseEndpoint(fields[2]) : null; if (!local) continue;
    const loopback = ['127.0.0.1', '::1'].includes(local.address);
    if ((protocol === 'tcp' && String(fields[3]).toUpperCase() === 'LISTENING') || protocol === 'udp') listeners.push({ protocol, address: local.address, port: local.port, pid, loopback });
    if (remote) connections.push({ protocol, pid, localPort: local.port, remotePort: remote.port, loopback: ['127.0.0.1', '::1'].includes(remote.address), ip_version: remote.address.includes(':') ? 'ipv6' : 'ipv4' });
  }
  return { listeners, connections };
}

function parseInterfaces(stdout) {
  return String(stdout).split(/\r?\n/).map((line) => line.trim()).filter((line) => /vpn|tun|tap|wintun|virtual|虚拟/i.test(line)).map((line) => ({ kind: 'virtual_adapter_candidate', name_hint: /apex/i.test(line) ? 'apex' : 'unattributed' }));
}

function parseDefaultRoutes(stdout) {
  return String(stdout).split(/\r?\n/).filter((line) => /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+/.test(line)).map(() => ({ kind: 'default_route' }));
}

function maskNextHop(value) {
  const parts = String(value || '').trim().split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))
    ? `${parts[0]}.${parts[1]}.*.*`
    : '已脱敏';
}

function parseNetshDefaultRoutes(stdout) {
  return String(stdout).split(/\r?\n/).flatMap((line) => {
    // `netsh` localizes both the Publish and Type columns (for example
    // "否 / 手动" on zh-CN Windows). Their spelling is not route identity,
    // so parse them as bounded non-whitespace fields and retain only Type as
    // diagnostic metadata.
    const row = line.match(/^\s*\S+\s+(\S+)\s+(\d+)\s+0\.0\.0\.0\/0\s+(\d+)\s+(\S+)\s*$/i);
    if (!row) return [];
    return [{
      kind: 'default_route',
      family: 'ipv4',
      interface_index: Number(row[3]),
      next_hop_masked: maskNextHop(row[4]),
      route_metric: Number(row[2]),
      route_type: row[1].toLowerCase()
    }];
  });
}

function parseRoutePrint(stdout, family) {
  const source = String(stdout || '');
  if (source.length > MAX_ROUTE_OUTPUT_CHARS) return { adapters: [], routes: [] };
  const lines = source.split(/\r?\n/); const adapters = []; const routes = [];
  for (const line of lines) {
    if (line.length > MAX_ROUTE_LINE_CHARS) continue;
    const adapter = line.match(/^\s*(\d+)\.{3}.*?\.{6}(.+)$/);
    if (adapter) {
      const name = adapter[2].trim();
      adapters.push({ interface_index: Number(adapter[1]), name, description: name, virtual: /vpn|tun|tap|wintun|virtual|hyper-v|teredo/i.test(name), apex_related: /apex/i.test(name) });
      continue;
    }
    if (family === 'ipv4') {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 5 || net.isIP(fields[0]) !== 4 || net.isIP(fields[1]) !== 4 || !/^\d+$/.test(fields[4])) continue;
      const defaultRoute = fields[0] === '0.0.0.0' && fields[1] === '0.0.0.0'; const remoteGateway = net.isIP(fields[2]) === 4;
      routes.push({ family, destination: defaultRoute ? '0.0.0.0/0' : `${fields[0]}/${fields[1]}`, default: defaultRoute, split_candidate: !defaultRoute && remoteGateway, interface_address: fields[3], interface_index: null, metric: Number(fields[4]) });
    } else {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1]) || !fields[2].includes(':')) continue;
      const destination = fields[2]; const gateway = fields.slice(3).join(' '); const defaultRoute = destination === '::/0';
      routes.push({ family, destination, default: defaultRoute, split_candidate: !defaultRoute && !/^On-link$/i.test(gateway) && !/^(::1|fe80:|ff00:|2001::\/32)/i.test(destination), interface_index: Number(fields[0]), metric: Number(fields[1]) });
    }
  }
  return { adapters, routes };
}

class WindowsApexRouteCollector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform; this.now = options.now || (() => new Date());
    const isolatedProviders = typeof options.processProvider === 'function';
    const systemRoot = options.systemRoot || process.env.SystemRoot || 'C:\\Windows';
    const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.processProvider = options.processProvider || (() => exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROCESS_SCRIPT]));
    this.netstatProvider = options.netstatProvider || (() => exec(path.join(systemRoot, 'System32', 'netstat.exe'), ['-ano']));
    this.proxyProvider = options.proxyProvider || (() => exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROXY_SCRIPT]));
    this.adapterProvider = options.adapterProvider || (() => exec(path.join(systemRoot, 'System32', 'netsh.exe'), ['interface', 'show', 'interface']));
    this.routeProvider = options.routeProvider || (() => exec(path.join(systemRoot, 'System32', 'route.exe'), ['print', '-4']));
    this.defaultRouteProvider = options.defaultRouteProvider || (isolatedProviders
      ? null
      : (() => exec(path.join(systemRoot, 'System32', 'netsh.exe'), ['interface', 'ipv4', 'show', 'route'])));
    this.ipv6RouteProvider = options.ipv6RouteProvider || (() => exec(path.join(systemRoot, 'System32', 'route.exe'), ['print', '-6']));
    this.serviceProvider = options.serviceProvider || (() => exec(path.join(systemRoot, 'System32', 'sc.exe'), ['query', 'ApexHelperService']));
    this.launchProvider = options.launchProvider || (isolatedProviders
      ? (() => Promise.resolve({ stdout: '{"Items":[]}' }))
      : (() => exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', LAUNCH_SCRIPT])));
    this.configDiscovery = options.configDiscovery || (isolatedProviders
      ? { discover: async () => ({ state: 'not_found', projection: null, raw_content_retained: false }) }
      : new ApexRuntimeConfigDiscovery());
  }

  async collectRaw() {
    const observedAt = this.now().toISOString();
    if (this.platform !== 'win32') return { observedAt, processes: [], listeners: [], connections: [], adapterAvailability: 'unavailable', routeAvailability: 'unavailable', routes: { ipv4: [], ipv6: [] }, adapters: [] };
    let processes = []; let runtimeEvidence = {}; let systemProxy = null; let network = { listeners: [], connections: [] };
    try {
      const result = await this.processProvider(); const parsed = JSON.parse(result.stdout); const rows = Array.isArray(parsed.Items) ? parsed.Items : (parsed.Items ? [parsed.Items] : []); runtimeEvidence = parsed.RuntimeEvidence || {};
      processes = rows.flatMap((item) => { const name = String(item.Name || ''); const pid = Number(item.Pid); const executable = typeof item.Path === 'string' ? item.Path : null; if (!APEX_NAMES.has(name) || !Number.isInteger(pid)) return []; return [{ name, pid, parentPid: null, executableDirectory: executable ? path.dirname(executable) : null }]; });
    } catch { processes = []; }
    try { network = parseNetstat((await this.netstatProvider()).stdout, new Set(processes.map((item) => item.pid))); } catch { /* fail soft */ }
    try { const value = JSON.parse((await this.proxyProvider()).stdout); systemProxy = { enabled: value.Enabled === true, server: typeof value.Server === 'string' ? value.Server : (value.ServerPresent ? 'present' : null), pac_url_present: value.PacPresent === true, bypass_present: value.BypassPresent === true, auto_detect: value.AutoDetect === true }; } catch { /* fail soft */ }
    let virtualAdapters = []; let defaultRoutes = []; let adapterAvailability = 'unavailable'; let routeAvailability = 'unavailable'; let route4 = { adapters: [], routes: [] }; let route6 = { adapters: [], routes: [] };
    try { virtualAdapters = parseInterfaces((await this.adapterProvider()).stdout); adapterAvailability = 'available'; } catch { /* fail soft */ }
    try { const stdout = (await this.routeProvider()).stdout; defaultRoutes = parseDefaultRoutes(stdout); route4 = parseRoutePrint(stdout, 'ipv4'); routeAvailability = 'available'; } catch { /* fail soft */ }
    if (this.defaultRouteProvider) {
      try {
        const projected = parseNetshDefaultRoutes((await this.defaultRouteProvider()).stdout);
        if (projected.length) defaultRoutes = projected;
      } catch { /* retain route.exe presence-only fallback */ }
    }
    try { route6 = parseRoutePrint((await this.ipv6RouteProvider()).stdout, 'ipv6'); } catch { /* fail soft */ }
    let helperServiceStatus = 'not_installed_or_unknown';
    try { const text = (await this.serviceProvider()).stdout; helperServiceStatus = /RUNNING/i.test(text) ? 'running' : (/STOPPED/i.test(text) ? 'stopped' : 'not_installed_or_unknown'); } catch { /* fail soft */ }
    const adapterMap = new Map([...route4.adapters, ...route6.adapters].map((x) => [x.interface_index, x]));
    const configEvidence = { availability: 'available', relevant_runtime_file_kinds: [...(runtimeEvidence.ProxyComponentPresent ? ['proxy_component'] : []), ...(runtimeEvidence.HelperComponentPresent ? ['helper_component'] : [])] };
    let launchProjections=[];try{const parsed=JSON.parse((await this.launchProvider()).stdout);const rows=Array.isArray(parsed.Items)?parsed.Items:(parsed.Items?[parsed.Items]:[]);launchProjections=rows.map((x)=>projectSafeApexProcessLaunch({name:x.Name,pid:Number(x.Pid),commandLine:x.CommandLine}));}catch{/* fail soft */}
    const explicitConfigPaths=[];for(const projection of launchProjections){if(projection.config_argument_present&&projection.config_file_name){const owner=processes.find((x)=>x.name===projection.process_name);if(owner?.executableDirectory)explicitConfigPaths.push(path.join(owner.executableDirectory,projection.config_file_name));}}
    let configDiscovery={state:'not_found',projection:null,raw_content_retained:false};try{configDiscovery=await this.configDiscovery.discover({executableDirectories:[...new Set(processes.map((x)=>x.executableDirectory).filter(Boolean))],explicitConfigPaths});}catch{/* fail soft */}
    return { observedAt, processes, ...network, systemProxy, virtualAdapters, defaultRoutes, adapterAvailability, routeAvailability, adapters: [...adapterMap.values()], routes: { ipv4: route4.routes, ipv6: route6.routes }, helperServiceStatus, configEvidence, runtimeConfigProjection:configDiscovery.projection,configDiscovery,launchProjectionAvailability:launchProjections.some((x)=>x.availability==='available')?'available':'unavailable', dnsAvailability: 'unavailable', dnsConfiguredInterfaceCount: 0 };
  }

  async collect() { const raw = await this.collectRaw(); return buildApexRouteObservation(raw, raw.observedAt); }
  async collectBinding() { const raw = await this.collectRaw(); return buildApexRouteBinding(raw, raw.observedAt); }
}

module.exports = { LAUNCH_SCRIPT, PROCESS_SCRIPT, PROXY_SCRIPT, WindowsApexRouteCollector, maskNextHop, parseDefaultRoutes, parseInterfaces, parseNetshDefaultRoutes, parseNetstat, parseRoutePrint };
