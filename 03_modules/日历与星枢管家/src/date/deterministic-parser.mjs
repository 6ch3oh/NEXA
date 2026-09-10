import { TEMPORAL_STATES } from '../domain/temporal-state.mjs';

export class ParseError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ParseError';
    this.code = options.code ?? 'parse_error';
    this.input = options.input ?? null;
  }
}

export class InvalidDateError extends ParseError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'invalid_date' });
    this.name = 'InvalidDateError';
  }
}

export class UnsupportedDateFormatError extends ParseError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'unsupported_format' });
    this.name = 'UnsupportedDateFormatError';
  }
}

export class MissingDefaultTimezoneError extends ParseError {
  constructor(message = 'A defaultTimezone is required for exact or date-only inputs without an explicit offset/timezone.') {
    super(message, { code: 'missing_timezone' });
    this.name = 'MissingDefaultTimezoneError';
  }
}

export class InvalidTimezoneError extends ParseError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'invalid_timezone' });
    this.name = 'InvalidTimezoneError';
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*(Z|[+-]\d{2}:\d{2}))?$/;
const CN_DATE_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/;
const CN_DATETIME_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const CN_MERIDIAN_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(上午|下午)\s*(\d{1,2})(?::(\d{2}))?$/;

const RELATIVE_PHRASES = ['今天', '明天', '后天', '下周', '月底', '过几天'];
const AMBIGUOUS_PHRASES = ['最近', '晚一点', '午饭后', '有空的时候', '下个月找一天', '帮我安排合适时间'];

export function isLeapYear(year) {
  if (!Number.isInteger(year)) return false;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

export function isValidDateOnlyString(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE_RE.exec(value.trim());
  if (!m) return false;
  return isCalendarDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isCalendarDay(y, mo, d) {
  if (!Number.isInteger(y) || y < 1 || y > 9999) return false;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > daysInMonth(y, mo)) return false;
  return true;
}

export function isValidIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_DATETIME_RE.exec(value.trim());
  if (!m) return false;
  const { y, mo, d, h, mi, s, offset } = parseIsoDateTimeMatch(m);
  if (!isCalendarDay(y, mo, d)) return false;
  if (!isValidClockTime(h, mi, s)) return false;
  if (m[7] != null && offset === null) return false;
  return true;
}

export function isValidIsoDateOrTimestamp(value) {
  return isValidDateOnlyString(value) || isValidIsoTimestamp(value);
}

function isValidClockTime(h, mi, s) {
  return (
    Number.isInteger(h) && h >= 0 && h <= 23 &&
    Number.isInteger(mi) && mi >= 0 && mi <= 59 &&
    Number.isInteger(s) && s >= 0 && s <= 59
  );
}

function normalizeOffsetToken(token) {
  if (token == null) return null;
  if (token === 'Z') return 'Z';
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(token);
  if (!m) return null;
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h > 14 || min > 59) return null;
  return `${m[1]}${pad(h, 2)}:${pad(min, 2)}`;
}

function parseIsoDateTimeMatch(m) {
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: m[6] != null ? Number(m[6]) : 0,
    offset: normalizeOffsetToken(m[7] ?? null),
  };
}

function resolveTimezone(defaultTimezone) {
  if (typeof defaultTimezone !== 'string' || defaultTimezone.trim() === '') {
    throw new MissingDefaultTimezoneError();
  }
  const tz = defaultTimezone.trim();
  if (tz === 'Z') return { kind: 'offset', token: 'Z' };
  const offsetMatch = /^([+-])?(\d{1,2}):?(\d{2})$/.exec(tz);
  if (offsetMatch) {
    const sign = offsetMatch[1] ?? '+';
    const h = Number(offsetMatch[2]);
    const min = Number(offsetMatch[3]);
    if (min > 59 || h > 14) {
      throw new InvalidTimezoneError(`Unrecognized timezone offset "${tz}"`, { input: tz });
    }
    return { kind: 'offset', token: `${sign}${pad(h, 2)}:${pad(min, 2)}` };
  }
  if (/^[A-Za-z][A-Za-z0-9_+/.-]*$/.test(tz)) {
    return { kind: 'zone', name: tz };
  }
  throw new InvalidTimezoneError(`Unrecognized timezone "${tz}"`, { input: tz });
}

function validateYmd(y, mo, d, input) {
  if (!isCalendarDay(y, mo, d)) {
    throw new InvalidDateError(`Invalid calendar date ${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`, { input });
  }
}

function validateClockTime(h, mi, s, input) {
  if (!isValidClockTime(h, mi, s)) {
    throw new InvalidDateError(`Invalid clock time ${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`, { input });
  }
}

function buildDateOnlyResult(y, mo, d, defaultTimezone) {
  const tz = resolveTimezone(defaultTimezone);
  const date = `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
  return {
    ok: true,
    time_state: TEMPORAL_STATES.DATE_ONLY,
    start_at: date,
    timezone: tz.kind === 'offset' ? tz.token : tz.name,
    has_time: false,
  };
}

function buildExactResult(parts, defaultTimezone) {
  const date = `${pad(parts.y, 4)}-${pad(parts.mo, 2)}-${pad(parts.d, 2)}`;
  const time = `${pad(parts.h, 2)}:${pad(parts.mi, 2)}:${pad(parts.s, 2)}`;
  if (parts.offset != null) {
    return {
      ok: true,
      time_state: TEMPORAL_STATES.EXACT,
      start_at: `${date}T${time}${parts.offset}`,
      timezone: parts.offset,
      has_time: true,
    };
  }
  const tz = resolveTimezone(defaultTimezone);
  if (tz.kind === 'offset') {
    return {
      ok: true,
      time_state: TEMPORAL_STATES.EXACT,
      start_at: `${date}T${time}${tz.token}`,
      timezone: tz.token,
      has_time: true,
    };
  }
  return {
    ok: true,
    time_state: TEMPORAL_STATES.EXACT,
    start_at: `${date}T${time}`,
    timezone: tz.name,
    has_time: true,
  };
}

export function parseDateTime(input, options = {}) {
  if (typeof input !== 'string') {
    throw new ParseError('parseDateTime expects a string input');
  }
  const { defaultTimezone } = options ?? {};
  const raw = input.trim();

  if (raw === '') {
    return {
      ok: true,
      time_state: TEMPORAL_STATES.UNSCHEDULED,
      start_at: null,
      timezone: null,
      has_time: false,
    };
  }

  for (const phrase of AMBIGUOUS_PHRASES) {
    if (raw.includes(phrase)) {
      return {
        ok: true,
        time_state: TEMPORAL_STATES.AMBIGUOUS,
        start_at: null,
        timezone: null,
        has_time: false,
        matched: phrase,
      };
    }
  }
  for (const phrase of RELATIVE_PHRASES) {
    if (raw.includes(phrase)) {
      return {
        ok: true,
        time_state: TEMPORAL_STATES.RELATIVE_UNRESOLVED,
        start_at: null,
        timezone: null,
        has_time: false,
        matched: phrase,
      };
    }
  }

  let m = ISO_DATE_RE.exec(raw);
  if (m) {
    validateYmd(Number(m[1]), Number(m[2]), Number(m[3]), raw);
    return buildDateOnlyResult(Number(m[1]), Number(m[2]), Number(m[3]), defaultTimezone);
  }

  m = ISO_DATETIME_RE.exec(raw);
  if (m) {
    const parts = parseIsoDateTimeMatch(m);
    if (m[7] != null && parts.offset === null) {
      throw new InvalidDateError(`Invalid timezone offset "${m[7]}"`, { input: raw });
    }
    validateYmd(parts.y, parts.mo, parts.d, raw);
    validateClockTime(parts.h, parts.mi, parts.s, raw);
    return buildExactResult(parts, defaultTimezone);
  }

  m = CN_DATE_RE.exec(raw);
  if (m) {
    validateYmd(Number(m[1]), Number(m[2]), Number(m[3]), raw);
    return buildDateOnlyResult(Number(m[1]), Number(m[2]), Number(m[3]), defaultTimezone);
  }

  m = CN_DATETIME_RE.exec(raw);
  if (m) {
    validateYmd(Number(m[1]), Number(m[2]), Number(m[3]), raw);
    validateClockTime(Number(m[4]), Number(m[5]), m[6] != null ? Number(m[6]) : 0, raw);
    return buildExactResult(
      {
        y: Number(m[1]),
        mo: Number(m[2]),
        d: Number(m[3]),
        h: Number(m[4]),
        mi: Number(m[5]),
        s: m[6] != null ? Number(m[6]) : 0,
        offset: null,
      },
      defaultTimezone,
    );
  }

  m = CN_MERIDIAN_RE.exec(raw);
  if (m) {
    validateYmd(Number(m[1]), Number(m[2]), Number(m[3]), raw);
    const meridian = m[4];
    let h = Number(m[5]);
    const mi = m[6] != null ? Number(m[6]) : 0;
    if (h < 1 || h > 12) {
      throw new InvalidDateError(`Hour out of range for a 12-hour clock: ${h}`, { input: raw });
    }
    if (meridian === '下午' && h !== 12) h += 12;
    if (meridian === '上午' && h === 12) h = 0;
    validateClockTime(h, mi, 0, raw);
    return buildExactResult(
      {
        y: Number(m[1]),
        mo: Number(m[2]),
        d: Number(m[3]),
        h,
        mi,
        s: 0,
        offset: null,
      },
      defaultTimezone,
    );
  }

  throw new UnsupportedDateFormatError(`Unsupported or unrecognized date/time expression "${raw}"`, { input: raw });
}
