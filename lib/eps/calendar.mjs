const DAY = 86400000;
function stamp(date) {
  if (date instanceof Date) date = date.toISOString().slice(0, 10);
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const ms = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(ms) && day(ms) === date ? ms : NaN;
}
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export const validCalendarDate = (date) => Number.isFinite(stamp(date));
function working(ms, calendar) {
  return !calendar || (calendar.exceptions?.[day(ms)] ?? calendar.weekdays.includes(new Date(ms).getUTCDay()));
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
  for (const [key, works] of Object.entries(calendar.exceptions || {})) {
    const ms = stamp(key);
    if (ms >= a && ms <= b) result += Number(works) - Number(calendar.weekdays.includes(new Date(ms).getUTCDay()));
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
  // A weekly schedule has at least one working day. Every exception can remove at most one.
  let lo = 0, hi = Math.min((days + Object.keys(calendar.exceptions || {}).length) * 7, (Date.UTC(9999, 11, 31) - ms) / DAY);
  if (workingDays(start, day(ms + hi * DAY), calendar) < days) return null;
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
