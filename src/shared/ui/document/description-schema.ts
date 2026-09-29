import { Node, type AnyExtension, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';

export const PRESERVED_BLOCK = 'preservedMarkdownBlock';
export const PRESERVED_INLINE = 'preservedMarkdownInline';
const READ_ONLY_TITLE = 'Read-only Markdown, kept exactly as written';

// Markdown the editor cannot represent is stored in an atom and written back byte for byte.
const markdownAttribute = {
  markdown: {
    default: '',
    rendered: false,
    parseHTML: (element: HTMLElement) => element.textContent ?? '',
  },
};
const renderPreserved = (node: JSONContent) => String(node.attrs?.markdown ?? '');
const PreservedMarkdownBlock = Node.create({
  name: PRESERVED_BLOCK,
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => markdownAttribute,
  parseHTML: () => [{ tag: 'div[data-preserved-markdown]' }],
  renderHTML: ({ node }) => [
    'div',
    { 'data-preserved-markdown': '', class: 'preserved-markdown', title: READ_ONLY_TITLE },
    String(node.attrs.markdown),
  ],
  renderMarkdown: renderPreserved,
});
const PreservedMarkdownInline = Node.create({
  name: PRESERVED_INLINE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => markdownAttribute,
  parseHTML: () => [{ tag: 'span[data-preserved-markdown]' }],
  renderHTML: ({ node }) => [
    'span',
    { 'data-preserved-markdown': '', class: 'preserved-markdown', title: READ_ONLY_TITLE },
    String(node.attrs.markdown),
  ],
  renderMarkdown: renderPreserved,
});
const { parseMarkdown: parseParagraph, renderMarkdown: renderParagraph } = Paragraph.config;
const DescriptionParagraph = Paragraph.extend({
  // Tiptap turns an image-only paragraph into a block image; images are inline, as in Markdown.
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0].type === 'image')
      return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens));
    return parseParagraph?.(token, helpers) ?? [];
  },
  // Paragraph text that starts like an ATX heading must stay a paragraph.
  renderMarkdown(node, helpers, context) {
    const markdown = renderParagraph?.(node, helpers, context) ?? '';
    return node.content?.[0]?.type === 'text' && /^#{1,6}(?=[ \t]|$)/.test(markdown)
      ? '\\' + markdown
      : markdown;
  },
});
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
}).configure({ inline: true });

/** The schema and Markdown rules shared by the description editor and its Markdown codec. */
export function descriptionExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      paragraph: false,
      link: { openOnClick: false, autolink: false },
      underline: false,
    }),
    DescriptionParagraph,
    TaskList,
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { 'data-type': 'taskItem' },
      a11y: { checkboxLabel: (node) => node.firstChild?.textContent || 'Task' },
    }),
    TableKit,
    SafeImage,
    PreservedMarkdownBlock,
    PreservedMarkdownInline,
  ];
}
