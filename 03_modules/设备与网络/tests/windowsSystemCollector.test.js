'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WindowsSystemCollector,
  WindowsSystemCollectorAdapter,
  CPU_TOPOLOGY_QUERY_SCRIPT,
  buildHomeFooterViewModel,
  collectDisks,
  collectMemory,
  parseFixedDiskJson,
  parseCpuTopologyJson,
  queryCpuTopology,
  queryFixedDisks,
  runDiskPowerShell,
  runCpuTopologyPowerShell,
  sampleCpu,
  validateSystemMetrics
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

const GB = 1024 ** 3;

function cpuEntry(user, idle, { nice = 0, sys = 0, irq = 0 } = {}) {
  return { model: 'Fixture CPU', speed: 3000, times: { user, nice, sys, idle, irq } };
}

function sequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function fixedDisk(deviceId = 'C:', totalBytes = 512 * GB, availableBytes = 200 * GB) {
  return { deviceId, totalBytes, availableBytes };
}

function deterministicCollector(overrides = {}) {
  return new WindowsSystemCollector({
    platform: 'win32',
    sampleIntervalMs: 0,
    readCpus: sequence([cpuEntry(100, 100)], [cpuEntry(150, 150)]),
    sleep: async () => {},
    totalmem: () => 16 * GB,
    freemem: () => 4 * GB,
    diskProvider: async () => [fixedDisk()],
    cpuTopologyProvider: async () => ({ physicalCores: 1, logicalProcessors: 1 }),
    now: () => new Date('2026-08-10T03:00:00.000Z'),
    hostProvider: () => ({ name: 'DESKTOP-NEXA', platform: 'win32', version: 'Windows 11 Pro', release: '10.0.26100', build: '26100', cpuModel: 'Fixture CPU' }),
    ...overrides
  });
}

test('CPU deterministic samples compute utilization from tick deltas', async () => {
  const result = await sampleCpu({
    readCpus: sequence([cpuEntry(100, 100)], [cpuEntry(150, 150)]),
    sleep: async () => {},
    sampleIntervalMs: 0
  });
  assert.equal(result.availability, 'available');
  assert.equal(result.utilizationPercent, 50);
  assert.equal(result.logicalProcessors, 1);
});

test('CPU genuine zero remains an available zero', async () => {
  const result = await sampleCpu({
    readCpus: sequence([cpuEntry(100, 100)], [cpuEntry(100, 200)]),
    sleep: async () => {}, sampleIntervalMs: 0
  });
  assert.equal(result.availability, 'available');
  assert.equal(result.utilizationPercent, 0);
});

test('CPU 100 percent boundary does not overflow', async () => {
  const result = await sampleCpu({
    readCpus: sequence([cpuEntry(100, 100)], [cpuEntry(200, 100)]),
    sleep: async () => {}, sampleIntervalMs: 0
  });
  assert.equal(result.availability, 'available');
  assert.equal(result.utilizationPercent, 100);
});

test('CPU invalid raw ticks degrade without throwing', async () => {
  const result = await sampleCpu({ readCpus: () => [], sleep: async () => {}, sampleIntervalMs: 0 });
  assert.equal(result.availability, 'unavailable');
  assert.equal(result.utilizationPercent, null);
  assert.match(result.reason, /no processors/);
});

test('CPU topology parser preserves physical and logical core counts', () => {
  assert.deepEqual(parseCpuTopologyJson('{"PhysicalCores":8,"LogicalProcessors":16}'), { physicalCores: 8, logicalProcessors: 16 });
  assert.throws(() => parseCpuTopologyJson('{"PhysicalCores":16,"LogicalProcessors":8}'), /invalid core counts/);
});

test('CPU topology query is a bounded read-only Win32 API call without CIM or elevation', async () => {
  let observed;
  const value = await queryCpuTopology({ runCommand: () => runCpuTopologyPowerShell({
    executable: 'fixture-powershell.exe', timeoutMs: 4321,
    execFileImpl(executable, args, options, callback) {
      observed = { executable, args, options };
      callback(null, '{"PhysicalCores":8,"LogicalProcessors":16}', '');
    }
  }) });
  assert.deepEqual(value, { physicalCores: 8, logicalProcessors: 16 });
  assert.match(CPU_TOPOLOGY_QUERY_SCRIPT, /GetLogicalProcessorInformationEx/);
  assert.doesNotMatch(CPU_TOPOLOGY_QUERY_SCRIPT, /Get-CimInstance|Set-|Start-Process|RunAs/);
  assert.ok(observed.args.includes('-NoProfile'));
  assert.ok(observed.args.includes('-NonInteractive'));
  assert.equal(observed.options.timeout, 4321);
  assert.equal(observed.options.windowsHide, true);
});

test('RAM total, used and available preserve the capacity relation', () => {
  const result = collectMemory({ totalmem: () => 16 * GB, freemem: () => 4 * GB });
  assert.equal(result.availability, 'available');
  assert.equal(result.usedBytes + result.availableBytes, result.totalBytes);
});

test('RAM utilization is calculated in percent', () => {
  const result = collectMemory({ totalmem: () => 16 * GB, freemem: () => 4 * GB });
  assert.equal(result.utilizationPercent, 75);
});

test('RAM invalid values never produce NaN or Infinity', () => {
  for (const [totalmem, freemem] of [
    [() => 0, () => 0],
    [() => Infinity, () => 1],
    [() => 8, () => 9]
  ]) {
    const result = collectMemory({ totalmem, freemem });
    assert.equal(result.availability, 'unavailable');
    assert.equal(result.utilizationPercent, null);
  }
});

test('Disk JSON parser normalizes one or many fixed volumes', () => {
  assert.deepEqual(parseFixedDiskJson('{"DeviceID":"C:","Size":"1000","FreeSpace":"250"}'), [
    { deviceId: 'C:', totalBytes: 1000, availableBytes: 250 }
  ]);
  assert.equal(parseFixedDiskJson('[{"DeviceID":"C:","Size":1000,"FreeSpace":250},{"DeviceID":"D:","Size":2000,"FreeSpace":1000}]').length, 2);
});

test('Disk free zero is a valid available capacity', async () => {
  const result = await collectDisks({ query: async () => [fixedDisk('C:', 1000, 0)] });
  assert.equal(result.availability, 'available');
  const adapter = new WindowsSystemCollectorAdapter(deterministicCollector({ diskProvider: async () => result.volumes }));
  const system = await adapter.collectSystemMetrics();
  assert.equal(system.disks[0].available.value, 0);
  assert.equal(system.disks[0].utilization.value, 100);
});

test('Disk provider failure degrades to unavailable', async () => {
  const result = await collectDisks({ query: async () => { throw new Error('fixture disk failure'); } });
  assert.equal(result.availability, 'unavailable');
  assert.deepEqual(result.volumes, []);
  assert.match(result.reason, /fixture disk failure/);
});

test('Disk invalid JSON and stderr are rejected safely', async () => {
  assert.throws(() => parseFixedDiskJson('{broken'), /invalid JSON/);
  await assert.rejects(
    queryFixedDisks({ runCommand: async () => ({ stdout: '[]', stderr: 'fixture error' }) }),
    /stderr/
  );
});

test('PowerShell disk query is no-profile, non-interactive, bounded and structured', async () => {
  let observed;
  const result = await runDiskPowerShell({
    executable: 'fixture-powershell.exe',
    timeoutMs: 4321,
    execFileImpl(executable, args, options, callback) {
      observed = { executable, args, options };
      callback(null, '[]', '');
    }
  });
  assert.equal(result.stdout, '[]');
  assert.equal(observed.executable, 'fixture-powershell.exe');
  assert.ok(observed.args.includes('-NoProfile'));
  assert.ok(observed.args.includes('-NonInteractive'));
  assert.match(observed.args.at(-1), /System\.IO\.DriveInfo/);
  assert.match(observed.args.at(-1), /DriveType.*Fixed/);
  assert.match(observed.args.at(-1), /IsReady/);
  assert.match(observed.args.at(-1), /ConvertTo-Json/);
  assert.equal(observed.options.timeout, 4321);
  assert.equal(observed.options.windowsHide, true);
});

test('Collector and Adapter produce a valid SystemMetrics V0.1 record', async () => {
  const adapter = new WindowsSystemCollectorAdapter(deterministicCollector());
  const system = await adapter.collectSystemMetrics();
  assert.equal(validateSystemMetrics(system), system);
  assert.equal(system.cpu.utilization.value, 50);
  assert.equal(system.memory.utilization.value, 75);
  assert.equal(system.disks.length, 1);
  assert.equal(system.metadata.provider.id, 'windows-system');
  assert.equal(system.host.name, 'DESKTOP-NEXA');
  assert.equal(system.host.build, '26100');
  assert.equal(system.cpu.model, 'Fixture CPU');
  assert.equal(system.cpu.logical_processors, 1);
  assert.equal(system.cpu.physical_cores, 1);
  assert.equal(system.cpu.physical_cores_availability, 'available');
});

test('real-shaped SystemMetrics flows through the home footer ViewModel', async () => {
  const adapter = new WindowsSystemCollectorAdapter(deterministicCollector());
  const snapshot = loadScenario('healthy_device');
  snapshot.system = await adapter.collectSystemMetrics();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.cpu.text, '50%');
  assert.equal(viewModel.ram.text, '75%');
});

test('GPU remains unsupported and never displays as zero', async () => {
  const system = await new WindowsSystemCollectorAdapter(deterministicCollector()).collectSystemMetrics();
  const snapshot = loadScenario('healthy_device');
  snapshot.system = system;
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(system.gpu.availability, 'unsupported');
  assert.equal(viewModel.gpu.value, null);
  assert.equal(viewModel.gpu.text, '不支持');
});

test('Temperature remains unavailable and never displays as zero', async () => {
  const system = await new WindowsSystemCollectorAdapter(deterministicCollector()).collectSystemMetrics();
  const snapshot = loadScenario('healthy_device');
  snapshot.system = system;
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(system.temperatures[0].availability, 'unavailable');
  assert.equal(viewModel.temperature.value, null);
  assert.equal(viewModel.temperature.text, '暂不可用');
});

test('partial Disk failure does not discard valid CPU and RAM', async () => {
  const collector = deterministicCollector({ diskProvider: async () => { throw new Error('disk unavailable'); } });
  const system = await new WindowsSystemCollectorAdapter(collector).collectSystemMetrics();
  assert.equal(system.cpu.availability, 'available');
  assert.equal(system.memory.availability, 'available');
  assert.equal(system.disks[0].availability, 'unavailable');
  assert.equal(validateSystemMetrics(system), system);
});

test('collected_at and freshness represent a fresh single collection', async () => {
  const system = await new WindowsSystemCollectorAdapter(deterministicCollector()).collectSystemMetrics();
  assert.equal(system.metadata.collected_at, '2026-08-10T03:00:00.000Z');
  assert.equal(system.metadata.freshness.state, 'fresh');
  assert.equal(system.metadata.freshness.age_ms, 0);
  assert.equal(system.metadata.freshness.stale_after_ms, 60_000);
});
