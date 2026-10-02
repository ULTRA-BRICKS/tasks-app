import { open, lstat, readFile, unlink } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
export async function acquireSetupLock(file) {
  let fd;
  try {
    fd = await open(file, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Setup lock is not a regular file');
    const pid = Number((await readFile(file, 'utf8')).trim());
    let stale = (!Number.isSafeInteger(pid) || pid <= 0) && Date.now() - info.mtimeMs > 60000;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        stale = e.code === 'ESRCH';
      }
    }
    // Never unlink a named lock we do not own: another reclaimer could replace
    // it between a check and unlink. Ordinary SIGINT/SIGTERM release our own lock.
    throw new Error(
      stale
        ? `An interrupted setup left ${file}. Verify no setup is running, remove that lock file, and retry. No data changed.`
        : 'Another setup is running; no data was changed',
    );
  }
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
