import type { QueryClient } from '@tanstack/react-query';
/** Refresh the UUID and any loaded code aliases of this one object, not unrelated task details. */
export function invalidateTaskDetails(client: QueryClient, id: string) {
  return client.invalidateQueries({
    queryKey: ['issue'],
    predicate: (query) => {
      if (query.queryKey[1] === id) return true;
      const data = query.state.data;
      return Boolean(data && typeof data === 'object' && 'id' in data && data.id === id);
    },
  });
}
