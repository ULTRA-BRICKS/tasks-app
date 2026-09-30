import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui/react/menu';
import { Ellipsis, X } from 'lucide-react';
import { hasSelectedText, nativePressTarget, useHold } from '../lib/press-hold';
import { usePopupCollisionPadding } from '../lib/safe-area';
import { ActionMenu } from './action-menu';
import { MenuItems, type MenuAction } from './menu-items';
import { Picker } from './select';

const PreviewLayer = createContext<RefObject<HTMLDivElement | null> | null>(null);
/**
 * The open preview's portal layer, for popups opened from its content (a person card): portalled
 * there, they stack above the surface and a press inside them is not an outside press.
 */
export const usePreviewLayer = () => useContext(PreviewLayer);

type Point = { x: number; y: number };
type Placement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  transformOrigin: string;
};
/** Same breakpoint as the stylesheet's phone layout (max-width: 767px). */
const PHONE_WIDTH = 768;
const EDGE = 12;
const FAILURE = 'Action could not be confirmed. Check the result before retrying.';

/** Resolved `env(safe-area-inset-*)`; custom properties would keep the unresolved env() text. */
function safeArea() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const inset = {
    top: parseFloat(style.paddingTop),
    right: parseFloat(style.paddingRight),
    bottom: parseFloat(style.paddingBottom),
    left: parseFloat(style.paddingLeft),
  };
  probe.remove();
  return inset;
}

/**
 * Computed once per opening from the source rectangle: phones get a lifted card on the
 * bottom safe edge, wider screens a popover beside the source. The transform origin is the
 * source point, so the surface grows out of it and shrinks back into it.
 */
function placePreview(source: DOMRect, point: Point): Placement {
  const inset = safeArea();
  if (innerWidth < PHONE_WIDTH) {
    const left = inset.left + EDGE,
      bottom = inset.bottom + EDGE;
    return {
      left,
      width: innerWidth - inset.left - inset.right - EDGE * 2,
      bottom,
      // A strip of the page stays visible above the card, as with the reference sheets.
      maxHeight: innerHeight - inset.top - bottom - EDGE - 48,
      transformOrigin: `${point.x - left}px calc(100% - ${innerHeight - bottom - point.y}px)`,
    };
  }
  const width = Math.min(420, innerWidth - inset.left - inset.right - EDGE * 2);
  const left = Math.max(
    inset.left + EDGE,
    Math.min(source.right - width, innerWidth - inset.right - EDGE - width),
  );
  const below = innerHeight - inset.bottom - EDGE - (source.bottom + 8),
    above = source.top - 8 - inset.top - EDGE;
  if (below >= 320 || below >= above) {
    const top = source.bottom + 8;
    return {
      left,
      width,
      top,
      maxHeight: Math.min(560, below),
      transformOrigin: `${point.x - left}px ${point.y - top}px`,
    };
  }
  const edge = source.top - 8;
  return {
    left,
    width,
    bottom: innerHeight - edge,
    maxHeight: Math.min(560, above),
    transformOrigin: `${point.x - left}px calc(100% - ${edge - point.y}px)`,
  };
}

/**
 * Hold, Space, ellipsis click or hover opens a content-first preview whose toolbar, More menu,
 * right-click and Shift+F10 menu all come from the same `actions` (docs/TASK-PREVIEW.md).
 * Text keeps its native selection gesture.
 */
export function PressPreview({
  children,
  content,
  actions,
  label,
  dialogLabel = 'Preview',
  heading,
  menuLabel,
}: {
  children: ReactNode;
  content: ReactNode;
  actions: MenuAction[];
  label: string;
  dialogLabel?: string;
  heading?: ReactNode;
  /** Accessible name of the right-click / Shift+F10 menu. */
  menuLabel: string;
}) {
  const anchor = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    layer = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    sourcePosition = useRef<{ left: number; top: number } | null>(null),
    busy = useRef(false),
    // Whether the current press started while a popup opened from the content was open.
    pressOnContentPopup = useRef(false),
    hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [surface, setSurface] = useState<{
    state: 'open' | 'closing';
    placement: Placement;
  } | null>(null);
  const [highlighted, setHighlighted] = useState(-1),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [openMenu, setOpenMenu] = useState(-1);
  const press = useHold();
  const collisionPadding = usePopupCollisionPadding();
  const open = surface?.state === 'open';
  const tools: MenuAction[] = [
    ...actions.filter((action) => action.toolbar),
    {
      id: 'more',
      label: 'More actions',
      children: actions,
      toolbar: { label: 'More', icon: <Ellipsis size={17} /> },
    },
  ];
  const close = useCallback(
    (restoreFocus = false) => {
      press.cancel();
      clearTimeout(hoverTimer.current);
      setOpenMenu(-1);
      setHighlighted(-1);
      setError('');
      setSurface((current) =>
        current?.state === 'open' ? { ...current, state: 'closing' } : current,
      );
      if (restoreFocus)
        (returnFocus.current?.isConnected ? returnFocus.current : trigger.current)?.focus({
          preventScroll: true,
        });
    },
    [press],
  );
  const focusTool = (id?: string) =>
    requestAnimationFrame(() => {
      const index = Math.max(0, id ? tools.findIndex((tool) => tool.id === id) : 0);
      popup.current
        ?.querySelector<HTMLElement>(`[data-peek-action="${index}"]`)
        ?.focus({ preventScroll: true });
    });
  const show = (focus: boolean, point?: Point, focusId?: string) => {
    if (hasSelectedText() || !anchor.current) return;
    const source = (trigger.current ?? anchor.current).getBoundingClientRect();
    document.dispatchEvent(new CustomEvent('tickets:preview-open', { detail: anchor.current }));
    sourcePosition.current = { left: source.left, top: source.top };
    const active = document.activeElement;
    returnFocus.current =
      active instanceof HTMLElement && anchor.current.contains(active) ? active : null;
    setError('');
    // Reopening during the exit keeps the element and its placement: the running
    // transitions reverse from the current frame instead of restarting.
    setSurface((current) =>
      current
        ? { ...current, state: 'open' }
        : {
            state: 'open',
            placement: placePreview(
              source,
              point ?? {
                x: source.left + source.width / 2,
                y: source.top + source.height / 2,
              },
            ),
          },
    );
    if (focus) focusTool(focusId);
  };
  const run = async (select?: () => unknown) => {
    if (!select || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    const page = location.href;
    try {
      await select();
      // Navigation moves focus to the new page; everything else returns it to the source.
      close(location.href === page);
    } catch {
      setError(FAILURE);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const activate = (index: number) => {
    const tool = tools[index];
    if (!tool || tool.disabled || busy.current) return;
    if (tool.choice || tool.children) setOpenMenu(index);
    else void run(tool.onSelect);
  };
  const actionAt = (x: number, y: number) => {
    const control = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-peek-action]');
    return control && popup.current?.contains(control) ? Number(control.dataset.peekAction) : -1;
  };
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    press.pointerDown();
    const target = event.target as Element;
    // React bubbles portal events (the preview itself, the row's context menu) through this
    // element; only a press on the row's own DOM starts a hold.
    if (!anchor.current?.contains(target)) return;
    const matching = target.closest<HTMLElement>('[data-hold-action]');
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      nativePressTarget(target) ||
      hasSelectedText() ||
      // A mouse press on a control with its own action (the avatar picker) is a click.
      (matching
        ? event.pointerType === 'mouse'
        : target.closest('button:not([data-peek-trigger]):not(.issue-card-open):not(.issue-open)'))
    )
      return;
    clearTimeout(hoverTimer.current);
    const origin = { x: event.clientX, y: event.clientY };
    const control = target.closest<HTMLButtonElement>('[data-peek-trigger]');
    const focusId = matching?.dataset.holdAction;
    press.start(event.nativeEvent, {
      surface: anchor.current,
      capture: control,
      onHold: () => show(false, control ? undefined : origin),
      onSlide: (e) => setHighlighted(actionAt(e.clientX, e.clientY)),
      onRelease: (e) => {
        const index = actionAt(e.clientX, e.clientY);
        if (index >= 0) {
          e.preventDefault();
          activate(index);
        } else if (
          Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 14 &&
          !layer.current?.contains(document.elementFromPoint(e.clientX, e.clientY))
        )
          close();
        else focusTool(focusId);
      },
      onCancel: (held) => {
        if (held) close();
      },
    });
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  // The exit transition runs on the still-mounted surface; unmount once it has finished.
  useEffect(() => {
    if (surface?.state !== 'closing') return;
    let live = true;
    const finish = () => {
      if (live) setSurface((current) => (current?.state === 'closing' ? null : current));
    };
    void Promise.all((popup.current?.getAnimations() ?? []).map((a) => a.finished)).then(
      finish,
      finish,
    );
    return () => {
      live = false;
    };
  }, [surface?.state]);
  useEffect(() => {
    if (!open) return;
    const anotherPreview = (event: Event) => {
      if ((event as CustomEvent<Element>).detail !== anchor.current) close();
    };
    const outside = (e: Event) => {
      // A popup opened from the content (a person card) is the top layer: an outside press
      // closes only that popup, as Escape does. Unlike Escape, this skips the toolbar's pickers
      // and menus, which are part of the preview and close with it. Read at press start: the
      // popup closes itself on this press's click (mouse) or touchend (touch).
      pressOnContentPopup.current = Boolean(
        popup.current?.querySelector('.peek-content [data-popup-open]'),
      );
      const node = e.target as Node;
      if (
        !pressOnContentPopup.current &&
        !anchor.current?.contains(node) &&
        !layer.current?.contains(node)
      )
        close();
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the topmost layer: an open picker, menu or a popup opened from the
      // content (its trigger carries Base UI's data-popup-open) handles it first.
      if (openMenu !== -1 || popup.current?.querySelector('[data-popup-open]')) return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    // A link inside the preview (a person card's "View tasks") leaves the page it previews.
    // The router pushes history synchronously in the click handlers, hence the check after them.
    const page = location.href;
    const navigated = () => {
      if (location.href !== page) close();
    };
    const clicked = () => setTimeout(navigated);
    const resized = () => close();
    const scrolled = (event: Event) => {
      if (layer.current?.contains(event.target as Node)) return;
      const before = sourcePosition.current;
      const current = trigger.current?.getBoundingClientRect();
      // Scroll events queued before opening can arrive after the popup commits.
      // Only an actual anchor displacement invalidates the current placement.
      if (
        before &&
        current &&
        (Math.abs(before.left - current.left) > 1 || Math.abs(before.top - current.top) > 1)
      )
        close();
    };
    document.addEventListener('tickets:preview-open', anotherPreview);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('click', clicked, true);
    window.addEventListener('popstate', navigated);
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('blur', resized);
    return () => {
      document.removeEventListener('tickets:preview-open', anotherPreview);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('click', clicked, true);
      window.removeEventListener('popstate', navigated);
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('blur', resized);
    };
  }, [open, close, openMenu]);
  const closing = surface?.state === 'closing';
  return (
    <div
      ref={anchor}
      className="peek-anchor"
      onPointerDown={start}
      onClickCapture={(e) => {
        if (press.consumeClick(e.nativeEvent)) e.stopPropagation();
      }}
      onKeyDownCapture={(e) => {
        if (e.key === ' ' && (e.target as Element).closest('.issue-open, .issue-card-open')) {
          e.preventDefault();
          e.stopPropagation();
          show(true);
        }
      }}
    >
      {children}
      <button
        ref={trigger}
        type="button"
        className="peek-trigger"
        data-peek-trigger
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => show(true)}
        onPointerEnter={(e) => {
          // WebKit repeats pointerover around a click's pointer capture: re-arm, never stack.
          clearTimeout(hoverTimer.current);
          if (e.pointerType === 'mouse' && e.buttons === 0 && !open)
            hoverTimer.current = setTimeout(() => show(false), 500);
        }}
        onPointerLeave={() => clearTimeout(hoverTimer.current)}
      >
        <Ellipsis size={17} />
      </button>
      <ActionMenu label={menuLabel} items={actions} context={anchor} trigger={false} hold={false} />
      {surface &&
        createPortal(
          <div className="peek-layer" ref={layer}>
            <div
              className="peek-scrim"
              data-state={surface.state}
              aria-hidden="true"
              onClick={() => {
                if (!pressOnContentPopup.current) close(true);
              }}
            />
            <dialog
              open
              tabIndex={-1}
              ref={popup}
              aria-label={dialogLabel}
              aria-busy={pending}
              aria-hidden={closing || undefined}
              inert={closing}
              data-state={surface.state}
              className="peek-surface"
              style={surface.placement}
              onKeyDown={(e) => {
                const target = e.target as Element;
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) ||
                  target.closest(
                    '[role="menu"], [role="listbox"], input, textarea, [contenteditable="true"]',
                  )
                )
                  return;
                e.preventDefault();
                const controls = Array.from(
                  popup.current!.querySelectorAll<HTMLElement>('[data-peek-action]'),
                );
                const current = controls.indexOf(document.activeElement as HTMLElement);
                const back = e.key === 'ArrowLeft';
                // Focus outside the actions (the close button) enters at the first or last action.
                const from = current < 0 && back ? controls.length : current;
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? controls.length - 1
                      : (from + (back ? -1 : 1) + controls.length) % controls.length;
                controls[next]?.focus();
                setHighlighted(next);
              }}
            >
              <div className="peek-heading">
                <span>{heading ?? dialogLabel}</span>
                <button type="button" aria-label="Close preview" onClick={() => close(true)}>
                  <X size={15} />
                </button>
              </div>
              <div className="peek-content">
                <PreviewLayer.Provider value={layer}>{content}</PreviewLayer.Provider>
              </div>
              {error && (
                <p role="alert" className="peek-error">
                  {error}
                </p>
              )}
              <div
                className="peek-actions"
                role="toolbar"
                aria-label={`${dialogLabel} actions`}
                aria-orientation="horizontal"
              >
                {tools.map((tool, index) => {
                  const face = (
                    <>
                      {tool.toolbar!.icon}
                      <span className="peek-tool-label">{tool.toolbar!.label}</span>
                    </>
                  );
                  const control = {
                    'data-peek-action': index,
                    // Native disabled would drop keyboard focus to <body>; run() ignores repeats.
                    'aria-disabled': pending || tool.disabled,
                    className: 'peek-tool' + (highlighted === index ? ' is-highlighted' : ''),
                    onPointerEnter: () => setHighlighted(index),
                  };
                  // A late close from one tool must not close another tool's newly opened menu.
                  const toggle = (next: boolean) =>
                    setOpenMenu((current) =>
                      next && !busy.current && !tool.disabled
                        ? index
                        : current === index
                          ? -1
                          : current,
                    );
                  if (tool.choice) {
                    const { choice } = tool;
                    const current =
                      choice.options.find((option) => option.value === choice.value)?.label ?? '—';
                    return (
                      <Picker
                        key={tool.label}
                        aria-label={`${tool.label}: ${current}`}
                        value={choice.value}
                        options={choice.options}
                        onChange={(value) => {
                          if (value !== choice.value) void run(() => choice.onChoose(value));
                        }}
                        open={openMenu === index}
                        onOpenChange={toggle}
                        container={layer}
                        modal={false}
                        className={control.className}
                        triggerContent={face}
                        triggerProps={{
                          'data-peek-action': index,
                          'aria-disabled': control['aria-disabled'],
                          onPointerEnter: control.onPointerEnter,
                        }}
                      />
                    );
                  }
                  if (tool.children)
                    return (
                      <Menu.Root
                        key={tool.label}
                        open={openMenu === index}
                        onOpenChange={toggle}
                        modal={false}
                      >
                        <Menu.Trigger {...control} aria-label={tool.label}>
                          {face}
                        </Menu.Trigger>
                        <Menu.Portal container={layer}>
                          <Menu.Positioner
                            className="page-menu-positioner"
                            side="top"
                            align="center"
                            sideOffset={8}
                            collisionPadding={collisionPadding}
                          >
                            <Menu.Popup className="page-menu-popup" aria-label={tool.label}>
                              <MenuItems
                                items={tool.children}
                                run={(item) => void run(item.onSelect)}
                                disabled={pending}
                                container={layer}
                              />
                            </Menu.Popup>
                          </Menu.Positioner>
                        </Menu.Portal>
                      </Menu.Root>
                    );
                  return (
                    <button
                      key={tool.label}
                      type="button"
                      {...control}
                      aria-label={tool.label}
                      onClick={() => activate(index)}
                    >
                      {face}
                    </button>
                  );
                })}
              </div>
            </dialog>
          </div>,
          document.body,
        )}
    </div>
  );
}
