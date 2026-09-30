import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, within, waitFor } from 'storybook/test';
import { Popover } from '@base-ui/react/popover';
import { ArrowUpRight, CircleDashed, Copy, UserRound } from 'lucide-react';
import { ContextRow } from './action-menu';
import type { MenuAction } from './menu-items';
import { PressPreview, usePreviewLayer } from './press-preview';
const meta = {
  title: 'Design system/Preview actions',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
function Example() {
  const [log, setLog] = useState('None');
  const [status, setStatus] = useState('todo');
  const actions: MenuAction[] = [
    {
      id: 'open',
      label: 'Open task',
      onSelect: () => setLog('Opened'),
      toolbar: { label: 'Open', icon: <ArrowUpRight size={17} /> },
    },
    {
      id: 'status',
      label: 'Status',
      choice: {
        value: status,
        options: [
          { value: 'todo', label: 'Todo' },
          { value: 'doing', label: 'In progress' },
        ],
        onChoose: (value) => {
          setStatus(value);
          setLog('Status ' + value);
        },
      },
      toolbar: { label: 'Status', icon: <CircleDashed size={16} /> },
    },
    {
      id: 'assign',
      label: 'Assignee',
      disabled: true,
      choice: {
        value: 'none',
        options: [{ value: 'none', label: 'Unassigned' }],
        onChoose: () => {},
      },
      toolbar: { label: 'Assign', icon: <UserRound size={16} /> },
    },
    {
      id: 'copy',
      label: 'Copy',
      children: [
        { label: 'Copy link', onSelect: () => setLog('Copied link') },
        { label: 'Copy task ID', onSelect: () => setLog('Copied ID') },
      ],
      toolbar: { label: 'Copy', icon: <Copy size={16} /> },
    },
    {
      id: 'select',
      label: 'Select task',
      onSelect: () => setLog('Selected'),
      separatorBefore: true,
    },
  ];
  return (
    <div style={{ maxWidth: 420 }}>
      <PressPreview
        label="Preview TKT-7"
        dialogLabel="Task preview"
        heading="TKT-7"
        menuLabel="Actions for TKT-7"
        content={<h2>Keep the preview content first</h2>}
        actions={actions}
      >
        <div className="issue-row" style={{ minHeight: 44 }}>
          <button type="button" className="issue-open">
            Keep the preview content first
          </button>
        </div>
      </PressPreview>
      <output>{log}</output>
    </div>
  );
}
/**
 * The preview is still open. A closing preview is aria-hidden, so the dialog query no longer
 * finds it; checked once, not retried, because retrying could wait out a close. Visibility is
 * awaited because the 160 ms enter fade may not have painted a frame yet.
 */
async function expectOpen(preview: HTMLElement) {
  await expect(within(preview.ownerDocument.body).getAllByRole('dialog')).toContain(preview);
  await waitFor(() => expect(preview).toBeVisible());
}
export const Toolbar: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'Preview TKT-7' });
    await userEvent.click(trigger);
    const preview = await page.findByRole('dialog', { name: 'Task preview' });
    const toolbar = within(preview).getByRole('toolbar', { name: 'Task preview actions' });
    const open = within(toolbar).getByRole('button', { name: 'Open task' });
    await waitFor(() => expect(open).toHaveFocus());
    await userEvent.keyboard('{ArrowRight}');
    await expect(within(toolbar).getByRole('combobox', { name: 'Status: Todo' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    const more = within(toolbar).getByRole('button', { name: 'More actions' });
    await expect(more).toHaveFocus();
    // A disabled action stays focusable and announced, but does nothing.
    await expect(within(toolbar).getByRole('combobox', { name: /^Assignee/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Copy' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Copy task ID' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Copied ID'));
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const MoreMatchesContextMenu: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const title = canvas.getByRole('button', { name: 'Keep the preview content first' });
    await fireEvent.contextMenu(title, { clientX: 40, clientY: 40 });
    const context = await page.findByRole('menu', { name: 'Actions for TKT-7' });
    const labels = within(context)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    await expect(labels).toEqual(['Open task', 'Status', 'Assignee', 'Copy', 'Select task']);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole('button', { name: 'Preview TKT-7' }));
    const preview = await page.findByRole('dialog', { name: 'Task preview' });
    await userEvent.click(within(preview).getByRole('button', { name: 'More actions' }));
    const more = await page.findByRole('menu', { name: 'More actions' });
    await expect(
      within(more)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(labels);
    // Escape closes the menu first, then the preview.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await expectOpen(preview);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument());
  },
};
/** A layer opened from the preview content, such as a person card, portalled into the preview. */
function NestedCard() {
  const layer = usePreviewLayer();
  return (
    <Popover.Root>
      <Popover.Trigger className="button">Person</Popover.Trigger>
      <Popover.Portal container={layer ?? undefined}>
        <Popover.Positioner className="popover-positioner" sideOffset={6}>
          <Popover.Popup className="property-popup" aria-label="Person card">
            <p>Ada Lovelace</p>
            {/* Stands in for an SPA link: the router pushes a new history entry. */}
            <button type="button" onClick={() => history.pushState(null, '', '#person-tasks')}>
              View tasks
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
export const NestedLayer: Story = {
  render: () => (
    <PressPreview
      label="Preview TKT-7"
      dialogLabel="Task preview"
      menuLabel="Actions for TKT-7"
      content={<NestedCard />}
      actions={[
        {
          label: 'Open task',
          onSelect: () => undefined,
          toolbar: { label: 'Open', icon: <ArrowUpRight size={17} /> },
        },
      ]}
    >
      <div className="issue-row" style={{ minHeight: 44 }}>
        <button type="button" className="issue-open">
          Nested layers
        </button>
      </div>
    </PressPreview>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const start = location.href;
    await userEvent.click(canvas.getByRole('button', { name: 'Preview TKT-7' }));
    const preview = await page.findByRole('dialog', { name: 'Task preview' });
    // Opening focuses the first action on the next frame; the user presses after that.
    await waitFor(() =>
      expect(within(preview).getByRole('button', { name: 'Open task' })).toHaveFocus(),
    );
    await userEvent.click(within(preview).getByRole('button', { name: 'Person' }));
    const card = await page.findByRole('dialog', { name: 'Person card' });
    // A press inside the nested card is not an outside press for the preview.
    await userEvent.click(within(card).getByText('Ada Lovelace'));
    await expectOpen(preview);
    // Escape closes the topmost layer first.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Person card' })).toBeNull());
    await expectOpen(preview);
    // Navigating from inside the preview leaves the page it previews.
    await userEvent.click(within(preview).getByRole('button', { name: 'Person' }));
    try {
      await userEvent.click(await page.findByRole('button', { name: 'View tasks' }));
      await waitFor(() => expect(page.queryByRole('dialog', { name: 'Task preview' })).toBeNull());
    } finally {
      history.replaceState(null, '', start);
    }
  },
};
function TeamRow() {
  const [log, setLog] = useState('None');
  return (
    <div style={{ maxWidth: 280 }}>
      <ContextRow
        className="nav-action-row"
        label="Actions for Engineering"
        items={[
          { label: 'Open team tasks', onSelect: () => setLog('Opened team') },
          { label: 'Rename team', onSelect: () => setLog('Rename') },
        ]}
      >
        <button type="button" className="nav-item" onClick={() => setLog('Navigated')}>
          Engineering
        </button>
      </ContextRow>
      <output>{log}</output>
    </div>
  );
}
export const ContextRowKeyboard: Story = {
  render: () => <TeamRow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const row = canvas.getByRole('button', { name: 'Engineering' });
    row.focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await page.findByRole('menu', { name: 'Actions for Engineering' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(row).toHaveFocus());
    await fireEvent.contextMenu(row, { clientX: 30, clientY: 20 });
    await userEvent.click(await page.findByRole('menuitem', { name: 'Open team tasks' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Opened team'));
    // Finish the close transition: axe then checks the page without the menu's focus guards.
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
  },
};
