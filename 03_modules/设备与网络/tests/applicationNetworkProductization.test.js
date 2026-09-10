'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const {
  ApplicationByteAccounting,
  ApplicationNetworkObservationRecorder,
  ApplicationNetworkLongTermObserver,
  ApplicationNetworkReadService,
  InMemoryApplicationNetworkHistoryStore,
  JsonFileApplicationNetworkHistoryStore,
  buildApplicationNetworkViewModel,
  compactLargeApplicationHistory,
  projectHistoryEntry,
  summarizeHistory,
  validateApplicationByteBatch,
  validateHistoryEntry
} = require('../src');

const AT = '2026-08-13T00:00:00.000Z';

function snapshot(options = {}) {
  const ready = options.ready === true;
  const application = { application_id: 'process-name:a.exe', process_name: 'a.exe', display_name: null };
  const observation = {
    application, active_connection_count: 3, protocol_counts: { tcp: 2, udp: 1 },
    remote_endpoints: { total: 2, unique: 2, ipv4: 2, ipv6: 0, local: 1, domestic: 0, foreign: 0, unknown: 1 },
    attribution_quality: ready ? 'byte_attributed' : 'connection_only'
  };
  if (ready) observation.traffic = { upload_bytes: 10, download_bytes: 20, upload_rate: 1, download_rate: 2 };
  return {
    schema_version: '0.1', snapshot_id: options.id || 'application-network:1', observed_at: options.at || AT, availability: 'available',
    process_observation: { availability: 'available', count: 1 }, connection_observation: { availability: 'available', count: 3 }, applications: [observation],
    application_summary: {
      active_application_count: 1, network_observed_application_count: 1,
      cpu_top5: [{ application, process_ids: [1], value: 12 }], ram_top5: [{ application, process_ids: [1], value: 1024 }],
      network_top5: { availability: ready ? 'available' : 'unavailable', items: ready ? [{ application, total_rate: 3 }] : [], reason: ready ? null : 'no bytes' },
      top_active_connections: [{ application, active_connection_count: 3 }],
      apex: { availability: 'available', overall: 'not_running', components: {}, observed_at: options.at || AT }
    },
    byte_accounting: ready ? { status: ApplicationByteAccounting.READY, evidence: 'verified Windows counters' }
      : { status: ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE, evidence: 'no approved per-app source' }
  };
}

test('byte batch requires explicit Windows application byte semantics', () => assert.throws(() => validateApplicationByteBatch({ records: [] }, []), /source_type/));
test('AI tool usage cannot satisfy application byte batch contract', () => assert.throws(() => validateApplicationByteBatch({ source_type: 'ai_tool_usage', provider_id: 'usage', observed_from: AT, observed_to: AT, complete: true, semantics: 'tx_rx_bytes_by_windows_application', records: [] }, []), /invalid value/));
test('byte batch must completely cover current applications', () => assert.throws(() => validateApplicationByteBatch({ source_type: 'windows_application_network_counters', provider_id: 'x', observed_from: AT, observed_to: AT, complete: true, semantics: 'tx_rx_bytes_by_windows_application', records: [] }, ['process-name:a.exe']), /completely cover/));
test('history projection uses explicit application-network semantics', () => assert.equal(projectHistoryEntry(snapshot()).semantics, 'windows_application_network_observation'));
test('history projection excludes process IDs and raw endpoints', () => {
  const text = JSON.stringify(projectHistoryEntry(snapshot()));
  assert.doesNotMatch(text, /process_ids|remoteAddress|localAddress/);
});
test('deferred history never contains traffic', () => assert.equal(Object.hasOwn(projectHistoryEntry(snapshot()).applications[0], 'traffic'), false));
test('ready history retains validated traffic', () => assert.equal(projectHistoryEntry(snapshot({ ready: true })).applications[0].traffic.download_bytes, 20));
test('history validation rejects traffic without ready byte accounting', () => {
  const entry = projectHistoryEntry(snapshot({ ready: true }));
  entry.byte_accounting_status = ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE;
  assert.throws(() => validateHistoryEntry(entry), /traffic requires/);
});
test('in-memory history deduplicates snapshot id', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT) });
  await store.append(projectHistoryEntry(snapshot())); await store.append(projectHistoryEntry(snapshot()));
  assert.equal((await store.list()).length, 1);
});
test('history retention removes expired observations', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT), retentionMs: 1000 });
  await store.append(projectHistoryEntry(snapshot({ at: '2026-08-12T23:59:58.000Z' })));
  assert.equal((await store.list()).length, 0);
});
test('history max entries preserves newest deterministic samples', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT), maxEntries: 1 });
  await store.append(projectHistoryEntry(snapshot({ id: '1', at: '2026-08-12T23:59:59.000Z' })));
  await store.append(projectHistoryEntry(snapshot({ id: '2', at: AT })));
  assert.equal((await store.latest()).snapshot_id, '2');
});
test('large persisted application history retains raw recent samples and hourly long-term evidence', () => {
  const now = Date.parse(AT);
  const entries = Array.from({ length: 1001 }, (_, index) => projectHistoryEntry(snapshot({
    id: String(index),
    at: new Date(now - (1000 - index) * 60_000).toISOString()
  })));
  const compacted = compactLargeApplicationHistory(entries, now);
  assert.ok(compacted.length < entries.length);
  assert.equal(compacted.at(-1).snapshot_id, '1000');
  assert.ok(compacted.filter((entry) => Date.parse(entry.observed_at) >= now - 60 * 60_000).length >= 60);
});
test('history listing supports time windows', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT) });
  await store.append(projectHistoryEntry(snapshot({ id: '1', at: '2026-08-12T23:59:59.000Z' })));
  await store.append(projectHistoryEntry(snapshot({ id: '2', at: AT })));
  assert.deepEqual((await store.list({ since: AT })).map((entry) => entry.snapshot_id), ['2']);
});
test('JSON history store survives a new store instance', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-app-network-'));
  const filePath = path.join(directory, 'history.json');
  try {
    await new JsonFileApplicationNetworkHistoryStore({ filePath, now: () => new Date(AT) }).append(projectHistoryEntry(snapshot()));
    assert.equal((await new JsonFileApplicationNetworkHistoryStore({ filePath, now: () => new Date(AT) }).latest()).snapshot_id, 'application-network:1');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('JSON history store can retry after a failed persistence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-app-network-retry-'));
  const filePath = path.join(directory, 'history.json');
  const store = new JsonFileApplicationNetworkHistoryStore({ filePath, now: () => new Date(AT) });
  let calls = 0;
  store.persist = async () => { calls += 1; if (calls === 1) throw new Error('disk'); };
  try {
    await assert.rejects(() => store.append(projectHistoryEntry(snapshot())), /disk/);
    await store.append(projectHistoryEntry(snapshot({ id: '2' })));
    assert.equal(calls, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('recorder returns snapshot and recorded evidence', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT) });
  const result = await new ApplicationNetworkObservationRecorder({ collector: { collect: async () => snapshot() }, store }).collectAndRecord();
  assert.equal(result.snapshot.snapshot_id, result.history_entry.snapshot_id);
});
test('long-term observer coalesces overlapping observations', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let count = 0;
  const observer = new ApplicationNetworkLongTermObserver({ recorder: { collectAndRecord: async () => { count += 1; await pending; return { ok: true }; } } });
  const one = observer.observeOnce(); const two = observer.observeOnce();
  release();
  assert.deepEqual(await one, await two); assert.equal(count, 1);
});
test('long-term observer start and stop are idempotent', () => {
  let tick;
  const observer = new ApplicationNetworkLongTermObserver({ recorder: { collectAndRecord: async () => ({}) }, setInterval: (fn) => { tick = fn; return { unref() {} }; }, clearInterval: () => {}, intervalMs: 1000 });
  assert.equal(observer.start({ immediate: false }), true); assert.equal(observer.start(), false); assert.equal(typeof tick, 'function');
  assert.equal(observer.stop(), true); assert.equal(observer.stop(), false);
});
test('long-term observer reports a failed sample and remains reusable', async () => {
  let calls = 0; let errors = 0;
  const observer = new ApplicationNetworkLongTermObserver({ recorder: { collectAndRecord: async () => { calls += 1; if (calls === 1) throw new Error('sample'); return { ok: true }; } }, onError: () => { errors += 1; } });
  await assert.rejects(() => observer.observeOnce(), /sample/);
  assert.deepEqual(await observer.observeOnce(), { ok: true }); assert.equal(errors, 1);
});
test('window summary labels exclusions and byte readiness', () => {
  const summary = summarizeHistory([projectHistoryEntry(snapshot()), projectHistoryEntry(snapshot({ id: '2', ready: true }))]);
  assert.equal(summary.byte_accounting.ready_sample_count, 1);
  assert.deepEqual(summary.exclusions, ['ai_tool_usage', 'device_usage_history', 'hardware_history']);
});
test('Read API exposes latest, list and window summary', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT) }); await store.append(projectHistoryEntry(snapshot()));
  const api = new ApplicationNetworkReadService({ store });
  assert.equal((await api.getLatest()).api_version, '0.1');
  assert.equal((await api.listObservations()).count, 1);
  assert.equal((await api.getWindowSummary()).data.sample_count, 1);
});
test('Read API returns application-specific samples without inventing bytes', async () => {
  const store = new InMemoryApplicationNetworkHistoryStore({ now: () => new Date(AT) }); await store.append(projectHistoryEntry(snapshot()));
  const response = await new ApplicationNetworkReadService({ store }).getApplicationHistory('process-name:a.exe');
  assert.equal(response.count, 1); assert.equal(Object.hasOwn(response.data[0], 'traffic'), false);
});
test('ViewModel separates Network Top5 from connection ranking', () => {
  const view = buildApplicationNetworkViewModel(snapshot());
  assert.equal(view.rankings.network_top5.availability, 'unavailable');
  assert.equal(view.rankings.top_active_connections.items[0].unit, 'connections');
});
test('ViewModel exposes Network Top5 only for ready bytes', () => {
  const view = buildApplicationNetworkViewModel(snapshot({ ready: true }));
  assert.equal(view.rankings.network_top5.items[0].unit, 'bytes_per_second');
});
test('ViewModel declares semantic anti-confusion invariants', () => {
  const view = buildApplicationNetworkViewModel(snapshot());
  assert.equal(view.disclosures.ai_tool_usage_is_not_application_network_bytes, true);
  assert.equal(view.disclosures.device_usage_history_is_not_hardware_history, true);
});
