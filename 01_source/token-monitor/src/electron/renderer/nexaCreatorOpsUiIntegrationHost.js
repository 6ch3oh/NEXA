'use strict';

(function exposeNexaCreatorOpsUiIntegrationHost(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaCreatorOpsUiIntegrationHost = api;
})(typeof window !== 'undefined' ? window : null, function createCreatorOpsUiIntegrationHostApi(root) {
  const CONTRACT_VERSION = '1.0';

  function validReadiness(value) {
    const endpointValid = value?.endpoint?.host === '127.0.0.1' &&
      Number.isInteger(value.endpoint?.port) && typeof value.endpoint?.url === 'string';
    return value?.contractVersion === CONTRACT_VERSION && typeof value.ready === 'boolean' &&
      typeof value.state === 'string' &&
      (value.endpoint === null || endpointValid) &&
      value.ready === (value.state === 'READY' && endpointValid);
  }

  function createRenderer(options = {}) {
    const api = options.api;
    const surface = options.surface;
    const document = options.document || root?.document;
    const onContextChange = typeof options.onContextChange === 'function' ? options.onContextChange : () => {};
    const onPathHandoff = typeof options.onPathHandoff === 'function' ? options.onPathHandoff : () => {};
    const pathBridge = options.pathBridge;
    if (!api || !surface || !document || typeof api.start !== 'function' ||
        typeof api.getReadiness !== 'function' || typeof api.open !== 'function') {
      throw new TypeError('Creator Ops UI integration requires its safe facade, surface, and document');
    }
    let active = false;
    let generation = 0;
    let inFlight = null;
    let state = Object.freeze({ status: 'offline', code: 'CREATOR_OPS_NOT_STARTED' });
    let pathHandoffState = Object.freeze({ status: 'idle', request_kind: null, resource_count: 0 });
    let worksView = 'recent';
    let worksGrid = 9;
    let endpointUrl = null;
    let worksActivitySummary = null;

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function renderStatus(status, title, message, code, action, verifiedAt) {
      state = Object.freeze({ status, ...(code ? { code } : {}) });
      const panel = element('section', `nexa-creator-ops-panel nexa-creator-ops-${status}`);
      const header = element('header', 'nexa-creator-ops-header');
      const copy = element('div', 'nexa-creator-ops-header-copy');
      copy.append(
        element('span', 'nexa-creator-ops-kicker', '自媒体运营 · 本地工作区'),
        element('h1', '', title),
        element('p', '', message)
      );
      const headerActions = element('div', 'nexa-creator-ops-header-actions');
      headerActions.append(element('span', 'nexa-creator-ops-state', ({ ready: '可用', loading: '正在启动', offline: '服务未启动', error: '启动失败' })[status] || '不可用'));
      if (action) headerActions.append(action);
      header.append(copy, headerActions);
      panel.append(header);
      if (verifiedAt) panel.append(element('p', 'nexa-creator-ops-verified', `本地服务可用 · 验证时间 ${verifiedAt}`));
      if (code) {
        const diagnostics = element('details', 'nexa-creator-ops-diagnostics');
        const summary = element('summary', '', '查看诊断信息');
        diagnostics.append(summary, element('code', 'nexa-creator-ops-code', code));
        panel.append(diagnostics);
      }
      surface.replaceChildren(panel);
      onContextChange({ title: '自媒体运营', status: status.toUpperCase() });
    }

    function actionButton(label, handler) {
      const button = element('button', 'nexa-creator-ops-action', label);
      button.type = 'button';
      button.addEventListener('click', handler);
      return button;
    }

    function createReadyOverview() {
      const navigation = element('nav', 'nexa-creator-ops-context-rail');
      navigation.setAttribute('aria-label', '自媒体运营导航');
      for (const [label, selector] of [
        ['运行状态', '.nexa-creator-ops-overview'],
        ['作品', '.nexa-creator-works-wall'],
        ['本地素材', '.nexa-local-resource-drop-zone'],
        ['高级管理', '.nexa-creator-ops-header-actions']
      ]) {
        const button = actionButton(label, () => {
          surface.querySelector?.(selector)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        });
        navigation.append(button);
      }
      const overview = element('section', 'nexa-creator-ops-overview');
      const facts = [
        ['运行方式', '本地工作区'],
        ['帐号状态', '桌面安全接口未提供帐号字段'],
        ['作品活动', '正在读取本地作品…'],
        ['配置路径', '使用页面右上角“打开高级管理”']
      ];
      for (const [label, value] of facts) {
        const item = element('div', '');
        item.append(element('span', '', label), element('strong', '', value));
        overview.append(item);
        if (label === '作品活动') worksActivitySummary = item.children[1];
      }
      return { navigation, overview };
    }

    function hasPathBridge() {
      return pathBridge && ['selectFiles', 'selectDirectory', 'relocateFile', 'relocateDirectory',
        'resolveDroppedResources'].every((method) => typeof pathBridge[method] === 'function');
    }

    function createWorksPanel() {
      const pathBridgeAvailable = hasPathBridge();
      const handoff = element('section', 'nexa-local-resource-handoff');
      const status = element('p', 'nexa-local-resource-status', pathBridgeAvailable
        ? '尚未选择本地资源。'
        : '本地文件选择当前不可用；作品查看与作品集仍可使用。');
      const worksStatus = element('p', 'nexa-local-resource-status', '作品尚未读取。');
      const worksHeading = element('h2', '', '最近作品');
      const actions = element('div', 'nexa-local-resource-actions');
      const wall = element('section', `nexa-creator-works-wall nexa-creator-works-grid-${worksGrid}`);

      async function command(value) {
        const response = await api.executeWorksCommand(value);
        if (response?.ok !== true) throw Object.assign(new Error('Creator Ops Works command failed'), response?.error);
        return response.value;
      }

      function mediaUrl(mediaId, kind = 'thumbnail') {
        return `${endpointUrl}api/v1/works/media/${encodeURIComponent(mediaId)}/${kind}`;
      }

      async function renderList() {
        const viewLabels = { all: '全部作品', recent: '最近作品', portfolio: '我的作品集' };
        worksHeading.textContent = viewLabels[worksView] || '作品';
        for (const button of tabs.children) {
          const active = button.dataset.view === worksView;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        }
        worksStatus.className = 'nexa-local-resource-status is-loading';
        worksStatus.textContent = '正在读取作品…';
        wall.replaceChildren();
        let response;
        try {
          response = await api.queryWorks({ operation: 'list', view: worksView });
          if (response?.ok !== true) throw Object.assign(new Error('Creator Ops Works query failed'), response?.error);
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'CREATOR_OPS_WORKS_QUERY_FAILED';
          worksStatus.className = 'nexa-local-resource-status is-error';
          worksStatus.textContent = '作品读取失败，请重试。';
          const retry = actionButton('重试读取', () => { void renderList(); });
          const diagnostics = element('details', 'nexa-creator-ops-diagnostics');
          diagnostics.append(element('summary', '', '查看诊断信息'), element('code', 'nexa-creator-ops-code', code));
          wall.replaceChildren(retry, diagnostics);
          return false;
        }
        const items = Array.isArray(response.value?.items) ? response.value.items : [];
        worksStatus.className = 'nexa-local-resource-status is-ready';
        worksStatus.textContent = items.length ? `已读取 ${items.length} 个作品。` : '作品读取完成。';
        if (worksActivitySummary) {
          const latest = items.map((item) => new Date(item.created_at)).filter((date) => !Number.isNaN(date.getTime()))
            .sort((left, right) => right.getTime() - left.getTime())[0];
          worksActivitySummary.textContent = items.length
            ? `${items.length} 个作品${latest ? ` · 最近 ${latest.toLocaleDateString('zh-CN')}` : ''}`
            : '当前没有可显示的本地作品';
        }
        wall.className = `nexa-creator-works-wall nexa-creator-works-grid-${worksGrid}`;
        wall.replaceChildren();
        if (!items.length) {
          wall.append(element('p', 'nexa-creator-works-empty', worksView === 'recent'
            ? '最近 7 天没有按创建时期归入的作品。'
            : worksView === 'portfolio' ? '作品集中尚无作品。' : '当前没有作品。'));
          return true;
        }
        for (const work of items) {
          const cover = work.media?.find((item) => item.media_id === work.cover_media_id) || work.media?.[0];
          if (!cover) continue;
          const card = element('article', 'nexa-creator-work-card');
          const preview = element('button', 'nexa-creator-work-preview');
          preview.type = 'button';
          const image = element('img');
          image.src = mediaUrl(cover.media_id);
          image.alt = work.title || '本地作品';
          image.loading = 'lazy';
          preview.append(image, element('span', 'nexa-creator-work-count', `${work.media.length} 项`));
          preview.addEventListener('click', () => { void renderDetail(work.work_id); });
          const meta = element('div', 'nexa-creator-work-meta');
          const copy = element('div');
          copy.append(element('strong', '', work.title || '未命名作品'),
            element('small', '', new Date(work.created_at).toLocaleDateString('zh-CN')));
          const favorite = actionButton(work.portfolio ? '移出作品集' : '加入作品集', async () => {
            await command({ operation: 'portfolio', work_id: work.work_id, included: !work.portfolio });
            await renderList();
          });
          meta.append(copy, favorite);
          card.append(preview, meta);
          wall.append(card);
        }
        return true;
      }

      async function renderDetail(workId) {
        const response = await api.queryWorks({ operation: 'detail', work_id: workId });
        if (response?.ok !== true) throw Object.assign(new Error('Creator Ops Work detail failed'), response?.error);
        const work = response.value.work;
        let selected = work.media.find((item) => item.media_id === work.cover_media_id) || work.media[0];
        wall.className = 'nexa-creator-work-detail';
        wall.replaceChildren();
        const back = actionButton('← 返回作品墙', () => { void renderList(); });
        const title = element('h2', '', work.title);
        const stage = element('div', 'nexa-creator-work-stage');
        const strip = element('div', 'nexa-creator-work-strip');
        const detailActions = element('div', 'nexa-local-resource-actions');

        function show(media) {
          selected = media;
          stage.replaceChildren();
          if (media.location_state === 'MISSING') {
            stage.append(element('p', 'nexa-creator-works-empty', '原文件位置已变化，请重新定位。'));
          } else if (media.media_type === 'VIDEO') {
            const video = element('video', 'nexa-creator-work-main');
            video.controls = true; video.preload = 'metadata'; video.src = mediaUrl(media.media_id, 'content');
            stage.append(video);
          } else {
            const image = element('img', 'nexa-creator-work-main');
            image.src = mediaUrl(media.media_id, 'content'); image.alt = work.title;
            stage.append(image);
          }
          for (const button of strip.children) button.classList.toggle('active', button.dataset.mediaId === media.media_id);
          buildActions();
        }

        function buildActions() {
          detailActions.replaceChildren();
          if (selected.location_state === 'MISSING') {
            if (pathBridgeAvailable) {
              detailActions.append(actionButton('重新定位', async () => {
                const picked = await pathBridge.relocateFile();
                if (picked?.status !== 'selected') return;
                await command({ operation: 'relocate', media_id: selected.media_id,
                  absolute_path: picked.resources[0].absolute_path });
                await renderDetail(work.work_id);
              }));
            } else {
              detailActions.append(element('span', 'nexa-local-resource-status', '需要本地文件选择能力才能重新定位。'));
            }
          } else {
            detailActions.append(
              actionButton('打开原文件', () => command({ operation: 'open_original', media_id: selected.media_id })),
              actionButton('打开所在位置', () => command({ operation: 'open_location', media_id: selected.media_id }))
            );
            if (selected.media_type === 'VIDEO') {
              detailActions.append(actionButton('PotPlayer 观看', async () => {
                try { await command({ operation: 'open_potplayer', media_id: selected.media_id }); }
                catch (error) {
                  if (error?.code !== 'POTPLAYER_NOT_FOUND') throw error;
                  if (!pathBridgeAvailable) {
                    worksStatus.textContent = '尚未配置 PotPlayer，且本地文件选择当前不可用。';
                    return;
                  }
                  const picked = await pathBridge.relocateFile();
                  if (picked?.status !== 'selected') return;
                  await command({ operation: 'configure_potplayer', absolute_path: picked.resources[0].absolute_path });
                  await command({ operation: 'open_potplayer', media_id: selected.media_id });
                }
              }));
            }
          }
          detailActions.append(actionButton(work.portfolio ? '移出作品集' : '加入作品集', async () => {
            await command({ operation: 'portfolio', work_id: work.work_id, included: !work.portfolio });
            await renderDetail(work.work_id);
          }));
        }

        for (const media of work.media) {
          const thumb = element('button', 'nexa-creator-work-thumb');
          thumb.type = 'button'; thumb.dataset.mediaId = media.media_id;
          const image = element('img'); image.src = mediaUrl(media.media_id); image.alt = `${work.title} ${media.order_index + 1}`;
          thumb.append(image); thumb.addEventListener('click', () => show(media)); strip.append(thumb);
        }
        const permission = element('label', 'nexa-creator-move-permission');
        const toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = response.value.capabilities.move_permission === true;
        toggle.addEventListener('change', async () => {
          await command({ operation: 'move_permission', enabled: toggle.checked });
          await renderDetail(work.work_id);
        });
        permission.append(toggle, document.createTextNode(' 作品文件移动权限（本次运行有效，默认关闭）'));
        const move = actionButton('移动到自媒体作品', async () => {
          await command({ operation: 'move_managed', work_id: work.work_id, explicit_user_intent: true });
          await renderDetail(work.work_id);
        });
        move.disabled = !toggle.checked || !work.media.some((item) => item.location_state === 'EXTERNAL');
        wall.append(back, title, stage, strip, detailActions, permission, move);
        show(selected);
      }

      async function handle(request) {
        status.textContent = '正在等待用户选择…';
        let result;
        try {
          result = await request();
        } catch {
          result = { status: 'error', request_kind: 'unknown', resources: [], error: { code: 'PATH_BRIDGE_FAILED' } };
        }
        const count = Array.isArray(result?.resources) ? result.resources.length : 0;
        pathHandoffState = Object.freeze({
          status: result?.status || 'error',
          request_kind: result?.request_kind || 'unknown',
          resource_count: count
        });
        if (result?.status === 'selected') {
          await command({ operation: 'intake', resources: result.resources });
          status.textContent = `已收录 ${count} 个本地资源；未复制内容。`;
          onPathHandoff(result);
          await renderList();
        } else if (result?.status === 'cancelled') {
          status.textContent = '已取消，未产生路径。';
        } else {
          status.textContent = `路径交接失败（${result?.error?.code || 'PATH_BRIDGE_FAILED'}）。`;
        }
        return result;
      }

      if (pathBridgeAvailable) {
        for (const [label, request] of [
          ['选择单个文件', () => pathBridge.selectFiles()],
          ['选择多个文件', () => pathBridge.selectFiles({ multiple: true })],
          ['选择文件夹', () => pathBridge.selectDirectory()]
        ]) {
          actions.append(actionButton(label, () => handle(request)));
        }
      }

      const dropZone = element('div', 'nexa-local-resource-drop-zone', '将 Windows Explorer 文件或文件夹拖到这里');
      dropZone.setAttribute('role', 'button');
      dropZone.setAttribute('tabindex', '0');
      if (pathBridgeAvailable) {
        dropZone.addEventListener('dragover', (event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        });
        dropZone.addEventListener('drop', (event) => {
          event.preventDefault();
          const files = event.dataTransfer?.files ? [...event.dataTransfer.files] : [];
          void handle(() => pathBridge.resolveDroppedResources(files));
        });
        dropZone.addEventListener('click', () => { void handle(() => pathBridge.selectFiles({ multiple: true })); });
      } else {
        dropZone.hidden = true;
      }
      const tabs = element('nav', 'nexa-creator-works-tabs');
      for (const [view, label] of [['all', '全部'], ['recent', '最近'], ['portfolio', '作品集']]) {
        const tab = actionButton(label, async () => { worksView = view; await renderList(); });
        tab.dataset.view = view; tabs.append(tab);
      }
      const grids = element('div', 'nexa-creator-works-grids');
      for (const size of [4, 9, 16]) {
        const choice = actionButton(`${size}宫格`, () => {
          worksGrid = size;
          wall.className = `nexa-creator-works-wall nexa-creator-works-grid-${worksGrid}`;
          for (const button of grids.children) button.classList.toggle('active', button.dataset.grid === String(size));
        });
        choice.dataset.grid = String(size);
        choice.classList.toggle('active', size === worksGrid);
        grids.append(choice);
      }
      handoff.append(
        tabs,
        worksHeading,
        element('p', '', '最近按媒体创建时期计算为 7 天；收录只保存路径与作品关系。'),
        ...(pathBridgeAvailable ? [actions, dropZone] : []),
        status,
        worksStatus,
        grids,
        wall
      );
      void renderList();
      return handoff;
    }

    function renderReadiness(readiness) {
      if (!validReadiness(readiness)) {
        renderStatus('error', '自媒体运营不可用', '本地服务返回了无效的就绪状态。', 'INVALID_CREATOR_OPS_READINESS');
        return;
      }
      if (readiness.ready && readiness.endpoint) {
        const open = actionButton('打开高级管理', async () => {
          open.disabled = true;
          try {
            const result = await api.open();
            if (result?.ok !== true) throw Object.assign(new Error('open failed'), result?.error);
          } catch (error) {
            renderStatus('error', '无法打开自媒体运营', '浏览器入口交接失败，请重试。',
              error?.code || 'CREATOR_OPS_OPEN_FAILED', open);
          } finally { open.disabled = false; }
        });
        const now = typeof options.now === 'function' ? options.now() : new Date();
        const verifiedAt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(now);
        renderStatus('ready', '自媒体运营', '内容运营工作区由本地服务提供，并在系统浏览器中打开。', null, open, verifiedAt);
        endpointUrl = readiness.endpoint.url;
        const readyOverview = createReadyOverview();
        surface.children[0].append(readyOverview.navigation, readyOverview.overview);
        const handoff = createWorksPanel();
        if (handoff) surface.children[0].append(handoff);
        return;
      }
      const code = readiness.errorCode || `CREATOR_OPS_${readiness.state}`;
      const retry = actionButton('重试', () => { void activate(); });
      renderStatus(readiness.state === 'ERROR' ? 'error' : 'offline',
        readiness.state === 'ERROR' ? 'Creator Host 启动失败' : 'Creator Host 服务未启动',
        readiness.state === 'ERROR'
          ? '正式生命周期未能启动本地服务；可重试并查看安全故障码。'
          : '本地服务尚未运行；进入本页时会由正式生命周期自然启动，无需手动运行 Python。', code, retry);
    }

    async function run(load) {
      if (inFlight) return inFlight;
      const current = ++generation;
      renderStatus('loading', '正在启动自媒体运营…', '正在等待本地工作区就绪。');
      inFlight = Promise.resolve().then(load).then((result) => {
        if (!active || current !== generation) return;
        if (result?.ok !== true) {
          const code = result?.error?.code || 'CREATOR_OPS_REQUEST_FAILED';
          renderStatus('error', 'Creator Host 启动失败', '正式生命周期未能启动本地服务。', code,
            actionButton('重试', () => { void activate(); }));
          return;
        }
        renderReadiness(result.value);
      }).catch((error) => {
        if (!active || current !== generation) return;
        renderStatus('error', 'Creator Host 启动失败', '正式生命周期未能启动本地服务。',
          error?.code || 'CREATOR_OPS_REQUEST_FAILED', actionButton('重试', () => { void activate(); }));
      }).finally(() => { inFlight = null; });
      return inFlight;
    }

    function activate() {
      active = true;
      return run(() => api.start());
    }

    function deactivate() {
      active = false;
      generation += 1;
    }

    function load() {
      active = true;
      return run(() => api.getReadiness()).then(() => {
        if (active && state.status === 'offline') return run(() => api.start());
        return undefined;
      });
    }

    function unmount() {
      deactivate();
      surface.replaceChildren();
      return true;
    }

    return Object.freeze({
      activate,
      deactivate,
      getPathHandoffState: () => pathHandoffState,
      getState: () => state,
      load,
      unmount
    });
  }

  return Object.freeze({ CONTRACT_VERSION, createRenderer });
});
