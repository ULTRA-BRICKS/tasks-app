import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Issue, IssueDetail, IssueFilters, Page } from '@tickets/contracts';
import { api } from '@/shared/api/client';
export function useIssues(filters: IssueFilters) {
  return useInfiniteQuery({
    queryKey: ['issues', filters],
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
export const useIssue = (id: string | undefined) =>
  useQuery({
    queryKey: ['issue', id],
    queryFn: ({ signal }) => api<IssueDetail>('/v1/issues/' + encodeURIComponent(id!), { signal }),
    enabled: Boolean(id),
  });
export const priorities = [
  { value: '0', label: 'No priority' },
  { value: '1', label: 'Urgent' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Medium' },
  { value: '4', label: 'Low' },
];
