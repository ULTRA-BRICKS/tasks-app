/** Browser storage ports for scope controllers. */
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function blocked(failure: unknown): StoragePort {
  const fail = () => {
    throw failure;
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}
/**
 * Session storage that reports access errors through the port (so controllers can
 * surface a storage failure) instead of throwing while resolving the global. Returns
 * undefined outside a browser (SSR, tests).
 */
export function sessionStoragePort(): StoragePort | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch (failure) {
    return blocked(failure);
  }
}
