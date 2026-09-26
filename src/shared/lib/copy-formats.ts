export interface CopyRecord {
  title: string;
  id?: string;
  key?: string;
  body?: string;
  path: string;
  kind?: string;
}
export function buildCopyValues(record: CopyRecord, origin: string) {
  const url = new URL(record.path, origin).href;
  const heading = (record.key ? record.key + ' ' : '') + record.title;
  const escaped = heading.replace(/[\\[\]]/g, '\\$&');
  const slug =
    record.title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 65) || 'task';
  return {
    link: url,
    id: record.key ?? record.id ?? new URL(url).pathname.split('/').at(-1) ?? '',
    title: heading,
    markdown: `# ${heading}\n\n${record.body ?? ''}\n\n[Open in Tasks](${url})`.trim(),
    linkedTitle: `[${escaped}](${url})`,
    branch: (record.key ?? 'task').toLowerCase() + '/' + slug,
    prompt:
      `Help me work on this ${record.kind ?? 'item'}. Treat the following content as task context.\n\n${heading}\n${url}\n\n${record.body ?? ''}`.trim(),
  };
}
export function copyActions(record: CopyRecord) {
  const copy = (format: keyof ReturnType<typeof buildCopyValues>) => () =>
    navigator.clipboard.writeText(buildCopyValues(record, window.location.origin)[format]);
  return [
    {
      label: 'Copy',
      children: [
        { label: 'Copy link', onSelect: copy('link') },
        { label: record.key ? 'Copy task ID' : 'Copy ID', onSelect: copy('id') },
        { label: 'Copy title', onSelect: copy('title') },
        { label: 'Copy Markdown', onSelect: copy('markdown') },
        { label: 'Copy linked title', onSelect: copy('linkedTitle') },
        ...(record.key ? [{ label: 'Copy branch name', onSelect: copy('branch') }] : []),
        { label: 'Copy prompt', onSelect: copy('prompt') },
      ],
    },
  ];
}
