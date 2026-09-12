import { Menu } from '@base-ui/react/menu';
import { Ellipsis } from 'lucide-react';

export function ActionMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; disabled?: boolean }[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="button button-ghost button-icon page-menu-trigger"
        aria-label={label}
      >
        <Ellipsis size={18} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="page-menu-positioner" sideOffset={8} align="end">
          <Menu.Popup className="page-menu-popup" aria-label={label}>
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                className="page-menu-item"
                disabled={item.disabled}
                onClick={item.onSelect}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
