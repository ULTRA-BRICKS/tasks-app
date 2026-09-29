import { test, expect } from 'bun:test';
import {
  parseCalendarDate,
  moveCalendarDay,
  moveCalendarMonth,
  calendarDays,
} from '../../src/shared/lib/calendar-date';
test('date-only parser accepts real leap dates and rejects normalization or invalid values', () => {
  for (const value of ['2024-02-29', '2026-09-26', '0001-01-01', '9999-12-31'])
    expect(parseCalendarDate(value)).toBe(value);
  for (const value of [
    '2026-02-29',
    '2026-02-31',
    '2026-13-01',
    '2026-00-00',
    '0000-01-01',
    '2026-9-1',
    '2026-09-26T00:00:00Z',
    'junk',
  ])
    expect(parseCalendarDate(value)).toBeNull();
});
test('month and year navigation clamp month ends without jumping a timezone or normalizing past February', () => {
  expect(moveCalendarMonth('2026-01-31', 1)).toBe('2026-02-28');
  expect(moveCalendarMonth('2024-02-29', 12)).toBe('2025-02-28');
  expect(moveCalendarMonth('2026-01-31', -1)).toBe('2025-12-31');
  expect(moveCalendarDay('2026-03-28', 1)).toBe('2026-03-29');
  expect(moveCalendarDay('2026-12-31', 1)).toBe('2027-01-01');
  expect(moveCalendarDay('0001-01-01', -1)).toBe('0001-01-01');
  expect(moveCalendarMonth('9999-12-31', 1)).toBe('9999-12-31');
});
test('calendar weeks contain42 ordered distinct dates with a Monday start', () => {
  const dates = calendarDays('2026-09-26');
  expect(dates).toHaveLength(42);
  expect(new Set(dates).size).toBe(42);
  expect(dates[0]).toBe('2026-08-31');
  expect(dates[41]).toBe('2026-10-11');
  expect(dates.filter((day) => day?.startsWith('2026-09'))).toHaveLength(30);
});
