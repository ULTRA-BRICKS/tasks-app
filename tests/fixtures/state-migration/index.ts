/**
 * Deterministic synthetic fixtures and no-op external-effect stubs for the state
 * migration tests. No credentials, no network, no clock or randomness: every value
 * is derived from its arguments so A/B runs compare identical inputs.
 */
import type { Issue, IssueDetail, Page } from '@tickets/contracts';

const EPOCH = '2026-01-01T00:00:00.000Z';

export function syntheticIssue(n: number, over: Partial<Issue> = {}): Issue {
  return {
    id: `issue-${n}`,
    workspace_id: 'ws-1',
    team_id: 'team-1',
    key: `SYN-${n}`,
    number: n,
    title: `Synthetic issue ${n}`,
    description: `Body ${n}`,
    kind: 'issue',
    status_id: 'status-todo',
    status_name: 'Todo',
    status_category: 'unstarted',
    status_color: '#888888',
    priority: 0,
    assignee_id: null,
    assignee_name: null,
    creator_id: 'user-1',
    project_id: null,
    project_name: null,
    cycle_id: null,
    milestone_id: null,
    parent_id: null,
    estimate: null,
    start_date: null,
    due_date: null,
    position: n,
    version: 1,
    created_at: EPOCH,
    updated_at: EPOCH,
    archived_at: null,
    deleted_at: null,
    labels: [],
    label_ids: [],
    ...over,
  };
}
export function syntheticIssueDetail(n: number, over: Partial<IssueDetail> = {}): IssueDetail {
  return {
    ...syntheticIssue(n),
    comments: [],
    relations: [],
    children: [],
    attachments: [],
    activity: [],
    links: [],
    subscribed: false,
    ...over,
  };
}
export const syntheticPages = (count: number): { pages: Page<Issue>[]; pageParams: unknown[] } => ({
  pages: [
    { data: Array.from({ length: count }, (_, i) => syntheticIssue(i + 1)), next_cursor: null },
  ],
  pageParams: [null],
});

/** Session/local storage stand-in. `failWrites` models quota errors, `failReads` a blocked API. */
export function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const flags = { failWrites: false, failReads: false };
  return {
    flags,
    data,
    getItem(key: string) {
      if (flags.failReads) throw Error('storage read blocked');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (flags.failWrites) throw Error('quota exceeded');
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/**
 * No-op external effects. Every outbound integration (mail, Slack, blob storage,
 * GitHub) is replaced by a recorder, so a test can assert "attempted" without any
 * credential or network path existing.
 */
export function noopEffects() {
  const calls: Array<{ effect: string; payload: unknown }> = [];
  const record = (effect: string) => (payload: unknown) => {
    calls.push({ effect, payload });
    return Promise.resolve({ delivered: false as const, noop: true as const });
  };
  return {
    calls,
    sendMail: record('mail'),
    postSlack: record('slack'),
    putBlob: record('blob'),
    notifyGithub: record('github'),
  };
}

/** Minimal stand-in for the TanStack cache surface the migrated write path touches. */
export function fakeCache(initial: { pages: Page<Issue>[]; pageParams: unknown[] }) {
  let lists = initial;
  const log: string[] = [];
  return {
    log,
    read: () => lists,
    port: {
      cancel: () => {
        log.push('cancel');
        return Promise.resolve();
      },
      snapshot: () => {
        log.push('snapshot');
        return [{ key: ['issues', 'fixture'], data: lists }];
      },
      patch: (transform: (current: typeof lists) => typeof lists) => {
        log.push('patch');
        lists = transform(lists);
      },
      restore: (
        entries: Array<{ key: unknown[]; data: typeof lists }>,
        transform: (c: typeof lists, previous: typeof lists) => typeof lists,
      ) => {
        log.push('restore');
        for (const entry of entries) lists = transform(lists, entry.data);
      },
      applyDetail: (id: string, apply: (old: IssueDetail) => IssueDetail) => {
        log.push('detail:' + id);
        void apply;
      },
      settle: () => void log.push('settle'),
    },
  };
}
