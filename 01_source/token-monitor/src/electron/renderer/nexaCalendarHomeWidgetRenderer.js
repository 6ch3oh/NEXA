'use strict';

(function exposeNexaCalendarHomeWidgetRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaCalendarHomeWidgetRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createCalendarHomeWidgetRendererApi() {
  const HOST_STATES = new Set(['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);
  const WEEKDAYS = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);

  function unwrap(envelope) {
    if (envelope?.ok === true) return envelope.value;
    const error = new Error('Calendar Home Widget request failed');
    error.code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'CALENDAR_HOME_REQUEST_FAILED';
    throw error;
  }

  function safeText(value, fallback) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
  }

  function localDate(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  function isoDate(date) { return localDate(date); }

  function addDays(date, count) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + count);
    return next;
  }

  function summaryForDate(source, date) {
    if (source instanceof Map) return source.get(date) || null;
    if (source?.date === date) return source;
    if (Array.isArray(source?.dates)) return source.dates.find((item) => item?.date === date) || null;
    return null;
  }

  function calendarDays(value, summary = null, todayValue = localDate()) {
    const selected = parseIsoDate(value) || new Date();
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return Object.freeze(Array.from({ length: 42 }, (_, index) => {
      const date = addDays(start, index);
      const dateValue = isoDate(date);
      const loaded = summaryForDate(summary, dateValue);
      const sublabel = loaded ? safeText(loaded.sublabel, '暂无安排') : '';
      return Object.freeze({
        date: dateValue,
        day: date.getDate(),
        currentMonth: date.getMonth() === selected.getMonth(),
        selected: dateValue === value,
        today: dateValue === todayValue,
        sublabel
      });
    }));
  }

  function weekDays(value, summary = null, todayValue = localDate()) {
    const selected = parseIsoDate(value) || new Date();
    const start = addDays(selected, -selected.getDay());
    return Object.freeze(Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      const dateValue = isoDate(date);
      const loaded = summaryForDate(summary, dateValue);
      return Object.freeze({
        date: dateValue,
        day: date.getDate(),
        weekday: WEEKDAYS[index],
        selected: dateValue === value,
        today: dateValue === todayValue,
        sublabel: loaded ? safeText(loaded.sublabel, '暂无安排') : ''
      });
    }));
  }

  function setHidden(element, hidden) {
    element.hidden = hidden;
    element.classList?.toggle('hidden', hidden);
    element.setAttribute?.('aria-hidden', String(hidden));
  }

  function validateSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.contract_version !== '0.2.0' || typeof value.date !== 'string' || !Array.isArray(value.events) ||
        !Array.isArray(value.timeline) || (value.tasks !== undefined && !Array.isArray(value.tasks)) ||
        !Number.isInteger(value.todo_count) ||
        value.todo_count < 0 || typeof value.sublabel !== 'string' || value.availability !== 'available' ||
        value.detail_handoff?.action !== 'view-date' || value.edit_handoff?.action !== 'edit-date' ||
        (value.next_event !== null && typeof value.next_event !== 'object')) {
      throw new TypeError('Calendar Home Widget summary is invalid');
    }
    return value;
  }

  function validateMonthSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.contract_version !== '0.2.0' || !value.range || !Array.isArray(value.dates) ||
        value.dates.length > 62 || value.availability !== 'available') {
      throw new TypeError('Calendar month summary is invalid');
    }
    for (const item of value.dates) {
      validateSummary({
        ...item,
        contract_version: '0.2.0',
        generated_at: value.generated_at,
        freshness: value.freshness
      });
    }
    return value;
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const ownerDocument = options.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!api || typeof api.getDateSummary !== 'function' || typeof api.getMonthSummary !== 'function' ||
        typeof api.getLocalAiState !== 'function' ||
        typeof api.execute !== 'function') {
      throw new TypeError('Calendar Home Widget renderer requires the public Calendar bridge');
    }
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
      throw new TypeError('Calendar Home Widget renderer requires a document');
    }

    const element = ownerDocument.createElement('article');
    element.className = 'nexa-home-module-card nexa-calendar-home-widget';
    element.dataset.moduleState = 'OFFLINE';

    const hero = ownerDocument.createElement('div');
    hero.className = 'nexa-calendar-home-hero';
    const header = ownerDocument.createElement('header');
    header.className = 'nexa-home-module-card-header';
    const headingCopy = ownerDocument.createElement('div');
    headingCopy.className = 'nexa-home-card-heading';
    const kicker = ownerDocument.createElement('span');
    kicker.className = 'nexa-home-card-eyebrow';
    kicker.textContent = '专注当下，连接未来';
    const heading = ownerDocument.createElement('h2');
    heading.textContent = '今日中枢';
    headingCopy.append(kicker, heading);
    const status = ownerDocument.createElement('span');
    status.className = 'nexa-home-module-state';
    status.setAttribute('data-nexa-widget-status', '');
    status.textContent = '尚未就绪';
    const dateTitle = ownerDocument.createElement('strong');
    dateTitle.className = 'nexa-calendar-home-selected-date';
    const expandButton = ownerDocument.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'nexa-calendar-expand-button';
    expandButton.textContent = '展开日期信息';
    expandButton.setAttribute('aria-expanded', 'false');
    const refreshCalendar = ownerDocument.createElement('button');
    refreshCalendar.type = 'button';
    refreshCalendar.className = 'nexa-calendar-refresh-button';
    refreshCalendar.textContent = '刷新摘要';
    refreshCalendar.setAttribute('aria-label', '只刷新日历摘要');
    const heroActions = ownerDocument.createElement('div');
    heroActions.className = 'nexa-calendar-home-hero-actions';
    heroActions.append(dateTitle, status, refreshCalendar, expandButton);
    header.append(headingCopy, heroActions);
    hero.append(header);

    const statePanel = ownerDocument.createElement('p');
    statePanel.className = 'nexa-calendar-home-state';
    statePanel.setAttribute('role', 'status');

    const calendarShell = ownerDocument.createElement('section');
    calendarShell.className = 'nexa-calendar-home-calendar';
    const weekStrip = ownerDocument.createElement('div');
    weekStrip.className = 'nexa-calendar-week-strip';
    const monthPanel = ownerDocument.createElement('div');
    monthPanel.className = 'nexa-calendar-month-panel';
    monthPanel.id = 'nexaCalendarHomeMonthPanel';
    monthPanel.setAttribute('role', 'region');
    monthPanel.setAttribute('aria-label', '月历');
    expandButton.setAttribute('aria-controls', monthPanel.id);
    const monthControls = ownerDocument.createElement('div');
    monthControls.className = 'nexa-calendar-month-controls';
    const previousMonth = ownerDocument.createElement('button');
    previousMonth.type = 'button';
    previousMonth.textContent = '‹';
    previousMonth.setAttribute('aria-label', '上个月');
    const monthTitle = ownerDocument.createElement('strong');
    const returnToday = ownerDocument.createElement('button');
    returnToday.type = 'button';
    returnToday.className = 'nexa-calendar-return-today';
    returnToday.textContent = '回到今天';
    returnToday.setAttribute('aria-label', '回到今天');
    const nextMonth = ownerDocument.createElement('button');
    nextMonth.type = 'button';
    nextMonth.textContent = '›';
    nextMonth.setAttribute('aria-label', '下个月');
    const monthNavigation = ownerDocument.createElement('div');
    monthNavigation.className = 'nexa-calendar-month-navigation';
    monthNavigation.append(previousMonth, monthTitle, nextMonth);
    monthControls.append(monthNavigation, returnToday);
    const weekdayHeader = ownerDocument.createElement('div');
    weekdayHeader.className = 'nexa-calendar-weekday-header';
    for (const label of WEEKDAYS) weekdayHeader.append(Object.assign(ownerDocument.createElement('span'), { textContent: label }));
    const monthGrid = ownerDocument.createElement('div');
    monthGrid.className = 'nexa-calendar-month-grid';
    monthPanel.append(monthControls, weekdayHeader, monthGrid);
    calendarShell.append(weekStrip, monthPanel);

    const lower = ownerDocument.createElement('div');
    lower.className = 'nexa-calendar-home-lower';
    const summaryPanel = ownerDocument.createElement('section');
    summaryPanel.className = 'nexa-calendar-home-summary';
    const nextTitle = ownerDocument.createElement('strong');
    nextTitle.className = 'nexa-calendar-home-next';
    const quickAddForm = ownerDocument.createElement('form');
    quickAddForm.className = 'nexa-calendar-quick-add';
    const quickAddLabel = ownerDocument.createElement('label');
    quickAddLabel.textContent = '新增选中日期事项';
    const quickAddInput = ownerDocument.createElement('input');
    quickAddInput.type = 'text';
    quickAddInput.maxLength = 160;
    quickAddInput.placeholder = '输入事项名称';
    quickAddInput.setAttribute('autocomplete', 'off');
    quickAddLabel.append(quickAddInput);
    const quickAddButton = ownerDocument.createElement('button');
    quickAddButton.type = 'submit';
    quickAddButton.textContent = '新增到选中日期';
    quickAddForm.append(quickAddLabel, quickAddButton);
    const timelineTitle = ownerDocument.createElement('h3');
    timelineTitle.textContent = '选中日期安排';
    const timelineList = ownerDocument.createElement('ol');
    timelineList.className = 'nexa-calendar-home-list';
    const eventsTitle = ownerDocument.createElement('h3');
    eventsTitle.textContent = '其他事件';
    const eventsList = ownerDocument.createElement('ul');
    eventsList.className = 'nexa-calendar-home-list';
    const summaryMeta = ownerDocument.createElement('p');
    summaryMeta.className = 'nexa-calendar-home-meta';
    const calendarActionStatus = ownerDocument.createElement('p');
    calendarActionStatus.className = 'nexa-calendar-action-status';
    calendarActionStatus.setAttribute('role', 'status');
    setHidden(calendarActionStatus, true);
    const emptyState = ownerDocument.createElement('p');
    emptyState.className = 'nexa-empty-copy';
    emptyState.textContent = '选中日期没有已确认的安排。';
    summaryPanel.append(
      nextTitle,
      quickAddForm,
      timelineTitle,
      timelineList,
      eventsTitle,
      eventsList,
      summaryMeta,
      calendarActionStatus,
      emptyState
    );

    const butlerForm = ownerDocument.createElement('section');
    butlerForm.className = 'nexa-calendar-home-butler';
    const aiHeader = ownerDocument.createElement('div');
    aiHeader.className = 'nexa-calendar-ai-header';
    const aiTitle = ownerDocument.createElement('strong');
    aiTitle.textContent = '用星枢安排';
    const aiStatus = ownerDocument.createElement('span');
    aiStatus.className = 'nexa-calendar-ai-status';
    aiStatus.textContent = '检查配置…';
    const configureAi = ownerDocument.createElement('button');
    configureAi.type = 'button';
    configureAi.className = 'nexa-calendar-ai-configure';
    configureAi.textContent = '配置';
    aiHeader.append(aiTitle, aiStatus, configureAi);
    const openGlobalCommand = ownerDocument.createElement('button');
    openGlobalCommand.type = 'button';
    openGlobalCommand.className = 'nexa-calendar-propose-button';
    openGlobalCommand.textContent = '在全局命令栏中安排';
    butlerForm.append(aiHeader, openGlobalCommand);
    lower.append(summaryPanel, butlerForm);

    const openCalendar = ownerDocument.createElement('button');
    openCalendar.type = 'button';
    openCalendar.className = 'nexa-home-link-button nexa-calendar-open-button';
    openCalendar.textContent = '查看完整日历';
    const editCalendar = ownerDocument.createElement('button');
    editCalendar.type = 'button';
    editCalendar.className = 'nexa-home-link-button nexa-calendar-edit-button';
    editCalendar.textContent = '编辑当日';
    element.append(hero, statePanel, calendarShell, lower, editCalendar, openCalendar);

    let disposed = false;
    let enabled = true;
    let hostStatus = 'OFFLINE';
    let loadState = 'idle';
    let summary = null;
    let monthSummary = null;
    let summariesByDate = new Map();
    const todayDate = localDate(options.now instanceof Date ? options.now : new Date());
    let selectedDate = todayDate;
    let displayedMonth = selectedDate.slice(0, 7);
    // The complete 6 × 7 month is always present. Expansion only changes the
    // information density inside this fixed card; it never replaces the agenda.
    let expanded = false;
    let loadPromise = null;
    let loadingDate = null;
    let loadGeneration = 0;
    let monthLoadPromise = null;
    let loadingMonthRange = null;
    let monthLoadGeneration = 0;
    let aiGeneration = 0;
    let aiState = null;
    let actionSequence = 0;

    function presentation() {
      if (!enabled) return Object.freeze({ status: 'OFFLINE', label: '已停用' });
      if (loadState === 'loading') return Object.freeze({ status: 'LIMITED', label: '加载中' });
      if (loadState === 'error') return Object.freeze({ status: 'ERROR', label: '暂不可用' });
      if (loadState === 'ready') return Object.freeze({ status: 'READY', label: '可用' });
      const normalized = HOST_STATES.has(hostStatus) ? hostStatus : 'UNAVAILABLE';
      const labels = { READY: '可用', LIMITED: '受限', OFFLINE: '尚未启动', UNAVAILABLE: '不可用', ERROR: '异常' };
      return Object.freeze({ status: normalized, label: labels[normalized] });
    }

    function notify() {
      const value = presentation();
      element.dataset.moduleState = value.status;
      status.textContent = value.label;
      options.onStateChange?.(value);
      return value;
    }

    function itemLabel(item, fallback) {
      return safeText(item?.title, safeText(item?.name, safeText(item?.id, fallback)));
    }

    function itemTime(item, fallback = '时间待确认') {
      return safeText(item?.display_time, safeText(item?.start_at, fallback));
    }

    function appendListItem(list, primary, secondary, action = null) {
      const item = ownerDocument.createElement('li');
      const title = ownerDocument.createElement('strong');
      title.textContent = primary;
      const detail = ownerDocument.createElement('span');
      detail.textContent = secondary;
      item.append(title, detail);
      if (action) item.append(action);
      list.append(item);
      return item;
    }

    function commandId(kind) {
      actionSequence += 1;
      return `nexa-home-${kind}-${Date.now()}-${actionSequence}`;
    }

    function updatedLabel(value) {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return '更新时间未知';
      return `更新 ${new Date(value).toLocaleString('zh-CN')}`;
    }

    function dateLabel(value) {
      const date = parseIsoDate(value);
      return date ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
      }).format(date) : value;
    }

    function compactSublabel(value) {
      const text = safeText(value, '');
      if (!text) return '';
      if (text === '暂无安排') return '空闲';
      const todo = /^待办\s*(\d+)\s*项$/.exec(text);
      if (todo) return `待办 ${todo[1]} 项`;
      const events = /^事件\s*(\d+)\s*项$/.exec(text);
      if (events) return `事件 ${events[1]} 项`;
      return text.length > 4 ? `${text.slice(0, 4)}…` : text;
    }

    function createDateButton(day, compact) {
      const button = ownerDocument.createElement('button');
      button.type = 'button';
      button.className = compact ? 'nexa-calendar-week-day' : 'nexa-calendar-month-day';
      button.dataset.date = day.date;
      button.dataset.currentMonth = String(day.currentMonth !== false);
      button.dataset.today = String(day.today === true);
      button.setAttribute('aria-pressed', String(day.selected));
      if (day.today) button.setAttribute('aria-current', 'date');
      button.setAttribute('aria-label', `${dateLabel(day.date)}${day.sublabel ? `，${day.sublabel}` : ''}`);
      if (compact) {
        const weekday = ownerDocument.createElement('span');
        weekday.textContent = day.weekday;
        const number = ownerDocument.createElement('strong');
        number.textContent = String(day.day);
        const sublabel = ownerDocument.createElement('small');
        const shortLabel = compactSublabel(day.sublabel);
        sublabel.textContent = day.today ? '今天' : shortLabel;
        button.append(weekday, number, sublabel);
      } else {
        const number = ownerDocument.createElement('strong');
        number.textContent = String(day.day);
        const sublabel = ownerDocument.createElement('small');
        const shortLabel = compactSublabel(day.sublabel);
        sublabel.textContent = day.today ? '今天' : shortLabel;
        button.append(number, sublabel);
      }
      button.addEventListener('click', () => {
        selectedDate = day.date;
        displayedMonth = day.date.slice(0, 7);
        renderCalendar();
        void load(day.date);
      });
      button.addEventListener('keydown', (event) => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        let targetDate = null;
        if (Object.hasOwn(offsets, event.key)) targetDate = isoDate(addDays(parseIsoDate(day.date), offsets[event.key]));
        else if (event.key === 'Home') targetDate = isoDate(addDays(parseIsoDate(day.date), -parseIsoDate(day.date).getDay()));
        else if (event.key === 'End') targetDate = isoDate(addDays(parseIsoDate(day.date), 6 - parseIsoDate(day.date).getDay()));
        if (!targetDate) return;
        event.preventDefault?.();
        selectedDate = targetDate;
        displayedMonth = targetDate.slice(0, 7);
        renderCalendar();
        void load(targetDate);
      });
      return button;
    }

    function renderCalendar() {
      dateTitle.textContent = dateLabel(selectedDate);
      weekStrip.replaceChildren(...weekDays(selectedDate, summariesByDate, todayDate).map((day) => createDateButton(day, true)));
      const [year, month] = displayedMonth.split('-').map(Number);
      const monthDate = `${year}-${String(month).padStart(2, '0')}-01`;
      monthTitle.textContent = `${year} 年 ${month} 月`;
      monthGrid.replaceChildren(...calendarDays(monthDate, summariesByDate, todayDate).map((day) => createDateButton({
        ...day,
        selected: day.date === selectedDate
      }, false)));
      expandButton.textContent = expanded ? '收起日期信息' : '展开日期信息';
      expandButton.setAttribute('aria-expanded', String(expanded));
      element.classList.toggle('is-calendar-expanded', expanded);
      setHidden(weekStrip, true);
      setHidden(monthPanel, false);
      const atToday = selectedDate === todayDate && displayedMonth === todayDate.slice(0, 7);
      returnToday.disabled = atToday;
      returnToday.setAttribute('aria-pressed', String(atToday));
      returnToday.setAttribute('title', atToday ? '当前已是今天' : '返回今天');
    }

    function renderSummary() {
      timelineList.replaceChildren();
      eventsList.replaceChildren();
      const next = summary.next_event;
      nextTitle.textContent = next
        ? `下一事件：${itemLabel(next, '未命名事件')} · ${itemTime(next)}`
        : '下一事件：暂无';
      const tasks = Array.isArray(summary.tasks) ? summary.tasks : [];
      const agenda = [
        ...summary.events.map((event) => ({ kind: 'event', item: event, time: itemTime(event) })),
        ...tasks.map((task) => ({ kind: 'task', item: task, time: itemTime(task) }))
      ].sort((left, right) => {
        const leftTimed = Boolean(left.time);
        const rightTimed = Boolean(right.time);
        if (leftTimed !== rightTimed) return leftTimed ? -1 : 1;
        return safeText(left.time).localeCompare(safeText(right.time), 'zh-CN');
      });
      for (const entry of agenda.slice(0, 3)) {
        const task = entry.kind === 'task' ? entry.item : null;
        const complete = ownerDocument.createElement('button');
        complete.type = 'button';
        complete.className = 'nexa-calendar-complete-task';
        complete.textContent = '完成';
        if (task) {
          complete.setAttribute('aria-label', `完成事项：${itemLabel(task, '未命名事项')}`);
          complete.addEventListener('click', () => { void completeTask(task.id, complete); });
        }
        appendListItem(
          timelineList,
          itemLabel(entry.item, entry.kind === 'task' ? '未命名事项' : '未命名事件'),
          entry.time || '未指定时间',
          task ? complete : null
        );
      }
      summaryMeta.textContent = `待办 ${summary.todo_count} 项 · 日期 ${summary.date} · 事件 ${summary.events.length} 项 · ${updatedLabel(summary.generated_at)} · 数据源时间戳未提供`;
      timelineTitle.textContent = `${summary.date} 安排`;
      const hasTimeline = agenda.length > 0;
      const empty = !hasTimeline && summary.todo_count === 0;
      setHidden(emptyState, !empty);
      setHidden(eventsTitle, true);
      setHidden(eventsList, true);
      setHidden(timelineTitle, !hasTimeline);
      setHidden(timelineList, !hasTimeline);
    }

    async function createDayTask(title = quickAddInput.value) {
      const value = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : '';
      if (!value) {
        calendarActionStatus.textContent = '请输入事项名称后再新增。';
        setHidden(calendarActionStatus, false);
        return null;
      }
      quickAddButton.disabled = true;
      quickAddInput.disabled = true;
      calendarActionStatus.textContent = `正在新增到 ${selectedDate}…`;
      setHidden(calendarActionStatus, false);
      try {
        const result = unwrap(await api.execute({
          type: 'create-day-task',
          commandId: commandId('create-task'),
          planDate: selectedDate,
          title: value
        }));
        quickAddInput.value = '';
        calendarActionStatus.textContent = `已新增“${value}”并排入 ${selectedDate}。`;
        await load(selectedDate);
        return result;
      } catch (_) {
        calendarActionStatus.textContent = '事项新增失败，日历原有内容未被改写。';
        return null;
      } finally {
        if (!disposed) {
          quickAddButton.disabled = false;
          quickAddInput.disabled = false;
        }
      }
    }

    async function completeTask(taskId, trigger = null) {
      if (typeof taskId !== 'string' || !taskId) return null;
      if (trigger) trigger.disabled = true;
      calendarActionStatus.textContent = '正在完成事项…';
      setHidden(calendarActionStatus, false);
      try {
        const result = unwrap(await api.execute({
          type: 'complete-task',
          taskId,
          commandId: commandId('complete-task')
        }));
        calendarActionStatus.textContent = '事项已完成，日历摘要已刷新。';
        await load(selectedDate);
        return result;
      } catch (_) {
        if (trigger) trigger.disabled = false;
        calendarActionStatus.textContent = '事项未能完成，原状态保持不变。';
        return null;
      }
    }

    function renderAiState() {
      const labels = {
        disabled: '已停用', unconfigured: '未配置', ready: '已就绪', error: '连接异常'
      };
      aiStatus.textContent = labels[aiState?.status] || '状态未知';
    }

    async function refreshAiState() {
      const generation = ++aiGeneration;
      try {
        const value = unwrap(await api.getLocalAiState());
        if (disposed || generation !== aiGeneration) return null;
        aiState = value;
      } catch (_) {
        if (!disposed && generation === aiGeneration) aiState = { status: 'error', can_propose: false };
      }
      renderAiState();
      return aiState;
    }

    function render() {
      const current = notify();
      const unavailable = !enabled || (loadState === 'idle' && ['OFFLINE', 'UNAVAILABLE', 'ERROR'].includes(current.status));
      setHidden(statePanel, loadState === 'ready');
      setHidden(calendarShell, loadState !== 'ready');
      setHidden(lower, loadState !== 'ready');
      setHidden(openCalendar, loadState !== 'ready');
      setHidden(editCalendar, loadState !== 'ready');
      if (!enabled) statePanel.textContent = '日历管家已停用，请在设置中启用后重试。';
      else if (loadState === 'loading') statePanel.textContent = '正在读取真实今日日历摘要…';
      else if (loadState === 'error') statePanel.textContent = '今日日历暂时无法读取，其他桌面功能仍可继续使用。';
      else if (unavailable) statePanel.textContent = '日历管家尚未就绪。';
      else if (loadState === 'idle') statePanel.textContent = '今日日历尚未加载。';
      if (loadState === 'ready') {
        renderSummary();
        renderCalendar();
      }
    }

    function setHostState(value = {}) {
      enabled = value.enabled !== false;
      hostStatus = HOST_STATES.has(value.status) ? value.status : 'UNAVAILABLE';
      render();
      return presentation();
    }

    function load(date = selectedDate) {
      if (disposed) return Promise.reject(new Error('Calendar Home Widget renderer is disposed'));
      if (!enabled) {
        render();
        return Promise.resolve(null);
      }
      const requestedDate = parseIsoDate(date) ? date : selectedDate;
      if (loadPromise && requestedDate === loadingDate) return loadPromise;
      const generation = ++loadGeneration;
      loadingDate = requestedDate;
      loadState = 'loading';
      render();
      let attempt;
      attempt = Promise.resolve()
        .then(() => api.getDateSummary(requestedDate))
        .then((envelope) => {
          if (disposed || generation !== loadGeneration) return null;
          summary = validateSummary(unwrap(envelope));
          selectedDate = summary.date;
          displayedMonth = summary.date.slice(0, 7);
          summariesByDate.set(summary.date, summary);
          loadState = 'ready';
          render();
          void loadMonth(displayedMonth);
          return summary;
        })
        .catch(() => {
          if (!disposed && generation === loadGeneration) {
            summary = null;
            loadState = 'error';
            render();
          }
          return null;
        })
        .finally(() => {
          if (loadPromise === attempt) {
            loadPromise = null;
            loadingDate = null;
          }
        });
      loadPromise = attempt;
      return attempt;
    }

    function monthRange(monthValue = displayedMonth) {
      const [year, month] = monthValue.split('-').map(Number);
      const first = new Date(year, month - 1, 1);
      const start = addDays(first, -first.getDay());
      const end = addDays(start, 41);
      return Object.freeze({ start: isoDate(start), end: isoDate(end), key: `${isoDate(start)}:${isoDate(end)}` });
    }

    function loadMonth(monthValue = displayedMonth) {
      if (disposed || !enabled) return Promise.resolve(null);
      const range = monthRange(monthValue);
      if (monthLoadPromise && loadingMonthRange === range.key) return monthLoadPromise;
      const generation = ++monthLoadGeneration;
      loadingMonthRange = range.key;
      let attempt;
      attempt = Promise.resolve()
        .then(() => api.getMonthSummary(range.start, range.end))
        .then((envelope) => {
          if (disposed || generation !== monthLoadGeneration || displayedMonth !== monthValue) return null;
          monthSummary = validateMonthSummary(unwrap(envelope));
          summariesByDate = new Map(monthSummary.dates.map((item) => [item.date, item]));
          if (summary) summariesByDate.set(summary.date, summary);
          renderCalendar();
          return monthSummary;
        })
        .catch(() => null)
        .finally(() => {
          if (monthLoadPromise === attempt) {
            monthLoadPromise = null;
            loadingMonthRange = null;
          }
        });
      monthLoadPromise = attempt;
      return attempt;
    }

    function handleQuickAdd(event) { event.preventDefault(); void createDayTask(); }
    function handleOpenCalendar() {
      options.onOpenCalendar?.(summary?.detail_handoff || {
        route_id: 'today-tomorrow', action: 'view-date', date: selectedDate
      });
    }
    function handleEditCalendar() {
      options.onOpenCalendar?.(summary?.edit_handoff || {
        route_id: 'today-tomorrow', action: 'edit-date', date: selectedDate
      });
    }
    function handleExpand() {
      expanded = !expanded;
      renderCalendar();
      if (expanded) void loadMonth(displayedMonth);
    }
    function handleReturnToday() {
      selectedDate = todayDate;
      displayedMonth = todayDate.slice(0, 7);
      renderCalendar();
      void load(todayDate);
    }
    function handleRefreshCalendar() {
      refreshCalendar.disabled = true;
      calendarActionStatus.textContent = '正在刷新当前日期与月份摘要…';
      setHidden(calendarActionStatus, false);
      Promise.all([load(selectedDate), loadMonth(displayedMonth)])
        .then(() => { calendarActionStatus.textContent = '日历摘要已刷新。'; })
        .catch(() => { calendarActionStatus.textContent = '日历摘要刷新失败，现有内容保持不变。'; })
        .finally(() => { if (!disposed) refreshCalendar.disabled = false; });
    }
    function handleConfigureAi() {
      options.onConfigureLocalAi?.({ route_id: 'today-tomorrow', action: 'configure-local-ai' });
    }
    function handleOpenGlobalCommand() {
      options.onOpenGlobalCommand?.({ selectedDate });
    }
    function shiftMonth(offset) {
      const [year, month] = displayedMonth.split('-').map(Number);
      const next = new Date(year, month - 1 + offset, 1);
      displayedMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
      renderCalendar();
      void loadMonth(displayedMonth);
    }

    function handlePreviousMonth() { shiftMonth(-1); }
    function handleNextMonth() { shiftMonth(1); }

    quickAddForm.addEventListener('submit', handleQuickAdd);
    configureAi.addEventListener('click', handleConfigureAi);
    openGlobalCommand.addEventListener('click', handleOpenGlobalCommand);
    openCalendar.addEventListener('click', handleOpenCalendar);
    editCalendar.addEventListener('click', handleEditCalendar);
    expandButton.addEventListener('click', handleExpand);
    previousMonth.addEventListener('click', handlePreviousMonth);
    nextMonth.addEventListener('click', handleNextMonth);
    returnToday.addEventListener('click', handleReturnToday);
    refreshCalendar.addEventListener('click', handleRefreshCalendar);
    render();
    void refreshAiState();

    return Object.freeze({
      dispose() {
        if (disposed) return false;
        disposed = true;
        loadGeneration += 1;
        monthLoadGeneration += 1;
        aiGeneration += 1;
        quickAddForm.removeEventListener('submit', handleQuickAdd);
        openCalendar.removeEventListener('click', handleOpenCalendar);
        editCalendar.removeEventListener('click', handleEditCalendar);
        expandButton.removeEventListener('click', handleExpand);
        previousMonth.removeEventListener('click', handlePreviousMonth);
        nextMonth.removeEventListener('click', handleNextMonth);
        returnToday.removeEventListener('click', handleReturnToday);
        refreshCalendar.removeEventListener('click', handleRefreshCalendar);
        configureAi.removeEventListener('click', handleConfigureAi);
        openGlobalCommand.removeEventListener('click', handleOpenGlobalCommand);
        return true;
      },
      getElement: () => element,
      getState: () => Object.freeze({ ...presentation(), loadState, disposed, expanded, selectedDate, todayDate }),
      load,
      loadMonth,
      completeTask,
      createDayTask,
      refreshAiState,
      setHostState,
      toggleCalendar: handleExpand
    });
  }

  return Object.freeze({ calendarDays, createRenderer, localDate, unwrap, validateMonthSummary, validateSummary, weekDays });
});
