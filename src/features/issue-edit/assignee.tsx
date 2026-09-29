import { useMemo, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { Issue } from '@tickets/contracts';
import { PersonCardById } from '@/entities/workspace';
import { Avatar, Combobox, type ComboboxAction } from '@/shared/ui';
import { personInDirectory, assigneeOptions, type PersonDirectory } from '@/shared/lib/people';
import { errorMessage } from '@/shared/api/client';
import { useIssueUpdate } from './model';
export function IssueAssignee({
  issue,
  people,
  disabled = true, // Missing permission information fails closed.
}: {
  issue: Issue;
  people: PersonDirectory;
  disabled?: boolean;
}) {
  const update = useIssueUpdate();
  const person = personInDirectory(people, issue.assignee_id);
  const name = person?.name ?? issue.assignee_name ?? 'Unassigned';
  const canWrite = !disabled && !update.isPending;
  const options = assigneeOptions(people, !canWrite);
  const control = useRef<HTMLDivElement>(null);
  // The avatar is the assignee picker (UB-43), so the person's card opens from its View profile
  // command (docs/PERSON-POPOVER.md). The card mounts on first use and then stays mounted, so
  // closing it can return focus to the avatar.
  const [card, setCard] = useState<'unused' | 'open' | 'closed'>('unused');
  const actions = useMemo<ComboboxAction[] | undefined>(
    () =>
      person
        ? [
            {
              label: 'View profile',
              icon: <UserRound size={13} />,
              onSelect: () => setCard('open'),
            },
          ]
        : undefined,
    [person],
  );
  return (
    <div className="row-assignee" ref={control}>
      <Combobox
        aria-label={'Assignee for ' + issue.key + ': ' + name}
        searchLabel="Search people"
        value={person?.id ?? issue.assignee_id ?? 'none'}
        className="avatar-picker"
        triggerContent={
          <Avatar name={name === 'Unassigned' ? null : name} src={person?.avatar_url} />
        }
        options={options}
        actions={actions}
        disabled={update.isPending}
        onChange={(id) => {
          if (canWrite) update.mutate({ issue, patch: { assignee_id: id === 'none' ? null : id } });
        }}
      />
      {person && card !== 'unused' && (
        <PersonCardById
          id={person.id}
          open={card === 'open'}
          onOpenChange={(open) => setCard(open ? 'open' : 'closed')}
          anchor={control}
          returnFocus={() => control.current?.querySelector<HTMLElement>('[role="combobox"]')}
        />
      )}
      {update.error && (
        <span className="assignee-error" role="alert">
          {errorMessage(update.error)}
        </span>
      )}
    </div>
  );
}
