import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { ReadCacheState } from '@/shared/lib/read-cache';
import { SavedCopyNotice } from './ui';
import type { SavedCopySource } from './model';
const SYNCED = Date.UTC(2026, 8, 29, 9, 41);
/** A fixed read-cache state: the stories never open IndexedDB. */
function source(state: Partial<ReadCacheState>): SavedCopySource {
  const value: ReadCacheState = {
    phase: 'restored',
    syncedAt: SYNCED,
    storage: 'ready',
    problem: null,
    retryAt: null,
    ...state,
  };
  return { getState: () => value, subscribe: () => () => undefined, retry: fn() };
}
const meta = {
  title: 'Features/Saved copy notice',
  component: SavedCopyNotice,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SavedCopyNotice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CheckingSession: Story = {
  args: { source: source({}) },
  play: async ({ canvasElement }) => {
    const notice = within(canvasElement).getByRole('status', { name: 'Saved copy' });
    await expect(notice).toHaveTextContent(/^Saved copy from .+Read-only\. Checking your session/);
    await expect(notice).toHaveTextContent('Unsent drafts stay on this device.');
    // Nothing failed yet, so there is nothing to retry.
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Retry now' }),
    ).not.toBeInTheDocument();
  },
};
export const Offline: Story = {
  args: { source: source({ problem: 'offline' }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status', { name: 'Saved copy' })).toHaveTextContent(
      'No connection to Tasks. Editing resumes when it reconnects.',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Retry now' }));
    await expect(args.source!.retry).toHaveBeenCalledTimes(1);
  },
};
export const RateLimited: Story = {
  args: { source: source({ problem: 'rate-limited', retryAt: SYNCED + 120_000 }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('status', { name: 'Saved copy' }),
    ).toHaveTextContent(/The server asked Tasks to wait\. Retrying at \d/);
  },
};
export const StorageFull: Story = {
  args: { source: source({ phase: 'live', syncedAt: null, storage: 'full' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status', { name: 'Offline copy' })).toHaveTextContent(
      'This device is out of browser storage, so Tasks stopped saving an offline copy. Everything still works online.',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));
    await expect(canvas.queryByRole('status', { name: 'Offline copy' })).not.toBeInTheDocument();
  },
};
