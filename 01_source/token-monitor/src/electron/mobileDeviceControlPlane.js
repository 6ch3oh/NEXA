'use strict';

const crypto = require('node:crypto');
const {
  CONTROL_CONTRACT_VERSION,
  MAX_CONTROL_REQUEST_LIFETIME_MS,
  validateControlRequest,
  validateControlResponse
} = require('../shared/mobileDeviceControlProtocol');

const DEFAULT_CONTROL_TIMEOUT_MS = 45_000;
const MAX_AUDIT_ENTRIES = 128;
const RESPONSE_REPLAY_TTL_MS = 2 * 60 * 1000;
const MAX_LONG_POLL_MS = 20_000;

function controlError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createMobileDeviceControlPlane({
  now = () => Date.now(),
  requestIdFactory = () => crypto.randomUUID(),
  onPendingChange = () => {},
  logger = console
} = {}) {
  const pendingByDevice = new Map();
  const pollWaiterByDevice = new Map();
  const lastAcknowledgedByDevice = new Map();
  const retiredByDevice = new Map();
  const auditEntries = [];
  let stopped = false;

  function audit({ deviceId, requestId = null, capability = null, accepted, resultType, reason = null }) {
    const entry = Object.freeze({
      timestamp: new Date(now()).toISOString(),
      peer_device_id: String(deviceId || ''),
      request_id: requestId ? String(requestId) : null,
      capability,
      accepted: Boolean(accepted),
      result_type: String(resultType || 'UNKNOWN'),
      safe_reason: reason ? String(reason).slice(0, 128) : null
    });
    auditEntries.push(entry);
    if (auditEntries.length > MAX_AUDIT_ENTRIES) auditEntries.splice(0, auditEntries.length - MAX_AUDIT_ENTRIES);
    try {
      logger.log?.(`[mobile-control] device=${entry.peer_device_id} capability=${entry.capability || 'NONE'} result=${entry.result_type}`);
    } catch (_) {}
    return entry;
  }

  function cleanReplay(current = now()) {
    for (const [deviceId, replay] of lastAcknowledgedByDevice) {
      if (replay.expiresAt <= current) lastAcknowledgedByDevice.delete(deviceId);
    }
    for (const [deviceId, retired] of retiredByDevice) {
      for (const [requestId, entry] of retired) {
        if (entry.expiresAt <= current) retired.delete(requestId);
      }
      if (!retired.size) retiredByDevice.delete(deviceId);
    }
  }

  function retireDelivered(deviceId, pending) {
    if (!pending.delivered) return;
    const retired = retiredByDevice.get(deviceId) || new Map();
    retired.set(pending.request.request_id, {
      request: pending.request,
      responseDigest: null,
      expiresAt: now() + RESPONSE_REPLAY_TTL_MS
    });
    retiredByDevice.set(deviceId, retired);
  }

  function idleExchange(deviceId, acknowledgedResponseRequestId = null) {
    return {
      contract_version: CONTROL_CONTRACT_VERSION,
      device_id: deviceId,
      acknowledged_response_request_id: acknowledgedResponseRequestId,
      command: null,
      next_poll_after_ms: 1_000
    };
  }

  function commandExchange(deviceId, pending, acknowledgedResponseRequestId = null) {
    const firstDelivery = !pending.delivered;
    pending.delivered = true;
    if (firstDelivery) {
      audit({
        deviceId,
        requestId: pending.request.request_id,
        capability: pending.request.capability,
        accepted: true,
        resultType: 'DELIVERED'
      });
    }
    return {
      contract_version: CONTROL_CONTRACT_VERSION,
      device_id: deviceId,
      acknowledged_response_request_id: acknowledgedResponseRequestId,
      command: pending.request,
      next_poll_after_ms: 1_000
    };
  }

  function notifyWaitingPoll(deviceId, pending) {
    if (!pollWaiterByDevice.has(deviceId)) return;
    settleWaiter(deviceId, commandExchange(deviceId, pending));
  }

  function settleWaiter(deviceId, value) {
    const waiter = pollWaiterByDevice.get(deviceId);
    if (!waiter) return;
    pollWaiterByDevice.delete(deviceId);
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }

  function removePending(deviceId, pending) {
    if (pendingByDevice.get(deviceId) !== pending) return false;
    pendingByDevice.delete(deviceId);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.onAbort);
    try { onPendingChange({ deviceId, pending: false }); } catch (_) {}
    return true;
  }

  function rejectPending(deviceId, pending, code, reason) {
    if (!removePending(deviceId, pending)) return;
    retireDelivered(deviceId, pending);
    audit({
      deviceId,
      requestId: pending.request.request_id,
      capability: pending.request.capability,
      accepted: false,
      resultType: code,
      reason
    });
    pending.reject(controlError(code, reason));
    settleWaiter(deviceId, idleExchange(deviceId));
  }

  function submit({ deviceId, capability, parameters = {}, timeoutMs = DEFAULT_CONTROL_TIMEOUT_MS, signal = null } = {}) {
    if (stopped) return Promise.reject(controlError('CONTROL_PLANE_STOPPED', 'Device Control Plane is stopped'));
    const boundedTimeout = Math.min(MAX_CONTROL_REQUEST_LIFETIME_MS, Math.max(1_000, Number(timeoutMs) || DEFAULT_CONTROL_TIMEOUT_MS));
    const issuedAt = now();
    const validation = validateControlRequest({
      contract_version: CONTROL_CONTRACT_VERSION,
      request_id: requestIdFactory(),
      device_id: deviceId,
      capability,
      issued_at_epoch_ms: issuedAt,
      expires_at_epoch_ms: issuedAt + boundedTimeout,
      parameters
    }, { now: issuedAt });
    if (!validation.ok) {
      audit({ deviceId, capability, accepted: false, resultType: validation.error.code, reason: validation.error.code });
      return Promise.reject(controlError(validation.error.code, validation.error.message));
    }
    const normalizedDeviceId = validation.value.device_id;
    if (pendingByDevice.has(normalizedDeviceId)) {
      audit({ deviceId: normalizedDeviceId, capability, accepted: false, resultType: 'DEVICE_BUSY', reason: 'single_in_flight' });
      return Promise.reject(controlError('DEVICE_CONTROL_BUSY', 'A control request is already in flight for this device'));
    }
    if (signal?.aborted) return Promise.reject(controlError('CONTROL_CANCELLED', 'Control request was cancelled'));
    return new Promise((resolve, reject) => {
      const pending = {
        request: validation.value,
        resolve,
        reject,
        signal,
        delivered: false,
        timer: null,
        onAbort: null
      };
      pending.timer = setTimeout(() => {
        rejectPending(normalizedDeviceId, pending, 'CONTROL_TIMEOUT', 'request_expired_without_response');
      }, boundedTimeout);
      pending.timer.unref?.();
      pending.onAbort = () => {
        rejectPending(
          normalizedDeviceId,
          pending,
          'CONTROL_CANCELLED',
          pending.delivered ? 'caller_cancelled_after_dispatch' : 'caller_cancelled_before_dispatch'
        );
      };
      signal?.addEventListener('abort', pending.onAbort, { once: true });
      pendingByDevice.set(normalizedDeviceId, pending);
      try { onPendingChange({ deviceId: normalizedDeviceId, pending: true }); } catch (_) {}
      audit({
        deviceId: normalizedDeviceId,
        requestId: pending.request.request_id,
        capability,
        accepted: true,
        resultType: 'SUBMITTED'
      });
      notifyWaitingPoll(normalizedDeviceId, pending);
    });
  }

  function acknowledgeOrphanedResponse(deviceId, value, reason) {
    if (value.device_id !== deviceId) {
      audit({
        deviceId,
        requestId: value.request_id,
        accepted: false,
        resultType: 'DEVICE_ID_MISMATCH',
        reason: 'response_device_does_not_match_exchange_device'
      });
      throw controlError('DEVICE_ID_MISMATCH', 'Response device_id does not match the exchanging device');
    }
    const responseDigest = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const replay = lastAcknowledgedByDevice.get(deviceId);
    if (replay?.requestId === value.request_id && replay.responseDigest !== responseDigest) {
      audit({
        deviceId,
        requestId: value.request_id,
        accepted: false,
        resultType: 'REPLAY_RESPONSE_MISMATCH',
        reason: 'response_digest_changed'
      });
      throw controlError('REPLAY_RESPONSE_MISMATCH', 'Replayed response content does not match the acknowledged response');
    }
    lastAcknowledgedByDevice.set(deviceId, {
      requestId: value.request_id,
      responseDigest,
      expiresAt: now() + RESPONSE_REPLAY_TTL_MS
    });
    audit({
      deviceId,
      requestId: value.request_id,
      accepted: true,
      resultType: 'ORPHANED_RESPONSE_ACKNOWLEDGED',
      reason
    });
    return value.request_id;
  }

  function acceptResponse(deviceId, response) {
    cleanReplay();
    const pending = pendingByDevice.get(deviceId);
    const retired = retiredByDevice.get(deviceId)?.get(response.request_id);
    if (retired && (!pending || pending.request.request_id !== response.request_id)) {
      const validation = validateControlResponse(response, { expectedRequest: retired.request });
      if (!validation.ok) {
        audit({
          deviceId,
          requestId: retired.request.request_id,
          capability: retired.request.capability,
          accepted: false,
          resultType: validation.error.code,
          reason: validation.error.code
        });
        throw controlError(validation.error.code, validation.error.message);
      }
      const digest = crypto.createHash('sha256').update(JSON.stringify(validation.value)).digest('hex');
      if (retired.responseDigest && retired.responseDigest !== digest) {
        throw controlError('REPLAY_RESPONSE_MISMATCH', 'Late response content changed after acknowledgement');
      }
      retired.responseDigest = digest;
      audit({
        deviceId,
        requestId: retired.request.request_id,
        capability: retired.request.capability,
        accepted: true,
        resultType: 'LATE_RESPONSE_ACKNOWLEDGED',
        reason: 'request_already_terminal'
      });
      return validation.value.request_id;
    }
    if (!pending) {
      const replay = lastAcknowledgedByDevice.get(deviceId);
      if (replay?.requestId === response.request_id) {
        const validation = validateControlResponse(response);
        const digest = validation.ok
          ? crypto.createHash('sha256').update(JSON.stringify(validation.value)).digest('hex')
          : '';
        if (digest && digest === replay.responseDigest) return response.request_id;
        audit({ deviceId, requestId: response.request_id, accepted: false, resultType: 'REPLAY_RESPONSE_MISMATCH', reason: 'response_digest_changed' });
        throw controlError('REPLAY_RESPONSE_MISMATCH', 'Replayed response content does not match the acknowledged response');
      }
      // The Desktop process can restart after Mobile has executed a command but
      // before its response is acknowledged. The request registry is intentionally
      // in-memory, while Mobile durably retries that response until it receives an
      // ACK. Accepting and discarding a structurally valid response from the
      // already-authenticated device breaks that restart deadlock without applying
      // the orphaned result to any current caller.
      const orphaned = validateControlResponse(response);
      if (!orphaned.ok) {
        audit({
          deviceId,
          requestId: response.request_id,
          accepted: false,
          resultType: orphaned.error.code,
          reason: orphaned.error.code
        });
        throw controlError(orphaned.error.code, orphaned.error.message);
      }
      return acknowledgeOrphanedResponse(
        deviceId,
        orphaned.value,
        'desktop_request_registry_restarted'
      );
    }
    if (response.request_id !== pending.request.request_id) {
      const orphaned = validateControlResponse(response);
      if (!orphaned.ok) {
        audit({
          deviceId,
          requestId: response.request_id,
          accepted: false,
          resultType: orphaned.error.code,
          reason: orphaned.error.code
        });
        throw controlError(orphaned.error.code, orphaned.error.message);
      }
      if (orphaned.value.device_id !== deviceId) {
        return acknowledgeOrphanedResponse(
          deviceId,
          orphaned.value,
          'response_arrived_before_current_request'
        );
      }
      if (orphaned.value.completed_at_epoch_ms < pending.request.issued_at_epoch_ms) {
        return acknowledgeOrphanedResponse(
          deviceId,
          orphaned.value,
          'response_arrived_before_current_request'
        );
      }
    }
    const validated = validateControlResponse(response, { expectedRequest: pending.request });
    if (!validated.ok) {
      audit({
        deviceId,
        requestId: pending.request.request_id,
        capability: pending.request.capability,
        accepted: false,
        resultType: validated.error.code,
        reason: validated.error.code
      });
      throw controlError(validated.error.code, validated.error.message);
    }
    if (!removePending(deviceId, pending)) throw controlError('CONTROL_STATE_CONFLICT', 'Pending control request changed');
    lastAcknowledgedByDevice.set(deviceId, {
      requestId: validated.value.request_id,
      responseDigest: crypto.createHash('sha256').update(JSON.stringify(validated.value)).digest('hex'),
      expiresAt: now() + RESPONSE_REPLAY_TTL_MS
    });
    audit({
      deviceId,
      requestId: pending.request.request_id,
      capability: pending.request.capability,
      accepted: true,
      resultType: validated.value.status,
      reason: validated.value.reason
    });
    pending.resolve(validated.value);
    return validated.value.request_id;
  }

  async function exchange({ deviceId, response = null, waitMs = MAX_LONG_POLL_MS } = {}) {
    if (stopped) throw controlError('CONTROL_PLANE_STOPPED', 'Device Control Plane is stopped');
    let acknowledged = null;
    if (response) acknowledged = acceptResponse(deviceId, response);
    const pending = pendingByDevice.get(deviceId);
    if (pending && pending.request.expires_at_epoch_ms <= now()) {
      rejectPending(deviceId, pending, 'CONTROL_TIMEOUT', 'request_expired_without_response');
    }
    const deliverable = pendingByDevice.get(deviceId);
    if (deliverable) return commandExchange(deviceId, deliverable, acknowledged);
    if (response || waitMs <= 0) return idleExchange(deviceId, acknowledged);
    const boundedWait = Math.min(MAX_LONG_POLL_MS, Math.max(250, Number(waitMs) || MAX_LONG_POLL_MS));
    settleWaiter(deviceId, idleExchange(deviceId));
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          if (pollWaiterByDevice.get(deviceId) !== waiter) return;
          pollWaiterByDevice.delete(deviceId);
          resolve(idleExchange(deviceId));
        }, boundedWait)
      };
      waiter.timer.unref?.();
      pollWaiterByDevice.set(deviceId, waiter);
    });
  }

  function listAudit({ deviceId = null, limit = 50 } = {}) {
    const bounded = Math.min(MAX_AUDIT_ENTRIES, Math.max(1, Number(limit) || 50));
    return auditEntries
      .filter((entry) => !deviceId || entry.peer_device_id === deviceId)
      .slice(-bounded)
      .map((entry) => ({ ...entry }));
  }

  function shutdown() {
    if (stopped) return;
    stopped = true;
    for (const [deviceId, pending] of pendingByDevice) {
      rejectPending(deviceId, pending, 'CONTROL_PLANE_STOPPED', 'desktop_runtime_stopped');
    }
    for (const [deviceId] of pollWaiterByDevice) settleWaiter(deviceId, idleExchange(deviceId));
    lastAcknowledgedByDevice.clear();
    retiredByDevice.clear();
  }

  return {
    exchange,
    listAudit,
    shutdown,
    submit,
    pendingCount: () => pendingByDevice.size
  };
}

module.exports = {
  DEFAULT_CONTROL_TIMEOUT_MS,
  MAX_LONG_POLL_MS,
  createMobileDeviceControlPlane
};
