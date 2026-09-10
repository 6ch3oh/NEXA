'use strict';

const { readJsonBody, sendJson } = require('../shared/http');
const {
  ENDPOINT_RENDEZVOUS_CONTENT_TYPE,
  MAX_ENDPOINT_RENDEZVOUS_BYTES,
  createEndpointAdvertisement,
  validateEndpointRendezvousRequest
} = require('../shared/mobileEndpointRendezvous');
const { bearerCredential } = require('./mobileSyncReceiver');

async function handleMobileEndpointRendezvous(req, res, {
  credentialAuthority,
  endpointProvider,
  now = () => Date.now()
} = {}) {
  if (!credentialAuthority || typeof endpointProvider !== 'function') {
    return sendJson(res, 503, {
      error: { code: 'RENDEZVOUS_NOT_CONFIGURED', message: 'Endpoint rendezvous is unavailable' }
    });
  }
  if (String(req.headers['content-type'] || '').trim().toLowerCase() !==
    ENDPOINT_RENDEZVOUS_CONTENT_TYPE) {
    return sendJson(res, 415, {
      error: {
        code: 'UNSUPPORTED_CONTENT_TYPE',
        message: `Content-Type must be ${ENDPOINT_RENDEZVOUS_CONTENT_TYPE}`
      }
    });
  }
  const credential = bearerCredential(req);
  if (!credential) {
    return sendJson(res, 401, {
      error: { code: 'missing_credential', message: 'Bearer credential is required' }
    });
  }
  let body;
  try {
    body = await readJsonBody(req, MAX_ENDPOINT_RENDEZVOUS_BYTES);
  } catch (error) {
    if (error.code === 'payload_too_large') {
      res.shouldKeepAlive = false;
      return sendJson(res, 413, {
        error: { code: 'RENDEZVOUS_REQUEST_TOO_LARGE', message: 'Request exceeds its byte limit' }
      }, { connection: 'close' });
    }
    return sendJson(res, 400, {
      error: { code: 'MALFORMED_RENDEZVOUS_REQUEST', message: 'Request body is not valid JSON' }
    });
  }
  const current = now();
  const validation = validateEndpointRendezvousRequest(body, { now: current });
  if (!validation.ok) return sendJson(res, 400, { error: validation.error });
  const authorization = credentialAuthority.authorizeDevice(
    credential,
    validation.value.device_id
  );
  if (!authorization.ok) {
    const mismatch = authorization.error === 'device_id_mismatch';
    return sendJson(res, mismatch ? 403 : 401, {
      error: {
        code: authorization.error,
        message: mismatch
          ? 'Authenticated device does not match device_id'
          : 'Bearer credential is invalid'
      }
    });
  }
  try {
    const endpoint = endpointProvider(req);
    const advertisement = createEndpointAdvertisement({
      deviceId: authorization.device_id,
      endpoint,
      now: current
    });
    return sendJson(res, 200, advertisement);
  } catch (_) {
    return sendJson(res, 503, {
      error: {
        code: 'CURRENT_ENDPOINT_UNAVAILABLE',
        message: 'Desktop has no current routable endpoint candidate'
      }
    });
  }
}

module.exports = { handleMobileEndpointRendezvous };
