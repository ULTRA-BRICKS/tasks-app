import { expect, type Locator } from '@playwright/test';

// Twin of the Storybook helpers in src/widgets/issue-details/activity-feed.stories.tsx; these run
// inside page.evaluate, so they cannot import them. Keep the two in step.
/**
 * UB-100: a change line is one line box. Every text fragment and inline box of the line (and, on an
 * entry's first line, its time) must share one vertical centre, and the line must be about one
 * line-height tall. Measured in the page, so it holds for any font the engine picked.
 */
export async function expectOneLine(line: Locator) {
  const box = await line.evaluate((element) => {
    const centres = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => rect.top + rect.height / 2);
    };
    const entry = element.closest('[data-testid="activity-entry"]');
    const first = entry?.querySelector('[data-testid="activity-line"]') === element;
    const time = first ? entry?.querySelector('time') : null;
    const all = [...centres(element), ...(time ? centres(time) : [])];
    return {
      fragments: all.length,
      spread: Math.max(...all) - Math.min(...all),
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    };
  });
  expect(box.fragments).toBeGreaterThan(0);
  expect(box.spread).toBeLessThanOrEqual(4);
  expect(box.height).toBeLessThan(box.lineHeight * 1.5);
}

/** Text of each line of an entry without decorative parts (avatar initials), whitespace collapsed. */
export function lineTexts(entry: Locator) {
  return entry.getByTestId('activity-line').evaluateAll((lines) =>
    lines.map((line) => {
      const copy = line.cloneNode(true) as Element;
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    }),
  );
}
