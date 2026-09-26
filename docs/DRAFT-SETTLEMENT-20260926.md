# Creation draft settlement: durable attempt versus mounted UI

Date: 2026-09-26. Branch: `feat/state-complete-HYP-1491`. Original baseline source is unchanged.

The four active creation-draft failures from the preceding checkpoint were reproduced before editing. Stored attempt validation now discards malformed request metadata without losing the draft text. A disposed controller returns before reading its closed Runtime or starting another request. A permanent rejection can release its own persisted attempt after the UI unmounts. Successful or permanently rejected requests only settle the exact serialized draft that was sent; a newer draft under the same key is not removed or overwritten.

Two further tests cover newer draft text even when an attempt key is reused. Durable request completion is not equated with permission to mutate a mounted UI or a newer saved value. The original submit lock, idempotency keys, retryable-error behavior, notification and StrictMode expectations remain intact.

Verification after the fix: 257 unit tests passed, `tsc --noEmit` and the complete `bun run check` passed. Existing Chromium and WebKit lifecycle tests passed for selector/source changes, registered UI updates, stale setters and remount. Those existing browser tests do not cover every new-issue identity transition.

Mechanisms: [scope lifetime](https://state-lib-lab.vercel.app/spec#s4-7), [registered UI ownership](https://state-lib-lab.vercel.app/spec#s4-9), [persistence](https://state-lib-lab.vercel.app/spec#s8-5). This is a correctness correction, not a new speed measurement.

A separate diagnostic new-issue browser fixture is not accepted evidence: its overly broad API interceptor also intercepted the source module path. The proposed harness-only correction was denied before execution, so it remains an uncommitted diagnostic. Source inspection still identifies identity changes on a mounted new-issue page as a remaining integration gate. No expectation was disabled to claim that gate passed.

The complete application ownership inventory, query orchestration and independent staging acceptance remain open. Passing this suite does not turn the migration into a completed full-app replacement. No production account, database or notification was used.
