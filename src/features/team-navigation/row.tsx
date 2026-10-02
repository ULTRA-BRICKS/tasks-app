import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ContextActions, Input, Button, ErrorState, Modal, type MenuAction } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { useMe } from '@/entities/workspace';
type Team = { id: string; key: string; name: string };
type Impact = Team & {
  can_delete: boolean;
  last_team: boolean;
  linked: { issues: number; projects: number; cycles: number };
};
export function TeamRow({
  team,
  onNavigate,
  hidden,
  onHide,
}: {
  team: Team;
  onNavigate: () => void;
  hidden: boolean;
  onHide: () => void;
}) {
  const { data: me } = useMe(),
    client = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const admin = ['owner', 'admin'].includes(me?.role ?? '');
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(team.name);
  const [deleting, setDeleting] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [copyError, setCopyError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const impact = useQuery({
    queryKey: ['team-impact', team.id],
    queryFn: () => api<Impact>('/v1/teams/' + team.id),
    enabled: deleting,
  });
  const rename = useMutation({
    mutationFn: () =>
      api('/v1/teams/' + team.id, { method: 'PATCH', json: { name, expected_name: team.name } }),
    onSuccess: () => {
      setEditing(false);
      void client.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      api('/v1/teams/' + team.id, { method: 'DELETE', json: { confirm_key: confirmation } }),
    onSuccess: () => {
      setDeleting(false);
      void client.invalidateQueries({ queryKey: ['catalog'] });
      if (new URLSearchParams(location.search).get('team_id') === team.id) void navigate('/issues');
    },
  });
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const open = (path: string) => {
    onNavigate();
    void navigate(path);
  };
  const actions: MenuAction[] = [
    {
      label: 'Create issue in team',
      disabled: me?.role === 'viewer',
      onSelect: () => {
        onNavigate();
        void navigate('/issues/new', { state: { defaults: { team_id: team.id } } });
      },
    },
    { label: 'Open team issues', onSelect: () => open('/issues?team_id=' + team.id) },
    {
      label: 'Copy team link',
      onSelect: () => {
        void navigator.clipboard
          .writeText(new URL('/issues?team_id=' + team.id, window.location.origin).href)
          .catch(() => setCopyError('The team link could not be copied.'));
      },
    },
    {
      label: hidden ? 'Show in sidebar' : 'Hide from sidebar',
      separatorBefore: true,
      onSelect: onHide,
    },
    ...(admin
      ? [
          {
            label: 'Rename team',
            separatorBefore: true,
            onSelect: () => {
              setName(team.name);
              rename.reset();
              setEditing(true);
            },
          },
          {
            label: 'Delete team…',
            danger: true,
            onSelect: () => {
              setConfirmation('');
              remove.reset();
              setDeleting(true);
            },
          },
        ]
      : []),
  ];
  return (
    <>
      <ContextActions
        label={'Actions for ' + team.name}
        items={actions}
        className="team-nav-row team-navigation-row"
      >
        {editing ? (
          <div className="team-inline-rename">
            <Input
              ref={input}
              aria-label="Team name"
              value={name}
              maxLength={120}
              disabled={rename.isPending}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && name.trim() && !rename.isPending) {
                  e.preventDefault();
                  rename.mutate();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Save team name"
              disabled={!name.trim() || rename.isPending}
              onClick={() => rename.mutate()}
            >
              Save
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="nav-item team-open"
            onClick={() => open('/issues?team_id=' + team.id)}
          >
            <span className="team-icon">{team.key.slice(0, 1)}</span>
            <span>
              {team.name}
              {hidden ? ' · hidden' : ''}
            </span>
          </button>
        )}
      </ContextActions>
      {rename.error && <ErrorState message={errorMessage(rename.error)} />}
      {copyError && <ErrorState message={copyError} />}
      <Modal
        open={deleting}
        onOpenChange={(open) => {
          if (!remove.isPending) setDeleting(open);
        }}
        title={'Delete ' + team.name + '?'}
      >
        {impact.isPending ? (
          <p>Checking linked work…</p>
        ) : impact.error ? (
          <ErrorState message={errorMessage(impact.error)} />
        ) : (
          impact.data && (
            <>
              <p>
                {impact.data.linked.issues} issues, {impact.data.linked.projects} projects and{' '}
                {impact.data.linked.cycles} cycles reference this team.
              </p>
              {!impact.data.can_delete ? (
                <p>
                  {impact.data.last_team
                    ? 'Keep at least one team in this workspace.'
                    : 'Move linked work before deleting this team. Nothing will be deleted automatically.'}
                </p>
              ) : (
                <>
                  <p>
                    Only this empty team and its workflow statuses will be removed. This cannot be
                    undone. Type <strong>{team.key}</strong> to confirm.
                  </p>
                  <label>
                    Team key
                    <Input
                      data-autofocus
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <Button
                    variant="danger"
                    disabled={confirmation !== team.key || remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Delete empty team
                  </Button>
                </>
              )}
            </>
          )
        )}
        {remove.error && <ErrorState message={errorMessage(remove.error)} />}
        <Button variant="ghost" disabled={remove.isPending} onClick={() => setDeleting(false)}>
          Cancel
        </Button>
      </Modal>
    </>
  );
}
