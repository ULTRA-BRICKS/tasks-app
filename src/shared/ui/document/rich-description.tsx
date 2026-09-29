import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { descriptionExtensions } from './description-schema';
import { loadDescription, saveDescription, type LoadedDescription } from './description-markdown';
export interface DescriptionProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  readOnly?: boolean;
  placeholder?: string;
}
/** The one rich surface for every description; unsupported Markdown stays inside it read-only. */
export default function RichDescription({
  value,
  onChange,
  onCommit,
  onEditStart,
  onEditEnd,
  readOnly = false,
  placeholder = 'Add description…',
}: DescriptionProps) {
  const [initial] = useState(() => loadDescription(value));
  const loaded = useRef<LoadedDescription>(initial);
  const emitted = useRef(value),
    original = useRef(value),
    canceled = useRef(false),
    surface = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    extensions: [...descriptionExtensions(), Placeholder.configure({ placeholder })],
    content: initial.doc,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'document-description markdown',
        role: 'textbox',
        'aria-label': 'Description',
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.key !== 'Escape') return false;
        event.preventDefault();
        event.stopPropagation();
        canceled.current = true;
        loaded.current = loadDescription(original.current);
        emitted.current = original.current;
        onChange(original.current);
        editor?.commands.setContent(loaded.current.doc, { emitUpdate: false });
        editor?.commands.blur();
        return true;
      },
    },
    onFocus: () => {
      onEditStart?.();
      original.current = value;
      canceled.current = false;
    },
    onUpdate: ({ editor: e }) => {
      emitted.current = saveDescription(loaded.current.baseline, e.state.doc);
      onChange(emitted.current);
    },
    onBlur: () => {
      if (!canceled.current) onCommit?.();
      onEditEnd?.();
      canceled.current = false;
    },
  });
  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor && value !== emitted.current && !editor.isFocused) {
      loaded.current = loadDescription(value);
      editor.commands.setContent(loaded.current.doc, { emitUpdate: false });
      emitted.current = value;
    }
  }, [editor, value]);
  // A checkbox toggle is a complete edit: Tiptap applies it on `change`, then it saves at once.
  useEffect(() => {
    const element = surface.current;
    if (!element || !onCommit) return;
    const toggled = (event: Event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'checkbox') return;
      if (!editor?.isEditable) return;
      original.current = emitted.current;
      onCommit();
    };
    element.addEventListener('change', toggled);
    return () => element.removeEventListener('change', toggled);
  }, [editor, onCommit]);

  return (
    <div className="document-editor" ref={surface}>
      <EditorContent editor={editor} />
    </div>
  );
}
