import { Fragment, type ReactNode, type RefObject } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, ChevronRight } from 'lucide-react';
import { ariaKeyShortcuts, devicePlatform } from '../lib/commands';
import { CommandKeycaps, useCommandBindings } from './keycap';
import type { Option } from './select';
/** A single choice among options, such as a task's status or assignee. */
export type MenuChoice = {
  value: string;
  options: Option[];
  onChoose: (value: string) => void | Promise<unknown>;
};
export type MenuAction = {
  label: string;
  /** Stable handle for callers that address one action, such as a hold on its matching control. */
  id?: string;
  onSelect?: () => void | Promise<unknown>;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  children?: MenuAction[];
  /** Menus render the choice as radio items; the preview toolbar renders it as a Picker. */
  choice?: MenuChoice;
  /** Promotes the action into the preview's compact toolbar with a short label and an icon. */
  toolbar?: { label: string; icon: ReactNode };
  /** Registry command (src/shared/lib/command-catalog.ts) whose keys this item shows. */
  command?: string;
};
export function MenuItems({
  items,
  run,
  disabled = false,
  container,
}: {
  items: MenuAction[];
  run: (item: MenuAction) => void;
  disabled?: boolean;
  /** Keeps nested menus inside the caller's layer (the preview) for focus and outside-press checks. */
  container?: RefObject<HTMLElement | null>;
}) {
  return items.map((item) => (
    <Fragment key={item.label}>
      {item.separatorBefore && <Menu.Separator className="action-menu-separator" />}
      {item.children || item.choice ? (
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger
            className="page-menu-item"
            disabled={disabled || item.disabled}
            label={item.label}
          >
            <span>{item.label}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </Menu.SubmenuTrigger>
          <Menu.Portal container={container}>
            <Menu.Positioner sideOffset={4} alignOffset={-4} className="page-menu-positioner">
              <Menu.Popup className="page-menu-popup" aria-label={item.label}>
                {item.choice ? (
                  <ChoiceItems
                    choice={item.choice}
                    run={run}
                    disabled={disabled || item.disabled}
                  />
                ) : (
                  <MenuItems
                    items={item.children ?? []}
                    run={run}
                    disabled={disabled || item.disabled}
                    container={container}
                  />
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.SubmenuRoot>
      ) : (
        <ActionItem item={item} run={run} disabled={disabled || item.disabled} />
      )}
    </Fragment>
  ));
}
function ActionItem({
  item,
  run,
  disabled,
}: {
  item: MenuAction;
  run: (item: MenuAction) => void;
  disabled?: boolean;
}) {
  const bindings = useCommandBindings(item.command ?? '');
  return (
    <Menu.Item
      label={item.label}
      className={'page-menu-item' + (item.danger ? ' action-danger' : '')}
      disabled={disabled}
      aria-keyshortcuts={ariaKeyShortcuts(bindings, devicePlatform)}
      onClick={() => run(item)}
    >
      {item.label}
      {item.command && <CommandKeycaps command={item.command} decorative />}
    </Menu.Item>
  );
}
function ChoiceItems({
  choice,
  run,
  disabled,
}: {
  choice: MenuChoice;
  run: (item: MenuAction) => void;
  disabled?: boolean;
}) {
  return (
    <Menu.RadioGroup value={choice.value}>
      {choice.options.map((option) => (
        <Menu.RadioItem
          key={option.value}
          value={option.value}
          label={option.label}
          closeOnClick
          className="page-menu-item page-menu-choice"
          disabled={disabled || option.disabled}
          onClick={() => {
            if (option.value !== choice.value)
              run({ label: option.label, onSelect: () => choice.onChoose(option.value) });
          }}
        >
          <span>{option.label}</span>
          <Menu.RadioItemIndicator className="page-menu-check">
            <Check size={13} />
          </Menu.RadioItemIndicator>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}
