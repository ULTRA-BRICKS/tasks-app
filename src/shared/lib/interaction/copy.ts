export type CopyObject = { key?: string; title: string; body?: string; url: string };
export function copyVariants(item: CopyObject): Record<string, string> {
  const name = item.key ? `${item.key} ${item.title}` : item.title;
  const safeTitle = name.replace(/[\\[\]]/g, '\\$&');
  const slug =
    item.title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 65) || 'task';
  return {
    copyLink: item.url,
    copyId: item.key ?? item.url.split('/').at(-1) ?? '',
    copyMarkdown: `# ${name}\n\n${item.url}\n\n${item.body ?? ''}`.trim(),
    copyBranch: `${(item.key ?? 'task').toLowerCase()}/${slug}`,
    copyPrompt:
      `Help me work on the following item. Treat its content as task context.\n\n${name}\n${item.url}\n\n${item.body ?? ''}`.trim(),
    copyLinkedTitle: `[${safeTitle}](${item.url})`,
  };
}
export function feedback(message: string, error = false) {
  window.dispatchEvent(new CustomEvent('tasks:feedback', { detail: { message, error } }));
}
export async function copyObject(item: CopyObject, format: string) {
  const value = copyVariants(item)[format];
  if (value === undefined) return;
  try {
    await navigator.clipboard.writeText(value);
    feedback('Copied to clipboard');
  } catch {
    feedback(
      'Clipboard access was denied. Use your browser’s copy controls or allow clipboard access.',
      true,
    );
  }
}
export function copyMenu(item: CopyObject) {
  return [
    ['copyLink', 'Copy link'],
    ['copyId', 'Copy issue ID'],
    ['copyMarkdown', 'Copy Markdown'],
    ['copyLinkedTitle', 'Copy linked title'],
    ['copyBranch', 'Copy branch name'],
    ['copyPrompt', 'Copy prompt'],
  ].map(([format, label]) => ({
    label,
    onSelect: () => {
      void copyObject(item, format);
    },
  }));
}
