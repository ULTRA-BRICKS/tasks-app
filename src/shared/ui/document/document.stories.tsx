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
      'Task title',
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
const STRUCTURED =
  '## Acceptance criteria\n\n- [ ] Headings render as rich text.\n\nBefore <Routes> after\n\n[guide]: https://example.com';
export const StructuredMarkdown: Story = {
  render: () => <Example source={STRUCTURED} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement),
      body = await c.findByRole('textbox', { name: 'Description' });
    await expect(body).toHaveAttribute('contenteditable', 'true');
    await expect(within(body).getByRole('heading', { name: 'Acceptance criteria' })).toBeVisible();
    const preserved = within(body).getByText('[guide]: https://example.com');
    await expect(preserved).toHaveAttribute('contenteditable', 'false');
    await expect(within(body).getByText('<Routes>')).toHaveAttribute('contenteditable', 'false');
    await expect(c.queryByText(/extended Markdown/)).not.toBeInTheDocument();
    await userEvent.click(within(body).getByText('Before', { exact: false }));
    await userEvent.keyboard(' additional');
    await userEvent.keyboard('{Escape}');
    await expect(body).not.toHaveTextContent('additional');
    await expect(within(body).getByText('[guide]: https://example.com')).toBeVisible();
    await expect(c.getByLabelText('Commit count')).toHaveTextContent('0');
    await userEvent.click(
      within(body).getByRole('checkbox', { name: 'Headings render as rich text.' }),
    );
    await waitFor(() => expect(c.getByLabelText('Commit count')).toHaveTextContent('1'));
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
