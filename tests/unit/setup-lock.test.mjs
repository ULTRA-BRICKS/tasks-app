import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSetupLock } from '../../scripts/setup-lock.mjs';
test('setup lock rejects an active owner and releases cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tickets-lock-')),
    file = join(dir, 'lock');
  try {
    const release = await acquireSetupLock(file);
    expect(Number(await readFile(file, 'utf8'))).toBe(process.pid);
    let failed = false;
    try {
      await acquireSetupLock(file);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    await release();
    const again = await acquireSetupLock(file);
    await again();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('setup reports abandoned locks without racing a new owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tickets-lock-')),
    file = join(dir, 'lock');
  try {
    const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)']);
    await child.exited;
    await writeFile(file, String(child.pid));
    const attempts = await Promise.allSettled([acquireSetupLock(file), acquireSetupLock(file)]);
    expect(attempts.every((x) => x.status === 'rejected')).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(String(child.pid));
    expect((await stat(file)).isFile()).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
