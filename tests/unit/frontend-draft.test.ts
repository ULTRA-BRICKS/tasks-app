import { advanceDocumentVersion } from '../../src/shared/lib/draft';
import { mergeVersioned } from '../../src/shared/lib/versioned';
import { test, expect } from 'bun:test';
import {
  freshDraft,
  observeDocument,
  acceptDocument,
  restoreDocument,
  draftDirty,
} from '../../src/shared/lib/draft';
const base = { title: 'Original', description: 'Body', version: 1 };
test('clean drafts refresh, dirty content conflicts never overwrite local text', () => {
  const clean = freshDraft(base),
    dirty = { ...clean, title: 'Typed' };
  expect(observeDocument(clean, { ...base, title: 'Remote', version: 2 }).title).toBe('Remote');
  expect(observeDocument(dirty, { ...base, title: 'Remote', version: 2 })).toEqual(dirty);
  expect(observeDocument(dirty, { ...base, version: 2 }).version).toBe(2);
});
test('save acknowledgement preserves text typed during the request', () => {
  const sent = { ...freshDraft(base), title: 'First edit' };
  const during = { ...sent, title: 'Second edit', description: 'More text' };
  const next = acceptDocument(during, sent, { ...base, title: 'First edit', version: 2 });
  expect(next.title).toBe('Second edit');
  expect(next.description).toBe('More text');
  expect(next.baseTitle).toBe('First edit');
  expect(next.version).toBe(2);
  expect(draftDirty(next)).toBe(true);
});
test('corrupt or oversized browser drafts cannot break issue rendering', () => {
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...freshDraft(base), title: 'x'.repeat(301) }),
    JSON.stringify({ ...freshDraft(base), version: -1 }),
  ])
    expect(restoreDocument(raw, base)).toEqual(freshDraft(base));
  expect(restoreDocument(JSON.stringify({ ...freshDraft(base), title: 'Local' }), base).title).toBe(
    'Local',
  );
});

test('delayed write responses cannot regress a newer cached version', () => {
  const current = { version: 3, title: 'Remote update', description: 'Keep me' };
  expect(mergeVersioned(current, { version: 2, title: 'Old response' })).toBe(current);
  expect(mergeVersioned(current, { version: 4, title: 'Latest' })).toEqual({
    ...current,
    version: 4,
    title: 'Latest',
  });
});

test('focused drafts advance for metadata-only server changes, never conceal text conflicts', () => {
  const acknowledged = {
    ...freshDraft({ version: 2, title: 'Saved', description: 'Body' }),
    title: 'Still typing',
  };
  expect(
    advanceDocumentVersion(acknowledged, { version: 3, title: 'Saved', description: 'Body' }),
  ).toEqual({ ...acknowledged, version: 3 });
  expect(
    advanceDocumentVersion(acknowledged, {
      version: 3,
      title: 'Remote text edit',
      description: 'Body',
    }),
  ).toBe(acknowledged);
});
test('an older acknowledgement never regresses an already newer local baseline', () => {
  const current = {
    ...freshDraft({ version: 3, title: 'New baseline', description: 'Body' }),
    title: 'Unsaved edit',
  };
  const sent = freshDraft({ version: 1, title: 'Old baseline', description: 'Body' });
  expect(
    acceptDocument(current, sent, {
      version: 2,
      title: 'Old acknowledgement',
      description: 'Body',
    }),
  ).toBe(current);
});
