export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'textarea,select,input:not([type="checkbox"]):not([type="radio"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]',
    ),
  );
}
export function hasOpenOverlay(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'dialog[open],[role="dialog"],[role="menu"],[role="listbox"]',
    ),
  ).some(
    (element) =>
      !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
      element.getClientRects().length > 0,
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
  i: '/issues',
  m: '/my-issues',
  p: '/projects',
  c: '/cycles',
  n: '/inbox',
  s: '/settings',
};
