import { TeamNavigationRow } from '@/features/team-management';
import { copyActions } from '@/shared/lib/copy-formats';
import { useMobileChrome } from '@/shared/lib/mobile-chrome';
import { useEffect, useState, type RefObject } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Inbox,
  FileText,
  Flag,
  Layers,
  Plus,
  Search,
  FolderKanban,
  CalendarRange,
  SlidersHorizontal,
  Settings,
  UserRound,
  Archive,
  PanelLeftClose,
  LogOut,
  Ellipsis,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCatalog, useMe, useViews, useNotifications, moduleEnabled } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import { Avatar, Button, Modal, ContextRow } from '@/shared/ui';
import { api } from '@/shared/api/client';
export function Navigation({
  onCreate,
  onSearch,
  mainRef,
}: {
  onCreate: () => void;
  onSearch: () => void;
  /** Workspace content whose page header the mobile chrome measures. */
  mainRef: RefObject<HTMLElement | null>;
}) {
  const chrome = useMobileChrome(mainRef);
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    views = useViews(moduleEnabled(catalog, 'views')),
    notifications = useNotifications(moduleEnabled(catalog, 'notifications')),
    client = useQueryClient();
  const prefs = usePreferences(),
    navigate = useNavigate();
  const location = useLocation();
  const documentRoute = /^\/(tasks|issues|projects|cycles|documents|initiatives)\/[^/]+/.test(
    location.pathname,
  );
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0;
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const changed = () => setMobile(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  function close() {
    prefs.setSidebarOpen(false);
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    client.clear();
    for (const key of Object.keys(sessionStorage))
      if (['ticket-draft:', 'ticket-new:', 'plan-draft:'].some((prefix) => key.startsWith(prefix)))
        sessionStorage.removeItem(key);
    window.location.assign('/login');
  }
  const navClass = ({ isActive }: { isActive: boolean }) =>
    'nav-item' + (isActive ? ' active' : '');
  const content = (
    <aside
      className={'sidebar' + (prefs.sidebarOpen ? ' is-open' : '')}
      aria-label="Workspace navigation"
    >
      <div className="workspace-switch">
        <span className="workspace-logo">{catalog?.workspace.name.slice(0, 1) ?? 'T'}</span>
        <strong>{catalog?.workspace.name ?? 'Workspace'}</strong>
        <Button
          size="icon"
          variant="ghost"
          className="mobile-only"
          aria-label="Close navigation"
          onClick={close}
        >
          <PanelLeftClose size={16} />
        </Button>
      </div>
      <div className="nav-actions">
        <Button
          variant="ghost"
          onClick={() => {
            close();
            onSearch();
          }}
          className="nav-search"
        >
          <Search size={15} />
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </Button>
        <Button
          size="icon"
          variant="secondary"
          aria-label="Create new task"
          onClick={() => {
            close();
            onCreate();
          }}
          disabled={me?.role === 'viewer'}
        >
          <Plus size={17} />
        </Button>
      </div>
      <nav>
        {moduleEnabled(catalog, 'notifications') && (
          <NavLink onClick={close} to="/inbox" className={navClass}>
            <Inbox size={16} />
            <span>Inbox</span>
            {unread > 0 && <span className="nav-count">{unread}</span>}
          </NavLink>
        )}
        <NavLink
          onClick={close}
          to="/my-tasks"
          aria-label="My tasks"
          aria-description={
            catalog?.counts?.mine === undefined ? undefined : catalog.counts.mine + ' my tasks'
          }
          className={navClass}
        >
          <UserRound size={16} />
          <span>My tasks</span>
          {catalog?.counts?.mine !== undefined && (
            <span className="nav-count" aria-hidden="true">
              {catalog.counts.mine}
            </span>
          )}
        </NavLink>
        <div className="nav-section-label">Workspace</div>
        <NavLink
          onClick={close}
          to="/tasks"
          aria-label="All tasks"
          aria-description={
            catalog?.counts?.issues === undefined ? undefined : catalog.counts.issues + ' all tasks'
          }
          end
          className={navClass}
        >
          <Layers size={16} />
          <span>All tasks</span>
          {catalog?.counts?.issues !== undefined && (
            <span className="nav-count" aria-hidden="true">
              {catalog.counts.issues}
            </span>
          )}
        </NavLink>
        <NavLink
          onClick={close}
          to="/epics"
          aria-label="Epics"
          aria-description={
            catalog?.counts?.epics === undefined ? undefined : catalog.counts.epics + ' epics'
          }
          className={navClass}
        >
          <Layers size={16} />
          <span>Epics</span>
          {catalog?.counts?.epics !== undefined && (
            <span className="nav-count" aria-hidden="true">
              {catalog.counts.epics}
            </span>
          )}
        </NavLink>
        {moduleEnabled(catalog, 'planning') && (
          <NavLink
            onClick={close}
            to="/projects"
            aria-label="Projects"
            aria-description={
              catalog?.counts?.projects === undefined
                ? undefined
                : catalog.counts.projects + ' projects'
            }
            className={navClass}
          >
            <FolderKanban size={16} />
            <span>Projects</span>
            {catalog?.counts?.projects !== undefined && (
              <span className="nav-count" aria-hidden="true">
                {catalog.counts.projects}
              </span>
            )}
          </NavLink>
        )}
        {moduleEnabled(catalog, 'cycles') && (
          <NavLink
            onClick={close}
            to="/cycles"
            aria-label="Cycles"
            aria-description={
              catalog?.counts?.cycles === undefined ? undefined : catalog.counts.cycles + ' cycles'
            }
            className={navClass}
          >
            <CalendarRange size={16} />
            <span>Cycles</span>
            {catalog?.counts?.cycles !== undefined && (
              <span className="nav-count" aria-hidden="true">
                {catalog.counts.cycles}
              </span>
            )}
          </NavLink>
        )}
        {moduleEnabled(catalog, 'planning') && (
          <>
            <NavLink
              onClick={close}
              to="/initiatives"
              aria-label="Initiatives"
              aria-description={
                catalog?.counts?.initiatives === undefined
                  ? undefined
                  : catalog.counts.initiatives + ' initiatives'
              }
              className={navClass}
            >
              <Flag size={16} />
              <span>Initiatives</span>
              {catalog?.counts?.initiatives !== undefined && (
                <span className="nav-count" aria-hidden="true">
                  {catalog.counts.initiatives}
                </span>
              )}
            </NavLink>
            <NavLink
              onClick={close}
              to="/documents"
              aria-label="Documents"
              aria-description={
                catalog?.counts?.documents === undefined
                  ? undefined
                  : catalog.counts.documents + ' documents'
              }
              className={navClass}
            >
              <FileText size={16} />
              <span>Documents</span>
              {catalog?.counts?.documents !== undefined && (
                <span className="nav-count" aria-hidden="true">
                  {catalog.counts.documents}
                </span>
              )}
            </NavLink>
          </>
        )}
        <div className="nav-section-label">Your teams</div>
        {catalog?.teams.map((team) => (
          <TeamNavigationRow key={team.id} team={team} close={close} />
        ))}
        {moduleEnabled(catalog, 'views') && (
          <>
            <div className="nav-section-label">Saved views</div>
            {views.data?.map((view) => {
              const path =
                '/tasks?' +
                new URLSearchParams(
                  Object.entries(view.filters).map(([key, value]) => [key, String(value)]),
                );
              const open = () => {
                close();
                void navigate(path);
              };
              return (
                <ContextRow
                  className="saved-view-context-row nav-action-row"
                  key={view.id}
                  label={'Actions for ' + view.name}
                  items={[
                    { label: 'Open saved view', onSelect: open },
                    ...copyActions({ id: view.id, title: view.name, path, kind: 'view' }),
                    {
                      label: 'Delete saved view',
                      danger: true,
                      separatorBefore: true,
                      disabled:
                        view.owner_id !== me?.id && !['owner', 'admin'].includes(me?.role ?? ''),
                      onSelect: async () => {
                        if (
                          !window.confirm(
                            'Delete the saved view “' +
                              view.name +
                              '”? Its tasks will not be deleted.',
                          )
                        )
                          return;
                        await api('/v1/views/' + view.id, { method: 'DELETE' });
                        await client.invalidateQueries({ queryKey: ['views'] });
                      },
                    },
                  ]}
                >
                  <button type="button" className="nav-item" onClick={open}>
                    <SlidersHorizontal size={15} />
                    <span>{view.name}</span>
                  </button>
                </ContextRow>
              );
            })}
            {!views.data?.length && (
              <p className="nav-empty">Save a filtered view to pin it here.</p>
            )}
          </>
        )}
        <NavLink
          onClick={close}
          to="/archive"
          aria-label="Archive"
          aria-description={
            catalog?.counts?.archive === undefined ? undefined : catalog.counts.archive + ' archive'
          }
          className={navClass}
        >
          <Archive size={15} />
          <span>Archive</span>
          {catalog?.counts?.archive !== undefined && (
            <span className="nav-count" aria-hidden="true">
              {catalog.counts.archive}
            </span>
          )}
        </NavLink>
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/settings" className={navClass} onClick={close}>
          <Settings size={16} />
          <span>Settings</span>
        </NavLink>
        <div className="profile-row">
          <Avatar name={me?.name} />
          <span>{me?.name}</span>
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void logout()}>
            <LogOut size={14} />
          </Button>
        </div>
      </div>
    </aside>
  );
  return mobile ? (
    <>
      <div
        className="mobile-navigation-bar"
        data-collapsed={chrome.collapsed}
        data-keyboard={chrome.keyboard}
        inert={chrome.keyboard}
      >
        <nav className="mobile-dock" aria-label="Mobile navigation">
          <NavLink to="/tasks" aria-label="Tasks" className={navClass}>
            <Layers size={21} />
            <span>Tasks</span>
          </NavLink>
          <NavLink to="/my-tasks" className={navClass}>
            <UserRound size={21} />
            <span>My tasks</span>
          </NavLink>
          {moduleEnabled(catalog, 'planning') && (
            <NavLink to="/projects" className={navClass}>
              <FolderKanban size={21} />
              <span>Projects</span>
            </NavLink>
          )}
          <button
            type="button"
            className="nav-item"
            aria-label="More navigation"
            aria-expanded={prefs.sidebarOpen}
            onClick={() => prefs.setSidebarOpen(true)}
          >
            <Ellipsis size={21} />
            <span>More</span>
          </button>
        </nav>
        {!documentRoute && me?.role !== 'viewer' && (
          <button
            type="button"
            className="mobile-create"
            aria-label={
              location.pathname === '/projects'
                ? 'Create new project'
                : location.pathname === '/cycles'
                  ? 'Create new cycle'
                  : 'Create new task'
            }
            onClick={() =>
              location.pathname === '/projects' || location.pathname === '/cycles'
                ? navigate(location.pathname + '/new')
                : onCreate()
            }
          >
            <Plus size={25} />
          </button>
        )}
      </div>
      <Modal
        open={prefs.sidebarOpen}
        onOpenChange={prefs.setSidebarOpen}
        title="Navigation"
        className="mobile-nav-dialog"
      >
        {content}
      </Modal>
    </>
  ) : (
    content
  );
}
