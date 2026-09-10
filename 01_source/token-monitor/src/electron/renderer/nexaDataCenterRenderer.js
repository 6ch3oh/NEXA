'use strict';

(() => {
  function unwrap(value) {
    if (value?.ok === false) throw Object.assign(new Error(value.error?.message || 'request failed'), { code: value.error?.code });
    return value?.ok === true && Object.hasOwn(value, 'value') ? value.value : value;
  }

  function dateBefore(day, count) {
    const value = new Date(`${day}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() - count);
    return value.toISOString().slice(0, 10);
  }

  function tokenProjection(history, range, start, end) {
    const rows = Array.isArray(history?.daily) ? history.daily : [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const earliest = rows.map((row) => row.date).filter(Boolean).sort()[0] || null;
    if (range === 'rolling24h') return {
      label: '最近 24 小时', rows: [], earliest,
      gap: '当前权威归档只有日粒度，无法把“今日”伪装成滚动 24 小时；细粒度区间标记为缺口。'
    };
    const from = range === 'today' ? today
      : range === '7d' ? dateBefore(today, 6)
        : range === '30d' ? dateBefore(today, 29)
          : range === '1y' ? dateBefore(today, 364)
            : range === 'all' ? (earliest || today) : start;
    const to = range === 'custom' ? end : today;
    if (!from || !to || from > to) throw new Error('自定义范围无效');
    return {
      label: `${from} — ${to}`,
      rows: rows.filter((row) => row.date >= from && row.date <= to),
      earliest,
      gap: earliest && from < earliest ? `请求早于真实历史；数据从 ${earliest} 开始可用。` : null
    };
  }

  function count(value) { return Array.isArray(value) ? value.length : 0; }
  function safeText(value, fallback = '不可用') { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }

  async function init() {
    const root = document.getElementById('nexaDataCenterSettings');
    const api = window.tokenMonitor;
    if (!root || !api?.nexa) return;
    const overview = document.getElementById('nexaDataSourceOverview');
    const range = document.getElementById('nexaTokenRange');
    const start = document.getElementById('nexaTokenStartDate');
    const end = document.getElementById('nexaTokenEndDate');
    const tokenResult = document.getElementById('nexaTokenRangeResult');
    const lensDate = document.getElementById('nexaDayLensDate');
    const lensResult = document.getElementById('nexaDayLensResult');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    lensDate.value = today; start.value = dateBefore(today, 29); end.value = today;
    let history = null;

    async function refresh() {
      overview.textContent = '正在读取本地来源状态…';
      const [historyResult, aiResult, consumptionResult, deviceResult, automationResult, mobileResult] = await Promise.allSettled([
        api.getDashboardHistory(), api.nexa['today-tomorrow'].getLocalAiState(),
        api.nexa.consumption.execute({ type: 'list-mobile-drafts', payload: { options: {} } }),
        api.nexa['device-center'].getDiagnostics(), api.nexa['automation-center'].listAutomations({}),
        api.nexa['mobile-pairing'].listDevices()
      ]);
      history = historyResult.status === 'fulfilled' ? historyResult.value : null;
      const ai = aiResult.status === 'fulfilled' ? unwrap(aiResult.value) : null;
      const drafts = consumptionResult.status === 'fulfilled' ? unwrap(consumptionResult.value) : [];
      const diagnostics = deviceResult.status === 'fulfilled' ? unwrap(deviceResult.value) : null;
      const automations = automationResult.status === 'fulfilled' ? unwrap(automationResult.value) : [];
      const devices = mobileResult.status === 'fulfilled' ? unwrap(mobileResult.value) : [];
      overview.textContent = [
        `Token：${count(history?.daily)} 个日汇总`,
        `消费草稿：${count(drafts)} 条`,
        `设备诊断：${diagnostics ? '可查询' : '不可用'}`,
        `自动化：${count(automations)} 项`,
        `可信移动设备：${count(devices)} 台`,
        `本地 AI：${safeText(ai?.status, '未配置')}`,
        '通知：原始 envelope 仅在受限本地层保留'
      ].join(' · ');
      renderToken();
    }

    function renderToken() {
      try {
        const value = tokenProjection(history, range.value, start.value, end.value);
        const tokens = value.rows.reduce((sum, row) => sum + Number(row.tokens || 0), 0);
        const cost = value.rows.reduce((sum, row) => sum + Number(row.cost || 0), 0);
        tokenResult.textContent = `${value.label} · ${Math.round(tokens).toLocaleString()} Token · $${cost.toFixed(4)} · 数据从 ${value.earliest || '尚无历史'} 开始可用${value.gap ? ` · 缺口：${value.gap}` : ''}`;
      } catch (error) { tokenResult.textContent = `范围错误：${error.message}`; }
    }

    async function openLens() {
      const date = lensDate.value;
      if (!date) return;
      lensResult.textContent = '正在汇总当日视图…';
      const [calendar, consumption, device, automations] = await Promise.allSettled([
        api.nexa['today-tomorrow'].getDateSummary(date),
        api.nexa.consumption.execute({ type: 'query', payload: { options: { startDate: date, endDate: date } } }),
        api.nexa['device-center'].getHistory({ start_date: date, end_date: date }),
        api.nexa['automation-center'].listAutomations({})
      ]);
      const dayToken = (history?.daily || []).find((row) => row.date === date);
      const cal = calendar.status === 'fulfilled' ? unwrap(calendar.value) : null;
      const bills = consumption.status === 'fulfilled' ? unwrap(consumption.value) : [];
      const deviceHistory = device.status === 'fulfilled' ? unwrap(device.value) : [];
      const automationList = automations.status === 'fulfilled' ? unwrap(automations.value) : [];
      lensResult.textContent = [
        `${date}`, `日历 ${count(cal?.events) + count(cal?.tasks)} 项`, `消费/收入 ${count(bills)} 条`,
        `Token ${Math.round(Number(dayToken?.tokens || 0)).toLocaleString()}`, `设备样本 ${count(deviceHistory)} 条`,
        '通知正文默认不可见', `自动化目录 ${count(automationList)} 项`
      ].join(' · ');
    }

    document.getElementById('nexaDataCenterRefresh')?.addEventListener('click', () => void refresh());
    document.getElementById('nexaDayLensOpen')?.addEventListener('click', () => void openLens());
    range.addEventListener('change', renderToken); start.addEventListener('change', renderToken); end.addEventListener('change', renderToken);
    await refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  else void init();
})();
