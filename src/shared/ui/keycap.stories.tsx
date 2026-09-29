import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Keycaps } from './keycap';
const meta = {
  title: 'Design system/Keycaps',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const bindings = ['Mod+K', 'Mod+Shift+Z', 'G I', '?', 'Shift+ArrowDown', 'Escape'];
export const MacAndWindows: Story = {
  render: () => (
    <table>
      <thead>
        <tr>
          <th scope="col">Binding</th>
          <th scope="col">Mac</th>
          <th scope="col">Windows and Linux</th>
        </tr>
      </thead>
      <tbody>
        {bindings.map((binding) => (
          <tr key={binding}>
            <th scope="row">
              <code>{binding}</code>
            </th>
            <td>
              <Keycaps binding={binding} platform="mac" />
            </td>
            <td>
              <Keycaps binding={binding} platform="other" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = (binding: string) => {
      const tr = canvas.getByRole('rowheader', { name: binding }).closest('tr');
      if (!tr) throw new Error(`Missing row for ${binding}`);
      const cells = within(tr).getAllByRole('cell');
      return cells.map((cell) => ({
        visual: cell.querySelector('[aria-hidden="true"]')?.textContent,
        spoken: cell.querySelector('.sr-only')?.textContent,
      }));
    };
    await expect(row('Mod+K')).toEqual([
      { visual: '⌘K', spoken: 'Command K' },
      { visual: 'CtrlK', spoken: 'Control K' },
    ]);
    await expect(row('Mod+Shift+Z')).toEqual([
      { visual: '⇧⌘Z', spoken: 'Shift Command Z' },
      { visual: 'CtrlShiftZ', spoken: 'Control Shift Z' },
    ]);
    await expect(row('G I')[0]).toEqual({ visual: 'GthenI', spoken: 'G then I' });
    await expect(row('?')[1]?.spoken).toBe('Question mark');
    await expect(row('Shift+ArrowDown')[0]).toEqual({ visual: '⇧↓', spoken: 'Shift Down arrow' });
  },
};
