import { test, expect } from 'bun:test';
import type { Activity, ActivityChange } from '../../packages/contracts/types.ts';
import {
  entryLines,
  groupActivity,
  labelPhrases,
} from '../../src/widgets/issue-details/activity-model.ts';
import { diffText } from '../../src/shared/lib/text-diff.ts';

let serial = 0;
const event = (minute: number, patch: Partial<Activity> = {}): Activity => ({
  id: `event-${++serial}`,
  actor_id: 'alex',
  actor_name: 'Alex',
  action: 'updated',
  summary: 'updated the task',
  changes: [{ kind: 'value', field: 'status', label: 'Status', from: 'A', to: 'B' }],
  details: [],
  data: {},
  created_at: new Date(Date.UTC(2026, 8, 29, 10, minute)).toISOString(),
  ...patch,
});
// The API returns newest first.
const newestFirst = (...events: Activity[]) => events.reverse();

test('consecutive updates by one person within ten minutes form one entry keeping every change', () => {
  const first = event(0),
    second = event(9, {
      changes: [{ kind: 'value', field: 'status', label: 'Status', from: 'B', to: 'C' }],
    }),
    third = event(20);
  const entries = groupActivity(newestFirst(first, second, third));
  expect(entries.map((entry) => entry.events.map((e) => e.id))).toEqual([
    [first.id, second.id],
    [third.id],
  ]);
  // Repeated edits of one field are not collapsed into a net change.
  expect(entries[0].events.flatMap((e) => e.changes)).toHaveLength(2);
  expect(entries[0].created_at).toBe(second.created_at);
});

test('another actor, a same-named imported person or a non-update event breaks a group', () => {
  const alex = event(0),
    sam = event(1, { actor_id: 'sam', actor_name: 'Sam' }),
    importedAlex = event(2, {
      actor_id: 'sam',
      actor_source_id: 'linear-alex',
      actor_name: 'Alex',
    }),
    comment = event(3, {
      actor_id: 'sam',
      actor_source_id: 'linear-alex',
      action: 'commented',
      summary: 'added a comment',
      changes: [],
    }),
    after = event(4, { actor_id: 'sam', actor_source_id: 'linear-alex', actor_name: 'Alex' });
  const entries = groupActivity(newestFirst(alex, sam, importedAlex, comment, after));
  expect(entries.map((entry) => entry.events.length)).toEqual([1, 1, 1, 1, 1]);
  expect(entries.map((entry) => entry.summary)).toEqual([
    'updated the task',
    'updated the task',
    'updated the task',
    'added a comment',
    'updated the task',
  ]);
});

test('only the newest entries are kept, oldest first', () => {
  const events = Array.from({ length: 12 }, (_, i) => event(i * 20, { actor_id: `person-${i}` }));
  const entries = groupActivity(newestFirst(...events), 8);
  expect(entries.map((entry) => entry.id)).toEqual(events.slice(4).map((e) => e.id));
});

// UB-100: an entry is one sentence per line, never an `updated the task` heading above its changes.
test('a single change is the whole entry: one change line and no summary heading', () => {
  const [entry] = groupActivity([event(0)]);
  expect(entryLines(entry)).toEqual([
    {
      kind: 'change',
      change: { kind: 'value', field: 'status', label: 'Status', from: 'A', to: 'B' },
    },
  ]);
});

test('grouped edits become one line per change, then their details, without a heading', () => {
  const labels: ActivityChange = {
      kind: 'labels',
      field: 'labels',
      label: 'Labels',
      added: ['Bug'],
      removed: [],
    },
    description: ActivityChange = {
      kind: 'text',
      field: 'description',
      label: 'Description',
      from: 'a',
      to: 'b',
    };
  const [entry] = groupActivity(
    newestFirst(
      event(0),
      event(1, { changes: [labels, description] }),
      event(2, { changes: [], details: ['reordered the task'] }),
    ),
  );
  expect(entryLines(entry).map((line) => (line.kind === 'note' ? line.text : line.change))).toEqual(
    [
      { kind: 'value', field: 'status', label: 'Status', from: 'A', to: 'B' },
      labels,
      description,
      'reordered the task',
    ],
  );
});

test('events without field changes read as their verb; another verb leads its changes', () => {
  const line = (patch: Partial<Activity>) => entryLines(groupActivity([event(0, patch)])[0]);
  expect(line({ changes: [], details: ['reordered the task'] })).toEqual([
    { kind: 'note', text: 'reordered the task' },
  ]);
  // A legacy row that recorded nothing presentable still says what happened.
  expect(line({ changes: undefined, details: undefined })).toEqual([
    { kind: 'note', text: 'updated the task' },
  ]);
  expect(line({ action: 'created', summary: 'created the task', changes: [] })).toEqual([
    { kind: 'note', text: 'created the task' },
  ]);
  expect(
    line({
      action: 'linear_imported_change',
      summary: 'archived the task',
      details: ['moved the task to trash'],
    }),
  ).toEqual([
    { kind: 'note', text: 'archived the task' },
    {
      kind: 'change',
      change: { kind: 'value', field: 'status', label: 'Status', from: 'A', to: 'B' },
    },
    { kind: 'note', text: 'moved the task to trash' },
  ]);
});

test('label changes read inline with singular and plural wording', () => {
  const labels = (added: string[], removed: string[]) =>
    labelPhrases({ kind: 'labels', field: 'labels', label: 'Labels', added, removed });
  expect(labels(['Bug'], [])).toEqual([{ verb: 'added label', names: ['Bug'] }]);
  expect(labels([], ['Backend', 'Search'])).toEqual([
    { verb: 'removed labels', names: ['Backend', 'Search'] },
  ]);
  expect(labels(['Bug', 'Frontend'], ['Backend'])).toEqual([
    { verb: 'added labels', names: ['Bug', 'Frontend'] },
    { verb: 'and removed', names: ['Backend'] },
  ]);
});

test('description diff marks changed lines and only the words that changed', () => {
  const rows = diffText('Intro\nShip on Monday\nOutro', 'Intro\nShip on Friday\nOutro\nNew line');
  expect(rows).toEqual([
    { type: 'same', parts: [{ type: 'same', text: 'Intro' }] },
    {
      type: 'removed',
      parts: [
        { type: 'same', text: 'Ship on ' },
        { type: 'removed', text: 'Monday' },
      ],
    },
    {
      type: 'added',
      parts: [
        { type: 'same', text: 'Ship on ' },
        { type: 'added', text: 'Friday' },
      ],
    },
    { type: 'same', parts: [{ type: 'same', text: 'Outro' }] },
    { type: 'added', parts: [{ type: 'added', text: 'New line' }] },
  ]);
});

test('description diff summarizes distant unchanged lines and handles empty and huge texts', () => {
  const body = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const changed = [...body];
  changed[10] = 'line ten';
  const rows = diffText(body.join('\n'), changed.join('\n'))!;
  // Collapsed context keeps its lines so the reader can expand them in place.
  expect(rows[0]).toEqual({ type: 'skip', lines: body.slice(0, 8) });
  expect(rows.at(-1)).toEqual({ type: 'skip', lines: body.slice(13) });
  expect(rows.filter((row) => row.type !== 'skip').map((row) => row.type)).toEqual([
    'same',
    'same',
    'removed',
    'added',
    'same',
    'same',
  ]);
  expect(diffText('', 'First')).toEqual([
    { type: 'added', parts: [{ type: 'added', text: 'First' }] },
  ]);
  expect(diffText('Gone', '')).toEqual([
    { type: 'removed', parts: [{ type: 'removed', text: 'Gone' }] },
  ]);
  // Line-ending conversions alone are not content changes.
  expect(diffText('a\r\nb', 'a\nb')).toEqual([{ type: 'skip', lines: ['a', 'b'] }]);
  const huge = (seed: string) => Array.from({ length: 1200 }, (_, i) => `${seed} ${i}`).join('\n');
  expect(diffText(huge('old'), huge('new'))).toBeNull();
  // A pasted document has no pairs to compare but would still render one row per line.
  const pasted = Array.from({ length: 4001 }, (_, i) => `pasted ${i}`).join('\n');
  expect(diffText('', pasted)).toBeNull();
  expect(diffText(pasted, '')).toBeNull();
});
