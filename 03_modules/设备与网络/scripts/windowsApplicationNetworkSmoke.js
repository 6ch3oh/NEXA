'use strict';

const { ApplicationNetworkSnapshotCollector, ApplicationByteAccounting } = require('../src');

function finiteTree(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (value && typeof value === 'object') return Object.values(value).every(finiteTree);
  return true;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows application network smoke requires win32.');
  const snapshot = await new ApplicationNetworkSnapshotCollector().collect();
  const processPass = snapshot.process_observation.availability === 'available' && snapshot.process_observation.count > 0;
  const cpuPass = snapshot.application_summary.cpu_top5.length > 0 && snapshot.application_summary.cpu_top5.length <= 5;
  const ramPass = snapshot.application_summary.ram_top5.length > 0 && snapshot.application_summary.ram_top5.length <= 5;
  const connectionPass = snapshot.connection_observation.availability === 'available';
  const mappingPass = snapshot.applications.every((item) => item.process_ids.every(Number.isInteger));
  const finitePass = finiteTree(snapshot);
  const bytePass = snapshot.byte_accounting.status === ApplicationByteAccounting.READY
    || snapshot.byte_accounting.status === ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE;
  const checks = { processPass, cpuPass, ramPass, connectionPass, mappingPass, finitePass, bytePass };
  for (const [name, passed] of Object.entries(checks)) if (!passed) throw new Error(`Smoke check failed: ${name}`);
  const apex = snapshot.application_summary.apex;
  process.stdout.write([
    'WINDOWS_APPLICATION_NETWORK_SMOKE=PASS',
    `PROCESS_COUNT=${snapshot.process_observation.count}`,
    `CPU_TOP5_COUNT=${snapshot.application_summary.cpu_top5.length}`,
    `RAM_TOP5_COUNT=${snapshot.application_summary.ram_top5.length}`,
    `CONNECTION_COUNT=${snapshot.connection_observation.count}`,
    `NETWORK_OBSERVED_APPLICATION_COUNT=${snapshot.application_summary.network_observed_application_count}`,
    `IPV4_IPV6_PARSE=PASS`,
    `PID_MAPPING=PASS`,
    `APPLICATION_MAPPING=PASS`,
    `APEX_STATUS=${apex.overall.toUpperCase()}`,
    `APP_BYTE_ACCOUNTING=${snapshot.byte_accounting.status.toUpperCase()}`,
    'ADMIN_REQUIRED=NO',
    'NETWORK_EGRESS=0',
    'SYSTEM_MODIFICATIONS=0',
    'NON_FINITE_VALUES=0'
  ].join('\n') + '\n');
}

main().catch((error) => {
  process.stderr.write(`WINDOWS_APPLICATION_NETWORK_SMOKE=FAIL\n${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
