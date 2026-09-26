import { useLocalState } from '../../shared/lib/state';
import { useEphemeralLinkToken } from './password-reset';
import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { AuthShell } from './shell';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Input, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
export function LoginPage() {
  const location = useLocation(),
    passwordId = useId();
  const [email, setEmail] = useLocalState(() =>
      typeof location.state?.email === 'string' ? location.state.email.slice(0, 254) : '',
    ),
    [password, setPassword] = useLocalState(''),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api('/auth/login', { method: 'POST', json: { email: email.trim(), password } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your workspace."
      footer={
        <>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            Invite-only workspace.
            <br />
            Ask your workspace owner for access.
          </span>
        </>
      }
    >
      <form
        className="stack-form auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mutation.isPending) mutation.mutate();
        }}
      >
        <label className="auth-field">
          <span className="auth-field-heading">Email</span>
          <Input
            data-autofocus
            type="email"
            autoComplete="username"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <div className="auth-field auth-password-field">
          <div className="auth-field-heading">
            <label htmlFor={passwordId}>Password</label>
            <Link
              className="auth-recovery-link"
              to="/forgot-password"
              state={{ email: email.trim() }}
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
        <Button
          className="auth-submit"
          variant="default"
          type="submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Signing in…' : 'Continue'}
          <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </form>
      {import.meta.env.DEV && (
        <p className="dev-hint">
          Local demo after <code>bun run setup -- --demo</code>:<br />
          demo@example.test · local-demo-password
        </p>
      )}
    </AuthShell>
  );
}
export function InvitePage() {
  const token = useEphemeralLinkToken(),
    [name, setName] = useLocalState(''),
    [password, setPassword] = useLocalState('');
  const mutation = useMutation({
    mutationFn: () =>
      api<{ email: string }>('/auth/accept-invite', {
        method: 'POST',
        json: { token: token, name, password },
      }),
  });
  return (
    <AuthShell title="Join your team." description="Accept your invitation to Tasks.">
      {mutation.isSuccess ? (
        <>
          <p>Your invitation was accepted. Sign in with your email and password.</p>
          <Link
            className="button button-default auth-submit"
            to="/login"
            state={{ email: mutation.data.email }}
          >
            Continue to sign in
          </Link>
        </>
      ) : !token ? (
        <>
          <p>This invitation link is incomplete. Ask your workspace owner for a new invitation.</p>
          <Link className="auth-back-link" to="/login">
            Back to sign in
          </Link>
        </>
      ) : (
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label>
            Your name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
          <label>
            Password
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              maxLength={256}
              required
              autoComplete="new-password"
            />
          </label>
          <p className="muted">
            Use at least 12 characters. Existing members must use their existing account password.
          </p>
          {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
          <Button variant="default" type="submit" disabled={mutation.isPending || !token}>
            Accept invitation
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
