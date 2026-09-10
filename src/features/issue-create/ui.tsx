import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Issue, IssueCreate } from '@tickets/contracts';
import { useCatalog, useMe, useProjects, moduleEnabled } from '@/entities/workspace';
import { priorities } from '@/entities/issue';
import { api, errorMessage } from '@/shared/api/client';
import { Button, Input, Textarea, Modal, Picker, ErrorState } from '@/shared/ui';
export function CreateIssue({
  open,
  onOpenChange,
  onCreated,
  defaults = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (issue: Issue) => void;
  defaults?: Partial<IssueCreate>;
}) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe();
  const projects = useProjects(moduleEnabled(catalog, 'planning'));
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [team, setTeam] = useState(defaults.team_id ?? ''),
    [priority, setPriority] = useState('0'),
    [assignee, setAssignee] = useState('none'),
    [project, setProject] = useState(defaults.project_id ?? 'none'),
    [kind, setKind] = useState(defaults.kind ?? 'issue');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: IssueCreate) =>
      api<Issue>('/v1/issues', {
        method: 'POST',
        json: input,
        headers: { 'idempotency-key': crypto.randomUUID() },
      }),
    onSuccess: (issue) => {
      void client.invalidateQueries({ queryKey: ['issues'] });
      void client.invalidateQueries({ queryKey: ['issue'] });
      void client.invalidateQueries({ queryKey: ['projects'] });
      setTitle('');
      setDescription('');
      onOpenChange(false);
      onCreated?.(issue);
    },
  });
  const teamId = team || catalog?.teams[0]?.id || '';
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !teamId || mutation.isPending) return;
    mutation.mutate({
      ...defaults,
      team_id: teamId,
      title: title.trim(),
      description,
      priority: Number(priority),
      assignee_id: assignee === 'none' ? null : assignee,
      project_id: project === 'none' ? null : project,
      kind,
    });
  }
  const close = (next: boolean) => {
    if (mutation.isPending) return;
    if (
      !next &&
      (title.trim() || description.trim()) &&
      !window.confirm('Discard this new issue draft?')
    )
      return;
    onOpenChange(next);
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="New issue"
      className="create-dialog"
      description="Give the issue a clear outcome. Add the details your teammates will need."
    >
      <form onSubmit={submit}>
        <div className="create-context">
          <Picker
            label="Team"
            value={teamId}
            options={
              catalog?.teams.map((t) => ({ value: t.id, label: t.key + ' · ' + t.name })) ?? []
            }
            onChange={(v) => {
              setTeam(v);
              setProject('none');
            }}
          />
          <Picker
            label="Issue type"
            value={kind}
            options={[
              { value: 'issue', label: 'Issue' },
              { value: 'epic', label: 'Epic' },
            ]}
            onChange={(v) => setKind(v as 'issue' | 'epic')}
          />
        </div>
        <Input
          autoFocus
          aria-label="Issue title"
          placeholder="Issue title"
          className="create-title"
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Textarea
          aria-label="Issue description"
          placeholder="Add a description… Markdown is supported."
          className="create-description"
          value={description}
          maxLength={100000}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="create-properties">
          <Picker label="Priority" value={priority} options={priorities} onChange={setPriority} />
          <Picker
            label="Assignee"
            value={assignee}
            options={[
              { value: 'none', label: 'Unassigned' },
              ...(catalog?.people.map((p) => ({ value: p.id, label: p.name })) ?? []),
            ]}
            onChange={setAssignee}
          />
          {moduleEnabled(catalog, 'planning') && (
            <Picker
              label="Project"
              value={project}
              options={[
                { value: 'none', label: 'No project' },
                ...(projects.data
                  ?.filter((p) => p.team_ids.includes(teamId))
                  .map((p) => ({ value: p.id, label: p.name })) ?? []),
              ]}
              onChange={setProject}
            />
          )}
        </div>
        {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
        <div className="dialog-footer">
          <span className="muted shortcut-hint">⌘ / Ctrl ↵ to create</span>
          <Button
            variant="default"
            type="submit"
            disabled={!title.trim() || mutation.isPending || me?.role === 'viewer'}
          >
            {mutation.isPending ? 'Creating…' : 'Create issue'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
