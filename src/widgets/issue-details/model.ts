export interface DraftSource {
  title: string;
  description: string;
  version: number;
}
export interface IssueDraft extends DraftSource {
  baseTitle: string;
  baseDescription: string;
}
export const snapshotDraft = (issue: DraftSource): IssueDraft => ({
  ...issue,
  baseTitle: issue.title,
  baseDescription: issue.description,
});
// Compare to the version the user started editing, not to a asynchronously refetched issue.
export const isDraftDirty = (draft: IssueDraft) =>
  draft.title !== draft.baseTitle || draft.description !== draft.baseDescription;
