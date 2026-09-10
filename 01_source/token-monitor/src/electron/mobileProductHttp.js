'use strict';
const { readJsonBody, sendJson } = require('../shared/http');
const { bearerCredential } = require('./mobileSyncReceiver');

async function handleMobileProductRequest(req, res, { gateway, credentialAuthority } = {}) {
  if (!gateway || !credentialAuthority) return sendJson(res, 503, { error: { code: 'MOBILE_PRODUCT_UNAVAILABLE' } });
  const credential = bearerCredential(req);
  if (!credential) return sendJson(res, 401, { error: { code: 'missing_credential' } });
  let body; try { body = await readJsonBody(req); } catch (_) { return sendJson(res, 400, { error: { code: 'malformed_request' } }); }
  const deviceId = typeof body?.device_id === 'string' ? body.device_id : '';
  const authorization = credentialAuthority.authorizeDevice(credential, deviceId);
  if (!authorization.ok || authorization.device_id !== deviceId) return sendJson(res, authorization.error === 'device_id_mismatch' ? 403 : 401, { error: { code: authorization.error || 'unauthorized' } });
  try { return sendJson(res, 200, await gateway.execute(body)); }
  catch (error) { return sendJson(res, error?.code === 'MOBILE_PRODUCT_STARTING' ? 503 : 400, { error: { code: error?.code || 'MOBILE_PRODUCT_FAILED', message: 'Mobile product request failed' } }); }
}
module.exports = { handleMobileProductRequest };
