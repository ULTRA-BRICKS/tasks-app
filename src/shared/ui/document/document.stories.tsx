import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { DocumentText } from './index';
const meta = { title: 'Documents/Inline editing', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
function Example({ source = '', readOnly = false }: { source?: string; readOnly?: boolean }) {
  const [value, setValue] = useState({ title: '', description: source });
  const [commits, setCommits] = useState(0);
  return (
    <div style={{ maxWidth: 720, padding: 24 }}>
      <DocumentText
        {...value}
        readOnly={readOnly}
        onChange={(field, text) => setValue((v) => ({ ...v, [field]: text }))}
        onCommit={() => setCommits((n) => n + 1)}
      />
      <output aria-label="Commit count">{commits}</output>
    </div>
  );
}
export const EmptyDocument: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('textbox', { name: 'Title' })).toHaveAttribute(
      'placeholder',
      'Issue title',
    );
    await expect(await c.findByRole('textbox', { name: 'Description' })).toBeVisible();
    await expect(c.queryByRole('dialog')).not.toBeInTheDocument();
  },
};
export const TitleKeyboard: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement),
      title = c.getByRole('textbox', { name: 'Title' });
    await userEvent.click(title);
    await userEvent.type(title, 'Canceled text');
    await userEvent.keyboard('{Escape}');
    await expect(title).toHaveValue('');
    await expect(c.getByLabelText('Commit count')).toHaveTextContent('0');
    await userEvent.click(title);
    await userEvent.type(title, 'Saved title');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(c.getByLabelText('Commit count')).toHaveTextContent('1'));
  },
};
export const SourcePreservation: Story = {
  render: () => <Example source={'Before\n\n[guide]: https://example.com\n\nAfter'} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement),
      body = await c.findByRole('textbox', { name: 'Description' });
    await expect(body).toHaveValue('Before\n\n[guide]: https://example.com\n\nAfter');
    await userEvent.click(body);
    await userEvent.type(body, ' additional');
    await userEvent.keyboard('{Escape}');
    await expect(body).toHaveValue('Before\n\n[guide]: https://example.com\n\nAfter');
  },
};
export const ReadOnly: Story = {
  render: () => <Example readOnly source="A protected document" />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('textbox', { name: 'Title' })).toHaveAttribute('readonly');
    const body = await c.findByRole('textbox', { name: 'Description' });
    await expect(body).toHaveAttribute('contenteditable', 'false');
  },
};
export const TextUndoRedo: Story = {
  render: () => <Example source="Keep this paragraph." />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement), body = await c.findByRole('textbox', { name: 'Description' });
    await c.findByRole('toolbar', { name: 'Document formatting' });
    await userEvent.click(body); await userEvent.keyboard('{End}'); await userEvent.type(body, ' additional text');
    await expect(body).toHaveTextContent('additional text');
    await userEvent.click(c.getByRole('button', { name: 'Undo text', exact: true }));
    await waitFor(() => expect(body).not.toHaveTextContent('additional text'));
    await expect(body).toHaveTextContent('Keep this paragraph.');
    await userEvent.click(c.getByRole('button', { name: 'Redo text', exact: true }));
    await waitFor(() => expect(body).toHaveTextContent('additional text'));
    await expect(c.getByLabelText('Commit count')).toHaveTextContent('0');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body).toHaveTextContent('Keep this paragraph.'));
    await expect(c.getByLabelText('Commit count')).toHaveTextContent('0');
  },
};
