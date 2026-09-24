import { useEffect, useState } from 'react';
import {
  initialFeed,
  refreshFeed,
  revealNext,
  acceptFeed,
  appendRequestedPage,
  type FeedItem,
} from './live-feed';
export function useLiveFeed<T extends FeedItem>(
  rows: T[],
  scope: string,
  ready: boolean,
  pageCount = 1,
  lastPage: T[] = [],
) {
  const [state, setState] = useState(() => ({
    scope,
    source: rows,
    pageCount,
    initialized: ready,
    feed: initialFeed(rows),
  }));
  let current = state.feed;
  if (
    state.scope !== scope ||
    state.source !== rows ||
    state.initialized !== ready ||
    state.pageCount !== pageCount
  ) {
    const next = {
      scope,
      source: rows,
      pageCount,
      initialized: ready,
      feed:
        state.scope !== scope || !state.initialized
          ? initialFeed(rows)
          : pageCount > state.pageCount
            ? appendRequestedPage(refreshFeed(state.feed, rows), lastPage)
            : refreshFeed(state.feed, rows),
    };
    setState(next);
    current = next.feed;
  }
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        document.hidden ||
        window.getSelection()?.toString() ||
        document.activeElement?.matches('input,textarea,[contenteditable=true]')
      )
        return;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setState((previous) => {
        if (previous.scope !== scope || (!previous.feed.queue.length && !previous.feed.active))
          return previous;
        let feed = revealNext(previous.feed);
        if (reduced) {
          while (feed.queue.length) feed = revealNext(feed);
          feed = { ...feed, active: null };
        }
        return { ...previous, feed };
      });
    }, 400);
    return () => clearInterval(timer);
  }, [scope]);
  return {
    ...current,
    review: () => setState((previous) => ({ ...previous, feed: acceptFeed(previous.feed) })),
  };
}
