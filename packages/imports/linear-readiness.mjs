// Contract gate only: never writes to a target, creates users or substitutes missing source data.
export function assessLinearReadiness(manifest, openapi) {
  if (manifest?.format !== 'tickets-linear-snapshot-v1' || !manifest.counts || !openapi?.paths)
    throw new Error('A verified Linear snapshot manifest and target OpenAPI document are required');
  const operations = (path, methods) =>
    methods.every((method) =>
      Boolean(openapi.paths['/api' + path]?.[method] || openapi.paths[path]?.[method]),
    );
  const checks = [
    ['issues', '/v1/issues', ['get', 'post']],
    ['projects', '/v1/projects', ['get', 'post']],
    ['comments', '/v1/issues/{id}/comments', ['post']],
    ['issueRelations', '/v1/issues/{id}/relations', ['post']],
    ['documents', '/v1/documents', ['get', 'post']],
    ['initiatives', '/v1/initiatives', ['get', 'post']],
  ].map(([collection, path, methods]) => ({
    collection,
    count: Number(manifest.counts[collection] ?? 0),
    path,
    contractPresent: operations(path, methods),
  }));
  const blockers = checks
    .filter((check) => check.count > 0 && !check.contractPresent)
    .map((check) => 'MISSING_' + check.collection.toUpperCase() + '_API');
  if (
    !operations('/v1/imports/linear/plan', ['post']) ||
    !operations('/v1/imports/linear/apply', ['post'])
  )
    blockers.push('MISSING_IDEMPOTENT_IMPORT_API');
  if (manifest.validationFindings?.length) blockers.push('SOURCE_REFERENCE_VALIDATION');
  if (
    Object.values(manifest.issueVerificationDrift ?? {}).some(
      (items) => !Array.isArray(items) || items.length,
    )
  )
    blockers.push('SOURCE_CHANGED_DURING_EXPORT');
  if (Number(manifest.counts.attachments) > 0) blockers.push('ATTACHMENT_BYTES_NOT_VERIFIED');
  // Endpoint names alone cannot prove authorization, exact ID mapping, timestamp preservation or rollback.
  blockers.push('TARGET_ACCESS_AND_REHEARSAL_NOT_VERIFIED');
  return {
    safeToApply: false,
    targetWrites: 0,
    checks,
    blockers,
    requiredAcceptance: [
      'identity mapping without automatic privilege grants',
      'source ID deduplication',
      'author/timestamp/history preservation',
      'backup and isolated rehearsal',
      'unchanged existing records on retries',
      'authenticated round-trip reconciliation',
    ],
  };
}
