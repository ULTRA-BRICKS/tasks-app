/** Delayed write responses must never replace a newer server snapshot. */
export function mergeVersioned<T extends { version: number }>(
  current: T,
  incoming: Partial<T> & { version: number },
): T {
  return incoming.version < current.version ? current : { ...current, ...incoming };
}
