import { SourceEditor } from './source';
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
const SafeImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? '');
    const label = String(HTMLAttributes.alt || 'Attached image');
    return /^https?:\/\//i.test(src)
      ? [
          'a',
          { href: src, target: '_blank', rel: 'noopener noreferrer', class: 'external-image-link' },
          label,
        ]
      : ['span', { class: 'external-image-link' }, label];
  },
});
export interface DescriptionProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  readOnly?: boolean;
  placeholder?: string;
}
export default function RichDescription(props: DescriptionProps) {
  // Preserve unsupported markup literally rather than silently losing it on a rich-text edit.
  return /<!--|<\/?[a-z][^>]*>|\[\^[^\]]+\]|^\s{0,3}\[[^\]]+\]:/im.test(props.value) ? (
    <SourceDescription {...props} />
  ) : (
    <SupportedDescription {...props} />
  );
}
function SourceDescription(props: DescriptionProps) {
  return (
    <div className="source-preserved">
      <p className="section-hint">
        This description contains extended Markdown. Source editing preserves every element.
      </p>
      <SourceEditor {...props} />
    </div>
  );
}
function SupportedDescription({
  value,
  onChange,
  onCommit,
  onEditStart,
  onEditEnd,
  readOnly = false,
  placeholder = 'Add description…',
}: DescriptionProps) {
  const emitted = useRef(value),
    original = useRef(value),
    canceled = useRef(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false }, underline: false }),
      TaskList,
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { 'data-type': 'taskItem' },
        a11y: { checkboxLabel: (node) => node.firstChild?.textContent || 'Task' },
      }),
      TableKit,
      SafeImage,
      Markdown.configure({ markedOptions: { gfm: true } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    contentType: 'markdown',
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
        onChange(original.current);
        editor?.commands.setContent(original.current, {
          contentType: 'markdown',
          emitUpdate: false,
        });
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
      emitted.current = e.getMarkdown();
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
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
      emitted.current = value;
    }
  }, [editor, value]);

  return (
    <div className="document-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
