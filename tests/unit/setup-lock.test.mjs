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
test('setup automatically reclaims a lock left by a terminated process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tickets-lock-')),
    file = join(dir, 'lock');
  try {
    const p = Bun.spawn([process.execPath, '-e', 'process.exit(0)']);
    await p.exited;
    await writeFile(file, String(p.pid));
    const release = await acquireSetupLock(file);
    await release();
    expect(
      await stat(file).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
