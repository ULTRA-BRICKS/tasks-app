# HYP-1482 — preserve member attribution while comparing source-person aliases

An initiative's native owner was an existing workspace member while Linear resolved the same person's email to the imported source-person row. Strict UUID comparison retained a false owner conflict; the scan likewise kept requeueing an unchanged representation. The source account and native member were verified independently in production. No reassignment or account creation is warranted.

A bounded reference resolver now recognizes a member/source-person alias only if exactly one current workspace membership and exactly one mapped Linear person in the configured source organization share the same nonempty trimmed, case-normalized email. Duplicate candidates are refused; another workspace or source organization cannot supply identity. Incoming source references still use source_people IDs, preserving attribution foreign keys. Outbound member references resolve only through the verified source mapping.

Only owner_id, assignee_id and lead_id comparisons accept these aliases. Other fields and unknown IDs remain strict. The engine and scan use the same comparator, so a converged pair does not rewrite a stored member into a source person or keep dirtying the queue. Existing recorded false conflicts clear through a genuine normal reconciliation, not an operator deletion of the evidence.

The issue reconciliation and native scan regressions were both observed failing before the fix. Current tests also cover an existing initiative conflict, no version/attribution mutation, exact source-write count, duplicate-source refusal and unrelated-field refusal. Fixture pagination is complete, matching the actual API contract.

This follow-up changes no production account, token, permission, source data or numbering. Release, full/PG checks and final review are separate from this implementation note. The archived-project date repair remains blocked by the earlier tool denial; do not represent that field as cleared.

## 16 October — query-plan correction

The correlated-subquery regression was reproduced in tasks-person-plan-red-20261016.log. The query now computes per-email uniqueness once per scoped membership/source-person set, before filtering requested IDs. The source organization, workspace, provider and exact source mapping constraints remain unchanged. Both member-side and person-side lookup paths and foreign organization/workspace rejection are tested. No schema/index/account change is involved. Current continuity record is /home/ultra/xp/.tasks-work-evidence/tasks-app-continuity/CURRENT.json (the obsolete Mac pointer is not authoritative).
