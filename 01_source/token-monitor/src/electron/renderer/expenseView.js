'use strict';

// Renderer module for the local Expense Records feature: the "Expense" main view
// and the "Expense Records" settings section. All data flows through the preload
// `window.tokenMonitor.expense` bridge (main-process owned storage + inbox watcher),
// so the renderer never gains filesystem access. Pure DOM work, no native deps.

(function exposeExpenseView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorExpenseView = api;
})(typeof window !== 'undefined' ? window : null, function createExpenseViewApi() {
  const i18n = (typeof window !== 'undefined' && window.TokenMonitorI18n) || { translate: (l, k) => k };

  function tr(locale, key, params) {
    return i18n.translate ? i18n.translate(locale, key, params) : key;
  }

  function formatCents(cents, currency) {
    const value = Math.abs(Math.trunc(Number(cents) || 0)) / 100;
    const symbol = currency === 'CNY' ? '¥' : (currency || 'CNY') === 'USD' ? '$' : ` ${currency || 'CNY'} `;
    return `${symbol}${value.toFixed(2)}`;
  }

  function directionClass(record) {
    return record && record.direction === 'income' ? 'is-income' : 'is-expense';
  }

  // Display-layer enum mapping (internal enums stay unchanged). Unknown or empty
  // values fall back to '其他' so the UI never renders "undefined".
  const PLATFORM_LABELS = Object.freeze({
    wechat: '微信',
    alipay: '支付宝',
    bank: '银行卡',
    cash: '现金',
    manual: '手动',
    other: '其他'
  });
  const DIRECTION_LABELS = Object.freeze({
    expense: '支出',
    income: '收入',
    refund: '退款'
  });
  const CATEGORY_LABELS = Object.freeze({
    food: '餐饮',
    transport: '交通',
    shopping: '购物',
    entertainment: '娱乐',
    medical: '医疗',
    housing: '居住',
    digital: '数码服务',
    education: '教育',
    salary: '工资',
    other: '其他'
  });
  const DISPLAY_FALLBACK = '其他';

  function mappedLabel(map, value) {
    const key = String(value == null ? '' : value).trim();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : DISPLAY_FALLBACK;
  }

  function platformLabel(value) {
    return mappedLabel(PLATFORM_LABELS, value);
  }

  function directionLabel(value) {
    return mappedLabel(DIRECTION_LABELS, value);
  }

  function categoryLabel(value) {
    const key = String(value == null ? '' : value).trim();
    if (!key) return DISPLAY_FALLBACK;
    if (Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, key)) return CATEGORY_LABELS[key];
    // Already a human-readable label (e.g. from CSV import) is shown as-is.
    if (Object.values(CATEGORY_LABELS).includes(key)) return key;
    return DISPLAY_FALLBACK;
  }

  function signedCents(record) {
    return record && record.direction === 'income'
      ? -Math.abs(Number(record.amountCents) || 0)
      : Math.abs(Number(record.amountCents) || 0);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderRecentRow(record, locale) {
    const row = el('div', 'expense-recent-row');
    const left = el('div', 'expense-recent-left');
    const merchant = el('div', 'expense-recent-merchant', record.merchant || tr(locale, 'expense.merchant'));
    const meta = el('div', 'expense-recent-meta', [
      platformLabel(record.platform),
      record.occurredAt || '',
      categoryLabel(record.category),
      directionLabel(record.direction)
    ].filter(Boolean).join(' · '));
    left.append(merchant, meta);
    const amount = el('div', `expense-recent-amount ${directionClass(record)}`, formatCents(signedCents(record), record.currency));
    row.append(left, amount);
    return row;
  }

  function renderCategoryRow(row, locale) {
    const item = el('div', 'expense-category-row');
    const label = el('span', 'expense-category-label', categoryLabel(row.category || row.label));
    const meta = el('span', 'expense-category-meta', `${row.count} ${tr(locale, 'settings.expense.rows')}`);
    item.append(label, meta);
    return item;
  }

  // Main "Expense" view.
  function renderPanel(elPanel, { snapshot, locale } = {}) {
    if (!elPanel) return;
    const snap = snapshot || {};
    const currency = snap.currency || 'CNY';
    const header = el('div', 'expense-header');
    const title = el('div', 'expense-headline');
    const total = el('div', 'expense-total');
    const totalLabel = el('span', 'expense-total-label', tr(locale, 'expense.total'));
    const totalValue = el('span', 'expense-total-value', formatCents(snap.expenseCents, currency));
    total.append(totalLabel, totalValue);
    const month = el('div', 'expense-month');
    const monthLabel = el('span', 'expense-month-label', tr(locale, 'expense.month'));
    const monthValue = el('span', 'expense-month-value', formatCents(snap.monthCents, currency));
    month.append(monthLabel, monthValue);
    title.append(total, month);
    const meta = el('div', 'expense-meta', [
      `${tr(locale, 'expense.expense')} ${formatCents(snap.expenseCents, currency)}`,
      `${tr(locale, 'expense.income')} ${formatCents(snap.incomeCents, currency)}`,
      `${Number(snap.totalCount || 0)} ${tr(locale, 'settings.expense.rows')}`
    ].join(' · '));
    header.append(title, meta);

    const body = el('div', 'expense-body');
    if (!snap.totalCount) {
      const empty = el('div', 'expense-empty', tr(locale, 'expense.empty'));
      body.append(empty);
    } else {
      const categories = el('section', 'expense-section');
      const catTitle = el('h2', '', tr(locale, 'expense.byCategory'));
      categories.append(catTitle);
      const catList = el('div', 'expense-category-list');
      for (const row of snap.categories || []) catList.append(renderCategoryRow(row, locale));
      categories.append(catList);
      body.append(categories);

      const recent = el('section', 'expense-section');
      const recentTitle = el('h2', '', tr(locale, 'expense.recent'));
      const recentList = el('div', 'expense-recent-list');
      for (const record of snap.recent || []) recentList.append(renderRecentRow(record, locale));
      recent.append(recentTitle, recentList);
      body.append(recent);
    }

    elPanel.replaceChildren(header, body);
  }

  function field(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  let refreshInFlight = false;
  async function runManualRefresh(onRefresh) {
    if (refreshInFlight || typeof onRefresh !== 'function') return false;
    const button = field('expenseRefreshButton');
    const status = field('expenseStatusText');
    const wasDisabled = Boolean(button?.disabled);
    refreshInFlight = true;
    if (button) { button.disabled = true; button.classList.add('is-loading'); button.setAttribute('aria-busy', 'true'); }
    try {
      await onRefresh();
      return true;
    } catch (_) {
      if (status) status.textContent = '刷新失败，请重试';
      return false;
    } finally {
      refreshInFlight = false;
      if (button) { button.disabled = wasDisabled; button.classList.remove('is-loading'); button.setAttribute('aria-busy', 'false'); }
    }
  }

  // Sync the settings form from state.
  function syncSettings(state) {
    const enabled = Boolean(state?.expenseEnabled);
    const enabledInput = field('expenseEnabledInput');
    if (enabledInput) enabledInput.checked = enabled;
    const auto = field('expenseAutoCategorizeInput');
    if (auto) auto.checked = Boolean(state?.expenseAutoCategorize);
    const currency = field('expenseDefaultCurrencyInput');
    if (currency) currency.value = state?.expenseDefaultCurrency || 'CNY';
    const inbox = field('expenseInboxStatus');
    if (inbox) inbox.textContent = state?.expenseInboxRoot || '';
    const status = field('expenseStatusText');
    if (status) status.textContent = enabled ? tr(state?.locale, 'settings.expense.statusEnabled') : tr(state?.locale, 'settings.expense.statusDisabled');
    const inboxInfo = field('expenseInboxCount');
    if (inboxInfo && state?.expense) {
      inboxInfo.textContent = `${tr(state.locale, 'settings.expense.inbox')}: ${state.expense.inboxCount ?? 0}`;
    }
    const dataSource = field('expenseDataSourceCount');
    if (dataSource && state?.expense) {
      dataSource.textContent = `${state.expense.totalCount ?? 0} ${tr(state.locale, 'settings.expense.rows')}`;
    }
  }

  // Bind the settings section event listeners (idempotent; guarded by a flag).
  function bindSettings({ onRefresh } = {}) {
    if (bindSettings.done) return;
    bindSettings.done = true;
    const enabledInput = field('expenseEnabledInput');
    enabledInput?.addEventListener('change', () => {
      void window.tokenMonitor.updateSettings({ expenseEnabled: enabledInput.checked }).then((next) => {
        if (onRefresh) onRefresh(next);
      });
    });
    const autoInput = field('expenseAutoCategorizeInput');
    autoInput?.addEventListener('change', () => {
      void window.tokenMonitor.updateSettings({ expenseAutoCategorize: autoInput.checked }).then((next) => {
        if (onRefresh) onRefresh(next);
      });
    });
    const currencyInput = field('expenseDefaultCurrencyInput');
    currencyInput?.addEventListener('change', () => {
      void window.tokenMonitor.updateSettings({ expenseDefaultCurrency: currencyInput.value }).then((next) => {
        if (onRefresh) onRefresh(next);
      });
    });
    field('expenseOpenInboxButton')?.addEventListener('click', () => {
      void window.tokenMonitor.expense?.openInbox?.();
    });
    field('expenseOpenRootButton')?.addEventListener('click', () => {
      void window.tokenMonitor.expense?.openExpenseRoot?.();
    });
    field('expenseRefreshButton')?.addEventListener('click', () => {
      void runManualRefresh(onRefresh);
    });
    field('expenseClearButton')?.addEventListener('click', async () => {
      if (!(window.confirm && window.confirm(tr(currentLocale(), 'settings.expense.clearConfirm')))) return;
      const result = await window.tokenMonitor.expense?.clear?.();
      if (result?.ok && onRefresh) onRefresh();
    });
    const importFile = field('expenseImportFileInput');
    importFile?.addEventListener('change', () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const preview = window.tokenMonitor.expense?.importCsvPreview(String(reader.result || ''));
          Promise.resolve(preview).then((result) => {
            renderImportPreview(result);
          });
        } catch (_) {}
      };
      reader.readAsText(file);
    });
    const confirm = field('expenseImportConfirmButton');
    confirm?.addEventListener('click', async () => {
      const drafts = confirm.dataset.drafts ? JSON.parse(confirm.dataset.drafts) : [];
      confirm.dataset.drafts = '';
      confirm.classList.add('hidden');
      const result = await window.tokenMonitor.expense?.importCsvConfirm(drafts);
      const previewBox = field('expenseImportPreview');
      if (previewBox) previewBox.classList.add('hidden');
      if (previewBox) previewBox.innerHTML = '';
      if (onRefresh) onRefresh();
      if (result?.ok && result.added > 0) {
        const status = field('expenseImportStatus');
        if (status) status.textContent = `${tr(currentLocale(), 'settings.expense.importConfirm', { count: result.added })} ✓`;
      }
    });
  }

  let currentLocale = () => 'en';

  function setLocale(getter) {
    if (typeof getter === 'function') currentLocale = getter;
  }

  function renderImportPreview(result) {
    const previewBox = field('expenseImportPreview');
    const status = field('expenseImportStatus');
    if (!previewBox) return;
    previewBox.classList.remove('hidden');
    previewBox.innerHTML = '';
    if (!result?.ok) {
      const msg = el('div', 'expense-import-error', tr(currentLocale(), 'expense.importError'));
      previewBox.append(msg);
      if (status) status.textContent = tr(currentLocale(), 'settings.common.error');
      return;
    }
    const head = el('div', 'expense-import-head', `${tr(currentLocale(), 'settings.expense.importPreview')} — ${result.platform || 'unknown'} · ${result.total ?? 0} ${tr(currentLocale(), 'settings.expense.rows')}`);
    previewBox.append(head);
    const list = el('div', 'expense-import-list');
    for (const draft of (result.drafts || []).slice(0, 100)) {
      const row = el('div', 'expense-import-row');
      const meta = el('div', 'expense-import-row-meta', [draft.occurredAt, draft.merchant, categoryLabel(draft.category)].filter(Boolean).join(' · '));
      const amount = el('div', `expense-import-row-amount ${draft.direction === 'income' ? 'is-income' : 'is-expense'}`, formatCents(signedCents(draft), draft.currency));
      row.append(meta, amount);
      list.append(row);
    }
    if ((result.drafts || []).length > 100) list.append(el('div', 'expense-import-more', '+ ...'));
    previewBox.append(list);
    const confirmBtn = field('expenseImportConfirmButton');
    if (confirmBtn) {
      confirmBtn.dataset.drafts = JSON.stringify(result.drafts || []);
      confirmBtn.textContent = tr(currentLocale(), 'settings.expense.importConfirm', { count: result.drafts?.length || 0 });
      confirmBtn.classList.remove('hidden');
      confirmBtn.disabled = !(result.drafts && result.drafts.length > 0);
    }
  }

  return {
    renderPanel,
    syncSettings,
    bindSettings,
    runManualRefresh,
    setLocale
  };
});
