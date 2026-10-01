import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { observeExternal, sendText, settleText, type TextSync } from './synced-text';
interface LiveText {
  text: string;
  commit: (text: string) => void;
  sync: TextSync;
  timer: number | undefined;
}
/** Quiet time before typed text is committed; also the cap on URL writes while typing. */
export const SYNC_DELAY_MS = 250;
/**
 * Props for a text input whose value is owned outside the component (a URL parameter) but must
 * never lag behind keystrokes. The local text updates synchronously on every change; `commit`
 * receives it after `delay` ms without typing, on Enter, on blur and after IME composition. An
 * outside value that is not the echo of a commit (back/forward, another link) replaces the text.
 */
export function useSyncedText(
  external: string,
  commit: (text: string) => void,
  delay = SYNC_DELAY_MS,
) {
  const [text, setText] = useState(external);
  const live = useRef<LiveText>({
    text: external,
    commit,
    sync: { external, inflight: [] },
    timer: undefined,
  });
  /** The text lives in state to render and in the ref for timers; write both together. */
  const write = useCallback((value: string) => {
    live.current.text = value;
    setText(value);
  }, []);
  const cancel = useCallback(() => {
    clearTimeout(live.current.timer);
    live.current.timer = undefined;
  }, []);
  const flush = useCallback(() => {
    cancel();
    const next = sendText(live.current.sync, live.current.text);
    if (!next) return;
    live.current.sync = next;
    live.current.commit(live.current.text);
  }, [cancel]);
  const schedule = useCallback(() => {
    cancel();
    live.current.timer = window.setTimeout(flush, delay);
  }, [cancel, flush, delay]);
  // No dependency list on purpose: latch the newest `commit` (it closes over the router's current params) after every render.
  useLayoutEffect(() => {
    live.current.commit = commit;
  });
  useLayoutEffect(() => {
    const observed = observeExternal(live.current.sync, external);
    live.current.sync = observed.sync;
    if (observed.adopt) {
      cancel();
      write(external);
    } else if (live.current.timer === undefined && text === external) {
      live.current.sync = settleText(live.current.sync);
    }
  }, [external, text, cancel, write]);
  useEffect(() => cancel, [cancel]);
  return {
    value: text,
    onChange(event: ChangeEvent<HTMLInputElement>) {
      write(event.target.value);
      if (event.nativeEvent instanceof InputEvent && event.nativeEvent.isComposing) cancel();
      else schedule();
    },
    onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) flush();
    },
    onCompositionStart: cancel,
    onCompositionEnd: schedule,
    onBlur: flush,
  };
}
