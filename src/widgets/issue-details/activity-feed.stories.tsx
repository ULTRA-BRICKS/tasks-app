import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Activity } from '@tickets/contracts';
import { expect, userEvent, within } from 'storybook/test';
import { ActivityFeed } from './activity-feed';

// UB-100 (docs/TASK-ACTIVITY.md): one change reads as one line, grouped edits never get a heading.
let serial = 0;
const event = (minute: number, patch: Partial<Activity> = {}): Activity => ({
  id: `story-event-${++serial}`,
  actor_id: 'story-alex',
  actor_name: 'Alex Morgan',
  action: 'updated',
  summary: 'updated the task',
  changes: [],
  details: [],
  data: {},
  created_at: new Date(Date.UTC(2026, 8, 30, 10, minute)).toISOString(),
  ...patch,
});
const status = {
  kind: 'value',
  field: 'status',
  label: 'Status',
  from: 'Todo',
  to: 'Backlog',
} as const;
const description = {
  kind: 'text',
  field: 'description',
  label: 'Description',
  from: ['Goal', 'Ship on Monday', 'a', 'b', 'c', 'd', 'e', 'f', 'Owner: Sam'].join('\n'),
  to: ['Goal', 'Ship on Friday', 'a', 'b', 'c', 'd', 'e', 'f', 'Owner: Sam'].join('\n'),
} as const;
// Text of each line without decorative parts (avatar initials), whitespace collapsed. The e2e
// twin is tests/e2e/activity-lines.ts (it must run inside page.evaluate); keep the two in step.
const lineTexts = (entry: HTMLElement) =>
  within(entry)
    .getAllByTestId('activity-line')
    .map((line) => {
      const copy = line.cloneNode(true) as Element;
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
// The API returns newest first.
const newestFirst = (...events: Activity[]) => events.reverse();

// Vertical centres of every rendered text fragment and inline box inside `element`, including the
// time at the end of the first line: one line box means they all sit on the same line.
function lineCentres(element: Element) {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => rect.top + rect.height / 2);
}
async function expectOneLine(line: HTMLElement, time?: HTMLElement | null) {
  const centres = [...lineCentres(line), ...(time ? lineCentres(time) : [])];
  await expect(centres.length).toBeGreaterThan(0);
  await expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(4);
  const lineHeight = Number.parseFloat(getComputedStyle(line).lineHeight);
  await expect(line.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
}

const meta = {
  title: 'Widgets/Task activity',
  component: ActivityFeed,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <section className="detail-section activity-section" style={{ maxWidth: 680 }}>
        <Story />
      </section>
    ),
  ],
} satisfies Meta<typeof ActivityFeed>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SingleChange: Story = {
  args: { activity: [event(0, { changes: [status] })] },
  play: async ({ canvasElement }) => {
    const [entry] = within(canvasElement).getAllByTestId('activity-entry');
    const lines = within(entry).getAllByTestId('activity-line');
    await expect(lines).toHaveLength(1);
    await expect(lineTexts(entry)).toEqual(['Alex Morgan changed Status Todo → Backlog']);
    await expect(entry).not.toHaveTextContent('updated the task');
    await expectOneLine(lines[0], entry.querySelector('time'));
  },
};

export const GroupedChanges: Story = {
  args: {
    activity: newestFirst(
      event(0, { changes: [status] }),
      event(1, {
        changes: [
          {
            kind: 'value',
            field: 'assignee',
            label: 'Assignee',
            from: 'Unassigned',
            to: 'Jamie Chen',
            from_id: null,
            to_id: 'story-jamie',
          },
        ],
      }),
      event(2, {
        changes: [
          {
            kind: 'labels',
            field: 'labels',
            label: 'Labels',
            added: ['Bug'],
            removed: ['Backend'],
          },
        ],
      }),
      event(3, { changes: [description], details: ['reordered the task'] }),
    ),
  },
  play: async ({ canvasElement }) => {
    const entries = within(canvasElement).getAllByTestId('activity-entry');
    await expect(entries).toHaveLength(1);
    const [entry] = entries;
    await expect(entry).not.toHaveTextContent('updated the task');
    const lines = within(entry).getAllByTestId('activity-line');
    await expect(lineTexts(entry)).toEqual([
      'Alex Morgan changed Status Todo → Backlog',
      'changed Assignee Unassigned → Jamie Chen',
      'added label Bug and removed Backend',
      'edited the description View changes',
      'reordered the task',
    ]);
    // Only a person value carries an avatar.
    await expect(lines[0].querySelector('.avatar')).toBeNull();
    await expect(lines[1].querySelector('.activity-to .avatar')).toBeInTheDocument();
    await expect(lines[1].querySelector('.activity-from .avatar')).toBeNull();
    for (const [index, line] of lines.entries())
      await expectOneLine(line, index === 0 ? entry.querySelector('time') : null);
  },
};

export const DescriptionDiff: Story = {
  args: { activity: [event(0, { changes: [description] })] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [line] = canvas.getAllByTestId('activity-line');
    await expectOneLine(line, canvasElement.querySelector('time'));
    const toggle = canvas.getByRole('button', { name: 'View changes' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const diff = canvasElement.querySelector<HTMLElement>('.activity-diff')!;
    await expect(diff).toBeVisible();
    await expect(toggle).toHaveAccessibleName('Hide changes');
    await expect(within(diff).getByText('1 line removed, 1 line added')).toBeInTheDocument();
    await expect(diff.querySelector('del')).toHaveTextContent('Monday');
    await expect(diff.querySelector('ins')).toHaveTextContent('Friday');
    // Two lines of context stay visible; the rest collapses into a button that expands in place.
    await expect(diff).not.toHaveTextContent('Owner: Sam');
    const more = within(diff).getByRole('button', { name: 'Show 5 unchanged lines' });
    await userEvent.click(more);
    await expect(diff).toHaveTextContent('Owner: Sam');
    await expect(within(diff).queryByRole('button', { name: /unchanged line/ })).toBeNull();
    await userEvent.click(toggle);
    await expect(canvasElement.querySelector('.activity-diff')).toBeNull();
  },
};

// Same diff on the light theme: axe checks the token colours there too.
export const DescriptionDiffLight: Story = {
  ...DescriptionDiff,
  globals: { theme: 'light' },
};

export const ImportedHistory: Story = {
  args: {
    activity: newestFirst(
      event(0, {
        action: 'linear_imported_change',
        actor_source_id: 'story-linear-sam',
        actor_name: 'Sam Lee',
        changes: [
          { kind: 'text', field: 'description', label: 'Description', from: null, to: null },
        ],
      }),
      event(30, {
        action: 'linear_imported_change',
        actor_source_id: 'story-linear-sam',
        actor_name: 'Sam Lee',
        summary: 'archived the task',
        changes: [status],
      }),
    ),
  },
  play: async ({ canvasElement }) => {
    const entries = within(canvasElement).getAllByTestId('activity-entry');
    await expect(lineTexts(entries[0])).toEqual([
      'Sam Lee edited the description (Linear history does not include the text)',
    ]);
    await expect(lineTexts(entries[1])).toEqual([
      'Sam Lee archived the task',
      'changed Status Todo → Backlog',
    ]);
  },
};
