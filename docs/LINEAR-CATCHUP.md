# Bidirectional catch-up foundation — HYP-1482

The user authorized updating both Linear and Tasks and configuring automatic synchronization. Live Linear access now confirms administrator rights. Existing shared records use original source UUID mappings, never matching issue identifiers alone. Native-only Tasks records are exported with stable client-assigned source UUIDs; source-only records receive distinct native keys when numbers collide.

This foundation adds two administrator-only, plan-hash guarded operations on the existing schema 8. `POST /api/v1/imports/linear/append` adds missing issue/comment records, with original source authors/timestamps, deterministic source mappings, dependency-first parents and collision-safe native numbering. `POST /api/v1/imports/linear/bind` registers explicit already-converged exported entities and reference metadata without changing their native content. Both retain an immutable batch receipt and are retry-safe. Existing mappings cannot silently point to another target.

This is not a replacement of the one-time import and does not reset accounts, memberships, history, local-only tasks or comments. Existing changed records require a three-way merge; append deliberately refuses to overwrite them. Source file references remain private and are tracked as pending until bytes are transferred and read back. Record creation must not be described as successful media transfer.

No migration is introduced here: the published MCP OAuth migration 8 is retained. The older unmerged webhook branch uses the same migration number and is not incorporated or deployed by this foundation. Automatic scheduling/webhook processing and complete two-way reconciliation remain a separate implementation/activation step, not implied by these routes.

Checks before publication: targeted real-HTTP tests (plan vs apply, replay, new source author/timestamps, reference integrity, collisions, parent ordering, stale plans, anonymous/admin isolation), full source checks, independent tsc, secret-pattern scan and external review. Actual current results and deployment identity are recorded in the operator checkpoint, not inferred from this design description.
