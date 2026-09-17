# State reference runtime

This is a standalone synchronous TypeScript reference kernel, extracted from the site
prototype boundary. It is **not yet the Rust/Verus StateIR implementation**, and its
correctness is tested, not formally proved. The site API reference still documents
`site/src/lib/proto.ts`; do not silently substitute these APIs for that prototype.

## Implemented contract

`Runtime.signal`, `derive`, `watch` and `transaction` provide staged writes, nested
savepoints, lazy derived reads, dynamic dependencies and one notification wave per
changed commit. `transaction` keeps the staging context alive through equality
preflight. A rejected preflight cannot publish a partial state or populate a
committed derivation cache with uncommitted values. All affected observers are
prepared before any listener is invoked. Listener delivery order is unspecified.

A `NotificationError` has `committed = true`: observer failures are after publication
and must not be reported as rollback. Write attempts during derivations/equality
or notification delivery are rejected. Root disposal releases the whole owned graph,
including dependencies created in a different order from their consumers. Manual
observed-derive disposal remains an error (`STATE_OBSERVED_DISPOSE`). This includes
consumers still evaluating, before their subscriber edges are installed, and an
initial watch/subscribe read. `untrack` cannot hide dependencies already read by an
active consumer. An unobserved derivation may dispose itself while evaluating;
observers may unsubscribe during their read or listener. Disposed observers do not
retain their in-flight reads. Root disposal still tears down the entire owned graph.

Signals and derivations must be allocated outside their owning runtime's transaction
and outside every synchronous pure callback (including callbacks in another runtime).
Allocation fails before adding graph ownership with `STATE_GRAPH_BOUNDARY`. Observers
have the same restriction with `STATE_OBSERVER_BOUNDARY`. Allocate the graph first,
then transact on existing signals. Transactions roll back writes, not arbitrary
lifecycle operations or effects in another runtime.

A tracked `get()` of another runtime's signal or derivation fails with
`STATE_CROSS_RUNTIME_READ`, including warm caches and staged derivation evaluations.
An initial watch failure detaches its reads. A later watch failure is reported inside
`NotificationError`; local dependencies read before the failure allow recovery.
Derivations cache errors until a dependency changes, just as for other read failures.

`peek()` and either runtime's `untrack(fn)` deliberately permit foreign snapshots:
they suspend the caller's tracking, so foreign changes do not notify that caller.
A cold derivation read inside `untrack` still tracks its own dependencies. Neither
API disables purity: writes to **any** runtime from derive/watch readers or equality
callbacks fail with `STATE_IMPURE_DERIVE`, before running update/transaction callbacks.
Tracking and purity context is synchronous and restored in `finally`; it stores no
request data after the call. Values, revisions, journals and ownership are per runtime.

Nested transactions record a journal offset, not a copy of the pending map. Each write
records its previous staged entry; rollback reverses entries back to that offset.
Successful descendants retain entries so a parent can still undo them. Savepoint
creation is O(1), journal work/storage is O(writes), and rollback is proportional to
the writes undone. Equality preflight still reads the complete staged state and runs
before any publication. The outer boundary clears the journal even for no-op commits.

Inside a transaction (including a read-only transaction and equality preflight),
derived outcomes are memoized for one outermost pure evaluation in that runtime.
Repeated reads of a shared node reuse its value or error within that evaluation;
cycle detection remains active. A top-level derived `get()` owns an evaluation, while
all derived reads in one equality callback share that callback's evaluation. The memo
is discarded on return or throw, not at transaction commit. Separate top-level reads
and separate equality callbacks start fresh, so subsequent staged writes and nested
savepoint rollback cannot reuse an earlier snapshot. Staged reads neither consult nor
populate the committed derived cache, and never install committed dependency edges.
Memo entries retain temporary dependencies to protect indirectly consumed derivations
from disposal until the pure boundary exits. The memo and temporary read frames belong
to the runtime and are released in `finally`.

## Deliberate limits

Signal payloads are caller-owned references. Mutating an object obtained from a signal
is not intercepted. There is no structural store, immutable snapshot implementation,
effect/escape analyzer, automatic event transaction adapter, async-task cancellation,
collection IVM or cross-runtime dependency tracking in this kernel. Use one Runtime
for an entire dependent graph. A rejected promise-returning callback does not cancel
arbitrary work it has already scheduled. The static callback contracts reject ordinary
async transactions, derives and watchers, but JavaScript and type assertions can evade
types. No production readiness or universal speed advantage is claimed.
Cross-runtime guards cover Runtime instances from one loaded copy of this module;
separately bundled module copies and separate JavaScript realms do not share context.
The journal retains overwritten staged values until the outer transaction finishes;
its memory is proportional to writes, not just distinct signals.
Staged memo storage is proportional to distinct derivations and their read edges in one evaluation;
it is not a transaction-wide incremental cache. Derivations remain synchronous and
recursive, so memoization does not remove the JavaScript call-stack depth limit.

## Verification

From `../site`, run `bun run check`. This includes the original core fixtures,
`core.regression.test.ts`, and a separate strict TypeScript invocation with negative
`@ts-expect-error` contracts in `core.types.fixture.ts`. This compile-only fixture is
excluded from test discovery; its positive and negative contracts remain in the strict
runtime TypeScript project. The deterministic differential suite covers 8,000 event
transactions with nested aborts; the fan-out regression exercises 150,000 dependents.

`verification.json` records the coverage category, not a proof badge. Native executable
proofs must be attached to the actual Rust implementation before that category changes.
See `../docs/research/2026-09-11-runtime-adversarial-review.md` for reproductions and the
consolidation conflict policy.

Run all runtime fixtures and the follow-up suite directly from `../site`:

```sh
node --import tsx --test ../runtime/src/core.test.ts \
  ../runtime/src/core.regression.test.ts ../runtime/src/core.followup.test.ts
node_modules/.bin/tsc --noEmit -p ../runtime/tsconfig.json
node --import tsx ../runtime/src/savepoint-scale.mjs --assert-linear
```

The scale probe runs the real runtime in a separate process and counts Map sets and
iterated entries while composing one nested action per signal. It restores the native
methods in `finally`. Its CI assertion bounds operation counts, never elapsed time.
Observed before/after counts for this savepoint change:

| Writes | Before map work | After map work | After copied entries |
| ------ | --------------- | -------------- | -------------------- |
| 256    | 65,536          | 256            | 0                    |
| 512    | 262,144         | 512            | 0                    |
| 1,024  | 1,048,576       | 1,024          | 0                    |
| 2,048  | 4,194,304       | 2,048          | 0                    |

These counts demonstrate removal of pending-map copying in this workload; they do
not measure all CPU work, memory usage or application-level speedup.

The follow-up suite also counts callbacks in a 25-node DAG whose nodes each read the
previous node twice. One staged or read-only transaction read uses 25 callbacks
(previously 33,554,431); two reads within one equality preflight also use 25
(previously 67,108,862). These are deterministic callback counts, not timing claims.
Coverage includes in-flight disposal, self-disposal and unsubscribe, dynamic branches,
cached failures/cycles, failed preflight, committed cache/graph isolation and nested
savepoints.

## Optional latest-result module — HYP-1464 candidate

`src/latest-task.ts` composes the existing Runtime rather than importing the site's
prototype. It loads outside a transaction, then publishes only the currently owned
request's result inside one synchronous transaction. Its names are experimental,
not a declaration that the public API v1 has been approved.

`latestTask(runtime, load, commit)` returns `run(input)`, `cancel()` and `dispose()`.
The loader receives an AbortSignal. Each run resolves to `committed`, `superseded`
or `cancelled`; current loader/commit errors reject. Illegal lifecycle/pure/transaction
starts throw before loading or aborting existing work. Static types reject async
commit callbacks; dynamic promise returns are rejected by the kernel.

Cancellation revokes publication even when the loader ignores AbortSignal, and
settles the caller without waiting for that loader. It cannot stop non-cooperative
external work or release a server reservation. Once commit begins, its real outcome
wins: a NotificationError still means committed, even if an observer disposes the task.
Dispose tasks explicitly with their owner. Runtime disposal prevents late publication
but does not automatically abort or settle every externally owned task.

The optional module requires AbortController/AbortSignal; its strict type project is
`tsconfig.latest.json`. The environment-free core's ES-only type project is unchanged.
Use stable immutable request keys; there is no automatic cache/retry/input deep clone.

Run the complete controlled availability example from `../site` with
`node --import tsx ../runtime/examples/availability.ts`, or run
`node --import tsx tools/real-app-runtime.check.mts` for app-derived tests and types.
Source-pinned corpus and known normalized-store failures: `../docs/api/REAL-APP-CORPUS.md`.
