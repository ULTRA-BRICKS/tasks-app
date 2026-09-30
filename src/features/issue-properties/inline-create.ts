import { useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { useOnline } from '@/shared/lib/online';
import type { ComboboxCreate } from '@/shared/ui';

interface Named {
  id: string;
  name: string;
}
interface InlineCreateSpec<Row extends Named, Data> {
  /** Singular person-facing noun, e.g. `label`. */
  noun: string;
  queryKey: QueryKey;
  /** GET path that fills `queryKey`, refetched to find concurrently created matches. */
  listPath: string;
  /** Objects a typed name may already match, read from the freshest data. */
  rows: (data: Data | undefined) => Row[];
  /** Adds the created object to the cached data. */
  add: (data: Data | undefined, row: Row) => Data | undefined;
  path: string;
  body: (name: string) => Record<string, unknown>;
}

/**
 * Explicit inline creation for objects whose only required field is the typed name.
 * One idempotency key per exact request body survives failed attempts, so a retry after a
 * lost response replays the first result instead of creating a duplicate.
 */
export function useInlineCreate<Row extends Named, Data>(
  spec: InlineCreateSpec<Row, Data>,
  allowed: boolean,
): ComboboxCreate | undefined {
  const client = useQueryClient(),
    online = useOnline();
  const keysByPayload = useRef<Map<string, string> | null>(null);
  keysByPayload.current ??= new Map();
  const keys = keysByPayload.current;
  if (!allowed) return undefined;
  const match = (data: Data | undefined, name: string) => {
    const needle = name.trim().toLocaleLowerCase();
    return spec.rows(data).find((row) => row.name.trim().toLocaleLowerCase() === needle);
  };
  const selectExisting = (row: Row) => ({
    value: row.id,
    notice: `Selected existing ${spec.noun} “${row.name}”`,
  });
  // A fresh list, or the cached one when the refetch fails.
  const listOrCached = () =>
    client
      .fetchQuery<Data>({
        queryKey: spec.queryKey,
        queryFn: () => api<Data>(spec.listPath),
        staleTime: 0,
      })
      .catch(() => client.getQueryData<Data>(spec.queryKey));
  return {
    label: (query) => `Create ${spec.noun} “${query}”`,
    unavailable: online ? null : 'Offline — reconnect to create',
    onCreate: async (name) => {
      // Someone may have created the same name since this list loaded: select it instead.
      const existing = match(await listOrCached(), name);
      if (existing) return selectExisting(existing);
      // The key follows the exact payload, so a changed project or name never replays another.
      const json = spec.body(name),
        payload = JSON.stringify(json);
      let key = keys.get(payload);
      if (!key) {
        key = `${spec.noun}:${crypto.randomUUID()}`;
        keys.set(payload, key);
      }
      try {
        const row = await api<Row>(spec.path, {
          method: 'POST',
          json,
          headers: { 'idempotency-key': key },
        });
        keys.delete(payload);
        // A refetch that landed while the POST was in flight may already list the row.
        client.setQueryData<Data>(spec.queryKey, (data) =>
          spec.rows(data).some((listed) => listed.id === row.id) ? data : spec.add(data, row),
        );
        void client.invalidateQueries({ queryKey: spec.queryKey, refetchType: 'none' });
        return { value: row.id };
      } catch (error) {
        const failure = error instanceof ApiError ? error : null;
        // Only an unanswered or server-failed attempt may have been applied, so it keeps its
        // key; a definite rejection (4xx except timeout) never applied the write.
        const rejected =
          failure !== null &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408;
        if (rejected) keys.delete(payload);
        if (failure?.status === 409 && failure.code === 'ALREADY_EXISTS') {
          const winner = match(await listOrCached(), name);
          if (winner) return selectExisting(winner);
          // The winner is not listed yet (the refetch failed): say so instead of a raw 409.
          throw new Error(`A ${spec.noun} named “${name}” already exists. Try again to select it.`);
        }
        if (failure?.status === 403)
          throw new Error(`You don’t have permission to create ${spec.noun}s.`);
        if (failure?.status === 0)
          throw new Error(`Couldn’t reach the server. “${name}” was not confirmed; try again.`);
        throw error;
      }
    },
  };
}
