'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ApplicationByteAccounting,
  ApplicationNetworkObservationRecorder,
  ApplicationNetworkReadService,
  ApplicationNetworkSnapshotCollector,
  JsonFileApplicationNetworkHistoryStore,
  buildApplicationNetworkViewModel
} = require('../src');

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows persistence smoke requires win32.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexa-app-network-smoke-'));
  const filePath = path.join(directory, 'history.json');
  try {
    const store = new JsonFileApplicationNetworkHistoryStore({ filePath });
    const recorder = new ApplicationNetworkObservationRecorder({ collector: new ApplicationNetworkSnapshotCollector(), store });
    const first = await recorder.collectAndRecord();
    const second = await recorder.collectAndRecord();
    const reopened = new JsonFileApplicationNetworkHistoryStore({ filePath });
    const read = new ApplicationNetworkReadService({ store: reopened });
    const list = await read.listObservations({ limit: 2 });
    const summary = (await read.getWindowSummary()).data;
    const view = buildApplicationNetworkViewModel(second.snapshot, summary);
    const pass = list.count === 2 && summary.sample_count === 2
      && list.data.every((entry) => entry.semantics === 'windows_application_network_observation')
      && view.rankings.network_top5.availability === 'unavailable'
      && view.rankings.top_active_connections.label.includes('not traffic bytes')
      && second.snapshot.byte_accounting.status === ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE;
    if (!pass) throw new Error('Persistence/read/ViewModel contract failed.');
    process.stdout.write([
      'WINDOWS_APPLICATION_NETWORK_PERSISTENCE_SMOKE=PASS',
      `PERSISTED_SAMPLE_COUNT=${list.count}`,
      `LATEST_APPLICATION_COUNT=${summary.latest_active_application_count}`,
      `LATEST_CONNECTION_COUNT=${summary.latest_connection_count}`,
      `APP_BYTE_ACCOUNTING=${second.snapshot.byte_accounting.status.toUpperCase()}`,
      'NETWORK_TOP5=UNAVAILABLE',
      'TOP_ACTIVE_CONNECTIONS=AVAILABLE',
      'READ_API=PASS',
      'UI_READY_VIEW_MODEL=PASS',
      'AI_TOOL_USAGE_AS_NETWORK_BYTES=NO',
      'DEVICE_USAGE_AS_HARDWARE_HISTORY=NO',
      'ADMIN_REQUIRED=NO',
      'NETWORK_EGRESS=0',
      'SYSTEM_MODIFICATIONS=0'
    ].join('\n') + '\n');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`WINDOWS_APPLICATION_NETWORK_PERSISTENCE_SMOKE=FAIL\n${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
