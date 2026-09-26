import { Runtime } from '@ultrabricks/state-lib';

export interface UiValue<T> {
  readonly getSnapshot: () => T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  subscribe(listener: () => void): () => void;
  attach(): () => void;
}
export interface UiRegistry {
  value<T>(id: string, initial: T): UiValue<T>;
  inspect(): Readonly<Record<string, unknown>>;
  transact(fn: () => void): void;
  retain(): () => void;
  dispose(): void;
}
/** One application Runtime; component ownership is registration, not a second store. */
export function createUiRegistry(): UiRegistry {
  const runtime = new Runtime();
  const mounted = new Map<string, { read: () => unknown; source: unknown }>();
  let closed = false,
    retainers = 0,
    generation = 0;
  const open = () => {
    if (closed) throw Error('UI registry is disposed');
  };
  const dispose = () => {
    if (closed) return;
    runtime.dispose();
    closed = true;
    generation++;
    mounted.clear();
  };
  return {
    value<T>(id: string, initial: T): UiValue<T> {
      open();
      // An abandoned memo may be recreated while the old owner is still attached.
      // Reuse its actual signal, not a value copied at render time; attachment remains exclusive.
      const existing = mounted.get(id);
      const signal = existing ? (existing.source as ReturnType<typeof runtime.signal<T>>) : runtime.signal(initial),
        record = { read: () => signal.peek(), source: signal };
      let readers = 0,
        mountedOnce = false;
      const set = (value: T) => {
        if (closed || (mountedOnce && readers === 0)) return;
        signal.set(value);
      };
      return {
        getSnapshot: () => signal.peek(),
        set,
        update: (fn) => {
          if (!closed && (!mountedOnce || readers > 0)) set(fn(signal.peek()));
        },
        subscribe: (listener) => signal.subscribe(listener),
        attach() {
          open();
          const existing = mounted.get(id);
          if (existing && existing !== record) throw Error('Duplicate UI owner: ' + id);
          readers++;
          mountedOnce = true;
          mounted.set(id, record);
          let released = false;
          return () => {
            if (released) return;
            released = true;
            readers--;
            if (readers === 0 && mounted.get(id) === record) mounted.delete(id);
          };
        },
      };
    },
    inspect() {
      open();
      return Object.freeze(
        Object.fromEntries([...mounted].map(([id, owner]) => [id, owner.read()])),
      );
    },
    transact: (fn) => runtime.transaction(fn),
    retain() {
      open();
      retainers++;
      generation++;
      let released = false;
      return () => {
        if (released || closed) return;
        released = true;
        retainers--;
        const token = ++generation;
        queueMicrotask(() => {
          if (!retainers && generation === token && !closed) dispose();
        });
      };
    },
    dispose,
  };
}
