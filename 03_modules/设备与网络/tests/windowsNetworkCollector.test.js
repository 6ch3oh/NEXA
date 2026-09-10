'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WindowsNetworkCollector,
  WindowsNetworkCollectorAdapter,
  aggregateCumulative,
  buildHomeFooterViewModel,
  calculateAggregateRates,
  parseNetworkInterfaceJson,
  queryNetworkInterfaces,
  runNetworkPowerShell,
  selectActiveInterfaces,
  validateNetworkMetrics
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

function networkEntry({
  id = 'interface-1',
  name = 'Ethernet',
  description = 'Physical Ethernet Adapter',
  status = 'Up',
  type = 'Ethernet',
  bytesSent = 1000,
  bytesReceived = 2000,
  countersAvailable = true,
  gatewayPresent = true,
  dnsPresent = true,
  addressPresent = true
} = {}) {
  return {
    id,
    name,
    description,
    status,
    type,
    category: type.toLowerCase().includes('wireless') ? 'wireless' : type.toLowerCase(),
    bytesSent,
    bytesReceived,
    gatewayPresent,
    dnsPresent,
    addressPresent,
    countersAvailable
  };
}

function sequence(...values) {
  let index = 0;
  return async () => {
    const value = values[Math.min(index++, values.length - 1)];
    if (value instanceof Error) throw value;
    return value;
  };
}

function clockSequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function deterministicCollector(before, after, overrides = {}) {
  const start = Date.parse('2026-08-10T04:00:00.000Z');
  return new WindowsNetworkCollector({
    platform: 'win32',
    sampleIntervalMs: 0,
    interfaceProvider: sequence(before, after),
    sleep: async () => {},
    nowMs: clockSequence(start, start + 1000),
    ...overrides
  });
}

test('active interface selection recognizes an up physical data interface', () => {
  const active = selectActiveInterfaces([
    networkEntry(),
    networkEntry({ id: 'loop', name: 'Loopback', type: 'Loopback', description: 'Loopback' })
  ]);
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'Ethernet');
});

test('disconnected interfaces are not active', () => {
  const active = selectActiveInterfaces([networkEntry({ status: 'Down' })]);
  assert.deepEqual(active, []);
});

test('no interfaces maps to offline with unavailable counters', async () => {
  const adapter = new WindowsNetworkCollectorAdapter(deterministicCollector([], []));
  const network = await adapter.collectNetworkMetrics();
  assert.equal(network.availability, 'offline');
  assert.equal(network.interface_summary.active_count, 0);
  assert.equal(network.traffic.upload_rate.availability, 'unavailable');
});

test('multiple active physical interfaces are deterministic without a fake primary', async () => {
  const entries = [
    networkEntry({ id: 'b', name: 'Wi-Fi', type: 'Wireless80211' }),
    networkEntry({ id: 'a', name: 'Ethernet' })
  ];
  const network = await new WindowsNetworkCollectorAdapter(deterministicCollector(entries, entries)).collectNetworkMetrics();
  assert.equal(network.interface_summary.active_count, 2);
  assert.equal(network.interface_summary.primary, null);
});

test('cumulative sent and received aggregate active interfaces', () => {
  const active = [
    networkEntry({ id: 'a', bytesSent: 100, bytesReceived: 300 }),
    networkEntry({ id: 'b', bytesSent: 200, bytesReceived: 400 })
  ];
  assert.equal(aggregateCumulative(active, 'bytesSent').value, 300);
  assert.equal(aggregateCumulative(active, 'bytesReceived').value, 700);
});

test('cumulative counter zero is an available zero', () => {
  const active = [networkEntry({ bytesSent: 0, bytesReceived: 0 })];
  assert.deepEqual(aggregateCumulative(active, 'bytesSent'), { availability: 'available', value: 0, reason: null });
  assert.deepEqual(aggregateCumulative(active, 'bytesReceived'), { availability: 'available', value: 0, reason: null });
});

test('negative or invalid counters are rejected safely', () => {
  const parsed = parseNetworkInterfaceJson(JSON.stringify({
    InterfaceId: 'a', Name: 'Ethernet', Description: 'Adapter', Status: 'Up', Type: 'Ethernet',
    BytesSent: '-1', BytesReceived: 'not-a-number'
  }));
  assert.equal(parsed[0].countersAvailable, false);
  assert.equal(aggregateCumulative(parsed, 'bytesSent').availability, 'unavailable');
});

test('upload rate is calculated from sent counter delta', () => {
  const before = [networkEntry({ bytesSent: 1000, bytesReceived: 2000 })];
  const after = [networkEntry({ bytesSent: 1600, bytesReceived: 3000 })];
  assert.equal(calculateAggregateRates(before, after, 1000).uploadRate.value, 600);
});

test('download rate is calculated from received counter delta', () => {
  const before = [networkEntry({ bytesSent: 1000, bytesReceived: 2000 })];
  const after = [networkEntry({ bytesSent: 1600, bytesReceived: 3000 })];
  assert.equal(calculateAggregateRates(before, after, 1000).downloadRate.value, 1000);
});

test('zero byte rate remains available', () => {
  const before = [networkEntry()];
  const after = [networkEntry()];
  const rates = calculateAggregateRates(before, after, 1000);
  assert.equal(rates.uploadRate.availability, 'available');
  assert.equal(rates.uploadRate.value, 0);
  assert.equal(rates.downloadRate.value, 0);
});

test('counter reset never produces a negative rate', () => {
  const before = [networkEntry({ bytesSent: 5000, bytesReceived: 6000 })];
  const after = [networkEntry({ bytesSent: 100, bytesReceived: 200 })];
  const rates = calculateAggregateRates(before, after, 1000);
  assert.equal(rates.uploadRate.availability, 'unavailable');
  assert.equal(rates.downloadRate.availability, 'unavailable');
  assert.equal(rates.uploadRate.value, null);
});

test('zero elapsed time never produces Infinity', () => {
  const rates = calculateAggregateRates([networkEntry()], [networkEntry()], 0);
  assert.equal(rates.uploadRate.availability, 'unavailable');
  assert.equal(rates.downloadRate.value, null);
});

test('invalid rate input never produces NaN', () => {
  const invalid = networkEntry({ bytesSent: NaN, bytesReceived: Infinity, countersAvailable: true });
  const rates = calculateAggregateRates([invalid], [invalid], 1000);
  assert.equal(rates.uploadRate.availability, 'unavailable');
  assert.equal(rates.downloadRate.availability, 'unavailable');
});

test('one interface counter failure does not discard another valid interface', () => {
  const before = [
    networkEntry({ id: 'good', bytesSent: 100, bytesReceived: 200 }),
    networkEntry({ id: 'bad', bytesSent: 100, bytesReceived: 200, countersAvailable: false })
  ];
  const after = [
    networkEntry({ id: 'good', bytesSent: 200, bytesReceived: 400 }),
    networkEntry({ id: 'bad', bytesSent: null, bytesReceived: null, countersAvailable: false })
  ];
  const rates = calculateAggregateRates(before, after, 1000);
  assert.equal(rates.uploadRate.value, 100);
  assert.equal(rates.downloadRate.value, 200);
  assert.equal(aggregateCumulative(after, 'bytesSent').value, 200);
});

test('counter provider failure degrades the complete network sample', async () => {
  const failure = new Error('fixture provider failure');
  const collector = deterministicCollector(failure, failure);
  const network = await new WindowsNetworkCollectorAdapter(collector).collectNetworkMetrics();
  assert.equal(network.availability, 'unknown');
  assert.equal(network.interface_summary.active_count, 0);
  assert.equal(network.traffic.cumulative_sent.availability, 'unavailable');
});

test('Collector to Adapter returns a contract-compatible NetworkMetrics record', async () => {
  const before = [networkEntry({ bytesSent: 1000, bytesReceived: 2000 })];
  const after = [networkEntry({ bytesSent: 1500, bytesReceived: 2750 })];
  const network = await new WindowsNetworkCollectorAdapter(deterministicCollector(before, after)).collectNetworkMetrics();
  assert.equal(validateNetworkMetrics(network), network);
  assert.equal(network.metadata.provider.id, 'windows-network');
});

test('collector preserves safe interface status and description for the product UI', async () => {
  const entries = [networkEntry({ description: 'Physical Ethernet Adapter', status: 'Up' })];
  const raw = await deterministicCollector(entries, entries).collectRaw();
  assert.equal(raw.interfaces.active[0].description, 'Physical Ethernet Adapter');
  assert.equal(raw.interfaces.active[0].status, 'Up');

  const network = await new WindowsNetworkCollectorAdapter(
    deterministicCollector(entries, entries)
  ).collectNetworkMetrics();
  assert.equal(network.interfaces[0].description, 'Physical Ethernet Adapter');
  assert.equal(network.interfaces[0].status, 'Up');
  assert.equal(network.interfaces[0].gateway_present, true);
  assert.equal(network.interfaces[0].dns_present, true);
  assert.equal(network.interface_summary.address_present, true);
});

test('network JSON exposes only gateway, DNS and address presence booleans', () => {
  const parsed = parseNetworkInterfaceJson(JSON.stringify({
    InterfaceId: 'a', Name: 'Ethernet', Description: 'Adapter', Status: 'Up', Type: 'Ethernet',
    BytesSent: '0', BytesReceived: '0', GatewayPresent: true, DnsPresent: false, AddressPresent: true
  }));
  assert.equal(parsed[0].gatewayPresent, true);
  assert.equal(parsed[0].dnsPresent, false);
  assert.equal(parsed[0].addressPresent, true);
  assert.equal(Object.hasOwn(parsed[0], 'gatewayAddresses'), false);
  assert.equal(Object.hasOwn(parsed[0], 'dnsAddresses'), false);
});

test('Adapter preserves cumulative and rate units in NetworkMetrics', async () => {
  const before = [networkEntry({ bytesSent: 1000, bytesReceived: 2000 })];
  const after = [networkEntry({ bytesSent: 1500, bytesReceived: 2750 })];
  const network = await new WindowsNetworkCollectorAdapter(deterministicCollector(before, after)).collectNetworkMetrics();
  assert.equal(network.traffic.upload_rate.current.unit, 'bytes_per_second');
  assert.equal(network.traffic.download_rate.current.unit, 'bytes_per_second');
  assert.equal(network.traffic.cumulative_sent.current.unit, 'bytes');
  assert.equal(network.traffic.cumulative_received.current.unit, 'bytes');
});

test('NetworkMetrics flows through HomeFooterViewModel with interface summary', async () => {
  const before = [networkEntry({ bytesSent: 0, bytesReceived: 0 })];
  const after = [networkEntry({ bytesSent: 1_000_000, bytesReceived: 2_000_000 })];
  const snapshot = loadScenario('healthy_device');
  snapshot.network = await new WindowsNetworkCollectorAdapter(deterministicCollector(before, after)).collectNetworkMetrics();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.network.state, 'online');
  assert.equal(viewModel.network.active_interface_count, 1);
  assert.equal(viewModel.network.upload.text, '8 Mbps');
  assert.equal(viewModel.network.download.text, '16 Mbps');
});

test('latency remains unavailable and never displays zero milliseconds', async () => {
  const entries = [networkEntry()];
  const snapshot = loadScenario('healthy_device');
  snapshot.network = await new WindowsNetworkCollectorAdapter(deterministicCollector(entries, entries)).collectNetworkMetrics();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(snapshot.network.latency.availability, 'unavailable');
  assert.equal(viewModel.network.latency.value, null);
  assert.equal(viewModel.network.latency.text, '暂不可用');
});

test('network collection timestamps are fresh and deterministic', async () => {
  const entries = [networkEntry()];
  const network = await new WindowsNetworkCollectorAdapter(deterministicCollector(entries, entries)).collectNetworkMetrics();
  assert.equal(network.metadata.collected_at, '2026-08-10T04:00:01.000Z');
  assert.equal(network.metadata.freshness.state, 'fresh');
  assert.equal(network.metadata.freshness.age_ms, 0);
});

test('PowerShell network query is bounded, structured, and privacy-minimal', async () => {
  let observed;
  await runNetworkPowerShell({
    executable: 'fixture-powershell.exe',
    timeoutMs: 4321,
    execFileImpl(executable, args, options, callback) {
      observed = { executable, args, options };
      callback(null, '[]', '');
    }
  });
  assert.equal(observed.executable, 'fixture-powershell.exe');
  assert.ok(observed.args.includes('-NoProfile'));
  assert.ok(observed.args.includes('-NonInteractive'));
  assert.match(observed.args.at(-1), /Console\]::OutputEncoding/);
  assert.match(observed.args.at(-1), /UTF8Encoding/);
  assert.match(observed.args.at(-1), /NetworkInterface/);
  assert.match(observed.args.at(-1), /GetIPProperties/);
  assert.match(observed.args.at(-1), /GatewayPresent/);
  assert.match(observed.args.at(-1), /DnsPresent/);
  assert.match(observed.args.at(-1), /ConvertTo-Json/);
  assert.doesNotMatch(observed.args.at(-1), /IPAddress|PhysicalAddress|SSID|\.Address\b|ToString\(\).*Addresses/);
  assert.equal(observed.options.timeout, 4321);
});

test('network JSON and stderr failures are rejected safely', async () => {
  assert.throws(() => parseNetworkInterfaceJson('{broken'), /invalid JSON/);
  await assert.rejects(
    queryNetworkInterfaces({ runCommand: async () => ({ stdout: '[]', stderr: 'fixture error' }) }),
    /stderr/
  );
});

test('Radmin VPN is classified as a virtual interface', () => {
  const rows = parseNetworkInterfaceJson(JSON.stringify([{
    InterfaceId: '{RADMIN}',
    InterfaceIndex: 20,
    Name: 'Radmin VPN',
    Description: 'Famatech Radmin VPN Ethernet Adapter',
    Status: 'Up',
    Type: 'Ethernet',
    BytesSent: '10',
    BytesReceived: '20',
    GatewayPresent: true,
    DnsPresent: true,
    AddressPresent: true
  }]));
  assert.equal(rows[0].virtual, true);
});
