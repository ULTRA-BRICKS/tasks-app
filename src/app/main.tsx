import { DraftMonitor, DraftsPage } from '@/features/draft-recovery';
import { PlanningDocumentPage } from '@/pages/planning-document';
import { WorkspaceKeyboard } from '@/features/keyboard';
import { NewIssuePage } from '@/pages/issue-new';
import React, { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMe } from '@/entities/workspace';
import { usePreferences } from '@/features/preferences';
import { CreateIssue } from '@/features/issue-create';
import { CommandMenu } from '@/features/command-menu';
import { Navigation } from '@/widgets/navigation';
import { IssuesPage } from '@/pages/issues';
import { PlanningPage } from '@/pages/planning';
import { InboxPage } from '@/pages/inbox';
import { SettingsPage } from '@/pages/settings';
import { LoginPage, InvitePage, ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth';
import { ErrorState, Loading } from '@/shared/ui';
import { ApiError, errorMessage } from '@/shared/api/client';
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
  const me = useMe(),
    prefs = usePreferences(),
    navigate = useNavigate(),
    [createOpen, setCreateOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);
  if (me.isPending)
    return (
      <div className="app-loading">
        <Loading label="Opening workspace" />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
  if (me.error)
    return (
      <div className="app-loading">
        <ErrorState message={errorMessage(me.error)} retry={() => void me.refetch()} />
      </div>
    );
  return (
    <div className="app-shell" key={me.data?.workspace_id + ':' + me.data?.id}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Navigation onCreate={() => setCreateOpen(true)} onSearch={() => setSearchOpen(true)} />
      <main id="main-content" className="workspace-main">
        <DraftMonitor />
        <Routes>
          <Route path="/" element={<Navigate to="/issues" replace />} />
          <Route path="/login" element={<Navigate to="/issues" replace />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/issues/new" element={<NewIssuePage />} />
          <Route path="/issues/:issueId" element={<IssuesPage />} />
          <Route path="/my-issues" element={<IssuesPage />} />
          <Route path="/epics" element={<IssuesPage />} />
          <Route path="/archive" element={<IssuesPage />} />
          <Route path="/projects" element={<PlanningPage kind="projects" />} />
          <Route path="/cycles" element={<PlanningPage kind="cycles" />} />
          <Route path="/projects/:id" element={<PlanningDocumentPage kind="projects" />} />
          <Route path="/cycles/:id" element={<PlanningDocumentPage kind="cycles" />} />
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route
            path="*"
            element={
              <div className="empty-state">
                <h1>Page not found</h1>
                <button className="button button-secondary" onClick={() => navigate('/issues')}>
                  Back to issues
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
  );
}
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
