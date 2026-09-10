'use strict';

const { CONTROL_CAPABILITIES } = require('../shared/mobileDeviceControlProtocol');

function clientError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createDeviceControlClient({ controlPlane, trustedDeviceProvider } = {}) {
  if (!controlPlane || typeof controlPlane.submit !== 'function') {
    throw new Error('Device Control Plane is required');
  }
  if (typeof trustedDeviceProvider !== 'function') {
    throw new Error('Trusted device provider is required');
  }

  function trustedDevices() {
    const devices = trustedDeviceProvider() || [];
    return devices.filter((device) => device?.credential_configured && typeof device.device_id === 'string');
  }

  function resolveDeviceId(requested) {
    const devices = trustedDevices();
    const normalized = typeof requested === 'string' ? requested.trim() : '';
    if (normalized) {
      if (!devices.some((device) => device.device_id === normalized)) {
        throw clientError('UNKNOWN_TRUSTED_DEVICE', 'Requested Mobile device is not paired and trusted');
      }
      return normalized;
    }
    if (devices.length === 1) return devices[0].device_id;
    if (devices.length === 0) throw clientError('TRUSTED_DEVICE_REQUIRED', 'No paired Mobile device is available');
    throw clientError('DEVICE_ID_REQUIRED', 'More than one trusted Mobile device is available');
  }

  async function execute({ deviceId = '', capability, parameters = {}, timeoutMs, signal } = {}) {
    if (!Object.hasOwn(CONTROL_CAPABILITIES, capability)) {
      throw clientError('UNKNOWN_CAPABILITY', 'Capability is not in the V0.1 allowlist');
    }
    const resolvedDeviceId = resolveDeviceId(deviceId);
    const response = await controlPlane.submit({
      deviceId: resolvedDeviceId,
      capability,
      parameters,
      timeoutMs,
      signal
    });
    if (response.device_id !== resolvedDeviceId) {
      throw clientError('DEVICE_ID_MISMATCH', 'Mobile response identity does not match the trusted device');
    }
    return response;
  }

  return {
    execute,
    listAudit: (options) => controlPlane.listAudit(options),
    listCapabilities: () => Object.entries(CONTROL_CAPABILITIES).map(([capability, risk]) => ({ capability, risk })),
    listTrustedDevices: () => trustedDevices().map((device) => ({ ...device }))
  };
}

module.exports = { createDeviceControlClient };
