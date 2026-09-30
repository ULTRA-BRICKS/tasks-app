import { useId, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/shared/ui';
import { parseCalendarDate, todayCalendarDate } from '@/shared/lib/calendar-date';
import { usePopupCollisionPadding } from '@/shared/lib/safe-area';
import { CalendarGrid } from './calendar-grid';
import './date-property.css';
export function DateProperty({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const [draft, setDraft] = useState({ observed: value, text: value ?? '', changed: false });
  const anchor = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    popup = useRef<HTMLDivElement>(null),
    keepInputFocus = useRef(false);
  const collisionPadding = usePopupCollisionPadding();
  const popupId = useId(),
    hintId = useId(),
    errorId = useId();
  if (draft.observed !== value) {
    const adopt = !draft.changed || draft.text === (value ?? '');
    setDraft({ observed: value, text: adopt ? (value ?? '') : draft.text, changed: !adopt });
  }
  if (disabled && open) setOpen(false);
  const cancel = () => {
    setDraft({ observed: value, text: value ?? '', changed: false });
    setError('');
    setOpen(false);
  };
  const commit = (text: string) => {
    if (disabled) return;
    const trimmed = text.trim(),
      date = trimmed ? parseCalendarDate(trimmed) : null;
    if (trimmed && !date) {
      setError('Enter a real date in YYYY-MM-DD format.');
      return;
    }
    setError('');
    setDraft({ observed: value, text: date ?? '', changed: date !== value });
    setOpen(false);
    if (date !== value) onChange(date);
  };
  const showFromInput = () => {
    if (!disabled) {
      keepInputFocus.current = true;
      setOpen(true);
    }
  };
  const initial = parseCalendarDate(draft.text) || todayCalendarDate();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div ref={anchor} className="date-inline compact-property" data-disabled={disabled}>
        <Popover.Trigger
          type="button"
          disabled={disabled}
          className="date-calendar-trigger"
          aria-label={'Open ' + label.toLowerCase() + ' calendar'}
          onPointerDown={() => {
            keepInputFocus.current = false;
          }}
          onKeyDown={() => {
            keepInputFocus.current = false;
          }}
        >
          <CalendarDays size={16} />
        </Popover.Trigger>
        <Input
          ref={input}
          type="text"
          aria-label={label}
          placeholder={'Set ' + label.toLowerCase()}
          value={draft.text}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hintId}
          aria-haspopup="dialog"
          aria-controls={open ? popupId : undefined}
          onChange={(event) => {
            setDraft((old) => ({ ...old, text: event.target.value, changed: true }));
            setError('');
          }}
          onClick={showFromInput}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (
              next instanceof Node &&
              (anchor.current?.contains(next) || popup.current?.contains(next))
            )
              return;
            if (draft.changed) commit(draft.text);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              commit(event.currentTarget.value);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              keepInputFocus.current = false;
              if (open)
                popup.current
                  ?.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"]')
                  ?.focus();
              else setOpen(true);
            }
          }}
        />
        <span id={hintId} className="sr-only">
          Use YYYY-MM-DD. Enter saves, Escape cancels, Down arrow opens the calendar.
        </span>
        {error && (
          <span id={errorId} className="date-input-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          sideOffset={6}
          align="start"
          collisionPadding={collisionPadding}
          className="calendar-positioner"
        >
          <Popover.Popup
            ref={popup}
            id={popupId}
            className="date-calendar-popup"
            aria-label={label + ' calendar'}
            initialFocus={() =>
              keepInputFocus.current
                ? false
                : (popup.current?.querySelector<HTMLElement>('[data-calendar-day][tabindex="0"]') ??
                  true)
            }
            finalFocus={input}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          >
            <Popover.Title className="sr-only">{label} calendar</Popover.Title>
            <CalendarGrid
              key={initial}
              initial={initial}
              selected={parseCalendarDate(draft.text)}
              onChoose={commit}
            />
            <div className="calendar-footer">
              <button type="button" onClick={() => commit(todayCalendarDate())}>
                Today
              </button>
              {(value || draft.text) && (
                <button type="button" onClick={() => commit('')}>
                  Clear date
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
