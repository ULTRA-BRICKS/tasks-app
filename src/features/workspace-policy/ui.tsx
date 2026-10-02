/* oxlint-disable react/set-state-in-effect -- The editable draft is seeded once from the loaded policy; the !draft guard prevents render loops. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { WorkspacePolicy } from '@tickets/contracts';
import { api, ApiError, errorMessage } from '@/shared/api/client';
import { Button, ErrorState, Input, Loading } from '@/shared/ui';

type Draft = { version: number; domains: string[] };

export function WorkspacePolicyPanel() {
  const client = useQueryClient();
  const policy = useQuery({
    queryKey: ['workspace-policy'],
    queryFn: () => api<WorkspacePolicy>('/v1/workspace/policy'),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [entry, setEntry] = useState('');
  useEffect(() => {
    if (policy.data && !draft)
      setDraft({ version: policy.data.version, domains: [...policy.data.allowed_email_domains] });
  }, [policy.data, draft]);
  const save = useMutation({
    mutationFn: (next: Draft) =>
      api<WorkspacePolicy>('/v1/workspace/policy', {
        method: 'PATCH',
        json: { allowed_email_domains: next.domains, version: next.version },
      }),
    onSuccess: () => {
      setDraft(null);
      void client.invalidateQueries({ queryKey: ['workspace-policy'] });
    },
  });
  const conflict =
    save.error instanceof ApiError && save.error.code === 'VERSION_CONFLICT'
      ? (save.error.details?.current as WorkspacePolicy | undefined)
      : undefined;
  const dirty = Boolean(
    policy.data &&
    draft &&
    JSON.stringify(policy.data.allowed_email_domains) !== JSON.stringify(draft.domains),
  );
  const add = () => {
    const value = entry.trim();
    if (!value || !draft) return;
    setDraft({ ...draft, domains: [...draft.domains, value] });
    setEntry('');
  };
  const remove = (domain: string) =>
    setDraft((current) =>
      current ? { ...current, domains: current.domains.filter((d) => d !== domain) } : current,
    );
  if (policy.isPending) return <Loading />;
  if (policy.error) return <ErrorState message={errorMessage(policy.error)} />;
  if (!draft) return null;
  return (
    <>
      <h2>Security</h2>
      <p className="settings-description">
        Choose which email domains new invitations may target. An empty list allows invitations from
        any domain.
      </p>
      <section className="settings-section">
        <h3>Allowed email domains</h3>
        {draft.domains.length ? (
          <div className="all-labels">
            {draft.domains.map((domain) => (
              <span className="label-pill" key={domain}>
                <i aria-hidden="true" />
                {domain}
                <button
                  type="button"
                  aria-label={'Remove ' + domain}
                  disabled={save.isPending}
                  onClick={() => remove(domain)}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="settings-note">No domains yet: invitations may target any email domain.</p>
        )}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            aria-label="Add allowed email domain"
            placeholder="company.com"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            maxLength={253}
          />
          <Button type="submit" disabled={save.isPending || !entry.trim()}>
            Add domain
          </Button>
        </form>
        <div className="inline-form">
          <Button
            type="button"
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate(draft)}
          >
            Save policy
          </Button>
          {conflict ? (
            <div className="secret-output">
              <p>
                The policy changed elsewhere. Current version {conflict.version}:{' '}
                {conflict.allowed_email_domains.length
                  ? conflict.allowed_email_domains.join(', ')
                  : 'no domains'}
                . Your changes are kept; retry to save them over the current version.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => setDraft((d) => (d ? { ...d, version: conflict.version } : d))}
              >
                Retry over version {conflict.version}
              </Button>
            </div>
          ) : save.error ? (
            <ErrorState message={errorMessage(save.error)} />
          ) : null}
        </div>
      </section>
      <p className="settings-note">
        This list only gates new invitations. Existing members keep their access and can still sign
        in regardless of their email domain. Domains are matched exactly, in lowercase; subdomains
        are not included automatically.
      </p>
    </>
  );
}
