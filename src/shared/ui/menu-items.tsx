import { Fragment } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight } from 'lucide-react';
import { usePopupCollisionPadding } from '../lib/safe-area';
export type MenuAction = {
  label: string;
  onSelect?: () => void | Promise<unknown>;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  children?: MenuAction[];
};
export function MenuItems({
  items,
  run,
  disabled = false,
}: {
  items: MenuAction[];
  run: (item: MenuAction) => void;
  disabled?: boolean;
}) {
  const collisionPadding = usePopupCollisionPadding();
  return items.map((item) => (
    <Fragment key={item.label}>
      {item.separatorBefore && <Menu.Separator className="action-menu-separator" />}
      {item.children ? (
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger
            className="page-menu-item"
            disabled={disabled || item.disabled}
            label={item.label}
          >
            <span>{item.label}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </Menu.SubmenuTrigger>
          <Menu.Portal>
            <Menu.Positioner
              sideOffset={4}
              alignOffset={-4}
              collisionPadding={collisionPadding}
              className="page-menu-positioner"
            >
              <Menu.Popup className="page-menu-popup" aria-label={item.label}>
                <MenuItems items={item.children} run={run} disabled={disabled || item.disabled} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.SubmenuRoot>
      ) : (
        <Menu.Item
          label={item.label}
          className={'page-menu-item' + (item.danger ? ' action-danger' : '')}
          disabled={disabled || item.disabled}
          onClick={() => run(item)}
        >
          {item.label}
        </Menu.Item>
      )}
    </Fragment>
  ));
}
