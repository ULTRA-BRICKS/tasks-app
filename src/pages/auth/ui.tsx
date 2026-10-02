import { useEphemeralLinkToken } from './password-reset';
import { useId, useRef, useState, type MouseEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from './shell';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Input, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
const formText = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
};
export function LoginPage() {
  const location = useLocation(),
    passwordId = useId(),
    navigate = useNavigate(),
    submitting = useRef(false);
  const [email, setEmail] = useState(() =>
      typeof location.state?.email === 'string' ? location.state.email.slice(0, 254) : '',
    ),
    [password, setPassword] = useState(''),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api('/auth/login', { method: 'POST', json: input }),
    onSettled: () => {
      submitting.current = false;
    },
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
          if (submitting.current || mutation.isPending) return;
          // Native form values also cover autofill/password managers without React change events.
          const data = new FormData(e.currentTarget);
          const input = {
            email: formText(data, 'email').trim(),
            password: formText(data, 'password'),
          };
          setEmail(input.email);
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
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
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
              onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.button !== 0) return;
                const form = e.currentTarget.closest('form');
                if (!form) return;
                e.preventDefault();
                void navigate('/forgot-password', {
                  state: { email: formText(new FormData(form), 'email').trim() },
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
            enterKeyHint="go"
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
