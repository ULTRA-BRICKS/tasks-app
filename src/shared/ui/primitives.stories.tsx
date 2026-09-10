import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { Button, Input, Picker, Modal, Avatar, ErrorState, EmptyState, Markdown } from './index';
const meta = { title: 'Design system/Primitives', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Buttons: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Button variant="default">Create issue</Button>
      <Button>Save view</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Revoke token</Button>
      <Button disabled>Saving…</Button>
    </div>
  ),
};
export const People: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      <Avatar name="Alex Morgan" />
      <Avatar name="Jamie Chen" />
      <Avatar name="Sam Rivera" />
      <Avatar name={null} />
      <Avatar name="Taylor Park" size="md" />
    </div>
  ),
};
export const Empty: Story = {
  render: () => (
    <EmptyState
      title="You're all caught up"
      description="Assignments, comments, and updates will appear here."
    />
  ),
};
export const Failure: Story = {
  render: () => (
    <ErrorState message="This item changed. Reload the current version before saving." />
  ),
};
export const LongMarkdown: Story = {
  render: () => (
    <Markdown>
      {
        '# A useful issue\n\n## Acceptance criteria\n- [x] Works with a keyboard\n- [ ] Preserves a local draft\n\n| State | Expected |\n|---|---|\n| Error | Keep draft |\n\n**Bold**, `code`, and [safe links](https://example.com).\n\n<script>alert(1)</script>\n\n![External image](https://example.com/tracking.png)'
      }
    </Markdown>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'A useful issue' })).toBeVisible();
    await expect(canvasElement.querySelector('script')).toBeNull();
    await expect(canvasElement.querySelector('img')).toBeNull();
  },
};
function InteractivePicker() {
  const [value, setValue] = useState('todo');
  return (
    <>
      <Picker
        aria-label="Status"
        value={value}
        onChange={setValue}
        options={[
          { value: 'todo', label: 'Todo' },
          { value: 'started', label: 'In progress' },
          { value: 'done', label: 'Done' },
        ]}
      />
      <p data-testid="selected-status">{value}</p>
    </>
  );
}
export const StatusPicker: Story = {
  render: () => <InteractivePicker />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('combobox', { name: 'Status' }));
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('option', { name: 'Done' }));
    await expect(canvas.getByTestId('selected-status')).toHaveTextContent('done');
  },
};
function DialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Modal open={open} onOpenChange={setOpen} title="New issue">
        <Input aria-label="Title" data-autofocus placeholder="A clear outcome" />
        <Button onClick={() => setOpen(false)}>Create issue</Button>
      </Modal>
    </>
  );
}
export const KeyboardDialog: Story = {
  render: () => <DialogExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Open dialog' }));
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole('dialog')).toBeVisible();
    await waitFor(() => expect(page.getByRole('textbox', { name: 'Title' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    // Base UI keeps the popup mounted until its exit transition finishes.
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Open dialog' })).toHaveFocus());
  },
};
