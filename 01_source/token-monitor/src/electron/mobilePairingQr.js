'use strict';

const crypto = require('node:crypto');

let qrModulePromise = null;

function qrEncoder() {
  if (!qrModulePromise) qrModulePromise = import('qr').then((module) => module.default);
  return qrModulePromise;
}

async function encodePairingQr(payloadJson) {
  const value = String(payloadJson || '');
  if (!value) throw new Error('pairing payload is required');
  const encode = await qrEncoder();
  const svg = encode(value, 'svg', { ecc: 'medium', encoding: 'byte', border: 4, optimize: true });
  const viewBox = String(svg).match(/viewBox="0 0 (\d+) (\d+)"/);
  const moduleCount = Number(viewBox?.[1]);
  if (!Number.isInteger(moduleCount) || moduleCount !== Number(viewBox?.[2])) {
    throw new Error('pairing QR encoder returned an invalid square viewBox');
  }
  return {
    format: 'svg-data-url',
    src: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    payload_sha256: crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
    module_count: moduleCount,
    quiet_zone_modules: 4,
    error_correction: 'medium',
    recommended_render_pixels: moduleCount * 4
  };
}

async function encodePairingQrMatrix(payloadJson) {
  const value = String(payloadJson || '');
  if (!value) throw new Error('pairing payload is required');
  const encode = await qrEncoder();
  return encode(value, 'raw', { ecc: 'medium', encoding: 'byte', border: 4 });
}

module.exports = { encodePairingQr, encodePairingQrMatrix };
