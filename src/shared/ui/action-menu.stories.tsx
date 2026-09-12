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
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
