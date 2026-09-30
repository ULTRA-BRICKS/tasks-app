import { useEffect, useRef } from 'react';
/**
 * Editors ask the browser to confirm leaving while text is unsent ("Leave site?"). Sign-out asks
 * about text saved nowhere in its own dialog before it ends the session: a "Leave site?" answered
 * after the session ended could only keep a signed-out page. The sign-out navigation is then let
 * through instead of asking again.
 */
/** An editor's unsent text: none, kept as a draft on this device, or lost if the page goes. */
export type UnsentText = 'none' | 'kept' | 'lost';
const guards = new Set<() => UnsentText>();
let decided = false;
function warn(event: BeforeUnloadEvent) {
  if (decided) return;
  for (const unsent of guards)
    if (unsent() !== 'none') {
      event.preventDefault();
      event.returnValue = '';
      return;
    }
}
/** True when an open editor holds text that storage could not keep on this device. */
export function textSavedNowhere() {
  for (const unsent of guards) if (unsent() === 'lost') return true;
  return false;
}
/** Call right before a navigation the user already confirmed; the page is about to unload. */
export function allowUnload() {
  decided = true;
}
/** The browser asks "Leave site?" while this mounted editor reports unsent text. */
export function useUnloadWarning(unsent: () => UnsentText) {
  const latest = useRef(unsent);
  useEffect(() => {
    latest.current = unsent;
  });
  useEffect(() => {
    const guard = () => latest.current();
    guards.add(guard);
    if (guards.size === 1) window.addEventListener('beforeunload', warn);
    return () => {
      guards.delete(guard);
      if (!guards.size) window.removeEventListener('beforeunload', warn);
    };
  }, []);
}
