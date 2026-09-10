'use strict';

(function exposeNexaStudyCenterRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaStudyCenterRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaStudyCenterRendererApi() {
  const OWNED_LOOPBACK_PORTS = new Set([4316, 4416, 4516, 4616, 4816]);

  function validatedEndpoint(value) {
    if (value?.host !== '127.0.0.1' || !OWNED_LOOPBACK_PORTS.has(value?.port) ||
        typeof value?.url !== 'string') return null;
    try {
      const url = new URL(value.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
          Number(url.port) !== value.port || url.pathname !== '/' || url.search || url.hash) return null;
      return url.href;
    } catch { return null; }
  }

  function safeFailureCode(value) {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
      ? value : 'STUDY_CENTER_UNAVAILABLE';
  }

  function formatAttemptTime(value) {
    if (!value) return '尚未尝试';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const surface = options.surface;
    if (!api || typeof api.start !== 'function' || typeof api.stop !== 'function' ||
        typeof api.getReadiness !== 'function' || !surface || typeof surface.replaceChildren !== 'function') {
      throw new TypeError('Study Center renderer requires the public preload API and a host surface');
    }
    const ownerDocument = surface.ownerDocument || document;
    const onContextChange = typeof options.onContextChange === 'function' ? options.onContextChange : () => {};
    const onOpenSettings = typeof options.onOpenSettings === 'function' ? options.onOpenSettings : null;
    const messageTarget = options.messageTarget ||
      (typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null);
    const scheduleTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    const cancelTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    const frameLoadTimeoutMs = Number.isFinite(options.frameLoadTimeoutMs) && options.frameLoadTimeoutMs > 0
      ? options.frameLoadTimeoutMs : 10_000;
    let generation = 0;
    let active = false;
    let pendingStop = Promise.resolve();
    let clearPendingFrame = () => {};
    let lastAttemptedAt = null;
    let state = Object.freeze({ status: 'OFFLINE', lifecycle: 'stopped' });

    function element(tag, className, text) {
      const node = ownerDocument.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function renderLoading() {
      const page = element('section', 'nexa-study-center-page');
      page.dataset.studyCenterState = 'loading';
      const status = element('div', 'nexa-study-center-loading');
      status.setAttribute('role', 'status');
      status.append(
        element('h1', '', '学习中心'),
        element('p', '', '正在启动本地学习运行时…')
      );
      page.append(status);
      surface.replaceChildren(page);
      return page;
    }

    function renderError(page, code) {
      page.dataset.studyCenterState = 'error';
      const panel = element('div', 'nexa-study-center-error');
      panel.setAttribute('role', 'alert');
      panel.append(
        element('h1', '', '学习中心暂时不可用'),
        element('p', '', '用途：学习中心用于打开本地词汇、发音与学习记录。'),
        element('p', '', `原因：本地 Study Center 未能完成启动或页面呈现（${safeFailureCode(code)}）。`),
        element('p', '', `最近尝试：${formatAttemptTime(lastAttemptedAt)} · 数据状态未知`),
        element('p', '', '下一步：重新尝试本地运行时；失败不会影响其它桌面模块。')
      );
      const retry = element('button', 'nexa-study-center-retry', '重新尝试');
      retry.type = 'button';
      retry.addEventListener('click', () => { void activate(); });
      panel.append(retry);
      if (onOpenSettings) {
        const settings = element('button', 'nexa-study-center-settings', '打开设置');
        settings.type = 'button';
        settings.addEventListener('click', onOpenSettings);
        panel.append(settings);
      }
      page.replaceChildren(panel);
    }

    async function activate() {
      const currentGeneration = ++generation;
      active = true;
      lastAttemptedAt = new Date().toISOString();
      clearPendingFrame();
      clearPendingFrame = () => {};
      const page = renderLoading();
      state = Object.freeze({ status: 'LIMITED', lifecycle: 'starting' });
      onContextChange({ title: '学习中心', status: state.status });
      await pendingStop.catch(() => {});
      if (!active || generation !== currentGeneration) return state;

      let started;
      try {
        started = await api.start();
      } catch (error) {
        if (!active || generation !== currentGeneration) return state;
        renderError(page, typeof error?.code === 'string' ? error.code : 'STUDY_CENTER_START_FAILED');
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '学习中心', status: state.status });
        return state;
      }
      if (!active || generation !== currentGeneration) return state;
      if (!started?.ok) {
        renderError(page, started?.error?.code);
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '学习中心', status: state.status });
        return state;
      }
      let readinessEnvelope;
      try {
        readinessEnvelope = await api.getReadiness();
      } catch (error) {
        if (!active || generation !== currentGeneration) return state;
        renderError(page, typeof error?.code === 'string' ? error.code : 'STUDY_CENTER_READINESS_FAILED');
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '学习中心', status: state.status });
        return state;
      }
      if (!active || generation !== currentGeneration) return state;
      const readiness = readinessEnvelope?.ok ? readinessEnvelope.value : started.value;
      const endpoint = readiness?.ready ? validatedEndpoint(readiness.endpoint) : null;
      if (!endpoint || readiness?.runtimeNetworkDependency !== 0 ||
          readiness?.singleWriterScope !== 'PROCESS_LOCAL_SINGLE_WRITER') {
        renderError(page, readiness?.code || 'INVALID_STUDY_CENTER_READINESS');
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '学习中心', status: state.status });
        return state;
      }

      const frame = element('iframe', 'nexa-study-center-frame');
      frame.title = '学习中心';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-downloads');
      frame.setAttribute('allow', 'autoplay');
      frame.className = 'nexa-study-center-frame is-loading';
      const frameLoading = element('div', 'nexa-study-center-loading nexa-study-center-frame-loading');
      frameLoading.setAttribute('role', 'status');
      const frameLoadingMessage = element('p', '', '本地学习内容已启动，正在完成页面载入…');
      frameLoading.append(
        element('h1', '', '学习中心'),
        frameLoadingMessage
      );
      const endpointOrigin = new URL(endpoint).origin;
      let settled = false;
      let frameTimer = null;
      const cleanupFrameWait = () => {
        if (frameTimer !== null) cancelTimeout(frameTimer);
        frameTimer = null;
        frame.removeEventListener?.('load', onFrameLoad);
        frame.removeEventListener?.('error', onFrameError);
        messageTarget?.removeEventListener?.('message', onFrameMessage);
        if (clearPendingFrame === cancelFrameWait) clearPendingFrame = () => {};
      };
      const cancelFrameWait = () => {
        if (settled) return;
        settled = true;
        cleanupFrameWait();
      };
      const revealFrame = () => {
        if (settled || !active || generation !== currentGeneration) return;
        settled = true;
        cleanupFrameWait();
        frame.className = 'nexa-study-center-frame';
        page.dataset.studyCenterState = 'ready';
        page.replaceChildren(frame);
        state = Object.freeze({ status: 'READY', lifecycle: 'started', endpoint });
        onContextChange({ title: '学习中心', status: state.status });
      };
      const failFrame = (code = 'STUDY_CENTER_FRAME_LOAD_FAILED') => {
        if (settled || !active || generation !== currentGeneration) return;
        settled = true;
        cleanupFrameWait();
        renderError(page, code);
        state = Object.freeze({ status: 'ERROR', lifecycle: 'error' });
        onContextChange({ title: '学习中心', status: state.status });
      };
      const onFrameError = () => failFrame();
      const onFrameLoad = () => {
        if (settled || !active || generation !== currentGeneration) return;
        if (!messageTarget) {
          revealFrame();
          return;
        }
        page.dataset.studyCenterState = 'awaiting-render';
        frameLoadingMessage.textContent = '页面已连接，正在呈现本地学习内容…';
      };
      const onFrameMessage = (event) => {
        if (settled || !active || generation !== currentGeneration) return;
        if (event?.source !== frame.contentWindow || event?.origin !== endpointOrigin) return;
        const message = event.data;
        if (!message || message.type !== 'NEXA_STUDY_CENTER_FRAME_STATE' || message.version !== 1) return;
        if (message.state === 'READY') revealFrame();
        else if (message.state === 'ERROR') failFrame('STUDY_CENTER_FRAME_RENDER_FAILED');
      };
      frame.addEventListener('load', onFrameLoad, { once: true });
      frame.addEventListener('error', onFrameError, { once: true });
      messageTarget?.addEventListener?.('message', onFrameMessage);
      page.dataset.studyCenterState = 'loading-frame';
      page.replaceChildren(frame, frameLoading);
      state = Object.freeze({ status: 'LIMITED', lifecycle: 'loading-frame', endpoint });
      clearPendingFrame = cancelFrameWait;
      frameTimer = scheduleTimeout(() => failFrame('STUDY_CENTER_FRAME_LOAD_TIMEOUT'), frameLoadTimeoutMs);
      frame.src = endpoint;
      return state;
    }

    async function unmount() {
      generation += 1;
      active = false;
      clearPendingFrame();
      clearPendingFrame = () => {};
      surface.replaceChildren();
      pendingStop = pendingStop.catch(() => {}).then(() => api.stop());
      const result = await pendingStop;
      state = Object.freeze({ status: result?.ok ? 'OFFLINE' : 'ERROR', lifecycle: 'stopped' });
      return state;
    }

    function getState() { return state; }
    function dispose() { return unmount(); }

    return Object.freeze({ activate, unmount, dispose, getState });
  }

  return Object.freeze({ createRenderer, formatAttemptTime, safeFailureCode, validatedEndpoint });
});
