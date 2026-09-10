'use strict';

(function init(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.NexaUiContextPreserver = api;
})(typeof globalThis === 'object' ? globalThis : this, function factory() {
  function keyFor(element) { return element?.id || element?.dataset?.nexaPreserveKey || (element?.name ? `name:${element.name}` : ''); }

  function captureUiContext(document, window, roots = []) {
    const fields = {}; const scroll = {}; const details = {}; const selected = [];
    const elements = roots.flatMap((root) => root ? [root, ...root.querySelectorAll('*')] : []);
    for (const element of elements) {
      const key = keyFor(element);
      if (key && element.scrollHeight > element.clientHeight) scroll[key] = element.scrollTop;
      if (key && 'value' in element && /^(INPUT|SELECT|TEXTAREA)$/u.test(element.tagName)) fields[key] = element.value;
      if (key && element.tagName === 'DETAILS') details[key] = element.open === true;
      if (key && element.getAttribute?.('aria-selected') === 'true') selected.push(key);
    }
    return { pageScroll: Number(window.scrollY || document.scrollingElement?.scrollTop || 0), fields, scroll, details, selected };
  }

  function findByKey(document, key) {
    if (key.startsWith('name:')) return [...document.querySelectorAll('[name]')].find((item) => item.name === key.slice(5)) || null;
    return document.getElementById(key) || [...document.querySelectorAll('[data-nexa-preserve-key]')].find((item) => item.dataset.nexaPreserveKey === key) || null;
  }

  function restoreUiContext(snapshot, document, window) {
    if (!snapshot) return;
    for (const [key, value] of Object.entries(snapshot.fields || {})) { const element = findByKey(document, key); if (element && 'value' in element) element.value = value; }
    for (const [key, value] of Object.entries(snapshot.details || {})) { const element = findByKey(document, key); if (element?.tagName === 'DETAILS') element.open = value; }
    for (const element of document.querySelectorAll('[aria-selected="true"]')) if (keyFor(element)) element.setAttribute('aria-selected', 'false');
    for (const key of snapshot.selected || []) { const element = findByKey(document, key); if (element) element.setAttribute('aria-selected', 'true'); }
    for (const [key, value] of Object.entries(snapshot.scroll || {})) { const element = findByKey(document, key); if (element) element.scrollTop = value; }
    window.scrollTo?.({ top: snapshot.pageScroll || 0, left: window.scrollX || 0, behavior: 'instant' });
  }

  function createUiContextPreserver({ document, window, roots, getRoute = () => 'home' } = {}) {
    const snapshots = new Map(); let disposed = false; let scheduled = false; let restoring = false;
    const capture = () => snapshots.set(getRoute(), captureUiContext(document, window, roots));
    const restore = () => restoreUiContext(snapshots.get(getRoute()), document, window);
    const afterInteraction = () => queueMicrotask(capture);
    const observer = new MutationObserver(() => {
      if (scheduled || restoring || disposed || !snapshots.has(getRoute())) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false; restoring = true; restore();
        requestAnimationFrame(() => { restoring = false; });
      });
    });
    window.addEventListener('scroll', capture, true);
    document.addEventListener('input', afterInteraction, true);
    document.addEventListener('change', afterInteraction, true);
    document.addEventListener('click', afterInteraction, true);
    for (const root of roots) if (root) observer.observe(root, { childList: true, subtree: true });
    capture();
    return Object.freeze({ capture, restore, dispose() { disposed = true; observer.disconnect(); window.removeEventListener('scroll', capture, true); } });
  }

  return Object.freeze({ captureUiContext, createUiContextPreserver, restoreUiContext });
});
