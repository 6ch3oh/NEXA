'use strict';

(function exposeNexaRightDrawer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaRightDrawer = api;
})(typeof window !== 'undefined' ? window : null, function createRightDrawerApi() {
  function createRightDrawer(elements) {
    const drawer = elements?.drawer;
    const title = elements?.title;
    const description = elements?.description;
    const context = elements?.context;
    const state = elements?.state;
    const body = elements?.body;
    const actions = elements?.actions;
    const close = elements?.close;
    if (![drawer, title, description, context, state, body, actions, close].every(Boolean)) {
      throw new TypeError('RightDrawer requires the complete Core shell element set');
    }
    let returnFocus = null;
    let dirty = false;
    let confirmClose = () => true;
    const inerted = new Map();

    function setBackgroundInert(value) {
      for (const sibling of drawer.parentElement?.children || []) {
        if (sibling === drawer) continue;
        if (value) {
          inerted.set(sibling, sibling.inert === true);
          sibling.inert = true;
        } else if (inerted.has(sibling)) {
          sibling.inert = inerted.get(sibling);
        }
      }
      if (!value) inerted.clear();
    }

    function setHidden(hidden) {
      drawer.classList.toggle('hidden', hidden);
      drawer.setAttribute('aria-hidden', hidden ? 'true' : 'false');
      if ('inert' in drawer) drawer.inert = hidden;
      setBackgroundInert(!hidden);
    }

    function closeDrawer(force = false) {
      if (!force && dirty && !confirmClose()) return false;
      setHidden(true);
      dirty = false;
      const target = returnFocus;
      returnFocus = null;
      target?.focus?.();
      return true;
    }

    function open(options = {}) {
      returnFocus = options.returnFocus || null;
      dirty = options.dirty === true;
      confirmClose = typeof options.confirmClose === 'function' ? options.confirmClose : () => true;
      title.textContent = options.title || '详情';
      description.textContent = options.description || '';
      context.textContent = options.context || '';
      state.textContent = options.state && options.state !== 'ready' ? options.state : '';
      state.className = `nexa-drawer-state nexa-drawer-state-${options.state || 'ready'}`;
      body.replaceChildren();
      actions.replaceChildren();
      if (options.body) body.append(options.body);
      for (const action of options.actions || []) actions.append(action);
      actions.classList.toggle('hidden', actions.childElementCount === 0);
      close.setAttribute('aria-label', `关闭${title.textContent}`);
      setHidden(false);
      const first = body.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])') ||
        actions.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])');
      (first || close).focus();
    }

    function setDirty(value) {
      dirty = value === true;
    }

    close.addEventListener('click', () => closeDrawer());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !drawer.classList.contains('hidden')) {
        event.preventDefault();
        closeDrawer();
      }
      if (event.key === 'Tab' && !drawer.classList.contains('hidden')) {
        const focusable = [...drawer.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    });

    setHidden(true);
    return Object.freeze({ close: closeDrawer, open, setDirty });
  }

  return Object.freeze({ createRightDrawer });
});
