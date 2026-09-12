import { useLayoutEffect, useRef } from 'react';
export function InlineTitle({
  value,
  onChange,
  onCommit,
  onEditStart,
  onEditEnd,
  readOnly = false,
  placeholder = 'Issue title',
  maxLength = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const input = useRef<HTMLTextAreaElement>(null),
    original = useRef(value),
    canceled = useRef(false);
  useLayoutEffect(() => {
    if (input.current) {
      input.current.style.height = 'auto';
      input.current.style.height = `${input.current.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={input}
      className="document-title"
      aria-label="Title"
      rows={1}
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      maxLength={maxLength}
      onFocus={() => {
        onEditStart?.();
        original.current = value;
        canceled.current = false;
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onBlur={() => {
        if (!canceled.current) onCommit?.();
        onEditEnd?.();
        canceled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          canceled.current = true;
          onChange(original.current);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
