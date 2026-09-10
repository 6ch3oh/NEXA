'use strict';

const { readJsonBody, sendJson } = require('../shared/http');
const {
  AWARENESS_CONTRACT_VERSION,
  DESKTOP_SELF_STATUS_CONTENT_TYPE,
  DESKTOP_SELF_STATUS_ENDPOINT,
  MAX_STATUS_BYTES,
  validateDesktopSelfStatusRequest
} = require('../shared/deviceAwarenessProtocol');
const { bearerCredential } = require('./mobileSyncReceiver');

async function handleDesktopSelfStatusRequest(req, res, {
  credentialAuthority,
  statusProvider,
  secureTransport = Boolean(req.socket?.encrypted)
} = {}) {
  if (req.method !== 'POST' || req.url?.split('?')[0] !== DESKTOP_SELF_STATUS_ENDPOINT) return false;
  if (!secureTransport) {
    sendJson(res, 426, { error: { code: 'HTTPS_REQUIRED', message: 'Desktop status requires HTTPS' } });
    return true;
  }
  if (!credentialAuthority || typeof statusProvider !== 'function') {
    sendJson(res, 503, { error: { code: 'AWARENESS_UNAVAILABLE', message: 'Desktop status is unavailable' } });
    return true;
  }
  const credential = bearerCredential(req);
  if (!credential) {
    sendJson(res, 401, { error: { code: 'missing_credential', message: 'Bearer credential is required' } });
    return true;
  }
  let body;
  try {
    body = await readJsonBody(req, MAX_STATUS_BYTES);
  } catch (_) {
    sendJson(res, 400, { error: { code: 'INVALID_AWARENESS_REQUEST', message: 'Request is invalid' } });
    return true;
  }
  const validation = validateDesktopSelfStatusRequest(body);
  if (!validation.ok) {
    sendJson(res, 400, { error: { code: validation.error, message: 'Request is invalid' } });
    return true;
  }
  const authorization = credentialAuthority.authorizeDevice(credential, validation.value.device_id);
  if (!authorization.ok) {
    const status = authorization.error === 'device_id_mismatch' ? 403 : 401;
    sendJson(res, status, { error: { code: authorization.error, message: 'Device authentication failed' } });
    return true;
  }
  try {
    const status = await statusProvider({ authenticatedDeviceId: authorization.device_id });
    sendJson(res, 200, status, {
      'content-type': DESKTOP_SELF_STATUS_CONTENT_TYPE,
      'x-nexa-protocol-version': AWARENESS_CONTRACT_VERSION,
      'cache-control': 'no-store'
    });
  } catch (_) {
    sendJson(res, 503, { error: { code: 'AWARENESS_UNAVAILABLE', message: 'Desktop status is unavailable' } });
  }
  return true;
}

module.exports = { handleDesktopSelfStatusRequest };
