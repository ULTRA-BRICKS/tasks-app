import { useMe } from '@/entities/workspace';
import { useInputDraft, inputDraftKey } from '@/shared/lib/input-draft';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkspacePolicy } from '@tickets/contracts';
import { api, errorMessage } from '@/shared/api/client';
import { Button, Textarea, Loading, ErrorState } from '@/shared/ui';
export function WorkspacePolicySettings() {
  const query = useQuery({
    queryKey: ['workspace-policy'],
    queryFn: () => api<WorkspacePolicy>('/v1/workspace/policy'),
  });
  return query.isPending ? (
    <Loading />
  ) : query.error ? (
    <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} />
  ) : query.data ? (
    <PolicyEditor initial={query.data} />
  ) : null;
}
function PolicyEditor({ initial }: { initial: WorkspacePolicy }) {
  const { data: me } = useMe();
  const policyDraft = useInputDraft(inputDraftKey(me, 'settings:email-policy'), {
    text: initial.allowed_email_domains.join('\n'),
    version: initial.version,
  });
  const draft = policyDraft.value.text;
  const setDraft = (text: string) => policyDraft.set((v) => ({ ...v, text, version }));
  const [version, setVersion] = useState(policyDraft.value.version),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (sent: ReturnType<typeof policyDraft.snapshot>) =>
      api<WorkspacePolicy>('/v1/workspace/policy', {
        method: 'PATCH',
        json: {
          version: sent.value.version,
          allowed_email_domains: sent.value.text
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (policy, sent) => {
      setVersion(policy.version);
      policyDraft.accept(sent, {
        text: policy.allowed_email_domains.join('\n'),
        version: policy.version,
      });
      client.setQueryData(['workspace-policy'], policy);
    },
  });
  return (
    <section className="settings-section">
      <h2>Workspace security</h2>
      <p className="settings-description">
        Restrict new invitations to specific email domains. Existing members keep access.
      </p>
      <label htmlFor="email-domain-policy">Allowed email domains</label>
      <Textarea
        id="email-domain-policy"
        aria-label="Allowed email domains"
        rows={5}
        value={draft}
        placeholder="company.com"
        disabled={mutation.isPending}
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="section-hint">
        One domain per line. Empty allows any domain. Exact matches only: company.com does not allow
        sub.company.com. Checked when sending and accepting invitations.
      </p>
      <Button onClick={() => mutation.mutate(policyDraft.snapshot())} disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save policy'}
      </Button>
      {mutation.isSuccess && <output className="section-hint">Policy saved</output>}
      {mutation.error && <ErrorState message={errorMessage(mutation.error)} />}
      {mutation.error && (
        <Button
          variant="ghost"
          onClick={() =>
            void api<WorkspacePolicy>('/v1/workspace/policy').then((p) => {
              setVersion(p.version);
              policyDraft.set((v) => ({ ...v, version: p.version }));
              mutation.reset();
            })
          }
        >
          Refresh version, keep my draft
        </Button>
      )}
    </section>
  );
}
