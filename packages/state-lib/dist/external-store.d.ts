export interface ExternalStore<T> {
    getSnapshot(): T;
    subscribe(notify: () => void): () => void;
}
/** Framework-neutral bridge; values must use the kernel's immutable-update convention. */
export declare function toExternalStore<T>(source: {
    get(): T;
    subscribe(listener: (value: T) => void): () => void;
}): ExternalStore<T>;
/** Cached selector snapshots for external-store UI bindings; no second reactive runtime. */
export declare function selectExternalStore<T, Selected>(source: ExternalStore<T>, selector: (snapshot: T) => Selected, equal?: (left: Selected, right: Selected) => boolean): ExternalStore<Selected>;
