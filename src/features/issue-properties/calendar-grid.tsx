/* oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role -- WAI-ARIA calendar grid uses a semantic table with roving date-button focus. */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  calendarDays,
  calendarLabel,
  calendarWeekday,
  moveCalendarDay,
  moveCalendarMonth,
  todayCalendarDate,
} from '@/shared/lib/calendar-date';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function CalendarGrid({
  initial,
  selected,
  onChoose,
}: {
  initial: string;
  selected: string | null;
  onChoose: (day: string) => void;
}) {
  const [active, setActive] = useState(initial),
    grid = useRef<HTMLTableElement>(null),
    moveFocus = useRef(false),
    heading = useId();
  const dates = calendarDays(active),
    today = todayCalendarDate();
  useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      grid.current
        ?.querySelector<HTMLButtonElement>('[data-calendar-day="' + active + '"]')
        ?.focus({ preventScroll: true });
    }
  }, [active]);
  const onKey = (event: KeyboardEvent<HTMLTableElement>) => {
    let next: string;
    switch (event.key) {
      case 'ArrowLeft':
        next = moveCalendarDay(active, -1);
        break;
      case 'ArrowRight':
        next = moveCalendarDay(active, 1);
        break;
      case 'ArrowUp':
        next = moveCalendarDay(active, -7);
        break;
      case 'ArrowDown':
        next = moveCalendarDay(active, 7);
        break;
      case 'Home':
        next = moveCalendarDay(active, -calendarWeekday(active));
        break;
      case 'End':
        next = moveCalendarDay(active, 6 - calendarWeekday(active));
        break;
      case 'PageUp':
        next = moveCalendarMonth(active, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = moveCalendarMonth(active, event.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next !== active) {
      moveFocus.current = true;
      setActive(next);
    }
  };
  return (
    <>
      <div className="calendar-heading">
        <button
          type="button"
          aria-label="Previous month"
          disabled={active.startsWith('0001-01')}
          onClick={() => setActive(moveCalendarMonth(active, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <h3 id={heading} aria-live="polite">
          {calendarLabel(active, true)}
        </h3>
        <button
          type="button"
          aria-label="Next month"
          disabled={active.startsWith('9999-12')}
          onClick={() => setActive(moveCalendarMonth(active, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <table
        ref={grid}
        className="calendar-grid"
        role="grid"
        aria-labelledby={heading}
        onKeyDown={onKey}
      >
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th key={day} scope="col">
                <abbr title={day}>{day.slice(0, 2)}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>
              {dates.slice(week * 7, week * 7 + 7).map((day, column) => (
                <td key={day ?? column} aria-selected={day !== null && day === selected}>
                  {day && (
                    <button
                      type="button"
                      data-calendar-day={day}
                      data-outside={!day.startsWith(active.slice(0, 7))}
                      data-selected={day === selected}
                      aria-label={calendarLabel(day)}
                      aria-current={day === today ? 'date' : undefined}
                      tabIndex={day === active ? 0 : -1}
                      onClick={() => onChoose(day)}
                    >
                      {Number(day.slice(-2))}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
