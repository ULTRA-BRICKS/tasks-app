# HYP-1482 completion — execution ledger

The existing user-approved contract remains binding: Tasks is the operational tracker; equal current ticket codes follow Linear while dual writing remains enabled; preserve stable identity and history; migrate all content; distinguish genuine conflicts from provider formatting; add a source-only managed notice pointing to the exact Tasks code without syncing that notice back. Do not turn off Linear or renumber again merely to hide failed jobs.

Base: d2964b2. Sole writer worktree: /home/ultra/xp/tasks-app-sync-finish-20261013. Ubuntu home replaces the sold Mac. Live proof is kept privately under ~/.local/share/tasks-app-verification/finish-20261013. No other worktrees or global CLI routing may change.

## Current evidence

2026-10-13 live database: integration enabled on dpl_8HEbuArxa8LaCEZvPztN3AHQQFW3; recent successful field updates and creates in both directions. Two new HYP tasks remain PENDING because their only native label session:5 has a GL-only source alias. Their dependent comments retry needlessly. Native API token is owner/read+write but lacks admin scope; do not weaken endpoint permissions or expose credentials. Source adapter is authorized as Linear admin. Existing native/backend modules can be used without reading secret files.

## Work

1. Close missing source-label dependencies before issue writes. Persist a creation receipt per workspace/source-org/native-label/source-team. Use UUIDv4, verified exact name/team lookup, bounded calls, lost-response recovery and original-label preservation. Generic native label updates fan out only to explicitly mapped aliases, each under its normal conflict/lease checks. Missing dependencies stay pending rather than exhausting as permanent failures.
2. Retry and verify affected real tasks/comments; distinguish old superseded attempt receipts from current missing data. Investigate unresolved source rejections with raw source error metadata privately, not by guessing.
3. Implement a managed migration notice codec with exact origin+source/native identities, version and integrity proof. Strip only the verified managed block; keep adjacent user Markdown byte-for-byte. Preserve or regenerate one notice on outward writes; a notice-only webhook must not change native body/version. Mixed real edits still synchronize.
4. Add a resumable administrator backfill and run a small verified roundtrip before all source tasks. Verify /tasks/{code} and UUID deep links resolve to the same task, including archived and login return routes. Do not label unmapped/PENDING records migrated.
5. Prepare an explicit final cutover operation (not run yet): no unresolved business deltas or PENDING tasks, stop dual writes with a final source snapshot, keep current codes, allocate future native codes above the per-team maximum. Linear must remain on until explicit cutoff; simply revoking the key would strand new tasks because authority is still linear.
6. Run fresh focused+full tests, real PostgreSQL when available, final review, normal PR/merge and a clean deployment. Preserve active integration scope and rebind to the actual promoted deployment. Run final live reconciliation and report exact remaining exceptions without clearing audit history.

## Rulings

- The marker is trusted metadata, not any arbitrary Tasks URL or blockquote. Malformed/mismatched blocks must never cause user text to be deleted.
- Name equality alone does not prove task identity. Labels may have multiple explicitly known team aliases; task numbering never selects the backend.
- Permission/setup gaps are not reasons to discard data, rewrite account scopes or quietly disable the integration.

## 14 October — verified continuation

The live Tasks token on Ubuntu has read/write only, despite its owner's role. No token scope, membership or account was changed. Separately, the connected Neon operator is tickets_owner and has verified administrative rights over integration settings/outbox; use an explicit audited maintenance operation there if required, never mint a bearer token or lower HTTP permission checks. Canonical promotion must not strand the deployment fence.

Scoped label metadata events now delegate to all proven source aliases under each source entity's ordinary lease/merge. The parent is superseded-with-delegation, not a fabricated success. Success for one alias does not hide another alias's failure. Migration-notice failure is likewise not retired by unrelated successful business sync. Red-first regressions cover both cases.

Code/UUID/legacy browser acceptance: Chromium8 + WebKit8 passed, including save/comment from code-slug URL and origin-scoped historical-code resolution. Real isolated PostgreSQL17:23 tests passed,413 assertions after correcting a count-result type in the test. The DB container was stopped. Full source run450pass/1existing skip/0fail preceded the final notice-error isolation regression; final full run still required.

Live historical repair: four owner-authored native comments now created exactly once at their original UUIDs in Linear: two on HYP-176, one HYP-206, one HYP-349. Each source issue was temporarily unarchived, then rearchived in finally and read back; original archive timestamps are recorded (the API's archive timestamps necessarily advance). Native comment body/version/author and original source-creation intents were checked before writes. Receipt: ~/.local/share/tasks-app-verification/finish-20261013/archived-comment-repair-results.json. Five other imported UB-48 comments are absent from both bounded list and single-record source lookup; the source reports Entity not found: Comment. Their native content/history remains preserved. Absence is not a deletion authorization.

No deployment, mass marking or source disconnection has been performed in this continuation yet. Source numbering is still Linear-authoritative. The user requested imminent cutover, not immediate removal of the current integration.
