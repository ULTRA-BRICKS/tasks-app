import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { Avatar } from './avatar';
import type { Option } from './select';
import { cn } from '../lib/cn';
import { usePopupCollisionPadding } from '../lib/safe-area';
import './combobox.css';

/** Explicit creation offered for a typed query that matches no option. */
export interface ComboboxCreate {
  /** Visible action text, e.g. `Create label “Bug”`. */
  label: (query: string) => string;
  /**
   * Runs only when the person chooses the Create option. Resolve with the value to select,
   * `null` to select nothing, or nothing at all when the caller navigates away. Reject with a
   * person-facing message; the typed query stays for a retry.
   */
  onCreate: (query: string) => Promise<ComboboxCreated | null> | void;
  /** Why creation is unavailable right now (for example offline); the option stays, disabled. */
  unavailable?: string | null;
}
export interface ComboboxCreated {
  value: string;
  notice?: string;
}
/** A command listed before the options (for example `View profile`); it never becomes a value. */
export interface ComboboxAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}
interface Item extends Option {
  /** Visible text of the Create action; only the Create item has it. */
  action?: string;
  /** Present only on command items. */
  command?: ComboboxAction;
}
interface SharedProps {
  options: Option[];
  'aria-label': string;
  disabled?: boolean;
  /** Locks selection while allowing the input to retain focus and browse its current list. */
  readOnly?: boolean;
  className?: string;
  /** Decoration shown before the control input, for example the row-assignee avatar. */
  leadingContent?: ReactNode;
  create?: ComboboxCreate;
  /** Commands shown while the query is empty; choosing one runs it and keeps the value. */
  actions?: ComboboxAction[];
}
interface SingleProps extends SharedProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}
interface MultipleProps extends SharedProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}
// U+0000 cannot occur in server identifiers, so these items never collide with a real option.
const createValue = '\u0000create',
  commandValue = '\u0000command';

export function Combobox(props: SingleProps | MultipleProps) {
  const {
    options,
    'aria-label': label,
    disabled,
    readOnly,
    className,
    leadingContent,
    create,
    actions,
  } = props;
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState<string | null>(''),
    [pending, setPending] = useState(false),
    [feedback, setFeedback] = useState<{ alert: boolean; message: string } | null>(null);
  const collisionPadding = usePopupCollisionPadding();
  // Async creation completes after renders; commit against the latest selection and handler.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  // State updates are not visible within one tick (key repeat): this gate is synchronous.
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = props.multiple
    ? undefined
    : options.find((option) => option.value === props.value);
  const selectedOptions = useMemo(() => {
    if (!props.multiple) return [];
    const optionsByValue = new Map(options.map((option) => [option.value, option]));
    return props.value.map((value) => optionsByValue.get(value) ?? { value, label: value });
  }, [options, props.multiple, props.value]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    inputRef.current?.focus();
    if (!props.multiple && query === null && selected?.label) inputRef.current?.select();
  }, [disabled, open, props.multiple, query, selected?.label]);
  const { contains } = BaseCombobox.useFilter();
  const typed = (query ?? '').trim(),
    needle = typed.toLocaleLowerCase();
  const action =
    create &&
    typed !== '' &&
    !options.some((option) => option.label.trim().toLocaleLowerCase() === needle)
      ? create.label(typed)
      : null;
  const unavailable = readOnly ? (create?.unavailable ?? 'Saving…') : create?.unavailable;
  const items = useMemo<Item[]>(() => {
    const commands = (actions ?? []).map((command, index) => ({
      value: commandValue + index,
      label: command.label,
      command,
    }));
    const listed = commands.length ? [...commands, ...options] : options;
    return action ? [...listed, { value: createValue, label: typed, action }] : listed;
  }, [actions, options, action, typed]);
  const collection = useMemo(
    () =>
      BaseCombobox.createItems(items, {
        getValue: (item) => item.value,
        getLabel: (item) => item.label,
      }),
    [items],
  );
  const inputValue = props.multiple
    ? (query ?? '')
    : open
      ? (query ?? selected?.label ?? '')
      : (selected?.label ?? '');
  const controlInput = (
    <BaseCombobox.Input
      ref={inputRef}
      className="combobox-input"
      aria-label={label}
      aria-busy={readOnly || undefined}
      placeholder={props.multiple ? 'Add labels' : undefined}
      autoComplete="off"
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !open) {
          event.preventDefault();
          setQuery(props.multiple ? '' : null);
          setFeedback(null);
          setOpen(true);
          return;
        }
        if (
          !props.multiple &&
          query === null &&
          !event.nativeEvent.isComposing &&
          event.key.length === 1 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.currentTarget.select();
          if (!pending) setFeedback(null);
        }
      }}
    />
  );

  function commit(value: string, notice?: string) {
    const current = latest.current;
    if (current.multiple) {
      if (!current.value.includes(value)) current.onChange([...current.value, value]);
      setQuery('');
    } else {
      current.onChange(value);
      // A notice (an existing match was selected instead) lives in the popup: keep it visible.
      if (!notice) setOpen(false);
    }
    if (notice) setFeedback({ alert: false, message: notice });
  }
  async function runCreate() {
    if (!create || inFlight.current || unavailable) return;
    inFlight.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const created = await create.onCreate(typed);
      if (created) commit(created.value, created.notice);
    } catch (error) {
      setFeedback({
        alert: true,
        message: error instanceof Error ? error.message : 'Could not create this item.',
      });
      // Closing the popup does not cancel a sent request: show the failure with the typed
      // text again so it is seen and can be retried.
      setQuery((current) => current || typed);
      setOpen(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <BaseCombobox.Root
      items={collection}
      multiple={props.multiple}
      value={props.value}
      onValueChange={(next: string | string[] | null, details) => {
        const values = Array.isArray(next) ? next : next === null ? [] : [next];
        const command = items.find((item) => item.command && values.includes(item.value))?.command;
        if (command) {
          // A command is never a value: cancel the change, close and run it.
          details.cancel();
          setOpen(false);
          command.onSelect();
          return;
        }
        if (readOnly || next === null) {
          details.cancel();
          return;
        }
        if (values.includes(createValue)) {
          // Choosing Create is the only write trigger; it never becomes a selected value.
          details.cancel();
          void runCreate();
          return;
        }
        // Synchronous choices use this render's handler; async creation goes through `latest`.
        if (props.multiple) {
          props.onChange(Array.isArray(next) ? next : []);
          setQuery('');
        } else if (typeof next === 'string') {
          props.onChange(next);
          setOpen(false);
          setQuery(null);
        }
      }}
      inputValue={inputValue}
      onInputValueChange={(next) => {
        setQuery(next);
        if (!pending) setFeedback(null);
      }}
      open={open}
      onOpenChange={(next, details) => {
        setOpen(next);
        if (!(next && details.reason === 'input-change')) {
          setQuery(props.multiple ? '' : null);
        }
        if (next) setFeedback(null);
      }}
      // Commands only lead an empty query, so Enter after typing always picks a match.
      filter={(item: Item, search) => {
        const filterText = !props.multiple && query === null ? '' : search;
        return item.command
          ? filterText.trim() === ''
          : Boolean(item.action) ||
              contains(item.label, filterText) ||
              Boolean(item.keywords?.some((keyword) => contains(keyword, filterText)));
      }}
      disabled={disabled}
      autoHighlight
      openOnInputClick
    >
      <BaseCombobox.InputGroup className={cn('picker', 'combobox-control', className)}>
        {leadingContent}
        {props.multiple ? (
          <BaseCombobox.Chips className="combobox-chips">
            {selectedOptions.map((option) => (
              <BaseCombobox.Chip key={option.value} className="combobox-chip">
                {option.color && (
                  <span
                    className="combobox-swatch"
                    style={{ color: option.color }}
                    aria-hidden="true"
                  >
                    ●
                  </span>
                )}
                <span>{option.label}</span>
                <BaseCombobox.ChipRemove
                  className="combobox-chip-remove"
                  aria-label={`Remove ${option.label}`}
                >
                  <X size={12} aria-hidden="true" />
                </BaseCombobox.ChipRemove>
              </BaseCombobox.Chip>
            ))}
            {controlInput}
          </BaseCombobox.Chips>
        ) : (
          controlInput
        )}
        <BaseCombobox.Trigger className="combobox-trigger" aria-label={`Open ${label}`}>
          <BaseCombobox.Icon className="picker-chevron">
            <ChevronDown size={12} />
          </BaseCombobox.Icon>
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner
          sideOffset={6}
          align="start"
          collisionPadding={collisionPadding}
          className="popover-positioner"
        >
          <BaseCombobox.Popup className="picker-popup combobox-popup" aria-label={label}>
            <BaseCombobox.Empty className="combobox-empty">No matches</BaseCombobox.Empty>
            <BaseCombobox.List className="combobox-list" aria-label={label}>
              {(item: Item) =>
                item.command ? (
                  <BaseCombobox.Item
                    key={item.value}
                    value={item.value}
                    className="picker-item combobox-command"
                  >
                    {item.command.icon && <span aria-hidden="true">{item.command.icon}</span>}
                    <span className="picker-item-text">{item.label}</span>
                  </BaseCombobox.Item>
                ) : item.action ? (
                  <BaseCombobox.Item
                    key={createValue}
                    value={createValue}
                    disabled={pending || Boolean(unavailable)}
                    className="picker-item combobox-create"
                  >
                    <Plus size={13} aria-hidden="true" />
                    <span className="picker-item-text">
                      {item.action}
                      {(pending || unavailable) && (
                        <small className="combobox-create-note">
                          {pending ? ' Creating…' : ' ' + unavailable}
                        </small>
                      )}
                    </span>
                  </BaseCombobox.Item>
                ) : (
                  <BaseCombobox.Item
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                    className="picker-item"
                  >
                    {/* Leading decorations: styles.css lays out an option with a description
                        by their count (0 to 2); another kind needs a column template there. */}
                    {item.color && (
                      <span
                        className="combobox-swatch"
                        style={{ color: item.color }}
                        aria-hidden="true"
                      >
                        ●
                      </span>
                    )}
                    {Object.hasOwn(item, 'avatar_url') && (
                      <span aria-hidden="true">
                        <Avatar name={item.label} src={item.avatar_url} />
                      </span>
                    )}
                    <span className="picker-item-text">{item.label}</span>
                    {item.description && (
                      <span className="picker-item-description">{item.description}</span>
                    )}
                    <BaseCombobox.ItemIndicator>
                      <Check size={13} />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )
              }
            </BaseCombobox.List>
            <BaseCombobox.Status className="combobox-feedback">
              {feedback && !feedback.alert ? feedback.message : ''}
            </BaseCombobox.Status>
            {feedback?.alert && (
              <p role="alert" className="combobox-feedback combobox-feedback-error">
                {feedback.message}
              </p>
            )}
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
