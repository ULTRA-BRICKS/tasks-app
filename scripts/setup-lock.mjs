import { open, lstat, readFile, unlink } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
export async function acquireSetupLock(file) {
  let fd;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fd = await open(file, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink())
        throw new Error('Setup lock is not a regular file');
      const raw = await readFile(file, 'utf8');
      const pid = Number(raw.trim());
      let stale = false;
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          stale = e.code === 'ESRCH';
        }
      } else stale = raw.trim() === '' && Date.now() - before.mtimeMs > 60000;
      if (!stale) throw new Error('Another setup is running; no data was changed');
      const after = await lstat(file);
      if (after.ino !== before.ino || after.mtimeMs !== before.mtimeMs)
        throw new Error('Setup lock changed; retry after the other setup finishes');
      await unlink(file);
    }
  }
  if (!fd) throw new Error('Setup lock could not be acquired');
  await fd.writeFile(String(process.pid));
  await fd.sync();
  let released = false;
  const onSignal = (signal) => {
    if (!released) {
      try {
        unlinkSync(file);
      } catch {}
      released = true;
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const interrupt = () => onSignal('SIGINT'),
    terminate = () => onSignal('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  return async () => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    await fd.close();
    if (!released) {
      released = true;
      await unlink(file);
    }
  };
}
