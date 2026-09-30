import { ImportedFileLinks, useImportedFiles, fileHref } from './imported-files';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};
// GFM produces disabled checkbox inputs without labels. Give them the actual
// task text, excluding nested tasks, without enabling raw HTML or adding a form.
function labelMarkdownTasks() {
  return (root: MarkdownNode) => {
    const taskNodes = (node: MarkdownNode): MarkdownNode[] =>
      ['ul', 'ol'].includes(node.tagName ?? '')
        ? []
        : [node, ...(node.children ?? []).flatMap(taskNodes)];
    const visit = (node: MarkdownNode) => {
      if (node.tagName === 'li') {
        const nodes = taskNodes(node);
        const label = nodes
          .filter((n) => n.type === 'text')
          .map((n) => n.value ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        for (const input of nodes.filter(
          (n) => n.tagName === 'input' && n.properties?.type === 'checkbox',
        )) {
          input.properties = { ...input.properties, ariaLabel: label || 'Task' };
        }
      }
      node.children?.forEach(visit);
    };
    visit(root);
  };
}
export function Markdown({ children }: { children: string }) {
  const files = useImportedFiles();
  const resolveHref = (href: string | undefined) => {
    const found = files.find((file) => file.source_url === href && file.status === 'ready');
    return found ? fileHref(found) : href;
  };
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[labelMarkdownTasks]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={resolveHref(href)} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // External images are not loaded automatically: avoids tracking pixels and arbitrary remote requests.
          img: ({ alt, src }) => (
            <a
              href={typeof src === 'string' ? resolveHref(src) : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              [Image: {alt || 'Open image'}]
            </a>
          ),
          // Same scroll region as the description editor's tables: a wide table scrolls on its
          // own instead of widening the page or breaking every word (docs/PHONE-OVERFLOW.md).
          table: ({ children }) => (
            <div className="tableWrapper">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
      <ImportedFileLinks text={children} />
    </div>
  );
}
