import { isValidDateOnlyString, daysInMonth } from '../date/deterministic-parser.mjs';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad4(value) {
  return String(value).padStart(4, '0');
}

export function createDay(date, { events = [], tasks = [] } = {}) {
  if (!isValidDateOnlyString(date)) {
    throw new TypeError(`Invalid date-only value for day: "${date}"`);
  }
  if (!Array.isArray(events)) throw new TypeError('Day events must be an array');
  if (!Array.isArray(tasks)) throw new TypeError('Day tasks must be an array');
  return Object.freeze({
    date,
    events: Object.freeze([...events]),
    tasks: Object.freeze([...tasks]),
  });
}

export function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z) {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { year: m <= 2 ? y + 1 : y, month: m, day: d };
}

export function addDays(dateOnly, days) {
  if (!isValidDateOnlyString(dateOnly)) {
    throw new TypeError(`Invalid date-only value: "${dateOnly}"`);
  }
  if (!Number.isInteger(days)) {
    throw new TypeError('days must be an integer');
  }
  const [y, m, d] = dateOnly.split('-').map(Number);
  const { year, month, day } = civilFromDays(daysFromCivil(y, m, d) + days);
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

export function dayOfWeekMonday0(dateOnly) {
  if (!isValidDateOnlyString(dateOnly)) {
    throw new TypeError(`Invalid date-only value: "${dateOnly}"`);
  }
  const [y, m, d] = dateOnly.split('-').map(Number);
  return ((daysFromCivil(y, m, d) + 3) % 7 + 7) % 7;
}

export function createWeek(weekStart, { days } = {}) {
  if (!isValidDateOnlyString(weekStart)) {
    throw new TypeError(`Invalid date-only value for week start: "${weekStart}"`);
  }
  const weekDays = days ?? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  if (!Array.isArray(weekDays) || weekDays.length !== 7) {
    throw new TypeError('A week must contain exactly 7 days');
  }
  for (const d of weekDays) {
    if (!isValidDateOnlyString(d)) throw new TypeError(`Invalid date-only value in week days: "${d}"`);
  }
  return Object.freeze({
    week_start: weekStart,
    week_end: addDays(weekStart, 6),
    days: Object.freeze([...weekDays]),
  });
}

export function buildMonthWeeks(year, month) {
  if (!Number.isInteger(year) || year < 1) {
    throw new TypeError(`Invalid year for month view: "${year}"`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new TypeError(`Invalid month for month view: "${month}"`);
  }
  const monthStart = `${pad4(year)}-${pad2(month)}-01`;
  const totalDays = daysInMonth(year, month);
  const wd0 = dayOfWeekMonday0(monthStart);
  const gridStart = addDays(monthStart, -wd0);
  const rowCount = Math.ceil((wd0 + totalDays) / 7);
  const monthPrefix = `${pad4(year)}-${pad2(month)}`;
  const weeks = [];
  for (let r = 0; r < rowCount; r += 1) {
    const weekStart = addDays(gridStart, r * 7);
    const cells = [];
    for (let c = 0; c < 7; c += 1) {
      const date = addDays(weekStart, c);
      cells.push({ date, in_month: date.slice(0, 7) === monthPrefix });
    }
    weeks.push(
      Object.freeze({
        week_start: weekStart,
        week_end: addDays(weekStart, 6),
        days: Object.freeze(cells),
      }),
    );
  }
  return Object.freeze(weeks);
}

export function createMonth(year, month, { weeks, days } = {}) {
  if (!Number.isInteger(year) || year < 1) {
    throw new TypeError(`Invalid year for month view: "${year}"`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new TypeError(`Invalid month for month view: "${month}"`);
  }
  if (weeks != null && days != null) {
    throw new TypeError('createMonth accepts either weeks or days, not both');
  }
  if (days != null) {
    if (!Array.isArray(days) || !days.every((d) => isValidDateOnlyString(d))) {
      throw new TypeError('Month days must be an array of valid date-only strings');
    }
    return Object.freeze({ year, month, weeks: null, days: Object.freeze([...days]) });
  }
  const monthWeeks = weeks != null ? Object.freeze([...weeks]) : buildMonthWeeks(year, month);
  return Object.freeze({ year, month, weeks: monthWeeks, days: null });
}

export function weekStartMondayOf(dateOnly) {
  if (!isValidDateOnlyString(dateOnly)) {
    throw new TypeError(`Invalid date-only value: "${dateOnly}"`);
  }
  return addDays(dateOnly, -dayOfWeekMonday0(dateOnly));
}
