export function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'textarea,select,input:not([type="checkbox"]):not([type="radio"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]',
      ),
    )
  );
}
export function hasOpenOverlay(): boolean {
  return [
    ...document.querySelectorAll<HTMLElement>(
      'dialog[open],[role="dialog"],[role="menu"],[role="listbox"]',
    ),
  ].some(
    (el) =>
      !el.closest('[hidden],[inert],[aria-hidden="true"],[data-closed],dialog:not([open])') &&
      el.getClientRects().length > 0,
  );
}
export function shortcutGuard(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    isTextEntry(event.target) ||
    hasOpenOverlay() ||
    Boolean(window.getSelection()?.toString())
  );
}
export const navigationChords: Record<string, string> = {
  i: '/inbox',
  a: '/issues',
  m: '/my-issues',
  p: '/projects',
  c: '/cycles',
  n: '/inbox',
  s: '/settings',
};
