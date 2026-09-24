# People and email invitations — 24 September 2026

People has an email-first invitation form and a workspace-admin-only invitation list. The form does not ask the inviter to forward a one-time link. Pending acceptance, accepted and expired invitations are visible, with recipient, role and expiry. Responsive invitation rows keep the email readable and the status separate.

Email-only API requests require a configured sender before any invitation is created. The same idempotency key and body replay return the original result without enqueuing another email. Email-only responses and listings omit the one-time token/hash; the existing legacy API without delivery=email retains backward-compatible behavior. A queued response means accepted into the account-email queue, not proof of final inbox delivery. Existing Resend dispatch handles delivery after the response.

The form keeps its unsent recipient on a failure or when the user typed a new address before an older response. Native form values include autofill. An immediate in-flight guard prevents duplicate submissions; identical in-session retries reuse the attempt key. There is no account auto-provisioning and the invited user still accepts the invitation normally.

Executed focused checks use an isolated database and fake email transport or intercepted synthetic browser responses. Three unit scenarios cover listing privacy, missing-mail atomic failure and idempotent one-email replay. Four Chromium/WebKit scenarios cover email-first UI, pending rows, no copy-link field and failure retention. No real invitation was sent by this agent. Publication/merged-source verification is recorded on the PR.

Remaining boundaries: acceptance state is shown, not live Resend delivered/bounced events. Resend/revoke controls and cross-device draft persistence are not introduced here. No import data, source authors, production accounts or roles are changed by deploying this UI.

## Merged-main acceptance

Integrated current main f077f47, retaining the published shell, team/dock administration, imported-person notification fix, MCP and Linear import/parser changes. Both overlapping additions in app imports and OpenAPI routes were kept, and request contracts regenerated. Scope metadata now explicitly matches the existing team/invitation handlers.

Merged source has225 passing unit tests and one pre-existing skip;85 Chromium and85 WebKit cases pass;20 Storybook and6visual comparisons pass. Growing the suite exposed redundant per-file test logins exhausting the real limiter; four feature files now share one verified synthetic session and validate it before reuse, without changing production limits. The pre-existing WebKit history geometry test now finishes the current page's queries before deliberately reloading into another viewport; its page-error assertion is retained, not filtered or relaxed.

Silent email autofill was separately reproduced losing its value after a failed send. The submitted native value is now adopted before pending/error renders; six focused browser checks cover it along with email-first and failure UI.
