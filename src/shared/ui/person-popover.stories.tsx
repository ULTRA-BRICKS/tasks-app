import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { PersonProfile } from '../lib/people';
import { PersonPopover } from './person-popover';

const jamie: PersonProfile = {
  id: 'jamie',
  name: 'Jamie Chen',
  avatar_url: null,
  email: 'jamie@example.test',
  membership: 'Admin',
  accounts: ['Tasks', 'Linear', 'Slack'],
  bot: false,
  needs_review: false,
  is_viewer: false,
  tasks_href: '/tasks?assignee_id=jamie',
};
const imported: PersonProfile = {
  id: 'linear-sam-a',
  name: 'Sam A',
  avatar_url: null,
  email: 'sam@example.test',
  membership: 'No Tasks account',
  accounts: ['Linear'],
  bot: false,
  needs_review: true,
  is_viewer: false,
  tasks_href: '/tasks?assignee_id=linear-sam-a',
};
/** Test harness only: shows where View tasks navigated. */
function Location() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname + location.search}</output>;
}
const meta = {
  title: 'Design system/Person popover',
  component: PersonPopover,
  parameters: { layout: 'padded' },
  args: { profile: jamie },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/tasks/UB-1']}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button type="button">Before</button>
          <Story />
          <button type="button">After</button>
        </div>
        <Location />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof PersonPopover>;
export default meta;
type Story = StoryObj<typeof meta>;
const page = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);
const card = (canvasElement: HTMLElement, name = 'Jamie Chen') =>
  page(canvasElement).findByRole('dialog', { name }, { timeout: 2000 });
const closed = (canvasElement: HTMLElement) =>
  waitFor(() => expect(page(canvasElement).queryByRole('dialog')).not.toBeInTheDocument());
const focused = (element: Element) => waitFor(() => expect(element).toHaveFocus());
async function pause(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

/** Opened by a click; left open so the axe run covers the card. */
export const Profile: Story = {
  args: { display: 'name' },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Jamie Chen' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(trigger);
    const popup = within(await card(canvasElement));
    await expect(popup.getByText('jamie@example.test')).toBeVisible();
    await expect(popup.getByText('Admin')).toBeVisible();
    await expect(popup.getByText('Tasks · Linear · Slack')).toBeVisible();
    await expect(popup.queryByText('Needs review')).not.toBeInTheDocument();
    await expect(popup.getByRole('link', { name: 'View tasks' })).toHaveAttribute(
      'href',
      '/tasks?assignee_id=jamie',
    );
    await focused(popup.getByRole('link', { name: 'View tasks' }));
  },
};

export const HoverOpensAfterDelay: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Jamie Chen' });
    await userEvent.hover(trigger);
    // A pointer passing over a dense list must not flash cards.
    await pause(150);
    await expect(page(canvasElement).queryByRole('dialog')).not.toBeInTheDocument();
    const popup = await card(canvasElement);
    await expect(popup).toBeVisible();
    await expect(popup.contains(canvasElement.ownerDocument.activeElement)).toBe(false);
    await userEvent.unhover(trigger);
    await closed(canvasElement);
  },
};

export const KeyboardFocusOpensInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    const trigger = canvas.getByRole('button', { name: 'Jamie Chen' });
    await focused(trigger);
    const popup = within(await card(canvasElement));
    // Focus stays on the trigger; the card is next in Tab order.
    await focused(trigger);
    await userEvent.tab();
    await focused(popup.getByRole('link', { name: 'View tasks' }));
    await userEvent.tab();
    await focused(canvas.getByRole('button', { name: 'After' }));
    await closed(canvasElement);
  },
};

export const EnterAndSpaceOpenEscapeRestoresFocus: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Jamie Chen' });
    for (const key of ['{Enter}', ' ']) {
      trigger.focus();
      await userEvent.keyboard(key);
      const popup = within(await card(canvasElement));
      await focused(popup.getByRole('link', { name: 'View tasks' }));
      await userEvent.keyboard('{Escape}');
      await closed(canvasElement);
      await focused(trigger);
      // Returning focus must not re-open the card as a focus preview.
      await pause(800);
      await expect(page(canvasElement).queryByRole('dialog')).not.toBeInTheDocument();
    }
  },
};

export const EnterOnFocusOpenedCardEntersIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    const popup = within(await card(canvasElement));
    await userEvent.keyboard('{Enter}');
    await focused(popup.getByRole('link', { name: 'View tasks' }));
    await expect(page(canvasElement).getByRole('dialog', { name: 'Jamie Chen' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await closed(canvasElement);
    await focused(canvas.getByRole('button', { name: 'Jamie Chen' }));
  },
};

export const TouchTapOpens: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Jamie Chen' });
    await userEvent.pointer({ keys: '[TouchA]', target: trigger });
    const popup = await card(canvasElement);
    await expect(popup).toBeVisible();
    // Touch focuses the card itself rather than a control, so no keyboard or link focus ring.
    await focused(popup);
  },
};

export const ViewTasksNavigatesAndCloses: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Jamie Chen' });
    await userEvent.click(trigger);
    const popup = within(await card(canvasElement));
    await userEvent.click(popup.getByRole('link', { name: 'View tasks' }));
    await closed(canvasElement);
    await expect(
      within(canvasElement).getByRole('status', { name: 'Current location' }),
    ).toHaveTextContent('/tasks?assignee_id=jamie');
  },
};

/** Inline text (activity, People list): the name alone opens the card. View tasks also runs the
 * caller's hook; the sidebar uses it to close its phone drawer. */
export const NameTextRunsViewTasksHook: Story = {
  args: { display: 'text', onViewTasks: fn() },
  play: async ({ canvasElement, args }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Jamie Chen' });
    await expect(trigger).toHaveTextContent('Jamie Chen');
    await expect(trigger.querySelector('.avatar')).toBeNull();
    await userEvent.click(trigger);
    const popup = within(await card(canvasElement));
    await userEvent.click(popup.getByRole('link', { name: 'View tasks' }));
    await closed(canvasElement);
    await expect(args.onViewTasks).toHaveBeenCalledOnce();
  },
};

/** The signed-in actor is not known yet (or the catalog sent no address): no email row at all. */
export const EmailWithheld: Story = {
  args: { profile: { ...jamie, email: null }, display: 'name' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Jamie Chen' }));
    const popup = await card(canvasElement);
    await expect(popup).not.toHaveTextContent('@');
    await expect(within(popup).queryByText('Email')).not.toBeInTheDocument();
    await expect(within(popup).getByText('Admin')).toBeVisible();
  },
};

/** An imported, conflict-separated profile; the visible text keeps the profile's own name. */
export const ImportedNeedsReview: Story = {
  args: { profile: imported, display: 'name', label: 'Sam A (Linear)' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sam A (Linear)' }));
    const popup = within(await card(canvasElement, 'Sam A'));
    await expect(popup.getByText('Needs review')).toBeVisible();
    await expect(popup.getByText('No Tasks account')).toBeVisible();
    await expect(popup.getByText('Linear')).toBeVisible();
  },
};
