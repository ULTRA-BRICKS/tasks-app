import { useEphemeralLinkToken } from './password-reset';
import { slackSigninMessage } from './slack-signin-message';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from './shell';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Input, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation(),
    passwordId = useId();
  const submitting = useRef(false);
  const [email, setEmail] = useState(() =>
      typeof location.state?.email === 'string' ? location.state.email.slice(0, 254) : '',
    ),
    [password, setPassword] = useState(''),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api('/auth/login', { method: 'POST', json: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const options = useQuery({
    queryKey: ['account-options'],
    queryFn: () => api<{ passwordReset: boolean; slackSignIn?: boolean }>('/auth/options'),
  });
  // Read once, then drop the query so the message does not outlive this visit.
  const [slackError] = useState(() =>
    slackSigninMessage(new URLSearchParams(location.search).get('slack_signin')),
  );
  useEffect(() => {
    if (new URLSearchParams(location.search).has('slack_signin'))
      void navigate({ pathname: location.pathname }, { replace: true });
  }, [location.pathname, location.search, navigate]);
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
        onInput={(event) => {
          // Editing one field must adopt silent autofill in its sibling before React renders.
          const data = new FormData(event.currentTarget);
          const address = data.get('email'),
            secret = data.get('password');
          if (typeof address === 'string') setEmail(address);
          if (typeof secret === 'string') setPassword(secret);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting.current) return;
          // Browser autofill can update the fields without a React change event.
          const data = new FormData(e.currentTarget);
          const address = data.get('email'),
            secret = data.get('password');
          if (typeof address !== 'string' || typeof secret !== 'string') return;
          const input = { email: address.trim(), password: secret };
          setEmail(input.email);
          setPassword(input.password);
          // Lock synchronously: mutation.isPending changes only on the next render.
          submitting.current = true;
          mutation.mutate(input);
        }}
      >
        <label className="auth-field">
          <span className="auth-field-heading">Email</span>
          <Input
            data-autofocus
            type="email"
            name="email"
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
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey ||
                  event.shiftKey
                )
                  return;
                const form = event.currentTarget.closest('form');
                const address = form ? new FormData(form).get('email') : email;
                event.preventDefault();
                void navigate('/forgot-password', {
                  state: { email: typeof address === 'string' ? address.trim() : email.trim() },
                });
              }}
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id={passwordId}
            type="password"
            name="password"
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
      {options.data?.slackSignIn && (
        <a
          className="button button-secondary auth-submit"
          href="/api/auth/slack/start"
          data-testid="slack-signin"
        >
          Continue with Slack
        </a>
      )}
      {slackError && <ErrorState message={slackError} />}
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
    [name, setName] = useState(''),
    [password, setPassword] = useState('');
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
