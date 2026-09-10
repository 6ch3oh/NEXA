'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const TLS_IDENTITY_VERSION = '0.1.0';
const TLS_CERT_VALIDITY_DAYS = 397;
const TLS_EXPIRY_WARNING_DAYS = 30;
const PRIVATE_KEY_FILE = 'private-key.pem';
const CERTIFICATE_FILE = 'certificate.pem';
const METADATA_FILE = 'identity.json';

function concat(parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, ...parts) {
  const body = concat(parts);
  return concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts) => der(0x30, ...parts);
const set = (...parts) => der(0x31, ...parts);
const octetString = (value) => der(0x04, value);
const utf8String = (value) => der(0x0c, Buffer.from(value, 'utf8'));
const boolean = (value) => der(0x01, Buffer.from([value ? 0xff : 0x00]));
const bitString = (value, unusedBits = 0) => der(0x03, Buffer.from([unusedBits]), value);

function integer(value) {
  let bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from([Number(value)]);
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}

function base128(value) {
  const bytes = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
    bytes.unshift(0x80 | (rest & 0x7f));
  }
  return Buffer.from(bytes);
}

function oid(value) {
  const arcs = value.split('.').map(Number);
  if (arcs.length < 2 || arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0)) {
    throw new Error('invalid object identifier');
  }
  return der(0x06, concat([base128((arcs[0] * 40) + arcs[1]), ...arcs.slice(2).map(base128)]));
}

function utcTime(date) {
  const year = String(date.getUTCFullYear()).slice(-2);
  const value = `${year}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
  return der(0x17, Buffer.from(value, 'ascii'));
}

function algorithmIdentifier() {
  return sequence(oid('1.2.840.10045.4.3.2'));
}

function distinguishedName() {
  return sequence(set(sequence(oid('2.5.4.3'), utf8String('NEXA Core Mobile'))));
}

function extension(id, value, critical = false) {
  return sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));
}

function ipv4Bytes(value) {
  if (net.isIP(value) !== 4) return null;
  return Buffer.from(value.split('.').map(Number));
}

function subjectAltNames(lanAddresses = []) {
  const names = [der(0x82, Buffer.from('localhost', 'ascii')), der(0x82, Buffer.from('nexa-core.local', 'ascii')), der(0x87, Buffer.from([127, 0, 0, 1]))];
  const seen = new Set(['127.0.0.1']);
  for (const entry of lanAddresses) {
    const address = typeof entry === 'string' ? entry : entry?.address;
    const bytes = ipv4Bytes(String(address || ''));
    if (!bytes || seen.has(address)) continue;
    seen.add(address);
    names.push(der(0x87, bytes));
  }
  return sequence(...names);
}

function pem(label, bytes) {
  const body = Buffer.from(bytes).toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function buildCertificate({ publicKeyDer, privateKey, serial, notBefore, notAfter, lanAddresses }) {
  const extensions = sequence(
    extension('2.5.29.19', sequence(), true),
    extension('2.5.29.15', bitString(Buffer.from([0x80]), 7), true),
    extension('2.5.29.37', sequence(oid('1.3.6.1.5.5.7.3.1'))),
    extension('2.5.29.17', subjectAltNames(lanAddresses))
  );
  const tbs = sequence(
    der(0xa0, integer(2)),
    integer(serial),
    algorithmIdentifier(),
    distinguishedName(),
    sequence(utcTime(notBefore), utcTime(notAfter)),
    distinguishedName(),
    publicKeyDer,
    der(0xa3, extensions)
  );
  const signature = crypto.sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  return sequence(tbs, algorithmIdentifier(), bitString(signature));
}

function assertSafePath(targetPath, allowMissing = false) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) throw new Error(`TLS identity path must not be a symlink: ${targetPath}`);
    return stat;
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  }
}

function ensureIdentityDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = assertSafePath(directory);
  if (!stat.isDirectory()) throw new Error('TLS identity path must be a directory');
  if (process.platform === 'win32') secureWindowsAcl(directory, true);
  else fs.chmodSync(directory, 0o700);
}

function secureWindowsAcl(targetPath, directory = false, execFileSync = childProcess.execFileSync) {
  const user = `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ''}${os.userInfo().username}`;
  const permission = directory ? `${user}:(OI)(CI)F` : `${user}:(F)`;
  execFileSync('icacls.exe', [targetPath, '/inheritance:r', '/grant:r', permission], {
    stdio: 'ignore',
    windowsHide: true
  });
}

function writeAtomic(filePath, content, mode) {
  assertSafePath(filePath, true);
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const handle = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeFileSync(handle, content);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try { fs.chmodSync(temporary, mode); } catch (_) {}
  fs.renameSync(temporary, filePath);
  if (process.platform === 'win32') secureWindowsAcl(filePath);
  else fs.chmodSync(filePath, mode);
}

function fingerprintHex(certificate) {
  return certificate.fingerprint256.replaceAll(':', '').toLowerCase();
}

function displayFingerprint(hex) {
  return String(hex).match(/.{2}/g).join(':').toUpperCase();
}

function validateIdentity({ privateKeyPem, certificatePem, metadata, nowMs = Date.now() }) {
  const certificate = new crypto.X509Certificate(certificatePem);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicFromPrivate = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const publicFromCertificate = certificate.publicKey.export({ type: 'spki', format: 'der' });
  if (!crypto.timingSafeEqual(publicFromPrivate, publicFromCertificate)) throw new Error('TLS private key does not match certificate');
  if (!certificate.verify(certificate.publicKey)) throw new Error('TLS certificate signature is invalid');
  if (certificate.publicKey.asymmetricKeyType !== 'ec' || certificate.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('TLS certificate must use ECDSA P-256');
  }
  const fingerprint = fingerprintHex(certificate);
  if (metadata?.version !== TLS_IDENTITY_VERSION || metadata?.fingerprint_sha256 !== fingerprint) {
    throw new Error('TLS identity metadata mismatch');
  }
  const expiresAtMs = Date.parse(certificate.validTo);
  return {
    version: TLS_IDENTITY_VERSION,
    privateKeyPem,
    certificatePem,
    fingerprint,
    fingerprintDisplay: displayFingerprint(fingerprint),
    issuedAt: certificate.validFrom,
    expiresAt: certificate.validTo,
    expiresWithin30Days: expiresAtMs - nowMs <= TLS_EXPIRY_WARNING_DAYS * 86400000,
    expired: expiresAtMs <= nowMs,
    keyAlgorithm: 'ECDSA P-256',
    validityDays: TLS_CERT_VALIDITY_DAYS
  };
}

function generateIdentity(directory, { now = () => new Date(), randomBytes = crypto.randomBytes, lanAddresses = [] } = {}) {
  ensureIdentityDirectory(directory);
  const issued = new Date(now());
  issued.setUTCMilliseconds(0);
  const expires = new Date(issued.getTime() + TLS_CERT_VALIDITY_DAYS * 86400000);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'der' }
  });
  const serial = Buffer.from(randomBytes(20));
  serial[0] &= 0x7f;
  if (serial.every((byte) => byte === 0)) serial[serial.length - 1] = 1;
  const certificateDer = buildCertificate({
    publicKeyDer: publicKey,
    privateKey,
    serial,
    notBefore: issued,
    notAfter: expires,
    lanAddresses
  });
  const certificatePem = pem('CERTIFICATE', certificateDer);
  const certificate = new crypto.X509Certificate(certificatePem);
  const metadata = {
    version: TLS_IDENTITY_VERSION,
    created_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    fingerprint_sha256: fingerprintHex(certificate)
  };
  writeAtomic(path.join(directory, PRIVATE_KEY_FILE), privateKey, 0o600);
  writeAtomic(path.join(directory, CERTIFICATE_FILE), certificatePem, 0o644);
  writeAtomic(path.join(directory, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 0o600);
  return validateIdentity({ privateKeyPem: privateKey, certificatePem, metadata, nowMs: issued.getTime() });
}

function loadIdentity(directory, options = {}) {
  ensureIdentityDirectory(directory);
  const keyPath = path.join(directory, PRIVATE_KEY_FILE);
  const certificatePath = path.join(directory, CERTIFICATE_FILE);
  const metadataPath = path.join(directory, METADATA_FILE);
  const present = [keyPath, certificatePath, metadataPath].map((filePath) => Boolean(assertSafePath(filePath, true)));
  if (present.every((value) => !value)) return generateIdentity(directory, options);
  if (!present.every(Boolean)) throw new Error('TLS identity is incomplete; refusing silent replacement');
  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  const certificatePem = fs.readFileSync(certificatePath, 'utf8');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  return validateIdentity({ privateKeyPem, certificatePem, metadata, nowMs: options.nowMs ?? Date.now() });
}

function rotateIdentity(directory, { confirmed = false, ...options } = {}) {
  if (confirmed !== true) throw new Error('explicit certificate rotation confirmation is required');
  return generateIdentity(directory, options);
}

module.exports = {
  CERTIFICATE_FILE,
  METADATA_FILE,
  PRIVATE_KEY_FILE,
  TLS_CERT_VALIDITY_DAYS,
  TLS_EXPIRY_WARNING_DAYS,
  TLS_IDENTITY_VERSION,
  displayFingerprint,
  loadMobileTlsIdentity: loadIdentity,
  rotateMobileTlsIdentity: rotateIdentity,
  _test: { secureWindowsAcl }
};
