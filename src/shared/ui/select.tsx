import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';
export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}
export function Picker({
  value,
  onChange,
  options,
  'aria-label': label,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      items={options}
      disabled={disabled}
    >
      <Select.Trigger aria-label={label} className={cn('picker', className)}>
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
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
                  <Select.ItemText>{o.label}</Select.ItemText>
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
