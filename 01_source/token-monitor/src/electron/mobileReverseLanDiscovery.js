'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const { ipv4Number, isPrivateLanIpv4, sameIpv4Subnet } = require('./mobileLanPeerCandidates');

const DISCOVERY_PORT = 17323;
const REVERSE_LAN_PORT = 17324;
const DISCOVERY_PROTOCOL = 'NEXA_REVERSE_LAN_DISCOVERY_V1';
const MAX_DISCOVERY_RESPONSE_BYTES = 128;
const MAX_DISCOVERED_PEERS = 8;

function directedBroadcastAddress(entry) {
  const address = ipv4Number(entry?.address);
  const netmask = ipv4Number(entry?.netmask);
  if (address === null || netmask === null) return null;
  const broadcast = (address | (~netmask >>> 0)) >>> 0;
  return [broadcast >>> 24, broadcast >>> 16 & 255, broadcast >>> 8 & 255, broadcast & 255].join('.');
}

function discoveryRequest(nonce) {
  return Buffer.from(`${DISCOVERY_PROTOCOL} DISCOVER ${nonce}\n`, 'ascii');
}

function parseDiscoveryResponse(message, remoteInfo, expectedNonce, entry) {
  if (!Buffer.isBuffer(message) || message.length > MAX_DISCOVERY_RESPONSE_BYTES) return null;
  const match = message.toString('ascii').match(
    new RegExp(`^${DISCOVERY_PROTOCOL} AVAILABLE ([A-Za-z0-9_-]{16,64}) (${REVERSE_LAN_PORT})\\n$`)
  );
  if (!match || match[1] !== expectedNonce) return null;
  const host = String(remoteInfo?.address || '').replace(/^::ffff:/, '');
  if (!isPrivateLanIpv4(host) || !sameIpv4Subnet(host, entry)) return null;
  return {
    host,
    localAddress: entry.address,
    source: 'UDP_DISCOVERY'
  };
}

function discoverOnInterface(entry, {
  timeoutMs,
  randomBytes,
  dgramModule
}) {
  const broadcast = directedBroadcastAddress(entry);
  if (!broadcast || !isPrivateLanIpv4(entry?.address)) return Promise.resolve([]);
  const nonce = randomBytes(18).toString('base64url');
  return new Promise((resolve) => {
    const found = [];
    const seen = new Set();
    const socket = dgramModule.createSocket({ type: 'udp4', reuseAddr: false });
    let finished = false;
    let timer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      resolve(found);
    };
    timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    socket.on('error', finish);
    socket.on('message', (message, remoteInfo) => {
      const candidate = parseDiscoveryResponse(message, remoteInfo, nonce, entry);
      if (!candidate || seen.has(candidate.host)) return;
      seen.add(candidate.host);
      found.push(candidate);
      if (found.length >= MAX_DISCOVERED_PEERS) finish();
    });
    socket.bind(0, entry.address, () => {
      try {
        socket.setBroadcast(true);
        socket.send(discoveryRequest(nonce), DISCOVERY_PORT, broadcast, (error) => {
          if (error) finish();
        });
      } catch (_) {
        finish();
      }
    });
  });
}

async function discoverReverseLanPeers({
  interfaces = [],
  timeoutMs = 180,
  randomBytes = crypto.randomBytes,
  dgramModule = dgram
} = {}) {
  const results = await Promise.all((interfaces || []).map((entry) => discoverOnInterface(entry, {
    timeoutMs,
    randomBytes,
    dgramModule
  })));
  return results.flat().slice(0, MAX_DISCOVERED_PEERS);
}

module.exports = {
  DISCOVERY_PORT,
  DISCOVERY_PROTOCOL,
  MAX_DISCOVERED_PEERS,
  directedBroadcastAddress,
  discoverReverseLanPeers,
  discoveryRequest,
  parseDiscoveryResponse
};
