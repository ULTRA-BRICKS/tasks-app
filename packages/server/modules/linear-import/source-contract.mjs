import { parseMarkdown } from '../../../generated/server-markdown.mjs';
import { assert } from '../../core/errors.mjs';
import { canonical, digest } from '../../../imports/linear-source.mjs';
function normalizedUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'uploads.linear.app') {
      url.searchParams.delete('signature');
      return url.href;
    }
  } catch {}
  return value;
}
function semanticNode(value, depth = 0) {
  assert(depth <= 128, 422, 'MARKDOWN_TOO_DEEP', 'Markdown nesting exceeds the comparison budget');
  if (Array.isArray(value)) return value.map((item) => semanticNode(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['position', 'spread'].includes(key))
        .map(([key, item]) => [
          key,
          key === 'url' ? normalizedUrl(item) : semanticNode(item, depth + 1),
        ]),
    );
  return value;
}
export function markdownEquivalent(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 128000 || b.length > 128000)
    return false;
  return canonical(semanticNode(parseMarkdown(a))) === canonical(semanticNode(parseMarkdown(b)));
}
export function linearIssueUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    assert(false, 422, 'INVALID_SOURCE_URL', 'A valid HTTPS Linear issue URL is required');
  }
  assert(
    parsed.protocol === 'https:' &&
      parsed.hostname === 'linear.app' &&
      !parsed.username &&
      !parsed.password,
    422,
    'INVALID_SOURCE_URL',
    'Expected an HTTPS Linear issue URL',
  );
  return parsed.href;
}
export function sourceIdentifier(record, requireNumber = false) {
  assert(
    typeof record.identifier === 'string' &&
      /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/.test(record.identifier),
    422,
    'INVALID_SOURCE_NUMBER',
    'Invalid source issue identifier',
  );
  if (requireNumber || record.number !== undefined)
    assert(
      Number.isInteger(record.number) &&
        record.number > 0 &&
        record.number < 2147483647 &&
        Number(record.identifier.split('-').at(-1)) === record.number,
      422,
      'INVALID_SOURCE_NUMBER',
      'Source issue number must fit PostgreSQL and match its identifier',
    );
}

export const sourceMarkdownHash = (value) => digest(semanticNode(parseMarkdown(value)));
