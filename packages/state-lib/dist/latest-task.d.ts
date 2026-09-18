import { type Runtime, type Sync } from './core.js';
export type LatestOutcome = 'committed' | 'superseded' | 'cancelled';
export interface LatestTask<Input> {
    run(input: Input): Promise<LatestOutcome>;
    cancel(): void;
    dispose(): void;
}
/** Optional reference module: await externally, then atomically commit only the latest result.
 * Cancellation revokes commit authority even for non-cooperative loaders. It is not a
 * server-side reservation, a query cache, or a promise to undo external side effects. */
export declare function latestTask<Input, Result, Commit>(runtime: Runtime, load: (input: Input, signal: AbortSignal) => Result | PromiseLike<Result>, commit: (value: Result, input: Input) => Commit & Sync<Commit>): LatestTask<Input>;
