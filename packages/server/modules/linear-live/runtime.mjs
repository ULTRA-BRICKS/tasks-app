import { assert } from '../../core/errors.mjs';

export function syncDeploymentId(env) {
  const own = env.TASKS_DEPLOYMENT_ID || null;
  const vercel = env.VERCEL_DEPLOYMENT_ID || null;
  assert(
    !own || !vercel || own === vercel,
    503,
    'SYNC_RUNTIME_CONFLICT',
    'Conflicting deployment identity',
  );
  return own ?? vercel;
}
export function linearQueueDriver(env) {
  const driver = env.LINEAR_QUEUE_DRIVER || 'vercel';
  assert(
    ['postgres', 'vercel'].includes(driver),
    503,
    'SYNC_RUNTIME_INVALID',
    'Unknown Linear queue driver',
  );
  return driver;
}
