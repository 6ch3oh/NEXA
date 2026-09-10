'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DeviceNetworkSnapshotAggregator,
  WindowsNetworkCollector,
  WindowsNetworkCollectorAdapter,
  buildHomeFooterViewModel,
  buildNetworkSamplePairScript,
  parseNetworkSamplePairJson,
  queryNetworkInterfacePair,
  runNetworkSamplePairPowerShell,
  validateDeviceNetworkSnapshot,
  validateNetworkMetrics
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

function rawEntry({
  id = 'interface-1',
  name = 'Ethernet',
  description = 'Physical Ethernet Adapter',
  status = 'Up',
  type = 'Ethernet',
  sent = '1000',
  received = '2000',
  gatewayPresent = true,
  dnsPresent = true,
  addressPresent = true
} = {}) {
  return {
    InterfaceId: id,
    Name: name,
    Description: description,
    Status: status,
    Type: type,
    BytesSent: sent,
    BytesReceived: received,
    GatewayPresent: gatewayPresent,
    DnsPresent: dnsPresent,
    AddressPresent: addressPresent
  };
}

function pairObject({
  sample1Entries = [rawEntry()],
  sample2Entries = [rawEntry({ sent: '1500', received: '2750' })],
  sample1At = 1_000,
  sample2At = 2_000,
  sample1Available = true,
  sample2Available = true
} = {}) {
  return {
    Sample1: { Available: sample1Available, CapturedAtUnixMs: sample1At, Interfaces: sample1Entries },
    Sample2: { Available: sample2Available, CapturedAtUnixMs: sample2At, Interfaces: sample2Entries }
  };
}

function pairJson(options) {
  return JSON.stringify(pairObject(options));
}

function pairProvider(options) {
  const parsed = parseNetworkSamplePairJson(pairJson(options));
  return async () => parsed;
}

function collectorFromPair(options, overrides = {}) {
  return new WindowsNetworkCollector({
    platform: 'win32',
    sampleIntervalMs: 500,
    samplePairProvider: pairProvider(options),
    sleep: async () => { throw new Error('Node sleep must not run on the pair-provider path.'); },
    ...overrides
  });
}

function hasInvalidNumber(value, predicate) {
  if (typeof value === 'number') return predicate(value);
  if (Array.isArray(value)) return value.some((item) => hasInvalidNumber(item, predicate));
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasInvalidNumber(item, predicate));
  return false;
}

test('single-process provider returns two independently timestamped samples in one invocation', async () => {
  let calls = 0;
  const pair = await queryNetworkInterfacePair({
    sampleIntervalMs: 500,
    runCommand: async () => {
      calls += 1;
      return { stdout: pairJson(), stderr: '' };
    }
  });
  assert.equal(calls, 1);
  assert.equal(pair.sample1.capturedAtMs, 1000);
  assert.equal(pair.sample2.capturedAtMs, 2000);
  assert.notDeepEqual(pair.sample1.entries, pair.sample2.entries);
});

test('configured sampling interval is embedded in the bounded single process command', async () => {
  let observed;
  await runNetworkSamplePairPowerShell({
    executable: 'fixture-powershell.exe',
    sampleIntervalMs: 321,
    execFileImpl(executable, args, options, callback) {
      observed = { executable, args, options };
      callback(null, pairJson(), '');
    }
  });
  assert.equal(observed.executable, 'fixture-powershell.exe');
  assert.match(observed.args.at(-1), /\$sampleIntervalMs = 321/);
  assert.match(observed.args.at(-1), /Start-Sleep -Milliseconds \$sampleIntervalMs/);
  assert.equal(observed.options.timeout, 5321);
});

test('rate calculation semantics are unchanged on the sample-pair path', async () => {
  const raw = await collectorFromPair({}).collectRaw();
  assert.equal(raw.traffic.uploadRate.value, 500);
  assert.equal(raw.traffic.downloadRate.value, 750);
});

test('single-process pair JSON parses into normalized interface samples', () => {
  const pair = parseNetworkSamplePairJson(pairJson());
  assert.equal(pair.sample1.availability, 'available');
  assert.equal(pair.sample2.entries[0].bytesSent, 1500);
  assert.equal(pair.sample2.entries[0].category, 'ethernet');
  assert.equal(pair.sample2.entries[0].gatewayPresent, true);
  assert.equal(pair.sample2.entries[0].dnsPresent, true);
});

test('malformed pair output fails safely', () => {
  assert.throws(() => parseNetworkSamplePairJson('{broken'), /invalid JSON/);
  assert.throws(() => parseNetworkSamplePairJson('[]'), /output is invalid/);
});

test('missing sample1 is rejected', () => {
  const value = pairObject();
  delete value.Sample1;
  assert.throws(() => parseNetworkSamplePairJson(JSON.stringify(value)), /sample1 is missing or invalid/);
});

test('missing sample2 is rejected', () => {
  const value = pairObject();
  delete value.Sample2;
  assert.throws(() => parseNetworkSamplePairJson(JSON.stringify(value)), /sample2 is missing or invalid/);
});

test('counter reset remains unavailable instead of producing a negative rate', async () => {
  const raw = await collectorFromPair({
    sample1Entries: [rawEntry({ sent: '5000', received: '6000' })],
    sample2Entries: [rawEntry({ sent: '100', received: '200' })]
  }).collectRaw();
  assert.equal(raw.traffic.uploadRate.availability, 'unavailable');
  assert.equal(raw.traffic.downloadRate.value, null);
});

test('an interface disappearing between pair samples degrades rates safely', async () => {
  const raw = await collectorFromPair({
    sample1Entries: [rawEntry({ id: 'old' })],
    sample2Entries: [rawEntry({ id: 'new' })]
  }).collectRaw();
  assert.equal(raw.interfaces.active.length, 1);
  assert.equal(raw.traffic.uploadRate.availability, 'unavailable');
  assert.equal(raw.traffic.cumulativeSent.availability, 'available');
});

test('single-process child timeout is bounded and rejects', async () => {
  let timeout;
  await assert.rejects(runNetworkSamplePairPowerShell({
    sampleIntervalMs: 500,
    timeoutMs: 777,
    execFileImpl(_executable, _args, options, callback) {
      timeout = options.timeout;
      const error = new Error('timed out');
      error.code = 'ETIMEDOUT';
      callback(error, '', 'private timeout detail');
    }
  }), /timed out/);
  assert.equal(timeout, 777);
});

test('single-process child non-zero exit is rejected', async () => {
  await assert.rejects(runNetworkSamplePairPowerShell({
    execFileImpl(_executable, _args, _options, callback) {
      const error = new Error('exit 9');
      error.code = 9;
      callback(error, '', 'private failure detail');
    }
  }), /exit 9/);
});

test('stderr and raw process errors never leak into Home Footer ViewModel', async () => {
  const privateText = 'C:\\Users\\private\\secret-token';
  const collector = new WindowsNetworkCollector({
    platform: 'win32',
    samplePairProvider: async () => {
      const error = new Error(privateText);
      error.stderr = privateText;
      throw error;
    }
  });
  const network = await new WindowsNetworkCollectorAdapter(collector).collectNetworkMetrics();
  const snapshot = loadScenario('healthy_device');
  snapshot.network = network;
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.doesNotMatch(JSON.stringify(viewModel), /private|secret-token|Users/);
  assert.equal(viewModel.network.upload.state, 'unavailable');
});

test('sample-pair output never introduces NaN', async () => {
  const network = await new WindowsNetworkCollectorAdapter(collectorFromPair({})).collectNetworkMetrics();
  assert.equal(hasInvalidNumber(network, Number.isNaN), false);
});

test('zero elapsed pair never introduces Infinity', async () => {
  const raw = await collectorFromPair({ sample1At: 1000, sample2At: 1000 }).collectRaw();
  assert.equal(hasInvalidNumber(raw, (value) => !Number.isFinite(value)), false);
  assert.equal(raw.traffic.uploadRate.availability, 'unavailable');
});

test('a genuine zero rate remains available through the Adapter', async () => {
  const same = [rawEntry({ sent: '0', received: '0' })];
  const network = await new WindowsNetworkCollectorAdapter(collectorFromPair({
    sample1Entries: same,
    sample2Entries: same
  })).collectNetworkMetrics();
  assert.equal(network.traffic.upload_rate.availability, 'available');
  assert.equal(network.traffic.upload_rate.current.value, 0);
  assert.equal(network.traffic.download_rate.current.value, 0);
});

test('multi-interface selection and aggregation remain compatible', async () => {
  const before = [
    rawEntry({ id: 'a', name: 'Ethernet', sent: '100', received: '200' }),
    rawEntry({ id: 'b', name: 'Wi-Fi', type: 'Wireless80211', sent: '300', received: '400' })
  ];
  const after = [
    rawEntry({ id: 'a', name: 'Ethernet', sent: '200', received: '400' }),
    rawEntry({ id: 'b', name: 'Wi-Fi', type: 'Wireless80211', sent: '600', received: '800' })
  ];
  const network = await new WindowsNetworkCollectorAdapter(collectorFromPair({
    sample1Entries: before,
    sample2Entries: after
  })).collectNetworkMetrics();
  assert.equal(network.interface_summary.active_count, 2);
  assert.equal(network.interface_summary.primary, null);
  assert.equal(network.traffic.cumulative_sent.current.value, 800);
  assert.equal(network.traffic.upload_rate.current.value, 400);
});

test('DeviceNetworkSnapshot continues to consume optimized NetworkMetrics', async () => {
  const fixture = loadScenario('healthy_device');
  const networkAdapter = new WindowsNetworkCollectorAdapter(collectorFromPair({}));
  const aggregator = new DeviceNetworkSnapshotAggregator({
    systemAdapter: { collectSystemMetrics: async () => fixture.system },
    networkAdapter,
    createId: () => '005-snapshot-id'
  });
  const snapshot = await aggregator.collectSnapshot();
  assert.equal(validateDeviceNetworkSnapshot(snapshot), snapshot);
  assert.equal(validateNetworkMetrics(snapshot.network), snapshot.network);
  assert.equal(snapshot.network.traffic.upload_rate.current.value, 500);
});

test('fake sample-pair provider performs no real Node wait', async () => {
  let providerCalls = 0;
  const collector = new WindowsNetworkCollector({
    platform: 'win32',
    sampleIntervalMs: 500,
    samplePairProvider: async (interval) => {
      providerCalls += 1;
      assert.equal(interval, 500);
      return parseNetworkSamplePairJson(pairJson());
    },
    sleep: async () => { throw new Error('unexpected real wait'); }
  });
  await collector.collectRaw();
  assert.equal(providerCalls, 1);
});

test('sample timestamps must be ordered', () => {
  assert.throws(
    () => parseNetworkSamplePairJson(pairJson({ sample1At: 2000, sample2At: 1000 })),
    /out of order/
  );
});

test('single-process script remains read-only profile-free and privacy-minimal', () => {
  const script = buildNetworkSamplePairScript(500);
  assert.match(script, /Console\]::OutputEncoding/);
  assert.match(script, /UTF8Encoding/);
  assert.match(script, /GetAllNetworkInterfaces/);
  assert.match(script, /Sample1/);
  assert.match(script, /Sample2/);
  assert.match(script, /GetIPProperties/);
  assert.match(script, /GatewayPresent/);
  assert.match(script, /DnsPresent/);
  assert.doesNotMatch(script, /IPAddress|PhysicalAddress|SSID|\.Address\b|Invoke-WebRequest/);
});
