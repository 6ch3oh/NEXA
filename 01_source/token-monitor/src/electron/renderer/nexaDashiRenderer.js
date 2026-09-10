'use strict';

(function exposeNexaDashiRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaDashiRenderer = api;
})(typeof window !== 'undefined' ? window : null, function createNexaDashiRendererApi() {
  const VIEWS = Object.freeze(['overview', 'projects', 'tasks']);
  const TASK_FILTERS = Object.freeze([
    'all', 'active', 'running', 'blocked', 'failed', 'waiting_acceptance', 'stale'
  ]);
  const FILTER_LABELS = Object.freeze({
    all: '全部', active: '活跃', running: '运行中', blocked: '阻塞', failed: '失败',
    waiting_acceptance: '待验收', stale: '数据可能已过期'
  });
  const MISSING_REASON_COPY = Object.freeze({
    NO_RUN: '当前没有关联执行记录',
    NO_EXPLICIT_RUN_ASSOCIATION: '没有可靠的显式执行关联',
    NO_CODEX_THREAD: '当前没有可展示的关联任务会话',
    NO_ACCEPTANCE_RESULT: '尚无验收结果',
    NO_EVIDENCE: '没有证据记录',
    EVIDENCE_MISSING: '已记录证据，但对应文件当前缺失',
    SOURCE_STALE: '来源可读，但数据可能已过期',
    NOT_AVAILABLE: '不可用',
    PARTIAL: '部分数据可用'
  });
  const SOURCE_HEALTH_COPY = Object.freeze({
    CONNECTED_FRESH: '已连接 · 数据当前',
    CONNECTED_STALE: '已连接 · 数据可能已过期',
    CONNECTED_EMPTY: '已连接 · 暂无项目和任务',
    DISCONNECTED: 'Dashi 数据源未连接',
    SOURCE_ERROR: 'Dashi 数据读取失败'
  });
  const STATUS_LABELS = Object.freeze({
    ACTIVE: '活跃', RUNNING: '运行中', BLOCKED: '阻塞', FAILED: '失败', ERROR: '异常',
    WAITING_ACCEPTANCE: '待验收', STALE: '数据可能已过期', FRESH: '当前', CURRENT: '当前',
    SUCCESS: '成功', ACCEPTED: '已验收', PENDING: '待处理', COMPLETED: '已完成', READY: '可用',
    UNKNOWN: '未知', OPEN: '进行中', CLOSED: '已关闭', EXPLICIT: '明确关联', PARTIAL: '部分可用',
    NOT_AVAILABLE: '不可用', DISCONNECTED: '未连接', HIGH: '高', NORMAL: '普通', LOW: '低', NONE: '未设置'
  });
  const READINESS_LABELS = Object.freeze({
    waitingAcceptanceCount: '待验收数量', runAssociation: '执行关联', evidence: '依据', acceptance: '验收'
  });

  function requestFailure(code, status, hostFailure = false) {
    const error = new Error('Dashi read request failed');
    error.code = code || 'DASHI_READ_REQUEST_FAILED';
    error.status = status || 'SOURCE_ERROR';
    error.hostFailure = hostFailure;
    return error;
  }

  function unwrap(envelope) {
    if (envelope?.ok !== true) {
      throw requestFailure(envelope?.error?.code, envelope?.hostStatus, true);
    }
    const value = envelope.value;
    if (value?.ok !== true) throw requestFailure(value?.error?.code, value?.status, false);
    return Object.freeze({ data: value.data, meta: value.meta, status: value.status });
  }

  function missingReason(reason) {
    return MISSING_REASON_COPY[reason] || MISSING_REASON_COPY.NOT_AVAILABLE;
  }

  function sourceHealthLabel(status) {
    return SOURCE_HEALTH_COPY[status] || SOURCE_HEALTH_COPY.SOURCE_ERROR;
  }

  function errorPresentation(error) {
    if (error?.hostFailure) return Object.freeze({ title: 'Dashi 请求暂不可用', copy: '桌面服务未能完成本次只读请求。' });
    if (error?.code === 'DATA_SOURCE_NOT_CONNECTED' || error?.status === 'SOURCE_BINDING_NOT_AVAILABLE') {
      return Object.freeze({ title: 'Dashi 数据源未连接', copy: '当前没有可读取的 Dashi 数据源。' });
    }
    if (error?.code === 'PROJECT_NOT_FOUND' || error?.code === 'TASK_NOT_FOUND') {
      return Object.freeze({ title: '对象不存在', copy: '目标对象可能已被移除，返回所属视图后可继续浏览。' });
    }
    return Object.freeze({ title: 'Dashi 数据读取失败', copy: '当前视图暂不可用，其他 Dashi 视图不受影响。' });
  }

  function formatDateTime(value) {
    if (!value) return '不可用';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '不可用';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(label, onClick, className = '') {
    const element = createElement('button', className, label);
    element.type = 'button';
    element.addEventListener('click', onClick);
    return element;
  }

  function toneFor(value) {
    const text = String(value || '').toLowerCase();
    if (/fail|error|blocked|disconnected|失败|阻塞|未连接/.test(text)) return 'error';
    if (/stale|waiting|partial|unknown|较旧|待验收|陈旧|部分/.test(text)) return 'warning';
    if (/running|fresh|success|accepted|current|已连接|运行中|已验收/.test(text)) return 'positive';
    return 'neutral';
  }

  function badge(value, label = value) {
    const element = createElement('span', `nexa-dashi-badge nexa-dashi-tone-${toneFor(value)}`, displayLabel(label));
    return element;
  }

  function displayLabel(value) {
    if (value === undefined || value === null || value === '') return '不可用';
    const text = String(value);
    return STATUS_LABELS[text.toUpperCase()] || text;
  }

  function activitySummary(activity) {
    const summary = typeof activity?.summary === 'string' ? activity.summary.trim() : '';
    const known = {
      'task updated': '任务已更新', 'task created': '任务已创建', 'task completed': '任务已完成',
      'task closed': '任务已关闭', 'status changed': '状态已更新'
    };
    if (summary) return known[summary.toLowerCase()] || summary;
    return activity?.kind ? displayLabel(activity.kind) : '已记录任务活动';
  }

  function sourcePresentation(source) {
    if (!source?.sourceType && !source?.provenance) return '不可用';
    return '本地只读数据';
  }

  function safeCount(value) {
    return Number.isFinite(value) ? String(value) : '不可用';
  }

  function availabilityText(projection, getValue) {
    if (!projection?.available) return missingReason(projection?.reason);
    const value = typeof getValue === 'function' ? getValue(projection.value) : projection.value;
    return displayLabel(value);
  }

  function parseRoute(hash) {
    const value = String(hash || '');
    if (!value.startsWith('#/dashi')) return Object.freeze({ view: 'overview', projectId: null, filter: 'all' });
    const raw = value.slice(1);
    const [path, query = ''] = raw.split('?');
    const projectMatch = path.match(/^\/dashi\/projects\/([^/]+)$/);
    const parameters = new URLSearchParams(query);
    const requestedView = parameters.get('view');
    const requestedFilter = parameters.get('filter');
    return Object.freeze({
      view: projectMatch ? 'project' : VIEWS.includes(requestedView) ? requestedView : 'overview',
      projectId: projectMatch ? decodeURIComponent(projectMatch[1]) : null,
      filter: TASK_FILTERS.includes(requestedFilter) ? requestedFilter : 'all'
    });
  }

  function routeHash(state) {
    if (state.view === 'project' && state.projectId) {
      return `#/dashi/projects/${encodeURIComponent(state.projectId)}?from=projects`;
    }
    const parameters = new URLSearchParams({ view: state.view });
    if (state.view === 'tasks' && state.filter !== 'all') parameters.set('filter', state.filter);
    return `#/dashi?${parameters}`;
  }

  function createRenderer(options) {
    const readApi = options?.api;
    const surface = options?.surface;
    const subNavigation = options?.subNavigation;
    const drawer = options?.drawer;
    const onContextChange = typeof options?.onContextChange === 'function' ? options.onContextChange : () => {};
    const requiredMethods = [
      'getSourceHealth', 'getBoardOverview', 'listProjects', 'getProjectDetail', 'listTasks',
      'getTaskDetail', 'getTaskExecutionContext'
    ];
    if (!readApi || !requiredMethods.every((name) => typeof readApi[name] === 'function') ||
        !surface || !subNavigation || !drawer) {
      throw new TypeError('Dashi renderer requires its complete public facade, surface, L2 navigation, and shared drawer');
    }

    const browserWindow = typeof window !== 'undefined' ? window : null;
    let state = { ...parseRoute(browserWindow?.location?.hash || '') };
    let active = false;
    let requestId = 0;
    let lastHealth = null;
    let navigationListenersAttached = false;
    const navigationListeners = [...subNavigation.querySelectorAll('[data-nexa-dashi-view]')]
      .map((control) => Object.freeze({
        control,
        listener: () => setState({ view: control.dataset.nexaDashiView, projectId: null })
      }));

    function setHash() {
      if (!browserWindow?.history?.replaceState) return;
      browserWindow.history.replaceState(
        { ...(browserWindow.history.state || {}), nexaDashi: { ...state } }, '', routeHash(state)
      );
    }

    function setState(next) {
      state = { ...state, ...next };
      setHash();
      syncNavigation();
      if (active) void load();
    }

    function syncNavigation() {
      const parent = state.view === 'project' ? 'projects' : state.view;
      for (const candidate of subNavigation.querySelectorAll('[data-nexa-dashi-view]')) {
        candidate.setAttribute('aria-current', candidate.dataset.nexaDashiView === parent ? 'page' : 'false');
      }
    }

    function statePanel(kind, title, copy, retry) {
      const panel = createElement('section', `nexa-dashi-state nexa-dashi-state-${kind}`);
      panel.append(createElement('span', 'nexa-dashi-eyebrow', ({ loading: '受限', empty: '暂无数据', stale: '受限', partial: '受限', error: '异常' })[kind] || '不可用'));
      panel.append(createElement('h2', '', title), createElement('p', '', copy));
      if (retry) panel.append(button('重试读取', retry, 'nexa-dashi-inline-action'));
      return panel;
    }

    function healthBadge(health) {
      const status = health?.status || 'SOURCE_ERROR';
      const wrapper = createElement('div', 'nexa-dashi-health');
      wrapper.append(badge(status, sourceHealthLabel(status)));
      if (health?.freshness?.sourceUpdatedAt) {
        wrapper.append(createElement('span', '', `来源更新 ${formatDateTime(health.freshness.sourceUpdatedAt)}`));
      }
      return wrapper;
    }

    function renderHeader(title, description, health) {
      const header = createElement('header', 'nexa-dashi-header');
      const copy = createElement('div', 'nexa-dashi-header-copy');
      copy.append(createElement('span', 'nexa-dashi-eyebrow', 'DASHI · 只读'));
      copy.append(createElement('h1', '', title), createElement('p', '', description));
      header.append(copy, healthBadge(health));
      return header;
    }

    function metricBand(metrics) {
      const band = createElement('dl', 'nexa-dashi-metric-band');
      for (const [label, value] of metrics) {
        const item = createElement('div', 'nexa-dashi-metric');
        item.append(createElement('dt', '', label), createElement('dd', '', safeCount(value)));
        band.append(item);
      }
      return band;
    }

    function readinessNotice(readiness) {
      const partial = Object.entries(readiness || {})
        .filter(([, value]) => value === 'PARTIAL' || value === 'NOT_AVAILABLE')
        .map(([key]) => READINESS_LABELS[key] || '相关指标');
      if (partial.length === 0) return null;
      return statePanel('partial', '部分数据可用', `以下指标受当前只读来源能力限制：${partial.join('、')}`);
    }

    function table(headers, rows, label) {
      const region = createElement('div', 'nexa-dashi-table-region');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', label);
      region.tabIndex = 0;
      const element = createElement('table', 'nexa-dashi-table');
      const head = createElement('thead');
      const headRow = createElement('tr');
      headers.forEach((header) => headRow.append(createElement('th', '', header)));
      head.append(headRow);
      const body = createElement('tbody');
      rows.forEach((cells) => {
        const row = createElement('tr');
        cells.forEach((cell) => {
          const column = createElement('td');
          if (cell?.nodeType) column.append(cell);
          else column.textContent = cell === undefined || cell === null || cell === '' ? '不可用' : String(cell);
          row.append(column);
        });
        body.append(row);
      });
      element.append(head, body);
      region.append(element);
      return region;
    }

    function renderOverview(overview, health) {
      surface.replaceChildren(renderHeader(
        'Dashi任务板', '项目、任务与执行关联的本地只读视图。', health
      ));
      surface.append(metricBand([
        ['项目', overview.projectCount], ['任务', overview.taskCount], ['运行中', overview.runningCount],
        ['阻塞', overview.blockedCount], ['失败', overview.failedCount],
        ['待验收', overview.waitingAcceptanceCount], ['数据可能已过期', overview.staleTaskCount]
      ]));
      const activity = createElement('section', 'nexa-dashi-editorial-row');
      activity.append(createElement('h2', '', '最近活动'));
      activity.append(createElement('p', '', overview.lastActivity
        ? `${formatDateTime(overview.lastActivity.at)} · ${activitySummary(overview.lastActivity)}`
        : '暂无活动记录'));
      surface.append(activity);

      const attention = createElement('section', 'nexa-dashi-section');
      attention.append(createElement('h2', '', '需要关注'));
      const list = createElement('div', 'nexa-dashi-attention-list');
      for (const [filter, label, count] of [
        ['blocked', '阻塞', overview.blockedCount], ['failed', '失败', overview.failedCount],
        ['waiting_acceptance', '待验收', overview.waitingAcceptanceCount], ['stale', '数据可能已过期', overview.staleTaskCount]
      ]) {
        const row = button(`${label}  ${safeCount(count)}`, () => setState({ view: 'tasks', filter }), 'nexa-dashi-attention-row');
        row.append(createElement('span', '', '查看任务 →'));
        list.append(row);
      }
      attention.append(list);
      surface.append(attention);

      const projects = createElement('section', 'nexa-dashi-section');
      projects.append(createElement('h2', '', '活跃项目'));
      if ((overview.activeProjects || []).length === 0) {
        projects.append(createElement('p', 'nexa-dashi-empty-copy', '当前没有活跃项目。'));
      } else {
        const listElement = createElement('div', 'nexa-dashi-project-strip');
        for (const project of overview.activeProjects) {
          listElement.append(button(project.name, () => setState({ view: 'project', projectId: project.id }), 'nexa-dashi-project-link'));
        }
        projects.append(listElement);
      }
      surface.append(projects);
      const notice = readinessNotice(overview.readiness);
      if (notice) surface.append(notice);
      if (health?.status === 'CONNECTED_EMPTY') {
        surface.append(statePanel('empty', '暂无项目和任务', sourceHealthLabel('CONNECTED_EMPTY')));
      }
      if (health?.status === 'CONNECTED_STALE') {
        surface.append(statePanel('stale', '来源可读，但数据可能已过期', missingReason('SOURCE_STALE')));
      }
    }

    function projectRows(projects) {
      return projects.map((project) => [
        button(project.name, () => setState({ view: 'project', projectId: project.id }), 'nexa-dashi-table-link'),
        safeCount(project.counts?.tasks), safeCount(project.counts?.active), safeCount(project.counts?.blocked),
        safeCount(project.counts?.failed), safeCount(project.counts?.waitingAcceptance),
        formatDateTime(project.lastActivity?.at), badge(project.freshness?.state || 'UNKNOWN', project.freshness?.state || 'UNKNOWN')
      ]);
    }

    function renderProjects(projects, health) {
      surface.replaceChildren(renderHeader('项目', '项目级健康度与只读任务汇总。', health));
      if (projects.length === 0) {
        surface.append(statePanel('empty', '暂无项目', 'Dashi 数据源当前没有可展示的项目。'));
        return;
      }
      surface.append(table(
        ['项目', '任务', '活跃', '阻塞', '失败', '待验收', '最近活动', '数据状态'],
        projectRows(projects), 'Dashi 项目表'
      ));
    }

    function taskExecutionLabel(task) {
      return availabilityText(task.execution, (value) => value.normalizedStatus);
    }

  function taskRunLabel(task) {
      if (!task.run?.available) return missingReason(task.run?.reason);
      return task.run.value?.taskLink?.confidence === 'explicit'
        ? '显式关联' : missingReason('NO_EXPLICIT_RUN_ASSOCIATION');
    }

    function taskAcceptanceLabel(task) {
      return availabilityText(task.acceptance, (value) => value.status);
    }

    function taskEvidenceLabel(task) {
      if (!task.evidence?.available) return missingReason(task.evidence?.reason);
      const count = task.evidence.value?.count;
      return task.evidence.reason === 'EVIDENCE_MISSING'
        ? missingReason('EVIDENCE_MISSING') : `${safeCount(count)} 条`;
    }

    function taskRows(tasks) {
      return tasks.map((task) => {
        const identity = task.identity || {};
        const openTask = button(
          `${identity.task?.identifier || identity.task?.id || '任务'} · ${identity.task?.title || '未命名任务'}`,
          (event) => void openTaskDrawer(identity.task?.id, 'task', event.currentTarget),
          'nexa-dashi-table-link'
        );
        const execution = button(
          taskExecutionLabel(task),
          (event) => void openTaskDrawer(identity.task?.id, 'execution', event.currentTarget),
          'nexa-dashi-cell-link'
        );
        return [
          openTask, identity.project?.name, badge(task.taskStatus?.normalized, task.taskStatus?.label || task.taskStatus?.normalized),
          execution, taskRunLabel(task), taskAcceptanceLabel(task), taskEvidenceLabel(task),
          formatDateTime(task.lastActivity?.at)
        ];
      });
    }

    function renderTaskFilters() {
      const nav = createElement('nav', 'nexa-dashi-filters');
      nav.setAttribute('aria-label', 'Dashi 任务筛选');
      for (const filter of TASK_FILTERS) {
        const control = button(FILTER_LABELS[filter], () => setState({ view: 'tasks', filter }));
        control.dataset.dashiFilter = filter;
        control.setAttribute('aria-pressed', filter === state.filter ? 'true' : 'false');
        nav.append(control);
      }
      return nav;
    }

    function renderTasks(result, health) {
      surface.replaceChildren(renderHeader('任务', '任务状态与执行状态保持独立展示。', health), renderTaskFilters());
      if ((result.items || []).length === 0) {
        surface.append(statePanel('empty', '当前筛选没有任务', `筛选：${FILTER_LABELS[result.filter] || result.filter}`));
        return;
      }
      surface.append(table(
        ['任务', '项目', '任务状态', '执行状态', '执行关联', '验收', '依据', '最近活动'],
        taskRows(result.items), 'Dashi 任务表'
      ));
    }

    function renderProject(project, health) {
      surface.replaceChildren();
      const back = button('← 返回项目', () => setState({ view: 'projects', projectId: null }), 'nexa-dashi-back');
      surface.append(back, renderHeader(project.name, '项目详情与所属任务。', health));
      surface.append(metricBand([
        ['任务', project.counts?.tasks], ['活跃', project.counts?.active], ['阻塞', project.counts?.blocked],
        ['失败', project.counts?.failed], ['待验收', project.counts?.waitingAcceptance]
      ]));
      const facts = createElement('section', 'nexa-dashi-editorial-row');
      facts.append(createElement('h2', '', '项目状态'));
      facts.append(createElement('p', '', `最近活动 ${formatDateTime(project.lastActivity?.at)} · 数据状态 ${displayLabel(project.freshness?.state || 'UNKNOWN')}`));
      surface.append(facts);
      const tasks = project.tasks || [];
      if (tasks.length === 0) surface.append(statePanel('empty', '项目暂无任务', '零任务项目仍保留在项目列表中。'));
      else surface.append(table(
        ['任务', '项目', '任务状态', '执行状态', '执行关联', '验收', '依据', '最近活动'],
        taskRows(tasks), `${project.name} 任务表`
      ));
    }

    function drawerField(label, value, valueNode = null) {
      const field = createElement('div', 'nexa-drawer-field');
      field.append(createElement('span', '', label));
      if (valueNode) field.append(valueNode);
      else field.append(createElement('strong', '', value || '不可用'));
      return field;
    }

    function drawerTabs(taskId, activeView, task, trigger) {
      const tabs = createElement('div', 'nexa-dashi-drawer-tabs');
      for (const [view, label] of [['task', '任务详情'], ['execution', '执行上下文']]) {
        const control = button(label, () => void showDrawerView(taskId, view, task, trigger));
        control.setAttribute('aria-pressed', view === activeView ? 'true' : 'false');
        tabs.append(control);
      }
      return tabs;
    }

    function taskDrawerBody(task, activeView, trigger) {
      const body = createElement('div', 'nexa-task-drawer-body');
      const taskId = task.identity.task.id;
      body.append(drawerTabs(taskId, activeView, task, trigger));
      body.append(
        drawerField('任务状态', task.taskStatus?.label || task.taskStatus?.normalized),
        drawerField('项目', task.identity.project?.name),
        drawerField('说明', task.task?.description || '不可用'),
        drawerField('优先级', displayLabel(task.task?.priority)),
        drawerField('标签', (task.task?.labels || []).join(' · ') || '不可用'),
        drawerField('最近活动', formatDateTime(task.lastActivity?.at)),
        drawerField('执行记录', availabilityText(task.run, (value) => `${value.id} · ${displayLabel(value.status)}`)),
        drawerField('执行', taskExecutionLabel(task)),
        drawerField('验收', taskAcceptanceLabel(task)),
        drawerField('依据', taskEvidenceLabel(task)),
        drawerField('来源', sourcePresentation(task.source))
      );
      if (task.blocked?.value?.blocked) {
        body.append(drawerField('阻塞', displayLabel(task.blocked.value.normalized?.code || 'BLOCKED')));
      }
      if (task.failure?.available) body.append(drawerField('失败', displayLabel(task.failure.value?.normalized)));
      return body;
    }

    function executionDrawerBody(context, task, trigger) {
      const body = createElement('div', 'nexa-task-drawer-body');
      body.append(drawerTabs(task.identity.task.id, 'execution', task, trigger));
      body.append(
        drawerField('关联', context.association?.explicit
          ? `显式关联 · ${displayLabel(context.association.confidence || 'EXPLICIT')}`
          : missingReason(context.association?.reason)),
        drawerField('执行记录', availabilityText(context.run, (value) => `${value.id} · ${displayLabel(value.status)}`)),
        drawerField('执行', availabilityText(context.execution, (value) => value.normalizedStatus)),
        drawerField('关联任务会话', availabilityText(context.codexThread, (value) => value.id)),
        drawerField('失败', availabilityText(context.failure, (value) => value.normalized)),
        drawerField('验收', taskAcceptanceLabel(task)),
        drawerField('依据', taskEvidenceLabel(task))
      );
      return body;
    }

    function openDrawerShell(task, view, body, trigger, drawerState = 'ready') {
      drawer.open({
        title: task?.identity?.task?.title || 'Dashi任务',
        description: view === 'execution' ? '执行上下文 · 只读' : '任务详情 · 只读',
        context: `${task?.identity?.project?.name || 'Dashi'} · ${task?.identity?.task?.identifier || task?.identity?.task?.id || '任务'}`,
        state: drawerState, body, actions: [], returnFocus: trigger
      });
    }

    async function showDrawerView(taskId, view, task, trigger) {
      if (view === 'task') {
        openDrawerShell(task, view, taskDrawerBody(task, view, trigger), trigger);
        return;
      }
      openDrawerShell(task, view, statePanel('loading', '读取执行上下文', '正在读取明确的执行记录与关联任务会话。'), trigger, 'loading');
      try {
        const context = unwrap(await readApi.getTaskExecutionContext(taskId)).data;
        openDrawerShell(task, view, executionDrawerBody(context, task, trigger), trigger);
      } catch (error) {
        const copy = errorPresentation(error);
        openDrawerShell(task, view, statePanel(
          'error', copy.title, copy.copy, () => void showDrawerView(taskId, view, task, trigger)
        ), trigger, 'error');
      }
    }

    async function openTaskDrawer(taskId, view, trigger) {
      if (!taskId) return;
      const loadingTask = { identity: { task: { id: taskId, title: 'Dashi任务' }, project: {} } };
      openDrawerShell(loadingTask, view, statePanel('loading', '读取任务', '正在读取只读任务详情。'), trigger, 'loading');
      try {
        const task = unwrap(await readApi.getTaskDetail(taskId)).data;
        await showDrawerView(taskId, view, task, trigger);
      } catch (error) {
        const copy = errorPresentation(error);
        openDrawerShell(loadingTask, view, statePanel(
          'error', copy.title, copy.copy, () => void openTaskDrawer(taskId, view, trigger)
        ), trigger, 'error');
      }
    }

    async function readHealth() {
      const health = unwrap(await readApi.getSourceHealth()).data;
      lastHealth = health;
      return health;
    }

    async function load() {
      const current = ++requestId;
      syncNavigation();
      onContextChange({ title: state.view === 'project' ? '项目' : ({ overview: '概览', projects: '项目', tasks: '任务' }[state.view]), status: '读取中' });
      surface.replaceChildren(
        renderHeader('Dashi任务板', '项目、任务与执行关联的本地只读视图。', lastHealth),
        statePanel('loading', '正在读取 Dashi', '正在读取任务板公开数据。')
      );
      try {
        let health;
        let result;
        if (state.view === 'overview') [health, result] = await Promise.all([readHealth(), readApi.getBoardOverview().then(unwrap)]);
        if (state.view === 'projects') [health, result] = await Promise.all([readHealth(), readApi.listProjects().then(unwrap)]);
        if (state.view === 'tasks') [health, result] = await Promise.all([readHealth(), readApi.listTasks({ filter: state.filter }).then(unwrap)]);
        if (state.view === 'project') [health, result] = await Promise.all([readHealth(), readApi.getProjectDetail(state.projectId).then(unwrap)]);
        if (current !== requestId || !active) return;
        if (state.view === 'overview') renderOverview(result.data, health);
        if (state.view === 'projects') renderProjects(result.data, health);
        if (state.view === 'tasks') renderTasks(result.data, health);
        if (state.view === 'project') renderProject(result.data, health);
        onContextChange({
          title: state.view === 'project' ? result.data.name : ({ overview: '概览', projects: '项目', tasks: '任务' }[state.view]),
          status: sourceHealthLabel(health.status)
        });
      } catch (error) {
        if (current !== requestId || !active) return;
        const copy = errorPresentation(error);
        surface.replaceChildren(renderHeader('Dashi任务板', '项目、任务与执行关联的本地只读视图。', lastHealth));
        if (state.view === 'project') {
          surface.prepend(button('← 返回项目', () => setState({ view: 'projects', projectId: null }), 'nexa-dashi-back'));
        }
        surface.append(statePanel('error', copy.title, copy.copy, () => void load()));
        onContextChange({ title: 'Dashi任务板', status: copy.title });
      }
    }

    function activate() {
      if (!navigationListenersAttached) {
        for (const { control, listener } of navigationListeners) control.addEventListener('click', listener);
        navigationListenersAttached = true;
      }
      active = true;
      setHash();
      syncNavigation();
      void load();
    }

    function deactivate() {
      active = false;
      requestId += 1;
      if (navigationListenersAttached) {
        for (const { control, listener } of navigationListeners) control.removeEventListener('click', listener);
        navigationListenersAttached = false;
      }
      drawer.close(true);
    }

    function unmount() {
      deactivate();
      surface.replaceChildren();
      return true;
    }

    return Object.freeze({
      activate,
      deactivate,
      getState: () => Object.freeze({ ...state, active }),
      load,
      openTaskDrawer,
      unmount
    });
  }

  return Object.freeze({
    FILTER_LABELS, MISSING_REASON_COPY, SOURCE_HEALTH_COPY, TASK_FILTERS, VIEWS,
    activitySummary, createRenderer, displayLabel, errorPresentation, formatDateTime, missingReason, parseRoute, routeHash,
    sourceHealthLabel, sourcePresentation, unwrap
  });
});
