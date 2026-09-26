/**
 * Issue-creation workflow on a state-lib scope (state-lib backend only).
 *
 * Owns the private draft, its sessionStorage projection, the idempotent creation
 * attempt and the submit lock that the baseline kept in useState/useRef. The network
 * call and the post-create cache/navigation effects are injected ports: TanStack Query
 * stays the labelled server-cache infrastructure adapter, not a store owned here.
 * A creation is never "superseded": the persisted attempt key is the authority, so
 * disposal only withholds navigation, it never discards a completed create.
 */
import { toExternalStore } from '@ultrabricks/state-lib';
import type { Issue, IssueCreate } from '@tickets/contracts';
import { ApiError } from '@/shared/api/client';
import { createScope } from '@/shared/lib/state/scope';
import { createIssueInput, newIssueDraft, type Draft } from './model';

type Attempt = NonNullable<Draft['attempt']>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Raw {
  draft: Draft;
  storageError: boolean;
  pending: boolean;
  error: string | null;
}
export interface IssueDraftOptions {
  key: string;
  incoming: Partial<IssueCreate>;
  storage?: StoragePort;
  submit: (attempt: Attempt) => Promise<Issue>;
  onCreated: (issue: Issue, mounted: boolean) => void;
  describeError: (error: unknown) => string;
  rejectsPermanently?: (error: unknown) => boolean;
  newKey?: () => string;
}
export interface CreateContext {
  team: string;
  status: string;
  readOnly: boolean;
}

/** Client errors that no retry can fix; 408 and 409 stay retryable with the same key. */
export function isPermanentRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409
  );
}
function isStoredDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<Draft>;
  return (
    typeof saved.title === 'string' &&
    saved.title.length <= 300 &&
    typeof saved.description === 'string' &&
    saved.description.length <= 100000 &&
    Array.isArray(saved.label_ids)
  );
}
function isStoredAttempt(value: unknown): value is Attempt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Attempt>;
  const input = candidate.input;
  return typeof candidate.key === 'string' && candidate.key.trim().length > 0 && candidate.key.length <= 256 &&
    Boolean(input && typeof input === 'object' && !Array.isArray(input) &&
      typeof input.title === 'string' && input.title.length <= 300 &&
      typeof input.team_id === 'string' && input.team_id.length > 0);
}
function restoreDraft(options: IssueDraftOptions): Draft {
  try {
    const saved: unknown = JSON.parse(options.storage?.getItem(options.key) ?? 'null');
    if (isStoredDraft(saved)) return { ...saved, attempt: isStoredAttempt(saved.attempt) ? saved.attempt : undefined };
  } catch {
    /* An unreadable draft or blocked storage falls back to an empty private draft. */
  }
  return newIssueDraft(options.incoming);
}

export function createIssueDraftController(options: IssueDraftOptions) {
  const scope = createScope();
  const state = scope.value<Raw>(
    Object.freeze({
      draft: restoreDraft(options),
      storageError: false,
      pending: false,
      error: null,
    }),
  );
  const view = scope.runtime.derive(() =>
    Object.freeze({
      ...state.get(),
      frozen: state.get().pending || Boolean(state.get().draft.attempt),
    }),
  );
  const external = toExternalStore(view);
  let locked = false;
  const live = () => !scope.disposed;
  const draft = () => state.get().draft;
  const patch = (next: Partial<Raw>) => {
    if (live()) state.set(Object.freeze({ ...state.get(), ...next }));
  };

  function persist(next: Draft): boolean {
    try {
      options.storage?.setItem(options.key, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  }
  function change(update: Partial<Draft>): void {
    if (!live()) return;
    const next = { ...draft(), ...update };
    const failed = !persist(next);
    patch({ draft: next, storageError: state.get().storageError || failed });
  }
  // Only settle the exact durable draft sent by this controller. A newer visit
  // may already have saved another draft under the same storage key.
  function settleStored(expected: string, releaseAttempt = false): boolean {
    try {
      if (options.storage?.getItem(options.key) !== expected) return true;
      if (releaseAttempt) {
        const saved = JSON.parse(expected) as Draft;
        delete saved.attempt;
        options.storage.setItem(options.key, JSON.stringify(saved));
      } else options.storage.removeItem(options.key);
      return true;
    } catch { return false; }
  }
  function nextAttempt({ team, status }: CreateContext): Attempt {
    const current = draft();
    return (
      current.attempt ?? {
        key: (options.newKey ?? (() => crypto.randomUUID()))(),
        input: createIssueInput(current, team, status),
      }
    );
  }
  function fail(failure: unknown, attempt: Attempt, expected: string): void {
    if (options.rejectsPermanently?.(failure) ?? isPermanentRejection(failure)) {
      const persisted = settleStored(expected, true);
      if (live() && draft().attempt === attempt) patch({
        draft: { ...draft(), attempt: undefined },
        storageError: state.get().storageError || !persisted,
      });
    }
    patch({ pending: false, error: options.describeError(failure) });
  }
  async function send(context: CreateContext): Promise<void> {
    const attempt = nextAttempt(context);
    change({ attempt });
    const expected = JSON.stringify(draft());
    patch({ pending: true, error: null });
    try {
      const issue = await options.submit(attempt);
      settleStored(expected);
      options.onCreated(issue, live());
      patch({ pending: false });
    } catch (failure) {
      fail(failure, attempt, expected);
    }
  }
  async function create(context: CreateContext): Promise<void> {
    if (!live() || locked || context.readOnly || !context.team || !draft().title.trim()) return;
    locked = true;
    try {
      await send(context);
    } finally {
      locked = false;
    }
  }
  return {
    subscribe: (notify: () => void) => external.subscribe(notify),
    getSnapshot: () => external.getSnapshot(),
    change,
    create,
    hasUnsavedWork: () => Boolean(draft().title || draft().description),
    scope,
    dispose: () => scope.dispose(),
  };
}
