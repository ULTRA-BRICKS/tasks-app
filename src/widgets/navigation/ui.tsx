import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Inbox,
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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCatalog, useMe, useViews, useNotifications, moduleEnabled } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import { Avatar, Button, Modal } from '@/shared/ui';
import { api } from '@/shared/api/client';
export function Navigation({ onCreate, onSearch }: { onCreate: () => void; onSearch: () => void }) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    views = useViews(moduleEnabled(catalog, 'views')),
    notifications = useNotifications(moduleEnabled(catalog, 'notifications')),
    client = useQueryClient();
  const prefs = usePreferences(),
    navigate = useNavigate();
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
      if (key.startsWith('ticket-draft:')) sessionStorage.removeItem(key);
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
        <span className="workspace-logo">a</span>
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
          aria-label="Create new issue"
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
        <NavLink onClick={close} to="/my-issues" className={navClass}>
          <UserRound size={16} />
          <span>My issues</span>
        </NavLink>
        <div className="nav-section-label">Workspace</div>
        <NavLink onClick={close} to="/issues" end className={navClass}>
          <Layers size={16} />
          <span>All issues</span>
        </NavLink>
        <NavLink onClick={close} to="/epics" className={navClass}>
          <Layers size={16} />
          <span>Epics</span>
        </NavLink>
        {moduleEnabled(catalog, 'planning') && (
          <NavLink onClick={close} to="/projects" className={navClass}>
            <FolderKanban size={16} />
            <span>Projects</span>
          </NavLink>
        )}
        {moduleEnabled(catalog, 'cycles') && (
          <NavLink onClick={close} to="/cycles" className={navClass}>
            <CalendarRange size={16} />
            <span>Cycles</span>
          </NavLink>
        )}
        <div className="nav-section-label">Your teams</div>
        {catalog?.teams.map((t) => (
          <button
            type="button"
            key={t.id}
            className="nav-item"
            onClick={() => navigate('/issues?team_id=' + t.id)}
          >
            <span className="team-icon">{t.key.slice(0, 1)}</span>
            <span>{t.name}</span>
          </button>
        ))}
        {moduleEnabled(catalog, 'views') && (
          <>
            <div className="nav-section-label">Saved views</div>
            {views.data?.map((v) => (
              <button
                type="button"
                className="nav-item"
                key={v.id}
                onClick={() =>
                  navigate(
                    '/issues?' +
                      new URLSearchParams(
                        Object.entries(v.filters).map(([k, value]) => [k, String(value)]),
                      ),
                  )
                }
              >
                <SlidersHorizontal size={15} />
                <span>{v.name}</span>
              </button>
            ))}
            {!views.data?.length && (
              <p className="nav-empty">Save a filtered view to pin it here.</p>
            )}
          </>
        )}
        <NavLink onClick={close} to="/archive" className={navClass}>
          <Archive size={15} />
          <span>Archive</span>
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
    <Modal
      open={prefs.sidebarOpen}
      onOpenChange={prefs.setSidebarOpen}
      title="Navigation"
      className="mobile-nav-dialog"
    >
      {content}
    </Modal>
  ) : (
    content
  );
}
