'use strict';

const crypto = require('node:crypto');

const RELAY_CONTRACT_VERSION = 'nexa.relay.transport.v0.1';
const RELAY_ROLES = Object.freeze(['DESKTOP', 'MOBILE']);
const MAX_RELAY_REGISTRATION_BYTES = 2 * 1024;
const RELAY_REGISTRATION_TIMEOUT_MS = 10_000;
const RELAY_CLOCK_SKEW_MS = 30_000;
const REGISTRATION_FIELDS = Object.freeze([
  'contract_version',
  'role',
  'rendezvous_id',
  'issued_at_epoch_ms',
  'nonce'
]);

class RelayProtocolError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RelayProtocolError';
    this.code = code;
  }
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateRelayRegistration(input, { now = Date.now() } = {}) {
  if (!isPlainObject(input)) return failure('INVALID_REGISTRATION_SCHEMA', 'Registration must be a JSON object');
  const keys = Object.keys(input);
  if (keys.length !== REGISTRATION_FIELDS.length || keys.some((key) => !REGISTRATION_FIELDS.includes(key))) {
    return failure('INVALID_REGISTRATION_SCHEMA', 'Registration must contain exactly the frozen fields');
  }
  if (input.contract_version !== RELAY_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_RELAY_CONTRACT', `contract_version must be ${RELAY_CONTRACT_VERSION}`);
  }
  if (!RELAY_ROLES.includes(input.role)) {
    return failure('INVALID_RELAY_ROLE', 'role must be DESKTOP or MOBILE');
  }
  if (typeof input.rendezvous_id !== 'string' || !/^[a-f0-9]{64}$/.test(input.rendezvous_id)) {
    return failure('INVALID_RENDEZVOUS_ID', 'rendezvous_id must be 64 lowercase hexadecimal characters');
  }
  if (!Number.isSafeInteger(input.issued_at_epoch_ms) || input.issued_at_epoch_ms < 0) {
    return failure('INVALID_RELAY_TIMESTAMP', 'issued_at_epoch_ms must be a non-negative safe integer');
  }
  if (Math.abs(input.issued_at_epoch_ms - now) > RELAY_CLOCK_SKEW_MS) {
    return failure('STALE_RELAY_REGISTRATION', 'issued_at_epoch_ms exceeds the allowed clock window');
  }
  if (typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{22,86}$/.test(input.nonce)) {
    return failure('INVALID_RELAY_NONCE', 'nonce must be bounded base64url text');
  }
  return {
    ok: true,
    value: {
      contract_version: RELAY_CONTRACT_VERSION,
      role: input.role,
      rendezvous_id: input.rendezvous_id,
      issued_at_epoch_ms: input.issued_at_epoch_ms,
      nonce: input.nonce
    }
  };
}

function createRelayRegistration({
  role,
  rendezvousId,
  now = Date.now(),
  randomBytes = crypto.randomBytes
} = {}) {
  const candidate = {
    contract_version: RELAY_CONTRACT_VERSION,
    role,
    rendezvous_id: rendezvousId,
    issued_at_epoch_ms: now,
    nonce: randomBytes(24).toString('base64url')
  };
  const validation = validateRelayRegistration(candidate, { now });
  if (!validation.ok) throw new RelayProtocolError(validation.error.code, validation.error.message);
  return validation.value;
}

function encodeRelayRegistration(input, options = {}) {
  const validation = validateRelayRegistration(input, options);
  if (!validation.ok) throw new RelayProtocolError(validation.error.code, validation.error.message);
  const body = Buffer.from(JSON.stringify(validation.value), 'utf8');
  if (body.length > MAX_RELAY_REGISTRATION_BYTES) {
    throw new RelayProtocolError('REGISTRATION_TOO_LARGE', 'Registration exceeds its byte limit');
  }
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32BE(body.length, 0);
  return Buffer.concat([prefix, body]);
}

function readRelayRegistration(socket, {
  now = () => Date.now(),
  timeoutMs = RELAY_REGISTRATION_TIMEOUT_MS,
  maxBytes = MAX_RELAY_REGISTRATION_BYTES
} = {}) {
  if (!socket || typeof socket.on !== 'function' || typeof socket.pause !== 'function') {
    return Promise.reject(new RelayProtocolError('INVALID_RELAY_SOCKET', 'A readable socket is required'));
  }
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let expectedBytes = null;
    let finished = false;
    const timer = setTimeout(() => finish(new RelayProtocolError(
      'REGISTRATION_TIMEOUT',
      'Relay registration timed out'
    )), Math.max(1, Number(timeoutMs) || RELAY_REGISTRATION_TIMEOUT_MS));
    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.off('end', onEnd);
    }

    function finish(error, value = null) {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }

    function onError(error) {
      finish(error instanceof RelayProtocolError
        ? error
        : new RelayProtocolError('REGISTRATION_SOCKET_ERROR', error?.message || 'Registration socket failed'));
    }

    function onClose() {
      finish(new RelayProtocolError('REGISTRATION_CLOSED', 'Relay peer closed before registration completed'));
    }

    function onEnd() {
      finish(new RelayProtocolError('REGISTRATION_CLOSED', 'Relay peer ended before registration completed'));
    }

    function onData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      if (expectedBytes === null && buffered.length >= 4) {
        expectedBytes = buffered.readUInt32BE(0);
        if (expectedBytes < 2 || expectedBytes > maxBytes) {
          finish(new RelayProtocolError('REGISTRATION_TOO_LARGE', 'Relay registration length is invalid'));
          return;
        }
      }
      if (expectedBytes === null || buffered.length < expectedBytes + 4) return;
      const body = buffered.subarray(4, 4 + expectedBytes);
      const remainder = Buffer.from(buffered.subarray(4 + expectedBytes));
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (_) {
        finish(new RelayProtocolError('MALFORMED_REGISTRATION', 'Relay registration is not valid JSON'));
        return;
      }
      const validation = validateRelayRegistration(parsed, { now: now() });
      if (!validation.ok) {
        finish(new RelayProtocolError(validation.error.code, validation.error.message));
        return;
      }
      socket.pause();
      finish(null, { registration: validation.value, remainder });
    }

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.once('end', onEnd);
    socket.resume?.();
  });
}

module.exports = {
  MAX_RELAY_REGISTRATION_BYTES,
  RELAY_CLOCK_SKEW_MS,
  RELAY_CONTRACT_VERSION,
  RELAY_REGISTRATION_TIMEOUT_MS,
  RELAY_ROLES,
  RelayProtocolError,
  createRelayRegistration,
  encodeRelayRegistration,
  readRelayRegistration,
  validateRelayRegistration
};
