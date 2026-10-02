import { test, expect } from '@playwright/test';

test('measure synchronous draft work on isolated synthetic storage', async ({ page }, info) => {
  await page.goto('/login');
  const measurements = await page.evaluate(async () => {
    for (let i = 0; i < 250; i++) {
      const record = {
        key: 'input-draft:benchmark-workspace:benchmark-user:item-' + i,
        writer: 'fixture-' + i,
        value: JSON.stringify({ text: 'Synthetic fixture '.repeat(50) }),
        path: '/drafts',
        updatedAt: i,
      };
      localStorage.setItem(
        'tickets-recovery-v1:' + encodeURIComponent(record.key) + ':' + record.writer,
        JSON.stringify(record),
      );
    }
    const path = '/src/shared/lib/draft-persistence.ts';
    const { draftPersistence } = await import(path);
    const durations: number[] = [];
    const key = 'input-draft:benchmark-workspace:benchmark-user:large-body';
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      draftPersistence.setItem(
        key,
        JSON.stringify({ title: 'Synthetic benchmark', description: 'x'.repeat(100000), edit: i }),
      );
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    const originalKey = Object.getOwnPropertyDescriptor(Storage.prototype, 'key')!.value as (
      this: Storage,
      index: number,
    ) => string | null;
    let storageEnumerations = 0;
    Storage.prototype.key = function (index) {
      storageEnumerations++;
      return originalKey.call(this, index);
    };
    const start = performance.now();
    for (let i = 0; i < 10; i++)
      draftPersistence.getItem('input-draft:benchmark-workspace:benchmark-user:missing-' + i);
    const missingLookupsMs = performance.now() - start;
    Storage.prototype.key = originalKey;
    const scope = { workspace_id: 'benchmark-workspace', id: 'benchmark-user' };
    const list = draftPersistence.list(scope);
    const reusesList = list === draftPersistence.list(scope);
    return {
      writeSamples: durations.length,
      storageEnumerations,
      recoveredRecords: list.length,
      reusesList,
      payloadCharacters: 100000,
      writeMedianMs: durations[15],
      writeP95Ms: durations[28],
      writeMaxMs: durations[29],
      seededRecords: 250,
      missingLookups: 10,
      missingLookupsMs,
    };
  });
  expect(measurements.writeSamples).toBe(30);
  expect(measurements.storageEnumerations).toBe(0);
  expect(measurements.recoveredRecords).toBe(251);
  expect(measurements.reusesList).toBe(true);
  await info.attach('synthetic-draft-performance.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  console.log('DRAFT_BASELINE ' + info.project.name + ' ' + JSON.stringify(measurements));
});

test('explicit recovery keeps a separate backup and never reuses a writer version', async ({
  page,
}) => {
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    const path = '/src/shared/lib/draft-persistence.ts';
    const { draftPersistence: journal } = await import(path);
    const owner = { workspace_id: 'recovery-workspace', id: 'recovery-user' };
    const key = 'input-draft:recovery-workspace:recovery-user:example';
    journal.setItem(key, 'Earlier unsent fixture');
    const earlier = journal
      .list(owner)
      .find((r: { value: string }) => r.value === 'Earlier unsent fixture');
    journal.setItem(key, 'Later unsent fixture');
    const later = journal
      .list(owner)
      .find((r: { value: string }) => r.value === 'Later unsent fixture');
    journal.restore(earlier, owner);
    const restored = journal
      .list(owner)
      .find((r: { value: string }) => r.value === 'Earlier unsent fixture');
    const advanced = restored.clock[restored.writer] > later.clock[later.writer];
    journal.removeItem(key);
    return {
      advanced,
      preservesOtherCopy: journal
        .list(owner)
        .some((r: { value: string }) => r.value === 'Later unsent fixture'),
    };
  });
  expect(result).toEqual({ advanced: true, preservesOtherCopy: true });
});
