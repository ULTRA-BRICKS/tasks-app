const DAY = 86400000;
const parts = (value: string) => value.split('-').map(Number);
function utc(value: string) {
  const [year, month, day] = parts(value),
    date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
const iso = (date: Date) =>
  `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const first = utc('0001-01-01').getTime(),
  last = utc('9999-12-31').getTime();
export function parseCalendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = utc(value);
  return date.getTime() >= first && date.getTime() <= last && iso(date) === value ? value : null;
}
export function moveCalendarDay(value: string, delta: number): string {
  return iso(new Date(Math.min(last, Math.max(first, utc(value).getTime() + delta * DAY))));
}
export function moveCalendarMonth(value: string, delta: number): string {
  const [year, month, day] = parts(value),
    index = Math.max(0, Math.min(9999 * 12 - 1, (year - 1) * 12 + month - 1 + delta));
  const y = Math.floor(index / 12) + 1,
    m = (index % 12) + 1;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0),
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(day, days[m - 1])).padStart(2, '0')}`;
}
export function calendarDays(value: string): Array<string | null> {
  const month = utc(value.slice(0, 7) + '-01'),
    start = month.getTime() - ((month.getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: 42 }, (_, i) => {
    const time = start + i * DAY;
    return time < first || time > last ? null : iso(new Date(time));
  });
}
export const calendarWeekday = (value: string) => (utc(value).getUTCDay() + 6) % 7;
export const calendarLabel = (value: string, monthOnly = false) =>
  new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    ...(monthOnly ? {} : { day: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(utc(value));
export const todayCalendarDate = (now = new Date()) =>
  `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
