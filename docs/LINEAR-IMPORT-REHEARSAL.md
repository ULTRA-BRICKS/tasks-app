# Full Linear import rehearsal — 16 September 2026

This is a real rehearsal of the complete stored Glide snapshot, not a production-import claim.

Destination: Neon branch `br-rough-fog-b1tgd1de` (`tasks-linear-import-rehearsal-20260916`), explicitly guarded by its hostname and a rehearsal marker before migrations. Production remains on its original branch and schema; no login accounts, credentials or memberships were created by this import.

## Native data transferred and independently reconciled

1,701 issues; 1,307 comments; 12 projects; 7 milestones; 1 initiative; 3 documents; 744 relations; 5,229 history events; 12 source-attribution people. The existing one account/one membership are unchanged. All 6,590 raw source records are retained, including fields without direct native equivalents. A second immutable run verifies private files; it intentionally preserves the first run as well, for 13,180 staging records, not duplicate native tasks.

Direct SQL comparison found zero differences in issue title/description/created/updated timestamps, comment bodies/creation timestamps, and full document contents. The 113,876-character source document is not truncated; its API/editor accepts up to 500,000 characters. Workflow `duplicate` retains its original type while using the native canceled terminal category. Three same-name default labels are explicitly reused with source/target colors shown in the plan; no existing label is overwritten.

## Files

All 190 unique private Linear file references are accounted for. 163 originals were authenticated, downloaded, SHA-256 checked, transferred through the private storage adapter and read back with matching bytes/hash. Rehearsal object storage is a private local test directory, NOT production Blob. These originals total 20,574,421 bytes; no file exceeds 3 MiB.

27 source URLs returned 404. One was additionally checked through a newly signed URL and also returned 404; this does not prove why it disappeared. Their references and explicit source-unavailable status are preserved. They are never described as downloaded. Normal apply rejects unresolved files and requires explicit acknowledgement of these known missing originals. Credentials remain in process memory; no credential, private payload or file bytes are committed here.

Native Markdown remains unchanged. Completed imports expose an authorized file map and download links; unsafe file types are served as attachment/octet-stream with nosniff and sandbox rather than executed inline. Real provider Blob upload/readback is a separate production acceptance step.

## Repeatability and boundaries

Repeated batch staging with identical IDs/content is unchanged; changed staged content conflicts. Plan hashes bind the source projection and file verification state. Apply is transactional, and repeating a completed plan does not create duplicate native records or overwrite subsequent edits made in Tasks. Private source authors are attribution rows, not authentication principals; REST/GraphQL return their identity without granting sign-in.

Source snapshot validation and native rehearsal succeeded. Current-source tests, actual screenshots and external review are tracked in WORK-CHECKPOINT.md. No completed production migration, merge, deployment or full 50-screen parity is implied.
