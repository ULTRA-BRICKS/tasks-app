import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Picker, ErrorState } from '@/shared/ui';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
type Invitation = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  status: 'pending' | 'accepted' | 'expired';
};
export function PeopleInvitations() {
  const client = useQueryClient(),
    busy = useRef(false);
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('member'),
    [notice, setNotice] = useState('');
  const list = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api<Invitation[]>('/v1/invitations'),
    refetchInterval: 30000,
  });
  const options = useQuery({
    queryKey: ['account-options'],
    queryFn: () => api<{ passwordReset: boolean }>('/auth/options'),
  });
  const invite = useMutation({
    mutationFn: (input: { email: string; role: string }) =>
      api<{ email_queued: boolean; email: string }>('/v1/invitations', {
        method: 'POST',
        json: { ...input, delivery: 'email' },
      }),
    onSuccess: (result, sent) => {
      setNotice(
        result.email_queued
          ? 'Invitation email queued for ' +
              result.email +
              '. They can accept directly from the email.'
          : 'The invitation exists, but the server could not queue email. Contact your workspace administrator.',
      );
      setEmail((current) => (current.trim() === sent.email ? '' : current));
      void client.invalidateQueries({ queryKey: ['invitations'] });
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  return (
    <section className="people-invitations">
      <form
        className="stack-form settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy.current || !options.data?.passwordReset) return;
          const data = new FormData(event.currentTarget),
            value = data.get('email');
          if (typeof value !== 'string') return;
          busy.current = true;
          setNotice('');
          invite.mutate({ email: value.trim(), role });
        }}
      >
        <h3>Invite a teammate</h3>
        <p className="muted">
          We send the invitation by email. No manual link forwarding is needed.
        </p>
        <Input
          type="email"
          name="email"
          aria-label="Invite email"
          placeholder="name@company.com"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          required
        />
        <Picker
          aria-label="Invite role"
          value={role}
          onChange={setRole}
          options={['member', 'viewer', 'admin'].map((value) => ({ value, label: value }))}
        />
        <Button type="submit" disabled={invite.isPending || !options.data?.passwordReset}>
          {invite.isPending ? 'Sending invitation…' : 'Send invitation'}
        </Button>
        {options.data?.passwordReset === false && (
          <p role="alert">
            Email invitations are unavailable until the workspace sender is configured.
          </p>
        )}
        {options.error && (
          <ErrorState message={errorMessage(options.error)} retry={() => void options.refetch()} />
        )}
        {invite.error && <ErrorState message={errorMessage(invite.error)} />}
        {notice && <output>{notice}</output>}
      </form>
      <h3>Invitations</h3>
      {list.isPending && <p className="muted">Loading invitations…</p>}
      {list.error && (
        <ErrorState message={errorMessage(list.error)} retry={() => void list.refetch()} />
      )}
      {list.data?.length === 0 && <p className="muted">No invitations yet.</p>}
      <div className="invitation-list">
        {list.data?.map((invitation) => (
          <div className="invitation-row" key={invitation.id}>
            <div>
              <strong>{invitation.email}</strong>
              <small>
                {invitation.role} · Expires {formatDate(invitation.expires_at)}
              </small>
            </div>
            <span className={'invitation-status ' + invitation.status}>
              {invitation.status === 'pending'
                ? 'Pending acceptance'
                : invitation.status === 'accepted'
                  ? 'Accepted'
                  : 'Expired'}
            </span>
          </div>
        ))}
      </div>
      {list.data && list.data.length >= 500 && (
        <p className="muted">Showing the 500 most recent invitations.</p>
      )}
    </section>
  );
}
