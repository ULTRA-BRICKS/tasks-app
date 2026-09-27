import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { DateProperty } from './date-property';
function Example() {
  const [value, setValue] = useState<string | null>('2024-02-29');
  return (
    <div style={{ width: 300 }}>
      <DateProperty label="Start date" value={value} onChange={setValue} disabled={false} />
    </div>
  );
}
const meta = {
  title: 'Features/Inline date calendar',
  component: Example,
  parameters: { layout: 'padded' },
  render: () => <Example />,
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OpenCalendar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Open start date calendar' }));
    const panel = await page.findByRole('dialog', { name: 'Start date calendar' });
    await expect(within(panel).getByRole('grid')).toBeVisible();
    await expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument();
    await expect(page.getAllByRole('textbox', { name: 'Start date' })).toHaveLength(1);
  },
};
export const KeyboardMonthEnd: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Open start date calendar' }));
    await page.findByRole('grid');
    await userEvent.keyboard('{Shift>}{PageDown}{/Shift}');
    await waitFor(() =>
      expect(page.getByRole('button', { name: 'February 28, 2025' })).toHaveFocus(),
    );
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(canvas.getByRole('textbox', { name: 'Start date' })).toHaveValue('2025-02-28');
    await expect(canvas.getByRole('textbox', { name: 'Start date' })).toHaveFocus();
  },
};
