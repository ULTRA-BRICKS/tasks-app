# Administrator handoff — Linear to Tasks

Prepared 18 September 2026 for Danny (danny@glide.vc). This is a draft handoff, not a sent message or proof of activation.

## Required administrator actions

In the Linear workspace Glide (https://linear.app/glide-vc), open Settings > Administration > API and prepare a webhook named `Tasks production — Linear to Tasks`.

Consumer URL: `https://tasks-ultrabricks.vercel.app/api/webhooks/linear`
Source organization: `b16c196e-0f55-4143-94b1-20565df6a468`
Scope: all public teams, including Hype Riders (HYP) and Gliders (GL). Private teams require separate explicit scope and matching read access; do not add private teams implicitly.
Hype Riders team ID: `89a2ef57-220f-4769-a778-d22bda1a66cc`
Gliders team ID: `63fd2433-d418-461d-b615-b06c4e86a406`

Resource subscriptions to prepare: Issues, Issue comments, Issue attachments, Issue labels, Projects, Project updates, Documents, Initiatives, Initiative updates, Cycles and Users. These subscriptions define desired event capture, not a claim that every resource handler is implemented. Current source only applies Issue/Comment create/update; other resource types and removals are recorded unsupported and remain HYP-1482 work.

Keep the webhook DISABLED until the receiver and database migration are deployed and the signing secret is installed. The canonical POST endpoint was checked during this handoff and returned HTTP404. Creating a webhook through the API should explicitly use `enabled:false`; if the UI cannot save disabled, wait rather than enabling against an absent receiver. Do not use a request-bin or third-party debug endpoint for private payloads.

Create a dedicated read-only personal API key from Settings > Account > Security & Access. Name: `Tasks production sync — read only`. Grant Read only, with access to Hype Riders and Gliders. No Write, Admin, Create issues or Create comments permissions are required by the running sync. Do not promote Ultra to workspace admin merely to run this integration.

The key must be a raw Linear personal API key (not a `Bearer ...` string) for the current client. Keep it separate from the webhook signing secret. Obtain that secret from the webhook details page. Never put either secret into tickets, commits, screenshots, ordinary email or chat.

The application operator handles deployment and activation. Danny can provide the two secrets through an approved private secret-sharing channel, or install them directly in the existing Vercel project if already authorized there. No additional access is assumed.

## Server configuration — application operator

Existing Vercel project: `tasks-app`, team `inventorems-projects`, project ID `prj_BicxQsqDlb394HzvMuXZKB883EdY`. Production environment only; do not expose values to the browser or prefix secret names with VITE_/NEXT_PUBLIC_.

```text
LINEAR_SYNC_WORKSPACE_ID=a5af9d58-47ce-4a80-9579-17c5c79f5f4c
LINEAR_WEBHOOK_SECRET=<this webhook's signing secret>
LINEAR_API_TOKEN=<dedicated read-only Linear personal API key>
```

The source organization is validated against the existing completed import; no invented LINEAR_ORGANIZATION_ID setting is required. Do not confuse the Linear organization ID with the Tasks workspace ID. Preserve existing DATABASE_URL, AUTH_SECRET, CRON_SECRET, storage and email configuration. Setting variables alone does not deploy the unreleased code or migrate schema7.

Non-secret reply requested from Danny: webhook ID, disabled/enabled state, confirmed source workspace and teams, selected resource types, and confirmation that the dedicated key is Read-only. No secrets in the reply.

After the operator confirms receiver readiness, enable the webhook and use a clearly disposable test issue/comment for create/update acceptance; capture delivery ID and timestamp. Test deletion/restoration only after safe remove handling is released, never with production work items. A good receiver acknowledges a verified delivery with HTTP200 within5seconds; unsigned test requests must still be rejected. Do not change the signing/security settings to make an unsigned request pass.

Official references: https://linear.app/docs/api-and-webhooks ; https://linear.app/developers/webhooks ; https://linear.app/developers/graphql . No Zapier, n8n or external webhook relay is required.
