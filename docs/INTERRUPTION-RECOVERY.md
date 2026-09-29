# Interrupted conversation recovery — 26 September 2026

## Scope and confidence

The user reported repeated ChatGPT "Thinking failed" responses and asked to prevent lost/repeated work. The screenshot establishes failed chat responses, not their backend cause. No ChatGPT request trace, browser console, HAR or incident ID was supplied. Neither quota, tool refusal, a red test nor conversation length is a proven cause of that exact message. The public OpenAI status page reported no known incident when checked; aggregate status does not rule out an individual failure.

## Findings with evidence

1. **The required checkpoint was stale.** Before this repair, `docs/WORK-CHECKPOINT.md:1-15` named 13 September, `tickets-draft-safety-20260913`, commit 382468f and an old lint failure. Live Git instead reported branch `feat/inline-date-calendar-20260926`, HEAD 8c7007072bb6baa0df5cd22354a67d4dc3e67473 and pending calendar work. This proves a broken resumption source, not a ChatGPT-engine diagnosis. The unchanged original is archived in the external continuity record before replacement.
2. **Old and current verification were being mixed.** `/tmp/tasks-routing-shipping-chromium.log` belongs to the earlier routes increment; current calendar receipts are `/tmp/tasks-calendar-reviewed-source.log:375-379` (250 pass/1 skip), `/tmp/tasks-calendar-reviewed-targeted.log:74` (68 pass), `/tmp/tasks-calendar-reviewed-storybook.log:19-46` (23 pass/1 fail). These are historical receipts until their exact source fingerprint is rechecked.
3. **The next real blocker is specific.** `/tmp/tasks-calendar-reviewed-storybook.log:23-35` reports the selected calendar day's contrast as 2.57 rather than the test's required 4.5. This is an accessibility failure, not proof of a conversation crash. The log must not be relabelled green or fixed by disabling accessibility assertions.
4. **Known earlier operational failures are separate.** `docs/AGENT-SESSION-SAFETY.md:7-16` records safety denials, connector throttling/disconnects, concurrent-output collisions, shared-writer races, excessive output and overlong repeated reviews. The same document already distinguishes these from the unproven platform failure at lines 18-21. Existing rules were insufficiently enforced; another generic promise is not a fix.

## Recovery procedure adopted now

- Canonical live state is outside Git at `/Users/ultra/xp/.tasks-work-evidence/tasks-app-continuity/CURRENT.md` and `CURRENT.json`. Branch checkout cannot silently replace it with a tracked historical checkpoint. The repository checkpoint is a pointer and human-readable snapshot, never the sole state source.
- Verify worktree, HEAD, staged tree, worktree fingerprint and active process identity before resuming. A matching PID number alone is insufficient. A timeout means unknown completion, not permission to duplicate a test, commit or deployment.
- Work on one bounded acceptance item. Report its completed result or newly found blocker before expanding scope; do not keep an opaque multi-hour response alive by repeatedly polling or rereading whole reports.
- Never write source, generated files or watched documentation during a browser suite. Save progress outside the watched tree. Reuse completed receipts only for their verified source fingerprint.
- Keep blocked operations distinct from executable work. Do not disguise or reroute a safety-refused action. Quota, network, authorization, test failure and ChatGPT response failure get separate incident labels.
- Before claiming release, record commit, merge, deployment and canonical verification separately. No post-response execution is implied unless explicitly scheduled.

## Current bounded continuation

Live state and the next incomplete gate are recorded only in `/Users/ultra/xp/.tasks-work-evidence/tasks-app-continuity/CURRENT.md`; this section is not a status record. The selected-day contrast failure named above was reproduced and fixed on 27 September without disabling the assertion (see `docs/INLINE-DATE-CALENDAR.md`). The calendar was integrated onto `origin/main` f87b126 on 29 September and released through a reviewed pull request; deployment remains a separate, explicitly approved step.

Sources: https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages (long-conversation troubleshooting and diagnostic evidence); https://status.openai.com/ (time-specific aggregate status). No report was sent to OpenAI or another third party.
