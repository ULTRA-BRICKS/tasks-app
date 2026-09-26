import { useLocalState } from '../../shared/lib/state';
import { WorkspacePolicySettings } from '@/features/workspace-policy';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  PanelLeft,
  Check,
  ExternalLink,
  KeyRound,
  Plug,
  Users,
  Layers,
  Palette,
  Plus,
} from 'lucide-react';
import { useCatalog, useMe } from '@/entities/workspace';
import { usePreferences, usePreferencePersistence } from '@/features/preferences';
import { Button, Input, Textarea, Picker, Avatar, ErrorState, Loading } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
type IntegrationState = {
  github: {
    configured: boolean;
    outbound_configured: boolean;
    repository: string | null;
    config: Record<string, unknown>;
  };
  slack: {
    configured: boolean;
    outbound_configured: boolean;
    config: Record<string, unknown>;
  };
  jobs: {
    provider: string;
    status: string;
    count: number;
  }[];
  outbox: {
    provider: string;
    status: string;
    count: number;
  }[];
};
export function SettingsPage() {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe(),
    prefs = usePreferences(),
    persistence = usePreferencePersistence(),
    client = useQueryClient();
  const [tab, setTab] = useLocalState('appearance'),
    [email, setEmail] = useLocalState(''),
    [inviteRole, setInviteRole] = useLocalState('member'),
    [inviteLink, setInviteLink] = useLocalState(''),
    [tokenName, setTokenName] = useLocalState(''),
    [tokenScope, setTokenScope] = useLocalState('read'),
    [revealedToken, setRevealedToken] = useLocalState(''),
    [labelName, setLabelName] = useLocalState(''),
    [labelColor, setLabelColor] = useLocalState('#a694ff');
  const admin = ['owner', 'admin'].includes(me?.role ?? '');
  const tokens = useQuery({
    queryKey: ['tokens'],
    queryFn: () =>
      api<
        {
          id: string;
          name: string;
          expires_at: string;
          scopes: string;
        }[]
      >('/v1/tokens'),
    enabled: tab === 'tokens',
  });
  const connections = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api<IntegrationState>('/v1/integrations'),
    enabled: admin && tab === 'integrations',
  });
  const action = useMutation({
    mutationFn: async (data: { type: string; id?: string; value?: unknown }) => {
      if (data.type === 'module')
        return api('/v1/modules/' + data.id, { method: 'PATCH', json: { enabled: data.value } });
      if (data.type === 'invite') {
        const r = await api<{
          token: string;
        }>('/v1/invitations', { method: 'POST', json: { email, role: inviteRole } });
        setInviteLink(window.location.origin + '/invite#token=' + encodeURIComponent(r.token));
        return r;
      }
      if (data.type === 'token') {
        const scopes =
          tokenScope === 'admin'
            ? ['read', 'write', 'admin']
            : tokenScope === 'write'
              ? ['read', 'write']
              : ['read'];
        const r = await api<{
          token: string;
        }>('/v1/tokens', { method: 'POST', json: { name: tokenName, scopes, days: 90 } });
        setRevealedToken(r.token);
        setTokenName('');
        return r;
      }
      if (data.type === 'revoke') return api('/v1/tokens/' + data.id, { method: 'DELETE' });
      if (data.type === 'role')
        return api('/v1/members/' + data.id, { method: 'PATCH', json: { role: data.value } });
      if (data.type === 'label') {
        const r = await api('/v1/labels', {
          method: 'POST',
          json: { name: labelName, color: labelColor },
        });
        setLabelName('');
        return r;
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['catalog'] });
      void client.invalidateQueries({ queryKey: ['tokens'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const tabs = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'members', label: 'People', icon: Users },
    { id: 'workflow', label: 'Workflow', icon: Layers },
    { id: 'tokens', label: 'API & CLI', icon: KeyRound },
    ...(admin
      ? [
          { id: 'security', label: 'Security', icon: KeyRound },
          { id: 'modules', label: 'Modules', icon: Layers },
          { id: 'integrations', label: 'Integrations', icon: Plug },
        ]
      : []),
  ];
  return (
    <>
      <header className="page-toolbar">
        <Button
          className="mobile-only"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => prefs.setSidebarOpen(true)}
        >
          <PanelLeft size={17} />
        </Button>
        <div className="page-heading">
          <Settings size={17} />
          <h1>Settings</h1>
        </div>
        <span className="muted">{catalog?.workspace.name}</span>
      </header>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => {
                setTab(t.id);
                action.reset();
              }}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {persistence.kind !== 'ready' && (
            <section
              aria-label="Settings persistence"
              aria-live="polite"
              className="notice"
              data-testid="preference-persistence-status"
            >
              <strong>Settings are not saved on this device.</strong>
              <p>{persistence.message}</p>
              <p>Your current choices remain available in this tab.</p>
              <Button variant="secondary" onClick={() => persistence.retry()}>
                Retry saving settings
              </Button>
            </section>
          )}
          {tab === 'security' && admin && <WorkspacePolicySettings />}
          {tab === 'appearance' && (
            <>
              <h2>Make room for focus.</h2>
              <p className="settings-description">
                The same quiet palette, in light or dark. Your preference stays on this device.
              </p>
              <div className="theme-options">
                {(['dark', 'light'] as const).map((theme) => (
                  <button
                    type="button"
                    key={theme}
                    className={'theme-choice ' + theme + (prefs.theme === theme ? ' selected' : '')}
                    onClick={() => prefs.setTheme(theme)}
                    aria-pressed={prefs.theme === theme}
                  >
                    <span className="theme-preview">
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>{theme === 'dark' ? 'Dark' : 'Light'}</strong>
                    {prefs.theme === theme && <Check size={15} />}
                  </button>
                ))}
              </div>
              <div className="settings-note">
                Design tokens are the source of truth. <code>bun run tokens:build</code> generates
                CSS and TypeScript; <code>bun run tokens:check</code> detects drift.
              </div>
            </>
          )}
          {tab === 'members' && (
            <>
              <h2>People</h2>
              <p className="settings-description">
                Invite-only access. Viewers can read; members can edit; administrators manage the
                workspace.
              </p>
              <div className="member-list">
                {catalog?.people.map((p) => (
                  <div className="member-row" key={p.id}>
                    <Avatar name={p.name} size="md" />
                    <div>
                      <strong>{p.name}</strong>
                      <span>{p.email}</span>
                    </div>
                    <Picker
                      aria-label={`Role of ${p.name}`}
                      value={p.role}
                      options={['owner', 'admin', 'member', 'viewer'].map((v) => ({
                        value: v,
                        label: v,
                      }))}
                      onChange={(v) => {
                        if (window.confirm(`Change ${p.name}'s role to ${v}?`))
                          action.mutate({ type: 'role', id: p.id, value: v });
                      }}
                      disabled={!admin || action.isPending}
                    />
                  </div>
                ))}
              </div>
              {admin && (
                <form
                  className="stack-form settings-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action.mutate({ type: 'invite' });
                  }}
                >
                  <h3>Invite a teammate</h3>
                  <Input
                    type="email"
                    aria-label="Invite email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <Picker
                    aria-label="Invite role"
                    value={inviteRole}
                    onChange={setInviteRole}
                    options={['member', 'viewer', 'admin'].map((v) => ({ value: v, label: v }))}
                  />
                  <Button type="submit" disabled={action.isPending || !email}>
                    Create invitation link
                  </Button>
                  {inviteLink && (
                    <div className="secret-output">
                      <p>Share this link privately. It expires in 7 days and can be used once.</p>
                      <Input
                        aria-label="Invitation link"
                        value={inviteLink}
                        readOnly
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                  )}
                </form>
              )}
            </>
          )}
          {tab === 'workflow' && (
            <>
              <h2>Workflow & labels</h2>
              <p className="settings-description">
                Statuses belong to teams. Labels belong to the workspace and can be combined.
              </p>
              {catalog?.teams.map((team) => (
                <section key={team.id} className="settings-section">
                  <h3>{team.name}</h3>
                  {catalog.statuses
                    .filter((s) => s.team_id === team.id)
                    .map((s) => (
                      <div className="workflow-row" key={s.id}>
                        <span style={{ color: s.color }}>●</span>
                        <strong>{s.name}</strong>
                        <span>{s.category}</span>
                      </div>
                    ))}
                </section>
              ))}
              <section className="settings-section">
                <h3>Labels</h3>
                <div className="all-labels">
                  {catalog?.labels.map((l) => (
                    <span className="label-pill" key={l.id}>
                      <span style={{ color: l.color }}>●</span>
                      {l.name}
                    </span>
                  ))}
                </div>
                {me?.role !== 'viewer' && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      action.mutate({ type: 'label' });
                    }}
                  >
                    <Input
                      aria-label="New label name"
                      placeholder="New label"
                      value={labelName}
                      onChange={(e) => setLabelName(e.target.value)}
                      required
                      maxLength={80}
                    />
                    <Input
                      aria-label="Label color"
                      type="color"
                      value={labelColor}
                      onChange={(e) => setLabelColor(e.target.value)}
                    />
                    <Button type="submit" disabled={action.isPending || !labelName.trim()}>
                      <Plus size={14} />
                      Add
                    </Button>
                  </form>
                )}
              </section>
              <p className="settings-note">
                Team and status creation are also available through the API. Reordering, merging and
                deleting workflow states are planned separately to preserve existing issue
                references.
              </p>
            </>
          )}
          {tab === 'tokens' && (
            <>
              <h2>API & CLI</h2>
              <p className="settings-description">
                One API for the interface, scripts, and agents. Tokens inherit your current
                membership permissions.
              </p>
              <div className="code-sample">
                <code>tickets issues list --assignee me --json</code>
                <code>tickets issues update TKT-42 --version 3 --priority 1</code>
              </div>
              <a
                className="text-link"
                href="/api/openapi.json"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenAPI specification <ExternalLink size={13} />
              </a>
              <form
                className="stack-form settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action.mutate({ type: 'token' });
                }}
              >
                <h3>Create a personal token</h3>
                <Input
                  aria-label="Token name"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="e.g. local CLI"
                  required
                />
                <Picker
                  aria-label="Token permissions"
                  value={tokenScope}
                  onChange={setTokenScope}
                  options={[
                    { value: 'read', label: 'Read only' },
                    ...(me?.role !== 'viewer' ? [{ value: 'write', label: 'Read and write' }] : []),
                    ...(admin ? [{ value: 'admin', label: 'Read, write and admin' }] : []),
                  ]}
                />
                <Button type="submit" disabled={!tokenName.trim() || action.isPending}>
                  Create 90-day token
                </Button>
                {revealedToken && (
                  <div className="secret-output">
                    <p>
                      Copy now. This token is shown only in this session. Store it like a password.
                    </p>
                    <Input
                      aria-label="New API token"
                      readOnly
                      value={revealedToken}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                )}
              </form>
              {tokens.data?.map((t) => (
                <div className="token-row" key={t.id}>
                  <KeyRound size={15} />
                  <strong>{t.name}</strong>
                  <span>Expires {formatDate(t.expires_at)}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={action.isPending}
                    onClick={() => {
                      if (window.confirm('Revoke this token immediately?'))
                        action.mutate({ type: 'revoke', id: t.id });
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </>
          )}
          {tab === 'modules' && admin && (
            <>
              <h2>Only what your team needs.</h2>
              <p className="settings-description">
                Turning off a module hides its screens and rejects its API operations. It does not
                erase stored data.
              </p>
              {catalog?.modules.map((m) => (
                <section key={m.id} className="module-row">
                  <div>
                    <h3>
                      {m.name}
                      {m.required && <span className="required-badge">Core</span>}
                    </h3>
                    <p>{m.description}</p>
                  </div>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={m.enabled}
                    className="toggle"
                    aria-label={`${m.name} enabled`}
                    checked={m.enabled}
                    disabled={Boolean(m.required) || action.isPending}
                    onChange={(e) =>
                      action.mutate({ type: 'module', id: m.id, value: e.target.checked })
                    }
                  />
                </section>
              ))}
            </>
          )}
          {tab === 'integrations' && admin && (
            <>
              <h2>Connected work, fewer loose ends.</h2>
              <p className="settings-description">
                Credentials stay in deployment environment variables. A green connection requires
                actual configured secrets, not just an enabled module.
              </p>
              {connections.isPending ? (
                <Loading />
              ) : connections.error ? (
                <ErrorState message={errorMessage(connections.error)} />
              ) : (
                connections.data && (
                  <>
                    <IntegrationCard provider="github" state={connections.data.github} />
                    <IntegrationCard provider="slack" state={connections.data.slack} />
                    <div className="settings-note">
                      Webhook inbox and outbound queue are durable. Run <code>bun run worker</code>{' '}
                      to process jobs. Delivery to external systems has not been live-verified in
                      this initial build.
                    </div>
                    <h3>Delivery queue</h3>
                    <pre className="job-summary">
                      {JSON.stringify(
                        { incoming: connections.data.jobs, outgoing: connections.data.outbox },
                        null,
                        2,
                      )}
                    </pre>
                  </>
                )
              )}
            </>
          )}
          {action.error && <ErrorState message={errorMessage(action.error)} />}
        </div>
      </div>
    </>
  );
}
function IntegrationCard({
  provider,
  state,
}: {
  provider: 'github' | 'slack';
  state: {
    configured: boolean;
    outbound_configured: boolean;
    config: Record<string, unknown>;
  };
}) {
  const client = useQueryClient(),
    { data: catalog } = useCatalog();
  const [text, setText] = useLocalState(
    JSON.stringify(
      Object.keys(state.config ?? {}).length
        ? state.config
        : provider === 'github'
          ? { review_status_id: null, done_status_id: null }
          : { team_id: catalog?.teams[0]?.id, notify: false, user_map: {} },
      null,
      2,
    ),
  );
  const mutation = useMutation({
    mutationFn: () =>
      api('/v1/integrations/' + provider, { method: 'PATCH', json: JSON.parse(text) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
  return (
    <section className="integration-card">
      <header>
        <span className="integration-icon">{provider === 'github' ? 'GH' : '#'}</span>
        <h3>{provider === 'github' ? 'GitHub' : 'Slack'}</h3>
        <span className={state.configured ? 'connection-status connected' : 'connection-status'}>
          {state.configured ? 'Configured' : 'Not connected'}
        </span>
      </header>
      <p>
        {provider === 'github'
          ? 'Import issues, export explicitly, and link pull requests. A closed unmerged pull request never marks work done.'
          : 'Create issues with /tickets or a message shortcut. Map Slack user IDs to workspace member IDs before enabling writes.'}
      </p>
      <div className="integration-endpoint">
        <code>/api/webhooks/{provider}</code>
      </div>
      <details>
        <summary>Configure status and user mapping</summary>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Textarea
            aria-label={`${provider} configuration JSON`}
            className="code-input"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={mutation.isPending}>
            Save mapping
          </Button>
          {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
        </form>
      </details>
    </section>
  );
}
