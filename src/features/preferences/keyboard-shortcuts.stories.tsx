import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { devicePlatform } from '@/shared/lib/commands';
import { KeyboardShortcutSettings } from './keyboard-shortcuts';
import { usePreferences } from './model';
const meta = {
  title: 'Features/Keyboard shortcut settings',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Counts Escape presses that bubble past the settings, as an enclosing dialog would see them. */
function EscapeProbe() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCount((n) => n + 1);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  return <p>Escapes reaching the page: {count}</p>;
}

export const RecordValidateAndReset: Story = {
  beforeEach: () => {
    usePreferences.getState().resetKeyBindings();
  },
  render: () => (
    <>
      <KeyboardShortcutSettings />
      <EscapeProbe />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mac = devicePlatform === 'mac';
    const change = (title: string) =>
      canvas.getByRole('button', { name: `Change shortcut for ${title}` });
    const row = (title: string) => {
      const item = canvas.getByText(title, { selector: '.shortcut-title' }).closest('li');
      if (!item) throw new Error(`Missing row for ${title}`);
      return within(item);
    };
    const probe = () => canvas.getByText(/Escapes reaching the page/);

    await userEvent.click(change('Go to inbox'));
    const recorder = canvas.getByRole('button', { name: 'Press keys for Go to inbox' });
    await expect(recorder).toHaveFocus();
    await userEvent.keyboard('{Shift}');
    await fireEvent.keyDown(recorder, { key: 'i', code: 'KeyI', keyCode: 229 });
    await fireEvent.keyDown(recorder, { key: 'i', code: 'KeyI', isComposing: true });
    await expect(recorder).toHaveAccessibleName('Press keys for Go to inbox');
    await userEvent.keyboard('{Shift>}I{/Shift}');
    await expect(canvas.getByRole('status')).toHaveTextContent('Go to inbox: Shift I.');
    await expect(change('Go to inbox')).toHaveFocus();
    await expect(row('Go to inbox').getByText('Shift I')).toBeInTheDocument();
    await expect(usePreferences.getState().keyBindings).toEqual({ 'nav.inbox': ['Shift+I'] });

    await userEvent.click(change('Go to settings'));
    await userEvent.keyboard('x');
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'X is already used by “Select focused task”.',
    );
    await userEvent.keyboard(mac ? '{Meta>}w{/Meta}' : '{Control>}w{/Control}');
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      `${mac ? 'Command' : 'Control'} W is reserved: it closes the browser tab.`,
    );
    await expect(
      canvas.getByRole('button', { name: 'Press keys for Go to settings' }),
    ).toHaveFocus();
    await expect(usePreferences.getState().keyBindings).toEqual({ 'nav.inbox': ['Shift+I'] });

    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Go to settings: shortcut unchanged.',
    );
    await expect(canvas.getByRole('alert')).toBeEmptyDOMElement();
    await expect(change('Go to settings')).toHaveFocus();
    await expect(probe()).toHaveTextContent('Escapes reaching the page: 0');

    // A held modifier still cancels: Shift+Escape is never recorded as a binding.
    await userEvent.click(change('Go to settings'));
    await userEvent.keyboard('{Shift>}{Escape}{/Shift}');
    await expect(change('Go to settings')).toHaveFocus();
    await expect(usePreferences.getState().keyBindings).toEqual({ 'nav.inbox': ['Shift+I'] });
    await expect(probe()).toHaveTextContent('Escapes reaching the page: 0');

    await userEvent.click(change('Go to settings'));
    await userEvent.keyboard('x');
    await expect(canvas.getByRole('alert')).not.toBeEmptyDOMElement();
    // Tab leaves the recording; the refusal no longer applies, so it is cleared.
    await userEvent.tab();
    await expect(change('Go to settings')).not.toHaveFocus();
    await expect(canvas.getByRole('alert')).toBeEmptyDOMElement();
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Go to settings: shortcut unchanged.',
    );
    await expect(row('Go to settings').getByText('G then S')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Remove shortcut for Create task' }));
    await expect(row('Create task').getByText('No shortcut')).toBeInTheDocument();
    await expect(canvas.getByRole('status')).toHaveTextContent('Create task: shortcut removed.');
    // Remove keeps its slot (disabled) and focus returns to Change, not to the page.
    await expect(
      canvas.getByRole('button', { name: 'Remove shortcut for Create task' }),
    ).toBeDisabled();
    await expect(change('Create task')).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Reset shortcut for Create task' }));
    await expect(change('Create task')).toHaveFocus();
    await expect(
      canvas.queryByRole('button', { name: 'Reset shortcut for Create task' }),
    ).not.toBeInTheDocument();
    await expect(row('Create task').getByText('C', { selector: '.sr-only' })).toBeInTheDocument();
    await expect(row('Create task').getByText('or')).toBeInTheDocument();
    await expect(row('Create task').getByText('V', { selector: '.sr-only' })).toBeInTheDocument();
    await expect(
      row('Close, cancel or clear the selection').getByText('Fixed'),
    ).toBeInTheDocument();

    const restore = canvas.getByRole('button', { name: 'Restore all defaults' });
    await userEvent.click(restore);
    await waitFor(() => expect(usePreferences.getState().keyBindings).toEqual({}));
    await expect(row('Go to inbox').getByText('G then N')).toBeInTheDocument();
    await expect(restore).toHaveFocus();
    // Positive control: outside a recording, Escape does reach the page.
    await userEvent.keyboard('{Escape}');
    await expect(probe()).toHaveTextContent('Escapes reaching the page: 1');
  },
};
