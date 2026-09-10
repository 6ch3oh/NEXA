'use strict';

const { SCHEMA_VERSION } = require('./contracts');
const { ApexRouteModel, EvidenceConfidence } = require('./apexRouteObservation');
const { NetworkPathKind, PathEvidenceState, validateNetworkPathObservation } = require('./networkPathQuality');
const { ProofStrength, buildApexProxyPortProofs, buildApexTunProof } = require('./apexRuntimeConfig');

const Handling = Object.freeze({ APEX: 'apex', DIRECT: 'direct', MIXED: 'mixed', UNKNOWN: 'unknown' });
const BindingState = Object.freeze({ READY: 'ready', CONTRACT_READY: 'contract_ready', DEFERRED: 'deferred' });
const TunBindingState = Object.freeze({ BOUND_TO_APEX: 'bound_to_apex', CANDIDATE: 'candidate', NOT_FOUND: 'not_found', UNKNOWN: 'unknown' });
const COMPONENTS = Object.freeze(['Apex.exe', 'ApexCore.exe', 'ApexHelperService.exe']);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const validAt = (value) => Number.isFinite(Date.parse(value));

function endpointScope(address) {
  if (['127.0.0.1', '::1'].includes(address)) return 'loopback';
  if (['0.0.0.0', '::'].includes(address)) return 'wildcard';
  return 'lan';
}

function buildApexRuntimeComponentMap(raw = {}, observedAt = new Date().toISOString()) {
  const processes = new Map((raw.processes || []).filter((p) => COMPONENTS.includes(p.name)).map((p) => [p.name, p]));
  const listeners = raw.listeners || []; const connections = raw.connections || [];
  const components = COMPONENTS.map((name) => {
    const process = processes.get(name); const pid = Number.isInteger(process?.pid) ? process.pid : null;
    return {
      name, running: pid !== null, pid,
      executable_identity: { name, path_resolved: Boolean(process?.executableDirectory), same_runtime_directory: Boolean(raw.sameExecutableDirectory) },
      parent_pid: Number.isInteger(process?.parentPid) ? process.parentPid : null,
      parent_relation: Number.isInteger(process?.parentPid) && [...processes.values()].some((p) => p.pid === process.parentPid) ? 'apex_component' : 'unknown',
      role: 'unknown', role_evidence: name === 'Apex.exe' ? 'ui_name_candidate' : (name === 'ApexCore.exe' ? 'core_name_candidate' : 'helper_name_candidate'),
      listening_endpoint_count: pid === null ? 0 : listeners.filter((x) => x.pid === pid).length,
      owned_connection_count: pid === null ? 0 : connections.filter((x) => x.pid === pid).length,
      service_status: name === 'ApexHelperService.exe' ? (raw.helperServiceStatus || 'not_installed_or_unknown') : 'not_applicable'
    };
  });
  return { schema_version: SCHEMA_VERSION, availability: components.some((x) => x.running) ? 'available' : 'unavailable', observed_at: observedAt, components };
}

function buildApexLocalListenerObservations(raw = {}) {
  const owners = new Map((raw.processes || []).filter((p) => COMPONENTS.includes(p.name)).map((p) => [p.pid, p.name]));
  return (raw.listeners || []).filter((x) => owners.has(x.pid)).flatMap((x) => {
    const scope = endpointScope(x.address); const ipVersion = x.address.includes(':') ? 'ipv6' : 'ipv4';
    if (!['tcp', 'udp'].includes(x.protocol) || !Number.isInteger(x.port) || x.port < 1 || x.port > 65535) return [];
    return [{ owner_pid: x.pid, component_owner: owners.get(x.pid), protocol: x.protocol, ip_version: ipVersion, local_address: x.address, local_port: x.port, scope, purpose: 'unknown', ownership: 'apex_process' }];
  }).sort((a, b) => a.owner_pid - b.owner_pid || a.local_port - b.local_port || a.protocol.localeCompare(b.protocol));
}

function parseProxyEndpoint(value) {
  const text = String(value || '').trim(); if (!text) return [];
  return text.split(';').flatMap((part) => {
    const match = part.trim().match(/^(?:(https?|socks)\s*=\s*)?(?:https?:\/\/|socks5?:\/\/)?(?:\[([^\]]+)]|([^:]+)):(\d+)$/i);
    if (!match) return [];
    const port = Number(match[4]); if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
    return [{ protocol_hint: match[1]?.toLowerCase() || 'system', address: (match[2] || match[3]).toLowerCase(), port }];
  });
}

function sanitizeConfigEvidence(input = {}) {
  const ports = {};
  for (const key of ['http_port', 'socks_port', 'mixed_port', 'controller_port']) {
    if (Number.isInteger(input[key]) && input[key] > 0 && input[key] <= 65535) ports[key] = input[key];
  }
  return {
    availability: ['available', 'unavailable'].includes(input.availability) ? input.availability : 'unavailable',
    fields_present: {
      system_proxy: input.system_proxy === true, http: input.http === true, socks: input.socks === true,
      mixed: input.mixed === true, tun: input.tun === true, rule_or_split: input.rule_or_split === true,
      controller: input.controller === true
    }, ports,
    relevant_runtime_file_kinds: [...new Set((input.relevant_runtime_file_kinds || []).filter((x) => ['proxy_component', 'tun_component', 'helper_component'].includes(x)))].sort(),
    raw_config_retained: false
  };
}

function bindingBlock(state, confidence, evidence) { return { state, confidence, evidence: [...new Set(evidence)].sort() }; }

function buildApexRouteBinding(raw = {}, observedAt = new Date().toISOString()) {
  const componentMap = buildApexRuntimeComponentMap(raw, observedAt);
  const listeners = buildApexLocalListenerObservations(raw);
  const projection = raw.runtimeConfigProjection || null;
  const projectedEvidence = projection ? {
    availability: projection.availability,
    http: Number.isInteger(projection.ports?.http_port), http_port: projection.ports?.http_port,
    socks: Number.isInteger(projection.ports?.socks_port), socks_port: projection.ports?.socks_port,
    mixed: Number.isInteger(projection.ports?.mixed_port), mixed_port: projection.ports?.mixed_port,
    controller: Number.isInteger(projection.ports?.controller_port), controller_port: projection.ports?.controller_port,
    tun: projection.tun?.enabled === true, rule_or_split: projection.route_mode === 'rule', system_proxy: projection.system_proxy_enabled === true,
    relevant_runtime_file_kinds: raw.configEvidence?.relevant_runtime_file_kinds || []
  } : raw.configEvidence;
  const config = sanitizeConfigEvidence(projectedEvidence);
  const portProofs = buildApexProxyPortProofs({ projection, listeners, observedAt });
  const proxy = raw.systemProxy || {};
  const proxyEndpoints = parseProxyEndpoint(proxy.server);
  const matches = proxyEndpoints.filter((endpoint) => listeners.some((listener) => listener.local_port === endpoint.port && ['127.0.0.1', '::1', 'localhost'].includes(endpoint.address)));
  const proxyBound = proxy.enabled === true && matches.length > 0;
  const systemProxyBinding = bindingBlock(proxyBound ? 'bound_to_apex' : (proxy.enabled ? 'not_bound' : 'disabled'), proxyBound ? EvidenceConfidence.HIGH : EvidenceConfidence.LOW, proxyBound ? ['system_proxy_enabled', 'proxy_endpoint_matches_apex_listener'] : [proxy.enabled ? 'system_proxy_endpoint_not_apex_owned' : 'system_proxy_disabled']);
  const portOwned = (port) => listeners.some((listener) => listener.local_port === port);
  const httpBound = projection ? portProofs.http.proof_strength === ProofStrength.PROVEN : config.fields_present.http && portOwned(config.ports.http_port);
  const socksBound = projection ? portProofs.socks.proof_strength === ProofStrength.PROVEN : config.fields_present.socks && portOwned(config.ports.socks_port);
  const mixedBound = projection ? portProofs.mixed.proof_strength === ProofStrength.PROVEN : config.fields_present.mixed && portOwned(config.ports.mixed_port);
  const httpProxyBinding = bindingBlock(httpBound || mixedBound ? 'bound_to_apex' : 'unknown', httpBound || mixedBound ? EvidenceConfidence.HIGH : EvidenceConfidence.LOW, httpBound ? ['http_config_port_matches_apex_listener'] : (mixedBound ? ['mixed_config_port_matches_apex_listener'] : []));
  const socksBinding = bindingBlock(socksBound || mixedBound ? 'bound_to_apex' : 'unknown', socksBound || mixedBound ? EvidenceConfidence.HIGH : EvidenceConfidence.LOW, socksBound ? ['socks_config_port_matches_apex_listener'] : (mixedBound ? ['mixed_config_port_matches_apex_listener'] : []));

  const adapters = raw.adapters || []; const routes = raw.routes || { ipv4: [], ipv6: [] };
  const candidates = adapters.filter((x) => x.virtual === true || /tun|wintun|tap|vpn|virtual/i.test(`${x.name || ''} ${x.description || ''}`));
  const apexCandidates = candidates.filter((x) => x.apex_related === true || /apex/i.test(`${x.name || ''} ${x.description || ''}`));
  const routedApex = apexCandidates.filter((adapter) => [...(routes.ipv4 || []), ...(routes.ipv6 || [])].some((route) => route.interface_index === adapter.interface_index));
  const tunProof = buildApexTunProof({ projection, adapters, routes, observedAt });
  const tunBound = projection ? tunProof.proof_strength === ProofStrength.PROVEN : config.fields_present.tun && routedApex.length > 0;
  const tunState = tunBound ? TunBindingState.BOUND_TO_APEX : (candidates.length ? TunBindingState.CANDIDATE : (raw.adapterAvailability === 'available' ? TunBindingState.NOT_FOUND : TunBindingState.UNKNOWN));
  const tunBinding = bindingBlock(tunState, tunBound ? EvidenceConfidence.HIGH : EvidenceConfidence.LOW, tunBound ? ['tun_config_present', 'apex_adapter_route_present'] : (candidates.length ? ['unattributed_virtual_adapter_candidate'] : []));

  let routeModel = ApexRouteModel.UNKNOWN;
  const systemBound = systemProxyBinding.state === 'bound_to_apex';
  const proxyKinds = [httpBound, socksBound, mixedBound, systemBound].filter(Boolean).length;
  if (tunBound && proxyKinds) routeModel = ApexRouteModel.MIXED;
  else if (tunBound) routeModel = ApexRouteModel.TUN;
  else if (mixedBound || (httpBound && socksBound)) routeModel = ApexRouteModel.MIXED;
  else if (systemBound) routeModel = ApexRouteModel.SYSTEM_PROXY;
  else if (httpBound) routeModel = ApexRouteModel.HTTP_PROXY;
  else if (socksBound) routeModel = ApexRouteModel.SOCKS;
  const strongUnboundEvidence = Object.values(portProofs).some((x) => x.proof_strength === ProofStrength.STRONG) || tunProof.proof_strength === ProofStrength.STRONG;
  const confidence = routeModel === ApexRouteModel.UNKNOWN ? (strongUnboundEvidence ? EvidenceConfidence.MEDIUM : EvidenceConfidence.LOW) : EvidenceConfidence.HIGH;

  const ipv4Default = (routes.ipv4 || []).filter((x) => x.default === true);
  const ipv6Default = (routes.ipv6 || []).filter((x) => x.default === true);
  const ipv4Split = (routes.ipv4 || []).filter((x) => x.split_candidate === true);
  const ipv6Split = (routes.ipv6 || []).filter((x) => x.split_candidate === true);
  const proxyMechanism = proxyBound || httpBound || socksBound || mixedBound;
  const handling = (familyDefaults, familySplits) => {
    if (tunBound && familyDefaults.some((x) => routedApex.some((a) => a.interface_index === x.interface_index))) return Handling.APEX;
    if (tunBound && familySplits.some((x) => routedApex.some((a) => a.interface_index === x.interface_index))) return Handling.MIXED;
    if (proxyMechanism && familyDefaults.length) {
      if (familyDefaults === ipv6Default && projection?.ipv6_enabled === false) return Handling.DIRECT;
      return Handling.MIXED;
    }
    if (!proxyMechanism && !tunBound && familyDefaults.length) return Handling.DIRECT;
    return Handling.UNKNOWN;
  };
  const ipv4Handling = handling(ipv4Default, ipv4Split); const ipv6Handling = handling(ipv6Default, ipv6Split);
  const directReady = proxy.enabled !== true && !tunBound && candidates.length === 0 && ipv4Default.length === 1 && ipv4Split.length === 0;
  const foreignReady = routeModel !== ApexRouteModel.UNKNOWN && (proxyMechanism || tunBound);
  const domesticPathCandidate = { state: directReady ? BindingState.READY : BindingState.CONTRACT_READY, executor_kind: directReady ? 'explicit_direct_no_proxy' : null, evidence: directReady ? ['system_proxy_disabled', 'ipv4_default_route_present', 'no_apex_tun_binding'] : ['direct_route_not_fully_proven'] };
  const foreignPathCandidate = { state: foreignReady ? BindingState.READY : BindingState.DEFERRED, executor_kind: foreignReady ? (tunBound ? 'os_route_bound' : 'explicit_proxy') : null, evidence: foreignReady ? ['explicit_apex_path_binding'] : ['apex_listener_protocol_unproven'] };
  const evidence = ['runtime_component_map', 'listener_ownership_observed', proxy.pac_url_present ? 'pac_present' : 'pac_absent'];
  if (listeners.length) evidence.push('apex_owned_listener');
  if ((raw.connections || []).some((x) => x.pid && x.loopback)) evidence.push('apex_loopback_connections');
  if ((raw.connections || []).some((x) => x.pid && !x.loopback && x.ip_version === 'ipv4')) evidence.push('apex_owned_ipv4_connection');
  if ((raw.connections || []).some((x) => x.pid && !x.loopback && x.ip_version === 'ipv6')) evidence.push('apex_owned_ipv6_connection');
  if (ipv4Default.length) evidence.push('ipv4_default_route_observed');
  if (ipv6Default.length) evidence.push('ipv6_default_route_observed');
  if (ipv4Split.length || ipv6Split.length) evidence.push('split_route_candidate');
  if (config.relevant_runtime_file_kinds.includes('proxy_component')) evidence.push('proxy_runtime_component_present');

  return validateApexRouteBinding({
    schema_version: SCHEMA_VERSION, availability: componentMap.availability, observed_at: observedAt,
    route_model: routeModel, confidence, component_map: componentMap, local_listeners: listeners,
    system_proxy: { enabled: proxy.enabled === true, endpoint_present: proxyEndpoints.length > 0, bypass_present: proxy.bypass_present === true },
    pac: { present: proxy.pac_url_present === true, auto_detect: proxy.auto_detect === true },
    system_proxy_binding: systemProxyBinding, http_proxy_binding: httpProxyBinding, socks_binding: socksBinding, tun_binding: tunBinding,
    ipv4_handling: ipv4Handling, ipv6_handling: ipv6Handling,
    route_evidence: { ipv4_default_count: ipv4Default.length, ipv6_default_count: ipv6Default.length, ipv4_split_candidate_count: ipv4Split.length, ipv6_split_candidate_count: ipv6Split.length, ipv6_bypass_candidate: ipv6Handling === Handling.DIRECT && listeners.length > 0 },
    dns_summary: { availability: raw.dnsAvailability || 'unavailable', configured_interface_count: Number.isInteger(raw.dnsConfiguredInterfaceCount) ? raw.dnsConfiguredInterfaceCount : 0 },
    config_discovery: { state: raw.configDiscovery?.state || (projection ? 'ready' : 'not_found'), command_line_projection: raw.launchProjectionAvailability || 'unavailable', raw_content_retained: false },
    config_evidence: config, proxy_port_proofs: portProofs, tun_proof: tunProof,
    domestic_path_candidate: { ...domesticPathCandidate, network_smoke_state: domesticPathCandidate.state === BindingState.READY ? 'ready_for_network_smoke' : domesticPathCandidate.state },
    foreign_path_candidate: { ...foreignPathCandidate, network_smoke_state: foreignPathCandidate.state === BindingState.READY ? 'ready_for_network_smoke' : foreignPathCandidate.state },
    local_api_candidate: { present: listeners.length > 0, request_performed: false, authorization_required: true }, evidence: [...new Set(evidence)].sort(), raw_config_retained: false
  });
}

function validateApexRouteBinding(value) {
  if (!value || value.schema_version !== SCHEMA_VERSION || !validAt(value.observed_at)) throw new TypeError('ApexRouteBinding invalid.');
  if (!Object.values(ApexRouteModel).includes(value.route_model) || !Object.values(EvidenceConfidence).includes(value.confidence)) throw new TypeError('ApexRouteBinding model invalid.');
  if (!Object.values(Handling).includes(value.ipv4_handling) || !Object.values(Handling).includes(value.ipv6_handling)) throw new TypeError('ApexRouteBinding handling invalid.');
  if (!Array.isArray(value.evidence) || !Array.isArray(value.local_listeners) || value.raw_config_retained !== false) throw new TypeError('ApexRouteBinding evidence invalid.');
  if (value.local_api_candidate.request_performed !== false) throw new TypeError('Unknown local API must not be requested.');
  if (value.route_model !== ApexRouteModel.UNKNOWN && !['bound_to_apex'].includes(value.system_proxy_binding.state) && !['bound_to_apex'].includes(value.http_proxy_binding.state) && !['bound_to_apex'].includes(value.socks_binding.state) && value.tun_binding.state !== TunBindingState.BOUND_TO_APEX) throw new TypeError('Resolved route model requires binding evidence.');
  return value;
}

function projectPathBindings(binding) {
  const at = binding.observed_at;
  const domestic = validateNetworkPathObservation({ schema_version: SCHEMA_VERSION, route_kind: NetworkPathKind.DOMESTIC_PATH, availability: binding.domestic_path_candidate.state === BindingState.READY ? 'available' : 'unavailable', evidence_state: binding.domestic_path_candidate.state === BindingState.READY ? PathEvidenceState.PROVEN : PathEvidenceState.CONTRACT_ONLY, observed_at: at, provider: 'apex-route-binding', evidence: clone(binding.domestic_path_candidate.evidence) });
  const foreign = validateNetworkPathObservation({ schema_version: SCHEMA_VERSION, route_kind: NetworkPathKind.FOREIGN_APEX_PATH, availability: binding.foreign_path_candidate.state === BindingState.READY ? 'available' : 'unavailable', evidence_state: binding.foreign_path_candidate.state === BindingState.READY ? PathEvidenceState.PROVEN : PathEvidenceState.UNKNOWN, observed_at: at, provider: 'apex-route-binding', evidence: clone(binding.foreign_path_candidate.evidence) });
  return { domestic, foreign };
}

function projectApexBindingViewModel(binding) {
  return { availability: binding.availability, route_model: binding.route_model, confidence: binding.confidence, runtime: Object.fromEntries(binding.component_map.components.map((x) => [x.name, x.running])), listener_count: binding.local_listeners.length, system_proxy: binding.system_proxy_binding.state, pac: binding.pac.present ? 'present' : 'absent', tun: binding.tun_proof?.proof_strength || binding.tun_binding.state, ipv4_handling: binding.ipv4_handling, ipv6_handling: binding.ipv6_handling, ipv6_bypass: binding.route_evidence.ipv6_bypass_candidate, domestic_path: binding.domestic_path_candidate.network_smoke_state || binding.domestic_path_candidate.state, foreign_path: binding.foreign_path_candidate.network_smoke_state || binding.foreign_path_candidate.state, safe_config_discovery: binding.config_discovery?.state || 'not_found', observed_at: binding.observed_at };
}

function projectApexRouteHistory(binding) {
  return { route_model: binding.route_model, confidence: binding.confidence, runtime_available: binding.availability === 'available', domestic_path: binding.domestic_path_candidate.state, foreign_path: binding.foreign_path_candidate.state, ipv4_handling: binding.ipv4_handling, ipv6_handling: binding.ipv6_handling };
}

function projectApexRouteDiagnostic(binding) {
  if (binding.availability !== 'available') return { code: 'APEX_RUNTIME_LOST', severity: 'warning', evidence: ['apex.runtime'] };
  if (binding.route_model === ApexRouteModel.UNKNOWN) return { code: 'APEX_ROUTE_UNKNOWN', severity: 'warning', evidence: ['apex.route_model'] };
  if (binding.foreign_path_candidate.state !== BindingState.READY) return { code: 'FOREIGN_PATH_UNAVAILABLE', severity: 'warning', evidence: ['apex.foreign_path'] };
  return null;
}

class DualPathProbeHarness {
  constructor({ bindingProvider, domesticExecutor, foreignExecutor }) { this.bindingProvider = bindingProvider; this.executors = { domestic: domesticExecutor, foreign: foreignExecutor }; }
  async execute(route, request) {
    if (!['domestic', 'foreign'].includes(route)) throw new TypeError('Probe route invalid.');
    const binding = await this.bindingProvider(); const candidate = route === 'domestic' ? binding.domestic_path_candidate : binding.foreign_path_candidate;
    if (candidate.state !== BindingState.READY || typeof this.executors[route] !== 'function') return { route, availability: 'unavailable', reason: 'ROUTE_BINDING_NOT_READY' };
    return { route, availability: 'available', result: await this.executors[route](clone(request), projectApexBindingViewModel(binding)) };
  }
}

class BoundDualEgressProvider {
  constructor({ route, harness, lookup }) { this.route = route; this.harness = harness; this.lookup = lookup; }
  async lookupRoute(route) { if (route !== this.route) throw new TypeError('provider route mismatch'); const out = await this.harness.execute(route, { kind: 'egress_identity' }); if (out.availability !== 'available') throw new Error('ROUTE_BINDING_NOT_READY'); return this.lookup(out.result, route); }
}

class BoundNetworkQualityProvider {
  constructor({ route, harness, sample }) { this.route = route; this.harness = harness; this.projectSample = sample; }
  async sampleQuality() { const out = await this.harness.execute(this.route, { kind: 'latency' }); if (out.availability !== 'available') throw new Error('ROUTE_BINDING_NOT_READY'); return this.projectSample(out.result, this.route); }
  async sample(route) { const normalized = route === NetworkPathKind.DOMESTIC_PATH ? 'domestic' : (route === NetworkPathKind.FOREIGN_APEX_PATH ? 'foreign' : route); if (normalized !== this.route) throw new TypeError('provider route mismatch'); return this.sampleQuality(); }
}

module.exports = { BindingState, BoundDualEgressProvider, BoundNetworkQualityProvider, DualPathProbeHarness, Handling, TunBindingState, buildApexLocalListenerObservations, buildApexRouteBinding, buildApexRuntimeComponentMap, parseProxyEndpoint, projectApexBindingViewModel, projectApexRouteDiagnostic, projectApexRouteHistory, projectPathBindings, sanitizeConfigEvidence, validateApexRouteBinding };
