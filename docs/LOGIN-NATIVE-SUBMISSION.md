# Native login submission and recovery handoff — 25 September 2026

## Contract

Read the browser's current named fields on submit, including password-manager/autofill changes that do not emit a React change event. Trim the email only; preserve every password character. Adopt submitted values into component state before the pending render so a rejected attempt remains editable and retryable. Never persist a password to browser storage, a URL, recovery navigation state, files or logs.

An immediate ref lock prevents two submissions in one JavaScript task from issuing duplicate requests. Release it on settlement; do not disable retry after a legitimate rejection. Native required/type validation remains enabled. The API endpoint, cookie/session policy, credentials verification, CSRF and rate limits do not change.

For ordinary activation of Forgot password, read the real email field immediately before navigation and pass only that value through existing router state. Modifier/middle clicks keep standard link behavior. This also fixes WebKit's missing email handoff when autofill has not updated React state.

## Executed regressions

Baseline Chromium and WebKit sent empty email/password for silently autofilled fields and issued two requests for same-task double submission (four failures). The recovery handoff additionally reproduced an empty email in WebKit. After the fix, eight focused browser scenarios pass: native autofill payload/retention, one-flight guard, recovery handoff without password propagation, and required-field blocking plus retry after rejection. Tests intercept login with synthetic rejections: no real user's credentials or sessions are used.

Final source, whole-browser, Storybook and visual gate results belong to the release receipt/PR. Old login layout and field geometry remain unchanged. This feature does not claim completion of private-data offline caching, full configurable shortcuts, global Undo/Redo or Slack setup.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/FormData/FormData — FormData(form) reads named current form controls rather than an application's stale state snapshot.

The first review also identified a mixed-input case: editing the password after silent autofill could erase the email on the next controlled-input render. A WebKit regression reproduced this. The form now adopts both native fields on input, before React commits the update. No storage or backend policy is involved.
