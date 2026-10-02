# Draft safety release

**Current status, 15 September 2026:** code is staged, not released. Source/build/type checks,162 unit tests,118 Chromium/WebKit cases,18 Storybook checks and five ordinary visual comparisons passed. Storybook production build and secret-pattern scan passed. Final external review is blocked by the quota information used by review-cli; no review approval, merge or deployment is claimed.

Canonical service: https://tickets-ultrabricks.vercel.app
Source: https://git.hyperide.ai/ultrabricks/tickets-app

## Implemented behavior

Unsent issue, project and cycle documents use scoped tab storage plus browser-local recovery copies. Comments, relations, property changes, dates, saved-view names and non-secret settings inputs use the same recovery path. Draft keys include account/workspace identity; draft text is not put into URLs.

Acknowledgement now carries the precise stored content and its causal version. It does not use Date.now to decide what another tab has sent. Separate immutable acknowledgement records prevent a subsequent comment from erasing proof that a prior copy was submitted. A changed adopted copy does not acknowledge the original text. Independent tab contents survive reload, and a newer durable write can recover from a stale tab mirror.

An explicit recovery operation preserves a separate backup before replacing different current text. Writer counters do not rewind when an older copy is restored. The journal is indexed by logical key; missing lookups do not repeatedly enumerate browser storage, and recovery lists reuse cached results until the journal changes. Immediate input persistence was retained rather than introducing a debounce loss window.

Comment creation accepts an optional idempotency key through the existing server transaction and authentication boundary. Retries of the identical request return the same comment; changing its body under the same key returns a conflict.

## Explicit limits

This is browser recovery, not encrypted cloud backup. Site-data deletion, storage eviction, device loss or a failure of every available storage path cannot be covered by an absolute “never lost” promise. Storage failures are surfaced; in-memory text can be exported while the page remains open. Passwords, newly issued API tokens and invitation tokens are not persisted by the input-draft hook.

Binary attachment recovery is not implemented by this release. The requested new account and authenticated production CRUD/private-Blob round-trip remain separate unfinished acceptance checks. No credentials or production workspace data are included in tests, screenshots or this report.

The original 50-screen Linear PDF was unavailable. Internal screenshot regression tests and this data-safety work are not a 90%+ reference-parity claim.

## Verification

Final command results and clean deployment identity are recorded after their corresponding gates complete. Prior to the last hardening changes, the full browser suite passed 114 cases; that result is not substituted for verification of the final tree.

### Observed final-code gates in this continuation

Source generation, lint, type-aware checks, independent TypeScript and the production build passed; 162 unit tests passed. The final full Chromium/WebKit run passed 116 scenarios, including the formerly red equal-clock and independent-copy cases, rollback of clock time, retained acknowledgement history, stale session-mirror recovery and explicit restoration with a preserved backup.

The synthetic 100,000-character diagnostic recorded p95 writes of 0.5 ms (Chromium) and 1 ms (WebKit) on this computer. Ten warmed missing-key lookups took approximately 0.1 ms and below WebKit's 1 ms timer resolution. More importantly, instrumentation verified zero storage enumerations for those lookups, 251 accessible fixture records and reuse of the cached recovery list. These are local diagnostics, not a latency guarantee for all devices.

Historical 14 September result, superseded below: Storybook completed 17/18 checks: the status-picker accessibility audit observed Base UI's transient focus guards during popup exit. No accessibility rule was disabled. The proposed wait-for-closed-and-focus-restored change was rejected before execution and is not in the source. This gate and final visual-baseline acceptance remain open; the feature must not be described as production-published.

Logs: `/tmp/tickets-durable-final-check.log`, `/tmp/tickets-durable-final-browser.log`, `/tmp/tickets-durable-final-story.log`. They contain isolated fixture evidence, not production-user content.

## 15 September: completed picker/accessibility acceptance

The prior assumption that Select must remove every option from the DOM was incorrect: Base UI deliberately supports hidden mounted options. The story now waits for hidden state, disappearance from the accessibility tree, removal of the transient focus guards and restored trigger focus. Normal `bun run test:ui` passed all18 checks without changing axe rules. The new Chromium/WebKit regression also proves hidden options cannot take focus. Logs: `/tmp/tickets-sep15-picker-closed.log` and `/tmp/tickets-sep15-picker-final.log`.

Source/generator/lint/type/build checks and 162 unit tests passed again (`/tmp/tickets-sep15-source.log`). Existing116 browser cases were unchanged; the additional two picker cases passed separately. This is not yet a new completed deployment or global Linear parity proof.

Primary explanation of Select's hidden-mount behavior: https://github.com/mui/base-ui/issues/5184 and the installed @base-ui/react1.8 SelectPortal/SelectPositioner implementation. Accessibility test semantics: https://storybook.js.org/docs/writing-tests/accessibility-testing .

## Final 15 September evidence and release blocker

Sequential verification completed with exit0: `/tmp/tickets-sep15-final-source.log`, `/tmp/tickets-sep15-final-browser.log`, `/tmp/tickets-sep15-final-storybook.log`, `/tmp/tickets-sep15-storybook-build.log`. Five visual comparisons passed without updating baselines: `/tmp/tickets-sep15-visual.log`. These internal regression checks do not establish 90%+ similarity to all original Linear screens.

The requested Codex review launched zero reviewers (`/tmp/tickets-sep15-review.log`). Read-only diagnosis established that the CLI is installed, signed in, and passes backend availability; review-cli nevertheless excludes it because its normal usage source reports the weekly Codex window at100%. The reported reset is2026-09-19T09:54:33Z. No quota, account, endpoint or review gate was changed. The earlier “backend unavailable” summary was misleading: this is quota-based selection, not missing CLI authorization.
