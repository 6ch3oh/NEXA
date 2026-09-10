'use strict';

function installMoreNavigationInteraction({ navigation, more, summary, ownerDocument = navigation?.ownerDocument }) {
  if (!navigation || !more || !summary || !ownerDocument) {
    return Object.freeze({ close: () => false, dispose: () => {} });
  }

  function syncExpandedState() {
    summary.setAttribute('aria-expanded', String(Boolean(more.open)));
  }

  function close({ restoreFocus = false } = {}) {
    if (!more.open) return false;
    more.open = false;
    syncExpandedState();
    if (restoreFocus) summary.focus();
    return true;
  }

  function handleOutsidePointer(event) {
    if (more.open && !more.contains(event.target)) close();
  }

  function handleNavigationKeydown(event) {
    if (event.key !== 'Escape' || !close({ restoreFocus: true })) return;
    event.preventDefault();
    event.stopPropagation();
  }

  more.addEventListener('toggle', syncExpandedState);
  ownerDocument.addEventListener('pointerdown', handleOutsidePointer);
  navigation.addEventListener('keydown', handleNavigationKeydown);
  syncExpandedState();

  return Object.freeze({
    close,
    dispose() {
      more.removeEventListener('toggle', syncExpandedState);
      ownerDocument.removeEventListener('pointerdown', handleOutsidePointer);
      navigation.removeEventListener('keydown', handleNavigationKeydown);
    }
  });
}

function morningEnvelopeValue(envelope) {
  if (envelope?.ok === false) throw new Error('Morning briefing source unavailable');
  if (envelope?.ok === true && Object.hasOwn(envelope, 'value')) return envelope.value;
  if (envelope?.ok === true && Object.hasOwn(envelope, 'data')) return envelope.data;
  return envelope;
}

function hasLatestRunReference(reference) {
  if (typeof reference === 'string') return reference.trim().length > 0;
  return Boolean(reference && typeof reference === 'object' &&
    typeof reference.run_id === 'string' && reference.run_id.trim());
}

async function loadMorningAutomationSource(automationApi) {
  if (!automationApi || typeof automationApi.listAutomations !== 'function' ||
      typeof automationApi.getLatestRun !== 'function') {
    throw new Error('Automation morning source unavailable');
  }
  const automations = morningEnvelopeValue(await automationApi.listAutomations({ include_archived: false }));
  if (!Array.isArray(automations)) throw new Error('Automation list unavailable');
  const latestCandidates = automations
    .filter((item) => hasLatestRunReference(item?.latest_run_reference))
    .sort((left, right) => (
      (Date.parse(right?.updated_at || right?.created_at || '') || 0) -
      (Date.parse(left?.updated_at || left?.created_at || '') || 0)
    ))
    .slice(0, 12);
  const latestReads = await Promise.allSettled(latestCandidates.map((item) => (
    automationApi.getLatestRun(item.automation_id)
  )));
  const failedRuns = [];
  let partial = false;
  latestReads.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      partial = true;
      return;
    }
    try {
      const run = morningEnvelopeValue(result.value);
      if (['FAILED', 'TIMED_OUT', 'BLOCKED'].includes(String(run?.status || '').toUpperCase())) {
        failedRuns.push({
          ...run,
          automation_id: run.automation_id || latestCandidates[index].automation_id,
          title: latestCandidates[index].name || '自动化运行失败'
        });
      }
    } catch (_) {
      partial = true;
    }
  });
  return {
    availability: partial ? 'partial' : 'available',
    freshness: { status: 'unknown' },
    automations,
    failed_runs: failedRuns
  };
}

if (typeof module === 'object' && module.exports) {
  module.exports = Object.freeze({
    hasLatestRunReference,
    installMoreNavigationInteraction,
    loadMorningAutomationSource,
    morningEnvelopeValue
  });
}

(function startNexaRendererIntegration() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const api = window.tokenMonitor?.nexa;
  const catalog = window.NexaModulePresentationCatalog;
  const desktopComposition = window.NexaDesktopComposition;
  const presentationAdapterFactory = window.NexaModulePresentationAdapter;
  const hostFactory = window.NexaModuleHost;
  const widgetHostFactory = window.NexaWidgetHost;
  const navigation = document.getElementById('nexaTopNavigation');
  const contextBar = document.getElementById('nexaContextBar');
  const contextTitle = document.getElementById('nexaContextTitle');
  const contextStatus = document.getElementById('nexaContextStatus');
  const surface = document.getElementById('nexaModuleSurface');
  const surfaceState = document.getElementById('nexaModuleSurfaceState');
  const surfaceTitle = document.getElementById('nexaModuleSurfaceTitle');
  const surfaceBody = document.getElementById('nexaModuleSurfaceBody');
  const surfaceSettings = document.getElementById('nexaModuleSurfaceSettings');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsList = document.getElementById('nexaModuleSettingsList');
  const settingsStatus = document.getElementById('nexaModuleSettingsStatus');
  const settingsSearchInput = document.getElementById('settingsSearchInput');
  const settingsSearchStatus = document.getElementById('settingsSearchStatus');
  const settingsSearchEmpty = document.getElementById('settingsSearchEmpty');
  const settingsContextRail = document.getElementById('settingsContextRail');
  const dayNavigation = document.getElementById('nexaHomeSubNavigation');
  const daySurface = document.getElementById('nexaTodayTomorrowSurface');
  const homeCompositionSurface = document.getElementById('nexaHomeCompositionSurface');
  const homeModuleGrid = document.getElementById('nexaHomeModuleGrid');
  const homeWidgetSlots = {
    today: document.getElementById('nexaHomeWidgetToday'),
    data: document.getElementById('nexaHomeWidgetData'),
    activity: document.getElementById('nexaHomeWidgetActivity'),
    status: document.getElementById('nexaHomeWidgetStatus')
  };
  const homeRecovery = document.getElementById('nexaHomeRecovery');
  const homeRecoveryList = document.getElementById('nexaHomeRecoveryList');
  const homeLayoutControls = document.getElementById('nexaHomeLayoutControls');
  const homeLayoutList = document.getElementById('nexaHomeLayoutList');
  const homeDensitySelect = document.getElementById('nexaHomeDensitySelect');
  const homeLayoutRestore = document.getElementById('nexaHomeLayoutRestore');
  const homeLayoutStatus = document.getElementById('nexaHomeLayoutStatus');
  const workspace = document.getElementById('nexaWorkspace');
  const consumptionSurface = document.getElementById('nexaConsumptionSurface');
  const automationCenterSurface = document.getElementById('nexaAutomationCenterSurface');
  const dashiNavigation = document.getElementById('nexaDashiSubNavigation');
  const dashiSurface = document.getElementById('nexaDashiSurface');
  const deviceNavigation = document.getElementById('nexaDeviceCenterSubNavigation');
  const deviceSurface = document.getElementById('nexaDeviceCenterSurface');
  const creatorOpsSurface = document.getElementById('nexaCreatorOpsSurface');
  const marketNavigation = document.getElementById('nexaMarketSubNavigation');
  const marketSurface = document.getElementById('nexaMarketSurface');
  const starBenchSurface = document.getElementById('nexaStarBenchSurface');
  const studyCenterSurface = document.getElementById('nexaStudyCenterSurface');
  const globalCommandElements = {
    root: document.getElementById('nexaGlobalCommandBar'),
    form: document.getElementById('nexaGlobalCommandForm'),
    input: document.getElementById('nexaGlobalCommandInput'),
    model: document.getElementById('nexaGlobalCommandModel'),
    mic: document.getElementById('nexaGlobalCommandMic'),
    submit: document.getElementById('nexaGlobalCommandSubmit'),
    readiness: document.getElementById('nexaGlobalCommandReadiness'),
    history: document.getElementById('nexaGlobalCommandHistory'),
    result: document.getElementById('nexaGlobalCommandResult')
  };
  const shell = document.querySelector('.shell');
  if (!api?.control || !catalog || !desktopComposition || !presentationAdapterFactory || !hostFactory ||
      !widgetHostFactory || !navigation || !surface || !shell || !homeModuleGrid) return;

  const host = hostFactory.createNexaModuleHost({
    catalog,
    initialRoute: window.location.hash.startsWith('#/automation-center')
      ? 'automation-center'
      : window.location.hash.startsWith('#/dashi')
      ? 'dashi'
      : window.location.hash.startsWith('#/device-center')
        ? 'device-center'
        : window.location.hash.startsWith('#/creator-ops')
          ? 'creator-ops'
          : window.location.hash.startsWith('#/market')
            ? 'market'
            : window.location.hash.startsWith('#/starbench')
              ? 'starbench'
              : window.location.hash.startsWith('#/study-center')
                ? 'study-center'
              : window.location.hash.startsWith('#/calendar') ? 'calendar' : 'home'
  });
  const primarySurfaceController = hostFactory.createPrimarySurfaceController([
    surface,
    homeCompositionSurface,
    consumptionSurface,
    automationCenterSurface,
    dashiSurface,
    deviceSurface,
    creatorOpsSurface,
    marketSurface,
    starBenchSurface,
    studyCenterSurface
  ]);
  const secondaryNavigationController = hostFactory.createExclusivePresentationController(contextBar, [
    dayNavigation,
    dashiNavigation,
    deviceNavigation,
    marketNavigation
  ]);
  const presentationAdapter = presentationAdapterFactory.createModulePresentationAdapter({
    composition: desktopComposition
  });
  const widgetHost = widgetHostFactory.createNexaWidgetHost({ slots: homeWidgetSlots });
  const compactNavigation = window.matchMedia('(max-width: 1100px)');
  const fallbackNavigation = window.matchMedia('(max-width: 1023px)');
  let disposeMoreNavigation = () => {};
  const rightDrawer = window.NexaRightDrawer?.createRightDrawer({
    drawer: document.getElementById('nexaRightDrawer'),
    title: document.getElementById('nexaRightDrawerTitle'),
    description: document.getElementById('nexaRightDrawerDescription'),
    context: document.getElementById('nexaRightDrawerContext'),
    state: document.getElementById('nexaRightDrawerState'),
    body: document.getElementById('nexaRightDrawerBody'),
    actions: document.getElementById('nexaRightDrawerActions'),
    close: document.getElementById('nexaRightDrawerClose')
  });
  const rendererPresentationStates = new Map();
  const rendererFailures = new Map();
  const homeLayoutWidgets = Object.freeze([
    Object.freeze({ widgetId: 'module:today-tomorrow', label: '今日中枢', slotId: 'today' }),
    Object.freeze({ widgetId: 'core:ai-usage', label: 'AI 使用总览', slotId: 'data' }),
    Object.freeze({ widgetId: 'module:consumption', label: '消费中心', slotId: 'data' }),
    Object.freeze({ widgetId: 'module:creator-ops', label: '自媒体运营', slotId: 'activity' }),
    Object.freeze({ widgetId: 'core:daily-learning', label: '每日学习', slotId: 'activity' }),
    Object.freeze({ widgetId: 'core:module-status', label: '系统状态', slotId: 'activity' }),
    Object.freeze({ widgetId: 'core:device-network', label: '设备与网络', slotId: 'status' })
  ]);
  const homeLayoutWidgetById = new Map(homeLayoutWidgets.map((widget) => [widget.widgetId, widget]));
  let homeLayoutController = null;
  let homeLayoutSnapshot = null;
  let morningBriefingGeneration = 0;
  let globalCommandBar = null;
  const uiContextPreserver = window.NexaUiContextPreserver?.createUiContextPreserver?.({
    document,
    window,
    roots: [workspace, consumptionSurface, automationCenterSurface, daySurface, studyCenterSurface, deviceSurface, creatorOpsSurface],
    getRoute: () => host.getSnapshot().activeRoute
  });

  function normalizePresentationState(value) {
    const state = String(value || '').trim().toUpperCase();
    if (['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR'].includes(state)) return state;
    if (state === 'LOADING' || state === 'STARTING') return 'LIMITED';
    return null;
  }

  function productStateLabel(value) {
    const state = normalizePresentationState(value);
    return ({ READY: '可用', LIMITED: '受限', OFFLINE: '离线', UNAVAILABLE: '不可用', ERROR: '异常' })[state] || null;
  }

  function projectedStatus(value) {
    const text = String(value || '').trim();
    const state = productStateLabel(text);
    if (state) return state;
    if (/read[ -]?only/i.test(text)) return '只读';
    if (/unsupported/i.test(text)) return '不支持';
    if (/unavailable/i.test(text)) return '不可用';
    if (/disabled/i.test(text)) return '已停用';
    if (/running|available|resident/i.test(text)) return '可用';
    return text || '不可用';
  }

  function hostStateLabel(value) {
    const state = String(value || '').trim().toLowerCase();
    return ({ loading: '加载中', ready: '可用', disabled: '已停用', empty: '尚未接入', error: '异常' })[state]
      || projectedStatus(value);
  }

  function presentationDetail(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!code) return '';
    if (code === 'MODULE_INACTIVE') return '尚未启动';
    if (code === 'MODULE_DISABLED') return '已停用';
    if (code === 'MODULE_NOT_READY') return '尚未就绪';
    if (code.includes('UNAVAILABLE')) return '暂时不可用';
    if (code.startsWith('RENDERER_') || code.includes('CREATION_FAILED')) return '页面暂时无法加载';
    return '暂时不可用';
  }

  function localDateKey(value = new Date()) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0')
    ].join('-');
  }

  function unavailableMorningSource(kind) {
    const payloads = {
      calendar: { todayItems: [], nextEvent: null },
      automation: { failures: [] },
      consumption: { alerts: [], drafts: [] },
      learning: { dueItems: [], dueCount: 0 },
      device: { anomalies: [] },
      modules: { modules: [] }
    };
    return Object.freeze({
      availability: 'unavailable',
      freshness: Object.freeze({ status: 'unknown' }),
      ...(payloads[kind] || {})
    });
  }

  async function loadMorningBriefing() {
    const builder = window.NexaMorningBriefing?.buildMorningBriefing;
    if (typeof builder !== 'function') {
      homeOverviewRenderer?.updateMorningBriefing?.(null);
      return null;
    }
    const current = ++morningBriefingGeneration;
    const now = new Date();
    const nowIso = now.toISOString();
    const today = localDateKey(now);
    const sourceReads = await Promise.allSettled([
      Promise.resolve().then(async () => {
        const summary = morningEnvelopeValue(await api['today-tomorrow'].getDateSummary(today));
        return {
          ...summary,
          todayItems: Array.isArray(summary?.tasks)
            ? summary.tasks
            : Array.isArray(summary?.timeline) ? summary.timeline : [],
          nextEvent: summary?.next_event || null
        };
      }),
      Promise.resolve().then(() => loadMorningAutomationSource(api['automation-center'])),
      Promise.resolve().then(async () => {
        const [summaryRead, draftRead] = await Promise.allSettled([
          api.consumption.getHomeSummary({ contractVersion: '0.2', recentLimit: 5 }),
          api.consumption.execute({ type: 'list-mobile-drafts', payload: { options: { status: 'PENDING' } } })
        ]);
        const summary = summaryRead.status === 'fulfilled' ? morningEnvelopeValue(summaryRead.value) : null;
        const draftValue = draftRead.status === 'fulfilled' ? morningEnvelopeValue(draftRead.value) : null;
        const drafts = Array.isArray(draftValue)
          ? draftValue
          : Array.isArray(draftValue?.items) ? draftValue.items
            : Array.isArray(draftValue?.drafts) ? draftValue.drafts : [];
        if (!summary && draftRead.status !== 'fulfilled') throw new Error('Consumption sources unavailable');
        return {
          availability: 'partial',
          freshness: summary?.freshness || { status: 'unknown' },
          generated_at: summary?.generated_at || null,
          alerts: [],
          drafts
        };
      }),
      Promise.resolve().then(async () => morningEnvelopeValue(await api['study-center'].getHomeSummary())),
      Promise.resolve().then(async () => {
        const anomalies = morningEnvelopeValue(await api['device-center'].getAnomalies());
        if (anomalies?.availability === 'unavailable' && anomalies?.empty_state?.code === 'NO_ANOMALIES') {
          return { ...anomalies, availability: 'empty' };
        }
        return anomalies;
      }),
      Promise.resolve().then(async () => {
        const snapshot = await api.control.getSnapshot();
        if (!Array.isArray(snapshot?.modules)) throw new Error('Module status unavailable');
        return { availability: 'available', freshness: { status: 'unknown' }, modules: snapshot.modules };
      })
    ]);
    if (current !== morningBriefingGeneration) return null;
    const kinds = ['calendar', 'automation', 'consumption', 'learning', 'device', 'modules'];
    const input = Object.fromEntries(sourceReads.map((result, index) => [
      kinds[index],
      result.status === 'fulfilled' ? result.value : unavailableMorningSource(kinds[index])
    ]));
    const briefing = builder({ date: today, ...input }, { now: nowIso, maxItems: 6 });
    if (current === morningBriefingGeneration) homeOverviewRenderer?.updateMorningBriefing?.(briefing);
    return briefing;
  }

  function onRendererContext(moduleId, routeId, value) {
    const state = normalizePresentationState(value?.status);
    if (state) rendererPresentationStates.set(moduleId, state);
    if (host.getSnapshot().activeRoute === routeId) {
      contextTitle.textContent = value.title;
      contextStatus.textContent = projectedStatus(value.status);
    }
    renderSettings(host.getSnapshot());
    renderHomeComposition();
  }

  function createRendererSafely(moduleId, available, factory) {
    if (!available) {
      rendererPresentationStates.set(moduleId, 'UNAVAILABLE');
      return null;
    }
    try {
      return factory();
    } catch (error) {
      rendererPresentationStates.set(moduleId, 'ERROR');
      rendererFailures.set(moduleId, error?.code || 'RENDERER_CREATION_FAILED');
      return null;
    }
  }

  const consumptionRenderer = createRendererSafely(
    'consumption', Boolean(api.consumption && consumptionSurface && window.NexaConsumptionRenderer?.createRenderer),
    () => window.NexaConsumptionRenderer.createRenderer({
        api: api.consumption,
        mobileApi: api['mobile-pairing'],
        surface: consumptionSurface,
        drawer: rightDrawer,
        onOpenSettings: () => navigate('settings'),
        onOpenDevices: () => navigate('device-center'),
        onContextChange: (value) => onRendererContext('consumption', 'cost', value)
      })
  );
  const consumptionHomeWidgetRenderer = createRendererSafely(
    'consumption-home-widget', Boolean(
      api.consumption?.getHomeSummary && window.NexaConsumptionHomeWidgetRenderer?.createRenderer
    ),
    () => window.NexaConsumptionHomeWidgetRenderer.createRenderer({
      api: api.consumption,
      onOpenConsumption: () => navigate('cost'),
      onStateChange: (value) => {
        try {
          widgetHost.setStatus('module:consumption', value.status, value.label);
        } catch (_) {}
      }
    })
  );
  const calendarHomeWidgetRenderer = createRendererSafely(
    'today-tomorrow', Boolean(
      api['today-tomorrow']?.getDateSummary && api['today-tomorrow']?.getMonthSummary &&
      api['today-tomorrow']?.parseHomeInput && api['today-tomorrow']?.getLocalAiState &&
      api['today-tomorrow']?.proposeLocalAi && api['today-tomorrow']?.confirmLocalAi &&
      api['today-tomorrow']?.cancelLocalAi && api['today-tomorrow']?.undoLocalAi &&
      window.NexaCalendarHomeWidgetRenderer?.createRenderer
    ),
    () => window.NexaCalendarHomeWidgetRenderer.createRenderer({
      api: api['today-tomorrow'],
      onOpenCalendar: ({ date } = {}) => {
        if (date && typeof todayTomorrowRenderer?.openDate === 'function') {
          void todayTomorrowRenderer.openDate(date);
        }
        navigate('calendar');
      },
      onOpenGlobalCommand: ({ selectedDate } = {}) => globalCommandBar?.focus({
        SELECTED_DATE: selectedDate || ''
      }),
      onConfigureLocalAi: openCalendarLocalAiSettings,
      onStateChange: (value) => {
        try {
          widgetHost.setStatus('module:today-tomorrow', value.status, value.label);
        } catch (_) {}
      }
    })
  );
  const creatorOpsHomeWidgetRenderer = createRendererSafely(
    'creator-ops-home-widget', Boolean(
      api['creator-ops']?.getHomeSummary && window.NexaCreatorOpsHomeWidgetRenderer?.createRenderer
    ),
    () => window.NexaCreatorOpsHomeWidgetRenderer.createRenderer({
      api: api['creator-ops'],
      onOpenCreatorOps: () => navigate('creator-ops'),
      onStateChange: (value) => {
        try {
          widgetHost.setStatus('module:creator-ops', value.status, value.label);
        } catch (_) {}
      }
    })
  );
  const todayTomorrowRenderer = createRendererSafely(
    'today-tomorrow', Boolean(api['today-tomorrow'] && daySurface && rightDrawer && window.NexaTodayTomorrowRenderer?.createRenderer),
    () => window.NexaTodayTomorrowRenderer.createRenderer({
        api: api['today-tomorrow'], surface: daySurface, drawer: rightDrawer,
        onConfigureLocalAi: openCalendarLocalAiSettings,
        onOpenGlobalCommand: ({ selectedDate } = {}) => globalCommandBar?.focus({
          SELECTED_DATE: selectedDate || ''
        })
      })
  );
  if (api.globalCommand && window.NexaGlobalCommandBar?.createGlobalCommandBar && globalCommandElements.form) {
    globalCommandBar = window.NexaGlobalCommandBar.createGlobalCommandBar({
      api: api.globalCommand,
      elements: globalCommandElements,
      copyText: window.tokenMonitor.copyText,
      getContext: () => {
        const snapshot = host.getSnapshot();
        const route = catalog.getRoute(snapshot.activeRoute);
        return {
          CURRENT_DATETIME: new Date().toISOString(),
          TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          CURRENT_MODULE: route?.moduleId || snapshot.activeRoute,
          SELECTED_OBJECT: '',
          SELECTED_DATE: todayTomorrowRenderer?.getDate?.() || ''
        };
      },
      onNavigate: (routeId) => navigate(routeId),
      onRequestHome: () => {
        if (host.getSnapshot().activeRoute !== 'home') navigate('home');
      }
    });
  }
  const dashiRenderer = createRendererSafely(
    'dashi', Boolean(api.dashi && dashiSurface && dashiNavigation && rightDrawer && window.NexaDashiRenderer?.createRenderer),
    () => window.NexaDashiRenderer.createRenderer({
        api: api.dashi,
        surface: dashiSurface,
        subNavigation: dashiNavigation,
        drawer: rightDrawer,
        onContextChange: (value) => onRendererContext('dashi', 'dashi', value)
      })
  );
  const deviceRenderer = createRendererSafely(
    'device-center', Boolean(api['device-center'] && deviceSurface && deviceNavigation && window.NexaDeviceCenterUiIntegrationHost?.createRenderer),
    () => window.NexaDeviceCenterUiIntegrationHost.createRenderer({
        api: api['device-center'],
        mobileApi: api['mobile-pairing'],
        surface: deviceSurface,
        subNavigation: deviceNavigation,
        onContextChange: (value) => onRendererContext('device-center', 'device-center', value)
      })
  );
  const creatorOpsRenderer = createRendererSafely(
    'creator-ops', Boolean(api['creator-ops'] && creatorOpsSurface && window.NexaCreatorOpsUiIntegrationHost?.createRenderer),
    () => window.NexaCreatorOpsUiIntegrationHost.createRenderer({
        api: api['creator-ops'],
        pathBridge: api['local-resource-path'],
        surface: creatorOpsSurface,
        onContextChange: (value) => onRendererContext('creator-ops', 'creator-ops', value)
      })
  );
  const marketRenderer = createRendererSafely(
    'market', Boolean(api.market && marketSurface && marketNavigation && window.NexaMarketRenderer?.createRenderer),
    () => window.NexaMarketRenderer.createRenderer({
        api: api.market,
        surface: marketSurface,
        subNavigation: marketNavigation,
        onOpenSettings: () => navigate('settings'),
        onContextChange: (value) => onRendererContext('market', 'market', value)
      })
  );
  const starBenchRenderer = createRendererSafely(
    'starbench', Boolean(api.starbench && starBenchSurface && window.NexaStarBenchRenderer?.createRenderer),
    () => window.NexaStarBenchRenderer.createRenderer({
        api: api.starbench,
        surface: starBenchSurface,
        onOpenSettings: () => navigate('settings'),
        onContextChange: (value) => onRendererContext('starbench', 'starbench', value)
      })
  );
  const studyCenterRenderer = createRendererSafely(
    'study-center', Boolean(api['study-center'] && studyCenterSurface && window.NexaStudyCenterRenderer?.createRenderer),
    () => window.NexaStudyCenterRenderer.createRenderer({
        api: api['study-center'],
        surface: studyCenterSurface,
        onContextChange: (value) => onRendererContext('study-center', 'study-center', value)
      })
  );
  const automationCenterRenderer = createRendererSafely(
    'automation-center', Boolean(
      api['automation-center'] && automationCenterSurface && window.NexaAutomationCenterRenderer?.createRenderer
    ),
    () => window.NexaAutomationCenterRenderer.createRenderer({
      api: api['automation-center'],
      surface: automationCenterSurface,
      onContextChange: (value) => onRendererContext('automation-center', 'automation-center', value)
    })
  );
  const homeOverviewRenderer = createRendererSafely(
    'core-home-overview', Boolean(window.tokenMonitor?.getStats && window.NexaHomeOverviewRenderer?.createRenderer),
    () => window.NexaHomeOverviewRenderer.createRenderer({
      statsApi: window.tokenMonitor,
      studyApi: api['study-center'],
      deviceApi: api['device-center'],
      onOpenRoute: (routeId) => navigate(routeId),
      onRefreshMorningBriefing: () => loadMorningBriefing(),
      onStateChange: ({ ai, device } = {}) => {
        try {
          if (ai) widgetHost.setStatus('core:ai-usage', ai.status, ai.label);
          if (device) widgetHost.setStatus('core:device-network', device.status, device.label);
        } catch (_) {}
      }
    })
  );
  const moduleRenderers = new Map([
    ['automation-center', automationCenterRenderer],
    ['consumption', consumptionRenderer],
    ['today-tomorrow', todayTomorrowRenderer],
    ['dashi', dashiRenderer],
    ['device-center', deviceRenderer],
    ['creator-ops', creatorOpsRenderer],
    ['market', marketRenderer],
    ['starbench', starBenchRenderer],
    ['study-center', studyCenterRenderer]
  ]);
  let busy = false;
  let consumptionHomeWidgetActive = false;
  let creatorOpsHomeWidgetActive = false;
  let homeOverviewActive = false;
  let activeUiModuleId = null;

  function locale() {
    return 'zh-CN';
  }

  function routeCopy(routeId, status) {
    if (routeId === 'cost') {
      return status === 'disabled'
        ? '消费中心已停用，请在设置中重新启用。'
        : '消费中心当前不可用。';
    }
    if (routeId === 'automation-center') return '自动化中心当前不可用，其他模块仍可继续使用。';
    if (routeId === 'resources') return '资源页面尚未接入。';
    if (routeId === 'starbench') return '星枢台页面尚未接入。';
    if (routeId === 'creator-ops') return '自媒体运营入口当前不可用。';
    if (routeId === 'market') return '股票市场当前不可用。';
    if (catalog.getRoute(routeId)?.moduleId) {
      return '此模块页面当前不可用，首页与其他模块仍可继续使用。';
    }
    return '';
  }

  function runtimeLabel(module) {
    if (!module) return '不可用';
    if (!module.enabled) return '已停用';
    const rendererState = rendererPresentationStates.get(module.moduleId);
    if (rendererState) return projectedStatus(rendererState);
    if (module.readiness?.state) return projectedStatus(module.readiness.state);
    return module.runtimeStatus === 'running' ? '可用' : '离线';
  }

  function homeModuleState(moduleId) {
    return host.moduleState(moduleId, rendererPresentationStates.get(moduleId));
  }

  function applyHomeLayoutSnapshot(snapshot = homeLayoutSnapshot) {
    if (!snapshot || !homeModuleGrid) return;
    const hidden = new Set(snapshot.hiddenWidgetIds || []);
    const indexById = new Map((snapshot.orderedWidgetIds || []).map((widgetId, index) => [widgetId, index]));
    for (const element of homeModuleGrid.querySelectorAll('[data-nexa-widget-id]')) {
      const widgetId = element.dataset.nexaWidgetId;
      const visible = !hidden.has(widgetId);
      element.style.order = String(indexById.get(widgetId) ?? 999);
      element.hidden = !visible;
      element.classList.toggle('hidden', !visible);
      element.setAttribute('aria-hidden', String(!visible));
      if ('inert' in element) element.inert = !visible;
    }
    for (const [slotId, container] of Object.entries(homeWidgetSlots)) {
      const slot = container?.closest?.('[data-nexa-widget-slot]');
      if (!slot) continue;
      const orderedChildren = [...container.children].sort((left, right) => (
        (indexById.get(left.dataset.nexaWidgetId) ?? 999) - (indexById.get(right.dataset.nexaWidgetId) ?? 999)
      ));
      for (const child of orderedChildren) container.append(child);
      const visibleCount = orderedChildren.filter((child) => child.hidden !== true).length;
      const hasVisibleWidget = visibleCount > 0;
      container.classList.toggle('nexa-home-widget-container-single', visibleCount === 1);
      slot.hidden = !hasVisibleWidget;
      slot.classList.toggle('nexa-home-layout-empty', !hasVisibleWidget);
      slot.setAttribute('aria-hidden', String(!hasVisibleWidget));
      slot.dataset.layoutSlot = slotId;
    }
    const todayVisible = homeWidgetSlots.today?.closest?.('[data-nexa-widget-slot]')?.hidden !== true;
    const dataVisible = homeWidgetSlots.data?.closest?.('[data-nexa-widget-slot]')?.hidden !== true;
    homeWidgetSlots.today?.closest?.('[data-nexa-widget-slot]')?.classList.toggle('nexa-home-layout-solo', todayVisible && !dataVisible);
    homeWidgetSlots.data?.closest?.('[data-nexa-widget-slot]')?.classList.toggle('nexa-home-layout-solo', dataVisible && !todayVisible);
    homeCompositionSurface?.classList.toggle('nexa-home-density-compact', snapshot.density === 'compact');
    homeCompositionSurface?.classList.toggle('nexa-home-density-comfortable', snapshot.density !== 'compact');
    if (homeDensitySelect) homeDensitySelect.value = snapshot.density;
  }

  async function runHomeLayoutMutation(operation, successMessage = '首页布局已保存') {
    if (!homeLayoutController || typeof operation !== 'function') return null;
    if (homeLayoutStatus) homeLayoutStatus.textContent = '正在保存…';
    try {
      homeLayoutSnapshot = await operation();
      applyHomeLayoutSnapshot();
      renderHomeLayoutControls();
      if (homeLayoutStatus) homeLayoutStatus.textContent = successMessage;
      return homeLayoutSnapshot;
    } catch (_) {
      homeLayoutSnapshot = homeLayoutController.getSnapshot?.() || homeLayoutSnapshot;
      applyHomeLayoutSnapshot();
      renderHomeLayoutControls();
      if (homeLayoutStatus) homeLayoutStatus.textContent = '保存失败，现有布局保持不变';
      return null;
    }
  }

  function homeLayoutGroup(widgetId, snapshot = homeLayoutSnapshot) {
    const slotId = homeLayoutWidgetById.get(widgetId)?.slotId;
    return (snapshot?.orderedWidgetIds || []).filter((id) => homeLayoutWidgetById.get(id)?.slotId === slotId);
  }

  function moveHomeLayoutWithinSlot(widgetId, direction) {
    if (!homeLayoutController || !homeLayoutSnapshot) return Promise.resolve(null);
    const group = homeLayoutGroup(widgetId);
    const index = group.indexOf(widgetId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= group.length) return Promise.resolve(homeLayoutSnapshot);
    const targetIndex = homeLayoutSnapshot.orderedWidgetIds.indexOf(group[target]);
    return runHomeLayoutMutation(
      () => homeLayoutController.reorderWidget(widgetId, targetIndex),
      '分区内顺序已保存'
    );
  }

  function reorderHomeLayoutGroup(draggedId, targetId) {
    if (!homeLayoutController || !homeLayoutSnapshot || draggedId === targetId) return Promise.resolve(null);
    const group = homeLayoutGroup(draggedId);
    if (!group.includes(targetId)) return Promise.resolve(null);
    const reorder = window.TokenMonitorPreferenceDragSort?.reorderItems;
    const targetIndex = group.indexOf(targetId);
    const nextGroup = typeof reorder === 'function'
      ? reorder(group, draggedId, targetIndex)
      : (() => {
          const copy = [...group];
          const from = copy.indexOf(draggedId);
          const [moved] = copy.splice(from, 1);
          copy.splice(targetIndex, 0, moved);
          return copy;
        })();
    let groupIndex = 0;
    const nextOrder = homeLayoutSnapshot.orderedWidgetIds.map((id) => (
      homeLayoutWidgetById.get(id)?.slotId === homeLayoutWidgetById.get(draggedId)?.slotId
        ? nextGroup[groupIndex++]
        : id
    ));
    return runHomeLayoutMutation(
      () => homeLayoutController.setOrderedWidgetIds(nextOrder),
      '分区内顺序已保存'
    );
  }

  function renderHomeLayoutControls() {
    if (!homeLayoutList || !homeLayoutSnapshot) return;
    homeLayoutList.replaceChildren();
    let draggedWidgetId = null;
    for (const widget of homeLayoutSnapshot.widgets) {
      const metadata = homeLayoutWidgetById.get(widget.widgetId);
      if (!metadata) continue;
      const row = document.createElement('div');
      row.className = 'nexa-home-layout-row';
      row.dataset.widgetId = widget.widgetId;
      row.draggable = true;
      const handle = document.createElement('span');
      handle.className = 'nexa-home-layout-drag-handle';
      handle.textContent = '拖动';
      handle.setAttribute('aria-hidden', 'true');
      const label = document.createElement('strong');
      label.textContent = metadata.label;
      const group = homeLayoutGroup(widget.widgetId);
      const groupIndex = group.indexOf(widget.widgetId);
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '上移';
      up.disabled = groupIndex <= 0;
      up.setAttribute('aria-label', `上移${metadata.label}`);
      up.addEventListener('click', () => { void moveHomeLayoutWithinSlot(widget.widgetId, 'up'); });
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '下移';
      down.disabled = groupIndex < 0 || groupIndex >= group.length - 1;
      down.setAttribute('aria-label', `下移${metadata.label}`);
      down.addEventListener('click', () => { void moveHomeLayoutWithinSlot(widget.widgetId, 'down'); });
      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.textContent = widget.visible ? '隐藏' : '显示';
      visibility.setAttribute('aria-pressed', String(widget.visible));
      visibility.setAttribute('aria-label', `${widget.visible ? '隐藏' : '显示'}${metadata.label}`);
      visibility.addEventListener('click', () => {
        void runHomeLayoutMutation(() => homeLayoutController.toggleWidget(widget.widgetId));
      });
      row.addEventListener('dragstart', (event) => {
        draggedWidgetId = widget.widgetId;
        event.dataTransfer?.setData('text/plain', widget.widgetId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragover', (event) => {
        if (draggedWidgetId && homeLayoutGroup(draggedWidgetId).includes(widget.widgetId)) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        }
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        if (draggedWidgetId) void reorderHomeLayoutGroup(draggedWidgetId, widget.widgetId);
      });
      row.addEventListener('dragend', () => {
        draggedWidgetId = null;
        row.classList.remove('is-dragging');
      });
      row.append(handle, label, up, down, visibility);
      homeLayoutList.append(row);
    }
    if (homeLayoutRestore) homeLayoutRestore.disabled = homeLayoutSnapshot.isDefault;
  }

  function initializeHomeLayoutPreferences() {
    const factory = window.NexaHomeLayoutPreferences?.createNexaHomeLayoutPreferencesController;
    if (typeof factory !== 'function' || typeof window.tokenMonitor?.getSettings !== 'function' ||
        typeof window.tokenMonitor?.updateSettings !== 'function') {
      homeLayoutControls?.classList.add('hidden');
      return;
    }
    try {
      homeLayoutController = factory({
        widgetIds: homeLayoutWidgets.map((widget) => widget.widgetId),
        readPreferences: () => window.tokenMonitor.getSettings(),
        writePreferences: (patch) => window.tokenMonitor.updateSettings(patch),
        preferenceKeys: {
          order: 'nexaHomeWidgetOrder',
          hidden: 'nexaHiddenHomeWidgets',
          density: 'nexaHomeDensity'
        }
      });
      homeDensitySelect?.addEventListener('change', () => {
        void runHomeLayoutMutation(() => homeLayoutController.setDensity(homeDensitySelect.value), '显示密度已保存');
      });
      homeLayoutRestore?.addEventListener('click', () => {
        void runHomeLayoutMutation(() => homeLayoutController.restoreDefaults(), '已恢复默认布局');
      });
      void homeLayoutController.load().then((snapshot) => {
        homeLayoutSnapshot = snapshot;
        applyHomeLayoutSnapshot();
        renderHomeLayoutControls();
        if (homeLayoutStatus) homeLayoutStatus.textContent = '';
      }).catch(() => {
        if (homeLayoutStatus) homeLayoutStatus.textContent = '布局设置暂不可用';
      });
    } catch (_) {
      homeLayoutControls?.classList.add('hidden');
    }
  }

  function renderHomeComposition(snapshot = host.getSnapshot()) {
    if (typeof catalog.listAssemblyModules !== 'function') return;
    widgetHost.clear();
    homeRecoveryList?.replaceChildren();
    let recoveryCount = 0;
    homeOverviewRenderer?.updateModules(snapshot.modules.map((module) => ({
      ...module,
      title: catalog.moduleLabel(module.moduleId, locale()),
      routeId: catalog.getModuleMetadata(module.moduleId)?.routeId || null,
      presentationState: homeModuleState(module.moduleId)
    })));
    const coreHomeWidgets = homeOverviewRenderer?.getWidgets?.() || [];
    const aiUsageWidget = coreHomeWidgets.find((widget) => widget.widgetId === 'core:ai-usage');
    if (aiUsageWidget) widgetHost.register(aiUsageWidget);
    const widgets = presentationAdapter.adaptAll({
      entries: catalog.listAssemblyModules(locale()),
      modules: snapshot.modules,
      stateFor: homeModuleState,
      detailFor: (moduleId) => rendererFailures.get(moduleId) ||
        snapshot.modules.find((module) => module.moduleId === moduleId)?.readiness?.code
    });
    for (const widget of widgets) {
      const homePresentationOwnedByCore = ['market', 'study-center', 'device-center'].includes(widget.moduleId);
      const useConsumptionHome = widget.moduleId === 'consumption' && consumptionHomeWidgetRenderer;
      const useCalendarHome = widget.moduleId === 'today-tomorrow' && calendarHomeWidgetRenderer;
      const useCreatorOpsHome = widget.moduleId === 'creator-ops' && creatorOpsHomeWidgetRenderer;
      let card;
      let registeredWidget = widget;
      if (homePresentationOwnedByCore) {
        card = null;
      } else if (useConsumptionHome) {
        consumptionHomeWidgetRenderer.setHostState(widget);
        card = consumptionHomeWidgetRenderer.getElement();
        const localState = consumptionHomeWidgetRenderer.getState();
        registeredWidget = Object.freeze({ ...widget, status: localState.status });
      } else if (useCalendarHome) {
        calendarHomeWidgetRenderer.setHostState(widget);
        card = calendarHomeWidgetRenderer.getElement();
        const localState = calendarHomeWidgetRenderer.getState();
        registeredWidget = Object.freeze({ ...widget, status: localState.status });
      } else if (useCreatorOpsHome) {
        creatorOpsHomeWidgetRenderer.setHostState(widget);
        card = creatorOpsHomeWidgetRenderer.getElement();
        const localState = creatorOpsHomeWidgetRenderer.getState();
        registeredWidget = Object.freeze({ ...widget, status: localState.status });
      } else {
        card = document.createElement('article');
        card.className = 'nexa-home-module-card';
        card.dataset.moduleState = widget.status;

        const header = document.createElement('div');
        header.className = 'nexa-home-module-card-header';
        const title = document.createElement('h2');
        title.textContent = widget.title;
        const status = document.createElement('span');
        status.className = 'nexa-home-module-state';
        status.setAttribute('data-nexa-widget-status', '');
        header.append(title, status);

        const description = document.createElement('p');
        description.textContent = widget.description;
        const detail = document.createElement('code');
        detail.className = 'nexa-home-module-detail';
        detail.textContent = presentationDetail(widget.detail);
        detail.classList.toggle('hidden', !detail.textContent);

        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = !widget.enabled
          ? '打开设置'
          : ['ERROR', 'OFFLINE', 'UNAVAILABLE'].includes(widget.status) ? '打开 / 重试' : '进入';
        action.addEventListener('click', () => {
          if (!widget.enabled) {
            openSettings();
            return;
          }
          navigate(widget.routeId);
        });
        card.append(header, description, detail, action);
      }
      if (card) {
        widgetHost.register({
          ...registeredWidget,
          element: card,
          statusLabel: useConsumptionHome
            ? consumptionHomeWidgetRenderer.getState().label
            : useCalendarHome
              ? calendarHomeWidgetRenderer.getState().label
              : useCreatorOpsHome
                ? creatorOpsHomeWidgetRenderer.getState().label
                : !widget.enabled ? '已停用' : projectedStatus(widget.status)
        });
      }

      if (!widget.enabled || ['LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR'].includes(widget.status)) {
        recoveryCount += 1;
        const recoveryItem = document.createElement('article');
        recoveryItem.className = 'nexa-home-recovery-item';
        const recoveryCopy = document.createElement('span');
        recoveryCopy.textContent = `${widget.title} · ${!widget.enabled ? '已停用' : projectedStatus(widget.status)}`;
        const recoveryAction = document.createElement('button');
        recoveryAction.type = 'button';
        recoveryAction.textContent = !widget.enabled ? '打开设置' : '打开 / 重试';
        recoveryAction.addEventListener('click', () => !widget.enabled ? openSettings() : navigate(widget.routeId));
        recoveryItem.append(recoveryCopy, recoveryAction);
        homeRecoveryList?.append(recoveryItem);
      }
    }
    for (const coreWidget of coreHomeWidgets.filter((widget) => widget.widgetId !== 'core:ai-usage')) {
      widgetHost.register(coreWidget);
    }
    homeRecovery?.classList.toggle('hidden', recoveryCount === 0);
    if (homeRecovery) {
      homeRecovery.hidden = recoveryCount === 0;
      homeRecovery.dataset.count = String(recoveryCount);
      const recoverySummary = homeRecovery.querySelector?.('summary');
      if (recoverySummary) recoverySummary.textContent = `需要处理 · ${recoveryCount}`;
      homeRecovery.setAttribute('aria-hidden', String(recoveryCount === 0));
    }
    applyHomeLayoutSnapshot();
  }

  function runRendererLifecycle(moduleId, renderer, method) {
    try {
      const result = renderer?.[method]?.();
      Promise.resolve(result).catch((error) => {
        rendererPresentationStates.set(moduleId, 'ERROR');
        rendererFailures.set(moduleId, error?.code || `RENDERER_${method.toUpperCase()}_FAILED`);
        renderHomeComposition();
      });
    } catch (error) {
      rendererPresentationStates.set(moduleId, 'ERROR');
      rendererFailures.set(moduleId, error?.code || `RENDERER_${method.toUpperCase()}_FAILED`);
      renderHomeComposition();
    }
  }

  function transitionActiveUiModule(nextModuleId) {
    if (activeUiModuleId === nextModuleId) return false;
    const previousModuleId = activeUiModuleId;
    activeUiModuleId = null;
    if (previousModuleId) {
      const previousRenderer = moduleRenderers.get(previousModuleId);
      runRendererLifecycle(
        previousModuleId,
        previousRenderer,
        typeof previousRenderer?.unmount === 'function' ? 'unmount' : 'deactivate'
      );
    }
    if (nextModuleId) {
      activeUiModuleId = nextModuleId;
      runRendererLifecycle(nextModuleId, moduleRenderers.get(nextModuleId), 'activate');
    }
    return true;
  }

  function openSettings() {
    settingsPanel?.classList.remove('hidden');
    shell.classList.add('settings-open');
    navigate('settings');
    document.getElementById('nexaModuleSettings')?.scrollIntoView({ block: 'nearest' });
  }

  function openCalendarLocalAiSettings() {
    navigate('settings');
    queueMicrotask(() => document.getElementById('calendarLocalAiSettings')?.scrollIntoView({ block: 'start' }));
  }

  function settingsGroups() {
    return [...(settingsPanel?.children || [])].filter((node) => node.matches?.('.settings-group'));
  }

  function normalizedSettingsQuery() {
    return String(settingsSearchInput?.value || '').trim().toLocaleLowerCase('zh-CN');
  }

  function applySettingsSearch() {
    if (!settingsPanel) return;
    const query = normalizedSettingsQuery();
    let visibleGroups = 0;
    let visibleModules = 0;
    const moduleRows = [...(settingsList?.querySelectorAll?.('.nexa-module-setting-row') || [])];
    for (const row of moduleRows) {
      const matches = !query || String(row.textContent || '').toLocaleLowerCase('zh-CN').includes(query);
      row.classList.toggle('settings-search-filtered', !matches);
      if (matches) visibleModules += 1;
    }
    for (const group of settingsGroups()) {
      const isModules = group.id === 'nexaModuleSettings';
      const matches = !query || (isModules
        ? visibleModules > 0
        : String(group.textContent || '').toLocaleLowerCase('zh-CN').includes(query));
      group.classList.toggle('settings-search-filtered', !matches);
      if (matches) visibleGroups += 1;
    }
    settingsSearchEmpty?.classList.toggle('hidden', visibleGroups > 0);
    if (settingsSearchStatus) {
      settingsSearchStatus.textContent = query
        ? (visibleGroups > 0 ? `找到 ${visibleGroups} 个设置分组` : '没有匹配结果')
        : '按分组查看本地配置';
    }
  }

  function findSettingsTarget(target) {
    if (target === 'modules') return document.getElementById('nexaModuleSettings');
    if (target === 'calendar-ai') return document.getElementById('calendarLocalAiSettings');
    const toggle = settingsPanel?.querySelector?.(`[data-settings-section="${target}"]`);
    return toggle?.closest?.('.settings-group') || null;
  }

  function installSettingsPageInteraction() {
    settingsSearchInput?.addEventListener('input', applySettingsSearch);
    settingsSearchInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !settingsSearchInput.value) return;
      settingsSearchInput.value = '';
      applySettingsSearch();
      event.preventDefault();
    });
    for (const button of settingsContextRail?.querySelectorAll?.('[data-settings-target]') || []) {
      button.addEventListener('click', () => {
        if (settingsSearchInput?.value) {
          settingsSearchInput.value = '';
          applySettingsSearch();
        }
        for (const peer of settingsContextRail.querySelectorAll('[data-settings-target]')) {
          peer.setAttribute('aria-current', peer === button ? 'page' : 'false');
        }
        const target = findSettingsTarget(button.dataset.settingsTarget);
        const toggle = target?.querySelector?.('.settings-section-toggle');
        if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
        target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function renderNavigation(snapshot) {
    const modules = new Map(snapshot.modules.map((module) => [module.moduleId, module]));
    disposeMoreNavigation();
    disposeMoreNavigation = () => {};
    navigation.replaceChildren();

    function createButton(route) {
      const button = document.createElement('button');
      const module = route.moduleId ? modules.get(route.moduleId) : null;
      button.type = 'button';
      button.dataset.nexaRoute = route.id;
      button.textContent = compactNavigation.matches ? route.shortLabel : catalog.routeLabel(route.id, locale());
      button.setAttribute('aria-label', route.accessibleName || catalog.routeLabel(route.id, locale()));
      button.dataset.moduleState = module?.enabled === false ? 'disabled' : 'available';
      button.setAttribute('aria-current', route.id === snapshot.activeRoute ? 'page' : 'false');
      button.addEventListener('click', () => {
        button.closest?.('details')?.removeAttribute('open');
        navigate(route.id);
      });
      return button;
    }

    const routes = catalog.listPrimaryRoutes();
    if (!fallbackNavigation.matches) {
      for (const route of routes) navigation.append(createButton(route));
      return;
    }

    const directRouteIds = new Set(['home', 'settings', snapshot.activeRoute]);
    for (const route of routes.filter((entry) => directRouteIds.has(entry.id))) navigation.append(createButton(route));
    const more = document.createElement('details');
    more.className = 'nexa-navigation-more';
    const summary = document.createElement('summary');
    summary.textContent = '更多';
    summary.setAttribute('aria-label', '更多模块');
    summary.setAttribute('aria-haspopup', 'menu');
    const menu = document.createElement('div');
    menu.className = 'nexa-navigation-more-menu';
    menu.setAttribute('role', 'menu');
    for (const route of routes.filter((entry) => !directRouteIds.has(entry.id))) {
      const button = createButton(route);
      button.setAttribute('role', 'menuitem');
      menu.append(button);
    }
    more.append(summary, menu);
    navigation.append(more);
    disposeMoreNavigation = installMoreNavigationInteraction({ navigation, more, summary }).dispose;
  }

  function renderSettings(snapshot) {
    settingsList.replaceChildren();
    for (const module of snapshot.modules) {
      const row = document.createElement('div');
      row.className = 'nexa-module-setting-row';
      row.dataset.moduleId = module.moduleId;
      const copy = document.createElement('div');
      copy.className = 'nexa-module-setting-copy';
      const name = document.createElement('strong');
      name.textContent = catalog.moduleLabel(module.moduleId, locale());
      const status = document.createElement('span');
      status.textContent = runtimeLabel(module);
      copy.append(name, status);

      const enabledLabel = document.createElement('label');
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = module.enabled;
      enabled.disabled = busy;
      enabled.setAttribute('aria-label', `启用${name.textContent}`);
      enabled.addEventListener('change', () => mutate(
        () => api.control.setEnabled(module.moduleId, enabled.checked)
      ));
      enabledLabel.append(enabled, document.createTextNode('启用'));

      const autoStartLabel = document.createElement('label');
      const autoStart = document.createElement('input');
      autoStart.type = 'checkbox';
      autoStart.checked = module.autoStart;
      autoStart.disabled = busy;
      autoStart.setAttribute('aria-label', `${name.textContent}自动启动`);
      autoStart.addEventListener('change', () => mutate(
        () => api.control.setAutoStart(module.moduleId, autoStart.checked)
      ));
      autoStartLabel.append(autoStart, document.createTextNode('自动启动'));
      row.append(copy, enabledLabel, autoStartLabel);
      settingsList.append(row);
    }
    applySettingsSearch();
  }

  function render() {
    const snapshot = host.getSnapshot();
    const route = catalog.getRoute(snapshot.activeRoute);
    const module = snapshot.modules.find((value) => value.moduleId === route?.moduleId);
    renderNavigation(snapshot);
    renderSettings(snapshot);
    renderHomeComposition(snapshot);
    contextTitle.textContent = catalog.routeLabel(snapshot.activeRoute, locale());
    contextStatus.textContent = route?.moduleId ? runtimeLabel(module) : (
      snapshot.activeRoute === 'home' ? '可用' : snapshot.status === 'empty' ? '尚未接入' : '可用'
    );

    const homeRoute = snapshot.activeRoute === 'home';
    globalCommandBar?.setHomeActive(homeRoute);
    const rendererUnavailableRoute = Boolean(route?.moduleId && !moduleRenderers.get(route.moduleId));
    const genericRoute = snapshot.activeRoute === 'resources' || rendererUnavailableRoute;
    const consumptionModule = snapshot.modules.find((value) => value.moduleId === 'consumption');
    const consumptionRoute = snapshot.activeRoute === 'cost' && Boolean(consumptionRenderer) &&
      consumptionModule?.enabled === true;
    const automationCenterModule = snapshot.modules.find((value) => value.moduleId === 'automation-center');
    const automationCenterRoute = snapshot.activeRoute === 'automation-center' && Boolean(automationCenterRenderer) &&
      automationCenterModule?.enabled === true;
    const planningModule = snapshot.modules.find((value) => value.moduleId === 'today-tomorrow');
    const todayRoute = snapshot.activeRoute === 'calendar' && Boolean(todayTomorrowRenderer) &&
      planningModule?.enabled === true;
    const dashiModule = snapshot.modules.find((value) => value.moduleId === 'dashi');
    const dashiRoute = snapshot.activeRoute === 'dashi' && Boolean(dashiRenderer) &&
      dashiModule?.enabled === true;
    const deviceModule = snapshot.modules.find((value) => value.moduleId === 'device-center');
    const deviceRoute = snapshot.activeRoute === 'device-center' && Boolean(deviceRenderer) &&
      deviceModule?.enabled === true;
    const creatorOpsModule = snapshot.modules.find((value) => value.moduleId === 'creator-ops');
    const creatorOpsRoute = snapshot.activeRoute === 'creator-ops' && Boolean(creatorOpsRenderer) &&
      creatorOpsModule?.enabled === true;
    const marketModule = snapshot.modules.find((value) => value.moduleId === 'market');
    const marketRoute = snapshot.activeRoute === 'market' && Boolean(marketRenderer) &&
      marketModule?.enabled === true;
    const starBenchModule = snapshot.modules.find((value) => value.moduleId === 'starbench');
    const starBenchRoute = snapshot.activeRoute === 'starbench' && Boolean(starBenchRenderer) &&
      starBenchModule?.enabled === true;
    const studyCenterModule = snapshot.modules.find((value) => value.moduleId === 'study-center');
    const studyCenterRoute = snapshot.activeRoute === 'study-center' && Boolean(studyCenterRenderer) &&
      studyCenterModule?.enabled === true;
    const nextUiModuleId = todayRoute ? 'today-tomorrow'
      : automationCenterRoute ? 'automation-center'
        : consumptionRoute ? 'consumption'
        : dashiRoute ? 'dashi'
          : deviceRoute ? 'device-center'
            : creatorOpsRoute ? 'creator-ops'
              : marketRoute ? 'market'
                : starBenchRoute ? 'starbench'
                  : studyCenterRoute ? 'study-center' : null;
    transitionActiveUiModule(nextUiModuleId);
    shell.classList.toggle('nexa-home-route', homeRoute);
    shell.classList.toggle('nexa-module-route', homeRoute || genericRoute || automationCenterRoute || consumptionRoute || todayRoute || dashiRoute ||
      deviceRoute || creatorOpsRoute || marketRoute || starBenchRoute || studyCenterRoute);
    const activePrimarySurface = homeRoute
      ? homeCompositionSurface
      : todayRoute
        ? null
      : genericRoute
        ? surface
        : automationCenterRoute
          ? automationCenterSurface
          : consumptionRoute
            ? consumptionSurface
          : dashiRoute
            ? dashiSurface
            : deviceRoute
              ? deviceSurface
              : creatorOpsRoute
                ? creatorOpsSurface
                : marketRoute ? marketSurface
                  : starBenchRoute ? starBenchSurface
                    : studyCenterRoute ? studyCenterSurface : null;
    primarySurfaceController.showOnly(activePrimarySurface);
    hostFactory.setSurfaceVisibility(daySurface, todayRoute);
    const activeSecondaryNavigation = todayRoute ? dayNavigation
      : dashiRoute ? dashiNavigation
        : deviceRoute ? deviceNavigation
          : marketRoute ? marketNavigation : null;
    secondaryNavigationController.showOnly(activeSecondaryNavigation);
    queueMicrotask(() => {
      activeSecondaryNavigation?.querySelector?.('[aria-current="page"]')
        ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    });
    if (todayRoute) {
      contextTitle.textContent = todayTomorrowRenderer.getView() === 'tomorrow'
        ? '明日'
        : todayTomorrowRenderer.getDate?.() || '今日';
    }
    if (genericRoute) {
      surfaceState.textContent = route?.moduleId
        ? projectedStatus(homeModuleState(route.moduleId))
        : hostStateLabel(snapshot.status);
      surfaceTitle.textContent = catalog.routeLabel(snapshot.activeRoute, locale());
      surfaceBody.textContent = routeCopy(snapshot.activeRoute, snapshot.status);
      surfaceSettings.classList.toggle('hidden', !route?.moduleId);
    }
    if (homeRoute && !consumptionHomeWidgetActive) {
      consumptionHomeWidgetActive = true;
      runRendererLifecycle('consumption', consumptionHomeWidgetRenderer, 'activate');
    } else if (!homeRoute && consumptionHomeWidgetActive) {
      consumptionHomeWidgetActive = false;
      runRendererLifecycle('consumption', consumptionHomeWidgetRenderer, 'deactivate');
    }
    if (homeRoute && !creatorOpsHomeWidgetActive) {
      creatorOpsHomeWidgetActive = true;
      runRendererLifecycle('creator-ops', creatorOpsHomeWidgetRenderer, 'activate');
    } else if (!homeRoute && creatorOpsHomeWidgetActive) {
      creatorOpsHomeWidgetActive = false;
      runRendererLifecycle('creator-ops', creatorOpsHomeWidgetRenderer, 'deactivate');
    }
    if (homeRoute && !homeOverviewActive) {
      homeOverviewActive = true;
      runRendererLifecycle('core-home-overview', homeOverviewRenderer, 'activate');
    } else if (!homeRoute && homeOverviewActive) {
      homeOverviewActive = false;
      runRendererLifecycle('core-home-overview', homeOverviewRenderer, 'deactivate');
    }
    if (dashiRoute) {
      const view = dashiRenderer.getState().view;
      contextTitle.textContent = ({ overview: '概览', projects: '项目', tasks: '任务', project: '项目' })[view] || 'Dashi任务板';
      contextStatus.textContent = runtimeLabel(dashiModule);
    }
    if (deviceRoute) {
      contextTitle.textContent = window.NexaDeviceCenterUiIntegrationHost?.VIEW_LABELS?.[deviceRenderer.getView()] || '设备与网络';
      contextStatus.textContent = runtimeLabel(deviceModule);
    }
    if (creatorOpsRoute) {
      contextTitle.textContent = '自媒体运营';
      contextStatus.textContent = runtimeLabel(creatorOpsModule);
    }
    if (marketRoute) {
      contextTitle.textContent = '股票市场';
      contextStatus.textContent = runtimeLabel(marketModule);
    }
    if (starBenchRoute) {
      contextTitle.textContent = '星测';
      contextStatus.textContent = productStateLabel(rendererPresentationStates.get('starbench')) || runtimeLabel(starBenchModule);
    }
    if (studyCenterRoute) {
      contextTitle.textContent = '学习中心';
      contextStatus.textContent = productStateLabel(rendererPresentationStates.get('study-center')) || runtimeLabel(studyCenterModule);
    }
    if (automationCenterRoute) {
      contextTitle.textContent = '自动化中心';
      contextStatus.textContent = productStateLabel(rendererPresentationStates.get('automation-center')) || runtimeLabel(automationCenterModule);
    }
    if (homeRoute) {
      const entries = catalog.listAssemblyModules(locale());
      const readyCount = entries.filter((entry) => homeModuleState(entry.moduleId) === 'READY').length;
      contextStatus.textContent = `${readyCount} / ${entries.length} 可用`;
    }
    if (snapshot.activeRoute === 'settings') {
      settingsPanel?.classList.remove('hidden');
      shell.classList.add('settings-open');
    } else {
      settingsPanel?.classList.add('hidden');
      shell.classList.remove('settings-open');
    }
  }

  function navigate(routeId) {
    const result = host.navigate(routeId);
    if (!result.ok && result.code === 'MODULE_DISABLED') {
      openSettings();
      return;
    }
    if (routeId !== 'dashi' && window.location.hash.startsWith('#/dashi')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId !== 'device-center' && window.location.hash.startsWith('#/device-center')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId === 'automation-center') {
      window.history.replaceState(window.history.state, '', '#/automation-center');
    } else if (window.location.hash.startsWith('#/automation-center')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId === 'calendar') {
      window.history.replaceState(window.history.state, '', '#/calendar');
    } else if (window.location.hash.startsWith('#/calendar')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId === 'creator-ops') {
      window.history.replaceState(window.history.state, '', '#/creator-ops');
    } else if (window.location.hash.startsWith('#/creator-ops')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId === 'market') {
      window.history.replaceState(window.history.state, '', '#/market');
    } else if (window.location.hash.startsWith('#/market')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId === 'starbench') {
      window.history.replaceState(window.history.state, '', '#/starbench');
    } else if (window.location.hash.startsWith('#/starbench')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    if (routeId === 'study-center') {
      window.history.replaceState(window.history.state, '', '#/study-center');
    } else if (window.location.hash.startsWith('#/study-center')) {
      window.history.replaceState(window.history.state, '', '#');
    }
    render();
    if (workspace) workspace.scrollTop = 0;
    void demandLoadRoute(routeId);
  }

  async function demandLoadRoute(routeId) {
    const snapshot = host.getSnapshot();
    const homeRoute = ['home', 'calendar'].includes(routeId);
    const loads = [];
    if (homeRoute && snapshot.modules.find((value) => value.moduleId === 'legacy-device')?.enabled) {
      loads.push(Promise.resolve().then(() => api['legacy-device'].getSnapshot()));
    }
    if (homeRoute && snapshot.modules.find((value) => value.moduleId === 'today-tomorrow')?.enabled) {
      loads.push(Promise.resolve().then(() => calendarHomeWidgetRenderer?.load()));
    }
    if (homeRoute) loads.push(Promise.resolve().then(() => loadMorningBriefing()));
    // One Home reader must never prevent another module's public summary from loading.
    await Promise.allSettled(loads);
    await refreshControl();
  }

  async function refreshControl() {
    try {
      host.updateControlSnapshot(await api.control.getSnapshot());
      settingsStatus.textContent = '';
    } catch (_) {
      host.updateControlSnapshot(null);
      settingsStatus.textContent = '模块控制暂不可用';
    }
    render();
  }

  async function mutate(action) {
    if (busy) return;
    busy = true;
    settingsStatus.textContent = '正在保存…';
    renderSettings(host.getSnapshot());
    try {
      const snapshot = await action();
      host.updateControlSnapshot(snapshot);
      settingsStatus.textContent = '已保存';
    } catch (_) {
      settingsStatus.textContent = '保存失败，已恢复最新状态';
      await refreshControl();
    } finally {
      busy = false;
      render();
    }
  }

  function handleLocalNavigationKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('button:not([disabled])')];
    if (buttons.length === 0) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowLeft' ? (current - 1 + buttons.length) % buttons.length
          : (current + 1) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }

  for (const button of document.querySelectorAll('[data-nexa-batch]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.nexaBatch;
      if (action === 'enable') void mutate(() => api.control.setAllEnabled(true));
      if (action === 'disable') void mutate(() => api.control.setAllEnabled(false));
      if (action === 'autostart-on') void mutate(() => api.control.setAllAutoStart(true));
      if (action === 'autostart-off') void mutate(() => api.control.setAllAutoStart(false));
    });
  }
  for (const button of document.querySelectorAll('[data-nexa-day-view]')) {
    button.addEventListener('click', () => {
      const view = button.dataset.nexaDayView;
      for (const candidate of document.querySelectorAll('[data-nexa-day-view]')) {
        candidate.setAttribute('aria-current', candidate === button ? 'page' : 'false');
      }
      contextTitle.textContent = view === 'tomorrow' ? '明日' : '今日';
      void todayTomorrowRenderer?.setView(view);
    });
  }
  for (const localNavigation of [dayNavigation, dashiNavigation, deviceNavigation, marketNavigation]) {
    localNavigation?.addEventListener('keydown', handleLocalNavigationKeydown);
  }
  surfaceSettings?.addEventListener('click', openSettings);
  document.getElementById('settingsButton')?.addEventListener('click', () => {
    queueMicrotask(() => {
      if (!settingsPanel?.classList.contains('hidden')) navigate('settings');
      else navigate('home');
    });
  });
  window.addEventListener('languagechange', render);
  window.addEventListener('beforeunload', () => {
    consumptionHomeWidgetRenderer?.dispose();
    calendarHomeWidgetRenderer?.dispose();
    creatorOpsHomeWidgetRenderer?.dispose();
    homeOverviewRenderer?.dispose();
    starBenchRenderer?.dispose();
    studyCenterRenderer?.dispose();
    globalCommandBar?.dispose();
    uiContextPreserver?.dispose();
  }, { once: true });
  compactNavigation.addEventListener('change', render);
  fallbackNavigation.addEventListener('change', render);
  installSettingsPageInteraction();
  initializeHomeLayoutPreferences();
  render();
  void refreshControl().then(() => demandLoadRoute(host.getSnapshot().activeRoute));
})();
