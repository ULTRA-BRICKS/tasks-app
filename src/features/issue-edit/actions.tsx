import type { Issue, IssuePatch } from '@tickets/contracts';
import { ArrowUpRight, Copy } from 'lucide-react';
import { StatusIcon } from '@/entities/issue';
import { useCatalog, useMe } from '@/entities/workspace';
import { Avatar, type MenuAction } from '@/shared/ui';
import { copyActions } from '@/shared/lib/copy-formats';
import { assigneeOptions, peopleDirectory, personInDirectory } from '@/shared/lib/people';
import { useIssueUpdate } from './model';

/**
 * The one contextual-action list for a task. The preview toolbar, its More menu, right-click,
 * Shift+F10 and a hold all render this array (docs/TASK-PREVIEW.md), so they cannot drift.
 */
export function useTaskActions(
  issue: Issue,
  { onOpen, selected, onSelect }: { onOpen: () => void; selected?: boolean; onSelect?: () => void },
): MenuAction[] {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    update = useIssueUpdate();
  // Missing permission information fails closed, as in the row assignee picker.
  const readOnly = !me || me.role === 'viewer';
  const directory = peopleDirectory(catalog);
  const person = personInDirectory(directory, issue.assignee_id);
  const save = (patch: Omit<IssuePatch, 'version'>) => update.mutateAsync({ issue, patch });
  const [copy] = copyActions({
    title: issue.title,
    body: issue.description,
    key: issue.key,
    path: '/tasks/' + issue.id,
    kind: issue.kind === 'epic' ? 'epic' : 'task',
  });
  return [
    {
      id: 'open',
      label: 'Open task',
      command: 'task.open',
      onSelect: onOpen,
      toolbar: { label: 'Open', icon: <ArrowUpRight size={17} /> },
    },
    {
      id: 'status',
      label: 'Status',
      choice: {
        value: issue.status_id,
        options: (catalog?.statuses ?? [])
          .filter((status) => status.team_id === issue.team_id)
          .map((status) => ({ value: status.id, label: status.name, disabled: readOnly })),
        onChoose: (status_id) => save({ status_id }),
      },
      toolbar: {
        label: 'Status',
        icon: <StatusIcon category={issue.status_category} color={issue.status_color} />,
      },
    },
    {
      id: 'assign',
      label: 'Assignee',
      choice: {
        value: person?.id ?? issue.assignee_id ?? 'none',
        options: assigneeOptions(directory, readOnly),
        onChoose: (id) => save({ assignee_id: id === 'none' ? null : id }),
      },
      toolbar: {
        label: 'Assign',
        icon: <Avatar name={person?.name ?? issue.assignee_name} src={person?.avatar_url} />,
      },
    },
    { ...copy, id: 'copy', toolbar: { label: 'Copy', icon: <Copy size={16} /> } },
    ...(onSelect
      ? [
          {
            id: 'select',
            label: selected ? 'Deselect task' : 'Select task',
            command: 'selection.toggle',
            onSelect,
            separatorBefore: true,
          },
        ]
      : []),
  ];
}
