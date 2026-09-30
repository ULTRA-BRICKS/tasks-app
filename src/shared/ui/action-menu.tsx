import { ApiError } from '../api/client';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui/react/menu';
import { Ellipsis, X } from 'lucide-react';
import { hasSelectedText, nativePressTarget, useHold } from '../lib/press-hold';
import { MenuItems, type MenuAction } from './menu-items';
import { usePopupCollisionPadding } from '../lib/safe-area';
export type { MenuAction, MenuChoice } from './menu-items';
type PointAnchor = { getBoundingClientRect: () => DOMRect };
const editable = 'input, textarea, select, [contenteditable="true"]';
function useMenuActions() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = (item: MenuAction) => {
    const select = item.onSelect;
    if (item.disabled || !select || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    void (async () => {
      try {
        await select();
      } catch (failure) {
        if (mounted.current)
          setError(
            failure instanceof ApiError && failure.code === 'VERSION_CONFLICT'
              ? 'This object changed elsewhere. Refresh it before trying again.'
              : failure instanceof ApiError && failure.status === 403
                ? 'You do not have permission to perform this action.'
                : 'The action could not be confirmed. Check the result before retrying.',
          );
      } finally {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
  };
  return { run, busy, error, dismiss: () => setError('') };
}
/**
 * The shared contextual menu. With `context`, right-click, Shift+F10/ContextMenu and (unless
 * `hold` is false) a press-and-hold on that area open the same items as the visible ellipsis.
 */
export function ActionMenu({
  label,
  items,
  className,
  triggerRef,
  triggerProps,
  onOpenChange,
  context,
  trigger = true,
  hold = true,
}: {
  label: string;
  items: MenuAction[];
  className?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onOpenChange?: (open: boolean) => void;
  context?: RefObject<HTMLElement | null>;
  /** False when another control (the preview's More) is the visible entry point. */
  trigger?: boolean;
  hold?: boolean;
}) {
  const action = useMenuActions();
  const collisionPadding = usePopupCollisionPadding();
  const [open, setOpen] = useState(false),
    [anchor, setAnchor] = useState<Element | PointAnchor | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null),
    notify = useRef(onOpenChange);
  useEffect(() => {
    notify.current = onOpenChange;
  });
  const press = useHold();
  useEffect(() => {
    const area = context?.current;
    if (!area) return;
    let pointerType = '';
    const openAt = (at: Element | PointAnchor, focus: HTMLElement | null) => {
      returnFocus.current = focus;
      setAnchor(at);
      setOpen(true);
      notify.current?.(true);
    };
    const atPoint = (x: number, y: number): PointAnchor => ({
      getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    });
    const focusedInside = () => {
      const active = document.activeElement;
      return active instanceof HTMLElement && area.contains(active) ? active : null;
    };
    const contextmenu = (event: MouseEvent) => {
      const target = event.target as Element;
      // Editing and an existing text selection keep the browser's own menu (copy, spelling).
      if (target.closest(editable) || hasSelectedText()) return;
      // A touch long-press also fires contextmenu (Android). The hold gesture owns touch, except
      // on a link, where it never starts (nativePressTarget): that press keeps the browser's link
      // menu, and the visible ellipsis the actions.
      const type = (event as Partial<PointerEvent>).pointerType || pointerType;
      if (type === 'touch' || type === 'pen') {
        if (!target.closest('a')) event.preventDefault();
        return;
      }
      event.preventDefault();
      openAt(atPoint(event.clientX, event.clientY), focusedInside());
    };
    const keydown = (event: KeyboardEvent) => {
      if (!((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) return;
      const target = event.target as HTMLElement;
      if (target.closest(editable)) return;
      event.preventDefault();
      event.stopPropagation();
      openAt(target, target);
    };
    const pointerdown = (event: PointerEvent) => {
      press.pointerDown();
      pointerType = event.pointerType;
      const target = event.target as Element;
      if (
        !hold ||
        !event.isPrimary ||
        event.button !== 0 ||
        nativePressTarget(target) ||
        hasSelectedText() ||
        target.closest('.page-menu-trigger')
      )
        return;
      const { clientX: x, clientY: y } = event;
      press.start(event, { surface: area, onHold: () => openAt(atPoint(x, y), null) });
    };
    const click = (event: MouseEvent) => {
      if (press.consumeClick(event)) event.stopPropagation();
    };
    area.addEventListener('contextmenu', contextmenu);
    area.addEventListener('keydown', keydown);
    area.addEventListener('pointerdown', pointerdown);
    area.addEventListener('click', click, true);
    return () => {
      press.cancel();
      area.removeEventListener('contextmenu', contextmenu);
      area.removeEventListener('keydown', keydown);
      area.removeEventListener('pointerdown', pointerdown);
      area.removeEventListener('click', click, true);
    };
  }, [context, hold, press]);
  return (
    <>
      <Menu.Root
        open={open}
        onOpenChange={(next) => {
          // The visible trigger anchors its own menu; context openings set their anchor first.
          if (next) {
            setAnchor(null);
            returnFocus.current = null;
          }
          setOpen(next);
          notify.current?.(next);
        }}
      >
        {trigger ? (
          <Menu.Trigger
            ref={triggerRef}
            type="button"
            className={className ?? 'button button-ghost button-icon page-menu-trigger'}
            aria-label={label}
            {...triggerProps}
          >
            <Ellipsis size={18} />
          </Menu.Trigger>
        ) : (
          // Base UI registers the menu in its floating tree through a trigger; without one an
          // opening submenu reads as a sibling menu and closes the whole menu. Never shown; the
          // popup takes its accessible name from this trigger (aria-labelledby).
          <Menu.Trigger type="button" hidden aria-hidden tabIndex={-1} aria-label={label} />
        )}
        <Menu.Portal>
          <Menu.Positioner
            className="page-menu-positioner"
            sideOffset={anchor ? 4 : 8}
            align={anchor ? 'start' : 'end'}
            collisionPadding={collisionPadding}
            anchor={anchor ?? undefined}
          >
            <Menu.Popup
              className="page-menu-popup"
              aria-label={label}
              // Focus returns to the focused source of a context opening, else to the visible
              // trigger; a context-only menu's hidden trigger is not focusable, so it is skipped.
              finalFocus={() => returnFocus.current ?? trigger}
            >
              <MenuItems items={items} run={action.run} disabled={action.busy} />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {action.error &&
        createPortal(
          <div className="action-menu-error" role="alert">
            <span>{action.error}</span>
            <button type="button" aria-label="Dismiss action error" onClick={action.dismiss}>
              <X size={14} />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
/** A row whose visible ellipsis, right-click, Shift+F10 and hold open the same actions. */
export function ContextRow({
  className,
  label,
  items,
  children,
}: {
  className: string;
  label: string;
  items: MenuAction[];
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <div ref={row} className={className}>
      {children}
      <ActionMenu label={label} items={items} context={row} />
    </div>
  );
}
