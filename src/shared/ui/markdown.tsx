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
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[labelMarkdownTasks]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // External images are not loaded automatically: avoids tracking pixels and arbitrary remote requests.
          img: ({ alt, src }) => (
            <a href={src} target="_blank" rel="noopener noreferrer">
              [Image: {alt || 'Open image'}]
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
