/**
 * Bookkeeping for a text box whose committed value lives elsewhere (the URL). The box keeps
 * its own text while the user types and hands it over later; a value that comes back from the
 * outside is either the echo of such a hand-over or a change nobody here made. Only the latter
 * may replace the text. Pure so the ordering rules are testable without a DOM.
 */
export interface TextSync {
  /** Last value seen from the outside. */
  readonly external: string;
  /** Values handed over whose echo has not been seen yet, oldest first. */
  readonly inflight: readonly string[];
}
/** The sync after handing `text` over, or null when the outside already holds or will hold it. */
export function sendText(sync: TextSync, text: string): TextSync | null {
  const target = sync.inflight.at(-1) ?? sync.external;
  return text === target ? null : { external: sync.external, inflight: [...sync.inflight, text] };
}
/**
 * Reads the outside value after a render. An echo of any handed-over value, in any order or
 * batched, is absorbed; anything else is an explicit change elsewhere and is adopted.
 */
export function observeExternal(
  sync: TextSync,
  external: string,
): { sync: TextSync; adopt: boolean } {
  if (external === sync.external) return { sync, adopt: false };
  const echoed = sync.inflight.indexOf(external);
  if (echoed >= 0)
    return { sync: { external, inflight: sync.inflight.slice(echoed + 1) }, adopt: false };
  return { sync: { external, inflight: [] }, adopt: true };
}
/** Forgets hand-overs that can no longer echo once the text and the outside agree. */
export function settleText(sync: TextSync): TextSync {
  return sync.inflight.length ? { external: sync.external, inflight: [] } : sync;
}
