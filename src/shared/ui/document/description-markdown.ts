import { getSchema, type JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { descriptionExtensions, PRESERVED_BLOCK, PRESERVED_INLINE } from './description-schema';

/** Original bytes of the loaded description, used to write unchanged blocks back verbatim. */
export interface DescriptionBaseline {
  readonly prefix: string;
  readonly blocks: readonly BaselineBlock[];
}
interface BaselineBlock {
  readonly source: string;
  /** Whitespace between this block and the next one (or the end). */
  readonly gap: string;
  /** Markdown of each top-level editor node the block produced. */
  readonly keys: readonly string[];
}
export interface LoadedDescription {
  readonly doc: JSONContent;
  readonly baseline: DescriptionBaseline;
}
interface SyntaxNode {
  type: string;
  children?: SyntaxNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const extensions = descriptionExtensions();
export const descriptionSchema = getSchema(extensions);
const markdown = new MarkdownManager({ extensions, markedOptions: { gfm: true } });
const syntaxOptions = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };
const syntaxTree = (value: string): SyntaxNode => fromMarkdown(value, syntaxOptions);
// Same equivalence as the server's Linear source comparison: positions and list looseness ignored.
const semantic = (nodes: SyntaxNode[]) =>
  JSON.stringify(nodes, (key, item) => (key === 'position' || key === 'spread' ? undefined : item));
const INLINE_ATOMS: Record<string, true> = {
  html: true,
  linkReference: true,
  imageReference: true,
  footnoteReference: true,
};
const DEFINITIONS: Record<string, true> = { definition: true, footnoteDefinition: true };
const PLACEHOLDER = /\uE000(\d+)\uE001/g;
const EMPTY_DOCUMENT: LoadedDescription = {
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
  baseline: { prefix: '', blocks: [] },
};

function offset(node: SyntaxNode, edge: 'start' | 'end') {
  const value = node.position?.[edge].offset;
  if (value === undefined) throw new Error('Markdown syntax node without a source offset');
  return value;
}
// Blocks start at the beginning of their line so indentation stays with the block.
function lineStart(value: string, at: number) {
  let index = at;
  while (index > 0 && (value[index - 1] === ' ' || value[index - 1] === '\t')) index--;
  return index === 0 || value[index - 1] === '\n' ? index : at;
}
// Collects source ranges of inline constructs the editor keeps read-only. False: not editable.
function collectAtoms(node: SyntaxNode, ranges: [number, number][]): boolean {
  for (const child of node.children ?? []) {
    if (INLINE_ATOMS[child.type]) ranges.push([offset(child, 'start'), offset(child, 'end')]);
    else if (DEFINITIONS[child.type] || !collectAtoms(child, ranges)) return false;
  }
  return true;
}
function restoreAtoms(node: JSONContent, atoms: string[], placed: { count: number }): JSONContent {
  if (!node.content) return node;
  const content = node.content.flatMap((child): JSONContent[] => {
    if (child.type !== 'text' || !child.text?.includes('\uE000'))
      return [restoreAtoms(child, atoms, placed)];
    // An atom cannot live in code; leaving the placeholder makes the count check fail.
    if (node.type === 'codeBlock') return [child];
    const marks = child.marks ? { marks: child.marks } : {};
    const parts: JSONContent[] = [];
    let at = 0;
    for (const match of child.text.matchAll(PLACEHOLDER)) {
      if (match.index > at) parts.push({ ...child, text: child.text.slice(at, match.index) });
      parts.push({
        type: PRESERVED_INLINE,
        attrs: { markdown: atoms[Number(match[1])] },
        ...marks,
      });
      placed.count++;
      at = match.index + match[0].length;
    }
    if (at < child.text.length) parts.push({ ...child, text: child.text.slice(at) });
    return parts;
  });
  return { ...node, content };
}
// Editor nodes for one block, or null when the editor cannot represent it without changing it.
function editableNodes(
  block: SyntaxNode,
  value: string,
  start: number,
  source: string,
  context: string,
) {
  const ranges: [number, number][] = [];
  if (DEFINITIONS[block.type] || block.type === 'html' || source.includes('\uE000')) return null;
  if (!collectAtoms(block, ranges)) return null;
  const atoms = ranges.map(([from, to]) => value.slice(from, to));
  let text = '',
    at = start;
  ranges.forEach(([from, to], index) => {
    text += value.slice(at, from) + '\uE000' + index + '\uE001';
    at = to;
  });
  text += value.slice(at, start + source.length);
  const placed = { count: 0 };
  const nodes = (markdown.parse(text).content ?? []).map((node) =>
    restoreAtoms(node, atoms, placed),
  );
  if (placed.count !== atoms.length) return null;
  try {
    descriptionSchema.nodeFromJSON({ type: 'doc', content: nodes }).check();
  } catch {
    return null;
  }
  // Definitions elsewhere in the description decide what reference-like text means.
  const written = markdown.serialize({ type: 'doc', content: nodes });
  const reparsed = (
    syntaxTree(context ? written + '\n\n' + context : written).children ?? []
  ).filter((node) => !DEFINITIONS[node.type]);
  return semantic([block]) === semantic(reparsed) ? nodes : null;
}
const serializeNode = (node: JSONContent) => markdown.serialize({ type: 'doc', content: [node] });

/** Splits stored Markdown into editor blocks; anything the editor would change stays read-only. */
export function loadDescription(value: string): LoadedDescription {
  const children = syntaxTree(value).children ?? [];
  if (!children.length) return EMPTY_DOCUMENT;
  const starts = children.map((child) => lineStart(value, offset(child, 'start')));
  const context = children
    .filter((child) => DEFINITIONS[child.type])
    .map((child) => value.slice(offset(child, 'start'), offset(child, 'end')))
    .join('\n\n');
  const content: JSONContent[] = [];
  const blocks = children.map((child, index): BaselineBlock => {
    const chunk = value.slice(starts[index], starts[index + 1] ?? value.length);
    const source = chunk.replace(/\r?\n[ \t\r\n]*$/, '');
    const nodes = (
      editableNodes(child, value, starts[index], source, context) ?? [
        { type: PRESERVED_BLOCK, attrs: { markdown: source } },
      ]
    ).map((node) => descriptionSchema.nodeFromJSON(node).toJSON() as JSONContent);
    content.push(...nodes);
    return { source, gap: chunk.slice(source.length), keys: nodes.map(serializeNode) };
  });
  return { doc: { type: 'doc', content }, baseline: { prefix: value.slice(0, starts[0]), blocks } };
}

const keys = new WeakMap<ProseMirrorNode, string>();
function nodeKey(node: ProseMirrorNode) {
  let key = keys.get(node);
  if (key === undefined) {
    key = serializeNode(node.toJSON());
    keys.set(node, key);
  }
  return key;
}
// Longest common subsequence of block Markdown; match[j] is the original index of current j.
function matchBlocks(before: readonly string[], after: readonly string[]) {
  const match = Array.from({ length: after.length }, () => -1);
  let head = 0,
    tail = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) {
    match[head] = head;
    head++;
  }
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    match[after.length - 1 - tail] = before.length - 1 - tail;
    tail++;
  }
  const rows = before.length - head - tail,
    columns = after.length - head - tail;
  // A huge rewrite (e.g. a pasted document) is simply written as new Markdown.
  if (!rows || !columns || rows * columns > 1_000_000) return match;
  const width = columns + 1,
    table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--)
    for (let j = columns - 1; j >= 0; j--)
      table[i * width + j] =
        before[head + i] === after[head + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  for (let i = 0, j = 0; i < rows && j < columns;) {
    if (before[head + i] === after[head + j]) match[head + j++] = head + i++;
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return match;
}

/** An original block written verbatim, or Markdown serialized from edited nodes. */
type Piece = { block: number } | { text: string };
/** Markdown for the edited document: unchanged original blocks keep their exact bytes. */
export function saveDescription(baseline: DescriptionBaseline, doc: ProseMirrorNode): string {
  const nodes: ProseMirrorNode[] = [];
  doc.forEach((node) => nodes.push(node));
  const original = baseline.blocks.flatMap((block, index) =>
    block.keys.map((key, part) => ({ key, index, part })),
  );
  const match = matchBlocks(
    original.map((entry) => entry.key),
    nodes.map(nodeKey),
  );
  const pieces: Piece[] = [];
  let run: ProseMirrorNode[] = [];
  const flush = () => {
    // One edited node (the typing case) reuses the Markdown already computed for matching.
    const written =
      run.length === 1
        ? nodeKey(run[0])
        : markdown.serialize({ type: 'doc', content: run.map((node) => node.toJSON()) });
    const text = written.replace(/^\n+|\n+$/g, '');
    if (text.trim()) pieces.push({ text });
    run = [];
  };
  for (let j = 0; j < nodes.length;) {
    const entry = original[match[j]];
    const size = entry ? baseline.blocks[entry.index].keys.length : 0;
    if (
      entry?.part === 0 &&
      Array.from({ length: size }, (_, k) => match[j + k] === match[j] + k).every(Boolean)
    ) {
      if (run.length) flush();
      pieces.push({ block: entry.index });
      j += size;
    } else run.push(nodes[j++]);
  }
  if (run.length) flush();
  if (!pieces.length) return '';
  const textOf = (piece: Piece) =>
    'block' in piece ? baseline.blocks[piece.block].source : piece.text;
  let result = baseline.prefix;
  pieces.forEach((piece, index) => {
    result += textOf(piece);
    const next = pieces[index + 1];
    if (!next) return;
    const before = 'block' in piece ? piece.block : 'block' in next ? next.block - 1 : -1;
    // The last block's gap is the description's trailing whitespace, not a separator.
    const gap = (before < baseline.blocks.length - 1 && baseline.blocks[before]?.gap) || '\n\n';
    const adjacent = 'block' in piece && 'block' in next && next.block === piece.block + 1;
    // An original gap without a blank line is reused only while both sides stay separate blocks.
    result +=
      adjacent || /\n[ \t]*\r?\n/.test(gap) || separates(textOf(piece), gap, textOf(next))
        ? gap
        : '\n\n';
  });
  return result + (baseline.blocks.at(-1)?.gap ?? '');
}
// Whether `second` still starts a new block after `first` + `gap`. Only its first line can
// continue a block of `first`; once that line opens a new block, the rest parses the same.
function separates(first: string, gap: string, second: string) {
  const start = second.split('\n', 1)[0];
  const parts = [first, start].flatMap((part) => syntaxTree(part).children ?? []);
  return semantic(syntaxTree(first + gap + start).children ?? []) === semantic(parts);
}
