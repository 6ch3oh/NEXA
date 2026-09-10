'use strict';

(function exposeNexaConsumptionRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaConsumptionRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaConsumptionRendererApi() {
  const CATEGORY_LABELS = Object.freeze({
    food: '餐饮', transport: '交通', shopping: '购物', housing: '居住', entertainment: '娱乐',
    healthcare: '医疗', education: '教育', utilities: '生活缴费', travel: '旅行', other: '其他'
  });
  const DIRECTION_LABELS = Object.freeze({ expense: '支出', income: '收入' });
  const PLATFORM_LABELS = Object.freeze({
    wechat: '微信通知', alipay: '支付宝通知', bank: '银行通知', android_notification: '安卓支付通知'
  });

  function projectMobileAwareness(awareness) {
    const attention = awareness?.attention || {};
    const overview = awareness?.overview || {};
    const attentionState = String(attention.state || '').toUpperCase();
    const connectionState = String(overview.connection_state || '').toUpperCase();
    const reason = String(attention.reason || '').trim();
    const capture = String(overview.capture || '').trim();
    const permissionRequired = /通知使用权|通知权限|permission/iu.test(`${reason} ${capture}`);
    if (!awareness || typeof awareness !== 'object') {
      return Object.freeze({
        code: 'STATUS_UNAVAILABLE', tone: 'unknown', badge: '状态未知',
        title: '手机状态暂不可用', copy: '无法确认手机是否已配对、在线或允许通知采集；当前不会把空列表解释为正常。'
      });
    }
    if (attentionState === 'UNAVAILABLE' || connectionState === 'NEEDS_PAIRING') {
      return Object.freeze({
        code: 'NO_DEVICE', tone: 'unavailable', badge: '需要配对',
        title: '尚未配对安卓设备', copy: reason || '先在设备与网络中完成可信配对，随后才能接收支付通知。'
      });
    }
    if (attentionState === 'OFFLINE' || connectionState === 'OFFLINE') {
      return Object.freeze({
        code: 'OFFLINE', tone: 'offline', badge: '手机离线',
        title: '已配对手机当前离线', copy: reason || '手机重新在线并完成安全连接后，待同步通知才会送达桌面端。'
      });
    }
    if (permissionRequired) {
      return Object.freeze({
        code: 'PERMISSION_REQUIRED', tone: 'attention', badge: '需要通知权限',
        title: '手机尚未允许通知使用权', copy: reason || '请在手机系统设置中允许 NEXA 读取通知；桌面端不会代替你授予权限。'
      });
    }
    if (attentionState === 'NEEDS_ATTENTION') {
      return Object.freeze({
        code: 'NEEDS_ATTENTION', tone: 'attention', badge: '需要处理',
        title: '手机通知采集需要处理', copy: reason || '请检查手机采集服务与待同步队列。'
      });
    }
    if (attentionState === 'POSSIBLY_STALE') {
      return Object.freeze({
        code: 'POSSIBLY_STALE', tone: 'stale', badge: '可能已过期',
        title: '手机状态可能已过期', copy: reason || '最近状态超过正常更新窗口，请刷新设备状态后再判断。'
      });
    }
    return Object.freeze({
      code: 'READY', tone: 'ready', badge: '采集可用',
      title: '手机通知链路已就绪', copy: reason || '当前没有待处理或写入失败的支付通知。'
    });
  }
  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function unwrap(envelope) {
    if (envelope?.ok === true) return envelope.value;
    const error = new Error(envelope?.error?.message || 'Consumption request failed');
    error.code = envelope?.error?.code || 'CONSUMPTION_REQUEST_FAILED';
    throw error;
  }

  function formatCents(value) {
    if (!Number.isSafeInteger(value)) return '—';
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency', currency: 'CNY', currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(value / 100);
  }

  function formatDate(value) {
    if (typeof value !== 'string' || !value.trim()) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric'
    }).format(date);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
      : '时间未知';
  }

  function isoLocal(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addLocalDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function dateRange(kind, anchorValue, todayValue, custom = {}) {
    const today = parseLocalDate(todayValue) || new Date();
    const anchor = parseLocalDate(anchorValue) || today;
    let start = anchor;
    let end = anchor;
    if (kind === 'week') {
      const mondayOffset = (anchor.getDay() + 6) % 7;
      start = addLocalDays(anchor, -mondayOffset);
      end = addLocalDays(start, 6);
      if (end > today) end = today;
    } else if (kind === 'month') {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      if (end > today) end = today;
    } else if (kind === 'year') {
      start = new Date(anchor.getFullYear(), 0, 1);
      end = new Date(anchor.getFullYear(), 11, 31);
      if (end > today) end = today;
    } else if (kind === 'custom') {
      start = parseLocalDate(custom.startDate) || anchor;
      end = parseLocalDate(custom.endDate) || start;
      if (end < start) [start, end] = [end, start];
    }
    return Object.freeze({ startDate: isoLocal(start), endDate: isoLocal(end) });
  }

  function previousRange(range) {
    const start = parseLocalDate(range?.startDate);
    const end = parseLocalDate(range?.endDate);
    if (!start || !end) return range;
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const previousEnd = addLocalDays(start, -1);
    return Object.freeze({ startDate: isoLocal(addLocalDays(previousEnd, -(days - 1))), endDate: isoLocal(previousEnd) });
  }

  function rangeLabel(range) {
    return `${range.startDate} 至 ${range.endDate}`;
  }

  function metric(label, value) {
    const card = createElement('div', 'nexa-consumption-metric');
    card.append(createElement('span', '', label), createElement('strong', '', value));
    return card;
  }

  function renderRangeToolbar(rangeState, reload) {
    const wrapper = createElement('section', 'nexa-consumption-range-toolbar');
    wrapper.setAttribute('aria-label', '消费统计区间');
    const presets = createElement('div', 'nexa-consumption-range-presets');
    for (const [value, label] of [['today', '今日'], ['week', '本周'], ['month', '本月'], ['year', '本年'], ['custom', '自定义']]) {
      const button = createElement('button', 'nexa-consumption-action', label);
      button.type = 'button';
      button.dataset.range = value;
      button.setAttribute('aria-pressed', String(rangeState.kind === value));
      button.addEventListener('click', () => { rangeState.kind = value; void reload(); });
      presets.append(button);
    }
    const dates = createElement('div', 'nexa-consumption-range-dates');
    const previous = createElement('button', 'nexa-consumption-action', '‹');
    previous.type = 'button';
    previous.setAttribute('aria-label', '上一个月');
    previous.addEventListener('click', () => {
      const anchor = parseLocalDate(rangeState.anchorDate);
      const next = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
      rangeState.kind = 'month';
      rangeState.anchorDate = isoLocal(next);
      void reload();
    });
    const next = createElement('button', 'nexa-consumption-action', '›');
    next.type = 'button';
    next.setAttribute('aria-label', '下一个月');
    const anchor = parseLocalDate(rangeState.anchorDate);
    const today = parseLocalDate(rangeState.todayDate);
    next.disabled = anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
    next.addEventListener('click', () => {
      const value = parseLocalDate(rangeState.anchorDate);
      const shifted = new Date(value.getFullYear(), value.getMonth() + 1, 1);
      rangeState.kind = 'month';
      rangeState.anchorDate = isoLocal(shifted > today ? today : shifted);
      void reload();
    });
    dates.append(previous, createElement('strong', '', rangeLabel(rangeState.range)), next);
    if (rangeState.kind === 'custom') {
      const start = input('date', rangeState.custom.startDate || rangeState.range.startDate);
      const end = input('date', rangeState.custom.endDate || rangeState.range.endDate);
      const apply = createElement('button', 'nexa-consumption-action nexa-consumption-action-primary', '应用区间');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        rangeState.custom = { startDate: start.value, endDate: end.value };
        void reload();
      });
      dates.append(field('开始', start), field('结束', end), apply);
    }
    wrapper.append(presets, dates);
    return wrapper;
  }

  function renderTrend(statistics) {
    const card = createElement('section', 'nexa-consumption-visual nexa-consumption-trend-card');
    card.append(createElement('h2', '', '支出趋势'));
    const rows = Array.isArray(statistics?.dailySeries) ? statistics.dailySeries.slice(-14) : [];
    if (!rows.length) {
      card.append(createElement('p', 'nexa-consumption-breakdown-empty', '当前区间没有真实趋势数据。'));
      return card;
    }
    const max = Math.max(1, ...rows.map((row) => Number.isSafeInteger(row.expenseCents) ? row.expenseCents : 0));
    const chart = createElement('div', 'nexa-consumption-trend');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `最近 ${rows.length} 个有数据日期的支出趋势`);
    for (const row of rows) {
      const value = Number.isSafeInteger(row.expenseCents) ? row.expenseCents : 0;
      const item = createElement('div', 'nexa-consumption-trend-item');
      const bar = createElement('span', 'nexa-consumption-trend-bar');
      bar.setAttribute('style', `--bar-height:${Math.max(4, Math.round(value / max * 100))}%`);
      bar.setAttribute('title', `${row.key || row.period || '日期'} · ${formatCents(value)}`);
      item.append(bar, createElement('small', '', String(row.key || row.period || '').slice(5)));
      chart.append(item);
    }
    card.append(chart);
    return card;
  }

  function renderCategoryVisual(statistics) {
    const card = createElement('section', 'nexa-consumption-visual nexa-consumption-category-card');
    card.append(createElement('h2', '', '分类分布'));
    const rows = Array.isArray(statistics?.categoryBreakdown)
      ? statistics.categoryBreakdown.filter((row) => Number.isSafeInteger(row.expenseCents) && row.expenseCents > 0).slice(0, 5)
      : [];
    const total = rows.reduce((sum, row) => sum + row.expenseCents, 0);
    if (!total) {
      card.append(createElement('p', 'nexa-consumption-breakdown-empty', '当前区间没有真实分类数据。'));
      return card;
    }
    const body = createElement('div', 'nexa-consumption-category-visual');
    const ring = createElement('div', 'nexa-consumption-range-ring');
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', '真实消费分类占比环图');
    const legend = createElement('div', 'nexa-consumption-range-legend');
    const palette = ['#2f66ff', '#6b4cff', '#13a66f', '#f59e0b', '#64748b'];
    let cursor = 0;
    const segments = [];
    rows.forEach((row, index) => {
      const percent = row.expenseCents / total * 100;
      segments.push(`${palette[index]} ${cursor.toFixed(2)}% ${(cursor + percent).toFixed(2)}%`);
      cursor += percent;
      const item = createElement('div');
      item.append(createElement('strong', '', CATEGORY_LABELS[row.key] || row.key || '其他'), createElement('span', '', `${percent.toFixed(1)}% · ${formatCents(row.expenseCents)}`));
      legend.append(item);
    });
    ring.setAttribute('style', `--category-ring:conic-gradient(${segments.join(',')})`);
    ring.append(createElement('strong', '', formatCents(total)), createElement('span', '', '区间支出'));
    body.append(ring, legend);
    card.append(body);
    return card;
  }

  function renderMobileDiagnostics(awareness, drafts) {
    const section = createElement('section', 'nexa-consumption-mobile-diagnostics');
    section.append(createElement('h2', '', '手机通知链路诊断'));
    const presentation = projectMobileAwareness(awareness);
    const details = awareness?.details || {};
    const overview = awareness?.overview || {};
    const newest = [...(Array.isArray(drafts) ? drafts : [])].sort((a, b) => String(b.receivedAt || b.occurredAt || '').localeCompare(String(a.receivedAt || a.occurredAt || '')))[0];
    const pending = (Array.isArray(drafts) ? drafts : []).filter((draft) => draft.status === 'PENDING').length;
    const capture = String(overview.capture || '未由状态合同提供');
    const permission = /通知使用权|通知权限|permission/iu.test(`${awareness?.attention?.reason || ''} ${capture}`) ? '未授权或待确认' : capture;
    const rows = [
      ['可信配对', details.paired === true ? '已配对' : '未配对'],
      ['当前在线', String(overview.connection_state || '').toUpperCase() === 'CONNECTED' ? '在线' : '未在线'],
      ['通知使用权', permission],
      ['监听服务', capture],
      ['最近通知', '当前手机状态合同未提供时间'],
      ['最近支付候选', newest?.receivedAt || newest?.occurredAt ? formatDateTime(newest.receivedAt || newest.occurredAt) : '暂无候选'],
      ['自动入账待处理', `${pending} 条`],
      ['失败原因', presentation.code === 'READY' ? '当前未报告失败' : presentation.copy]
    ];
    const grid = createElement('div', 'nexa-consumption-diagnostic-grid');
    for (const [label, value] of rows) grid.append(metric(label, value));
    section.append(grid);
    return section;
  }

  function contextRail() {
    const rail = createElement('nav', 'nexa-consumption-context-rail');
    rail.setAttribute('aria-label', '消费中心导航');
    const buttons = [];
    for (const [label, targetId] of [
      ['总览', 'nexa-consumption-overview'],
      ['手机自动记账', 'nexa-consumption-mobile-drafts'],
      ['分类与来源', 'nexa-consumption-breakdowns'],
      ['最近记录', 'nexa-consumption-recent']
    ]) {
      const button = createElement('button', '', label);
      button.type = 'button';
      button.setAttribute('aria-current', buttons.length === 0 ? 'page' : 'false');
      button.addEventListener('click', () => {
        for (const peer of buttons) peer.setAttribute('aria-current', peer === button ? 'page' : 'false');
        document.getElementById(targetId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
      buttons.push(button);
      rail.append(button);
    }
    return rail;
  }

  function breakdownList(title, rows, labelForKey) {
    const group = createElement('section', 'nexa-consumption-breakdown-group');
    group.append(createElement('h3', '', title));
    if (!Array.isArray(rows) || rows.length === 0) {
      group.append(createElement('p', 'nexa-consumption-breakdown-empty', '当前没有可统计的真实记录。'));
      return group;
    }
    const list = createElement('div', 'nexa-consumption-breakdown-list');
    for (const row of rows) {
      const item = createElement('div', 'nexa-consumption-breakdown-row');
      item.append(
        createElement('strong', '', labelForKey(row.key)),
        createElement('span', '', `${Number.isSafeInteger(row.count) ? row.count : 0} 条 · 支出 ${formatCents(row.expenseCents)}`)
      );
      list.append(item);
    }
    group.append(list);
    return group;
  }

  function renderBreakdowns(statistics, onOpenSettings) {
    const section = createElement('section', 'nexa-consumption-section nexa-consumption-breakdowns');
    section.id = 'nexa-consumption-breakdowns';
    const header = createElement('div', 'nexa-consumption-section-header');
    header.append(createElement('h2', '', '分类与来源'), createElement('span', '', '仅统计已入账记录'));
    const body = createElement('div', 'nexa-consumption-breakdown-grid');
    body.append(
      breakdownList('消费分类', statistics?.categoryBreakdown, (key) => CATEGORY_LABELS[key] || key || '未分类'),
      breakdownList('记录来源', statistics?.platformBreakdown, (key) => PLATFORM_LABELS[key] || key || '未知来源')
    );
    section.append(header, body);
    if (typeof onOpenSettings === 'function') {
      const path = createElement('div', 'nexa-consumption-import-path');
      path.append(
        createElement('p', '', '需要导入 CSV 或检查本地收件箱时，前往“设置 → 消费记录”。'),
        createElement('button', 'nexa-consumption-action', '打开消费设置')
      );
      const button = path.querySelector('button');
      button.type = 'button';
      button.addEventListener('click', onOpenSettings);
      section.append(path);
    }
    return section;
  }

  function drawerField(label, value) {
    const item = createElement('div', 'nexa-drawer-field');
    item.append(createElement('span', '', label), createElement('strong', '', value || '—'));
    return item;
  }

  function openRecordDrawer(record, drawer, trigger, api, reload) {
    if (!drawer) return;
    const body = createElement('div', 'nexa-task-drawer-body');
    body.append(
      drawerField('日期', formatDate(record?.occurredAt)),
      drawerField('商户', record?.merchant || '未提供'),
      drawerField('分类', CATEGORY_LABELS[record?.category] || record?.category || '未分类'),
      drawerField('方向', DIRECTION_LABELS[record?.direction] || record?.direction || '未知'),
      drawerField('金额', formatCents(record?.amountCents)),
      drawerField('来源', PLATFORM_LABELS[record?.platform] || record?.platform || '未提供')
    );
    const actions = [];
    if (typeof record?.id === 'string' && record.id && api?.execute) {
      const remove = createElement('button', 'nexa-consumption-action', '移除该笔记录');
      remove.type = 'button';
      let armed = false;
      remove.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          remove.textContent = '再次点击确认移除';
          remove.dataset.confirmRemove = 'true';
          body.append(createElement('p', 'nexa-mobile-draft-error', '移除后这笔记录将不再计入统计；手机自动记账不会重新加入同一条记录。'));
          return;
        }
        remove.disabled = true;
        try {
          unwrap(await api.execute({ type: 'remove-record', payload: { recordId: record.id } }));
          drawer.close(true);
          await reload();
        } catch (_error) {
          remove.disabled = false;
          remove.textContent = '重试移除该笔记录';
          body.append(createElement('p', 'nexa-mobile-draft-error', '记录未能移除，请重试。'));
        }
      });
      actions.push(remove);
    }
    drawer.open({
      title: record?.merchant || '消费记录',
      description: '消费明细',
      context: '消费中心',
      state: 'ready',
      body,
      actions,
      returnFocus: trigger
    });
  }

  function field(label, control) {
    const wrapper = createElement('label', 'nexa-mobile-draft-field');
    wrapper.append(createElement('span', '', label), control);
    return wrapper;
  }

  function input(type, value) {
    const control = createElement('input', 'nexa-mobile-draft-input');
    control.type = type;
    control.value = value ?? '';
    return control;
  }

  function select(options, value) {
    const control = createElement('select', 'nexa-mobile-draft-input');
    for (const [optionValue, label] of options) {
      const option = createElement('option', '', label);
      option.value = optionValue;
      option.selected = optionValue === value;
      control.append(option);
    }
    return control;
  }

  async function runDraftCommand(api, command, card, reload) {
    const buttons = card.querySelectorAll('button');
    for (const button of buttons) button.disabled = true;
    try {
      unwrap(await api.execute(command));
      await reload();
    } catch (_error) {
      let message = card.querySelector('.nexa-mobile-draft-error');
      if (!message) {
        message = createElement('p', 'nexa-mobile-draft-error');
        card.append(message);
      }
      message.textContent = '操作没有完成，请重试。';
      for (const button of buttons) button.disabled = false;
    }
  }

  function renderDraftCard(draft, drafts, api, reload) {
    const card = createElement('article', 'nexa-mobile-draft-card');
    card.dataset.status = draft.status || 'PENDING';
    const heading = createElement('div', 'nexa-mobile-draft-heading');
    const title = createElement('div');
    title.append(
      createElement('strong', '', draft.merchant || '移动端支付通知'),
      createElement('span', '', [
        PLATFORM_LABELS[draft.platform] || '安卓支付通知',
        draft.sourceApplication,
        formatDate(draft.occurredAt)
      ].filter(Boolean).join(' · '))
    );
    const statusLabels = {
      PENDING: '自动入账待重试',
      CONFIRMED: draft.importMode === 'automatic' ? '已自动计入' : '已计入',
      IGNORED: '已忽略',
      REMOVED: '已移除'
    };
    heading.append(title, createElement('span', `nexa-mobile-draft-status status-${String(draft.status || '').toLowerCase()}`, statusLabels[draft.status] || '待处理'));
    card.append(heading);

    const evidenceApplications = Array.isArray(draft.sourceApplications)
      ? draft.sourceApplications.filter(Boolean)
      : [draft.sourceApplication].filter(Boolean);
    card.append(createElement(
      'p',
      'nexa-mobile-draft-note',
      `证据 ${Number.isFinite(Number(draft.evidenceCount)) ? Number(draft.evidenceCount) : 1} 条${evidenceApplications.length ? ` · ${evidenceApplications.join(' + ')}` : ''} · ${draft.classificationSource || 'deterministic_parser'} · 置信度 ${Number.isFinite(Number(draft.confidence)) ? `${Math.round(Number(draft.confidence) * 100)}%` : '未知'}`
    ));

    if (draft.status === 'PENDING') {
      const form = createElement('div', 'nexa-mobile-draft-form');
      const occurredAt = input('date', draft.occurredAt);
      const amount = input('number', Number.isSafeInteger(draft.amountCents) ? (draft.amountCents / 100).toFixed(2) : '');
      amount.min = '0.01'; amount.step = '0.01';
      const merchant = input('text', draft.merchant);
      merchant.maxLength = 120;
      const direction = select([['expense', '支出'], ['income', '收入']], draft.direction);
      const category = select(Object.entries(CATEGORY_LABELS), draft.category || 'other');
      form.append(
        field('日期', occurredAt), field(`金额（${draft.currency || 'CNY'}）`, amount),
        field('商户摘要', merchant), field('方向', direction), field('分类', category)
      );
      card.append(form);
      const actions = createElement('div', 'nexa-mobile-draft-actions');
      const save = createElement('button', 'nexa-consumption-action', '保存修改');
      const retry = createElement('button', 'nexa-consumption-action nexa-consumption-action-primary', '重试自动入账');
      const ignore = createElement('button', 'nexa-consumption-action', '忽略');
      for (const button of [save, retry, ignore]) button.type = 'button';
      save.addEventListener('click', () => void runDraftCommand(api, {
        type: 'update-mobile-draft',
        payload: {
          draftId: draft.draftId,
          changes: {
            occurredAt: occurredAt.value,
            amountCents: Math.round(Number(amount.value) * 100),
            merchant: merchant.value,
            direction: direction.value,
            category: category.value
          }
        }
      }, card, reload));
      retry.addEventListener('click', () => void runDraftCommand(api, {
        type: 'auto-import-pending-mobile-drafts', payload: {}
      }, card, reload));
      ignore.addEventListener('click', () => void runDraftCommand(api, {
        type: 'ignore-mobile-draft', payload: { draftId: draft.draftId }
      }, card, reload));
      actions.append(save, retry, ignore);
      const mergeCandidates = drafts.filter((candidate) =>
        candidate.draftId !== draft.draftId &&
        candidate.status === 'PENDING' &&
        candidate.amountCents === draft.amountCents &&
        candidate.currency === draft.currency &&
        candidate.direction === draft.direction
      );
      if (mergeCandidates.length) {
        const mergeTarget = select(mergeCandidates.map((candidate) => [
          candidate.draftId,
          `${candidate.merchant || '另一条通知'} · ${formatCents(candidate.amountCents)} · ${formatDate(candidate.occurredAt)}`
        ]));
        const merge = createElement('button', 'nexa-consumption-action', '合并为同一笔');
        merge.type = 'button';
        merge.addEventListener('click', () => void runDraftCommand(api, {
          type: 'merge-mobile-drafts',
          payload: { canonicalDraftId: draft.draftId, evidenceDraftId: mergeTarget.value }
        }, card, reload));
        actions.append(field('合并重复证据', mergeTarget), merge);
      }
      card.append(actions);
    } else {
      const summary = createElement('p', 'nexa-mobile-draft-summary', `${DIRECTION_LABELS[draft.direction] || ''} ${formatCents(draft.amountCents)} · ${CATEGORY_LABELS[draft.category] || '其他'}`);
      card.append(summary);
      if (draft.status === 'CONFIRMED' && typeof draft.confirmedRecordId === 'string' && draft.confirmedRecordId) {
        const remove = createElement('button', 'nexa-consumption-action', '移除该笔记录');
        remove.type = 'button';
        let armed = false;
        remove.addEventListener('click', () => {
          if (!armed) {
            armed = true;
            remove.textContent = '再次点击确认移除';
            remove.dataset.confirmRemove = 'true';
            return;
          }
          void runDraftCommand(api, {
            type: 'remove-record', payload: { recordId: draft.confirmedRecordId }
          }, card, reload);
        });
        card.append(remove);
      } else if (draft.status === 'REMOVED') {
        card.append(createElement('p', 'nexa-mobile-draft-note', '已按你的操作从消费统计中移除，后续重放不会自动恢复。'));
      }

      if (draft.canUndo === true) {
        const undo = createElement('button', 'nexa-consumption-action', '撤销上次处理');
        undo.type = 'button';
        undo.addEventListener('click', () => void runDraftCommand(api, {
          type: 'undo-mobile-draft', payload: { draftId: draft.draftId }
        }, card, reload));
        card.append(undo);
      }
    }


    const history = Array.isArray(draft.changeHistory) ? draft.changeHistory : [];
    if (history.length) {
      const audit = createElement('details', 'nexa-mobile-draft-audit');
      const auditSummary = createElement('summary', '', `变更历史 · ${history.length}`);
      const auditList = createElement('ol', 'nexa-mobile-draft-audit-list');
      const labels = {
        CREATED: '已创建',
        EVIDENCE_MERGED: '已合并跨应用证据',
        MANUAL_EVIDENCE_MERGED: '已人工合并重复证据',
        MERGED_INTO: '已归并至另一笔交易',
        MANUAL_EDIT: '已人工修改',
        MANUAL_CONFIRMED: '已人工确认入账',
        AUTO_POSTED: '已自动入账',
        EXCLUDED: '已排除',
        UNDO: '已撤销',
        AUTO_POST_REMOVED: '自动入账记录已移除'
      };
      for (const item of history) {
        auditList.append(createElement('li', '', `${formatDate(item.at)} · ${labels[item.action] || item.action || '状态变更'}`));
      }
      audit.append(auditSummary, auditList);
      card.append(audit);
    }
    return card;
  }

  function renderMobileAwareness(awareness, onOpenDevices) {
    const presentation = projectMobileAwareness(awareness);
    const panel = createElement('div', `nexa-mobile-awareness-state state-${presentation.tone}`);
    panel.dataset.mobileAwarenessState = presentation.code;
    const copy = createElement('div');
    copy.append(createElement('strong', '', presentation.title), createElement('p', '', presentation.copy));
    const actions = createElement('div', 'nexa-mobile-awareness-actions');
    actions.append(createElement('span', 'nexa-mobile-awareness-badge', presentation.badge));
    if (presentation.code !== 'READY' && typeof onOpenDevices === 'function') {
      const button = createElement('button', 'nexa-consumption-action', '查看设备与网络');
      button.type = 'button';
      button.addEventListener('click', onOpenDevices);
      actions.append(button);
    }
    panel.append(copy, actions);
    return panel;
  }

  function renderMobileDrafts(drafts, api, reload, awareness, onOpenDevices) {
    const section = createElement('section', 'nexa-consumption-section nexa-mobile-draft-section');
    section.id = 'nexa-consumption-mobile-drafts';
    const header = createElement('div', 'nexa-consumption-section-header');
    const pendingCount = drafts.filter((draft) => draft.status === 'PENDING').length;
    const awarenessPresentation = projectMobileAwareness(awareness);
    header.append(
      createElement('h2', '', '手机支付自动记账'),
      createElement('span', '', pendingCount ? `${pendingCount} 条待重试` : awarenessPresentation.badge)
    );
    section.append(
      header,
      createElement('p', 'nexa-mobile-draft-note', '已配对安卓设备识别出的支付摘要会自动计入；可在消费明细中移除错误记录。'),
      renderMobileAwareness(awareness, onOpenDevices)
    );
    if (!drafts.length) {
      section.append(statePanel(
        'empty',
        awarenessPresentation.code === 'READY' ? '暂无手机自动记账记录' : '当前没有可处理的手机记录',
        awarenessPresentation.code === 'READY'
          ? '手机链路可用，当前没有识别到新的真实支付通知。'
          : '先处理上方手机状态；链路未就绪时不会把“0 条”显示成正常采集结果。'
      ));
    } else {
      const list = createElement('div', 'nexa-mobile-draft-list');
      for (const draft of drafts) list.append(renderDraftCard(draft, drafts, api, reload));
      section.append(list);
    }
    return section;
  }

  function statePanel(state, title, copy, retry) {
    const panel = createElement('section', `nexa-consumption-state nexa-consumption-state-${state}`);
    panel.dataset.state = state;
    panel.append(createElement('h2', '', title), createElement('p', '', copy));
    if (typeof retry === 'function') {
      const button = createElement('button', 'nexa-consumption-action', '重试');
      button.type = 'button';
      button.addEventListener('click', retry);
      panel.append(button);
    }
    return panel;
  }

  function renderReady(
    surface, statistics, previousStatistics, recent, homeSummary, drafts, awareness,
    rangeState, api, reload, drawer, onOpenSettings, onOpenDevices
  ) {
    const header = createElement('header', 'nexa-consumption-header');
    const copy = createElement('div', 'nexa-consumption-header-copy');
    copy.append(
      createElement('span', 'nexa-consumption-kicker', '消费中心 · 本地真实数据'),
      createElement('h1', '', '消费中心'),
      createElement('p', '', rangeLabel(rangeState.range))
    );
    const headerActions = createElement('div', 'nexa-consumption-header-actions');
    const freshness = homeSummary?.freshness?.updatedAt || homeSummary?.freshness?.updated_at || homeSummary?.generatedAt || homeSummary?.generated_at;
    headerActions.append(createElement('span', 'nexa-consumption-freshness', freshness ? `更新于 ${formatDate(freshness)}` : '本地数据 · 更新时间未提供'));
    const refresh = createElement('button', 'nexa-consumption-action', '刷新');
    refresh.type = 'button';
    refresh.addEventListener('click', reload);
    headerActions.append(refresh);
    header.append(copy, headerActions);

    const totals = statistics?.totals || {};
    const previousTotals = previousStatistics?.totals || {};
    const start = parseLocalDate(rangeState.range.startDate);
    const end = parseLocalDate(rangeState.range.endDate);
    const dayCount = start && end ? Math.max(1, Math.round((end - start) / 86400000) + 1) : 1;
    const average = Number.isSafeInteger(totals.totalExpenseCents) ? Math.round(totals.totalExpenseCents / dayCount) : undefined;
    const previousExpense = previousTotals.totalExpenseCents;
    const comparison = Number.isSafeInteger(totals.totalExpenseCents) && Number.isSafeInteger(previousExpense) && previousExpense > 0
      ? `${totals.totalExpenseCents >= previousExpense ? '↑' : '↓'} ${Math.abs((totals.totalExpenseCents - previousExpense) / previousExpense * 100).toFixed(1)}%`
      : '无可比基期';
    const metrics = createElement('section', 'nexa-consumption-metrics');
    metrics.id = 'nexa-consumption-overview';
    metrics.setAttribute('aria-label', '消费汇总');
    metrics.append(
      metric('支出', formatCents(totals.totalExpenseCents)),
      metric('收入', formatCents(totals.totalIncomeCents)),
      metric('结余', formatCents(totals.netCents)),
      metric('日均支出', formatCents(average)),
      metric('较上一等长区间', comparison),
      metric('记录数', Number.isSafeInteger(totals.count) ? totals.count : 0)
    );

    const visuals = createElement('section', 'nexa-consumption-visual-grid');
    visuals.append(renderTrend(statistics), renderCategoryVisual(statistics));

    const section = createElement('section', 'nexa-consumption-section');
    section.id = 'nexa-consumption-recent';
    const sectionHeader = createElement('div', 'nexa-consumption-section-header');
    sectionHeader.append(createElement('h2', '', '最近记录'));
    section.append(sectionHeader);
    if (!Array.isArray(recent) || recent.length === 0) {
      section.append(statePanel('empty', '暂无记录', '消费中心目前没有可显示的最近记录。'));
    } else {
      const region = createElement('div', 'nexa-consumption-table-region');
      const table = createElement('table', 'nexa-consumption-table');
      const head = createElement('thead');
      const headRow = createElement('tr');
      for (const label of ['日期', '商户', '分类', '方向', '金额']) {
        headRow.append(createElement('th', '', label));
      }
      head.append(headRow);
      const body = createElement('tbody');
      for (const record of recent) {
        const row = createElement('tr');
        const merchantButton = createElement('button', 'nexa-consumption-record-link', record?.merchant || '—');
        merchantButton.type = 'button';
        merchantButton.addEventListener('click', () => openRecordDrawer(record, drawer, merchantButton, api, reload));
        row.append(
          createElement('td', '', formatDate(record?.occurredAt)),
          (() => { const cell = createElement('td'); cell.append(merchantButton); return cell; })(),
          createElement('td', '', record?.category || '—'),
          createElement('td', '', DIRECTION_LABELS[record?.direction] || record?.direction || '—'),
          createElement('td', 'nexa-consumption-amount', formatCents(record?.amountCents))
        );
        body.append(row);
      }
      table.append(head, body);
      region.append(table);
      section.append(region);
    }
    surface.replaceChildren(
      header,
      renderRangeToolbar(rangeState, reload),
      metrics,
      visuals,
      renderMobileDiagnostics(awareness, drafts),
      renderMobileDrafts(drafts, api, reload, awareness, onOpenDevices),
      contextRail(),
      renderBreakdowns(statistics, onOpenSettings),
      section
    );
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const surface = options.surface;
    const drawer = options.drawer || null;
    const mobileApi = options.mobileApi || null;
    const onOpenSettings = typeof options.onOpenSettings === 'function' ? options.onOpenSettings : null;
    const onOpenDevices = typeof options.onOpenDevices === 'function' ? options.onOpenDevices : null;
    const onContextChange = typeof options.onContextChange === 'function' ? options.onContextChange : () => {};
    if (!api || typeof api.getSnapshot !== 'function' || typeof api.getHomeSummary !== 'function' ||
        typeof api.execute !== 'function') {
      throw new TypeError('api must expose the Consumption renderer facade');
    }
    if (!surface || typeof surface.replaceChildren !== 'function') {
      throw new TypeError('surface must be a DOM container');
    }
    if (mobileApi && typeof mobileApi.awareness !== 'function') {
      throw new TypeError('mobileApi must expose the Mobile awareness read projection');
    }
    let active = false;
    let requestId = 0;
    const now = options.now instanceof Date ? options.now : new Date();
    const todayDate = isoLocal(now);
    const rangeState = {
      kind: 'month',
      todayDate,
      anchorDate: todayDate,
      custom: { startDate: '', endDate: '' },
      range: null
    };

    async function load() {
      const current = ++requestId;
      rangeState.range = dateRange(rangeState.kind, rangeState.anchorDate, rangeState.todayDate, rangeState.custom);
      const filters = { ...rangeState.range };
      const previousFilters = previousRange(rangeState.range);
      onContextChange({ title: '消费中心', status: 'LIMITED' });
      surface.replaceChildren(statePanel('loading', '正在加载消费中心', '正在读取模块公开数据。'));
      try {
        await api.execute({ type: 'auto-import-pending-mobile-drafts', payload: {} })
          .then(unwrap)
          .catch(() => null);
        const [_snapshot, statistics, previousStatistics, recent, homeSummary, drafts, awareness] = await Promise.all([
          api.getSnapshot().then(unwrap),
          api.execute({ type: 'statistics', payload: { filters } }).then(unwrap),
          api.execute({ type: 'statistics', payload: { filters: previousFilters } }).then(unwrap),
          api.execute({ type: 'recent', payload: { options: { ...filters, limit: 20 } } }).then(unwrap),
          api.getHomeSummary().then(unwrap),
          api.execute({ type: 'list-mobile-drafts', payload: { options: {} } }).then(unwrap),
          mobileApi?.awareness
            ? Promise.resolve(mobileApi.awareness({ refresh: false })).catch(() => null)
            : Promise.resolve(null)
        ]);
        if (!active || current !== requestId) return;
        renderReady(
          surface, statistics, previousStatistics, recent, homeSummary, drafts, awareness,
          rangeState, api, load, drawer, onOpenSettings, onOpenDevices
        );
        onContextChange({ title: '消费中心', status: 'READY' });
      } catch (_error) {
        if (!active || current !== requestId) return;
        surface.replaceChildren(statePanel(
          'error', '消费中心不可用', '暂时无法读取消费数据。', () => void load()
        ));
        onContextChange({ title: '消费中心', status: 'ERROR' });
      }
    }

    function activate() {
      active = true;
      void load();
    }

    function deactivate() {
      active = false;
      requestId += 1;
    }

    function unmount() {
      deactivate();
      surface.replaceChildren();
      return true;
    }

    return Object.freeze({ activate, deactivate, load, unmount, getRange: () => ({ ...rangeState.range }) });
  }

  return Object.freeze({ createRenderer, dateRange, formatCents, formatDate, previousRange, projectMobileAwareness, unwrap });
});
