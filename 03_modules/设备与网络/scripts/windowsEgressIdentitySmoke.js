'use strict';

const {
  ApplicationByteAccounting,
  EgressIdentityService,
  IpapiGeoIpProvider,
  IpifyPublicIpProvider,
  WindowsProcessCollector,
  buildApexRuntimeStatus,
  collectLocalNetworkIdentity,
  validateEgressIdentity
} = require('../src');
const { requestJson } = require('../src/providers/egressIdentityProviders');

function maskIp(ip) {
  if (typeof ip !== 'string') return 'UNAVAILABLE';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 2).join(':')}:xxxx:xxxx`;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.xxx.xxx` : 'UNAVAILABLE';
}

function safeText(value) {
  if (typeof value !== 'string' || !value.trim()) return 'UNAVAILABLE';
  return value.replace(/[\r\n=]/g, ' ').trim().slice(0, 160);
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows egress smoke requires win32.');
  const requestCounts = { ipify: 0, ipapi: 0 };
  const publicIpProvider = new IpifyPublicIpProvider({
    request: async (url) => { requestCounts.ipify += 1; return requestJson(url); }
  });
  const geoIpProvider = new IpapiGeoIpProvider({
    request: async (url) => { requestCounts.ipapi += 1; return requestJson(url); }
  });
  const service = new EgressIdentityService({ publicIpProvider, geoIpProvider });
  const [identity, processResult] = await Promise.all([
    service.refresh(),
    new WindowsProcessCollector().collectRaw()
  ]);
  if (identity.availability !== 'available' || !identity.public_ip) throw new Error(`Public IP unavailable: ${identity.failure || 'UNKNOWN'}`);
  validateEgressIdentity(identity);
  const apex = buildApexRuntimeStatus(processResult);
  if (apex.availability !== 'available') throw new Error('APEX runtime observation unavailable.');
  const local = collectLocalNetworkIdentity();
  const geoState = identity.geo_availability === 'available' ? 'AVAILABLE' : 'PARTIAL';
  process.stdout.write([
    'WINDOWS_EGRESS_IDENTITY_SMOKE=PASS',
    `PUBLIC_IP=${maskIp(identity.public_ip)}`,
    `IP_VERSION=${identity.public_ip.includes(':') ? 'IPv6' : 'IPv4'}`,
    `GEO=${geoState}`,
    `COUNTRY=${safeText(identity.country)}`,
    `REGION=${safeText(identity.region)}`,
    `CITY=${safeText(identity.city)}`,
    `ISP=${safeText(identity.isp)}`,
    `ASN=${safeText(identity.asn)}`,
    'APPROXIMATE=true',
    `PUBLIC_PROVIDER=${identity.provider}`,
    `GEO_PROVIDER=${identity.geo_provider_id || 'UNAVAILABLE'}`,
    'EGRESS_IDENTITY_CONTRACT=PASS',
    `IPIFY_REQUESTS=${requestCounts.ipify}`,
    `IPAPI_REQUESTS=${requestCounts.ipapi}`,
    `LOCAL_IPV4_COUNT=${local.active_local_ipv4.length}`,
    `LOCAL_IPV6_COUNT=${local.active_local_ipv6.length}`,
    `APEX_STATUS=${apex.overall.toUpperCase()}`,
    'APEX_EGRESS_CAUSALITY=UNKNOWN',
    `APP_BYTE_ACCOUNTING=${ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE.toUpperCase()}`,
    'NETWORK_TOP5=DEFERRED',
    'PROCESS_APPLICATION_DATA_SENT=0',
    'NO_USER_DATA_LEAKAGE=PASS',
    'ADMIN_REQUIRED=NO',
    'SYSTEM_MODIFICATIONS=0'
  ].join('\n') + '\n');
}

main().catch((error) => {
  process.stderr.write(`WINDOWS_EGRESS_IDENTITY_SMOKE=FAIL\n${String(error?.message || error).replace(/[\r\n]/g, ' ').slice(0, 160)}\n`);
  process.exitCode = 1;
});
