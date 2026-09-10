'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const PAIRING_CONTRACT_VERSION = '0.1.0';
const PAIRING_PROTOCOL_FAMILY = 'NEXA_MOBILE_SYNC_V1';
const PAIRING_PATH = '/nexa/mobile/pairing';
const PAIRING_EXPIRY_MS = 5 * 60 * 1000;
const DELIVERY_ACK_MS = 30 * 1000;
const MAX_INVALID_CLAIMS = 5;
const TERMINAL_STATES = new Set(['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'CONSUMED']);

class PairingError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.name = 'PairingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function safeDeviceId(value) {
  const deviceId = typeof value === 'string' ? value.trim() : '';
  if (!deviceId || deviceId.length > 256 || /[\u0000-\u001f\u007f]/.test(deviceId)) return '';
  if (deviceId === '__proto__' || deviceId === 'prototype' || deviceId === 'constructor') return '';
  return deviceId;
}

function summarizeDeviceId(deviceId) {
  if (!deviceId) return null;
  if (deviceId.length <= 16) return deviceId;
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-6)}`;
}

function deviceReference(deviceId) {
  return crypto.createHash('sha256').update(`nexa-mobile-device-reference-v1\0${deviceId}`, 'utf8').digest('hex').slice(0, 24);
}

function sasFor({ claimSecret, pairingId, deviceId, certificateFingerprint }) {
  const transcript = `${pairingId}|${deviceId}|${certificateFingerprint}`;
  const digest = crypto.createHmac('sha256', claimSecret).update(transcript, 'utf8').digest();
  return String(digest.readUInt32BE(0) % 1000000).padStart(6, '0');
}

function generateDeviceCredential(randomBytes = crypto.randomBytes) {
  return base64Url(randomBytes(32));
}

function isLanAddress(value) {
  let address = String(value || '').trim().toLowerCase();
  if (address.startsWith('::ffff:')) address = address.slice(7);
  if (address === '::1' || address === 'localhost') return true;
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  if (net.isIP(address) === 6) return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb');
  return false;
}

function createMobilePairingAuthority({
  credentialAuthority,
  certificateFingerprint,
  endpoint,
  endpointProvider = null,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  randomUUID = crypto.randomUUID,
  sessionExpiryMs = PAIRING_EXPIRY_MS,
  deliveryAckMs = DELIVERY_ACK_MS,
  globalRateLimit = 120
} = {}) {
  if (!credentialAuthority || typeof credentialAuthority.registerDeviceCredential !== 'function' || typeof credentialAuthority.revokeDeviceCredential !== 'function') {
    throw new Error('existing mobile device credential authority with register/revoke is required');
  }
  if (!/^[a-f0-9]{64}$/.test(String(certificateFingerprint))) throw new Error('certificate fingerprint is invalid');
  function resolveEndpoint() {
    const resolved = typeof endpointProvider === 'function' ? endpointProvider() : endpoint;
    if (!resolved || resolved.transport !== 'HTTPS' || !resolved.host || !Number.isInteger(resolved.port)) {
      throw new Error('HTTPS pairing endpoint is required');
    }
    return { transport: 'HTTPS', host: resolved.host, port: resolved.port };
  }
  resolveEndpoint();

  const sessions = new Map();
  let rateWindowStartedAt = now();
  let rateWindowCount = 0;

  function checkRateAndSource(sourceIp) {
    if (!isLanAddress(sourceIp)) throw new PairingError('LAN_SOURCE_REQUIRED', 403);
    const current = now();
    if (current - rateWindowStartedAt >= 60000) {
      rateWindowStartedAt = current;
      rateWindowCount = 0;
    }
    rateWindowCount += 1;
    if (rateWindowCount > globalRateLimit) throw new PairingError('PAIRING_RATE_LIMITED', 429);
  }

  function revokeBinding(session) {
    if (session.bindingCreated && session.deviceId) {
      credentialAuthority.revokeDeviceCredential(session.deviceId);
      session.bindingCreated = false;
    }
    session.rawCredential = null;
  }

  function transitionTerminal(session, state) {
    revokeBinding(session);
    session.state = state;
    session.claimSecret = null;
    session.claimSecretDigest = null;
    session.terminalAt = new Date(now()).toISOString();
  }

  function expireIfNeeded(session) {
    const current = now();
    if (!TERMINAL_STATES.has(session.state) && current >= session.expiresAtMs) transitionTerminal(session, 'EXPIRED');
    else if (session.state === 'DELIVERED' && current >= session.deliveryDeadlineMs) transitionTerminal(session, 'FAILED');
    return session;
  }

  function requireSession(pairingId) {
    const session = sessions.get(String(pairingId));
    if (!session) throw new PairingError('PAIRING_NOT_FOUND', 404);
    expireIfNeeded(session);
    return session;
  }

  function validateSecret(session, claimSecret, countInvalid = true) {
    if (!session.claimSecretDigest) throw new PairingError('PAIRING_TERMINAL', 410);
    const candidate = crypto.createHash('sha256').update(String(claimSecret || ''), 'utf8').digest();
    if (!crypto.timingSafeEqual(candidate, session.claimSecretDigest)) {
      if (countInvalid) {
        session.invalidClaims += 1;
        if (session.invalidClaims >= MAX_INVALID_CLAIMS) transitionTerminal(session, 'FAILED');
      }
      throw new PairingError('PAIRING_AUTHENTICATION_FAILED', 401);
    }
  }

  function assertActive(session) {
    if (TERMINAL_STATES.has(session.state)) throw new PairingError('PAIRING_TERMINAL', 410);
  }

  function issueWhenConfirmed(session) {
    if (!session.androidConfirmed || !session.desktopConfirmed || session.bindingCreated) return;
    const credential = generateDeviceCredential(randomBytes);
    credentialAuthority.registerDeviceCredential(session.deviceId, credential);
    session.rawCredential = credential;
    session.bindingCreated = true;
    session.state = 'BOTH_CONFIRMED';
  }

  function createSession() {
    const current = now();
    const pairingId = randomUUID();
    const claimSecret = base64Url(randomBytes(32));
    const issuedAt = new Date(current).toISOString();
    const expiresAtMs = current + sessionExpiryMs;
    const sessionEndpoint = resolveEndpoint();
    const payload = {
      schema_version: PAIRING_CONTRACT_VERSION,
      protocol_family: PAIRING_PROTOCOL_FAMILY,
      pairing_id: pairingId,
      issued_at: issuedAt,
      expires_at: new Date(expiresAtMs).toISOString(),
      endpoint: sessionEndpoint,
      pairing_path: PAIRING_PATH,
      server_certificate_fingerprint_sha256: certificateFingerprint,
      claim_secret: claimSecret
    };
    sessions.set(pairingId, {
      pairingId,
      endpoint: sessionEndpoint,
      issuedAt,
      expiresAtMs,
      state: 'PENDING',
      claimSecret,
      claimSecretDigest: crypto.createHash('sha256').update(claimSecret, 'utf8').digest(),
      invalidClaims: 0,
      deviceId: null,
      sas: null,
      androidConfirmed: false,
      desktopConfirmed: false,
      bindingCreated: false,
      rawCredential: null,
      deliveryDeadlineMs: null
    });
    return { pairing_id: pairingId, payload, payload_json: JSON.stringify(payload) };
  }

  function claim({ pairingId, claimSecret, deviceId, sourceIp }) {
    checkRateAndSource(sourceIp);
    const session = requireSession(pairingId);
    assertActive(session);
    validateSecret(session, claimSecret);
    const normalized = safeDeviceId(deviceId);
    if (!normalized) {
      session.invalidClaims += 1;
      if (session.invalidClaims >= MAX_INVALID_CLAIMS) transitionTerminal(session, 'FAILED');
      throw new PairingError('DEVICE_ID_INVALID');
    }
    if (session.deviceId && session.deviceId !== normalized) throw new PairingError('PAIRING_ALREADY_CLAIMED', 409);
    if (!session.deviceId) {
      session.deviceId = normalized;
      session.sas = sasFor({ claimSecret, pairingId: session.pairingId, deviceId: normalized, certificateFingerprint });
      session.state = 'CLAIMED';
    }
    return clientProjection(session);
  }

  function clientConfirm({ pairingId, claimSecret, deviceId, sourceIp }) {
    checkRateAndSource(sourceIp);
    const session = requireSession(pairingId);
    assertActive(session);
    validateSecret(session, claimSecret);
    if (!session.deviceId || session.deviceId !== safeDeviceId(deviceId)) throw new PairingError('DEVICE_ID_MISMATCH', 409);
    session.androidConfirmed = true;
    issueWhenConfirmed(session);
    return clientProjection(session);
  }

  function desktopConfirm(pairingId, confirmed) {
    const session = requireSession(pairingId);
    assertActive(session);
    if (!session.deviceId) throw new PairingError('PAIRING_NOT_CLAIMED', 409);
    if (confirmed !== true) {
      transitionTerminal(session, 'CANCELLED');
      return presentation(pairingId);
    }
    session.desktopConfirmed = true;
    issueWhenConfirmed(session);
    return presentation(pairingId);
  }

  function deliver({ pairingId, claimSecret, deviceId, sourceIp }) {
    checkRateAndSource(sourceIp);
    const session = requireSession(pairingId);
    validateSecret(session, claimSecret);
    if (session.deviceId !== safeDeviceId(deviceId)) throw new PairingError('DEVICE_ID_MISMATCH', 409);
    if (session.state === 'DELIVERED') {
      transitionTerminal(session, 'CONSUMED');
      throw new PairingError('PAIRING_CREDENTIAL_ALREADY_DELIVERED', 410);
    }
    if (session.state !== 'BOTH_CONFIRMED' || !session.rawCredential) throw new PairingError('PAIRING_NOT_READY', 409);
    const credential = session.rawCredential;
    session.rawCredential = null;
    session.state = 'DELIVERED';
    session.deliveryDeadlineMs = Math.min(now() + deliveryAckMs, session.expiresAtMs);
    return {
      contract_version: PAIRING_CONTRACT_VERSION,
      pairing_id: session.pairingId,
      device_id: session.deviceId,
      device_credential: credential,
      completion_deadline: new Date(session.deliveryDeadlineMs).toISOString()
    };
  }

  function complete({ pairingId, credential, deviceId, sourceIp }) {
    checkRateAndSource(sourceIp);
    const session = requireSession(pairingId);
    if (session.state !== 'DELIVERED') throw new PairingError('PAIRING_NOT_DELIVERED', 409);
    const authorization = credentialAuthority.authorizeDevice(credential, deviceId);
    if (!authorization.ok || session.deviceId !== authorization.device_id) {
      transitionTerminal(session, 'FAILED');
      throw new PairingError('PAIRING_COMPLETION_AUTH_FAILED', 401);
    }
    session.bindingCreated = false;
    session.state = 'COMPLETED';
    session.claimSecret = null;
    session.claimSecretDigest = null;
    session.terminalAt = new Date(now()).toISOString();
    return { contract_version: PAIRING_CONTRACT_VERSION, pairing_id: session.pairingId, device_id: session.deviceId, status: 'COMPLETED' };
  }

  function cancel(pairingId) {
    const session = requireSession(pairingId);
    if (!TERMINAL_STATES.has(session.state)) transitionTerminal(session, 'CANCELLED');
    return presentation(pairingId);
  }

  function cancelForDevice(deviceId) {
    const normalized = safeDeviceId(deviceId);
    for (const session of sessions.values()) {
      if (session.deviceId === normalized && !TERMINAL_STATES.has(session.state)) transitionTerminal(session, 'CANCELLED');
    }
  }

  function revokeDevicePairing(deviceId) {
    const normalized = safeDeviceId(deviceId);
    if (!normalized) throw new PairingError('DEVICE_ID_INVALID');
    cancelForDevice(normalized);
    return credentialAuthority.revokeDeviceCredential(normalized);
  }

  function revokeAllPairedDevices() {
    const results = credentialAuthority.listDeviceCredentials().map((device) => revokeDevicePairing(device.device_id));
    return { revoked: results.filter((result) => result.revoked).length };
  }

  function pairedDevices() {
    return credentialAuthority.listDeviceCredentials().map((device) => ({
      device_ref: deviceReference(device.device_id),
      device_id_summary: summarizeDeviceId(device.device_id),
      paired: true,
      credential_configured: true,
      paired_at: device.paired_at,
      last_authenticated_at: device.last_authenticated_at,
      connection_state: device.connection_state,
      trusted_endpoint_candidates: device.trusted_endpoint_candidates,
      certificate_fingerprint_summary: `${certificateFingerprint.slice(0, 12)}…${certificateFingerprint.slice(-8)}`
    }));
  }

  function revokeDeviceReference(reference) {
    const match = credentialAuthority.listDeviceCredentials().find((device) => deviceReference(device.device_id) === String(reference || ''));
    if (!match) throw new PairingError('PAIRED_DEVICE_NOT_FOUND', 404);
    return revokeDevicePairing(match.device_id);
  }

  function presentation(pairingId) {
    const session = expireIfNeeded(requireSession(pairingId));
    return {
      contract_version: PAIRING_CONTRACT_VERSION,
      pairing_id: session.pairingId,
      state: session.state,
      issued_at: session.issuedAt,
      expires_at: new Date(session.expiresAtMs).toISOString(),
      remaining_ms: Math.max(0, session.expiresAtMs - now()),
      endpoint: { ...session.endpoint },
      certificate_fingerprint_sha256: certificateFingerprint,
      device_id_summary: summarizeDeviceId(session.deviceId),
      sas: session.sas,
      android_confirmed: session.androidConfirmed,
      desktop_confirmed: session.desktopConfirmed,
      credential_issued: session.bindingCreated || session.state === 'DELIVERED' || session.state === 'COMPLETED'
    };
  }

  function clientProjection(session) {
    expireIfNeeded(session);
    return {
      contract_version: PAIRING_CONTRACT_VERSION,
      pairing_id: session.pairingId,
      state: session.state,
      device_id: session.deviceId,
      sas: session.sas,
      android_confirmed: session.androidConfirmed,
      desktop_confirmed: session.desktopConfirmed,
      expires_at: new Date(session.expiresAtMs).toISOString()
    };
  }

  function statusForClient({ pairingId, claimSecret, sourceIp }) {
    checkRateAndSource(sourceIp);
    const session = requireSession(pairingId);
    validateSecret(session, claimSecret, false);
    return clientProjection(session);
  }

  function shutdown() {
    for (const session of sessions.values()) {
      if (!TERMINAL_STATES.has(session.state)) transitionTerminal(session, 'CANCELLED');
    }
  }

  function hasActiveSessions() {
    for (const session of sessions.values()) {
      expireIfNeeded(session);
      if (!TERMINAL_STATES.has(session.state)) return true;
    }
    return false;
  }

  return {
    cancel,
    claim,
    clientConfirm,
    complete,
    createSession,
    deliver,
    desktopConfirm,
    hasActiveSessions,
    pairedDevices,
    presentation,
    revokeAllPairedDevices,
    revokeDevicePairing,
    revokeDeviceReference,
    shutdown,
    statusForClient
  };
}

module.exports = {
  DELIVERY_ACK_MS,
  MAX_INVALID_CLAIMS,
  PAIRING_CONTRACT_VERSION,
  PAIRING_EXPIRY_MS,
  PAIRING_PATH,
  PAIRING_PROTOCOL_FAMILY,
  PairingError,
  createMobilePairingAuthority,
  deviceReference,
  generateDeviceCredential,
  isLanAddress,
  sasFor
};
