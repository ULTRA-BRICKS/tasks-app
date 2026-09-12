export interface ServerDocument {
  title: string;
  description: string;
  version: number;
}
export interface DocumentDraft extends ServerDocument {
  baseTitle: string;
  baseDescription: string;
}
export const freshDraft = (v: ServerDocument): DocumentDraft => ({
  title: v.title,
  description: v.description,
  version: v.version,
  baseTitle: v.title,
  baseDescription: v.description,
});
export const draftDirty = (v: DocumentDraft) =>
  v.title !== v.baseTitle || v.description !== v.baseDescription;
export function observeDocument(current: DocumentDraft, incoming: ServerDocument): DocumentDraft {
  if (incoming.version <= current.version) return current;
  if (!draftDirty(current)) return freshDraft(incoming);
  if (incoming.title === current.baseTitle && incoming.description === current.baseDescription)
    return { ...current, version: incoming.version };
  return current;
}
export function acceptDocument(
  current: DocumentDraft,
  sent: DocumentDraft,
  result: ServerDocument,
): DocumentDraft {
  if (result.version < current.version) return current;
  return {
    ...freshDraft(result),
    title: current.title === sent.title ? result.title : current.title,
    description:
      current.description === sent.description ? result.description : current.description,
  };
}
export function restoreDocument(raw: string | null, fallback: ServerDocument): DocumentDraft {
  try {
    const d = JSON.parse(raw ?? 'null') as Partial<DocumentDraft> | null;
    if (
      d &&
      typeof d.title === 'string' &&
      d.title.length <= 300 &&
      typeof d.description === 'string' &&
      d.description.length <= 100000 &&
      typeof d.baseTitle === 'string' &&
      typeof d.baseDescription === 'string' &&
      Number.isSafeInteger(d.version) &&
      d.version! > 0
    )
      return {
        title: d.title,
        description: d.description,
        baseTitle: d.baseTitle,
        baseDescription: d.baseDescription,
        version: d.version!,
      };
  } catch {
    /* Invalid local envelopes do not prevent opening an issue. */
  }
  return freshDraft(fallback);
}

/** A metadata-only update may advance a focused draft's version, never its text baseline. */
export function advanceDocumentVersion(
  draft: DocumentDraft,
  latest: ServerDocument,
): DocumentDraft {
  if (
    latest.version > draft.version &&
    latest.title === draft.baseTitle &&
    latest.description === draft.baseDescription
  )
    return { ...draft, version: latest.version };
  return draft;
}
