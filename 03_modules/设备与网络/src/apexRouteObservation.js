'use strict';

const { SCHEMA_VERSION } = require('./contracts');

const ApexRouteModel = Object.freeze({ SYSTEM_PROXY: 'system_proxy', HTTP_PROXY: 'http_proxy', SOCKS: 'socks', TUN: 'tun', MIXED: 'mixed', UNKNOWN: 'unknown' });
const EvidenceConfidence = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

function validateApexRouteObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('apexRouteObservation must be an object.');
  if (value.schema_version !== SCHEMA_VERSION) throw new TypeError('apexRouteObservation.schema_version must be 0.1.');
  if (!Object.values(ApexRouteModel).includes(value.route_model)) throw new TypeError('apexRouteObservation.route_model is invalid.');
  if (!Object.values(EvidenceConfidence).includes(value.confidence)) throw new TypeError('apexRouteObservation.confidence is invalid.');
  if (!['available', 'unavailable'].includes(value.availability)) throw new TypeError('apexRouteObservation.availability is invalid.');
  if (!Number.isFinite(Date.parse(value.observed_at))) throw new TypeError('apexRouteObservation.observed_at is invalid.');
  if (!Array.isArray(value.processes) || !Array.isArray(value.local_listeners) || !Array.isArray(value.evidence)) throw new TypeError('apexRouteObservation arrays are required.');
  for (const process of value.processes) {
    if (!Number.isInteger(process.pid) || process.pid < 0 || !['Apex.exe', 'ApexCore.exe', 'ApexHelperService.exe'].includes(process.name)) throw new TypeError('apex process is invalid.');
    if (typeof process.executable_path_resolved !== 'boolean') throw new TypeError('apex executable path evidence is invalid.');
    if (!['ui_candidate', 'network_core_candidate', 'helper_service_candidate'].includes(process.role_candidate)) throw new TypeError('apex role candidate is invalid.');
  }
  if (!Array.isArray(value.inter_process_links)) throw new TypeError('apex process links are required.');
  for (const listener of value.local_listeners) {
    if (!['tcp', 'udp'].includes(listener.protocol) || !Number.isInteger(listener.port) || listener.port < 1 || listener.port > 65535 || listener.loopback !== true) throw new TypeError('apex listener is invalid.');
    if (!['local_api_candidate', 'local_proxy_candidate', 'unknown_local_listener'].includes(listener.purpose)) throw new TypeError('apex listener purpose is invalid.');
  }
  if (value.system_proxy.enabled === true && value.route_model === ApexRouteModel.UNKNOWN) throw new TypeError('enabled system proxy cannot remain unknown.');
  if (value.system_proxy.enabled !== true && value.route_model === ApexRouteModel.SYSTEM_PROXY) throw new TypeError('system proxy model requires enabled evidence.');
  if (value.api_probe_performed !== false) throw new TypeError('unknown localhost API must not be probed.');
  return value;
}

function buildApexRouteObservation(raw, observedAt = new Date().toISOString()) {
  const processes = (raw.processes || []).filter((item) => ['Apex.exe', 'ApexCore.exe', 'ApexHelperService.exe'].includes(item.name)).map((item) => ({
    pid: item.pid,
    parent_pid: Number.isInteger(item.parentPid) ? item.parentPid : null,
    name: item.name,
    executable_path_resolved: Boolean(item.executableDirectory),
    role_candidate: item.name === 'Apex.exe' ? 'ui_candidate' : (item.name === 'ApexCore.exe' ? 'network_core_candidate' : 'helper_service_candidate'),
    role_confidence: item.name === 'ApexCore.exe' && (raw.connections || []).some((connection) => connection.pid === item.pid && !connection.loopback) ? EvidenceConfidence.MEDIUM : EvidenceConfidence.LOW
  })).sort((a, b) => a.name.localeCompare(b.name));
  const localListeners = (raw.listeners || []).filter((item) => item.loopback === true && processes.some((process) => process.pid === item.pid)).map((item) => ({
    protocol: item.protocol, address: item.address, port: item.port, pid: item.pid, loopback: true,
    purpose: item.pid === processes.find((process) => process.name === 'Apex.exe')?.pid ? 'local_api_candidate' : 'local_proxy_candidate'
  })).sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
  const proxy = raw.systemProxy || { enabled: false, server: null, pac_url_present: false, auto_detect: false };
  const owners = new Map(localListeners.map((listener) => [listener.port, listener.pid]));
  const interProcessLinks = [...new Map((raw.connections || []).flatMap((connection) => {
    const to = connection.loopback ? owners.get(connection.remotePort) : null;
    return to && to !== connection.pid ? [[`${connection.pid}:${to}`, { from_pid: connection.pid, to_pid: to, kind: 'loopback_connection' }]] : [];
  })).values()].sort((a, b) => a.from_pid - b.from_pid || a.to_pid - b.to_pid);
  const directories = new Set((raw.processes || []).filter((item) => item.executableDirectory).map((item) => item.executableDirectory.toLowerCase()));
  let routeModel = ApexRouteModel.UNKNOWN;
  let confidence = EvidenceConfidence.LOW;
  if (proxy.enabled === true) { routeModel = ApexRouteModel.SYSTEM_PROXY; confidence = EvidenceConfidence.HIGH; }
  const evidence = [];
  if (processes.some((item) => item.name === 'Apex.exe')) evidence.push('process:Apex.exe');
  if (processes.some((item) => item.name === 'ApexCore.exe')) evidence.push('process:ApexCore.exe');
  if (processes.some((item) => item.name === 'ApexHelperService.exe')) evidence.push('process:ApexHelperService.exe');
  if (localListeners.length) evidence.push('loopback_listener');
  evidence.push(proxy.enabled ? 'system_proxy_enabled' : 'system_proxy_disabled');
  if (proxy.pac_url_present) evidence.push('pac_configured');
  if ((raw.virtualAdapters || []).length) evidence.push('virtual_adapter_candidate');
  if ((raw.defaultRoutes || []).length) evidence.push('default_route_observed');
  return validateApexRouteObservation({
    schema_version: SCHEMA_VERSION, availability: processes.length ? 'available' : 'unavailable', observed_at: observedAt,
    route_model: routeModel, confidence, processes, local_listeners: localListeners, inter_process_links: interProcessLinks,
    same_executable_directory: processes.length > 1 && directories.size === 1,
    system_proxy: { enabled: proxy.enabled === true, server_present: Boolean(proxy.server), pac_url_present: proxy.pac_url_present === true, auto_detect: proxy.auto_detect === true },
    tun: { availability: raw.adapterAvailability || 'unavailable', virtual_adapter_candidates: (raw.virtualAdapters || []).length },
    routes: {
      availability: raw.routeAvailability || 'unavailable',
      default_route_count: (raw.defaultRoutes || []).length,
      default_routes: (raw.defaultRoutes || []).slice(0, 8).map((route) => ({
        family: route.family || 'ipv4',
        interface_index: Number.isInteger(route.interface_index) ? route.interface_index : null,
        next_hop_masked: route.next_hop_masked || null,
        route_metric: Number.isFinite(route.route_metric) ? route.route_metric : null,
        route_type: route.route_type || null
      })),
      obvious_apex_route_change: false
    },
    protocol_evidence: { http: false, socks: false }, api_probe_performed: false,
    split_routing_location: routeModel === ApexRouteModel.UNKNOWN ? 'unknown' : 'system_proxy', evidence
  });
}

module.exports = { ApexRouteModel, EvidenceConfidence, buildApexRouteObservation, validateApexRouteObservation };
