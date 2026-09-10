'use strict';

const {
  createMobilePairingAuthority,
  PAIRING_CONTRACT_VERSION
} = require('../shared/mobilePairingAuthority');
const {
  loadMobileTlsIdentity,
  rotateMobileTlsIdentity
} = require('../shared/mobileTlsIdentity');
const { createNexaModuleController } = require('../shared/nexaModuleController');
const { encodePairingQr } = require('./mobilePairingQr');

const MOBILE_PAIRING_INVOKE_CHANNELS = Object.freeze([
  'nexa:mobile-pairing:start',
  'nexa:mobile-pairing:status',
  'nexa:mobile-pairing:cancel',
  'nexa:mobile-pairing:desktop-confirm',
  'nexa:mobile-pairing:list-devices',
  'nexa:mobile-pairing:revoke',
  'nexa:mobile-pairing:certificate',
  'nexa:mobile-pairing:rotate-certificate',
  'nexa:mobile-pairing:awareness',
  'nexa:mobile-pairing:awareness-action'
]);

const MOBILE_PAIRING_APPLICATION_METHODS = Object.freeze([
  'start', 'status', 'cancel', 'desktopConfirm', 'listDevices', 'revoke', 'certificate',
  'rotateCertificate', 'awareness', 'awarenessAction', 'shutdown'
]);

const MOBILE_PAIRING_DESCRIPTOR = Object.freeze({
  moduleId: 'mobile-pairing',
  contractVersion: 1,
  invokeChannels: MOBILE_PAIRING_INVOKE_CHANNELS,
  pushChannels: Object.freeze([])
});

function validateMobilePairingApplication(application) {
  for (const method of MOBILE_PAIRING_APPLICATION_METHODS) {
    if (typeof application?.[method] !== 'function') {
      throw new Error('Mobile Pairing application adapter is invalid');
    }
  }
}

function createMobilePairingController(application) {
  validateMobilePairingApplication(application);
  return createNexaModuleController({
    start() {},
    stop() { return application.shutdown(); },
    getSnapshot() { return Object.freeze({ readiness: Object.freeze({ ready: true, code: 'READY' }) }); },
    execute() { throw new Error('Mobile Pairing has no generic module command surface'); }
  });
}

function createMobilePairingIpcHandlers(application, host) {
  validateMobilePairingApplication(application);
  if (!host || typeof host.startModule !== 'function') throw new Error('NEXA Shell Host is required');
  async function invoke(method, ...args) {
    await host.startModule('mobile-pairing');
    return application[method](...args);
  }
  return {
    'nexa:mobile-pairing:start': () => invoke('start'),
    'nexa:mobile-pairing:status': (_event, pairingId) => invoke('status', pairingId),
    'nexa:mobile-pairing:cancel': (_event, pairingId) => invoke('cancel', pairingId),
    'nexa:mobile-pairing:desktop-confirm': (_event, pairingId, confirmed) => (
      invoke('desktopConfirm', pairingId, confirmed === true)
    ),
    'nexa:mobile-pairing:list-devices': () => invoke('listDevices'),
    'nexa:mobile-pairing:revoke': (_event, deviceReference) => invoke('revoke', deviceReference),
    'nexa:mobile-pairing:certificate': () => invoke('certificate'),
    'nexa:mobile-pairing:rotate-certificate': (_event, confirmed) => invoke('rotateCertificate', confirmed === true),
    'nexa:mobile-pairing:awareness': (_event, options) => invoke('awareness', options),
    'nexa:mobile-pairing:awareness-action': (_event, request) => invoke('awarenessAction', request)
  };
}

function createUnavailableMobilePairingApplication() {
  function unavailable() {
    const error = new Error('Mobile pairing requires the existing Hub to be running in host mode');
    error.code = 'MOBILE_HOST_MODE_REQUIRED';
    throw error;
  }
  return Object.freeze(Object.fromEntries(MOBILE_PAIRING_APPLICATION_METHODS.map((method) => [method, unavailable])));
}

function createMobilePairingRuntime({ identityDirectory, credentialAuthority, endpoint, endpointProvider = null, lanAddresses = [], now = () => Date.now() } = {}) {
  const nowMs = () => new Date(now()).getTime();
  const identity = loadMobileTlsIdentity(identityDirectory, {
    lanAddresses,
    now: () => new Date(nowMs()),
    nowMs: nowMs()
  });
  const authority = createMobilePairingAuthority({
    credentialAuthority,
    certificateFingerprint: identity.fingerprint,
    endpoint,
    endpointProvider,
    now: nowMs
  });
  const qrByPairingId = new Map();

  async function startPairing() {
    const created = authority.createSession();
    const qr = await encodePairingQr(created.payload_json);
    qrByPairingId.set(created.pairing_id, qr);
    return status(created.pairing_id);
  }

  function status(pairingId) {
    const projection = authority.presentation(pairingId);
    const canDisplayQr = projection.state === 'PENDING';
    if (!canDisplayQr) qrByPairingId.delete(pairingId);
    return { ...projection, qr: canDisplayQr ? qrByPairingId.get(pairingId) || null : null };
  }

  function certificateInfo() {
    return {
      contract_version: PAIRING_CONTRACT_VERSION,
      key_algorithm: identity.keyAlgorithm,
      validity_days: identity.validityDays,
      fingerprint_sha256: identity.fingerprint,
      fingerprint_display: identity.fingerprintDisplay,
      issued_at: identity.issuedAt,
      expires_at: identity.expiresAt,
      expires_within_30_days: identity.expiresWithin30Days,
      expired: identity.expired,
      rotation_requires_confirmation: true
    };
  }

  function cancel(pairingId) {
    const projection = authority.cancel(pairingId);
    qrByPairingId.delete(pairingId);
    return { ...projection, qr: null };
  }

  function desktopConfirm(pairingId, confirmed) {
    authority.desktopConfirm(pairingId, confirmed);
    return status(pairingId);
  }

  function shutdown() {
    authority.shutdown();
    qrByPairingId.clear();
  }

  return {
    authority,
    cancel,
    certificateInfo,
    desktopConfirm,
    identity,
    pairedDevices: authority.pairedDevices,
    revokeDeviceReference: authority.revokeDeviceReference,
    shutdown,
    startPairing,
    status
  };
}

module.exports = {
  MOBILE_PAIRING_DESCRIPTOR,
  MOBILE_PAIRING_INVOKE_CHANNELS,
  createMobilePairingController,
  createMobilePairingIpcHandlers,
  createMobilePairingRuntime,
  createUnavailableMobilePairingApplication,
  rotateMobileTlsIdentity
};
