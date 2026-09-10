'use strict';

const { readJsonBody, sendJson } = require('../shared/http');
const { PAIRING_PATH, PairingError } = require('../shared/mobilePairingAuthority');

function claimSecret(req) {
  const value = String(req.headers.authorization || '');
  const match = value.match(/^NEXA-Pairing\s+([^\s]+)$/i);
  return match ? match[1] : '';
}

function bearerCredential(req) {
  const value = String(req.headers.authorization || '');
  const match = value.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : '';
}

function sourceIp(req) {
  return req.socket?.remoteAddress || '';
}

function pairingRoute(pathname) {
  if (!pathname.startsWith(`${PAIRING_PATH}/`)) return null;
  const parts = pathname.slice(PAIRING_PATH.length + 1).split('/').map(decodeURIComponent);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { pairingId: parts[0], action: parts[1] };
}

async function handleMobilePairingRequest(req, res, { authority, secureTransport } = {}) {
  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const route = pairingRoute(url.pathname);
  if (!route) return false;
  if (!secureTransport) {
    sendJson(res, 426, { error: 'HTTPS_REQUIRED' });
    return true;
  }
  if (!authority) {
    sendJson(res, 503, { error: 'PAIRING_AUTHORITY_UNAVAILABLE' });
    return true;
  }

  try {
    const common = { pairingId: route.pairingId, claimSecret: claimSecret(req), sourceIp: sourceIp(req) };
    if (req.method === 'POST' && route.action === 'claim') {
      const body = await readJsonBody(req);
      sendJson(res, 200, authority.claim({ ...common, deviceId: body.device_id }));
      return true;
    }
    if (req.method === 'POST' && route.action === 'client-confirm') {
      const body = await readJsonBody(req);
      sendJson(res, 200, authority.clientConfirm({ ...common, deviceId: body.device_id }));
      return true;
    }
    if (req.method === 'GET' && route.action === 'status') {
      sendJson(res, 200, authority.statusForClient(common));
      return true;
    }
    if (req.method === 'POST' && route.action === 'credential') {
      const body = await readJsonBody(req);
      sendJson(res, 200, authority.deliver({ ...common, deviceId: body.device_id }));
      return true;
    }
    if (req.method === 'POST' && route.action === 'complete') {
      const body = await readJsonBody(req);
      sendJson(res, 200, authority.complete({
        pairingId: route.pairingId,
        credential: bearerCredential(req),
        deviceId: body.device_id,
        sourceIp: sourceIp(req)
      }));
      return true;
    }
    if (req.method === 'DELETE' && route.action === 'cancel') {
      authority.statusForClient(common);
      sendJson(res, 200, authority.cancel(route.pairingId));
      return true;
    }
    sendJson(res, 404, { error: 'PAIRING_ROUTE_NOT_FOUND' });
    return true;
  } catch (error) {
    if (error instanceof PairingError) {
      sendJson(res, error.statusCode, { error: error.code });
      return true;
    }
    sendJson(res, 400, { error: 'PAIRING_REQUEST_INVALID' });
    return true;
  }
}

module.exports = { handleMobilePairingRequest, pairingRoute };
