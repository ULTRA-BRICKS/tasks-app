import { feedRefreshInterval } from '@/shared/lib/feed-refresh';
import { queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  Issue,
  IssueDetail,
  IssueFilters,
  Page,
  PreCanonicalCodeHistory,
} from '@tickets/contracts';
import { api } from '@/shared/api/client';
export function useIssues(
  filters: IssueFilters,
  options: { live?: boolean; enabled?: boolean } = {},
) {
  return useInfiniteQuery<Page<Issue>>({
    queryKey: ['issues', filters],
    enabled: options.enabled ?? true,
    refetchInterval: options.live
      ? (query) => feedRefreshInterval(query.state.data?.pages.length ?? 1)
      : false,
    refetchIntervalInBackground: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams(
        Object.entries({ ...filters, limit: 100, cursor: pageParam })
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      );
      return api<Page<Issue>>('/v1/issues?' + query, { signal });
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}
/** One task's detail query; shared by the page and by callers that need a fresh server read. */
export const issueQuery = (id: string) =>
  queryOptions({
    queryKey: ['issue', id],
    queryFn: ({ signal }) => api<IssueDetail>('/v1/issues/' + encodeURIComponent(id), { signal }),
  });
export const useIssue = (id: string | undefined) =>
  useQuery({ ...issueQuery(id ?? ''), enabled: Boolean(id) });
/** Explicit historical lookup; bare codes keep resolving through useIssue to their current holder. */
export const usePreCanonicalCode = (code: string | null) =>
  useQuery({
    queryKey: ['pre-canonical-code', code],
    queryFn: ({ signal }) =>
      api<PreCanonicalCodeHistory>('/v1/issues/pre-canonical/' + encodeURIComponent(code!), {
        signal,
      }),
    enabled: Boolean(code),
  });
export const priorities = [
  { value: '0', label: 'No priority' },
  { value: '1', label: 'Urgent' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Medium' },
  { value: '4', label: 'Low' },
];
