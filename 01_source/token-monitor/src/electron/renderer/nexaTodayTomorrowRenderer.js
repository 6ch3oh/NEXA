'use strict';

(function exposeNexaTodayTomorrowRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaTodayTomorrowRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createTodayTomorrowRendererApi() {
  const WEEKDAYS = Object.freeze(['日', '一', '二', '三', '四', '五', '六']);

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
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 ||
        date.getDate() !== Number(match[3])) return null;
    return date;
  }

  function addDays(value, count) {
    const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    date.setDate(date.getDate() + count);
    return date;
  }

  function monthRange(monthValue) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue || ''));
    if (!match) throw new TypeError('month must use YYYY-MM');
    const first = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    const start = addDays(first, -first.getDay());
    const end = addDays(start, 41);
    return Object.freeze({ start: localDate(start), end: localDate(end) });
  }

  function calendarDays(monthValue, summaries = new Map(), selectedDate = null, todayDate = localDate()) {
    const range = monthRange(monthValue);
    const start = parseIsoDate(range.start);
    const displayedMonth = String(monthValue);
    return Object.freeze(Array.from({ length: 42 }, (_, index) => {
      const date = addDays(start, index);
      const dateValue = localDate(date);
      const summary = summaries instanceof Map
        ? summaries.get(dateValue)
        : Array.isArray(summaries?.dates) ? summaries.dates.find((item) => item?.date === dateValue) : null;
      return Object.freeze({
        date: dateValue,
        day: date.getDate(),
        currentMonth: dateValue.startsWith(displayedMonth),
        selected: dateValue === selectedDate,
        today: dateValue === todayDate,
        sublabel: typeof summary?.sublabel === 'string' ? summary.sublabel : ''
      });
    }));
  }

  function unwrap(envelope) {
    if (envelope?.ok === true) return envelope.value;
    const error = new Error(envelope?.error?.message || 'Today/Tomorrow request failed');
    error.code = envelope?.error?.code || 'TODAY_TOMORROW_REQUEST_FAILED';
    throw error;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatRange(start, end) {
    if (!start) return '时间未设置';
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) return String(start);
    const startText = startDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    if (!end) return startText;
    const endDate = new Date(end);
    if (Number.isNaN(endDate.getTime())) return startText;
    const endText = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${startText} – ${endText}`;
  }

  function createRenderer(options) {
    const api = options?.api;
    const surface = options?.surface;
    const drawer = options?.drawer;
    if (!api || typeof api.getView !== 'function' || typeof api.execute !== 'function' ||
        typeof api.getMonthSummary !== 'function' || typeof api.getLocalAiState !== 'function' || !surface || !drawer) {
      throw new TypeError('Today/Tomorrow renderer requires its public bridge, surface, and shared drawer');
    }
    const todayDate = localDate(options?.now instanceof Date ? options.now : new Date());
    let activeView = 'today';
    let selectedDate = null;
    let displayedMonth = todayDate.slice(0, 7);
    let loadState = 'loading';
    let model = null;
    let monthState = 'loading';
    let monthSummaries = new Map();
    let aiState = null;
    let aiLoadState = 'loading';
    let requestId = 0;
    let monthRequestId = 0;
    let aiRequestId = 0;
    let active = false;
    const timeDrafts = new Map();
    const migrationDrafts = new Map();

    function viewDate() {
      return selectedDate || todayDate;
    }

    async function execute(command) {
      return unwrap(await api.execute(command));
    }

    function statePanel(title, copy, action) {
      const panel = createElement('section', 'nexa-planning-state');
      panel.append(createElement('span', 'nexa-eyebrow', ({ loading: '受限', ready: '可用', stale: '受限', error: '异常' })[loadState] || '不可用'));
      panel.append(createElement('h2', '', title));
      panel.append(createElement('p', '', copy));
      if (action) panel.append(action);
      return panel;
    }

    function rowButton(label, onClick, className = '') {
      const button = createElement('button', className, label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      return button;
    }

    async function openTask(taskId, plan, trigger) {
      let task = null;
      try { task = await execute({ type: 'get-task', taskId }); } catch (_) {}
      const body = createElement('div', 'nexa-task-drawer-body');
      const fields = [
        ['状态', task?.status || plan?.state || '待处理'],
        ['截止时间 · 只读', task?.due_at || task?.display_time || '无截止时间'],
        ['计划时间 · 可调整', plan?.planned_start_at
          ? formatRange(plan.planned_start_at, plan.planned_end_at) : '尚未安排'],
        ['优先级', task?.priority || plan?.priority || '普通'],
        ['来源', task?.source || plan?.source || '本地']
      ];
      for (const [label, value] of fields) {
        const field = createElement('div', 'nexa-drawer-field');
        field.append(createElement('span', '', label), createElement('strong', '', value));
        body.append(field);
      }
      const reminder = (model?.reminders || []).find((item) => item.source_id === taskId);
      if (reminder) {
        const reminderField = createElement('div', 'nexa-drawer-field nexa-reminder-field');
        reminderField.append(
          createElement('span', '', '提醒'),
          createElement('strong', '', `${reminder.state} · ${formatRange(reminder.display_time)}`)
        );
        body.append(reminderField);
      }
      const actions = [];
      const planId = plan?.plan_id || plan?.id;
      if (planId) actions.push(rowButton(plan?.planned_start_at ? '调整计划时间' : '安排时间', () => {
        drawer.close(true); openTimeDraft(taskId, plan, trigger);
      }));
      if (plan?.planned_start_at && planId) actions.push(rowButton('取消安排', async () => {
        await execute({ type: 'remove-time', planId }); drawer.close(true); await load();
      }));
      actions.push(rowButton('完成', async () => {
        await execute({ type: 'complete-task', taskId, commandId: `nexa-complete-${taskId}-${Date.now()}` });
        drawer.close(true); await load();
      }, 'nexa-secondary-action'));
      drawer.open({
        title: task?.title || plan?.title || '任务',
        description: '任务详情', context: `${activeView === 'today' ? '今日' : '明日'} · ${model?.date || viewDate()}`,
        state: 'ready', body, actions, returnFocus: trigger
      });
    }

    function openEvent(event, trigger) {
      const body = createElement('div', 'nexa-task-drawer-body');
      for (const [label, value] of [
        ['类型', '固定日历事件 · 只读'],
        ['时间', event.display_time || '全天'],
        ['地点', event.location || '无地点'],
        ['状态', event.status || '已确认'],
        ['来源', event.source || '本地']
      ]) {
        const field = createElement('div', 'nexa-drawer-field');
        field.append(createElement('span', '', label), createElement('strong', '', value));
        body.append(field);
      }
      drawer.open({
        title: event.title || '日历事件', description: '日历详情',
        context: `${activeView === 'today' ? '今日' : '明日'} · ${model?.date || viewDate()}`, state: 'ready', body,
        actions: [], returnFocus: trigger
      });
    }

    function openTimeDraft(taskId, plan, trigger) {
      const planId = plan?.plan_id || plan?.id;
      const body = createElement('form', 'nexa-planning-form');
      const start = createElement('input'); start.type = 'datetime-local'; start.required = true;
      const end = createElement('input'); end.type = 'datetime-local'; end.required = true;
      start.addEventListener('input', () => drawer.setDirty(true));
      end.addEventListener('input', () => drawer.setDirty(true));
      const note = createElement('p', 'nexa-contract-note', '截止时间保持只读，保存只会确认计划时间。');
      body.append(createElement('label', '', '计划开始'), start, createElement('label', '', '计划结束'), end, note);
      const save = rowButton('保存计划时间', async () => {
        if (!start.value || !end.value) return;
        const draft = {
          taskId, planId,
          plannedStartAt: new Date(start.value).toISOString(),
          plannedEndAt: new Date(end.value).toISOString(),
          status: 'unsaved'
        };
        timeDrafts.set(planId, draft);
        drawer.setDirty(true);
        const command = {
          type: plan?.planned_start_at ? 'change-time' : 'confirm-time', planId,
          plannedStartAt: draft.plannedStartAt, plannedEndAt: draft.plannedEndAt
        };
        const result = await execute(command);
        if (result.status === 'CONFLICT_WARNING') {
          renderConflict(result, command, trigger);
          return;
        }
        timeDrafts.delete(planId); drawer.close(true); await load();
      });
      drawer.open({
        title: '安排计划时间', description: '由用户确认的时间安排',
        context: `${activeView === 'today' ? '今日' : '明日'} · ${model?.date || viewDate()}`, state: 'ready', body,
        actions: [save], dirty: false,
        confirmClose: () => window.confirm('放弃尚未保存的计划时间草稿？'),
        returnFocus: trigger
      });
    }

    function renderConflict(result, command, trigger) {
      const body = createElement('div', 'nexa-conflict-review');
      body.append(createElement('p', '', '发现时间冲突，现有计划尚未改变。'));
      for (const conflict of result.conflicts || []) {
        body.append(createElement('div', 'nexa-conflict-item',
          `${conflict.type}: ${conflict.title || conflict.task_id || conflict.id} · ${formatRange(conflict.start_at, conflict.end_at)}`));
      }
      const keep = rowButton('确认并保留冲突', async () => {
        await execute({ ...command, acceptConflicts: true });
        timeDrafts.delete(command.planId); drawer.close(true); await load();
      });
      drawer.open({
        title: '日历冲突', description: '需要手动确认',
        context: `${activeView === 'today' ? '今日' : '明日'} · ${model?.date || viewDate()}`, state: 'error', body,
        actions: [keep], dirty: true,
        confirmClose: () => window.confirm('放弃这份冲突确认草稿？'),
        returnFocus: trigger
      });
    }

    function renderEvent(event, eyebrow = '日历') {
      const row = createElement('article', 'nexa-timeline-item nexa-calendar-item');
      row.append(createElement('span', 'nexa-eyebrow', eyebrow));
      row.append(createElement('h3', '', event.title || '日历事件'));
      row.append(createElement('p', '', event.display_time || '全天'));
      if (event.location) row.append(createElement('p', 'nexa-item-meta', event.location));
      row.append(rowButton('查看详情', (click) => openEvent(event, click.currentTarget), 'nexa-inline-action'));
      return row;
    }

    function renderPlan(plan) {
      const row = createElement('article', 'nexa-timeline-item nexa-task-plan-item');
      row.append(createElement('span', 'nexa-eyebrow', '任务 · 已安排'));
      row.append(createElement('h3', '', plan.title || '任务'));
      row.append(createElement('p', '', formatRange(plan.planned_start_at, plan.planned_end_at)));
      const open = rowButton('查看详情', (event) => void openTask(plan.task_id, plan, event.currentTarget), 'nexa-inline-action');
      row.append(open);
      return row;
    }

    function renderUnplaced(task) {
      const row = createElement('article', 'nexa-planning-row');
      const copy = createElement('div', '');
      copy.append(createElement('strong', '', task.title || task.id));
      copy.append(createElement('span', '', `截止时间 · 只读：${task.display_time || '无'}`));
      const action = rowButton('安排时间', (event) => openTimeDraft(task.id, task, event.currentTarget));
      row.append(copy, action);
      return row;
    }

    function section(title, items, emptyCopy) {
      const block = createElement('section', 'nexa-planning-section');
      block.append(createElement('h2', '', title));
      if (items.length === 0) block.append(createElement('p', 'nexa-empty-copy', emptyCopy));
      else items.forEach((item) => block.append(item));
      return block;
    }

    function renderToday() {
      const layout = createElement('div', 'nexa-today-layout');
      const timeline = section('今日时间线', [
        ...(model.fixed_calendar_events || []).map((event) => renderEvent(event)),
        ...(model.confirmed_task_plans || []).map(renderPlan)
      ], '今天没有固定事件或已确认的任务计划。');
      const rail = createElement('aside', 'nexa-planning-rail');
      rail.append(section('未安排任务', (model.unplaced_tasks || []).map(renderUnplaced), '没有等待安排计划时间的任务。'));
      const priority = (model.priority_suggestions || []).map((item) => {
        const row = createElement('div', 'nexa-suggestion-row');
        row.append(createElement('strong', '', `#${item.suggested_rank} · ${item.task_id}`));
        row.append(createElement('span', '', item.human_readable_reason || '优先级建议'));
        return row;
      });
      rail.append(section('优先级建议', priority, '暂无优先级建议。'));
      const reminders = (model.reminders || []).map((item) => {
        const row = createElement('div', 'nexa-reminder-row');
        row.append(createElement('strong', '', item.title), createElement('span', '', `${item.state} · ${formatRange(item.display_time)}`));
        if (item.source_type === 'task' && item.source_id) {
          row.append(rowButton('处理提醒', (click) => void openTask(
            item.source_id,
            (model.confirmed_task_plans || []).find((plan) => plan.task_id === item.source_id),
            click.currentTarget
          ), 'nexa-inline-action'));
        }
        return row;
      });
      rail.append(section('提醒', reminders, '没有需要处理的提醒。'));
      layout.append(timeline, rail);
      return layout;
    }

    function renderTomorrow() {
      const layout = createElement('div', 'nexa-tomorrow-layout');
      const canvas = createElement('div', 'nexa-planning-canvas');
      canvas.append(section('固定事件', (model.fixed_calendar_events || []).map((event) => renderEvent(event)), '明天没有固定事件。'));
      canvas.append(section('已保存的计划任务', (model.confirmed_task_plans || []).map(renderPlan), '明天没有已确认的任务时间。'));
      canvas.append(section('待安排任务', (model.unplaced_tasks || []).map(renderUnplaced), '没有待安排任务。'));
      const rail = createElement('aside', 'nexa-planning-rail');
      const migrations = (model.carryover_suggestions || []).map((item) => {
        const row = createElement('article', 'nexa-migration-row');
        row.append(createElement('strong', '', item.task_id));
        row.append(createElement('span', '', '来自今日的建议 · 需要确认'));
        const add = rowButton(migrationDrafts.has(item.plan_id) ? '已加入草稿' : '加入明日草稿', () => {
          migrationDrafts.set(item.plan_id, item); render();
        });
        const dismiss = rowButton('忽略', async () => {
          await execute({ type: 'reject-carryover', planId: item.plan_id }); await load();
        }, 'nexa-secondary-action');
        row.append(add, dismiss);
        return row;
      });
      rail.append(section('迁移建议', migrations, '没有建议迁移的今日未完成任务。'));
      if (migrationDrafts.size > 0) {
        const review = createElement('section', 'nexa-draft-review');
        review.append(createElement('strong', '', `${migrationDrafts.size} 项迁移草稿变更`));
        review.append(rowButton('保存计划', async () => {
          for (const item of migrationDrafts.values()) {
            await execute({ type: 'confirm-carryover', planId: item.plan_id, toDate: model.date });
          }
          migrationDrafts.clear(); await load();
        }));
        review.append(rowButton('放弃草稿', () => { migrationDrafts.clear(); render(); }, 'nexa-secondary-action'));
        rail.append(review);
      }
      layout.append(canvas, rail);
      return layout;
    }

    function compactSublabel(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text || text === '暂无安排') return '暂无安排';
      const todo = /^待办\s*(\d+)\s*项$/.exec(text);
      if (todo) return `${todo[1]} 待办`;
      const events = /^事件\s*(\d+)\s*项$/.exec(text);
      if (events) return `${events[1]} 事件`;
      return text.length > 8 ? `${text.slice(0, 8)}…` : text;
    }

    function dateLabel(value) {
      const date = parseIsoDate(value);
      return date ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
      }).format(date) : value;
    }

    function shiftMonth(offset) {
      const [year, month] = displayedMonth.split('-').map(Number);
      const next = new Date(year, month - 1 + offset, 1);
      displayedMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
      monthState = 'loading';
      render();
      void loadMonth(displayedMonth);
    }

    function renderContextRail() {
      const rail = createElement('nav', 'nexa-calendar-context-rail');
      rail.setAttribute('aria-label', '日历页面导航');
      const items = [
        ['today', '今天'], ['tomorrow', '明天'], ['month', '月历'], ['ai', '用星枢安排']
      ];
      for (const [id, label] of items) {
        const button = rowButton(label, () => {
          if (id === 'today' || id === 'tomorrow') void setView(id);
          const target = document.getElementById(id === 'month' ? 'nexaCalendarMonthContext' :
            id === 'ai' ? 'nexaCalendarAiContext' : 'nexaCalendarDayContext');
          target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        });
        button.dataset.calendarContext = id;
        if (id === activeView) button.setAttribute('aria-current', 'page');
        rail.append(button);
      }
      return rail;
    }

    function renderMonthContext() {
      const panel = createElement('section', 'nexa-calendar-month-context');
      panel.id = 'nexaCalendarMonthContext';
      panel.setAttribute('aria-labelledby', 'nexaCalendarMonthTitle');
      const header = createElement('header', 'nexa-calendar-section-header');
      const heading = createElement('div');
      heading.append(createElement('span', 'nexa-eyebrow', '月 / 日上下文'));
      const [year, month] = displayedMonth.split('-').map(Number);
      const title = createElement('h2', '', `${year} 年 ${month} 月`);
      title.id = 'nexaCalendarMonthTitle';
      heading.append(title, createElement('p', '', '完整 6 × 7 月历；选择日期后下方显示并编辑当天真实事项。'));
      const actions = createElement('div', 'nexa-calendar-month-actions');
      const previous = rowButton('‹', () => shiftMonth(-1));
      previous.setAttribute('aria-label', '上个月');
      const returnToday = rowButton('回到今天', () => {
        displayedMonth = todayDate.slice(0, 7);
        void openDate(todayDate);
        void loadMonth(displayedMonth);
      });
      const atToday = viewDate() === todayDate && displayedMonth === todayDate.slice(0, 7);
      returnToday.setAttribute('aria-pressed', String(atToday));
      returnToday.setAttribute('title', atToday ? '当前已是今天' : '返回今天');
      const next = rowButton('›', () => shiftMonth(1));
      next.setAttribute('aria-label', '下个月');
      actions.append(previous, returnToday, next);
      header.append(heading, actions);
      panel.append(header);

      const weekdays = createElement('div', 'nexa-calendar-page-weekdays');
      WEEKDAYS.forEach((label) => weekdays.append(createElement('span', '', label)));
      panel.append(weekdays);
      if (monthState === 'error') {
        panel.append(statePanel('月历摘要暂不可用', '当天计划仍可使用；可单独重试月历读取。', rowButton('重试月历', () => void loadMonth())));
        return panel;
      }
      const grid = createElement('div', 'nexa-calendar-page-grid');
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', `${year} 年 ${month} 月`);
      for (const day of calendarDays(displayedMonth, monthSummaries, viewDate(), todayDate)) {
        const button = rowButton('', () => void openDate(day.date), 'nexa-calendar-page-day');
        button.dataset.date = day.date;
        button.dataset.currentMonth = String(day.currentMonth);
        button.dataset.today = String(day.today);
        button.setAttribute('role', 'gridcell');
        button.setAttribute('aria-selected', String(day.selected));
        button.setAttribute('aria-label', `${dateLabel(day.date)}，${compactSublabel(day.sublabel)}`);
        if (day.today) button.setAttribute('aria-current', 'date');
        const number = createElement('strong', '', String(day.day));
        const sublabel = createElement('small', '', day.today ? '今天' : compactSublabel(day.sublabel));
        button.append(number, sublabel);
        button.addEventListener('keydown', (event) => {
          const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          let target = null;
          if (Object.hasOwn(offsets, event.key)) target = localDate(addDays(parseIsoDate(day.date), offsets[event.key]));
          else if (event.key === 'Home') target = localDate(addDays(parseIsoDate(day.date), -parseIsoDate(day.date).getDay()));
          else if (event.key === 'End') target = localDate(addDays(parseIsoDate(day.date), 6 - parseIsoDate(day.date).getDay()));
          if (!target) return;
          event.preventDefault();
          void openDate(target).then(() => surface.querySelector(`[data-date="${target}"]`)?.focus());
        });
        grid.append(button);
      }
      panel.append(grid);
      if (monthState === 'loading') panel.append(createElement('p', 'nexa-calendar-inline-state', '正在同步当月真实摘要…'));
      return panel;
    }

    function aiStatusCopy() {
      const states = {
        disabled: ['已停用', '本地日历 AI 已停用，不会调用任何模型。'],
        unconfigured: ['未配置', '等待你提供本地模型地址、模型名、协议与授权方式；当前模型调用为 0。'],
        ready: ['已就绪', '模型只能生成结构化草稿，未经确认不会修改日历。'],
        error: ['连接异常', '本地模型连接异常；当前没有发生日历写入。']
      };
      return states[aiState?.status] || ['状态未知', '无法确认本地模型状态；不会发起草稿请求。'];
    }

    function renderAiContext() {
      const panel = createElement('section', 'nexa-calendar-ai-context');
      panel.id = 'nexaCalendarAiContext';
      const header = createElement('header', 'nexa-calendar-section-header');
      const heading = createElement('div');
      heading.append(createElement('span', 'nexa-eyebrow', 'NEXA GLOBAL COMMAND'));
      const title = createElement('h2', '', '用星枢安排');
      heading.append(title);
      const [statusLabel, statusCopy] = aiStatusCopy();
      const status = createElement('span', 'nexa-calendar-ai-page-status', aiLoadState === 'loading' ? '检查配置…' : statusLabel);
      status.dataset.aiState = aiState?.status || aiLoadState;
      header.append(heading, status);
      panel.append(header, createElement('p', 'nexa-calendar-ai-page-copy', `${statusCopy} 日历页复用顶部全局命令栏，不再维护第二套自然语言输入。`));
      const actions = createElement('div', 'nexa-calendar-ai-page-actions');
      const openGlobal = rowButton('聚焦全局命令栏', () => options?.onOpenGlobalCommand?.({ selectedDate: viewDate() }));
      const configure = rowButton('配置本地模型', () => options?.onConfigureLocalAi?.());
      actions.append(openGlobal, configure);
      panel.append(actions);
      return panel;
    }

    function renderDateActions() {
      const form = createElement('form', 'nexa-calendar-date-actions');
      const label = createElement('label', '', `新增到 ${viewDate()}`);
      const input = createElement('input');
      input.type = 'text';
      input.maxLength = 160;
      input.placeholder = '输入事项名称';
      input.setAttribute('autocomplete', 'off');
      label.append(input);
      const submit = rowButton('新增事项', () => {});
      submit.type = 'submit';
      form.append(label, submit);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = input.value.replace(/\s+/gu, ' ').trim();
        if (!title) return;
        submit.disabled = true;
        try {
          await execute({ type: 'create-day-task', commandId: `nexa-calendar-create-${Date.now()}`, planDate: viewDate(), title });
          input.value = '';
          await load();
        } finally {
          submit.disabled = false;
        }
      });
      return form;
    }

    function render() {
      surface.replaceChildren();
      const header = createElement('header', 'nexa-planning-header');
      const selectedDay = activeView === 'today' && selectedDate && selectedDate !== todayDate;
      const headerCopy = createElement('div');
      headerCopy.append(createElement('span', 'nexa-eyebrow', selectedDay ? '所选日期' : activeView === 'today' ? '今日' : '明日'));
      headerCopy.append(createElement('h1', '', '日历管家'));
      headerCopy.append(createElement('p', '', `${model?.date || viewDate()} · 月历、日期事项与本地 AI 草稿`));
      const headerAction = rowButton('刷新日历', () => {
        void load();
        void loadMonth();
        void loadAiState();
      });
      header.append(headerCopy, headerAction);
      const dayContext = createElement('section', 'nexa-calendar-day-context');
      dayContext.id = 'nexaCalendarDayContext';
      if (loadState === 'loading') {
        dayContext.append(statePanel('正在加载日历管家', '正在读取所选日期的真实计划。'));
      } else if (loadState === 'error') {
        const retry = rowButton('重试', () => void load());
        dayContext.append(statePanel('日历管家不可用', '月历和本地 AI 状态相互隔离；重试不会丢失本地草稿。', retry));
      } else {
        dayContext.append(renderDateActions());
        if (loadState === 'stale') dayContext.append(statePanel('计划数据可能已过期', '当前显示上一次结果，操作前请确认数据时间。'));
        const isEmpty = (model.fixed_calendar_events?.length || 0) +
          (model.confirmed_task_plans?.length || 0) + (model.unplaced_tasks?.length || 0) === 0;
        if (isEmpty) dayContext.append(statePanel(
          activeView === 'today' ? '今天暂无重点事项' : '明天尚未安排计划',
          activeView === 'today' ? '没有固定事件或已安排任务，可以为今日安排一项任务。' : '可从待安排任务或迁移建议中规划明日。'
        ));
        dayContext.append(activeView === 'today' ? renderToday() : renderTomorrow());
      }
      const workspace = createElement('div', 'nexa-calendar-workspace-grid');
      workspace.append(renderMonthContext(), dayContext);
      surface.append(header, renderContextRail(), workspace, renderAiContext());
    }

    async function load() {
      const current = ++requestId;
      loadState = 'loading'; render();
      try {
        const next = unwrap(await api.getView(activeView, viewDate()));
        if (current !== requestId || !active) return;
        model = next; loadState = next?.stale === true ? 'stale' : 'ready';
      } catch (_error) {
        if (current !== requestId || !active) return;
        loadState = 'error';
      }
      render();
    }

    async function loadMonth(monthValue = displayedMonth) {
      const current = ++monthRequestId;
      monthState = 'loading';
      render();
      const range = monthRange(monthValue);
      try {
        const next = unwrap(await api.getMonthSummary(range.start, range.end));
        if (current !== monthRequestId || !active || displayedMonth !== monthValue) return null;
        if (!next || !Array.isArray(next.dates)) throw new TypeError('Calendar month summary is invalid');
        monthSummaries = new Map(next.dates.map((item) => [item.date, item]));
        monthState = 'ready';
        render();
        return next;
      } catch (_) {
        if (current !== monthRequestId || !active) return null;
        monthState = 'error';
        render();
        return null;
      }
    }

    async function loadAiState() {
      const current = ++aiRequestId;
      aiLoadState = 'loading';
      render();
      try {
        aiState = unwrap(await api.getLocalAiState());
        if (current !== aiRequestId || !active) return null;
        aiLoadState = 'ready';
      } catch (_) {
        if (current !== aiRequestId || !active) return null;
        aiState = { status: 'error', can_propose: false };
        aiLoadState = 'error';
      }
      render();
      return aiState;
    }

    function setView(view) {
      if (view !== 'today' && view !== 'tomorrow') throw new TypeError('view must be today or tomorrow');
      activeView = view;
      selectedDate = null;
      if (view === 'today') displayedMonth = todayDate.slice(0, 7);
      return load();
    }

    function openDate(date) {
      if (!parseIsoDate(date)) throw new TypeError('date must use YYYY-MM-DD');
      activeView = 'today';
      selectedDate = String(date);
      const nextMonth = selectedDate.slice(0, 7);
      if (nextMonth !== displayedMonth) {
        displayedMonth = nextMonth;
        if (active) void loadMonth(displayedMonth);
      }
      return active ? load() : Promise.resolve(null);
    }

    function activate() {
      active = true;
      return Promise.all([load(), loadMonth(), loadAiState()]);
    }

    function deactivate() {
      active = false;
      requestId += 1;
      monthRequestId += 1;
      aiRequestId += 1;
      drawer.close(true);
    }

    function unmount() {
      deactivate();
      surface.replaceChildren();
      return true;
    }

    return Object.freeze({
      activate, deactivate, getDate: () => viewDate(), getView: () => activeView,
      load, loadAiState, loadMonth, openDate, setView, unmount
    });
  }

  return Object.freeze({ calendarDays, createRenderer, formatRange, localDate, monthRange, unwrap });
});
