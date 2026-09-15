import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Input, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
export function LoginPage() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api('/auth/login', { method: 'POST', json: { email, password } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="auth-logo">
          <img src="/favicon.svg" width="40" height="40" alt="" />
        </span>
        <span className="eyebrow">TASKS</span>
        <h1>
          A little less noise.
          <br />A lot more progress.
        </h1>
        <p className="auth-intro">Sign in to your workspace.</p>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label>
            Email
            <Input
              data-autofocus
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
          <Button variant="default" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in…' : 'Continue'}
            <ArrowRight size={16} />
          </Button>
        </form>
        <div className="auth-footer">
          <ShieldCheck size={14} />
          <span>Invite-only workspace. Ask an owner for access.</span>
        </div>
        {import.meta.env.DEV && (
          <p className="dev-hint">
            Local demo after <code>bun run setup -- --demo</code>:<br />
            demo@example.test · local-demo-password
          </p>
        )}
      </div>
      <p className="auth-credit">Built for the work, not the busywork.</p>
    </main>
  );
}
export function InvitePage() {
  const [params] = useSearchParams(),
    [name, setName] = useState(''),
    [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api('/auth/accept-invite', {
        method: 'POST',
        json: { token: params.get('token'), name, password },
      }),
  });
  return (
    <main className="auth-page">
      <div className="auth-card">
        <img src="/favicon.svg" width="40" height="40" alt="" />
        <h1>Join your team.</h1>
        {mutation.isSuccess ? (
          <>
            <p>Your invitation was accepted. Sign in with your email and password.</p>
            <Link className="button button-primary" to="/issues">
              Continue to sign in
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
            <Button
              variant="default"
              type="submit"
              disabled={mutation.isPending || !params.get('token')}
            >
              Accept invitation
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
