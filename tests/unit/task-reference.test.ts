import { test, expect } from 'bun:test';
import { preCanonicalCode, taskReference } from '../../src/shared/lib/task-reference';
test('UUIDs and task codes are identities; the slug is decorative', () => {
  const uuid = 'a76cc660-4c08-5628-a499-a7e65dd41638';
  expect(taskReference(uuid)).toBe(uuid);
  expect(taskReference(uuid.toUpperCase())).toBe(uuid);
  for (const input of [
    'UB-42',
    'ub-42',
    'UB-42-old-title',
    'UB-42-старое-название',
    'UB-42-old-99-title',
  ])
    expect(taskReference(input)).toBe('UB-42');
  expect(taskReference('TEAM9-123456')).toBe('TEAM9-123456');
});
test('malformed codes and traversal strings never become another route or API resource', () => {
  for (const input of [
    '',
    'new',
    '../users',
    'UB-0',
    'UB-042',
    'UB-42/../settings',
    '%2e%2e',
    'UB-42?x=y',
    '42',
    'A--42',
    'UB-42-',
    'X'.repeat(3000),
  ])
    expect(taskReference(input)).toBeNull();
});
test('pre-canonical links accept only task codes, never UUIDs or another route', () => {
  for (const input of ['UB-27', 'ub-27', 'UB-27-old-title', 'UB-27-старое-название'])
    expect(preCanonicalCode(input)).toBe('UB-27');
  for (const input of [
    'a76cc660-4c08-5628-a499-a7e65dd41638',
    '',
    'pre-canonical',
    '../users',
    'UB-027',
    'UB-27/../settings',
    'UB-27?x=y',
    'X'.repeat(3000),
  ])
    expect(preCanonicalCode(input)).toBeNull();
});
