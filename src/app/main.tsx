import { ImportedFilesProvider } from '@/shared/ui';
import { KnowledgeListPage, KnowledgePage } from '@/pages/knowledge';
import { PlanningDocumentPage } from '@/pages/planning-document';
import { WorkspaceKeyboard } from '@/features/keyboard';
import { NewIssuePage } from '@/pages/issue-new';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMe, useCatalog } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import { CreateIssue } from '@/features/issue-create';
import { CommandMenu } from '@/features/command-menu';
import { Navigation } from '@/widgets/navigation';
import { IssuesPage, TaskDetailRoute, LegacyTaskRoute } from '@/pages/issues';
import { PreCanonicalCodePage } from '@/pages/task-code-history';
import { PlanningPage } from '@/pages/planning';
import { InboxPage } from '@/pages/inbox';
import { SettingsPage } from '@/pages/settings';
import { LoginPage, InvitePage, ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth';
import { ErrorState, Loading } from '@/shared/ui';
import { ApiError, errorMessage, setApiSession } from '@/shared/api/client';
import { readCache } from '@/shared/lib/read-cache';
import { SavedCopyNotice, useVisibleError } from '@/features/saved-copy';
import './styles.css';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        error instanceof ApiError && error.status < 500 ? false : count < 1,
    },
    mutations: { retry: false },
  },
});
// The saved workspace copy (docs/PERSISTENT-READ-CACHE.md) stays read-only until /me confirms the
// session; any 401 deletes it in every tab.
readCache.attach(queryClient);
setApiSession({
  canWrite: () => readCache.canWrite(),
  onUnauthorized: () => void readCache.revoke(),
});
class Boundary extends React.Component<
  {
    children: ReactNode;
  },
  {
    error: Error | null;
  }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <main className="fatal-error">
        <h1>This view could not be rendered.</h1>
        <p>No writes were retried automatically.</p>
        <button onClick={() => location.reload()}>Reload application</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function Workspace() {
  const { data: catalog } = useCatalog();
  const me = useMe(),
    prefs = usePreferences(),
    navigate = useNavigate(),
    [createOpen, setCreateOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false);
  // The saved copy keeps rendering while /me cannot be revalidated (offline, 429, 5xx).
  const meError = useVisibleError(me);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.density = prefs.density ?? 'auto';
  }, [prefs.theme, prefs.density]);
  if (me.isPending)
    return (
      <div className="app-loading">
        <Loading label="Opening workspace" />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
  if (meError)
    return (
      <div className="app-loading">
        <ErrorState message={errorMessage(meError)} retry={() => void me.refetch()} />
      </div>
    );
  return (
    <ImportedFilesProvider files={catalog?.imported_files ?? []}>
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Navigation
          mainRef={mainRef}
          onCreate={() => setCreateOpen(true)}
          onSearch={() => setSearchOpen(true)}
        />
        <main ref={mainRef} id="main-content" className="workspace-main">
          <SavedCopyNotice />
          <Routes>
            <Route path="/" element={<Navigate to="/tasks" replace />} />
            <Route path="/login" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks" element={<IssuesPage />} />
            <Route path="/tasks/new" element={<NewIssuePage />} />
            <Route path="/tasks/pre-canonical/:code/:slug?" element={<PreCanonicalCodePage />} />
            <Route path="/tasks/:issueId/:slug?" element={<TaskDetailRoute />} />
            <Route path="/issues/*" element={<LegacyTaskRoute />} />
            <Route path="/my-issues" element={<LegacyTaskRoute />} />
            <Route path="/my-tasks" element={<IssuesPage />} />
            <Route path="/epics" element={<IssuesPage />} />
            <Route path="/archive" element={<IssuesPage />} />
            <Route path="/projects" element={<PlanningPage kind="projects" />} />
            <Route path="/documents" element={<KnowledgeListPage kind="documents" />} />
            <Route path="/documents/:id" element={<KnowledgePage kind="documents" />} />
            <Route path="/initiatives" element={<KnowledgeListPage kind="initiatives" />} />
            <Route path="/initiatives/:id" element={<KnowledgePage kind="initiatives" />} />
            <Route path="/cycles" element={<PlanningPage kind="cycles" />} />
            <Route path="/projects/:id" element={<PlanningDocumentPage kind="projects" />} />
            <Route path="/cycles/:id" element={<PlanningDocumentPage kind="cycles" />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            <Route
              path="*"
              element={
                <div className="empty-state">
                  <h1>Page not found</h1>
                  <button className="button button-secondary" onClick={() => navigate('/tasks')}>
                    Back to tasks
                  </button>
                </div>
              }
            />
          </Routes>
        </main>
        {createOpen && <CreateIssue open={createOpen} onOpenChange={setCreateOpen} />}
        <WorkspaceKeyboard onSearch={() => setSearchOpen(true)} />
        <CommandMenu
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onCreate={() => setCreateOpen(true)}
        />
      </div>
    </ImportedFilesProvider>
  );
}
// Render the saved copy on the first frame instead of waiting for the network.
await readCache.restore(queryClient);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="*" element={<Workspace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </Boundary>
  </React.StrictMode>,
);
