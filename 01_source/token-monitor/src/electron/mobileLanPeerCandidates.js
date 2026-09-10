'use strict';

const childProcess = require('node:child_process');

const MAX_NEIGHBOR_CANDIDATES = 24;

function ipv4Parts(value) {
  const parts = String(value || '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function ipv4Number(value) {
  const parts = ipv4Parts(value);
  if (!parts) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isPrivateLanIpv4(value) {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 ||
    parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
    parts[0] === 169 && parts[1] === 254;
}

function sameIpv4Subnet(host, entry) {
  const hostNumber = ipv4Number(host);
  const localNumber = ipv4Number(entry?.address);
  const maskNumber = ipv4Number(entry?.netmask || '255.255.255.0');
  if (hostNumber === null || localNumber === null || maskNumber === null) return false;
  return (hostNumber & maskNumber) === (localNumber & maskNumber);
}

function parseWindowsArp(output) {
  const candidates = [];
  let localAddress = '';
  for (const line of String(output || '').split(/\r?\n/)) {
    const interfaceMatch = line.match(/^\s*Interface:\s*(\d+\.\d+\.\d+\.\d+)\s+/i);
    if (interfaceMatch) {
      localAddress = interfaceMatch[1];
      continue;
    }
    const peerMatch = line.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s+(dynamic|static)\s*$/i);
    if (!peerMatch || !localAddress || !isPrivateLanIpv4(peerMatch[1])) continue;
    candidates.push({
      host: peerMatch[1],
      localAddress,
      source: 'NEIGHBOR_CACHE'
    });
  }
  return candidates.slice(0, MAX_NEIGHBOR_CANDIDATES);
}

function windowsArpPeerCandidates({
  platform = process.platform,
  execFile = childProcess.execFile
} = {}) {
  if (platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('arp.exe', ['-a'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1500,
      maxBuffer: 256 * 1024
    }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(parseWindowsArp(stdout));
    });
  });
}

module.exports = {
  MAX_NEIGHBOR_CANDIDATES,
  ipv4Number,
  isPrivateLanIpv4,
  parseWindowsArp,
  sameIpv4Subnet,
  windowsArpPeerCandidates
};
