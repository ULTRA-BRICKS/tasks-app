# Slack directory and notifications — 18 September 2026

Sole writer: ~/xp/tasks-slack-20260918, branch feat/slack-directory-stream-20260918, base/main501cce5 (the visible-menu release is already live). Content import/Linear live sync belongs to a separate agent; no changes there. Existing shortcuts/invitations/document work remains isolated in tasks-shortcuts-20260918.

Current Slack connector read succeeded for workspace Glide; this is ChatGPT's authorized connector, NOT the bot installation used by the Tasks backend. Read-only Vercel environment-name check found no SLACK_* or INTEGRATIONS_* variables. No actual Slack message, profile mutation, membership grant or secret creation was attempted.

Initial two API regressions are red (/tmp/tasks-slack-red.log). New allowed modules: bounded fixed-endpoint Slack client; workspace-auth verification; incremental source_people directory sync with cursor/CAS checks and no account creation; on-demand rich/custom profile details; connection/channel/status/mapping helpers; pure Block Kit formatter. All use schema7; no competing schema8 migration with the other agent.

The proposed new deliverSlackStream worker file was explicitly safety-rejected before writing. It is absent. Do not recreate it via another tool or reroute that blocked delivery operation. Existing legacy Slack outbox implementation remains as published. Do not claim advanced streaming/deduplication/native Slack mutations have been completed by these helpers. Finish independent directory and connection/UI acceptance first; any outgoing setup must state the actual current transport/worker boundary.

User screenshots show native Slack issue cards, threaded comments, status picker and More Options. Save originals only to private reference storage, not the repository. No DMs or group DMs are read; profiles and channel metadata only.
