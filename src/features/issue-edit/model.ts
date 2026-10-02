import { mergeVersioned } from '@/shared/lib/versioned';
import {
  useMutation,
  useQueryClient,
  useIsMutating,
  type InfiniteData,
} from '@tanstack/react-query';
import type { Issue, IssuePatch, Page, IssueDetail } from '@tickets/contracts';
import { api } from '@/shared/api/client';
export function useIssueUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['issue-write'],
    scope: { id: 'issue-writes' },
    mutationFn: ({ issue, patch }: { issue: Issue; patch: Omit<IssuePatch, 'version'> }) =>
      api<Issue>(`/v1/issues/${issue.id}`, {
        method: 'PATCH',
        json: { ...patch, version: issue.version },
      }),
    onMutate: async ({ issue, patch }) => {
      await client.cancelQueries({ queryKey: ['issues'] });
      const lists = client.getQueriesData<InfiniteData<Page<Issue>>>({ queryKey: ['issues'] });
      client.setQueriesData<InfiniteData<Page<Issue>>>({ queryKey: ['issues'] }, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                data: p.data.map((i) => (i.id === issue.id ? { ...i, ...patch } : i)),
              })),
            }
          : old,
      );
      return { lists };
    },
    onError: (_error, { issue, patch }, context) => {
      context?.lists.forEach(([key, previous]) => {
        const originals = new Map(
          previous?.pages.flatMap((p) => p.data).map((row) => [row.id, row]),
        );
        client.setQueryData<InfiniteData<Page<Issue>>>(key, (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((p) => ({
                  ...p,
                  data: p.data.map((row) => {
                    const stillOurPatch = Object.entries(patch).every(
                      ([key, value]) =>
                        JSON.stringify((row as unknown as Record<string, unknown>)[key]) ===
                        JSON.stringify(value),
                    );
                    return row.id === issue.id && row.version === issue.version && stillOurPatch
                      ? (originals.get(row.id) ?? row)
                      : row;
                  }),
                })),
              }
            : current,
        );
      });
    },
    onSuccess: (updated) => {
      client.setQueryData<IssueDetail>(['issue', updated.id], (old) =>
        old ? mergeVersioned(old, updated) : old,
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['issues'] });
      void client.invalidateQueries({ queryKey: ['issue'] });
      void client.invalidateQueries({ queryKey: ['projects'] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
export const useIssueWriteBusy = () => useIsMutating({ mutationKey: ['issue-write'] }) > 0;
