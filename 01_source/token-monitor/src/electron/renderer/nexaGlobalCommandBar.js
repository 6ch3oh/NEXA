'use strict';

(function initNexaGlobalCommandBar(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.NexaGlobalCommandBar = api;
})(typeof globalThis === 'object' ? globalThis : this, function nexaGlobalCommandBarFactory() {
  const ROUTE_LABELS = Object.freeze({
    home: '首页', cost: '消费中心', calendar: '日历管家', 'automation-center': '自动化中心',
    'study-center': '学习中心', 'device-center': '设备与网络', market: '股票市场',
    'creator-ops': '自媒体运营', dashi: 'Dashi任务板', starbench: '星测', settings: '设置',
  });

  function text(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function createElement(document, tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = String(value);
    return element;
  }

  function unwrapTotal(value) {
    const totals = value?.totals;
    if (!totals || !Number.isFinite(totals.totalExpenseCents)) return null;
    return Object.freeze({ amount: totals.totalExpenseCents / 100, count: Number(totals.count) || 0 });
  }

  function insertTranscript(current, transcript, selectionStart, selectionEnd) {
    const safeCurrent = typeof current === 'string' ? current : '';
    const safeTranscript = text(transcript);
    const start = Number.isInteger(selectionStart) ? Math.max(0, Math.min(selectionStart, safeCurrent.length)) : safeCurrent.length;
    const end = Number.isInteger(selectionEnd) ? Math.max(start, Math.min(selectionEnd, safeCurrent.length)) : start;
    const prefix = safeCurrent.slice(0, start); const suffix = safeCurrent.slice(end);
    const spacerBefore = prefix && !/\s$/u.test(prefix) ? ' ' : '';
    const spacerAfter = suffix && !/^\s/u.test(suffix) ? ' ' : '';
    return `${prefix}${spacerBefore}${safeTranscript}${spacerAfter}${suffix}`.slice(0, 2000);
  }

  function createGlobalCommandBar({ api, elements, getContext = () => ({}), onNavigate = () => {}, onRequestHome = () => {}, copyText = null } = {}) {
    if (!api || typeof api.submit !== 'function' || !elements?.form || !elements?.input || !elements?.result) {
      throw new TypeError('Global Command Bar requires its public bridge and fixed DOM elements');
    }
    const document = elements.form.ownerDocument;
    let disposed = false;
    let busy = false;
    let active = null;
    let focusContext = {};
    let highRiskArmed = false;
    let recorder = null;
    let microphoneStream = null;
    let recordedChunks = [];
    let recordingCancelled = false;
    let panelState = 'collapsed';
    let homeActive = true;
    let panelReturnFocus = null;
    let providerRetryTimer = null;
    let providerRefreshPromise = null;
    const PROVIDER_RETRY_MS = 15_000;

    function setMicrophoneState(state, label) {
      if (!elements.mic) return;
      elements.mic.dataset.state = state;
      elements.mic.setAttribute('aria-pressed', state === 'listening' ? 'true' : 'false');
      elements.mic.textContent = label;
      elements.mic.title = ({ idle: '本地语音输入', listening: '正在聆听；再次点击停止', transcribing: '正在本地转写' })[state] || label;
    }

    async function finishRecording() {
      const chunks = recordedChunks; recordedChunks = [];
      const cancelled = recordingCancelled; recordingCancelled = false;
      microphoneStream?.getTracks?.().forEach((track) => track.stop());
      microphoneStream = null; recorder = null;
      if (cancelled || chunks.length === 0) { setMicrophoneState('idle', '🎙'); return; }
      setMicrophoneState('transcribing', '转写中');
      try {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        const response = await api.transcribeAudio({ bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type });
        elements.input.value = insertTranscript(elements.input.value, response?.transcript, elements.input.selectionStart, elements.input.selectionEnd);
        elements.input.focus();
      } catch (_) {
        elements.result.replaceChildren(resultHeader('本地语音待配置', 'STT_PROVIDER_READY_GAP'), createElement(document, 'p', '', '录音未上传；批准本地语音模型后即可转写。'));
        setPanelState('result');
      } finally { setMicrophoneState('idle', '🎙'); }
    }

    async function startRecording() {
      if (!elements.mic || recorder) return;
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = []; recordingCancelled = false;
        recorder = new MediaRecorder(microphoneStream);
        recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) recordedChunks.push(event.data); });
        recorder.addEventListener('stop', () => { void finishRecording(); }, { once: true });
        recorder.start();
        setMicrophoneState('listening', '停止');
      } catch (_) {
        setMicrophoneState('idle', '🎙');
        elements.result.replaceChildren(resultHeader('麦克风不可用', 'PERMISSION_REQUIRED'), createElement(document, 'p', '', '请在 Windows 隐私设置中允许本应用访问麦克风。'));
        setPanelState('result');
      }
    }

    function stopRecording(cancel = false) {
      if (!recorder) return false;
      recordingCancelled = cancel;
      if (recorder.state !== 'inactive') recorder.stop();
      return true;
    }

    function toggleRecording() { if (recorder) stopRecording(false); else void startRecording(); }

    function setPanelState(state) {
      panelState = state;
      elements.root?.setAttribute('data-panel-state', state);
      elements.history?.setAttribute('aria-expanded', state === 'history' ? 'true' : 'false');
      setResultVisible(state !== 'collapsed' && state !== 'input');
    }

    function setResultVisible(visible) {
      elements.result.hidden = !visible;
      elements.result.classList.toggle('hidden', !visible);
    }

    function resultHeader(title, meta) {
      const header = createElement(document, 'header', 'nexa-global-command-result-header');
      const close = createElement(document, 'button', 'nexa-global-command-panel-close', '关闭');
      close.type = 'button';
      close.setAttribute('aria-label', '关闭命令面板');
      close.addEventListener('click', () => closeResult());
      const trailing = createElement(document, 'span', 'nexa-global-command-result-meta');
      trailing.append(createElement(document, 'span', '', meta), close);
      header.append(createElement(document, 'strong', '', title), trailing);
      return header;
    }

    function diagnosticReport(response) {
      return JSON.stringify({
        diagnostic_id: response?.diagnostic_id || null,
        problem: text(response?.message, '命令未完成。'),
        failed_stage: response?.failed_stage || '尚未定位',
        business_write_state: response?.business_write_state || 'UNKNOWN',
        suggested_action: response?.suggested_action || '请稍后重试。',
        technical_details: response?.diagnostic || null,
      }, null, 2);
    }

    function appendDiagnosticDetails(response) {
      const writeLabels = { NONE: '未产生业务写入', CONFIRMED: '业务写入已确认', UNKNOWN: '执行结果待确认' };
      elements.result.append(createElement(document, 'p', 'nexa-global-command-problem', `失败环节：${response?.failed_stage || '尚未定位'} · ${writeLabels[response?.business_write_state] || '写入状态未知'} · 诊断编号：${response?.diagnostic_id || '未生成'}`));
      elements.result.append(createElement(document, 'p', '', text(response?.suggested_action, '请稍后重试。')));
      const details = createElement(document, 'details', 'nexa-global-command-diagnostics');
      details.append(createElement(document, 'summary', '', '查看技术详情'));
      details.append(createElement(document, 'pre', '', diagnosticReport(response)));
      const copy = createElement(document, 'button', 'nexa-global-command-secondary', '复制脱敏诊断报告');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        try {
          if (typeof copyText === 'function') await copyText(diagnosticReport(response));
          else await navigator.clipboard.writeText(diagnosticReport(response));
          copy.textContent = '已复制';
        } catch (_) { copy.textContent = '复制失败'; }
      });
      details.append(copy);
      elements.result.append(details);
    }

    async function renderAndReport(response) {
      try {
        renderSubmission(response);
        if (response?.diagnostic_id && typeof api.reportFeedback === 'function') await api.reportFeedback(response.diagnostic_id, 'rendered');
      } catch (error) {
        if (response?.diagnostic_id && typeof api.reportFeedback === 'function') await api.reportFeedback(response.diagnostic_id, 'render_failed').catch(() => {});
        throw error;
      }
    }

    function closeResult() {
      active = null;
      highRiskArmed = false;
      elements.result.replaceChildren();
      setPanelState(document.activeElement === elements.input ? 'input' : 'collapsed');
      const focusTarget = panelReturnFocus;
      panelReturnFocus = null;
      focusTarget?.focus?.();
    }

    async function confirmActive() {
      if (!active?.proposal_id || busy) return;
      const highRisk = active.proposal?.capability?.classification === 'high_risk' ||
        active.plan?.steps?.some((step) => step.metadata?.risk_class === 'HIGH_RISK');
      if (highRisk && !highRiskArmed) {
        highRiskArmed = true;
        const warning = createElement(document, 'p', 'nexa-global-command-warning', '这是高风险操作。请再次点击确认；也可以取消。');
        elements.result.append(warning);
        return;
      }
      busy = true;
      try {
        const response = await api.confirm(active.proposal_id, { confirmed: true, highRiskConfirmed: highRiskArmed });
        const feedback = Object.freeze({
          ...response,
          message: response?.ok ? '已通过模块既有合同执行。' : text(response?.message, '操作未执行。'),
        });
        elements.result.replaceChildren(
          resultHeader(response?.ok ? '命令已确认' : '未能执行', response?.code || response?.status || ''),
          createElement(document, 'p', '', feedback.message),
        );
        if (!response?.ok) appendDiagnosticDetails(feedback);
        if (response?.diagnostic_id && typeof api.reportFeedback === 'function') await api.reportFeedback(response.diagnostic_id, 'rendered');
        active = null;
        setPanelState('result');
      } finally { busy = false; }
    }

    async function cancelActive() {
      if (!active?.proposal_id || busy) return;
      busy = true;
      try {
        await api.cancel(active.proposal_id);
        elements.result.replaceChildren(resultHeader('已取消', 'REAL_WRITE = 0'), createElement(document, 'p', '', '草稿已取消，没有发生写入。'));
        active = null;
        setPanelState('result');
      } finally { busy = false; }
    }

    function appendProposalActions() {
      const actions = createElement(document, 'div', 'nexa-global-command-actions');
      const confirm = createElement(document, 'button', '', '确认');
      confirm.type = 'button';
      confirm.addEventListener('click', () => { void confirmActive(); });
      const cancel = createElement(document, 'button', 'nexa-global-command-secondary', '取消');
      cancel.type = 'button';
      cancel.addEventListener('click', () => { void cancelActive(); });
      actions.append(confirm, cancel);
      elements.result.append(actions);
    }

    function renderSubmission(response) {
      active = response;
      highRiskArmed = false;
      elements.result.replaceChildren();
      setPanelState('result');
      if (!response?.ok) {
        elements.result.append(resultHeader('命令未完成', response?.code || 'GLOBAL_COMMAND_FAILED'), createElement(document, 'p', '', text(response?.message, '未发生任何写入。')));
        appendDiagnosticDetails(response);
        return;
      }
      const proposal = response.proposal || { domain: 'multi_step', action: 'plan', intent: response.plan?.intent || '多步骤计划', parameters: {} };
      const outcome = response.outcome || {};
      if (outcome.type === 'navigation') {
        const routeId = outcome.route_id;
        elements.result.append(resultHeader('正在打开', ROUTE_LABELS[routeId] || routeId || '目标页面'));
        if (routeId) onNavigate(routeId);
        return;
      }
      if (outcome.type === 'clarification') {
        elements.result.append(resultHeader('需要补充信息', '不会写入'), createElement(document, 'p', '', text(outcome.question, '请把时间或对象说得更明确一些。')));
        return;
      }
      if (outcome.type === 'unavailable') {
        elements.result.append(resultHeader('能力暂不可用', outcome.code || ''), createElement(document, 'p', '', '已识别命令，但当前模块没有稳定的公开适配器。'));
        return;
      }
      if (['plan_preview', 'plan_result'].includes(outcome.type)) {
        const preview = outcome.type === 'plan_preview';
        if (preview) setPanelState('pending_confirmation');
        elements.result.append(resultHeader(preview ? '计划待确认' : '计划已完成', `${outcome.steps?.length || 0} 步`));
        const list = createElement(document, 'ol', 'nexa-global-command-changes');
        for (const step of outcome.steps || []) {
          const state = step.outcome?.type === 'unavailable' ? '暂不可用'
            : step.outcome?.type === 'proposal' ? '待确认' : '已读取';
          list.append(createElement(document, 'li', '', `${step.capability} · ${state}`));
        }
        elements.result.append(list);
        if (preview) {
          elements.result.append(createElement(document, 'p', '', text(outcome.confirmation_summary, '确认后才会执行写步骤。')));
          appendProposalActions();
        }
        return;
      }
      if (outcome.type === 'result') {
        const total = unwrapTotal(outcome.value);
        elements.result.append(resultHeader('查询完成', `${proposal.domain} · ${proposal.action}`));
        if (total) elements.result.append(createElement(document, 'p', 'nexa-global-command-metric', `¥${total.amount.toFixed(2)} · ${total.count} 笔`));
        else elements.result.append(createElement(document, 'p', '', '结果已由模块本地确定性数据层返回。'));
        if (proposal.domain === 'consumption') {
          const actions = createElement(document, 'div', 'nexa-global-command-actions');
          const open = createElement(document, 'button', 'nexa-global-command-secondary', '查看消费中心');
          open.type = 'button';
          open.addEventListener('click', () => onNavigate('cost'));
          actions.append(open);
          elements.result.append(actions);
        }
        return;
      }
      const value = outcome.value || {};
      setPanelState('pending_confirmation');
      elements.result.append(resultHeader(text(value.summary, proposal.intent || '待确认变更'), `${proposal.domain} · ${proposal.action}`));
      const changes = Array.isArray(value.operations) ? value.operations : [];
      if (changes.length) {
        const list = createElement(document, 'ul', 'nexa-global-command-changes');
        for (const item of changes) list.append(createElement(document, 'li', '', text(item.change_summary, item.command_type)));
        elements.result.append(list);
      } else {
        const params = proposal.parameters || {};
        elements.result.append(createElement(document, 'p', '', [params.title, params.date || params.start_at, params.duration_minutes ? `${params.duration_minutes} 分钟` : ''].filter(Boolean).join(' · ') || '确认后才会交给模块执行。'));
      }
      appendProposalActions();
    }

    async function submit() {
      const request = elements.input.value.trim();
      if (!request || busy) return;
      busy = true;
      setPanelState('executing');
      elements.result.replaceChildren(resultHeader('正在处理', elements.model?.selectedOptions?.[0]?.textContent || '本地模型'));
      elements.submit.disabled = true;
      elements.submit.textContent = '理解中…';
      try {
        const context = { ...getContext(), ...focusContext };
        focusContext = {};
        const response = await api.submit({ request, context });
        await renderAndReport(response);
      } catch (_) {
        renderSubmission({ ok: false, code: 'GLOBAL_COMMAND_UNAVAILABLE', message: '共享本地 AI 暂不可用；未发生任何写入。' });
      } finally {
        busy = false;
        elements.submit.disabled = false;
        elements.submit.textContent = '执行';
      }
    }

    async function showHistory() {
      if (busy) return;
      if (panelState === 'history') {
        closeResult();
        return;
      }
      panelReturnFocus = elements.history;
      try {
        const history = await api.listHistory();
        elements.result.replaceChildren(resultHeader('最近命令', `${history.length} / 20`));
        const list = createElement(document, 'ol', 'nexa-global-command-history-list');
        for (const item of history.slice(0, 8)) {
          list.append(createElement(document, 'li', '', `${item.command_text} · ${item.domain}/${item.action} · ${item.execution_status}`));
        }
        if (history.length === 0) list.append(createElement(document, 'li', '', '暂无本次运行中的命令记录。'));
        const clear = createElement(document, 'button', 'nexa-global-command-secondary', '清空最近命令');
        clear.type = 'button';
        clear.addEventListener('click', async () => { await api.clearHistory(); await showHistory(); });
        elements.result.append(list, clear);
        setPanelState('history');
      } catch (_) {
        renderSubmission({ ok: false, code: 'HISTORY_UNAVAILABLE', message: '最近命令暂不可用。' });
      }
    }

    function focus(patch = {}) {
      focusContext = patch && typeof patch === 'object' ? { ...patch } : {};
      onRequestHome();
      queueMicrotask(() => {
        setPanelState('input');
        elements.input.focus();
        elements.input.select();
      });
    }

    function setHomeActive(value) {
      homeActive = value === true;
      if (elements.root) {
        elements.root.hidden = !homeActive;
        elements.root.classList.toggle('hidden', !homeActive);
      }
      if (homeActive) void refreshProviderState();
      return homeActive;
    }

    function modelCapabilityTitle(model) {
      const labels = { available: '可用', unavailable: '不支持', unverified: '未验证' };
      const capabilities = model?.capabilities || {};
      return `服务已列出；加载状态：${model?.loaded === true ? '已验证' : '未知'}；普通对话：${labels[capabilities.ordinary_chat] || '未验证'}；结构化命令：${labels[capabilities.structured_command] || '未验证'}；工具调用：${labels[capabilities.tool_calling] || '未验证'}；视觉：${labels[capabilities.vision] || '未验证'}`;
    }

    function renderModels(models, selectedModelId) {
      if (!elements.model) return;
      const records = Array.isArray(models) ? models : [];
      elements.model.replaceChildren();
      if (records.length === 0) {
        const option = createElement(document, 'option', '', '未连接模型服务');
        option.value = '';
        elements.model.append(option);
        elements.model.disabled = true;
        elements.model.title = '本地模型列表暂不可用';
        return;
      }
      for (const model of records) {
        const option = createElement(document, 'option', '', text(model.display_name, model.id));
        option.value = model.id;
        option.title = modelCapabilityTitle(model);
        option.selected = model.id === selectedModelId || model.selected === true;
        elements.model.append(option);
      }
      elements.model.disabled = busy;
      elements.model.title = modelCapabilityTitle(records.find((model) => model.id === elements.model.value));
    }

    function cancelProviderRetry() {
      if (!providerRetryTimer) return;
      clearTimeout(providerRetryTimer);
      providerRetryTimer = null;
    }

    function scheduleProviderRetry() {
      if (disposed || providerRetryTimer) return;
      providerRetryTimer = setTimeout(() => {
        providerRetryTimer = null;
        void refreshProviderState();
      }, PROVIDER_RETRY_MS);
    }

    async function refreshProviderState({ refreshModels = true } = {}) {
      if (providerRefreshPromise) return providerRefreshPromise;
      providerRefreshPromise = (async () => {
        try {
          const state = await api.getState();
          const ready = state?.provider?.can_propose === true;
          elements.readiness.textContent = ready ? 'Local AI 就绪' : 'Local AI 暂不可用';
          elements.readiness.dataset.state = ready ? 'ready' : 'unavailable';
          const models = refreshModels && typeof api.listModels === 'function'
            ? await api.listModels() : state?.provider?.models;
          renderModels(models, state?.provider?.model_id);
          if (ready && Array.isArray(models) && models.length > 0) cancelProviderRetry();
          else scheduleProviderRetry();
        } catch (_) {
          elements.readiness.textContent = 'Local AI 暂不可用';
          elements.readiness.dataset.state = 'unavailable';
          renderModels([], null);
          scheduleProviderRetry();
        }
      })();
      try {
        await providerRefreshPromise;
      } finally {
        providerRefreshPromise = null;
      }
    }

    async function handleModelChange() {
      const modelId = elements.model?.value;
      if (!modelId || busy || typeof api.selectModel !== 'function') return;
      elements.model.disabled = true;
      elements.readiness.textContent = '正在切换本地模型';
      elements.readiness.dataset.state = 'checking';
      try {
        const provider = await api.selectModel(modelId);
        const settingsModelInput = document.getElementById('calendarLocalAiModelIdInput');
        if (settingsModelInput) settingsModelInput.value = provider?.model_id || modelId;
        await refreshProviderState({ refreshModels: false });
      } catch (_) {
        elements.readiness.textContent = '模型切换失败';
        elements.readiness.dataset.state = 'unavailable';
        await refreshProviderState({ refreshModels: false });
      } finally { if (elements.model?.options?.length) elements.model.disabled = false; }
    }

    function handleSubmit(event) { event.preventDefault(); void submit(); }
    function handleKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        focus();
      } else if (event.key === 'Escape' && recorder) {
        event.preventDefault(); stopRecording(true);
      } else if (event.key === 'Escape' && panelState !== 'collapsed' && panelState !== 'input') {
        event.preventDefault();
        closeResult();
      }
    }
    function handleHistoryClick() { void showHistory(); }
    function handleDocumentPointerDown(event) {
      if (!homeActive || !elements.root || elements.root.contains(event.target)) return;
      if (['history', 'result'].includes(panelState)) closeResult();
    }
    elements.form.addEventListener('submit', handleSubmit);
    elements.history.addEventListener('click', handleHistoryClick);
    elements.model?.addEventListener('change', handleModelChange);
    elements.mic?.addEventListener('click', toggleRecording);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    void refreshProviderState();
    if (elements.mic && typeof api.getSpeechState === 'function') {
      Promise.resolve(api.getSpeechState()).then((state) => {
        elements.mic.dataset.provider = state?.can_transcribe ? 'ready' : 'provider_ready_gap';
        setMicrophoneState('idle', '🎙');
      }).catch(() => { elements.mic.dataset.provider = 'provider_ready_gap'; });
    }

    return Object.freeze({
      focus, setHomeActive,
      dispose() {
        if (disposed) return false;
        disposed = true;
        elements.form.removeEventListener('submit', handleSubmit);
        elements.history.removeEventListener('click', handleHistoryClick);
        elements.model?.removeEventListener('change', handleModelChange);
        elements.mic?.removeEventListener('click', toggleRecording);
        cancelProviderRetry();
        stopRecording(true);
        document.removeEventListener('keydown', handleKeydown);
        document.removeEventListener('pointerdown', handleDocumentPointerDown);
        return true;
      },
    });
  }

  return Object.freeze({ createGlobalCommandBar, insertTranscript, unwrapTotal });
});
