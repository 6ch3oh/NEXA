'use strict';

const net = require('node:net');
const { readJsonBody, sendJson } = require('../shared/http');
const {
  PROTOCOL_VERSION,
  STATUS_CONTENT_TYPE,
  statusAckHttpCode,
  validateMobileStatusRequest,
  validateMobileSyncRequest
} = require('../shared/mobileSyncProtocol');

const TRUSTED_ENDPOINT_HEADER = 'X-NEXA-Trusted-Endpoint';

function bearerCredential(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.toLowerCase().startsWith('bearer ')) return '';
  return authorization.slice(7).trim();
}

function ackPayload(batchId, result) {
  return {
    protocol_version: PROTOCOL_VERSION,
    batch_id: batchId,
    acknowledgements: result.acknowledgements || []
  };
}

function statusAckPayload(result) {
  return {
    contract_version: result.contract_version,
    device_id: result.device_id,
    captured_at_epoch_ms: result.captured_at_epoch_ms,
    status: result.status,
    reason: result.reason
  };
}

function hasStatusContentType(req) {
  return String(req.headers['content-type'] || '').trim().toLowerCase() === STATUS_CONTENT_TYPE;
}

function trustedUnicastHost(value) {
  const raw = String(value || '').trim().replace(/^\[|\]$/g, '');
  const zoneIndex = raw.indexOf('%');
  const host = zoneIndex >= 0 ? raw.slice(0, zoneIndex) : raw;
  const family = net.isIP(host);
  if (family === 4) {
    const octets = host.split('.').map(Number);
    if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224) return null;
    return { host: octets.join('.'), family };
  }
  if (family === 6) {
    const normalized = host.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('ff') ||
      normalized.startsWith('fe80:')) return null;
    return { host: normalized, family };
  }
  return null;
}

function trustedEndpointHeaders(provider, request = null) {
  if (typeof provider !== 'function') return {};
  try {
    const endpoint = provider(request);
    const routed = trustedUnicastHost(endpoint?.host);
    if (endpoint?.transport !== 'HTTPS' || !routed ||
      !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) return {};
    const authorityHost = routed.family === 6 ? `[${routed.host}]` : routed.host;
    return { [TRUSTED_ENDPOINT_HEADER]: `https://${authorityHost}:${endpoint.port}` };
  } catch (_) {
    return {};
  }
}

function recordAuthenticatedPeer(req, credentialAuthority, deviceId, resolver) {
  if (typeof credentialAuthority?.recordAuthenticatedPeer !== 'function') return;
  try {
    const candidate = typeof resolver === 'function' ? resolver(req) : null;
    if (candidate) credentialAuthority.recordAuthenticatedPeer(deviceId, candidate);
  } catch (_) {
    // Connectivity metadata is best-effort and can never weaken or block an authenticated request.
  }
}

function dispatchNotificationEvents(events, consumer) {
  if (typeof consumer !== 'function' || !Array.isArray(events) || events.length === 0) return;
  setImmediate(() => {
    for (const event of events) {
      void Promise.resolve().then(() => consumer(event)).catch(() => {});
    }
  });
}

async function readMobileJsonBody(req, res) {
  try {
    return { ok: true, value: await readJsonBody(req) };
  } catch (error) {
    if (error.code === 'payload_too_large') {
      res.shouldKeepAlive = false;
      sendJson(res, 413, { error: { code: 'oversized_request', message: 'Request body is too large' } }, { connection: 'close' });
      return { ok: false };
    }
    sendJson(res, 400, { error: { code: 'malformed_request', message: 'Request body is not valid JSON' } });
    return { ok: false };
  }
}

async function handleMobileSyncRequest(req, res, {
  store,
  credentialAuthority,
  trustedEndpointProvider,
  authenticatedPeerResolver,
  businessEventConsumer,
  notificationEventConsumer
} = {}) {
  if (!store || !credentialAuthority) {
    return sendJson(res, 503, { error: { code: 'receiver_not_configured', message: 'Mobile receiver is not configured' } });
  }
  const credential = bearerCredential(req);
  if (!credential) {
    return sendJson(res, 401, { error: { code: 'missing_credential', message: 'Bearer credential is required' } });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error.code === 'payload_too_large') {
      res.shouldKeepAlive = false;
      return sendJson(res, 413, { error: { code: 'oversized_request', message: 'Request body is too large' } }, { connection: 'close' });
    }
    return sendJson(res, 400, { error: { code: 'malformed_request', message: 'Request body is not valid JSON' } });
  }

  const validation = validateMobileSyncRequest(body);
  if (!validation.ok) return sendJson(res, 400, { error: validation.error });

  const authorization = credentialAuthority.authorizeDevice(credential, validation.value.device_id);
  if (!authorization.ok) {
    const status = authorization.error === 'device_id_mismatch' ? 403 : 401;
    return sendJson(res, status, {
      error: {
        code: authorization.error,
        message: authorization.error === 'device_id_mismatch'
          ? 'Authenticated device does not match device_id'
          : 'Bearer credential is invalid'
      }
    });
  }
  recordAuthenticatedPeer(req, credentialAuthority, authorization.device_id, authenticatedPeerResolver);

  const outcome = store.receiveValidatedRequest(validation.value);
  dispatchNotificationEvents(outcome.result.notification_events, notificationEventConsumer);
  if (typeof businessEventConsumer === 'function') {
    for (const businessEvent of outcome.result.delivery_events || []) {
      try {
        const delivery = await businessEventConsumer(businessEvent);
        const status = delivery?.status;
        if (!['DRAFTED', 'IMPORTED', 'IGNORED'].includes(status)) {
          const error = new Error('Mobile business consumer returned an unsupported delivery status');
          error.code = 'INVALID_BUSINESS_DELIVERY_STATUS';
          throw error;
        }
        store.markBusinessEventDelivery(businessEvent, status, delivery?.reasonCode || null);
      } catch (error) {
        store.markBusinessEventDelivery(
          businessEvent,
          'RETRY_PENDING',
          typeof error?.code === 'string' ? error.code : 'BUSINESS_DELIVERY_FAILED'
        );
      }
    }
  }
  return sendJson(
    res,
    200,
    ackPayload(validation.value.batch_id, outcome.result),
    trustedEndpointHeaders(trustedEndpointProvider, req)
  );
}

async function handleMobileStatusRequest(req, res, {
  store,
  credentialAuthority,
  trustedEndpointProvider,
  authenticatedPeerResolver
} = {}) {
  if (!store || typeof store.receiveValidatedStatusRequest !== 'function' || !credentialAuthority) {
    return sendJson(res, 503, { error: { code: 'receiver_not_configured', message: 'Mobile status receiver is not configured' } });
  }
  const credential = bearerCredential(req);
  if (!credential) {
    return sendJson(res, 401, { error: { code: 'missing_credential', message: 'Bearer credential is required' } });
  }
  if (!hasStatusContentType(req)) {
    return sendJson(res, 415, { error: { code: 'unsupported_content_type', message: `Content-Type must be ${STATUS_CONTENT_TYPE}` } });
  }

  const parsed = await readMobileJsonBody(req, res);
  if (!parsed.ok) return;
  const validation = validateMobileStatusRequest(parsed.value);
  if (!validation.ok) return sendJson(res, 400, { error: validation.error });

  const requestDeviceId = validation.value.identity.device_id;
  const authorization = credentialAuthority.authorizeDevice(credential, requestDeviceId);
  if (!authorization.ok || authorization.device_id !== requestDeviceId) {
    const mismatch = authorization.error === 'device_id_mismatch' || authorization.ok;
    return sendJson(res, mismatch ? 403 : 401, {
      error: {
        code: mismatch ? 'device_id_mismatch' : authorization.error,
        message: mismatch ? 'Authenticated device does not match identity.device_id' : 'Bearer credential is invalid'
      }
    });
  }
  recordAuthenticatedPeer(req, credentialAuthority, authorization.device_id, authenticatedPeerResolver);

  try {
    const outcome = store.receiveValidatedStatusRequest(validation.value);
    return sendJson(
      res,
      statusAckHttpCode(outcome.result.status),
      statusAckPayload(outcome.result),
      trustedEndpointHeaders(trustedEndpointProvider, req)
    );
  } catch (_) {
    return sendJson(res, 503, { error: { code: 'persistence_failure', message: 'Mobile status snapshot was not persisted' } });
  }
}

module.exports = {
  ackPayload,
  bearerCredential,
  handleMobileStatusRequest,
  handleMobileSyncRequest,
  trustedUnicastHost,
  trustedEndpointHeaders,
  statusAckPayload
};
