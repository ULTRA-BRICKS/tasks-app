# Cycle help — feedback-20260925-10

Task identity: `fd02409b-6fda-451c-bca9-83ff5ccaf172` (currently UB-44; resolve by UUID because numeric codes changed after initial registration).

The Cycle property now has an independent, named information button. It opens a short explanation without opening the assignment picker or changing a task. “Read full guide” replaces the hint with a viewport-sized reading surface, including the distinction between a time-boxed team planning period, a project and a task status.

The guide uses the existing accessible Modal and Popover primitives. Escape and Back to task restore focus to the information button. Long guide text scrolls independently; footer controls remain reachable. The information button has a44px target on coarse-pointer devices. New task titles and other unsent fields are unaffected, and help produces no mutation request.

The content describes only the existing manual cycle features in Tasks: optional team-scoped assignment and independent task dates. It does not promise Linear's automatic cycle creation, carryover or release automation. User-facing entity terminology in the guide is Task/Tasks.

Original missing-help browser tests are retained in `/tmp/tasks-cycle-help-red.log`. The focused Chromium/WebKit acceptance and a new Storybook keyboard/interactions check cover the hint, full-screen guide, focus restoration, no picker activation and no data write. An initial Storybook run failed to fetch newly optimized dependency modules; its next complete run passed without a product-code change or suppressed test. Final full-suite/review/publication results belong to the release receipt.

References inspected25September2026:

- https://linear.app/docs/use-cycles — time-boxed team work periods, not releases.
- https://base-ui.com/react/components/popover — named popovers and explicit focus return.

This increment does not replace the calendar, introduce automatic cycle recurrence, or complete the broader keyboard/cache/Slack backlog.

The short-phone follow-up also exercises both footer and Close dialog dismissal after scrolling the guide to its final section. All three closing paths—Escape, Back to task and the named close control—return focus to the information button in current Chromium/WebKit, without data writes. A proposed optional `Modal.finalFocus` extension was investigated separately but is not included; the current Cycle flow uses its existing focus-return callback and remains covered by the actual consumer tests.
