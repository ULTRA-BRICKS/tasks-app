import type { ButtonHTMLAttributes, ReactNode, RefObject } from 'react';
import { Avatar } from './avatar';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { usePopupCollisionPadding } from '../lib/safe-area';
export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
  avatar_url?: string | null;
  /** Label colour, shown as a swatch beside searchable options. */
  color?: string;
  /** Secondary text that tells otherwise identical labels apart. */
  description?: string;
  /** More search terms for a searchable picker (another name, an email); never shown. */
  keywords?: readonly string[];
}
export function Picker({
  value,
  onChange,
  options,
  'aria-label': label,
  disabled,
  className,
  triggerContent,
  open,
  onOpenChange,
  container,
  modal,
  triggerProps,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  'aria-label': string;
  disabled?: boolean;
  className?: string;
  triggerContent?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders the list inside a caller's layer, e.g. the preview, instead of the body. */
  container?: RefObject<HTMLElement | null>;
  modal?: boolean;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement> &
    Record<`data-${string}`, string | number>;
}) {
  const collisionPadding = usePopupCollisionPadding();
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      items={options}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange && ((next) => onOpenChange(next))}
      modal={modal}
    >
      <Select.Trigger aria-label={label} className={cn('picker', className)} {...triggerProps}>
        {triggerContent ?? <Select.Value />}
        <Select.Icon className="picker-chevron">
          <ChevronDown size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Positioner
          sideOffset={6}
          collisionPadding={collisionPadding}
          alignItemWithTrigger={false}
          className="popover-positioner"
        >
          <Select.Popup className="picker-popup">
            <Select.List aria-label={label}>
              {options.map((o) => (
                <Select.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="picker-item"
                >
                  {Object.hasOwn(o, 'avatar_url') && (
                    <span aria-hidden="true">
                      <Avatar name={o.label} src={o.avatar_url} />
                    </span>
                  )}
                  <Select.ItemText className="picker-item-text">{o.label}</Select.ItemText>
                  {o.description && (
                    <span className="picker-item-description">{o.description}</span>
                  )}
                  <Select.ItemIndicator>
                    <Check size={13} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
