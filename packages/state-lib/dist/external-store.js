/** Framework-neutral bridge; values must use the kernel's immutable-update convention. */
export function toExternalStore(source) {
    return Object.freeze({
        getSnapshot: () => source.get(),
        subscribe: (notify) => source.subscribe(() => notify()),
    });
}
/** Cached selector snapshots for external-store UI bindings; no second reactive runtime. */
export function selectExternalStore(source, selector, equal = Object.is) {
    let initialized = false;
    let snapshot;
    let selection;
    const getSnapshot = () => {
        const next = source.getSnapshot();
        if (initialized && Object.is(next, snapshot))
            return selection;
        const selected = selector(next);
        const reuse = initialized && equal(selection, selected);
        snapshot = next;
        initialized = true;
        if (!reuse)
            selection = selected;
        return selection;
    };
    return Object.freeze({
        getSnapshot,
        subscribe(notify) {
            let observed = getSnapshot();
            return source.subscribe(() => {
                const next = getSnapshot();
                if (!Object.is(observed, next)) {
                    observed = next;
                    notify();
                }
            });
        },
    });
}
