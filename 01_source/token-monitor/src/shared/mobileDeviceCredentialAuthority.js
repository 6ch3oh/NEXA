'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const CREDENTIAL_SCHEME = 'nexa-mobile-device-sha256-v1';
const MIN_CREDENTIAL_LENGTH = 24;
const MAX_TRUSTED_PEER_CANDIDATES = 4;
const TRUSTED_PEER_CANDIDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PEER_CANDIDATE_PERSIST_INTERVAL_MS = 60 * 1000;
const RECENT_AUTHENTICATION_MS = 2 * 60 * 1000;
const RELAY_RENDEZVOUS_WINDOW_MS = 5 * 60 * 1000;
const RELAY_RENDEZVOUS_CONTEXT = 'nexa-relay-rendezvous-v0.1';
const TRUSTED_DEVICE_CONNECTION_STATES = Object.freeze([
  'PAIRED', 'OFFLINE', 'DISCOVERING', 'CONNECTING', 'AUTHENTICATING',
  'CONNECTED', 'RECONNECTING', 'REVOKED', 'BACKGROUND_RESTRICTED'
]);
const CONNECTION_STATES = new Set([
  ...TRUSTED_DEVICE_CONNECTION_STATES,
  // Read-only compatibility for states persisted or emitted before Wave 006.
  'SEARCHING', 'DISCOVERED', 'NETWORK_CHANGED', 'NEEDS_REPAIRING'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeDeviceId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 256 || id === '__proto__' || id === 'prototype' || id === 'constructor') return '';
  if (/[\u0000-\u001f\u007f]/.test(id)) return '';
  return id;
}

function credentialDigest(credential) {
  return crypto.createHash('sha256')
    .update(`${CREDENTIAL_SCHEME}\0`, 'utf8')
    .update(String(credential), 'utf8')
    .digest('hex');
}

function constantTimeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left)) || !/^[a-f0-9]{64}$/.test(String(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function deviceBindings(document) {
  const devices = document?.credentials?.mobile?.devices;
  return isPlainObject(devices) ? devices : {};
}

function safeRoutedHost(value) {
  const raw = String(value || '').trim().replace(/^\[|\]$/g, '');
  const zoneIndex = raw.indexOf('%');
  const address = zoneIndex >= 0 ? raw.slice(0, zoneIndex) : raw;
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224 ||
      octets.every((part) => part === 255)) return null;
    return { host: octets.join('.'), family: 'IPV4' };
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('ff')) return null;
    return { host: normalized, family: 'IPV6' };
  }
  return null;
}

function safePeerCandidate(value) {
  const routed = safeRoutedHost(value?.host);
  const port = Number(value?.port);
  if (!routed || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const source = String(value?.source || '').toUpperCase();
  if (![
    'DIRECT_AUTHENTICATED',
    'REVERSE_AUTHENTICATED',
    'CAMPUS_ROUTED_AUTHENTICATED'
  ].includes(source)) return null;
  const privateOrLocal = routed.family === 'IPV4'
    ? isPrivateOrCampusLocalIpv4(routed.host)
    : /^(?:fe80:|fc|fd)/.test(routed.host);
  if ((source === 'DIRECT_AUTHENTICATED' || source === 'REVERSE_AUTHENTICATED') && !privateOrLocal) {
    return null;
  }
  return {
    host: routed.host,
    port,
    source
  };
}

function isPrivateOrCampusLocalIpv4(value) {
  const parts = String(value).split('.').map(Number);
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 ||
    parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 ||
    parts[0] === 169 && parts[1] === 254 ||
    parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function relayRendezvousId(credentialDigestHex, windowNumber) {
  if (!/^[a-f0-9]{64}$/.test(String(credentialDigestHex)) || !Number.isSafeInteger(windowNumber)) return '';
  return crypto.createHmac('sha256', Buffer.from(credentialDigestHex, 'hex'))
    .update(`${RELAY_RENDEZVOUS_CONTEXT}\0${windowNumber}`, 'utf8')
    .digest('hex');
}

function createMobileDeviceCredentialAuthority({ credentialStore, now = () => new Date().toISOString() } = {}) {
  if (!credentialStore || typeof credentialStore.readDocument !== 'function' || typeof credentialStore.writeDocument !== 'function') {
    throw new Error('credentialStore with private atomic read/write support is required');
  }
  const authenticatedAtByDevice = new Map();
  const connectionStateByDevice = new Map();

  function instant() {
    const iso = now();
    const milliseconds = Date.parse(iso);
    return { iso, milliseconds: Number.isFinite(milliseconds) ? milliseconds : Date.now() };
  }

  function registerDeviceCredential(deviceIdInput, credentialInput) {
    const deviceId = safeDeviceId(deviceIdInput);
    const credential = typeof credentialInput === 'string' ? credentialInput : '';
    if (!deviceId) throw new Error('device_id is invalid');
    if (credential.length < MIN_CREDENTIAL_LENGTH) throw new Error(`credential must contain at least ${MIN_CREDENTIAL_LENGTH} characters`);
    const digest = credentialDigest(credential);
    const document = credentialStore.readDocument();
    if (!isPlainObject(document.credentials)) document.credentials = {};
    if (!isPlainObject(document.credentials.mobile)) document.credentials.mobile = {};
    if (!isPlainObject(document.credentials.mobile.devices)) document.credentials.mobile.devices = {};
    for (const [existingDeviceId, binding] of Object.entries(document.credentials.mobile.devices)) {
      if (existingDeviceId !== deviceId && constantTimeEqualHex(binding?.credential_digest, digest)) {
        throw new Error('credential is already bound to another device');
      }
    }
    document.credentials.mobile.devices[deviceId] = {
      scheme: CREDENTIAL_SCHEME,
      credential_digest: digest,
      updated_at: instant().iso
    };
    connectionStateByDevice.set(deviceId, 'PAIRED');
    credentialStore.writeDocument(document);
    return { device_id: deviceId };
  }

  function authenticate(credentialInput) {
    const credential = typeof credentialInput === 'string' ? credentialInput : '';
    if (!credential) return { ok: false, error: 'missing_credential' };
    const candidate = credentialDigest(credential);
    const bindings = deviceBindings(credentialStore.readDocument());
    const matches = [];
    for (const [deviceId, binding] of Object.entries(bindings)) {
      if (binding?.scheme !== CREDENTIAL_SCHEME) continue;
      if (constantTimeEqualHex(binding.credential_digest, candidate)) matches.push(deviceId);
    }
    if (matches.length !== 1) return { ok: false, error: 'invalid_credential' };
    return { ok: true, device_id: matches[0] };
  }

  function authorizeDevice(credential, claimedDeviceId) {
    const authenticated = authenticate(credential);
    if (!authenticated.ok) return authenticated;
    if (authenticated.device_id !== safeDeviceId(claimedDeviceId)) {
      return { ok: false, error: 'device_id_mismatch' };
    }
    authenticatedAtByDevice.set(authenticated.device_id, instant());
    connectionStateByDevice.set(authenticated.device_id, 'CONNECTED');
    return authenticated;
  }

  function recordAuthenticatedPeer(deviceIdInput, candidateInput) {
    const deviceId = safeDeviceId(deviceIdInput);
    const candidate = safePeerCandidate(candidateInput);
    if (!deviceId || !candidate) return { recorded: false };
    const document = credentialStore.readDocument();
    const binding = deviceBindings(document)[deviceId];
    if (binding?.scheme !== CREDENTIAL_SCHEME) return { recorded: false };
    const current = instant();
    const existing = Array.isArray(binding.endpoint_candidates)
      ? binding.endpoint_candidates.filter((entry) => safePeerCandidate(entry))
      : [];
    const same = existing.find((entry) => entry.host === candidate.host && entry.port === candidate.port);
    const sameVerifiedAt = Date.parse(same?.last_verified_at || '');
    binding.last_authenticated_at = current.iso;
    if (same && Number.isFinite(sameVerifiedAt) && current.milliseconds - sameVerifiedAt < PEER_CANDIDATE_PERSIST_INTERVAL_MS) {
      return { recorded: false, candidate: { ...candidate } };
    }
    binding.endpoint_candidates = [
      { ...candidate, last_verified_at: current.iso },
      ...existing.filter((entry) => entry.host !== candidate.host || entry.port !== candidate.port)
    ].slice(0, MAX_TRUSTED_PEER_CANDIDATES);
    credentialStore.writeDocument(document);
    return { recorded: true, candidate: { ...candidate } };
  }

  function listTrustedPeerCandidates({ maxAgeMs = TRUSTED_PEER_CANDIDATE_TTL_MS } = {}) {
    const current = instant().milliseconds;
    const candidates = [];
    const seen = new Set();
    for (const [deviceId, binding] of Object.entries(deviceBindings(credentialStore.readDocument()))) {
      if (binding?.scheme !== CREDENTIAL_SCHEME || !Array.isArray(binding.endpoint_candidates)) continue;
      for (const raw of binding.endpoint_candidates) {
        const candidate = safePeerCandidate(raw);
        const verifiedAt = Date.parse(raw?.last_verified_at || '');
        const key = candidate ? `${candidate.host}|${candidate.port}` : '';
        if (!candidate || !Number.isFinite(verifiedAt) || current - verifiedAt > maxAgeMs || seen.has(key)) continue;
        seen.add(key);
        candidates.push({ ...candidate, device_id: deviceId, last_verified_at: raw.last_verified_at });
      }
    }
    return candidates;
  }

  function listRelayRendezvousTokens({ atEpochMs = instant().milliseconds } = {}) {
    if (!Number.isFinite(atEpochMs) || atEpochMs < 0) return [];
    const windowNumber = Math.floor(atEpochMs / RELAY_RENDEZVOUS_WINDOW_MS);
    const validUntil = (windowNumber + 1) * RELAY_RENDEZVOUS_WINDOW_MS;
    return Object.entries(deviceBindings(credentialStore.readDocument()))
      .filter(([, binding]) => binding?.scheme === CREDENTIAL_SCHEME && /^[a-f0-9]{64}$/.test(String(binding.credential_digest)))
      .map(([deviceId, binding]) => ({
        device_id: deviceId,
        rendezvous_id: relayRendezvousId(binding.credential_digest, windowNumber),
        valid_until_epoch_ms: validUntil
      }))
      .filter((entry) => entry.rendezvous_id);
  }

  function pruneStalePeerCandidates({ maxAgeMs = TRUSTED_PEER_CANDIDATE_TTL_MS } = {}) {
    const document = credentialStore.readDocument();
    const current = instant().milliseconds;
    let removed = 0;
    for (const binding of Object.values(deviceBindings(document))) {
      if (!Array.isArray(binding?.endpoint_candidates)) continue;
      const retained = binding.endpoint_candidates.filter((raw) => {
        const verifiedAt = Date.parse(raw?.last_verified_at || '');
        const keep = Boolean(safePeerCandidate(raw)) && Number.isFinite(verifiedAt) && current - verifiedAt <= maxAgeMs;
        if (!keep) removed += 1;
        return keep;
      }).slice(0, MAX_TRUSTED_PEER_CANDIDATES);
      if (retained.length) binding.endpoint_candidates = retained;
      else delete binding.endpoint_candidates;
    }
    if (removed) credentialStore.writeDocument(document);
    return { removed };
  }

  function markAllDeviceConnections(state) {
    const normalized = String(state || '').toUpperCase();
    if (!CONNECTION_STATES.has(normalized)) throw new Error('trusted-device connection state is invalid');
    for (const deviceId of Object.keys(deviceBindings(credentialStore.readDocument()))) {
      connectionStateByDevice.set(deviceId, normalized);
    }
  }

  function revokeDeviceCredential(deviceIdInput) {
    const deviceId = safeDeviceId(deviceIdInput);
    if (!deviceId) throw new Error('device_id is invalid');
    const document = credentialStore.readDocument();
    const devices = deviceBindings(document);
    const existed = Object.hasOwn(devices, deviceId);
    if (!existed) return { device_id: deviceId, revoked: false };
    delete devices[deviceId];
    authenticatedAtByDevice.delete(deviceId);
    connectionStateByDevice.delete(deviceId);
    credentialStore.writeDocument(document);
    return { device_id: deviceId, revoked: true };
  }

  function listDeviceCredentials() {
    const current = instant().milliseconds;
    return Object.entries(deviceBindings(credentialStore.readDocument()))
      .filter(([, binding]) => binding?.scheme === CREDENTIAL_SCHEME)
      .map(([deviceId, binding]) => {
        const authenticated = authenticatedAtByDevice.get(deviceId);
        const persistedAuthentication = typeof binding.last_authenticated_at === 'string'
          ? { iso: binding.last_authenticated_at, milliseconds: Date.parse(binding.last_authenticated_at) }
          : null;
        const lastAuthenticated = authenticated || persistedAuthentication;
        const recentlyAuthenticated = Number.isFinite(lastAuthenticated?.milliseconds) &&
          current - lastAuthenticated.milliseconds <= RECENT_AUTHENTICATION_MS;
        const explicitState = connectionStateByDevice.get(deviceId);
        let connectionState;
        if (explicitState === 'CONNECTED') connectionState = recentlyAuthenticated ? 'CONNECTED' : 'OFFLINE';
        else if (explicitState) connectionState = explicitState;
        else if (recentlyAuthenticated) connectionState = 'CONNECTED';
        else connectionState = lastAuthenticated ? 'OFFLINE' : 'PAIRED';
        return {
          device_id: deviceId,
          paired_at: typeof binding.updated_at === 'string' ? binding.updated_at : null,
          credential_configured: true,
          last_authenticated_at: lastAuthenticated?.iso || null,
          connection_state: connectionState,
          trusted_endpoint_candidates: Array.isArray(binding.endpoint_candidates)
            ? binding.endpoint_candidates.filter((entry) => safePeerCandidate(entry)).length
            : 0
        };
      })
      .sort((left, right) => left.device_id.localeCompare(right.device_id));
  }

  return {
    authenticate,
    authorizeDevice,
    listTrustedPeerCandidates,
    listRelayRendezvousTokens,
    listDeviceCredentials,
    markAllDeviceConnections,
    pruneStalePeerCandidates,
    recordAuthenticatedPeer,
    registerDeviceCredential,
    revokeDeviceCredential
  };
}

module.exports = {
  CREDENTIAL_SCHEME,
  MAX_TRUSTED_PEER_CANDIDATES,
  MIN_CREDENTIAL_LENGTH,
  TRUSTED_PEER_CANDIDATE_TTL_MS,
  TRUSTED_DEVICE_CONNECTION_STATES,
  RELAY_RENDEZVOUS_WINDOW_MS,
  createMobileDeviceCredentialAuthority,
  credentialDigest,
  relayRendezvousId,
  safeRoutedHost
};
