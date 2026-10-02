import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCatalog, useMe } from '@/entities/workspace';
import { ContextActions, Button } from '@/shared/ui';
export function TeamNavigation({ close }: { close: () => void }) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe();
  if (!catalog || !me) return null;
  return (
    <Teams
      key={me.workspace_id + ':' + me.id}
      teams={catalog.teams}
      scope={me.workspace_id + ':' + me.id}
      canCreate={me.role !== 'viewer'}
      close={close}
    />
  );
}
function Teams({
  teams,
  scope,
  canCreate,
  close,
}: {
  teams: { id: string; name: string; key: string }[];
  scope: string;
  canCreate: boolean;
  close: () => void;
}) {
  const storageKey = 'tasks-hidden-teams:' + scope;
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string').slice(0, 1000)
        : [];
    } catch {
      return [];
    }
  });
  const [showHidden, setShowHidden] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const save = (ids: string[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ids));
      setHidden(ids);
      setError('');
    } catch {
      setError('Sidebar preference could not be saved. No teams were removed.');
    }
  };
  const count = teams.filter((team) => hidden.includes(team.id)).length;
  return (
    <>
      {teams
        .filter((team) => showHidden || !hidden.includes(team.id))
        .map((team) => {
          const path = '/issues?team_id=' + encodeURIComponent(team.id),
            isHidden = hidden.includes(team.id);
          const open = () => {
            close();
            void navigate(path);
          };
          return (
            <ContextActions
              key={team.id}
              label={'Actions for ' + team.name}
              className="team-navigation-row"
              items={[
                { label: 'Open team issues', onSelect: open },
                {
                  label: 'Create issue in team',
                  disabled: !canCreate,
                  onSelect: () => {
                    close();
                    void navigate('/issues/new', { state: { defaults: { team_id: team.id } } });
                  },
                },
                {
                  label: 'Copy team link',
                  onSelect: () => {
                    void navigator.clipboard
                      .writeText(new URL(path, window.location.origin).href)
                      .catch(() => setError('The link could not be copied.'));
                  },
                },
                {
                  label: isHidden ? 'Show in sidebar' : 'Hide from sidebar',
                  separatorBefore: true,
                  onSelect: () =>
                    save(isHidden ? hidden.filter((id) => id !== team.id) : [...hidden, team.id]),
                },
              ]}
            >
              <button type="button" className="nav-item" onClick={open}>
                <span className="team-icon">{team.key.slice(0, 1)}</span>
                <span>
                  {team.name}
                  {isHidden ? ' · hidden' : ''}
                </span>
              </button>
            </ContextActions>
          );
        })}
      {count > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="hidden-teams-toggle"
          aria-pressed={showHidden}
          onClick={() => setShowHidden(!showHidden)}
        >
          {showHidden ? 'Hide hidden teams' : `Show hidden teams (${count})`}
        </Button>
      )}
      {error && (
        <p role="alert" className="nav-menu-error">
          {error}
        </p>
      )}
    </>
  );
}
