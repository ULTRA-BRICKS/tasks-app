import { lazy, Suspense } from 'react';
import { InlineTitle } from './title';
const RichDescription = lazy(() => import('./rich-description'));
export function DocumentText({
  title,
  description,
  onChange,
  onCommit,
  readOnly,
  titlePlaceholder,
}: {
  title: string;
  description: string;
  onChange: (field: 'title' | 'description', value: string) => void;
  onCommit?: () => void;
  readOnly?: boolean;
  titlePlaceholder?: string;
}) {
  return (
    <div className="document-text">
      <InlineTitle
        value={title}
        onChange={(v) => onChange('title', v)}
        onCommit={onCommit}
        readOnly={readOnly}
        placeholder={titlePlaceholder}
      />
      <Suspense
        fallback={
          <textarea
            className="document-source"
            aria-label="Description"
            placeholder="Add description…"
            value={description}
            readOnly={readOnly}
            onChange={(e) => onChange('description', e.target.value)}
            onBlur={onCommit}
          />
        }
      >
        <RichDescription
          value={description}
          onChange={(v) => onChange('description', v)}
          onCommit={onCommit}
          readOnly={readOnly}
        />
      </Suspense>
    </div>
  );
}
export { InlineTitle } from './title';
