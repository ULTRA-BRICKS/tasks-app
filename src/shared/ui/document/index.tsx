import { ImportedFileLinks } from '../imported-files';
import { lazy, Suspense } from 'react';
import { InlineTitle } from './title';
const RichDescription = lazy(() => import('./rich-description'));
export function DocumentText({
  title,
  description,
  onChange,
  onCommit,
  onEditStart,
  onEditEnd,
  readOnly,
  titlePlaceholder,
  titleMaxLength,
  descriptionMaxLength,
}: {
  title: string;
  description: string;
  onChange: (field: 'title' | 'description', value: string) => void;
  onCommit?: () => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  readOnly?: boolean;
  titlePlaceholder?: string;
  titleMaxLength?: number;
  descriptionMaxLength?: number;
}) {
  return (
    <div className="document-text">
      <InlineTitle
        value={title}
        onChange={(v) => onChange('title', v)}
        onCommit={onCommit}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        readOnly={readOnly}
        placeholder={titlePlaceholder}
        maxLength={titleMaxLength}
      />
      <Suspense
        fallback={
          <output className="document-description" aria-busy="true">
            Loading description editor…
          </output>
        }
      >
        <RichDescription
          maxLength={descriptionMaxLength}
          value={description}
          onChange={(v) => onChange('description', v)}
          onCommit={onCommit}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          readOnly={readOnly}
        />
      </Suspense>
      <ImportedFileLinks text={description} />
    </div>
  );
}
export { InlineTitle } from './title';
