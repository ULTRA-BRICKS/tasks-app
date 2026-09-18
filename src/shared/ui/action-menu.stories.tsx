import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { ActionMenu } from './action-menu';
const meta = {
  title: 'Design system/Capsule actions',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
function Example() {
  const [action, setAction] = useState('None');
  return (
    <>
      <ActionMenu
        label="Project actions"
        items={[
          { label: 'Refresh projects', onSelect: () => setAction('Refreshed') },
          {
            label: 'Unavailable action',
            onSelect: () => setAction('Must not run'),
            disabled: true,
          },
        ]}
      />
      <output>{action}</output>
    </>
  );
}
export const KeyboardAndSelection: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'Project actions' });
    await userEvent.click(trigger);
    const item = await page.findByRole('menuitem', { name: 'Refresh projects' });
    await expect(page.getByRole('menuitem', { name: 'Unavailable action' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(item);
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Refreshed'));
    // Finish the close transition before beginning a separate keyboard-dismiss interaction.
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    await page.findByRole('menu');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const NestedCopy: Story = {
  render: () => (
    <ActionMenu
      label="Nested document actions"
      items={[
        {
          label: 'Copy',
          children: [
            { label: 'Copy Markdown', onSelect: () => {} },
            {
              label: 'Copy disabled',
              disabled: true,
              onSelect: () => {
                throw new Error('Disabled action ran');
              },
            },
          ],
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'Nested document actions' });
    await userEvent.click(trigger);
    const submenu = await page.findByRole('menuitem', { name: 'Copy' });
    submenu.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(page.getByRole('menuitem', { name: 'Copy Markdown' })).toBeVisible(),
    );
    await expect(page.getByRole('menuitem', { name: 'Copy disabled' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.getAllByRole('menu')).toHaveLength(1));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const FailedAction: Story = {
  render: () => (
    <ActionMenu
      label="Failure feedback"
      items={[
        {
          label: 'Unavailable service',
          onSelect: () => Promise.reject(new Error('Synthetic service failure')),
        },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Failure feedback' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Unavailable service' }));
    await expect(await page.findByRole('alert')).toHaveTextContent('could not be confirmed');
    await userEvent.click(page.getByRole('button', { name: 'Dismiss action error' }));
    await waitFor(() => expect(page.queryByRole('alert')).not.toBeInTheDocument());
  },
};
