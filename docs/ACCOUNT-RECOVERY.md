# Account email and self-service password recovery

Status: implementation in the current worktree; NOT a deployed or live-mail acceptance claim.

## Backend contract

- GET `/api/auth/options` reports whether account email is configured.
- POST `/api/auth/forgot-password` accepts `{email}` and returns the same 202 response for existing, unknown and throttled addresses. It does not create accounts, change passwords or terminate sessions.
- POST `/api/auth/reset-password` accepts a one-use proof and `{password}` (12–256 characters), atomically changes the password and revokes all sessions/personal API tokens. It never grants a membership or logs the user in automatically.
- POST `/api/v1/invitations` still requires an authenticated administrator. When email is configured, the invitation and its encrypted email job are committed together; `email_queued` does not mean delivered.

Reset proofs contain 256 random bits, are stored only as hashes, expire after 30 minutes, and are bound to the account's password fingerprint. Requests have per-source/per-address limits and a minimum response delay. Completion rechecks validity under the same account lock used by login completion, preventing a previously checked old password from creating a session after reset. All outstanding reset proofs are consumed on completion.

## Delivery and privacy

Resend is called only from the backend at `https://api.resend.com/emails`; redirects are refused and each send has an eight-second deadline. A stable job-specific Idempotency-Key accompanies every retry. Pending message bodies are encrypted with AES-GCM under a key derived from AUTH_SECRET, bound to their job ID. They are scrubbed after acceptance, terminal failure or expiry. Provider error bodies are not logged.

The worker leases a job before network I/O and never holds a transaction across Resend. It retries transient failures at most five times and only within the job expiry. Vercel uses waitUntil for prompt delivery; the existing authenticated `/api/internal/jobs` endpoint and `bun run worker` drain durable retry jobs. The deployment config now schedules an authenticated GET /api/internal/account-email every minute. The existing CRON_SECRET must remain configured.

Links put their proof in a URL fragment. The UI reads it only into component memory and removes it from browser history. Passwords and account-link proofs never use the draft journal. Reset emails contain a link, not a password; the confirmation email contains no password. Old query-string invitations remain readable for compatibility.

## Deployment prerequisites

Apply migration 0004 explicitly before routing traffic to the new build. It adds password_reset_tokens and account_email_jobs without changing an existing account or membership. Readiness uses the new exact schema version.

Backend-only configuration: `RESEND_API_KEY`, `MAIL_FROM`, stable `AUTH_SECRET` (at least 32 characters), and canonical HTTPS `APP_URL`. Do not put these keys in VITE_ variables, source control, public reports or browser storage. A sending-only Resend key scoped to the selected verified domain is sufficient. Disable link/open tracking for account links.

Read-only Resend discovery in this session found only `invntrm.ru` verified, with tracking already disabled. No sender address was selected, no API key was created, and no actual email was sent. A connected Resend account alone is not backend environment configuration.

## Validation boundary

Transport/encryption/queue tests use synthetic messages and injected fetch functions, never real recipients. Browser tests cover the login link, mail-unavailable feedback, missing proof, matching-password requirement and absence of credentials from draft storage. Existing whole-application tests are separate from a successful end-to-end password reset.

Three attempted reset-specific fixture test-file writes were rejected by the tool. Those files were not created and their tests are NOT counted. In particular successful consumption, expiry, concurrent replay and old-session revocation need an executed integration regression before release approval. Do not substitute transport tests or a green old suite for that gate.

## Sources

OWASP Forgot Password guidance: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
Resend send API and idempotency: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys . Resend keys deduplicate within 24 hours; each job in this implementation expires within 12 hours (reset jobs within 30 minutes).

Current canonical origin: https://tasks-ultrabricks.vercel.app . Resend sending-only key was created, but the tool denied writing backend environment variables. MAIL_FROM and RESEND_API_KEY are not claimed configured. No real email was sent.

## Follow-up correctness review

Expired pending/sending ciphertext is now removed even when the sender is disabled. Claiming a job rechecks status, payload, expiry and lease; a lost claim does not stop the rest of the bounded batch. Two synthetic regressions cover disabled-sender cleanup and cancellation followed by delivery of the next valid job. Rate-limit counters commit separately from password-reset proof/mail insertion, and the password fingerprint is read again after acquiring the user lock.

Delivery semantics remain explicit: `sent` counts Resend API acceptance, not mailbox delivery. An already in-flight network request cannot be unsent by a concurrent password reset; its proof is invalidated server-side, so a late email cannot reuse that proof. We do not hold a database lock across external delivery. Non-reset jobs expire inside Resend's24-hour idempotency window; failed invitation delivery does not invalidate the administrator's original invitation link.

The reset transaction remains fail-closed if its confirmation cannot be durably queued: no password/session mutation is committed in that case. This deliberate atomic-outbox policy is not a claim that recovery works while mail configuration is missing.

Current live configuration check: RESEND_API_KEY and MAIL_FROM are absent; the requested ultra@glide.vc account has no membership. A forgot-password form does not create an account. No real message was sent. These are release dependencies, not hidden successful actions.

Migration4 was prepared and verified only on a temporary Neon branch. It adds two empty tables plus indexes/constraints; production is still version3. Applying or discarding the prepared migration requires the user's confirmation through the migration tool. Exact context is recorded in account-migration-prepared.json.
