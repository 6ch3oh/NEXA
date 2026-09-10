'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const https = require('node:https');
const net = require('node:net');

const DNSPOD_API_HOST = 'dnspod.tencentcloudapi.com';
const DNSPOD_API_VERSION = '2021-03-23';
const DNSPOD_SERVICE = 'dnspod';
const DEFAULT_DDNS_TTL = 600;
const DEFAULT_RECORD_LINE = '默认';
const MAX_API_RESPONSE_BYTES = 256 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function utcDate(timestampSeconds) {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function createTencentCloudAuthorization({ action, payload, secretId, secretKey, timestampSeconds }) {
  const canonicalHeaders = [
    'content-type:application/json; charset=utf-8',
    `host:${DNSPOD_API_HOST}`,
    `x-tc-action:${action.toLowerCase()}`,
    ''
  ].join('\n');
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload)
  ].join('\n');
  const date = utcDate(timestampSeconds);
  const credentialScope = `${date}/${DNSPOD_SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestampSeconds,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, DNSPOD_SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function defaultHttpsPost({ headers, body, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: DNSPOD_API_HOST,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_API_RESPONSE_BYTES) {
          request.destroy(Object.assign(new Error('DNSPod response exceeds limit'), {
            code: 'DNSPOD_RESPONSE_TOO_LARGE'
          }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('DNSPod timeout'), {
      code: 'DNSPOD_TIMEOUT'
    })));
    request.once('error', reject);
    request.end(body);
  });
}

function safeApiErrorCode(value) {
  const normalized = String(value || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96);
  return `DNSPOD_API_${normalized || 'UNKNOWN'}`;
}

function createDnsPodApiClient({
  secretId,
  secretKey,
  clock = () => Date.now(),
  httpsPost = defaultHttpsPost
}) {
  if (typeof secretId !== 'string' || !secretId || typeof secretKey !== 'string' || !secretKey) {
    throw new Error('DNSPod credentials are required');
  }

  async function call(action, parameters) {
    const body = JSON.stringify(parameters);
    const timestampSeconds = Math.floor(clock() / 1000);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Host: DNSPOD_API_HOST,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestampSeconds),
      'X-TC-Version': DNSPOD_API_VERSION,
      Authorization: createTencentCloudAuthorization({
        action,
        payload: body,
        secretId,
        secretKey,
        timestampSeconds
      })
    };
    const response = await httpsPost({ headers, body });
    if (response.statusCode !== 200) {
      throw Object.assign(new Error('DNSPod HTTP request failed'), { code: `DNSPOD_HTTP_${response.statusCode}` });
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch (_) {
      throw Object.assign(new Error('DNSPod response was not JSON'), { code: 'DNSPOD_RESPONSE_INVALID' });
    }
    if (parsed?.Response?.Error) {
      throw Object.assign(new Error('DNSPod API request failed'), {
        code: safeApiErrorCode(parsed.Response.Error.Code)
      });
    }
    if (!parsed?.Response || typeof parsed.Response.RequestId !== 'string') {
      throw Object.assign(new Error('DNSPod response shape was invalid'), { code: 'DNSPOD_RESPONSE_INVALID' });
    }
    return parsed.Response;
  }

  return Object.freeze({ call });
}

function normalizedPhysicalCandidates(interfaces) {
  const seen = new Set();
  return (interfaces || []).filter((candidate) => {
    const address = String(candidate?.address || '').trim();
    if (!net.isIPv4(address) || seen.has(address)) return false;
    seen.add(address);
    return true;
  }).map((candidate) => ({
    address: String(candidate.address).trim(),
    interface: String(candidate.interface || '').trim()
  }));
}

function interfacePriority(name) {
  const normalized = String(name || '').toLowerCase();
  if (/ethernet|以太网|^eth\d*$|^en\d+$/.test(normalized)) return 30;
  if (/wi-?fi|wlan|无线/.test(normalized)) return 20;
  return 10;
}

function ipv4Numeric(address) {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

function selectDesktopNexaIpv4(interfaces, {
  defaultRouteAddress = null,
  currentDnsAddress = null
} = {}) {
  const candidates = normalizedPhysicalCandidates(interfaces);
  if (candidates.length === 0) return null;
  const byAddress = new Map(candidates.map((candidate) => [candidate.address, candidate]));
  if (byAddress.has(defaultRouteAddress)) return byAddress.get(defaultRouteAddress);
  if (byAddress.has(currentDnsAddress)) return byAddress.get(currentDnsAddress);
  return [...candidates].sort((left, right) =>
    interfacePriority(right.interface) - interfacePriority(left.interface) ||
    left.interface.localeCompare(right.interface) ||
    ipv4Numeric(left.address) - ipv4Numeric(right.address)
  )[0];
}

function resolveDefaultRouteIpv4({
  socketFactory = () => dgram.createSocket('udp4'),
  timeoutMs = 1000
} = {}) {
  return new Promise((resolve) => {
    const socket = socketFactory();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      resolve(net.isIPv4(value) ? value : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    socket.once('error', () => finish(null));
    try {
      socket.connect(53, '119.29.29.29', () => finish(socket.address()?.address));
    } catch (_) {
      finish(null);
    }
  });
}

function exactManagedRecords(response, { subDomain }) {
  return (response?.RecordList || []).filter((record) =>
    record?.Name === subDomain && record?.Type === 'A' && record?.Line === DEFAULT_RECORD_LINE
  );
}

function result(state, details = {}) {
  return Object.freeze({ state, ...details });
}

function createDnsPodDdnsUpdater({
  domain,
  subDomain,
  ttl = DEFAULT_DDNS_TTL,
  interfacesProvider,
  credentialProvider,
  defaultRouteProvider = resolveDefaultRouteIpv4,
  apiClientFactory = createDnsPodApiClient
}) {
  if (!domain || !subDomain) throw new Error('Managed DNSPod hostname is required');
  if (typeof interfacesProvider !== 'function') throw new Error('Physical interface provider is required');
  if (typeof credentialProvider !== 'function') throw new Error('Credential provider is required');

  return Object.freeze({
    async reconcile(reason = 'manual') {
      const interfaces = normalizedPhysicalCandidates(interfacesProvider());
      const defaultRouteAddress = await Promise.resolve(defaultRouteProvider()).catch(() => null);
      const preliminary = selectDesktopNexaIpv4(interfaces, { defaultRouteAddress });
      if (!preliminary) {
        return result('FAILED_SOFT', { reason, errorCode: 'DDNS_PHYSICAL_IPV4_UNAVAILABLE' });
      }
      const credentials = await Promise.resolve(credentialProvider()).catch(() => null);
      if (!credentials?.secretId || !credentials?.secretKey) {
        return result('FAILED_SOFT', {
          reason,
          address: preliminary.address,
          interface: preliminary.interface,
          errorCode: 'DDNS_CREDENTIAL_UNAVAILABLE'
        });
      }
      try {
        const api = apiClientFactory(credentials);
        const described = await api.call('DescribeRecordList', {
          Domain: domain,
          SubDomain: subDomain,
          RecordType: 'A',
          RecordLine: DEFAULT_RECORD_LINE,
          Limit: 100,
          ErrorOnEmpty: 'no'
        });
        const records = exactManagedRecords(described, { subDomain });
        if (records.length > 1) {
          return result('FAILED_SOFT', {
            reason,
            address: preliminary.address,
            interface: preliminary.interface,
            errorCode: 'DDNS_DUPLICATE_MANAGED_RECORDS'
          });
        }
        const record = records[0] || null;
        const selected = selectDesktopNexaIpv4(interfaces, {
          defaultRouteAddress,
          currentDnsAddress: record?.Value
        });
        if (!selected) {
          return result('FAILED_SOFT', { reason, errorCode: 'DDNS_PHYSICAL_IPV4_UNAVAILABLE' });
        }
        if (!record) {
          await api.call('CreateRecord', {
            Domain: domain,
            SubDomain: subDomain,
            RecordType: 'A',
            RecordLine: DEFAULT_RECORD_LINE,
            Value: selected.address,
            TTL: ttl,
            Remark: 'NEXA Desktop DDNS'
          });
          return result('UPDATED', {
            reason,
            action: 'CREATED',
            before: null,
            after: selected.address,
            address: selected.address,
            interface: selected.interface,
            ttl
          });
        }
        if (record.Status !== 'ENABLE') {
          return result('FAILED_SOFT', {
            reason,
            address: selected.address,
            interface: selected.interface,
            errorCode: 'DDNS_MANAGED_RECORD_DISABLED'
          });
        }
        if (record.Value === selected.address && Number(record.TTL) === ttl) {
          return result('UNCHANGED', {
            reason,
            action: 'SKIPPED',
            before: record.Value,
            after: record.Value,
            address: selected.address,
            interface: selected.interface,
            ttl
          });
        }
        await api.call('ModifyDynamicDNS', {
          Domain: domain,
          RecordId: record.RecordId,
          RecordLine: DEFAULT_RECORD_LINE,
          SubDomain: subDomain,
          Value: selected.address,
          TTL: ttl
        });
        return result('UPDATED', {
          reason,
          action: 'MODIFIED',
          before: record.Value,
          after: selected.address,
          address: selected.address,
          interface: selected.interface,
          ttl
        });
      } catch (error) {
        return result('FAILED_SOFT', {
          reason,
          address: preliminary.address,
          interface: preliminary.interface,
          errorCode: String(error?.code || 'DDNS_UPDATE_FAILED').slice(0, 128)
        });
      }
    }
  });
}

module.exports = {
  DEFAULT_DDNS_TTL,
  DEFAULT_RECORD_LINE,
  createDnsPodApiClient,
  createDnsPodDdnsUpdater,
  createTencentCloudAuthorization,
  normalizedPhysicalCandidates,
  resolveDefaultRouteIpv4,
  selectDesktopNexaIpv4
};
