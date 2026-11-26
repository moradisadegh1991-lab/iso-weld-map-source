const DAY = 86400000;
function stamp(date) {
  if (date instanceof Date) date = date.toISOString().slice(0, 10);
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const ms = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(ms) && day(ms) === date ? ms : NaN;
}
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export const validCalendarDate = (date) => Number.isFinite(stamp(date));
export const validAnnualDate = (date) => typeof date === "string" && validCalendarDate(`2000-${date}`);

function working(ms, calendar) {
  if (!calendar) return true;
  const date = day(ms);
  return calendar.exceptions?.[date] ?? calendar.annual_exceptions?.[date.slice(5)] ??
    calendar.weekdays.includes(new Date(ms).getUTCDay());
}

/** Date-specific rules take precedence over recurring month/day rules. */
function* exceptionsIn(start, end, calendar) {
  const dates = calendar.exceptions || {};
  for (const [date, works] of Object.entries(dates)) {
    const ms = stamp(date);
    if (ms >= start && ms <= end) yield [ms, works, date];
  }
  const annual = Object.entries(calendar.annual_exceptions || {});
  if (!annual.length) return;
  const from = new Date(start).getUTCFullYear(), through = new Date(end).getUTCFullYear();
  for (let year = from; year <= through; year++) {
    const prefix = String(year).padStart(4, "0");
    for (const [monthDay, works] of annual) {
      const date = `${prefix}-${monthDay}`;
      if (Object.hasOwn(dates, date)) continue;
      const ms = stamp(date);
      if (ms >= start && ms <= end) yield [ms, works, date];
    }
  }
}

export function workingDays(start, end, calendar) {
  const a = stamp(start), b = stamp(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const count = (b - a) / DAY + 1;
  if (!calendar) return count;
  const weeks = Math.floor(count / 7);
  let result = weeks * calendar.weekdays.length;
  for (let ms = a + weeks * 7 * DAY; ms <= b; ms += DAY) {
    if (calendar.weekdays.includes(new Date(ms).getUTCDay())) result++;
  }
  for (const [ms, works] of exceptionsIn(a, b, calendar)) {
    result += Number(works) - Number(calendar.weekdays.includes(new Date(ms).getUTCDay()));
  }
  return result;
}
export function workingFinish(start, days, calendar) {
  const ms = stamp(start);
  if (!Number.isFinite(ms) || !Number.isInteger(days) || days < 1) return null;
  if (!calendar) {
    const end = ms + (days - 1) * DAY;
    return end <= Date.UTC(9999, 11, 31) ? day(end) : null;
  }
  const max = (Date.UTC(9999, 11, 31) - ms) / DAY;
  let lo = 0, hi = Math.min((days + Object.keys(calendar.exceptions || {}).length) * 7, max);
  // Annual rules can remove workdays indefinitely, so extend the search to a bounded date.
  while (workingDays(start, day(ms + hi * DAY), calendar) < days) {
    if (hi === max) return null;
    lo = hi + 1;
    hi = Math.min(hi * 2, max);
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (workingDays(start, day(ms + mid * DAY), calendar) >= days) hi = mid;
    else lo = mid + 1;
  }
  return day(ms + lo * DAY);
}
export function isWorking(date, calendar) {
  const ms = stamp(date);
  return Number.isFinite(ms) && working(ms, calendar);
}

/** Weekly shift periods, with date-specific replacements. Missing periods mean the hours are unknown. */
export function shiftMinutes(periods) {
  if (!Array.isArray(periods) || !periods.length) return null;
  let total = 0, previous = -1;
  for (const pair of periods) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const mins = pair.map(t => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
      ? Number(t.slice(0,2))*60 + Number(t.slice(3)) : t === "24:00" ? 1440 : NaN);
    if (!mins.every(Number.isFinite) || mins[0] < previous || mins[0] >= mins[1]) return null;
    total += mins[1] - mins[0];
    previous = mins[1];
  }
  return total;
}

export function workingHours(start,end,calendar) {
  const a = stamp(start), b = stamp(end);
  if (!calendar || !Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const shifts = calendar.shifts || {};
  const counts = Array(7).fill(Math.floor(((b-a)/DAY+1)/7));
  for (let ms=a+counts[0]*7*DAY; ms<=b; ms+=DAY) counts[new Date(ms).getUTCDay()]++;
  let total = 0;
  for (const [ms, on, date] of exceptionsIn(a, b, calendar)) {
    const weekday=new Date(ms).getUTCDay();
    counts[weekday]--;
    if (on) {
      const minutes=shiftMinutes(shifts[date] || shifts[weekday]);
      if (minutes==null) return null;
      total+=minutes;
    }
  }
  for (const weekday of calendar.weekdays) {
    if (!counts[weekday]) continue;
    const minutes=shiftMinutes(shifts[weekday]);
    if (minutes==null) return null;
    total+=counts[weekday]*minutes;
  }
  return total/60;
}
