'use strict';

const { readJsonBody, sendJson } = require('../shared/http');
const { bearerCredential } = require('./mobileSyncReceiver');

async function handleMobileRuntimeBundleRequest(req, res, { application, credentialAuthority } = {}) {
  if (!application || !credentialAuthority) return sendJson(res, 503, { error: { code: 'RUNTIME_BUNDLE_UNAVAILABLE' } });
  const credential = bearerCredential(req);
  if (!credential) return sendJson(res, 401, { error: { code: 'missing_credential' } });
  let body;
  try { body = await readJsonBody(req); } catch (_) { return sendJson(res, 400, { error: { code: 'malformed_request' } }); }
  const deviceId = typeof body?.device_id === 'string' ? body.device_id : '';
  const authorization = credentialAuthority.authorizeDevice(credential, deviceId);
  if (!authorization.ok || authorization.device_id !== deviceId) return sendJson(res, authorization.error === 'device_id_mismatch' ? 403 : 401, { error: { code: authorization.error || 'unauthorized' } });
  try {
    if (body.operation === 'status') return sendJson(res, 200, application.status());
    if (body.operation === 'resource' && typeof body.path === 'string') return sendJson(res, 200, application.resource(body.path));
    return sendJson(res, 400, { error: { code: 'RUNTIME_BUNDLE_OPERATION_INVALID' } });
  } catch (error) { return sendJson(res, error?.code === 'RUNTIME_RESOURCE_NOT_FOUND' ? 404 : 400, { error: { code: error?.code || 'RUNTIME_BUNDLE_FAILED' } }); }
}

module.exports = { handleMobileRuntimeBundleRequest };
