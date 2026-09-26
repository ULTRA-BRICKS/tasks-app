/** Shortcut help body used by the state-lib keyboard binding (baseline keeps its inline copy). */
export function ShortcutReference() {
  return (
    <dl className="shortcut-reference">
      <dt>J / K or ↓ / ↑</dt>
      <dd>Move through visible issues</dd>
      <dt>Enter</dt>
      <dd>Open the focused issue</dd>
      <dt>X</dt>
      <dd>Select the focused issue</dd>
      <dt>C / V</dt>
      <dd>New issue page</dd>
      <dt>⌘ / Ctrl K</dt>
      <dd>Command menu</dd>
      <dt>G then I / M / P / C</dt>
      <dd>Issues / My issues / Projects / Cycles</dd>
      <dt>Escape</dt>
      <dd>Cancel the active edit or return to the list</dd>
      <dt>?</dt>
      <dd>This help</dd>
    </dl>
  );
}
