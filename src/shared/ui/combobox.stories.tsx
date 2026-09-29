import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import { UserRound } from 'lucide-react';
import { Combobox, type ComboboxCreate, type Option } from './index';

const meta = {
  title: 'Design system/Combobox',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
interface CreateArgs {
  onCreate: (name: string) => void;
}
type CreateStory = StoryObj<CreateArgs>;

const statuses: Option[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'started', label: 'In progress' },
  { value: 'review', label: 'In review' },
  { value: 'done', label: 'Done' },
];
const body = (element: HTMLElement) => within(element.ownerDocument.body);
/** Opens a field's popup and waits until its search input owns focus, as a person would. */
async function openSearch(canvasElement: HTMLElement, field: string) {
  await userEvent.click(within(canvasElement).getByRole('combobox', { name: field }));
  const search = await body(canvasElement).findByRole('combobox', {
    name: 'Search ' + field.toLowerCase(),
  });
  await waitFor(() => expect(search).toHaveFocus());
  return search;
}

function StatusField() {
  const [value, setValue] = useState('todo');
  const [escapes, setEscapes] = useState(0);
  useEffect(() => {
    // Stands in for page shortcuts such as Escape → back from a task.
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEscapes((count) => count + 1);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return (
    <>
      <Combobox aria-label="Status" value={value} onChange={setValue} options={statuses} />
      <p data-testid="value">{value}</p>
      <p data-testid="page-escapes">{escapes}</p>
    </>
  );
}

export const SearchKeyboardAndEscape: Story = {
  render: () => <StatusField />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = body(canvasElement);
    const trigger = canvas.getByRole('combobox', { name: 'Status' });
    await expect(trigger).toHaveTextContent('Todo');
    await userEvent.click(trigger);
    const search = await page.findByRole('combobox', { name: 'Search status' });
    await waitFor(() => expect(search).toHaveFocus());
    await expect(page.getByRole('listbox', { name: 'Status' })).toBeVisible();
    await userEvent.keyboard('prog');
    await waitFor(() =>
      expect(page.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'In progress',
      ]),
    );
    await expect(search).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByTestId('value')).toHaveTextContent('started'));
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Arrow keys move through every option; Escape discards the query, not the value.
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(page.getByRole('combobox', { name: 'Search status' })).toHaveFocus(),
    );
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await userEvent.keyboard('Do');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(canvas.getByTestId('value')).toHaveTextContent('started');
    await expect(canvas.getByTestId('page-escapes')).toHaveTextContent('0');
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(page.getByRole('combobox', { name: 'Search status' })).toHaveValue(''),
    );
    await expect(page.getAllByRole('option')).toHaveLength(statuses.length);
    await expect(page.getByRole('option', { name: 'In progress' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Escape}');
  },
};

const people: Option[] = [
  { value: 'none', label: 'Unassigned' },
  { value: 'ada', label: 'Ada Lovelace', avatar_url: '/favicon.svg' },
  { value: 'grace', label: 'Grace Hopper', avatar_url: null },
  // Same display name from another source: the description tells them apart.
  { value: 'grace-slack', label: 'Grace Hopper', description: 'Slack', avatar_url: null },
];
function AssigneeField() {
  const [value, setValue] = useState('none');
  return (
    <>
      <Combobox aria-label="Assignee" value={value} onChange={setValue} options={people} />
      <p data-testid="value">{value}</p>
    </>
  );
}
export const PeopleShowAvatars: Story = {
  render: () => <AssigneeField />,
  parameters: { a11y: { context: 'body' } },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement);
    await openSearch(canvasElement, 'Assignee');
    await userEvent.keyboard('gr');
    const grace = await page.findByRole('option', { name: 'Grace Hopper' });
    await expect(grace.querySelector('.avatar')).toHaveTextContent('GH');
    await expect(page.queryByRole('option', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
    await expect(page.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'GHGrace Hopper',
      'GHGrace HopperSlack',
    ]);
    await userEvent.clear(page.getByRole('combobox', { name: 'Search assignee' }));
    const ada = await page.findByRole('option', { name: 'Ada Lovelace' });
    // Photo loading is covered in the browser suite; here the option carries the person's avatar.
    await expect(ada.querySelector('.avatar')).toHaveAttribute('title', 'Ada Lovelace');
    // No person can be invented from a picker: an unknown name offers nothing to create.
    await userEvent.keyboard('Nobody Here');
    await expect(await page.findByText('No matches')).toBeVisible();
    await expect(page.queryByRole('option')).not.toBeInTheDocument();
  },
};

const initialLabels: Option[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
];
function LabelField({
  onCreate,
  unavailable,
}: {
  onCreate: (name: string) => void;
  unavailable?: string;
}) {
  const [labels, setLabels] = useState(initialLabels);
  const [value, setValue] = useState<string[]>([]);
  const [failures, setFailures] = useState(0);
  const create: ComboboxCreate = {
    label: (query) => `Create label “${query}”`,
    unavailable,
    onCreate: async (name) => {
      onCreate(name);
      // The first attempt of "Flaky" fails like a lost connection; the retry succeeds.
      if (name === 'Flaky' && failures === 0) {
        setFailures(1);
        throw new Error('Couldn’t reach the server. Your text is kept; try again.');
      }
      // "Slow" fails only after the person has had time to close the popup.
      if (name === 'Slow') {
        await new Promise((resolve) => setTimeout(resolve, 400));
        throw new Error('Couldn’t reach the server. Your text is kept; try again.');
      }
      const created = { value: name.toLowerCase(), label: name };
      setLabels((current) => [...current, created]);
      return { value: created.value };
    },
  };
  return (
    <>
      <Combobox
        multiple
        aria-label="Labels"
        value={value}
        onChange={setValue}
        options={labels}
        create={create}
        triggerContent={<span>{value.length ? value.join(', ') : 'Add labels'}</span>}
      />
      <p data-testid="value">{value.join(',')}</p>
    </>
  );
}

/** A milestone field whose list is stale: "Beta" already exists on the server. */
function MilestoneField() {
  const [milestones, setMilestones] = useState<Option[]>([{ value: 'alpha', label: 'Alpha' }]);
  const [value, setValue] = useState('alpha');
  const create: ComboboxCreate = {
    label: (query) => `Create milestone “${query}”`,
    onCreate: async () => {
      setMilestones((current) => [...current, { value: 'beta', label: 'Beta' }]);
      return { value: 'beta', notice: 'Selected existing milestone “Beta”' };
    },
  };
  return (
    <>
      <Combobox
        aria-label="Milestone"
        value={value}
        onChange={setValue}
        options={milestones}
        create={create}
      />
      <p data-testid="value">{value}</p>
    </>
  );
}

export const ExistingMatchNoticeStaysVisible: Story = {
  render: () => <MilestoneField />,
  parameters: { a11y: { context: 'body' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      page = body(canvasElement);
    await openSearch(canvasElement, 'Milestone');
    await userEvent.keyboard('beta');
    await userEvent.click(page.getByRole('option', { name: 'Create milestone “beta”' }));
    await waitFor(() => expect(canvas.getByTestId('value')).toHaveTextContent('beta'));
    // The single-select popup stays open so the explanation is seen, not lost on close.
    await expect(page.getByText('Selected existing milestone “Beta”')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await expect(page.getByRole('option', { name: 'Beta' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());
  },
};

export const ExplicitInlineCreate: CreateStory = {
  args: { onCreate: fn() },
  render: (args) => <LabelField onCreate={args.onCreate} />,
  play: async ({ canvasElement, args }) => {
    const { onCreate } = args;
    const canvas = within(canvasElement),
      page = body(canvasElement);
    await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('Needs design');
    await expect(
      await page.findByRole('option', { name: 'Create label “Needs design”' }),
    ).toBeVisible();
    // Blur, outside clicks and Escape never create.
    await userEvent.keyboard('{Escape}');
    await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('Needs design');
    await userEvent.click(canvasElement.ownerDocument.body);
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(onCreate).not.toHaveBeenCalled();

    // An existing name, in any case, is offered for selection instead of creation.
    await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('  BUG ');
    await expect(await page.findByRole('option', { name: 'Bug' })).toBeVisible();
    await expect(page.queryByRole('option', { name: /Create label/ })).not.toBeInTheDocument();

    await userEvent.clear(page.getByRole('combobox', { name: 'Search labels' }));
    await userEvent.keyboard('Needs design');
    await userEvent.click(await page.findByRole('option', { name: 'Create label “Needs design”' }));
    await waitFor(() => expect(canvas.getByTestId('value')).toHaveTextContent('needs design'));
    await expect(onCreate).toHaveBeenCalledTimes(1);
    await expect(onCreate).toHaveBeenCalledWith('Needs design');
    // Multiple selection stays open with a cleared query for the next label.
    await waitFor(() =>
      expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue(''),
    );
    await expect(page.getByRole('option', { name: 'Needs design' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Escape}');
  },
};

export const CreateFailureKeepsTextAndRetries: CreateStory = {
  args: { onCreate: fn() },
  render: (args) => <LabelField onCreate={args.onCreate} />,
  parameters: { a11y: { context: 'body' } },
  play: async ({ canvasElement, args }) => {
    const { onCreate } = args;
    const canvas = within(canvasElement),
      page = body(canvasElement);
    await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('Flaky');
    await userEvent.keyboard('{Enter}');
    await expect(await page.findByRole('alert')).toHaveTextContent('Couldn’t reach the server');
    await expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue('Flaky');
    await expect(canvas.getByTestId('value')).toHaveTextContent('');
    await userEvent.click(page.getByRole('option', { name: 'Create label “Flaky”' }));
    await waitFor(() => expect(canvas.getByTestId('value')).toHaveTextContent('flaky'));
    await expect(onCreate).toHaveBeenCalledTimes(2);
    await expect(page.queryByRole('alert')).not.toBeInTheDocument();
  },
};

export const FailureAfterCloseReopens: CreateStory = {
  args: { onCreate: fn() },
  render: (args) => <LabelField onCreate={args.onCreate} />,
  parameters: { a11y: { context: 'body' } },
  play: async ({ canvasElement, args }) => {
    const { onCreate } = args;
    const page = body(canvasElement);
    await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('Slow');
    await userEvent.keyboard('{Enter}');
    await expect(onCreate).toHaveBeenCalledWith('Slow');
    // Closing does not cancel the sent request, so its failure must not vanish with the popup.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(await page.findByRole('alert')).toHaveTextContent('Couldn’t reach the server');
    await expect(page.getByRole('combobox', { name: 'Search labels' })).toHaveValue('Slow');
    await expect(page.getByRole('option', { name: 'Create label “Slow”' })).toBeVisible();
  },
};

export const ImeCompositionNeverCreates: CreateStory = {
  args: { onCreate: fn() },
  render: (args) => <LabelField onCreate={args.onCreate} />,
  play: async ({ canvasElement, args }) => {
    const { onCreate } = args;
    const page = body(canvasElement);
    const search = await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('ラベル');
    await page.findByRole('option', { name: 'Create label “ラベル”' });
    // Enter that confirms an IME candidate arrives as keyCode 229 while composing.
    search.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    search.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    search.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ラベル' }));
    await expect(onCreate).not.toHaveBeenCalled();
    await expect(page.getByRole('listbox', { name: 'Labels' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  },
};

export const OfflineCreateIsUnavailable: CreateStory = {
  args: { onCreate: fn() },
  render: (args) => (
    <LabelField onCreate={args.onCreate} unavailable="Offline — reconnect to create" />
  ),
  parameters: { a11y: { context: 'body' } },
  play: async ({ canvasElement, args }) => {
    const { onCreate } = args;
    const page = body(canvasElement);
    await openSearch(canvasElement, 'Labels');
    await userEvent.keyboard('Later');
    const option = await page.findByRole('option', { name: /Create label “Later”/ });
    await expect(option).toHaveAttribute('aria-disabled', 'true');
    await expect(option).toHaveTextContent('Offline — reconnect to create');
    await userEvent.click(option);
    await userEvent.keyboard('{Enter}');
    await expect(onCreate).not.toHaveBeenCalled();
  },
};

interface ActionArgs {
  onViewProfile: () => void;
}
function AssigneeWithProfile({ onViewProfile }: ActionArgs) {
  const [value, setValue] = useState('');
  const people: Option[] = [
    { value: '', label: 'No assignee' },
    { value: 'ana', label: 'Ana Ivanova' },
    { value: 'boris', label: 'Boris Petrov' },
  ];
  return (
    <>
      <Combobox
        aria-label="Assignee"
        value={value}
        onChange={setValue}
        options={people}
        actions={[
          { label: 'View profile', icon: <UserRound size={13} />, onSelect: onViewProfile },
        ]}
      />
      <p data-testid="value">{value || 'none'}</p>
    </>
  );
}

export const LeadingActionIsNeverSaved: StoryObj<ActionArgs> = {
  args: { onViewProfile: fn() },
  render: (args) => <AssigneeWithProfile onViewProfile={args.onViewProfile} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement),
      page = body(canvasElement);
    await openSearch(canvasElement, 'Assignee');
    // The command leads the list while nothing is typed.
    await waitFor(() =>
      expect(page.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'View profile',
        'No assignee',
        'Ana Ivanova',
        'Boris Petrov',
      ]),
    );
    // Typing searches people only, so Enter can never run the command by accident.
    await userEvent.keyboard('ana');
    await waitFor(() =>
      expect(page.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Ana Ivanova',
      ]),
    );
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByTestId('value')).toHaveTextContent('ana'));
    await expect(args.onViewProfile).not.toHaveBeenCalled();

    // Enter straight after opening never runs the leading command either.
    await openSearch(canvasElement, 'Assignee');
    await userEvent.keyboard('{Enter}');
    await expect(args.onViewProfile).not.toHaveBeenCalled();
    await expect(canvas.getByTestId('value')).toHaveTextContent('ana');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());

    await openSearch(canvasElement, 'Assignee');
    await userEvent.click(await page.findByRole('option', { name: 'View profile' }));
    await expect(args.onViewProfile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument());
    // Choosing the command never changes the saved value.
    await expect(canvas.getByTestId('value')).toHaveTextContent('ana');
  },
};

export const ReadOnly: Story = {
  render: () => (
    <Combobox aria-label="Status" value="todo" onChange={() => {}} options={statuses} disabled />
  ),
  play: async ({ canvasElement }) => {
    const page = body(canvasElement);
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Status' });
    await expect(trigger).toBeDisabled();
    await userEvent.click(trigger, { pointerEventsCheck: 0 });
    await expect(page.queryByRole('listbox')).not.toBeInTheDocument();
  },
};
