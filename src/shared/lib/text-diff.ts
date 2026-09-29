// Line diff with word highlights for reviewing description edits (docs/TASK-ACTIVITY.md).
// A bounded LCS instead of a dependency: descriptions are short Markdown documents.
export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };
export type DiffRow =
  | { type: 'same' | 'added' | 'removed'; parts: DiffPart[] }
  | { type: 'skip'; count: number };

// Beyond either bound the caller shows the complete before/after texts instead of a diff:
// comparisons cap the LCS table; lines cap rendered rows (a pasted document has no pairs).
const LINE_CELLS = 1_000_000;
const MAX_LINES = 4_000;
const WORD_CELLS = 250_000;
const CONTEXT = 2;

type Op = { type: 'same' | 'added' | 'removed'; value: string };

function lcs(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start,
    m = endB - start,
    width = m + 1;
  // table[i][j] = LCS length of a[start+i..endA) and b[start+j..endB).
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const ops: Op[] = a.slice(0, start).map((value) => ({ type: 'same', value }));
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      ops.push({ type: 'same', value: a[start + i] });
      i++;
      j++;
    } else if (j < m && (i === n || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
      ops.push({ type: 'added', value: b[start + j] });
      j++;
    } else {
      ops.push({ type: 'removed', value: a[start + i] });
      i++;
    }
  }
  for (const value of a.slice(endA)) ops.push({ type: 'same', value });
  return ops;
}
// LCS table cells left after trimming the common prefix and suffix: the cost of `lcs(a, b)`.
const comparisonCells = (a: string[], b: string[]) => {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return (a.length - start - end) * (b.length - start - end);
};
const words = (line: string) => line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last && last.type === part.type) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}
// Pair a removed line with its replacement and mark only the words that changed.
function pair(before: string, after: string): [DiffPart[], DiffPart[]] {
  const a = words(before),
    b = words(after);
  if (comparisonCells(a, b) > WORD_CELLS)
    return [[{ type: 'removed', text: before }], [{ type: 'added', text: after }]];
  const ops = lcs(a, b);
  return [
    merge(ops.filter((op) => op.type !== 'added').map((op) => ({ type: op.type, text: op.value }))),
    merge(
      ops.filter((op) => op.type !== 'removed').map((op) => ({ type: op.type, text: op.value })),
    ),
  ];
}

export function diffText(before: string, after: string): DiffRow[] | null {
  // An empty description has no lines; `''.split('\n')` would invent one blank line.
  const a = before === '' ? [] : before.replace(/\r\n?/g, '\n').split('\n'),
    b = after === '' ? [] : after.replace(/\r\n?/g, '\n').split('\n');
  if (a.length + b.length > MAX_LINES || comparisonCells(a, b) > LINE_CELLS) return null;
  const ops = lcs(a, b),
    rows: Extract<DiffRow, { parts: DiffPart[] }>[] = [];
  for (let index = 0; index < ops.length;) {
    if (ops[index].type === 'same') {
      rows.push({ type: 'same', parts: [{ type: 'same', text: ops[index].value }] });
      index++;
      continue;
    }
    const removed: string[] = [],
      added: string[] = [];
    while (index < ops.length && ops[index].type !== 'same') {
      (ops[index].type === 'removed' ? removed : added).push(ops[index].value);
      index++;
    }
    const pairs = Math.min(removed.length, added.length),
      removedRows: DiffPart[][] = [],
      addedRows: DiffPart[][] = [];
    removed.forEach((line, i) => {
      if (i < pairs) {
        const [old, next] = pair(line, added[i]);
        removedRows.push(old);
        addedRows[i] = next;
      } else removedRows.push([{ type: 'removed', text: line }]);
    });
    added.forEach((line, i) => {
      if (i >= pairs) addedRows[i] = [{ type: 'added', text: line }];
    });
    for (const parts of removedRows) rows.push({ type: 'removed', parts });
    for (const parts of addedRows) rows.push({ type: 'added', parts });
  }
  // Keep a little unchanged context around each change; summarize the rest.
  const keep = rows.map((row, index) =>
    rows
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((near) => near.type !== 'same'),
  );
  const result: DiffRow[] = [];
  rows.forEach((row, index) => {
    if (keep[index]) result.push(row);
    else {
      const last = result.at(-1);
      if (last?.type === 'skip') last.count++;
      else result.push({ type: 'skip', count: 1 });
    }
  });
  return result;
}
