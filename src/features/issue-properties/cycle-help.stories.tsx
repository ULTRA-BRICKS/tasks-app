import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { CycleHelp } from './cycle-help';
const meta = {
  title: 'Features/Cycle help',
  component: CycleHelp,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CycleHelp>;
export default meta;
type Story = StoryObj<typeof meta>;
export const HintAndGuide: Story = {
  render: () => <CycleHelp />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: 'About cycles' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await expect(await page.findByRole('dialog', { name: 'What is a cycle?' })).toBeVisible();
    await expect(page.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Read full guide' }));
    const guide = await page.findByRole('dialog', { name: 'Cycles in Tasks' });
    await expect(guide).toBeVisible();
    await expect(
      within(guide).getByRole('heading', { name: 'Cycle, project or status?' }),
    ).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
