'use strict';

const net = require('node:net');

function expandIpv4Tail(parts) {
  const last = parts.at(-1);
  if (!last || net.isIP(last) !== 4) return parts;
  const bytes = last.split('.').map(Number);
  return [...parts.slice(0, -1), ((bytes[0] << 8) | bytes[1]).toString(16), ((bytes[2] << 8) | bytes[3]).toString(16)];
}

function canonicalIp(address) {
  if (typeof address !== 'string') return null;
  const input = address.trim().split('%')[0].toLowerCase();
  const version = net.isIP(input);
  if (version === 4) return input.split('.').map(Number).join('.');
  if (version !== 6 || (input.match(/::/g) || []).length > 1) return null;
  const halves = input.split('::');
  const left = expandIpv4Tail(halves[0] ? halves[0].split(':') : []);
  const right = expandIpv4Tail(halves[1] ? halves[1].split(':') : []);
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.map((part) => part.padStart(4, '0')).join(':');
}

function ipAddressesEqual(left, right) {
  const a = canonicalIp(left);
  const b = canonicalIp(right);
  return a !== null && a === b;
}

function isPublicIp(address) {
  const canonical = canonicalIp(address);
  if (!canonical) return false;
  if (!canonical.includes(':')) {
    const [a, b, c] = canonical.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0 && ![9, 10].includes(Number(canonical.split('.')[3])))
      || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
      || a >= 224);
  }
  if (canonical.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const groups = canonical.split(':');
    const high = Number.parseInt(groups[6], 16);
    const low = Number.parseInt(groups[7], 16);
    return isPublicIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return !(canonical === '0000:0000:0000:0000:0000:0000:0000:0000'
    || canonical === '0000:0000:0000:0000:0000:0000:0000:0001'
    || canonical.startsWith('0064:ff9b:0000:')
    || canonical.startsWith('0064:ff9b:0001:')
    || canonical.startsWith('0100:0000:0000:0000:')
    || canonical.startsWith('2001:0002:')
    || canonical.startsWith('2001:0010:')
    || canonical.startsWith('2001:0db8:')
    || /^[fF][c-d]/.test(canonical)
    || /^fe[89ab]/i.test(canonical)
    || canonical.startsWith('ff'));
}

module.exports = { canonicalIp, ipAddressesEqual, isPublicIp };
