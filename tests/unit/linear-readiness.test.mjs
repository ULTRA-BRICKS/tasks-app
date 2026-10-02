import { test, expect } from 'bun:test';
import { assessLinearReadiness } from '../../packages/imports/linear-readiness.mjs';
const snapshot = {
  format: 'tickets-linear-snapshot-v1',
  counts: { issues: 2, documents: 1, initiatives: 1, attachments: 1 },
  validationFindings: [],
  issueVerificationDrift: { added: [], removed: [], changed: [] },
};

test('basic issue endpoints cannot authorize a lossy whole-workspace import', () => {
  const result = assessLinearReadiness(snapshot, {
    paths: { '/v1/issues': { get: {}, post: {} } },
  });
  expect(result.safeToApply).toBe(false);
  expect(result.targetWrites).toBe(0);
  expect(result.blockers).toContain('MISSING_DOCUMENTS_API');
  expect(result.blockers).toContain('MISSING_INITIATIVES_API');
  expect(result.blockers).toContain('MISSING_IDEMPOTENT_IMPORT_API');
  expect(result.blockers).toContain('ATTACHMENT_BYTES_NOT_VERIFIED');
});

test('route declarations alone never certify live import acceptance', () => {
  const paths = Object.fromEntries(
    [
      '/v1/issues',
      '/v1/documents',
      '/v1/initiatives',
      '/v1/imports/linear/plan',
      '/v1/imports/linear/apply',
    ].map((path) => [path, { get: {}, post: {} }]),
  );
  const result = assessLinearReadiness({ ...snapshot, counts: { issues: 1 } }, { paths });
  expect(result.safeToApply).toBe(false);
  expect(result.blockers).toEqual(['TARGET_ACCESS_AND_REHEARSAL_NOT_VERIFIED']);
});

test('source drift and unresolved references block preflight', () => {
  const result = assessLinearReadiness(
    {
      ...snapshot,
      validationFindings: ['unresolved'],
      issueVerificationDrift: { changed: ['one'] },
    },
    { paths: {} },
  );
  expect(result.blockers).toContain('SOURCE_REFERENCE_VALIDATION');
  expect(result.blockers).toContain('SOURCE_CHANGED_DURING_EXPORT');
  expect(() => assessLinearReadiness({}, { paths: {} })).toThrow();
});
