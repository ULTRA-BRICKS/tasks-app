# HYP-1482 — source labels must match the issue team

Live incident: native task c7684f15-b7fe-4da2-96f9-7cf1278452dd belongs to GL, but its source-create request selected a HYP-only `session:4` label. Linear rejected the task. A matching GL source-label alias was created with its own UUID and automatically mapped to the same native label; the original HYP alias and native content were preserved. The task was subsequently created once as GL-296 through the authorized source API and recovered by its existing native UUID.

Root cause: reverse references selected the first source UUID for a native label without checking the original source label's team. The correction reads already-stored source scope with bounded existing reference queries. For issue writes, it chooses a unique alias for the current source team (or, at creation, the native team's source identity); if none exists, it can use exactly one explicitly global source label. It rejects ambiguous, foreign-only, archived or unknown-scope choices before a bad mutation is sent.

This correction does not rename, merge or delete source labels and does not silently remove a label from a task. It does not implement automatic creation of every missing per-team alias: that condition remains explicit `SYNC_LABEL_SCOPE_PENDING`, not a claimed successful transfer.

Tests seed the real scope before import. `registerSource` preserves immutable originals, so changing a fixture afterwards through that function cannot simulate a different original scope. An earlier untracked exploratory test that made that mistake is retained separately and is not part of this release. The valid regression pair failed against HEAD and passes against the scoped resolver; global-label behavior also passes.

Evidence: tasks-label-scope-valid-red.log and tasks-label-scope-valid-green.log under /private/tmp. Live source label and task receipts are under ~/.local/share/tickets-migrations/missing-tasks-20260930. Full merged-source gates and final review must complete before this correction is called deployed. No schema change or numbering replay is required.
