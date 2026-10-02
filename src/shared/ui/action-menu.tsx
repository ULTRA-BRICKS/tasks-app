import { Menu } from '@base-ui/react/menu';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
export type MenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  keys?: string[];
  separatorBefore?: boolean;
};
function Items({ items, context = false }: { items: MenuAction[]; context?: boolean }) {
  const Item = context ? ContextMenu.Item : Menu.Item;
  const Separator = context ? ContextMenu.Separator : Menu.Separator;
  return items.map((item) => (
    <span className="action-menu-entry" key={item.label}>
      {item.separatorBefore && <Separator className="action-menu-separator" />}
      <Item
        label={item.label}
        className={'page-menu-item' + (item.danger ? ' action-danger' : '')}
        disabled={item.disabled}
        onClick={item.onSelect}
      >
        <span>{item.label}</span>
        {item.keys && (
          <span className="action-keycaps" aria-hidden="true">
            {item.keys.map((key, i) => (
              <kbd key={i}>{key}</kbd>
            ))}
          </span>
        )}
      </Item>
    </span>
  ));
}
export function ActionMenu({ label, items }: { label: string; items: MenuAction[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        type="button"
        className="button button-ghost button-icon page-menu-trigger"
        aria-label={label}
      >
        <Ellipsis size={18} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="page-menu-positioner" sideOffset={8} align="end">
          <Menu.Popup className="page-menu-popup" aria-label={label}>
            <Items items={items} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function ContextActions({
  label,
  items,
  children,
  className = '',
  preserveTouchPreview = false,
}: {
  label: string;
  items: MenuAction[];
  children: ReactNode;
  className?: string;
  preserveTouchPreview?: boolean;
}) {
  const isEditor = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('input,textarea,[contenteditable="true"],[role="textbox"]'));
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        className={'context-action-row ' + className}
        onContextMenu={(e) => {
          if (isEditor(e.target) || window.getSelection()?.toString()) e.preventBaseUIHandler();
        }}
        onPointerDown={(e) => {
          if (isEditor(e.target) || (preserveTouchPreview && e.pointerType === 'touch'))
            e.preventBaseUIHandler();
        }}
        onKeyDown={(e) => {
          if (!isEditor(e.target) && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget
              .querySelector<HTMLButtonElement>(':scope > .page-menu-trigger')
              ?.click();
          }
        }}
      >
        {children}
        <ActionMenu label={label} items={items} />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="page-menu-positioner">
          <ContextMenu.Popup className="page-menu-popup" aria-label={label}>
            <Items items={items} context />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
