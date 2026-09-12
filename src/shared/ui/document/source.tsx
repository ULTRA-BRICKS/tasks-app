import { useRef } from 'react';
export interface SourceProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  readOnly?: boolean;
  placeholder?: string;
}
/** Used by extended Markdown and the lazy-editor fallback alike. */
export function SourceEditor({
  value,
  onChange,
  onCommit,
  onEditStart,
  onEditEnd,
  readOnly,
  placeholder = 'Add description…',
}: SourceProps) {
  const original = useRef(value),
    canceled = useRef(false);
  return (
    <textarea
      className="document-source"
      aria-label="Description"
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      maxLength={100000}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        original.current = value;
        canceled.current = false;
        onEditStart?.();
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        canceled.current = true;
        onChange(original.current);
        e.currentTarget.blur();
      }}
      onBlur={() => {
        if (!canceled.current) onCommit?.();
        canceled.current = false;
        onEditEnd?.();
      }}
    />
  );
}
