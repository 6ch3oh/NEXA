'use strict';

(function initializeMobilePairingRenderer(root) {
  const api = root.tokenMonitor?.nexa?.['mobile-pairing'];
  const panel = document.getElementById('mobilePairingPanel');
  if (!api || !panel) return;

  const elements = {
    status: document.getElementById('mobilePairingStatus'),
    endpoint: document.getElementById('mobilePairingEndpoint'),
    fingerprint: document.getElementById('mobilePairingFingerprint'),
    certificateExpiry: document.getElementById('mobilePairingCertificateExpiry'),
    start: document.getElementById('mobilePairingStart'),
    cancel: document.getElementById('mobilePairingCancel'),
    rotate: document.getElementById('mobilePairingRotateCertificate'),
    qrArea: document.getElementById('mobilePairingQrArea'),
    qr: document.getElementById('mobilePairingQr'),
    countdown: document.getElementById('mobilePairingCountdown'),
    claim: document.getElementById('mobilePairingClaim'),
    device: document.getElementById('mobilePairingDevice'),
    sas: document.getElementById('mobilePairingSas'),
    allow: document.getElementById('mobilePairingAllow'),
    reject: document.getElementById('mobilePairingReject'),
    message: document.getElementById('mobilePairingMessage'),
    deviceList: document.getElementById('mobilePairingDeviceList'),
    awarenessAttention: document.getElementById('mobileAwarenessAttention'),
    awarenessReason: document.getElementById('mobileAwarenessReason'),
    awarenessFreshness: document.getElementById('mobileAwarenessFreshness'),
    awarenessConnection: document.getElementById('mobileAwarenessConnection'),
    awarenessUpdated: document.getElementById('mobileAwarenessUpdated'),
    awarenessIdentity: document.getElementById('mobileAwarenessIdentity'),
    awarenessVersion: document.getElementById('mobileAwarenessVersion'),
    awarenessTransport: document.getElementById('mobileAwarenessTransport'),
    awarenessSync: document.getElementById('mobileAwarenessSync'),
    awarenessPending: document.getElementById('mobileAwarenessPending'),
    awarenessCapture: document.getElementById('mobileAwarenessCapture'),
    awarenessDetails: document.getElementById('mobileAwarenessDetailList'),
    awarenessRefresh: document.getElementById('mobileAwarenessRefresh')
  };
  let pairingId = '';
  let pairingState = 'NOT_STARTED';
  let pollTimer = null;
  let devicePollTimer = null;
  let awarenessPollTimer = null;
  let latestAwarenessDeviceId = '';
  let latestAwarenessConnectionState = '';
  const terminal = new Set(['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'CONSUMED']);
  const hostStartupAttempts = 50;
  const hostStartupPollMs = 100;
  const repairStorageKey = 'nexa.mobile-pairing.repair-required.v1';
  let repairRequired = root.localStorage?.getItem(repairStorageKey) === '1';

  function setRepairRequired(value) {
    repairRequired = Boolean(value);
    if (repairRequired) root.localStorage?.setItem(repairStorageKey, '1');
    else root.localStorage?.removeItem(repairStorageKey);
  }

  const sessionPresentation = Object.freeze({
    NOT_STARTED: '等待首次配对',
    PENDING: '等待首次配对',
    CLAIMED: '已发现手机',
    BOTH_CONFIRMED: '正在建立信任',
    DELIVERED: '正在完成配对',
    COMPLETED: '已建立可信设备',
    CANCELLED: '配对已取消',
    EXPIRED: '需要重新配对',
    FAILED: '需要重新配对',
    CONSUMED: '需要重新配对'
  });

  function deviceStatePresentation(state) {
    if (state === 'CONNECTED') return '已连接';
    if (state === 'DISCOVERED') return '已发现已配对手机';
    if (state === 'CONNECTING') return '正在连接';
    if (state === 'RECONNECTING') return '正在重连';
    if (state === 'NETWORK_CHANGED') return '网络发生变化，正在重新寻找';
    if (state === 'OFFLINE') return '手机离线';
    if (state === 'NEEDS_REPAIRING') return '需要重新配对';
    return '正在寻找已配对手机';
  }

  function isLatestAwarenessDevice(device) {
    if (!latestAwarenessDeviceId || !latestAwarenessConnectionState) return false;
    const summary = latestAwarenessDeviceId.length <= 16
      ? latestAwarenessDeviceId
      : `${latestAwarenessDeviceId.slice(0, 8)}…${latestAwarenessDeviceId.slice(-6)}`;
    return device?.device_id_summary === summary;
  }

  function localizedDateTime(value, fallback) {
    if ((typeof value !== 'string' || !value.trim()) && !Number.isFinite(value)) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function renderAwareness(model) {
    const overview = model?.overview || {};
    const details = model?.details || {};
    latestAwarenessDeviceId = overview.mobile_identity || '';
    latestAwarenessConnectionState = overview.connection_state || '';
    elements.awarenessAttention.textContent = model?.attention?.label || '暂不可用';
    elements.awarenessReason.textContent = model?.attention?.reason || '尚未观察到手机状态';
    elements.awarenessFreshness.textContent = model?.freshness?.label || '暂不可用';
    elements.awarenessConnection.textContent = overview.connection || '暂不可用';
    elements.awarenessUpdated.textContent = localizedDateTime(model?.freshness?.observed_at, '尚未更新');
    elements.awarenessIdentity.textContent = overview.mobile_identity || '暂不可用';
    elements.awarenessVersion.textContent = overview.app_version || '暂不可用';
    elements.awarenessTransport.textContent = [overview.transport, overview.vpn].filter(Boolean).join(' · ') || '暂不可用';
    elements.awarenessSync.textContent = overview.sync || '暂不可用';
    elements.awarenessPending.textContent = Number.isFinite(overview.pending_count) ? String(overview.pending_count) : '暂不可用';
    elements.awarenessCapture.textContent = overview.capture || '暂不可用';
    const rows = [
      ['配对与信任', details.paired && details.trusted ? '已建立可信关系' : '需要配对'],
      ['最近认证', localizedDateTime(details.last_authenticated_at, '暂不可用')],
      ['最近连接验证', localizedDateTime(details.last_connection_verified_at, '暂不可用')],
      ['路线策略', details.route_policy || '暂不可用'],
      ['候选地址', `${details.endpoint_candidate_count ?? 0} 个 · ${(details.endpoint_candidate_families || []).join('/') || '类别暂不可用'}`],
      ['队列', details.queue ? `等待 ${details.queue.pending} · 发送中 ${details.queue.running} · 重试 ${details.queue.retry_pending} · 需处理 ${details.queue.terminal_failure}` : '暂不可用'],
      ['账本对账', details.ledger ? `${details.ledger.comparison} · 手机 ${details.ledger.mobile_total ?? '未知'} · 电脑 ${details.ledger.pc_total ?? '未知'} · 差值 ${details.ledger.difference_count ?? '未知'}` : '暂不可用'],
      ['手机账本', details.ledger ? `今日 ${details.ledger.mobile_today ?? '未知'} · 待回放 ${details.ledger.mobile_pending ?? '未知'} · 已确认 ${details.ledger.mobile_acknowledged ?? '未知'} · 失败 ${details.ledger.mobile_failed ?? '未知'}` : '暂不可用'],
      ['账本头序号', details.ledger ? `手机 ${details.ledger.mobile_latest_sequence ?? '未知'} · 电脑 ${details.ledger.pc_latest_sequence ?? '未知'} · ACK ${details.ledger.mobile_latest_acknowledged_sequence ?? '未知'}` : '暂不可用'],
      ['手机最新通知', details.ledger ? localizedDateTime(details.ledger.mobile_latest_posted_at, '暂不可用') : '暂不可用'],
      ['电脑最新接收', details.ledger ? localizedDateTime(details.ledger.pc_latest_received_at, '暂不可用') : '暂不可用'],
      ['最新来源', details.ledger ? `${details.ledger.mobile_latest_source_package || '未知'} · ${details.ledger.mobile_latest_event_type || '未知'} · ${details.ledger.mobile_latest_fingerprint_prefix || '无指纹摘要'}` : '暂不可用'],
      ['最近同步成功', localizedDateTime(details.last_sync_success_at, '暂不可用')],
      ['后台恢复', details.foreground_recovery?.label || '暂不可用'],
      ['后台任务', details.work_manager?.label || '暂不可用']
    ];
    elements.awarenessDetails.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div');
      const key = document.createElement('span');
      const content = document.createElement('strong');
      key.textContent = label;
      content.textContent = value;
      row.append(key, content);
      return row;
    }));
  }

  async function refreshAwareness(refresh = true) {
    renderAwareness(await api.awareness({ refresh }));
    await refreshDevices();
  }

  async function runAwarenessAction(capability, button) {
    button.disabled = true;
    try {
      const result = await api.awarenessAction({ capability, parameters: {} });
      setMessage(capability === 'CREATE_DIAGNOSTIC_BUNDLE'
        ? `诊断包已创建，将在 ${localizedDateTime(result?.result?.expires_at_epoch_ms, '短时间后')} 自动过期。`
        : '请求已安全提交，正在等待手机更新状态。');
      await refreshAwareness(true);
    } catch (error) {
      const message = String(error?.message || '');
      if (/already in flight|busy/i.test(message)) {
        setMessage('正在完成上一项安全请求，请稍后重试。', true);
      } else if (/timeout|timed out/i.test(message)) {
        setMessage('手机暂未响应，请确认 NEXA Mobile 正在运行后重试。', true);
      } else {
        setMessage('操作暂不可用，请稍后重试。', true);
      }
    } finally {
      button.disabled = false;
    }
  }

  function clearTimer() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function clearQr() {
    elements.qr.removeAttribute('src');
    elements.qrArea.classList.add('hidden');
  }

  function setMessage(value, isError = false) {
    elements.message.textContent = String(value || '');
    elements.message.classList.toggle('error', isError);
  }

  function countdownText(remainingMs) {
    const seconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderCertificate(info) {
    elements.fingerprint.textContent = info ? '已配置' : '未配置';
    elements.certificateExpiry.textContent = `${localizedDateTime(info.expires_at, '未知时间')}${info.expires_within_30_days ? '（即将到期）' : ''}`;
  }

  async function ensurePairingRuntime() {
    const settings = await root.tokenMonitor.getSettings();
    if (settings?.hubMode !== 'host') {
      setMessage('正在启动本机配对服务…');
      await root.tokenMonitor.updateSettings({ hubMode: 'host' });
    }
    let lastError = null;
    for (let attempt = 0; attempt < hostStartupAttempts; attempt += 1) {
      try { return await api.certificate(); }
      catch (error) { lastError = error; }
      await wait(hostStartupPollMs);
    }
    throw lastError || new Error('本机配对服务启动超时。');
  }

  function renderSession(session) {
    pairingId = session?.pairing_id || pairingId;
    const state = session?.state || 'NOT_STARTED';
    pairingState = state;
    if (state === 'COMPLETED') setRepairRequired(false);
    elements.status.textContent = sessionPresentation[state] || '正在处理配对';
    elements.status.dataset.state = state;
    elements.endpoint.textContent = '自动选择安全局域网连接';
    if (session?.certificate_fingerprint_sha256) {
      elements.fingerprint.textContent = '已配置';
    }
    elements.countdown.textContent = countdownText(session?.remaining_ms);
    elements.cancel.disabled = terminal.has(state) || !pairingId;
    elements.start.disabled = !terminal.has(state) && state !== 'NOT_STARTED';

    if (state === 'PENDING' && session?.qr?.format === 'svg-data-url' && session.qr.src.startsWith('data:image/svg+xml;base64,')) {
      const moduleCount = Number(session.qr.module_count);
      const renderPixels = Number(session.qr.recommended_render_pixels);
      if (Number.isInteger(moduleCount) && Number.isInteger(renderPixels) && renderPixels === moduleCount * 4) {
        elements.qr.width = renderPixels;
        elements.qr.height = renderPixels;
        elements.qrArea.style.setProperty('--mobile-pairing-qr-size', `${renderPixels}px`);
      }
      elements.qr.src = session.qr.src;
      elements.qrArea.classList.remove('hidden');
    } else {
      clearQr();
    }

    const claimed = Boolean(session?.device_id_summary && session?.sas) && !terminal.has(state);
    elements.claim.classList.toggle('hidden', !claimed);
    elements.device.textContent = session?.device_id_summary || '—';
    elements.sas.textContent = session?.sas || '—';
    elements.allow.disabled = session?.desktop_confirmed === true || state === 'DELIVERED';
    elements.reject.disabled = terminal.has(state);

    if (state === 'COMPLETED') setMessage('配对完成。设备凭据已通过一次性HTTPS响应交付。');
    else if (state === 'EXPIRED') setMessage('配对会话已过期，请重新开始。', true);
    else if (state === 'FAILED' || state === 'CONSUMED') setMessage('配对失败或一次性材料已消费，请重新开始。', true);
    else if (state === 'CANCELLED') setMessage('配对已取消。');
    else if (state === 'CLAIMED') setMessage(session.android_confirmed ? '手机已确认，请核对数字后允许设备。' : '已收到设备请求，等待手机确认核对码。');
    else if (state === 'BOTH_CONFIRMED') setMessage('双方已确认，等待手机下载一次性设备凭据。');
    else if (state === 'DELIVERED') setMessage('凭据已交付，等待手机完成确认。');
    else if (state === 'PENDING') setMessage('请使用NEXA Mobile扫描二维码。');

    clearTimer();
    if (!terminal.has(state) && pairingId) {
      pollTimer = setTimeout(() => refreshSession().catch(showError), 1000);
    }
  }

  function showError(error) {
    clearTimer();
    clearQr();
    setMessage(error?.message || '移动设备配对暂不可用。', true);
    elements.start.disabled = false;
  }

  async function refreshSession() {
    if (!pairingId) return;
    renderSession(await api.status(pairingId));
    await refreshDevices();
  }

  async function refreshCertificate() {
    renderCertificate(await api.certificate());
  }

  async function refreshDevices() {
    const devices = await api.listDevices();
    elements.deviceList.replaceChildren();
    if (!devices.length) {
      const empty = document.createElement('span');
      empty.textContent = '暂无已配对设备';
      elements.deviceList.appendChild(empty);
      if (!pairingId || terminal.has(pairingState)) {
        elements.status.textContent = repairRequired ? '需要重新配对' : '等待首次配对';
      }
      return;
    }
    for (const device of devices) {
      const row = document.createElement('div');
      row.className = 'mobile-pairing-device-row';
      const summary = document.createElement('div');
      const id = document.createElement('code');
      id.textContent = device.device_id_summary;
      const detail = document.createElement('span');
      const connectionState = isLatestAwarenessDevice(device)
        ? latestAwarenessConnectionState
        : device.connection_state;
      const deviceState = deviceStatePresentation(connectionState);
      detail.textContent = connectionState === 'CONNECTED'
        ? `${deviceState} · 最近验证 ${localizedDateTime(device.last_authenticated_at, '刚刚')}`
        : `${deviceState} · 信任建立于 ${localizedDateTime(device.paired_at, '未知时间')}`;
      summary.append(id, detail);
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'secondary';
      revoke.textContent = '撤销';
      revoke.addEventListener('click', async () => {
        if (!root.confirm(`撤销设备 ${device.device_id_summary}？后续Business与Status认证将立即失败。`)) return;
        await api.revoke(device.device_ref);
        setRepairRequired(true);
        await refreshDevices();
        setMessage('设备信任已撤销，需要重新配对。');
      });
      row.append(summary, revoke);
      elements.deviceList.appendChild(row);
    }
    if (!pairingId || terminal.has(pairingState)) {
      const priority = ['CONNECTED', 'CONNECTING', 'DISCOVERED', 'RECONNECTING', 'NETWORK_CHANGED', 'SEARCHING', 'OFFLINE', 'NEEDS_REPAIRING'];
      const selected = priority.find((state) => devices.some((device) => {
        const connectionState = isLatestAwarenessDevice(device)
          ? latestAwarenessConnectionState
          : device.connection_state;
        return connectionState === state;
      }));
      elements.status.textContent = deviceStatePresentation(selected);
    }
  }

  elements.start.addEventListener('click', async () => {
    try {
      elements.start.disabled = true;
      renderCertificate(await ensurePairingRuntime());
      renderSession(await api.start());
    } catch (error) { showError(error); }
  });
  elements.cancel.addEventListener('click', async () => {
    try { renderSession(await api.cancel(pairingId)); } catch (error) { showError(error); }
  });
  elements.allow.addEventListener('click', async () => {
    try { renderSession(await api.desktopConfirm(pairingId, true)); } catch (error) { showError(error); }
  });
  elements.reject.addEventListener('click', async () => {
    try { renderSession(await api.desktopConfirm(pairingId, false)); } catch (error) { showError(error); }
  });
  elements.rotate.addEventListener('click', async () => {
    if (!root.confirm('轮换Mobile HTTPS证书会撤销现有设备配对。确认继续？')) return;
    try {
      clearTimer();
      clearQr();
      await api.rotateCertificate(true);
      pairingId = '';
      setRepairRequired(true);
      elements.status.textContent = '需要重新配对';
      elements.start.disabled = false;
      await Promise.all([refreshCertificate(), refreshDevices()]);
      setMessage('证书已轮换，所有移动设备需要重新配对。');
    } catch (error) { showError(error); }
  });

  elements.awarenessRefresh?.addEventListener('click', () => refreshAwareness(true).catch(showError));
  panel.querySelectorAll('[data-mobile-awareness-action]').forEach((button) => {
    button.addEventListener('click', () => runAwarenessAction(button.dataset.mobileAwarenessAction, button));
  });

  root.tokenMonitor.getSettings().then((settings) => {
    if (settings?.hubMode !== 'host') {
      setMessage('配对新设备会自动启动现有Hub；已有可信设备在Hub启动后会自动重连。');
      return false;
    }
    return Promise.all([refreshCertificate(), refreshDevices(), refreshAwareness(true)]).then(() => true);
  }).then((runtimeAvailable) => {
    if (runtimeAvailable) {
      devicePollTimer = setInterval(() => refreshDevices().catch(showError), 3000);
      awarenessPollTimer = setInterval(() => refreshAwareness(true).catch(showError), 15000);
    }
  }).catch(showError);
  root.addEventListener('beforeunload', () => {
    clearTimer();
    if (devicePollTimer) clearInterval(devicePollTimer);
    if (awarenessPollTimer) clearInterval(awarenessPollTimer);
    clearQr();
  });
})(window);
