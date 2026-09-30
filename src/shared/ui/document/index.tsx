import { ImportedFileLinks } from '../imported-files';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import type { DescriptionProps } from './rich-description';
import { InlineTitle } from './title';

let editorChunk: Promise<{ default: ComponentType<DescriptionProps> }> | undefined;
let loadedEditor: ComponentType<DescriptionProps> | undefined;
/** Loads the description editor chunk once and remembers the component once it has arrived. */
function loadEditor() {
  editorChunk ??= import('./rich-description').then((module) => {
    loadedEditor = module.default;
    return module;
  });
  return editorChunk;
}
const LazyRichDescription = lazy(loadEditor);

/**
 * False until the description editor chunk has settled, starting its download on first use.
 * A page with content below a `DocumentText` shows its loading state until then: swapping the
 * one-line placeholder for a long description would push that content down while someone is
 * already reading or tapping it (docs/PHONE-OVERFLOW.md). A failed download settles too, so its
 * error still surfaces through the editor.
 */
export function useDescriptionEditorReady(): boolean {
  const [ready, setReady] = useState(() => loadedEditor !== undefined);
  useEffect(() => {
    if (ready) return;
    let live = true;
    const settle = () => {
      if (live) setReady(true);
    };
    loadEditor().then(settle, settle);
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

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
}) {
  // A loaded editor renders at once: even a settled lazy component suspends for one commit and
  // shows the placeholder. Chosen once per mount, since switching from the lazy wrapper to the
  // loaded component would remount the editor.
  const [RichDescription] = useState(() => loadedEditor ?? LazyRichDescription);
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
