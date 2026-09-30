import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, expect, userEvent, within } from 'storybook/test';
import type { Issue } from '@tickets/contracts';
import { IssueRow, IssueCard } from './ui';
const issue: Issue = {
  id: '00000000-0000-4000-8000-000000000001',
  workspace_id: 'w',
  team_id: 't',
  key: 'TKT-42',
  number: 42,
  title: 'Preserve drafts when switching between issues',
  description: '',
  kind: 'issue',
  status_id: 's',
  status_name: 'In progress',
  status_category: 'started',
  status_color: '#dfc579',
  priority: 2,
  assignee_id: 'u',
  assignee_name: 'Jamie Chen',
  creator_id: 'u',
  project_id: null,
  project_name: null,
  cycle_id: null,
  milestone_id: null,
  parent_id: null,
  estimate: 3,
  start_date: null,
  due_date: '2026-09-18',
  position: 1024,
  version: 1,
  created_at: '2026-09-10T10:00:00Z',
  updated_at: '2026-09-10T10:00:00Z',
  archived_at: null,
  deleted_at: null,
  labels: [{ id: 'l', name: 'Improvement', color: '#a694ff' }],
  label_ids: ['l'],
};
const meta = {
  title: 'Entities/Issue row',
  component: IssueRow,
  args: { issue, onOpen: fn(), onSelect: fn(), selected: false, actions: [] },
} satisfies Meta<typeof IssueRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Preserve drafts/ }));
    await expect(args.onOpen).toHaveBeenCalledOnce();
  },
};
export const Selected: Story = { args: { selected: true } };
export const Unassigned: Story = {
  args: {
    issue: {
      ...issue,
      assignee_id: null,
      assignee_name: null,
      priority: 0,
      labels: [],
      label_ids: [],
    },
  },
};
export const LongTitle: Story = {
  args: {
    issue: {
      ...issue,
      title:
        'A very long title that must remain a single calm row without pushing the assignee or priority off the screen '.repeat(
          2,
        ),
    },
  },
};
export const ReadOnly: Story = { args: { canSelect: false } };
export const BoardCard: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <IssueCard issue={issue} onOpen={fn()} actions={[]} />
    </div>
  ),
};
