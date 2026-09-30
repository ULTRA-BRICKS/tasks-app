import type { Issue } from '@tickets/contracts';
import { Avatar, Picker } from '@/shared/ui';
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
  return (
    // A touch hold on the avatar opens the task preview at its Assign action.
    <div className="row-assignee" data-hold-action="assign">
      <Picker
        aria-label={'Assignee for ' + issue.key + ': ' + name}
        value={person?.id ?? issue.assignee_id ?? 'none'}
        className="avatar-picker"
        triggerContent={
          <Avatar name={name === 'Unassigned' ? null : name} src={person?.avatar_url} />
        }
        options={options}
        disabled={update.isPending}
        onChange={(id) => {
          if (canWrite) update.mutate({ issue, patch: { assignee_id: id === 'none' ? null : id } });
        }}
      />
      {update.error && (
        <span className="assignee-error" role="alert">
          {errorMessage(update.error)}
        </span>
      )}
    </div>
  );
}
