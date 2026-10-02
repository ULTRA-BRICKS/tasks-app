/**
 * Who owns a key press, for the workspace keyboard dispatcher (docs/KEYBOARD-COMMANDS.md).
 * Text fields keep typing and native text undo. Other widgets (a closed picker, a listbox) keep
 * plain keys for type-ahead and arrows but let modifier shortcuts through. An open surface owns
 * every key, including Escape.
 */
const textFields =
  'textarea,input:not([type="checkbox"]):not([type="radio"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
const keyWidgets = 'select,[role="combobox"],[role="listbox"],[role="spinbutton"],[role="slider"]';
const surfaces = 'dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';
// Kept mounted but closed: hidden, inert, or in a closing transition (Base UI marks ending/closed).
const retained = '[hidden],[inert],[data-state="closing"],[data-ending-style],[data-closed]';

export type KeyTarget = 'text' | 'widget' | 'page';

export function keyTarget(target: EventTarget | null): KeyTarget {
  if (!(target instanceof Element)) return 'page';
  if (target.closest(textFields)) return 'text';
  return target.closest(keyWidgets) ? 'widget' : 'page';
}

/** The open popup that owns the keyboard, if any; retained popups that are closed never count. */
export function openSurface(root: ParentNode = document): Element | null {
  for (const element of root.querySelectorAll(surfaces))
    if (!element.closest(retained) && element.getClientRects().length > 0) return element;
  return null;
}
