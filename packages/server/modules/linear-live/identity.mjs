import { markdownEquivalent } from '../linear-import/source-contract.mjs';
const titleKey = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
export function compareIdentity(native, source, mapping = null) {
  const sourceId = source.id,
    nativeId = native.id;
  const titleMatches = titleKey(native.title) === titleKey(source.title);
  const bodyMatches = markdownEquivalent(native.description ?? '', source.description ?? '');
  const codeMatches = native.key === source.identifier;
  const a = Date.parse(native.created_at),
    b = Date.parse(source.createdAt);
  const createdAtMatches = Number.isFinite(a) && Number.isFinite(b) && a === b;
  const proven = Boolean(mapping && mapping.sourceId === sourceId);
  const mappingConflicts = Boolean(mapping && mapping.sourceId !== sourceId);
  let classification;
  if (proven) classification = codeMatches ? 'confirmed' : 'confirmed-code-drift';
  else if (titleMatches && bodyMatches) classification = 'possible-duplicate';
  else if (codeMatches)
    classification = mappingConflicts ? 'code-collision' : 'unresolved-code-match';
  else classification = titleMatches ? 'similar-title' : 'unrelated';
  return {
    nativeId,
    sourceId,
    nativeCode: native.key,
    sourceCode: source.identifier,
    classification,
    proven,
    mappingConflicts,
    codeMatches,
    titleMatches,
    bodyMatches,
    createdAtMatches,
    archiveDiffers: Boolean(native.archived_at) !== Boolean(source.archivedAt),
    provenance: proven ? mapping.provenance : null,
    requiresReview: ['possible-duplicate', 'unresolved-code-match', 'similar-title'].includes(
      classification,
    ),
  };
}
export function findIdentityCandidates(native, sources, mapping = null) {
  return sources
    .filter(
      (source) =>
        source.id === mapping?.sourceId ||
        source.id === native.id ||
        source.identifier === native.key ||
        titleKey(source.title) === titleKey(native.title),
    )
    .map((source) => compareIdentity(native, source, mapping));
}
