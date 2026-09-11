'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { SCHEMA_VERSION } = require('./contracts');

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_COMMAND_LINE_CHARS = 32768;
const MAX_CONFIG_LINE_CHARS = 8192;
const MAX_DISCOVERY_DEPTH = 2;
const ALLOWED_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.txt']);
const BLOCKED_FILE_PATTERN = /(account|credential|cookie|token|secret|password|subscription|browser|webview|login|history|cache|database|\.db$|\.sqlite)/i;
const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|credential|authorization|subscription|api[-_]?key|private[-_]?key|cookie|uuid|username|account|server|certificate)/i;
const ALLOWED_LAUNCH_FLAGS = new Set(['--config', '-c', '--listen', '--proxy', '--tun', '--controller']);
const PORT_KEYS = Object.freeze({
  'port': 'mixed_port', 'mixed-port': 'mixed_port', 'mixed_port': 'mixed_port',
  'http-port': 'http_port', 'http_port': 'http_port', 'http-listen-port': 'http_port',
  'socks-port': 'socks_port', 'socks_port': 'socks_port', 'socks5-port': 'socks_port',
  'external-controller': 'controller_port', 'controller-port': 'controller_port', 'controller_port': 'controller_port',
  'dns-listen': 'dns_port', 'dns-port': 'dns_port', 'dns_port': 'dns_port'
});
const ProofStrength = Object.freeze({ PROVEN: 'proven', STRONG: 'strong', CANDIDATE: 'candidate', UNKNOWN: 'unknown', NOT_FOUND: 'not_found' });
const ConfigDiscoveryState = Object.freeze({ READY: 'ready', NOT_FOUND: 'not_found', BLOCKED: 'blocked' });

function safeBaseName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const name = path.basename(stripMatchingOuterQuotes(value.trim()));
  return name && !BLOCKED_FILE_PATTERN.test(name) ? name.slice(0, 160) : null;
}

function tokenizeCommandLine(commandLine) {
  if (typeof commandLine !== 'string') return [];
  if (commandLine.length > MAX_COMMAND_LINE_CHARS) return [];
  const tokens = [];
  let current = '';
  let quoted = false;
  for (const character of commandLine) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/u.test(character)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

function projectSafeApexProcessLaunch({ name, pid, commandLine } = {}) {
  const tokens = tokenizeCommandLine(commandLine); const allowedFlags = []; let configPath = null; let sensitiveArgumentMarkerPresent = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]; const [head, inline] = token.split(/=(.*)/s); const flag = head.toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(flag)) { sensitiveArgumentMarkerPresent = true; continue; }
    if (!ALLOWED_LAUNCH_FLAGS.has(flag)) continue;
    allowedFlags.push(flag);
    const value = inline || tokens[i + 1];
    if ((flag === '--config' || flag === '-c') && value && !String(value).startsWith('-') && !SENSITIVE_KEY_PATTERN.test(value)) configPath = value;
  }
  return {
    schema_version: SCHEMA_VERSION, process_name: ['Apex.exe', 'ApexCore.exe', 'ApexHelperService.exe'].includes(name) ? name : 'unknown',
    pid: Number.isInteger(pid) ? pid : null, availability: tokens.length ? 'available' : 'unavailable',
    allowed_flags: [...new Set(allowedFlags)].sort(), config_argument_present: Boolean(configPath),
    config_path_resolved: false, config_file_name: safeBaseName(configPath), sensitive_argument_marker_present: sensitiveArgumentMarkerPresent,
    raw_command_line_retained: false
  };
}

function isKeyBoundary(character) { return character === '-' || character === "'" || character === '"' || /\s/u.test(character); }
function trimKeyBoundaries(value) {
  const text = String(value || '').trim().toLowerCase();
  let start = 0; let end = text.length;
  while (start < end && isKeyBoundary(text[start])) start += 1;
  while (end > start && isKeyBoundary(text[end - 1])) end -= 1;
  return text.slice(start, end);
}
function stripMatchingOuterQuotes(value) {
  const text = String(value || '');
  return text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))
    ? text.slice(1, -1)
    : text;
}
function normalizeKey(key) { return trimKeyBoundaries(key); }
function port(value) { const match = String(value ?? '').match(/(?:^|:)(\d{1,5})(?:\s*$|\/)/); const number = Number(match?.[1] ?? value); return Number.isInteger(number) && number > 0 && number <= 65535 ? number : null; }
function bool(value) { if (value === true || /^(true|yes|on|enabled)$/i.test(String(value).trim())) return true; if (value === false || /^(false|no|off|disabled)$/i.test(String(value).trim())) return false; return null; }
function safeMode(value) { const match = String(value ?? '').trim().toLowerCase(); return ['global', 'rule', 'direct', 'script', 'system', 'http', 'socks', 'mixed', 'tun'].includes(match) ? match : null; }
function safeInterface(value) { const text = String(value ?? '').trim().replace(/^['"]|['"]$/g, ''); return text && text.length <= 80 && /^[\p{L}\p{N} _#().-]+$/u.test(text) && !SENSITIVE_KEY_PATTERN.test(text) ? text : null; }

function flattenObject(value, prefix = '', result = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenObject(child, next, result); else result.push([next, child]);
  }
  return result;
}

function safePairsFromText(text) {
  const source = String(text || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_CONFIG_BYTES) return [];
  return source.split(/\r?\n/).flatMap((line) => {
    if (line.length > MAX_CONFIG_LINE_CHARS) return [];
    let commentAt = -1;
    for (let index = 1; index < line.length; index += 1) {
      if (line[index] === '#' && /\s/u.test(line[index - 1])) { commentAt = index; break; }
    }
    const clean = (commentAt >= 0 ? line.slice(0, commentAt) : line).trim();
    if (!clean || clean.startsWith('#') || clean.startsWith(';')) return [];
    const colon = clean.indexOf(':'); const equals = clean.indexOf('=');
    const separator = colon < 0 ? equals : (equals < 0 ? colon : Math.min(colon, equals));
    if (separator <= 0) return [];
    const key = clean.slice(0, separator).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || SENSITIVE_KEY_PATTERN.test(key)) return [];
    return [[key, stripMatchingOuterQuotes(clean.slice(separator + 1).trim())]];
  });
}

function projectApexRuntimeConfig(input, { sourceKind = 'unknown', sourceFileName = null } = {}) {
  let pairs = [];
  if (input && typeof input === 'object' && !Buffer.isBuffer(input)) pairs = flattenObject(input);
  else {
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
    try { const parsed = JSON.parse(text); pairs = flattenObject(parsed); } catch { pairs = safePairsFromText(text); }
  }
  const projection = {
    schema_version: SCHEMA_VERSION, availability: pairs.length ? 'available' : 'unavailable', source_kind: sourceKind,
    source_file_name: safeBaseName(sourceFileName), config_path_retained: false, raw_config_retained: false,
    mode: null, route_mode: null, bind_scope: 'unknown', ipv6_enabled: null, system_proxy_enabled: null,
    tun: { enabled: null, interface_name: null, auto_route: null, strict_route: null, ipv6_enabled: null },
    ports: { http_port: null, socks_port: null, mixed_port: null, controller_port: null, dns_port: null },
    fields_observed: []
  };
  for (const [rawKey, value] of pairs) {
    const full = normalizeKey(rawKey); const key = full.split('.').at(-1); if (SENSITIVE_KEY_PATTERN.test(full)) continue;
    const portKey = PORT_KEYS[full] || PORT_KEYS[key];
    if (portKey) { const parsed = port(value); if (parsed) { projection.ports[portKey] = parsed; projection.fields_observed.push(portKey); } continue; }
    if (['mode', 'proxy-mode', 'proxy_mode'].includes(key)) { const parsed = safeMode(value); if (parsed) { projection.mode = parsed; projection.fields_observed.push('mode'); } }
    else if (['route-mode', 'route_mode'].includes(key)) { const parsed = safeMode(value); if (parsed) { projection.route_mode = parsed; projection.fields_observed.push('route_mode'); } }
    else if (['bind-address', 'bind_address', 'listen'].includes(key)) { const text = String(value).trim(); projection.bind_scope = ['127.0.0.1', '::1', 'localhost'].includes(text) ? 'loopback' : (['0.0.0.0', '::', '*'].includes(text) ? 'wildcard' : 'unknown'); projection.fields_observed.push('bind_scope'); }
    else if (['ipv6', 'ipv6-enabled', 'ipv6_enabled'].includes(key)) { const parsed = bool(value); if (parsed !== null) { if (full.includes('tun')) projection.tun.ipv6_enabled = parsed; else projection.ipv6_enabled = parsed; projection.fields_observed.push(full.includes('tun') ? 'tun.ipv6_enabled' : 'ipv6_enabled'); } }
    else if (['system-proxy', 'system_proxy', 'set-system-proxy'].includes(key)) { const parsed = bool(value); if (parsed !== null) { projection.system_proxy_enabled = parsed; projection.fields_observed.push('system_proxy_enabled'); } }
    else if ((key === 'enable' || key === 'enabled') && full.includes('tun')) { const parsed = bool(value); if (parsed !== null) { projection.tun.enabled = parsed; projection.fields_observed.push('tun.enabled'); } }
    else if (['interface-name', 'interface_name', 'device', 'name'].includes(key) && full.includes('tun')) { const parsed = safeInterface(value); if (parsed) { projection.tun.interface_name = parsed; projection.fields_observed.push('tun.interface_name'); } }
    else if (['auto-route', 'auto_route'].includes(key) && full.includes('tun')) { const parsed = bool(value); if (parsed !== null) { projection.tun.auto_route = parsed; projection.fields_observed.push('tun.auto_route'); } }
    else if (['strict-route', 'strict_route'].includes(key) && full.includes('tun')) { const parsed = bool(value); if (parsed !== null) { projection.tun.strict_route = parsed; projection.fields_observed.push('tun.strict_route'); } }
  }
  projection.fields_observed = [...new Set(projection.fields_observed)].sort();
  projection.availability = projection.fields_observed.length ? 'available' : 'unavailable';
  return projection;
}

function isSafeCandidate(file, root, maxDepth = MAX_DISCOVERY_DEPTH) {
  const relative = path.relative(root, file); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const depth = relative.split(/[\\/]/).length; const extension = path.extname(file).toLowerCase(); const name = path.basename(file);
  return depth <= maxDepth && ALLOWED_EXTENSIONS.has(extension) && !BLOCKED_FILE_PATTERN.test(name);
}

class ApexRuntimeConfigDiscovery {
  constructor(options = {}) {
    this.fs = options.fs || fs; this.maxDepth = options.maxDepth ?? MAX_DISCOVERY_DEPTH; this.maxBytes = options.maxBytes ?? MAX_CONFIG_BYTES;
    if (!Number.isInteger(this.maxDepth) || this.maxDepth < 1 || this.maxDepth > 2) throw new RangeError('maxDepth must be 1 or 2.');
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > MAX_CONFIG_BYTES) throw new RangeError('maxBytes invalid.');
  }
  async discover({ executableDirectories = [], explicitConfigPaths = [] } = {}) {
    const candidates = [];
    for (const file of explicitConfigPaths) if (typeof file === 'string' && path.isAbsolute(file)) candidates.push({ file, sourceKind: 'launch_argument' });
    for (const root of [...new Set(executableDirectories.filter((x) => typeof x === 'string' && path.isAbsolute(x)))]) {
      let first = []; try { first = await this.fs.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const item of first) {
        if (item.isFile()) candidates.push({ file: path.join(root, item.name), sourceKind: 'runtime_directory' });
        else if (item.isDirectory() && this.maxDepth >= 2) {
          let second = []; try { second = await this.fs.readdir(path.join(root, item.name), { withFileTypes: true }); } catch { continue; }
          for (const child of second) if (child.isFile()) candidates.push({ file: path.join(root, item.name, child.name), sourceKind: 'runtime_directory' });
        }
      }
    }
    const projections = [];
    for (const candidate of candidates) {
      const explicit = candidate.sourceKind === 'launch_argument'; const root = executableDirectories.find((x) => candidate.file === x || candidate.file.startsWith(`${x}${path.sep}`));
      if (!explicit && (!root || !isSafeCandidate(candidate.file, root, this.maxDepth))) continue;
      if (BLOCKED_FILE_PATTERN.test(path.basename(candidate.file)) || !ALLOWED_EXTENSIONS.has(path.extname(candidate.file).toLowerCase())) continue;
      try {
        const stat = await this.fs.stat(candidate.file); if (!stat.isFile() || stat.size > this.maxBytes) continue;
        const content = await this.fs.readFile(candidate.file); if (content.length > this.maxBytes || content.includes(0)) continue;
        const projection = projectApexRuntimeConfig(content, { sourceKind: candidate.sourceKind, sourceFileName: path.basename(candidate.file) });
        if (projection.availability === 'available') projections.push(projection);
      } catch { /* safe fail-soft */ }
    }
    const best = projections.sort((a, b) => b.fields_observed.length - a.fields_observed.length)[0] || null;
    return { schema_version: SCHEMA_VERSION, state: best ? ConfigDiscoveryState.READY : ConfigDiscoveryState.NOT_FOUND, search_depth_max: this.maxDepth, file_size_max_bytes: this.maxBytes, candidate_projection_count: projections.length, projection: best, raw_content_retained: false, searched_root_count: new Set(executableDirectories).size };
  }
}

function proofForRole({ role, port: configuredPort, projection, listeners = [], observedAt = new Date().toISOString() }) {
  const configured = Number.isInteger(configuredPort); const matches = configured ? listeners.filter((x) => x.local_port === configuredPort) : [];
  const listener = matches.find((x) => x.component_owner === 'ApexCore.exe') || matches[0];
  const strength = configured && listener ? ProofStrength.PROVEN : (configured ? ProofStrength.STRONG : (listeners.length ? ProofStrength.CANDIDATE : ProofStrength.NOT_FOUND));
  return { schema_version: SCHEMA_VERSION, configured_role: role, port: configured ? configuredPort : null, address: listener?.local_address || null, transport: listener?.protocol || null, owning_component: listener?.component_owner || null, listener_observed: Boolean(listener), configuration_observed: configured, proof_strength: strength, evidence_types: [...(configured ? ['safe_config_projection'] : []), ...(listener ? ['apex_listener_ownership'] : [])], observed_at: observedAt, raw_config_retained: false, source_available: projection?.availability === 'available' };
}

function buildApexProxyPortProofs({ projection, listeners, observedAt = new Date().toISOString() }) {
  const ports = projection?.ports || {};
  return {
    http: proofForRole({ role: 'http', port: ports.http_port, projection, listeners, observedAt }),
    socks: proofForRole({ role: 'socks', port: ports.socks_port, projection, listeners, observedAt }),
    mixed: proofForRole({ role: 'mixed', port: ports.mixed_port, projection, listeners, observedAt }),
    controller: proofForRole({ role: 'controller', port: ports.controller_port, projection, listeners, observedAt }),
    dns: proofForRole({ role: 'dns', port: ports.dns_port, projection, listeners, observedAt })
  };
}

function buildApexTunProof({ projection, adapters = [], routes = { ipv4: [], ipv6: [] }, observedAt = new Date().toISOString() }) {
  const configured = projection?.tun?.enabled === true; const configuredName = projection?.tun?.interface_name?.toLowerCase();
  const adapter = configuredName ? adapters.find((x) => `${x.name || ''} ${x.description || ''}`.toLowerCase().includes(configuredName)) : null;
  const routed = adapter ? [...(routes.ipv4 || []), ...(routes.ipv6 || [])].some((x) => x.interface_index === adapter.interface_index) : false;
  const strength = configured && adapter && routed ? ProofStrength.PROVEN : (configured && adapter ? ProofStrength.STRONG : (configured || adapters.some((x) => x.virtual) ? ProofStrength.CANDIDATE : ProofStrength.NOT_FOUND));
  return { schema_version: SCHEMA_VERSION, enabled: configured, interface_configured: Boolean(configuredName), adapter_observed: Boolean(adapter), route_observed: routed, ipv6_enabled: projection?.tun?.ipv6_enabled ?? null, auto_route: projection?.tun?.auto_route ?? null, strict_route: projection?.tun?.strict_route ?? null, proof_strength: strength, observed_at: observedAt, raw_config_retained: false };
}

class ApexRouteContinuityMonitor {
  constructor() { this.previouslyReady = false; }
  observe(binding) {
    const ready = binding?.foreign_path_candidate?.state === 'ready';
    if (ready) { this.previouslyReady = true; return null; }
    if (!this.previouslyReady) return null;
    this.previouslyReady = false;
    return { code: 'FOREIGN_ROUTE_LOST', severity: 'warning', evidence: ['apex.foreign_path.previous_ready', 'apex.foreign_path.current_unavailable'] };
  }
}

module.exports = { ALLOWED_EXTENSIONS, ApexRouteContinuityMonitor, ApexRuntimeConfigDiscovery, BLOCKED_FILE_PATTERN, ConfigDiscoveryState, MAX_CONFIG_BYTES, MAX_DISCOVERY_DEPTH, ProofStrength, buildApexProxyPortProofs, buildApexTunProof, isSafeCandidate, projectApexRuntimeConfig, projectSafeApexProcessLaunch, proofForRole, safeBaseName, tokenizeCommandLine };
