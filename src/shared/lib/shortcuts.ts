export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'textarea,select,input:not([type="checkbox"]):not([type="radio"]),[contenteditable="true"],[role="textbox"],[role="combobox"]',
    ),
  );
}
export function shortcutGuard(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    isTextEntry(event.target) ||
    Boolean(document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')) ||
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
