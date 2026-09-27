# Linear live synchronization — activation boundary

Tasks remains the operational backend and Linear assigns final ticket codes. The completed numbering migration is not repeated.

This release activates bidirectional issues, comments, projects, documents and initiatives, with durable signed source inbox, native outbox, generation/entity leases, preserved conflicting content, canonical code assignment, source removal markers and bounded managed queue delivery. Source metadata is imported as dependencies. Native comments must have a verified compatible source author; the runtime never impersonates other people. These supported paths have explicit replay, concurrent-creation, revocation and real PostgreSQL tests.

## Explicit remaining capability gaps

Native labels, workflow statuses, cycles and milestones now enqueue durable changes and are exported using stable UUIDs and verified parent mappings. Native scans cover these families as well as issues, comments, projects, documents and initiatives. Their regression tests exercise real HTTP creation, queue insertion and schema-valid source requests. Both operator helpers have been applied and verified; neither remains an activation prerequisite. References whose parents have not yet been exported remain visible as pending work rather than being silently dropped. This release is not a claim of full source-API feature parity.

Some source APIs cannot represent native archive or relationship edits directly; unsupported changes remain explicit errors/conflicts. Original content, creation metadata and history are retained. Unsupported does not mean synchronized. The status endpoint must be inspected during activation; repair/conflict handling remains required.

## Review findings closed for this release

Source team moves validate team/status/reference consistency and apply source codes in one transaction. Obsolete deployment or generation deliveries return without claiming or emitting jobs. All native creation paths preserve a durable original creation intent, so a later local text edit cannot wedge an already-created source UUID. Native edits coalesce per entity and an edit arriving during processing survives both success and failure. A new dispatch token distinguishes subsequent native edits; source retries include attempt identity.

Target-ID lookups remain a documented scaling improvement. Read-only production EXPLAIN measured 0.924 ms execution with 6,959 mappings. No unapproved schema or index mutation was substituted for a migration.

## Operational validation

Use a clean merged candidate, test real `/api/ready`, authenticated sync status/configuration and signed delivery, then configure the exact deployment as the only writer. Keep the existing source webhook disabled until receiver and managed queue consumption succeed. Verify a disposable task/comment in each direction and matching UUID-linked codes; preserve or archive test artifacts instead of deleting source history. On a failed acceptance, pause configuration and webhook, retaining inbox/outbox evidence.

The published API status and actual test receipts, not this document, establish whether synchronization is enabled.
