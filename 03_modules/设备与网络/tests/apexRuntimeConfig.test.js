'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  ApexRouteContinuityMonitor,
  ApexRuntimeConfigDiscovery,
  ProofStrength,
  WindowsApexRouteCollector,
  buildApexProxyPortProofs,
  buildApexRouteBinding,
  buildApexTunProof,
  parseProxyEndpoint,
  parseRoutePrint,
  projectApexBindingViewModel,
  projectApexRouteHistory,
  projectApexRuntimeConfig,
  projectSafeApexProcessLaunch
} = require('../src');

const AT = '2026-08-13T04:00:00.000Z';
const listeners = [{ protocol: 'tcp', local_address: '127.0.0.1', local_port: 7890, component_owner: 'ApexCore.exe' }];
const route = (family = 'ipv4', extra = {}) => ({ family, destination: family === 'ipv4' ? '0.0.0.0/0' : '::/0', default: true, split_candidate: false, interface_index: 5, metric: 20, ...extra });
const raw = (projection = null, extra = {}) => ({
  processes: [{ name: 'Apex.exe', pid: 10 }, { name: 'ApexCore.exe', pid: 20 }],
  listeners: projection ? [{ protocol: 'tcp', address: '127.0.0.1', port: 7890, pid: 20, loopback: true }] : [],
  connections: [], systemProxy: { enabled: false, server: null, pac_url_present: false, bypass_present: false },
  adapterAvailability: 'available', routeAvailability: 'available', adapters: [],
  routes: { ipv4: [route()], ipv6: [route('ipv6')] }, runtimeConfigProjection: projection,
  configDiscovery: { state: projection ? 'ready' : 'not_found' }, ...extra
});

const launchCases = [
  ['allow config flag', 'Apex.exe --config runtime.yaml', (x) => x.allowed_flags.includes('--config')],
  ['allow short config flag', 'Apex.exe -c runtime.yaml', (x) => x.allowed_flags.includes('-c')],
  ['allow proxy flag', 'Apex.exe --proxy', (x) => x.allowed_flags.includes('--proxy')],
  ['allow tun flag', 'Apex.exe --tun', (x) => x.allowed_flags.includes('--tun')],
  ['drop unknown flag', 'Apex.exe --mystery abc', (x) => !x.allowed_flags.includes('--mystery')],
  ['hide config path', 'Apex.exe --config D:\\private\\runtime.yaml', (x) => x.config_path_resolved === false],
  ['keep safe config basename', 'Apex.exe --config D:\\private\\runtime.yaml', (x) => x.config_file_name === 'runtime.yaml'],
  ['drop sensitive filename', 'Apex.exe --config token.yaml', (x) => x.config_file_name === null],
  ['mark token argument', 'Apex.exe --token abc', (x) => x.sensitive_argument_marker_present],
  ['never retain command line', 'Apex.exe --password abc', (x) => x.raw_command_line_retained === false]
];
for (const [name, commandLine, check] of launchCases) test(`launch projection: ${name}`, () => assert.equal(Boolean(check(projectSafeApexProcessLaunch({ name: 'Apex.exe', pid: 7, commandLine }))), true));

function assertCompletesPromptly(operation, maximumMs = 1000) {
  const startedAt = performance.now();
  const result = operation();
  assert.ok(performance.now() - startedAt < maximumMs, `parser exceeded ${maximumMs} ms`);
  return result;
}

test('proxy endpoint parser preserves supported forms without backtracking regexes', () => {
  assert.deepEqual(parseProxyEndpoint('http=127.0.0.1:7890; SOCKS=socks5://[::1]:7891'), [
    { protocol_hint: 'http', address: '127.0.0.1', port: 7890 },
    { protocol_hint: 'socks', address: '::1', port: 7891 }
  ]);
});

test('proxy endpoint parser rejects oversized hostile input promptly', () => {
  assert.deepEqual(assertCompletesPromptly(() => parseProxyEndpoint('http='.repeat(300000))), []);
});

test('command-line and config parsers reject oversized hostile input promptly', () => {
  const launch = assertCompletesPromptly(() => projectSafeApexProcessLaunch({ name: 'Apex.exe', pid: 7, commandLine: '"'.repeat(100000) }));
  const config = assertCompletesPromptly(() => projectApexRuntimeConfig('x'.repeat(2 * 1024 * 1024)));
  assert.equal(launch.availability, 'unavailable');
  assert.equal(config.availability, 'unavailable');
});

test('route parser rejects oversized hostile input promptly', () => {
  assert.deepEqual(assertCompletesPromptly(() => parseRoutePrint(`1 1 ::/0 ${'x'.repeat(2 * 1024 * 1024)}`, 'ipv6')), { adapters: [], routes: [] });
});

const configCases = [
  ['HTTP port', 'http-port: 7890', (x) => x.ports.http_port === 7890],
  ['SOCKS port', 'socks-port: 7891', (x) => x.ports.socks_port === 7891],
  ['mixed port', 'mixed-port: 7892', (x) => x.ports.mixed_port === 7892],
  ['controller port', 'external-controller: 127.0.0.1:9090', (x) => x.ports.controller_port === 9090],
  ['DNS port', 'dns-listen: 127.0.0.1:1053', (x) => x.ports.dns_port === 1053],
  ['route mode', 'route-mode: rule', (x) => x.route_mode === 'rule'],
  ['loopback binding', 'bind-address: 127.0.0.1', (x) => x.bind_scope === 'loopback'],
  ['wildcard binding', 'bind-address: 0.0.0.0', (x) => x.bind_scope === 'wildcard'],
  ['IPv6 enabled', 'ipv6: true', (x) => x.ipv6_enabled === true],
  ['system proxy disabled', 'system-proxy: false', (x) => x.system_proxy_enabled === false],
  ['TUN enabled', 'tun.enable: true', (x) => x.tun.enabled === true],
  ['TUN interface', 'tun.interface-name: APEX TUN', (x) => x.tun.interface_name === 'APEX TUN'],
  ['TUN auto route', 'tun.auto-route: true', (x) => x.tun.auto_route === true],
  ['TUN strict route', 'tun.strict-route: false', (x) => x.tun.strict_route === false],
  ['nested JSON', { tun: { enabled: true }, 'socks-port': 7890 }, (x) => x.tun.enabled && x.ports.socks_port === 7890],
  ['drop token', 'token: DO_NOT_KEEP\nsocks-port: 7890', (x) => !JSON.stringify(x).includes('DO_NOT_KEEP')],
  ['drop server identity', 'server: private.example\nsocks-port: 7890', (x) => !JSON.stringify(x).includes('private.example')],
  ['never retain raw config', 'socks-port: 7890', (x) => x.raw_config_retained === false]
];
for (const [name, input, check] of configCases) test(`runtime config: ${name}`, () => assert.equal(Boolean(check(projectApexRuntimeConfig(input))), true));

test('port proof is proven only with configured role and owned listener', () => assert.equal(buildApexProxyPortProofs({ projection: projectApexRuntimeConfig('socks-port: 7890'), listeners }).socks.proof_strength, ProofStrength.PROVEN));
test('configured port without listener is strong', () => assert.equal(buildApexProxyPortProofs({ projection: projectApexRuntimeConfig('socks-port: 7890'), listeners: [] }).socks.proof_strength, ProofStrength.STRONG));
test('listener without configured role is candidate', () => assert.equal(buildApexProxyPortProofs({ projection: null, listeners }).socks.proof_strength, ProofStrength.CANDIDATE));
test('missing config and listener is not found', () => assert.equal(buildApexProxyPortProofs({ projection: null, listeners: [] }).http.proof_strength, ProofStrength.NOT_FOUND));
test('controller proof does not become route proof', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('external-controller: 127.0.0.1:7890')), AT).route_model, 'unknown'));
test('DNS proof does not become route proof', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('dns-listen: 127.0.0.1:7890')), AT).route_model, 'unknown'));
test('unknown config field is ignored', () => assert.deepEqual(projectApexRuntimeConfig('unrelated-private-field: value').fields_observed, []));

const adapter = { interface_index: 8, name: 'APEX TUN', description: 'APEX TUN', virtual: true, apex_related: true };
test('TUN config alone is candidate', () => assert.equal(buildApexTunProof({ projection: projectApexRuntimeConfig('tun.enable: true'), adapters: [], routes: { ipv4: [], ipv6: [] } }).proof_strength, ProofStrength.CANDIDATE));
test('TUN config and adapter is strong', () => assert.equal(buildApexTunProof({ projection: projectApexRuntimeConfig('tun.enable: true\ntun.interface-name: APEX TUN'), adapters: [adapter], routes: { ipv4: [], ipv6: [] } }).proof_strength, ProofStrength.STRONG));
test('TUN config adapter and route is proven', () => assert.equal(buildApexTunProof({ projection: projectApexRuntimeConfig('tun.enable: true\ntun.interface-name: APEX TUN'), adapters: [adapter], routes: { ipv4: [route('ipv4', { interface_index: 8 })], ipv6: [] } }).proof_strength, ProofStrength.PROVEN));
test('proven TUN selects TUN route model', () => { const projection = projectApexRuntimeConfig('tun.enable: true\ntun.interface-name: APEX TUN'); const x = buildApexRouteBinding(raw(projection, { listeners: [], adapters: [adapter], routes: { ipv4: [route('ipv4', { interface_index: 8 })], ipv6: [] } }), AT); assert.equal(x.route_model, 'tun'); });

const modelCases = [
  ['HTTP', 'http-port: 7890', 'http_proxy'],
  ['SOCKS', 'socks-port: 7890', 'socks'],
  ['mixed', 'mixed-port: 7890', 'mixed']
];
for (const [name, config, expected] of modelCases) test(`${name} proof selects route model`, () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig(config)), AT).route_model, expected));
test('explicit proxy proof makes foreign path smoke-ready', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT).foreign_path_candidate.network_smoke_state, 'ready_for_network_smoke'));
test('proven direct path makes domestic path smoke-ready', () => assert.equal(buildApexRouteBinding(raw(null), AT).domestic_path_candidate.network_smoke_state, 'ready_for_network_smoke'));
test('unknown route remains low confidence', () => assert.equal(buildApexRouteBinding(raw(null, { routes: { ipv4: [], ipv6: [] } }), AT).confidence, 'low'));
test('configured unbound endpoint gives medium confidence', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890'), { listeners: [] }), AT).confidence, 'medium'));
test('proven endpoint gives high confidence', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT).confidence, 'high'));
test('unproven endpoint remains UNKNOWN route model', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890'), { listeners: [] }), AT).route_model, 'unknown'));
test('direct IPv4 route stays independently direct', () => assert.equal(buildApexRouteBinding(raw(null), AT).ipv4_handling, 'direct'));
test('disabled system proxy does not negate proven local proxy', () => { const x = buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT); assert.equal(x.system_proxy_binding.state, 'disabled'); assert.equal(x.route_model, 'socks'); });
test('both proven bindings make dual path proof ready', () => { const x = buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT); assert.equal(x.domestic_path_candidate.network_smoke_state, 'ready_for_network_smoke'); assert.equal(x.foreign_path_candidate.network_smoke_state, 'ready_for_network_smoke'); });
test('IPv6 disabled in config is explicit bypass evidence', () => assert.equal(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890\nipv6: false')), AT).route_evidence.ipv6_bypass_candidate, true));
test('Device Center projection exposes no proxy port', () => assert.equal(JSON.stringify(projectApexBindingViewModel(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT))).includes('7890'), false));
test('Device Center projection exposes safe discovery state', () => assert.equal(projectApexBindingViewModel(buildApexRouteBinding(raw(null), AT)).safe_config_discovery, 'not_found'));
test('History projection excludes ports config and command line', () => { const history = projectApexRouteHistory(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT)); assert.doesNotMatch(JSON.stringify(history), /7890|config|command|listener/); });
test('binding contract records zero localhost requests', () => assert.equal(buildApexRouteBinding(raw(null), AT).local_api_candidate.request_performed, false));

test('always unknown route emits no continuity anomaly', () => { const monitor = new ApexRouteContinuityMonitor(); assert.equal(monitor.observe(buildApexRouteBinding(raw(null, { routes: { ipv4: [], ipv6: [] } }), AT)), null); });
test('previously ready foreign route disappearance emits route-lost', () => { const monitor = new ApexRouteContinuityMonitor(); monitor.observe(buildApexRouteBinding(raw(projectApexRuntimeConfig('socks-port: 7890')), AT)); assert.equal(monitor.observe(buildApexRouteBinding(raw(null, { routes: { ipv4: [], ipv6: [] } }), AT)).code, 'FOREIGN_ROUTE_LOST'); });
test('no network endpoint exists in runtime config module API', () => assert.doesNotMatch(JSON.stringify(projectApexRuntimeConfig('socks-port: 7890')), /https?:\/\//));

test('discovery constrains depth to at most two', () => assert.throws(() => new ApexRuntimeConfigDiscovery({ maxDepth: 3 }), RangeError));
test('discovery constrains file size to one MiB', () => assert.throws(() => new ApexRuntimeConfigDiscovery({ maxBytes: 1024 * 1024 + 1 }), RangeError));
test('empty discovery is explicit not found', async () => { const x = await new ApexRuntimeConfigDiscovery().discover(); assert.equal(x.state, 'not_found'); });
test('discovery reads a safe depth-two config projection', async (t) => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-apex-')); t.after(() => fs.rm(root, { recursive: true, force: true })); await fs.mkdir(path.join(root, 'runtime')); await fs.writeFile(path.join(root, 'runtime', 'safe.yaml'), 'socks-port: 7890'); const x = await new ApexRuntimeConfigDiscovery().discover({ executableDirectories: [root] }); assert.equal(x.projection.ports.socks_port, 7890); });
test('discovery ignores sensitive filename', async (t) => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-apex-')); t.after(() => fs.rm(root, { recursive: true, force: true })); await fs.writeFile(path.join(root, 'token.yaml'), 'socks-port: 7890'); const x = await new ApexRuntimeConfigDiscovery().discover({ executableDirectories: [root] }); assert.equal(x.state, 'not_found'); });
test('discovery ignores oversized candidate', async (t) => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-apex-')); t.after(() => fs.rm(root, { recursive: true, force: true })); await fs.writeFile(path.join(root, 'safe.yaml'), 'x'.repeat(1025)); const x = await new ApexRuntimeConfigDiscovery({ maxBytes: 1024 }).discover({ executableDirectories: [root] }); assert.equal(x.state, 'not_found'); });

test('injected Windows collector remains hermetic and projects config', async () => {
  const empty = async () => ({ stdout: '' });
  const collector = new WindowsApexRouteCollector({ platform: 'win32', now: () => new Date(AT),
    processProvider: async () => ({ stdout: '{"Items":[{"Name":"ApexCore.exe","Pid":20,"Path":"D:\\\\ApexCore.exe"}],"RuntimeEvidence":{}}' }),
    netstatProvider: empty, proxyProvider: async () => ({ stdout: '{"Enabled":false}' }), adapterProvider: empty,
    routeProvider: empty, ipv6RouteProvider: empty, serviceProvider: empty,
    launchProvider: async () => ({ stdout: '{"Items":[]}' }),
    configDiscovery: { discover: async () => ({ state: 'ready', projection: projectApexRuntimeConfig('socks-port: 7890'), raw_content_retained: false }) }
  });
  const x = await collector.collectRaw(); assert.equal(x.runtimeConfigProjection.ports.socks_port, 7890); assert.equal(x.launchProjectionAvailability, 'unavailable');
});
