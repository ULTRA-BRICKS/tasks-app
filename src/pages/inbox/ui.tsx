import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Inbox, Check, PanelLeft } from 'lucide-react';
import { useCatalog, useNotifications, moduleEnabled } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import { Button, EmptyState, ErrorState, Loading } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
export function InboxPage() {
  const { data: catalog } = useCatalog(),
    query = useNotifications(moduleEnabled(catalog, 'notifications')),
    client = useQueryClient(),
    prefs = usePreferences();
  const read = useMutation({
    mutationFn: (id: string) => api('/v1/notifications/' + id + '/read', { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  return (
    <>
      <header className="page-toolbar" data-page-header>
        <Button
          className="mobile-only"
          size="icon"
          variant="ghost"
          aria-label="Open navigation"
          onClick={() => prefs.setSidebarOpen(true)}
        >
          <PanelLeft size={17} />
        </Button>
        <div className="page-heading">
          <Inbox size={17} />
          <h1>Inbox</h1>
        </div>
        <span className="muted">What needs your attention</span>
      </header>
      <div className="inbox-content">
        {!moduleEnabled(catalog, 'notifications') ? (
          <EmptyState title="Inbox is disabled" />
        ) : query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState message={errorMessage(query.error)} />
        ) : !query.data?.length ? (
          <EmptyState
            title="You're all caught up"
            description="Assignments, comments, and updates to subscribed tasks will appear here."
          />
        ) : (
          query.data.map((n) => (
            <article className={'notification' + (!n.read_at ? ' unread' : '')} key={n.id}>
              <span className="notification-dot" />
              <div>
                <p>{n.body}</p>
                <Link to={'/tasks/' + n.issue_id}>
                  <span className="issue-key">{n.key}</span> {n.title}
                </Link>
              </div>
              <time>{formatDate(n.created_at)}</time>
              {!n.read_at && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Mark notification read"
                  onClick={() => read.mutate(n.id)}
                  disabled={read.isPending}
                >
                  <Check size={15} />
                </Button>
              )}
            </article>
          ))
        )}
      </div>
      {read.error && <ErrorState message={errorMessage(read.error)} />}
    </>
  );
}
