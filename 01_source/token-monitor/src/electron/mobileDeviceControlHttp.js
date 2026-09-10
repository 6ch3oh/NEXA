'use strict';

const { readJsonBody, sendJson } = require('../shared/http');
const {
  CONTROL_CONTENT_TYPE,
  CONTROL_CONTRACT_VERSION,
  MAX_CONTROL_EXCHANGE_BYTES,
  validateControlExchangeRequest
} = require('../shared/mobileDeviceControlProtocol');
const { bearerCredential, trustedEndpointHeaders } = require('./mobileSyncReceiver');

const DESKTOP_CONTROL_FIELDS = Object.freeze(['device_id', 'capability', 'parameters', 'timeout_ms']);

function isLoopbackAddress(value) {
  const address = String(value || '').replace(/^::ffff:/, '').toLowerCase();
  return address === '127.0.0.1' || address === '::1';
}

function exactDesktopRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === DESKTOP_CONTROL_FIELDS.length && keys.every((key) => DESKTOP_CONTROL_FIELDS.includes(key));
}

async function parseJson(req, res, maxBytes) {
  try {
    return { ok: true, value: await readJsonBody(req, maxBytes) };
  } catch (error) {
    if (error.code === 'payload_too_large') {
      res.shouldKeepAlive = false;
      sendJson(res, 413, { error: { code: 'OVERSIZED_REQUEST', message: 'Request body is too large' } }, { connection: 'close' });
      return { ok: false };
    }
    sendJson(res, 400, { error: { code: 'MALFORMED_REQUEST', message: 'Request body is not valid JSON' } });
    return { ok: false };
  }
}

async function handleMobileControlExchange(req, res, {
  controlPlane,
  credentialAuthority,
  trustedEndpointProvider,
  authenticatedPeerResolver
} = {}) {
  if (!controlPlane || !credentialAuthority) {
    return sendJson(res, 503, { error: { code: 'CONTROL_NOT_CONFIGURED', message: 'Device Control Plane is not configured' } });
  }
  if (String(req.headers['content-type'] || '').trim().toLowerCase() !== CONTROL_CONTENT_TYPE) {
    return sendJson(res, 415, { error: { code: 'UNSUPPORTED_CONTENT_TYPE', message: `Content-Type must be ${CONTROL_CONTENT_TYPE}` } });
  }
  const credential = bearerCredential(req);
  if (!credential) {
    return sendJson(res, 401, { error: { code: 'missing_credential', message: 'Bearer credential is required' } });
  }
  const parsed = await parseJson(req, res, MAX_CONTROL_EXCHANGE_BYTES);
  if (!parsed.ok) return;
  const validation = validateControlExchangeRequest(parsed.value);
  if (!validation.ok) return sendJson(res, 400, { error: validation.error });
  const deviceId = validation.value.device_id;
  const authorization = credentialAuthority.authorizeDevice(credential, deviceId);
  if (!authorization.ok || authorization.device_id !== deviceId) {
    const mismatch = authorization.error === 'device_id_mismatch' || authorization.ok;
    return sendJson(res, mismatch ? 403 : 401, {
      error: {
        code: mismatch ? 'device_id_mismatch' : authorization.error,
        message: mismatch ? 'Authenticated device does not match device_id' : 'Bearer credential is invalid'
      }
    });
  }
  let candidate = null;
  try {
    candidate = typeof authenticatedPeerResolver === 'function' ? authenticatedPeerResolver(req) : null;
  } catch (_) {}
  if (!candidate) {
    return sendJson(res, 403, {
      error: { code: 'UNTRUSTED_TRANSPORT_SOURCE', message: 'Control exchange requires an authenticated LAN or Relay transport' }
    });
  }
  try { credentialAuthority.recordAuthenticatedPeer(deviceId, candidate); } catch (_) {}
  try {
    const result = await controlPlane.exchange({
      deviceId,
      response: validation.value.response,
      waitMs: validation.value.response ? 0 : 12_000
    });
    return sendJson(res, 200, result, trustedEndpointHeaders(trustedEndpointProvider, req));
  } catch (error) {
    const code = String(error?.code || 'CONTROL_EXCHANGE_FAILED');
    const status = code === 'UNSOLICITED_CONTROL_RESPONSE' ? 409 : 400;
    return sendJson(res, status, { error: { code, message: 'Control exchange was rejected' } });
  }
}

async function handleDesktopControlRequest(req, res, { client } = {}) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return sendJson(res, 403, { error: { code: 'LOOPBACK_REQUIRED', message: 'Desktop control entrypoint is loopback-only' } });
  }
  if (!client) return sendJson(res, 503, { error: { code: 'CONTROL_NOT_CONFIGURED', message: 'Device Control client is not configured' } });
  const parsed = await parseJson(req, res, 16 * 1024);
  if (!parsed.ok) return;
  if (!exactDesktopRequest(parsed.value)) {
    return sendJson(res, 400, { error: { code: 'INVALID_SCHEMA', message: 'Desktop control request shape is invalid' } });
  }
  try {
    const response = await client.execute({
      deviceId: parsed.value.device_id,
      capability: parsed.value.capability,
      parameters: parsed.value.parameters,
      timeoutMs: parsed.value.timeout_ms
    });
    return sendJson(res, 200, { contract_version: CONTROL_CONTRACT_VERSION, response });
  } catch (error) {
    const code = String(error?.code || 'CONTROL_FAILED');
    const status = code === 'CONTROL_TIMEOUT' ? 504
      : code === 'DEVICE_CONTROL_BUSY' ? 409
        : code === 'UNKNOWN_TRUSTED_DEVICE' || code === 'TRUSTED_DEVICE_REQUIRED' ? 404
          : 400;
    return sendJson(res, status, { error: { code, message: String(error?.message || code).slice(0, 256) } });
  }
}

function desktopControlAudit(req, res, { client, deviceId = null } = {}) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return sendJson(res, 403, { error: { code: 'LOOPBACK_REQUIRED', message: 'Desktop control entrypoint is loopback-only' } });
  }
  return sendJson(res, 200, {
    contract_version: CONTROL_CONTRACT_VERSION,
    audit: client?.listAudit({ deviceId, limit: 100 }) || []
  });
}

module.exports = {
  desktopControlAudit,
  handleDesktopControlRequest,
  handleMobileControlExchange,
  isLoopbackAddress
};
