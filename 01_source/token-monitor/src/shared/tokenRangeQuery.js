'use strict';

const RANGE_IDS = Object.freeze(['today', 'rolling24h', '7d', '30d', '1y', 'all', 'custom']);

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function dateKey(value, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayBefore(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function sumRows(rows) {
  let tokens = 0; let cost = 0; let messages = 0;
  for (const row of rows) {
    tokens += number(row.tokens); cost += number(row.cost); messages += number(row.messages);
  }
  return Object.freeze({ tokens: Math.round(tokens), cost, messages: Math.round(messages) });
}

function dailyRows(archive) {
  const output = [];
  for (const [date, day] of Object.entries(archive?.days || {})) {
    for (const observation of Object.values(day?.observations || {})) output.push({ date, ...observation });
  }
  return output;
}

function eventRows(events, startAt, endAt) {
  const seen = new Set();
  return (Array.isArray(events) ? events : []).filter((event) => {
    const at = Date.parse(event?.occurredAt || event?.recordedAt || '');
    const id = String(event?.eventId || event?.id || `${at}:${event?.client || ''}:${event?.modelId || ''}`);
    if (!Number.isFinite(at) || at < startAt || at > endAt || seen.has(id)) return false;
    seen.add(id); return true;
  });
}

function queryTokenRange({ dailyArchive, events = [], range = 'today', now = new Date(), timezone = 'UTC', startAt, endAt } = {}) {
  if (!RANGE_IDS.includes(range)) throw Object.assign(new TypeError('unsupported token range'), { code: 'TOKEN_RANGE_INVALID' });
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw Object.assign(new TypeError('now is invalid'), { code: 'TOKEN_RANGE_INVALID' });
  const today = dateKey(nowMs, timezone);
  const rows = dailyRows(dailyArchive);
  const earliestDate = rows.map((row) => row.date).sort()[0] || null;

  if (range === 'rolling24h') {
    const start = nowMs - 86_400_000;
    const selected = eventRows(events, start, nowMs);
    return Object.freeze({
      range, start_at: new Date(start).toISOString(), end_at: new Date(nowMs).toISOString(),
      ...sumRows(selected), available_from: earliestDate,
      complete: selected.length > 0, gap: selected.length > 0 ? null : 'FINE_GRAINED_24H_HISTORY_NOT_AVAILABLE',
    });
  }

  let startDate; let endDate = today;
  if (range === 'today') startDate = today;
  else if (range === '7d') startDate = dayBefore(today, 6);
  else if (range === '30d') startDate = dayBefore(today, 29);
  else if (range === '1y') startDate = dayBefore(today, 364);
  else if (range === 'all') startDate = earliestDate || today;
  else {
    const start = new Date(startAt); const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw Object.assign(new TypeError('custom range is invalid'), { code: 'TOKEN_RANGE_INVALID' });
    startDate = dateKey(start, timezone); endDate = dateKey(end, timezone);
  }
  const selected = rows.filter((row) => row.date >= startDate && row.date <= endDate);
  const requestedBeforeHistory = Boolean(earliestDate && startDate < earliestDate);
  return Object.freeze({
    range, start_date: startDate, end_date: endDate, ...sumRows(selected), available_from: earliestDate,
    complete: !requestedBeforeHistory, gap: requestedBeforeHistory ? `HISTORY_STARTS_${earliestDate}` : null,
  });
}

module.exports = { RANGE_IDS, queryTokenRange };
