'use strict';

(function exposeNexaDeviceCenterUiIntegrationHost(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaDeviceCenterUiIntegrationHost = api;
})(typeof window !== 'undefined' ? window : null, function createDeviceCenterUiIntegrationHostApi(root) {
  const UI_ENTRY = '../../../../../03_modules/设备与网络/src/ui-integration.mjs';
  const PACKAGED_UI_ENTRY = '../../../../../../../../../03_modules/设备与网络/src/ui-integration.mjs';
  const UI_VERSION = '0.1';
  const VIEW_LABELS = Object.freeze({
    overview: '概览', performance: '性能', network: '网络', applications: '应用',
    history: '历史', anomalies: '异常', diagnostics: '诊断'
  });

  function routeView(route) {
    const value = String(route || '');
    if (!value.startsWith('#/device-center')) return 'overview';
    const requested = new URLSearchParams(value.split('?')[1] || '').get('view');
    return ['overview', 'performance', 'network', 'applications', 'history', 'anomalies', 'diagnostics']
      .includes(requested) ? requested : 'overview';
  }

  function resolveUiEntry(browser) {
    const href = browser?.location?.href;
    if (typeof href !== 'string' || !href) return UI_ENTRY;
    try {
      const base = new URL(href);
      if (base.protocol !== 'file:') return UI_ENTRY;
      const relative = /\/app\.asar\//iu.test(base.pathname) ? PACKAGED_UI_ENTRY : UI_ENTRY;
      return new URL(relative, base).href;
    } catch { return UI_ENTRY; }
  }

  function renderUnavailable(document, surface, code, onRetry) {
    const panel = document.createElement('section');
    panel.className = 'nexa-device-state nexa-device-state-error';
    const title = document.createElement('h2');
    title.textContent = '设备与网络不可用';
    const copy = document.createElement('p');
    copy.textContent = '用途：查看本机硬件、网络、应用、历史、异常与诊断的只读观测。';
    const reason = document.createElement('p');
    reason.textContent = '原因：模块页面或其本地 UI Integration 暂时无法加载。';
    const freshness = document.createElement('p');
    freshness.textContent = '最近更新：未完成 · 数据状态未知';
    const nextStep = document.createElement('p');
    nextStep.textContent = '下一步：重试加载本地模块；失败不会触发采集、网络或设备变更。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试加载';
    retry.addEventListener('click', onRetry);
    const diagnostics = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '查看诊断信息';
    const diagnosticCode = document.createElement('code');
    diagnosticCode.textContent = code;
    diagnostics.append(summary, diagnosticCode);
    panel.append(title, copy, reason, freshness, nextStep, retry, diagnostics);
    surface.replaceChildren(panel);
  }

  function createRenderer(options = {}) {
    const deviceApi = options.api;
    const mobileApi = options.mobileApi;
    const surface = options.surface;
    const navigation = options.subNavigation;
    const onContextChange = typeof options.onContextChange === 'function' ? options.onContextChange : () => {};
    const document = options.document || root?.document;
    const browser = options.window || root;
    if (!deviceApi || !surface || !navigation || !document || !browser) {
      throw new TypeError('Device Center UI host requires api, surface, navigation, document, and window');
    }
    let active = false;
    let generation = 0;
    let mounted = null;
    let mounting = null;

    function hostCapabilities() {
      return Object.freeze({
        document,
        locale: () => browser.navigator?.languages?.[0] || browser.navigator?.language || 'en',
        readRoute: () => browser.location?.hash || '',
        replaceRoute(route) {
          if (typeof route !== 'string' || !route.startsWith('#/device-center')) {
            throw new TypeError('Device Center UI attempted to replace a foreign route');
          }
          browser.history.replaceState(browser.history.state, '', route);
        }
      });
    }

    function ensureMounted() {
      if (mounted) return Promise.resolve(mounted);
      if (mounting) return mounting;
      mounting = import(resolveUiEntry(browser)).then((entry) => {
        if (!active) {
          mounting = null;
          return null;
        }
        if (entry.DEVICE_CENTER_UI_INTEGRATION_VERSION !== UI_VERSION ||
            typeof entry.createDeviceCenterUiIntegration !== 'function') {
          throw Object.assign(new Error('Invalid Device Center UI Integration'), {
            code: 'INVALID_DEVICE_CENTER_UI_INTEGRATION'
          });
        }
        navigation.replaceChildren();
        const integration = entry.createDeviceCenterUiIntegration({
          deviceApi,
          mobileApi,
          host: hostCapabilities()
        });
        if (integration?.version !== UI_VERSION || typeof integration.mount !== 'function') {
          throw Object.assign(new Error('Invalid Device Center UI Integration instance'), {
            code: 'INVALID_DEVICE_CENTER_UI_INTEGRATION'
          });
        }
        const handle = integration.mount({ surface, navigation, onContextChange });
        for (const method of ['activate', 'deactivate', 'getView', 'load', 'unmount']) {
          if (typeof handle?.[method] !== 'function') {
            throw Object.assign(new Error('Invalid Device Center UI mount handle'), {
              code: 'INVALID_DEVICE_CENTER_UI_MOUNT'
            });
          }
        }
        mounted = handle;
        mounting = null;
        return handle;
      }).catch((error) => {
        const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
          ? error.code : 'DEVICE_CENTER_UI_INTEGRATION_UNAVAILABLE';
        renderUnavailable(document, surface, code, () => { void activate(); });
        onContextChange({ title: '设备与网络', status: 'UNAVAILABLE' });
        mounting = null;
        throw error;
      });
      return mounting;
    }

    async function activate() {
      active = true;
      const current = ++generation;
      try {
        const handle = await ensureMounted();
        if (!handle || !active || current !== generation) return;
        return handle.activate();
      } catch (_) {
        return undefined;
      }
    }

    function deactivate() {
      active = false;
      generation += 1;
      mounted?.deactivate();
    }

    function unmount() {
      active = false;
      generation += 1;
      const handle = mounted;
      mounted = null;
      return handle?.unmount() || false;
    }

    async function load() {
      try {
        const handle = await ensureMounted();
        if (active) return handle.load();
      } catch (_) {}
      return undefined;
    }

    return Object.freeze({
      activate,
      deactivate,
      getView: () => mounted?.getView() || routeView(browser.location?.hash),
      load,
      unmount
    });
  }

  return Object.freeze({ UI_ENTRY, UI_VERSION, VIEW_LABELS, createRenderer, resolveUiEntry, routeView });
});
