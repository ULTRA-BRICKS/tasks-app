/**
 * Synchronous reactive kernel. A transaction stages all writes before publication.
 * Its commit invalidates the complete reachable graph before evaluating observers;
 * all observer values are then evaluated before any user notification is delivered.
 *
 * Transaction callbacks, derivations and equality predicates must be synchronous.
 * Effects are outside rollback: notification failures have committed=true.
 */
export type Dispose = () => void;
export type Equality<T> = (left: T, right: T) => boolean;
export type Sync<T> = T extends PromiseLike<unknown> ? never : T;
export interface Readable<T> {
    get(): T;
    peek(): T;
    subscribe(listener: (value: T, previous: T) => void): Dispose;
}
export interface Writable<T> extends Readable<T> {
    set(value: T): void;
    update(fn: (previous: T) => T): void;
}
export interface Derived<T> extends Readable<T> {
    dispose(): void;
}
export declare class StateError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class NotificationError extends AggregateError {
    readonly committed = true;
    constructor(errors: unknown[]);
}
/** @internal Shared purity guard for optional lifecycle modules, including cleanup. */
export declare function assertSideEffectsAllowed(): void;
/** Own one runtime per request/test/root when using server-side rendering. */
export declare class Runtime {
    private transactionDepth;
    private pending;
    private journal;
    private observers;
    private owned;
    private notifying;
    private disposing;
    private closed;
    private revision;
    private reads;
    private stagedMemo;
    get version(): number;
    get inTransaction(): boolean;
    private assertOpen;
    private assertWrite;
    private assertAllocation;
    private track;
    private tracking;
    /** Reads are tracked only during synchronous derivations, never in listeners. */
    untrack<T>(fn: () => T): T;
    private pure;
    /**
     * Atomic, synchronous transaction with nested savepoints. A callback failure
     * discards its writes. A notification failure occurs AFTER publication and is
     * reported as NotificationError, not as a rolled-back transaction.
     */
    transaction<T>(fn: () => T & Sync<T>): T;
    private rollback;
    private flush;
    /** Values are caller-owned; stores separately enforce immutable data boundaries. */
    signal<T>(initial: T, equals?: Equality<T>): Writable<T>;
    /**
     * Lazy cached derivation with dynamic dependencies and cycle detection.
     * A failed evaluation still keeps its read dependencies so it can recover.
     * Dispose a manually owned derivation, or dispose its runtime/root.
     */
    derive<T>(fn: () => T & Sync<T>): Derived<T>;
    /** Subscribe without an initial notification. The listener is deliberately untracked. */
    watch<T>(read: () => T & Sync<T>, listener: (value: T, previous: T) => void, equals?: Equality<T>): Dispose;
    private observe;
    dispose(): void;
}
