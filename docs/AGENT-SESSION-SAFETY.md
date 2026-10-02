# Agent session failures and safe continuation

Updated: 2026-09-13. Read this file and WORK-CHECKPOINT.md before every request, including «продолжай».

## Observed failures: do not collapse these into one diagnosis

1. Remote-tool safety denials: multiple calls were rejected before execution, including account provisioning and some ordinary compound commands. A rejected write is NOT evidence of a changed file or created account. Stop the rejected operation; do not disguise it, move secrets to dotenv, change transport, or ask another agent to bypass it. Independent permitted reads/work may continue.
2. Remote connector HTTP 429: the connector explicitly returned `Rate exceeded`. This is throttling, not a source-code failure. Respect Retry-After; otherwise back off 30/60/120 seconds, do useful independent work, and retry at most three times. Do not repeatedly poll or rediscover tools.
3. Connector transport errors: `Connection failed` / `mcp_network_error` occurred. Execution state can be unknown. Inspect the affected file, process or remote record before any retry; never repeat a non-idempotent write blindly.
4. Parallel verification collisions: Playwright reported occupied ports and ENOENT for active trace/network files. Two independently launched suites shared an output directory. The runner cleans that directory at start. Use one active suite per worktree and distinct output/report directories; workers=1 alone does not isolate separate invocations.
5. Shared-worktree races: edits and tests overlapped; duplicate helpers and duplicate regression tests appeared. Only one agent writes a given worktree. Review agents are read-only and must not start browser suites. Reuse the designated current worktree rather than creating overlapping release branches.
6. Excessive output: reading/minified-grep calls dumped hundreds of lines and bundled JavaScript. Keep tool replies under about 120 lines/8 KB, log verbose output to disk, and read summaries. Bound searches to relevant paths; never print private env/config values.
7. Missing checkpoints and overlong cycles: work continued for tens of minutes with repeated whole-release reviews, without a stable resumption point. Complete one bounded change, test it, record exact result/SHA/PID, then proceed. Re-review findings and changed code, not already settled unrelated scope.

## What is NOT proven

`Thinking failed` itself has no diagnostic trace exposed here. The observations above explain concrete tool/test failures and lost continuity, but do not prove one root cause inside ChatGPT. Long context/output and prolonged tool chains are plausible risk factors, not a verified diagnosis. Do not blame the user's browser, VPN, model or network without matching evidence.

## Per-request preflight

Read AGENTS.md, this file and WORK-CHECKPOINT.md; inspect the designated worktree and running task state. Preserve uncommitted work. Do not launch another suite while the checkpoint's process is running. Use the actual current tool result over a stale assistant summary. A previous failure may have left useful files or still-running commands.

## Execution and handoff rules

- One bounded command or related read group at a time. Use absolute cwd, a 1-second start for long work, a logfile, and record its PID. Poll only when the work can reasonably have completed; never create a second run merely because output is quiet.
- Separate command preparation, execution, pass/fail and publication. `echo` or a successful final command cannot establish that an earlier test passed. Chain required gates with `&&` or record each exit code explicitly.
- Do not refresh visual baselines merely to make a test green. Inspect matched screenshots and preserve provenance. A low pixel error on a dark canvas is not a 90% similarity score.
- Update WORK-CHECKPOINT.md after each meaningful completed gate and before a lengthy review/build. Include base/head, dirty paths, last test results, active PIDs/ports/output paths, blockers and the next concrete command.
- Commit small reviewed units with normal hooks. Then push, review/merge, deploy clean merged source, verify the canonical alias/asset version and real routes. Readiness alone does not establish authenticated CRUD or uploads.
- Give the user a progress update after a completed milestone or a newly found blocker. Do not leave a single opaque multi-hour chain.
- On interruption: reread actual state, resume at the next incomplete gate, preserve prior evidence, and never claim unexecuted checks.

## Evidence and primary references

Conversation evidence: connector 429/network/safety errors; `/tmp/tickets-completion-browser.log` and earlier Playwright ENOENT/occupied-port reports; `/tmp/tickets-retention-suite2.log` (14 retention scenarios passed before the next incomplete changes). Logs in /tmp are disposable; essential findings are recorded here.

Playwright outputDir is cleaned at run start: https://playwright.dev/docs/api/class-testproject#test-project-output-dir

HTTP 429 and Retry-After: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429

OpenAI general troubleshooting describes several possible causes, not a diagnosis of this incident: https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages

Browser storage limits: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria . Never clear browser site data as routine troubleshooting while unsent drafts remain only there; export first.

## Repeated interruption rechecked on 2026-09-13

The last pre-interruption command was not lost: PR #5 is merged, the feature worktree is on `fix/draft-safety-20260913`, and HEAD is `3354882436d5da3d28c53a8f272bf3cdcf58a083`. Its unfinished feature changes survived. No matching verification process was active at preflight. Therefore the visible conversation failure must not be reported as a failed merge or lost source work.

The user's broader incident register also exists at `/Users/ultra/work/hyper-canvas-draft-worktrees/SESSION-FAILURES.md`; read it when available, then this repository's checkpoint. That register documents separate confirmed failures: an oversized Codex input, a review waiting for EOF, and huge summaries contaminated by nested historical reports. Those are evidence from a different workflow, not proof of the cause of this Tickets interruption.

Additional continuation safeguards:
- Do not generate another incident report instead of resuming the already identified failing gate.
- Use this one existing worktree. One verification command at a time; a read-only review must not launch browser suites.
- After a bounded gate, report its exact result and update the checkpoint. At most one focused review cycle at a time; do not broaden a test correction into another whole-product rewrite.
- Inspect the size of a review summary before reading it. Read only the current run's top-level result; never parse nested role headers across a raw transcript.
- Avoid storing or returning browser storage contents in a regression: return boolean assertions about synthetic fixtures instead. The current test correction does this without weakening password-exclusion coverage.
- A document cannot guarantee that ChatGPT never interrupts. It can prevent repeating known execution mistakes and make continuation deterministic.

### New report-format observation in the bounded continuation

The one focused review exited 0 after 213 seconds, but `--json -o /tmp/tickets-resume-bounded-review.json` produced a Markdown report containing raw reviewer transcripts: 787,157 bytes / 12,976 lines, not JSON. The extension and requested format are therefore not evidence of a compact machine-readable result. Only its three verified unique top-level role summaries were read; nested stderr was not dumped. Review completion did not mean approval: the role summaries contain unresolved storage-selection/performance findings, now listed in WORK-CHECKPOINT.md. This directly confirms the need for size/format validation before reading reports; it does not establish the internal cause of ChatGPT interruptions.

## Permission diagnostic from the latest continuation

Read-only inspection through Plugin Management returned a custom Remote Desktop Commander setting of `Allow all actions`; the global default is `Allow low-risk actions`. The subsequent journal-write denial therefore cannot be explained simply as missing app-level write permission. No settings were changed. Do not repeatedly ask the user to allow writes or reconnect as though either were a proven remedy. The tool does not expose a specific cause or a one-action approval mechanism for this denial.

The successfully written pure version helper and its seven tests remain available; the interrupted journal file was preserved outside executable source. Full source verification passed 162 unit tests, but the helper is not integrated and the two application-level recovery bugs remain open. Repeating already successful tests is not progress on the denied integration.

## 15 September: distinguish quota exclusion from an unavailable executable

Connection was online and the pending StatusPicker gate is now green:18 Storybook checks and118 browser scenarios pass. The retained hidden Select options are intentional; tests must verify semantic closure and focus, not unconditional DOM removal. No rules were disabled.
The normal review command still launched zero reviewers. Read-only inspection of the same availability/usage functions established backend_available=true, but Codex weekly consumption100%; the usage card reported reset2026-09-19T09:54:33Z. The generic “unavailable, reason unknown” error is misleading in this case. Do not repeat installation/authentication fixes or reconnect the Mac to solve it. Do not override quota snapshots, change accounts or bypass review hooks.
All verification finished and its current tree is recorded in WORK-CHECKPOINT.md. The next gate is an actually completed review under normal quota, not more repeats of already green test suites.
