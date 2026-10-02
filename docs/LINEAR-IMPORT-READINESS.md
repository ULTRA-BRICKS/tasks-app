# Linear import readiness — implementation audit

The user requires functionality and API coverage BEFORE importing. No target writes are made by this audit.

The read-only `scripts/linear-import-preflight.mjs` verifies all source hashes, JSON arrays, counts and unique IDs, then compares required collections against the current OpenAPI contract. Run with `bun scripts/linear-import-preflight.mjs --snapshot PRIVATE_EXPORT_DIRECTORY --openapi docs/openapi.json`. Exit2 means NOT approved for import; there is intentionally no apply option.

## Observed result

The stored Glide snapshot was rechecked:20 files,11,862,827 bytes, all listed checksums and counts match. The contract check found:

| Source collection | Count | Current contract |
| --- | ---: | --- |
| Issues | 1,701 | Basic read/create present |
| Projects | 12 | Basic read/create present |
| Comments | 1,307 | Issue comment creation present |
| Issue relations | 744 | Relation creation present |
| Documents | 3 | Missing document API |
| Initiatives | 1 | Missing initiative API |
| Attachments/links | 1,022 | Metadata snapshot only; binary transfer not verified |

Basic CRUD is not lossless import support. The application also lacks a tested idempotent Linear import plan/apply API, explicit imported-identity mapping and proof of historical author/timestamp preservation. Existing-user privileges must not be inferred from source names/roles. Importing only issues while silently dropping these collections is forbidden.

## Required acceptance before writes

Preserve source IDs and retain unsupported raw metadata; validate account/team/status mappings without automatically creating login credentials; take a destination backup; rehearse in an isolated database; prove retry deduplication, unchanged pre-existing user edits and complete link/history reconstruction; then authenticate to the destination and verify counts and real UI/API round-trips.

Current decision: **safeToApply=false; targetWrites=0**. This is a verified coverage report, not an implemented or executed importer. The private snapshot remains outside the source repository; only aggregate counts are documented here.
