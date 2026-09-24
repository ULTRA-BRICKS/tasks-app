import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Team } from '@tickets/contracts';
import { useMe } from '@/entities/workspace';
import { ActionMenu, Modal, Input, Button, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { copyActions } from '@/shared/lib/copy-formats';
type TeamDetails = Team & {
  linked: { issues: number; projects: number; cycles: number };
  can_delete: boolean;
  last_team: boolean;
};
export function TeamNavigationRow({ team, close }: { team: Team; close: () => void }) {
  const { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation(),
    client = useQueryClient();
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null),
    [name, setName] = useState(team.name),
    [confirmation, setConfirmation] = useState('');
  const admin = ['owner', 'admin'].includes(me?.role ?? '');
  const details = useQuery({
    queryKey: ['team-dependencies', team.id],
    queryFn: () => api<TeamDetails>('/v1/teams/' + team.id),
    enabled: mode === 'delete',
    staleTime: 0,
  });
  const path = '/issues?team_id=' + encodeURIComponent(team.id);
  const open = () => {
    close();
    void navigate(path);
  };
  const mutation = useMutation({
    mutationFn: () =>
      api('/v1/teams/' + team.id, {
        method: mode === 'delete' ? 'DELETE' : 'PATCH',
        json:
          mode === 'delete' ? { confirm_key: confirmation } : { name, expected_name: team.name },
      }),
    onSuccess: () => {
      setMode(null);
      void client.invalidateQueries({ queryKey: ['catalog'] });
      if (mode === 'delete' && new URLSearchParams(location.search).get('team_id') === team.id)
        void navigate('/issues');
    },
  });
  const show = (next: 'rename' | 'delete') => {
    setName(team.name);
    setConfirmation('');
    mutation.reset();
    setMode(next);
  };
  return (
    <>
      <div className="team-context-row nav-action-row">
        <button type="button" className="nav-item" onClick={open}>
          <span className="team-icon">{team.key.slice(0, 1)}</span>
          <span>{team.name}</span>
        </button>
        <ActionMenu
          label={'Actions for ' + team.name}
          items={[
            { label: 'Open team issues', onSelect: open },
            {
              label: 'Create issue in team',
              disabled: me?.role === 'viewer',
              onSelect: () => {
                close();
                void navigate('/issues/new', { state: { defaults: { team_id: team.id } } });
              },
            },
            ...copyActions({ id: team.id, title: team.name, path, kind: 'team' }),
            ...(admin
              ? [
                  { label: 'Rename team', separatorBefore: true, onSelect: () => show('rename') },
                  { label: 'Delete team', danger: true, onSelect: () => show('delete') },
                ]
              : []),
          ]}
        />
      </div>
      <Modal
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setMode(null);
        }}
        title={mode === 'delete' ? 'Delete team' : 'Rename team'}
      >
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.isPending) return;
            if (mode === 'delete' && (!details.data?.can_delete || confirmation !== team.key))
              return;
            mutation.mutate();
          }}
        >
          {mode === 'rename' ? (
            <>
              <label htmlFor={'team-name-' + team.id}>Team name</label>
              <Input
                id={'team-name-' + team.id}
                data-autofocus
                value={name}
                required
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </>
          ) : (
            <>
              <p>
                Delete <strong>{team.name}</strong>? Only an empty team can be removed. Tasks,
                archived issues, projects and cycles are never deleted with it.
              </p>
              {details.isPending && <p>Checking linked work…</p>}
              {details.error && (
                <ErrorState
                  message={errorMessage(details.error)}
                  retry={() => void details.refetch()}
                />
              )}
              {details.data?.last_team && (
                <p role="alert">Keep at least one team in the workspace.</p>
              )}
              {details.data && !details.data.can_delete && !details.data.last_team && (
                <p role="alert">
                  Move the linked work first: {details.data.linked.issues} issues,{' '}
                  {details.data.linked.projects} projects, {details.data.linked.cycles} cycles.
                </p>
              )}
              {details.data?.can_delete && (
                <>
                  <label htmlFor={'team-confirm-' + team.id}>Type {team.key} to confirm</label>
                  <Input
                    id={'team-confirm-' + team.id}
                    data-autofocus
                    value={confirmation}
                    autoComplete="off"
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </>
              )}
            </>
          )}
          {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
          <div className="dialog-footer">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode(null)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                (mode === 'delete'
                  ? !details.data?.can_delete || confirmation !== team.key
                  : !name.trim())
              }
            >
              {mutation.isPending ? 'Saving…' : mode === 'delete' ? 'Delete team' : 'Rename team'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
