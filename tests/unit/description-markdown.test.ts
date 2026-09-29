import { test, expect } from 'bun:test';
import type { JSONContent } from '@tiptap/core';
import {
  descriptionSchema,
  loadDescription,
  saveDescription,
} from '../../src/shared/ui/document/description-markdown';

// Same Markdown syntax as the production UB-35 body (53e322fa-…); workspace wording replaced.
const UB35_SHAPED = [
  'Source: feedback-20260925-14',
  '',
  '## What',
  '',
  'Rename user-facing Issue/Issues wording across lists,creation,details and menus to Task/Tasks.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] Visible headings/buttons/toasts/labels and accessible names use Task/Tasks.',
  '- [ ] Legacy issue search words remain aliases where useful.',
  '- [ ] Do not rename compatible GraphQL Issue fields,REST /api/v1/issues or database tables.',
  '',
  '## Evidence and scope',
  '',
  'Related task-page example: [https://tasks.example.test/issues/a76cc660](<https://tasks.example.test/issues/a76cc660>) .',
  '',
  'Write tests that fail before fixes; update this task with verified results.',
].join('\n');

// The task CLI template: sections without text and a trailing newline.
const TEMPLATE_SHAPED = [
  '## What',
  'Descriptions with headings open as source.',
  '',
  '## Why (motivation)',
  '',
  '',
  '## User impact',
  '',
  '',
  '## Acceptance criteria',
  '- [ ] Headings render as rich text.',
  '- [x] Checkboxes toggle in place.',
  '',
  '## Deploy',
  'Deployed: no',
  '',
  '## Links',
  '- Relates to UB-78: https://tasks.example.test/issues/85f2adaa',
  '',
].join('\n');

// Constructs seen in Linear-imported and agent-written production bodies.
const LINEAR_SHAPED = [
  'Imported from Linear.',
  '',
  '* creation:',
  '',
  '  ![creation](https://uploads.linear.app/workspace/image-1)',
  '* details:',
  '',
  '  ![details](https://uploads.linear.app/workspace/image-2)',
  '',
  '\\## What is concretely wrong',
  '',
  'The route `/tasks/<CODE>` renders <Routes> twice; see [the PR](<https://git.example.test/pr/1>) and <https://git.example.test/pr/2>.',
  '',
  '| Field | Before | After |',
  '| --- | :-: | --: |',
  '| Title | **Issue** | *Task* |',
  '',
  '1) First step',
  '2) Second step',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
  '> Quote with a [reference link][guide] and a footnote.[^1]',
  '',
  '<!-- tasklib:msgref-quote:8982 -->',
  '',
  '[guide]: https://example.test/guide',
  '[^1]: Footnote text.',
].join('\n');

const blocks = (markdown: string) => loadDescription(markdown).doc.content ?? [];
const types = (markdown: string) => blocks(markdown).map((node) => node.type);
function atoms(node: JSONContent, found: string[] = []): string[] {
  if (node.type === 'preservedMarkdownBlock' || node.type === 'preservedMarkdownInline')
    found.push(node.type + ':' + String(node.attrs?.markdown));
  for (const child of node.content ?? []) atoms(child, found);
  return found;
}
function unchanged(markdown: string) {
  const loaded = loadDescription(markdown);
  return saveDescription(loaded.baseline, descriptionSchema.nodeFromJSON(loaded.doc));
}
// Applies an edit to the loaded JSON document, then saves it against the original baseline.
function edited(markdown: string, edit: (doc: JSONContent) => void) {
  const loaded = loadDescription(markdown);
  const doc: JSONContent = structuredClone(loaded.doc);
  edit(doc);
  return saveDescription(loaded.baseline, descriptionSchema.nodeFromJSON(doc));
}
function textOf(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(textOf).join('');
}
function findBlock(doc: JSONContent, predicate: (node: JSONContent) => boolean) {
  const found = (doc.content ?? []).find(predicate);
  if (!found) throw new Error('fixture block not found');
  return found;
}
function appendText(node: JSONContent, text: string) {
  const last = node.content?.at(-1);
  if (last?.type !== 'text' || last.marks) throw new Error('expected plain trailing text');
  last.text += text;
}

test('the UB-35 body opens as rich headings, a task list and paragraphs with no read-only parts', () => {
  expect(types(UB35_SHAPED)).toEqual([
    'paragraph',
    'heading',
    'paragraph',
    'heading',
    'taskList',
    'heading',
    'paragraph',
    'paragraph',
  ]);
  expect(atoms(loadDescription(UB35_SHAPED).doc)).toEqual([]);
  const tasks = blocks(UB35_SHAPED).find((node) => node.type === 'taskList');
  expect(tasks?.content?.map((item) => item.attrs?.checked)).toEqual([false, false, false]);
});

test('saving an unchanged document returns every fixture byte for byte', () => {
  for (const markdown of [UB35_SHAPED, TEMPLATE_SHAPED, LINEAR_SHAPED, '\n\nLeading blank lines\n'])
    expect(unchanged(markdown)).toBe(markdown);
});

test('empty sections of the task template stay rich headings and keep their blank lines', () => {
  expect(types(TEMPLATE_SHAPED)).toEqual([
    'heading',
    'paragraph',
    'heading',
    'heading',
    'heading',
    'taskList',
    'heading',
    'paragraph',
    'heading',
    'bulletList',
  ]);
  const result = edited(TEMPLATE_SHAPED, (doc) =>
    appendText(
      findBlock(doc, (node) => textOf(node) === 'Deployed: no'),
      ' (verified)',
    ),
  );
  expect(result).toBe(TEMPLATE_SHAPED.replace('Deployed: no', 'Deployed: no (verified)'));
});

test('Linear-imported constructs stay rich; only unsupported elements become read-only atoms', () => {
  expect(types(LINEAR_SHAPED)).toEqual([
    'paragraph',
    'bulletList',
    'paragraph',
    'paragraph',
    'table',
    'orderedList',
    'codeBlock',
    'blockquote',
    'preservedMarkdownBlock',
    'preservedMarkdownBlock',
    'preservedMarkdownBlock',
  ]);
  expect(atoms(loadDescription(LINEAR_SHAPED).doc)).toEqual([
    'preservedMarkdownInline:<Routes>',
    'preservedMarkdownInline:[reference link][guide]',
    'preservedMarkdownInline:[^1]',
    'preservedMarkdownBlock:<!-- tasklib:msgref-quote:8982 -->',
    'preservedMarkdownBlock:[guide]: https://example.test/guide',
    'preservedMarkdownBlock:[^1]: Footnote text.',
  ]);
  const images = blocks(LINEAR_SHAPED)[1].content?.map((item) => item.content?.length);
  expect(images).toEqual([2, 2]);
});

test('editing one paragraph leaves every other block byte-identical', () => {
  const result = edited(LINEAR_SHAPED, (doc) =>
    appendText(
      findBlock(doc, (node) => textOf(node) === 'Imported from Linear.'),
      ' Edited.',
    ),
  );
  expect(result).toBe(
    LINEAR_SHAPED.replace('Imported from Linear.', 'Imported from Linear. Edited.'),
  );
});

test('editing text around a read-only inline element keeps the element verbatim', () => {
  const result = edited(LINEAR_SHAPED, (doc) =>
    appendText(
      findBlock(doc, (node) => textOf(node).startsWith('The route')),
      ' Fixed.',
    ),
  );
  const line = result.split('\n').find((text) => text.startsWith('The route')) ?? '';
  expect(line).toContain(' <Routes> twice');
  expect(line.endsWith(' Fixed.')).toBe(true);
  expect(result.replace(line, '')).toBe(LINEAR_SHAPED.replace(LINEAR_SHAPED.split('\n')[11], ''));
});

test('toggling one checkbox changes exactly one line', () => {
  const result = edited(UB35_SHAPED, (doc) => {
    const list = findBlock(doc, (node) => node.type === 'taskList');
    const item = list.content?.[1];
    if (!item) throw new Error('missing task item');
    item.attrs = { ...item.attrs, checked: true };
  });
  expect(result).toBe(
    UB35_SHAPED.replace('- [ ] Legacy issue search words', '- [x] Legacy issue search words'),
  );
});

test('editing a heading saves only that heading', () => {
  const result = edited(UB35_SHAPED, (doc) =>
    appendText(
      findBlock(doc, (node) => node.type === 'heading' && textOf(node) === 'What'),
      ' changed',
    ),
  );
  expect(result).toBe(UB35_SHAPED.replace('## What\n', '## What changed\n'));
});

test('removing, adding and reordering blocks keeps separators valid and trailing whitespace', () => {
  const removed = edited(TEMPLATE_SHAPED, (doc) => {
    doc.content = doc.content?.filter((node) => textOf(node) !== 'User impact');
  });
  expect(removed).toBe(TEMPLATE_SHAPED.replace('## User impact\n\n\n', ''));
  const added = edited(UB35_SHAPED, (doc) => {
    doc.content?.push({ type: 'paragraph', content: [{ type: 'text', text: 'Appended.' }] });
  });
  expect(added).toBe(UB35_SHAPED + '\n\nAppended.');
  const moved = edited('# One\nfirst\n\n# Two\n', (doc) => {
    doc.content = [...(doc.content ?? [])].reverse();
  });
  expect(moved).toBe('# Two\n\nfirst\n\n# One\n');
});

test('deleting a read-only element is an explicit edit; untouched ones keep their bytes', () => {
  const result = edited(LINEAR_SHAPED, (doc) => {
    doc.content = doc.content?.filter(
      (node) => !String(node.attrs?.markdown ?? '').startsWith('<!--'),
    );
  });
  expect(result).toBe(LINEAR_SHAPED.replace('<!-- tasklib:msgref-quote:8982 -->\n\n', ''));
});

test('empty and whitespace-only descriptions open as one empty paragraph and save as empty', () => {
  for (const markdown of ['', '\n\n  \n']) {
    expect(types(markdown)).toEqual(['paragraph']);
    expect(unchanged(markdown)).toBe('');
  }
  expect(
    edited('', (doc) => {
      doc.content = [{ type: 'paragraph', content: [{ type: 'text', text: 'First words' }] }];
    }),
  ).toBe('First words');
});
