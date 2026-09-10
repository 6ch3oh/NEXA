'use strict';

const { createDnsPodDdnsUpdater, DEFAULT_DDNS_TTL } = require('../shared/dnspodDdns');
const { readWindowsGenericCredentials } = require('../shared/windowsCredentialManager');

const DESKTOP_DDNS_DOMAIN = '6ch3oh.cn';
const DESKTOP_DDNS_SUBDOMAIN = 'pc';
const DESKTOP_DDNS_HOSTNAME = `${DESKTOP_DDNS_SUBDOMAIN}.${DESKTOP_DDNS_DOMAIN}`;
const DNSPOD_SECRET_ID_TARGET = 'NEXA/DNSPod/SecretId';
const DNSPOD_SECRET_KEY_TARGET = 'NEXA/DNSPod/SecretKey';
const NETWORK_POLL_INTERVAL_MS = 15_000;
const PERIODIC_VERIFY_INTERVAL_MS = DEFAULT_DDNS_TTL * 1000;

function createDnsPodCredentialProvider({ credentialReader = readWindowsGenericCredentials } = {}) {
  return () => {
    const stored = credentialReader([DNSPOD_SECRET_ID_TARGET, DNSPOD_SECRET_KEY_TARGET]);
    if (!stored) return null;
    return Object.freeze({
      secretId: stored[DNSPOD_SECRET_ID_TARGET],
      secretKey: stored[DNSPOD_SECRET_KEY_TARGET]
    });
  };
}

function interfaceSignature(interfaces) {
  return (interfaces || []).map((candidate) =>
    `${String(candidate?.interface || '')}:${String(candidate?.address || '')}`
  ).sort().join('|');
}

function safeLogResult(logger, state) {
  const fields = [
    `state=${state.state}`,
    `reason=${String(state.reason || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_')}`
  ];
  if (state.address) fields.push(`address=${state.address}`);
  if (state.interface) fields.push(`interface=${String(state.interface).replace(/[^A-Za-z0-9 _.-]/g, '_')}`);
  if (state.errorCode) fields.push(`error=${String(state.errorCode).replace(/[^A-Za-z0-9_.-]/g, '_')}`);
  logger.log?.(`[desktop-ddns] ${fields.join(' ')}`);
}

function createDesktopDdnsRuntime({
  enabled = false,
  interfacesProvider,
  credentialProvider = null,
  updater = null,
  updaterFactory = createDnsPodDdnsUpdater,
  clock = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = console
}) {
  if (enabled !== true) {
    const blockedState = Object.freeze({
      state: 'BLOCKED',
      reason: 'HUMAN_CONFIRMATION_REQUIRED',
      hostname: DESKTOP_DDNS_HOSTNAME,
      ttl: DEFAULT_DDNS_TTL
    });
    return Object.freeze({
      start() {
        return blockedState;
      },
      stop() {},
      async reconcileNow() {
        return blockedState;
      },
      getState() {
        return blockedState;
      }
    });
  }
  if (typeof interfacesProvider !== 'function') throw new Error('Physical interface provider is required');
  const resolvedCredentialProvider = credentialProvider || createDnsPodCredentialProvider();
  const managedUpdater = updater || updaterFactory({
    domain: DESKTOP_DDNS_DOMAIN,
    subDomain: DESKTOP_DDNS_SUBDOMAIN,
    ttl: DEFAULT_DDNS_TTL,
    interfacesProvider,
    credentialProvider: resolvedCredentialProvider
  });
  let timer = null;
  let running = false;
  let stopped = true;
  let pendingReason = null;
  let lastSignature = '';
  let lastReconcileAt = 0;
  let state = Object.freeze({
    state: 'DORMANT',
    hostname: DESKTOP_DDNS_HOSTNAME,
    ttl: DEFAULT_DDNS_TTL
  });

  async function reconcile(reason) {
    if (stopped) return state;
    if (running) {
      pendingReason = pendingReason || reason;
      return state;
    }
    running = true;
    try {
      const next = await managedUpdater.reconcile(reason);
      lastReconcileAt = clock();
      state = Object.freeze({
        hostname: DESKTOP_DDNS_HOSTNAME,
        ttl: DEFAULT_DDNS_TTL,
        observed_at_epoch_ms: lastReconcileAt,
        ...next
      });
      safeLogResult(logger, state);
    } catch (_) {
      lastReconcileAt = clock();
      state = Object.freeze({
        state: 'FAILED_SOFT',
        hostname: DESKTOP_DDNS_HOSTNAME,
        ttl: DEFAULT_DDNS_TTL,
        observed_at_epoch_ms: lastReconcileAt,
        reason,
        errorCode: 'DDNS_UPDATE_FAILED'
      });
      safeLogResult(logger, state);
    } finally {
      running = false;
      if (pendingReason && !stopped) {
        const nextReason = pendingReason;
        pendingReason = null;
        void reconcile(nextReason);
      }
    }
    return state;
  }

  function tick() {
    if (stopped) return;
    const signature = interfaceSignature(interfacesProvider());
    if (signature !== lastSignature) {
      lastSignature = signature;
      void reconcile('physical_network_change');
      return;
    }
    if (clock() - lastReconcileAt >= PERIODIC_VERIFY_INTERVAL_MS) {
      void reconcile('periodic_verification');
    }
  }

  return Object.freeze({
    start() {
      if (!stopped) return;
      stopped = false;
      lastSignature = interfaceSignature(interfacesProvider());
      void reconcile('desktop_startup');
      timer = setIntervalFn(tick, NETWORK_POLL_INTERVAL_MS);
      timer?.unref?.();
    },
    stop() {
      stopped = true;
      pendingReason = null;
      if (timer) clearIntervalFn(timer);
      timer = null;
    },
    reconcileNow(reason = 'manual') {
      return reconcile(reason);
    },
    getState() {
      return state;
    }
  });
}

module.exports = {
  DESKTOP_DDNS_DOMAIN,
  DESKTOP_DDNS_HOSTNAME,
  DESKTOP_DDNS_SUBDOMAIN,
  DNSPOD_SECRET_ID_TARGET,
  DNSPOD_SECRET_KEY_TARGET,
  NETWORK_POLL_INTERVAL_MS,
  PERIODIC_VERIFY_INTERVAL_MS,
  createDesktopDdnsRuntime,
  createDnsPodCredentialProvider,
  interfaceSignature
};
