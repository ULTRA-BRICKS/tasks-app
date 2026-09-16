import { AuthShell } from './shell';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
export function useEphemeralLinkToken() {
  const [token] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get('token') ??
      new URLSearchParams(window.location.search).get('token') ??
      '',
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }, []);
  return token;
}
function AccountPage({
  title,
  children,
  email = '',
  description,
}: {
  title: string;
  children: ReactNode;
  email?: string;
  description?: string;
}) {
  return (
    <AuthShell
      title={title}
      description={description}
      footer={
        <Link className="auth-back-link" to="/login" state={{ email }}>
          Back to sign in
        </Link>
      }
    >
      {children}
    </AuthShell>
  );
}
export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState(() =>
    typeof location.state?.email === 'string' ? location.state.email.slice(0, 254) : '',
  );
  const mutation = useMutation({
    mutationFn: () =>
      api('/auth/forgot-password', { method: 'POST', json: { email: email.trim() } }),
  });
  return (
    <AccountPage
      title="Forgot your password?"
      email={email}
      description={
        mutation.isSuccess ? undefined : 'We’ll send a secure link to your account email.'
      }
    >
      {mutation.isSuccess ? (
        <output>
          If an account exists for this email, a reset link will arrive shortly. Check your inbox
          and spam folder.
        </output>
      ) : (
        <>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!mutation.isPending) mutation.mutate();
            }}
          >
            <label>
              Email
              <Input
                type="email"
                autoComplete="username"
                maxLength={254}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
            <Button variant="default" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Requesting link…' : 'Send reset link'}
            </Button>
          </form>
        </>
      )}
    </AccountPage>
  );
}
export function ResetPasswordPage() {
  const token = useEphemeralLinkToken(),
    client = useQueryClient();
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const mutation = useMutation({
    mutationFn: () => api('/auth/reset-password', { method: 'POST', json: { token, password } }),
    onSuccess: () => {
      setPassword('');
      setConfirmation('');
      client.removeQueries({ queryKey: ['me'] });
    },
  });
  const mismatch = confirmation.length > 0 && password !== confirmation;
  return (
    <AccountPage title="Choose a new password">
      {mutation.isSuccess ? (
        <output>
          Your password was changed. All previous sessions and personal API tokens were revoked.
          Sign in with your new password.
        </output>
      ) : !/^[A-Za-z0-9_-]{43}$/.test(token) ? (
        <>
          <p>This link is incomplete. Request a new one. Your account has not changed.</p>
          <Link to="/forgot-password">Request a reset link</Link>
        </>
      ) : (
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mutation.isPending && password === confirmation) mutation.mutate();
          }}
        >
          <label>
            New password
            <Input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <Input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
              aria-invalid={mismatch}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <p className="muted">
            Use 12–256 characters. Changing your password signs out all devices and revokes personal
            API tokens.
          </p>
          {mismatch && <p role="alert">The passwords do not match.</p>}
          {mutation.error && (
            <>
              <ErrorState message={errorMessage(mutation.error)} />
              <Link className="auth-back-link" to="/forgot-password">
                Request a new reset link
              </Link>
            </>
          )}
          <Button type="submit" variant="default" disabled={mutation.isPending || mismatch}>
            {mutation.isPending ? 'Changing password…' : 'Set new password'}
          </Button>
        </form>
      )}
    </AccountPage>
  );
}
