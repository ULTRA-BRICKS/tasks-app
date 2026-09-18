import { ApiError } from '../api/client';
import { useEffect, useRef, useState, type RefObject, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@base-ui/react/menu';
import { Ellipsis, X } from 'lucide-react';
import { MenuItems, type MenuAction } from './menu-items';
export type { MenuAction } from './menu-items';
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
export function ActionMenu({
  label,
  items,
  className,
  triggerRef,
  triggerProps,
  onOpenChange,
}: {
  label: string;
  items: MenuAction[];
  className?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onOpenChange?: (open: boolean) => void;
}) {
  const action = useMenuActions();
  return (
    <>
      <Menu.Root onOpenChange={(open) => onOpenChange?.(open)}>
        <Menu.Trigger
          ref={triggerRef}
          type="button"
          className={className ?? 'button button-ghost button-icon page-menu-trigger'}
          aria-label={label}
          {...triggerProps}
        >
          <Ellipsis size={18} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="page-menu-positioner" sideOffset={8} align="end">
            <Menu.Popup className="page-menu-popup" aria-label={label}>
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
