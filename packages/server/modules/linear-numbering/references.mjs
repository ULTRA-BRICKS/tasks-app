import { parseMarkdown } from '../../../generated/server-markdown.mjs';
const CODES = /\b[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*\b/g;
// Each match is evaluated against the ORIGINAL document and emitted once: swaps never cascade.
export function planReferenceEdits(
  text,
  {
    mappings,
    origin = 'mixed',
    appOrigin = 'https://tasks-ultrabricks.vercel.app',
    decisions = {},
  } = {},
) {
  const byId = new Map(mappings.map((r) => [r.id, r])),
    byOld = new Map(mappings.map((r) => [r.oldCode, r])),
    bySourceId = new Map(mappings.map((r) => [r.sourceId, r])),
    byNew = new Map(mappings.map((r) => [r.newCode, r]));
  const ranges = [];
  const visit = (node) => {
    const start = node.position?.start?.offset,
      end = node.position?.end?.offset;
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      ['link', 'image', 'inlineCode', 'code', 'html'].includes(node.type)
    )
      ranges.push({ start, end, node });
    for (const child of node.children ?? []) visit(child);
  };
  visit(parseMarkdown(text));
  const edits = [],
    ambiguous = [];
  for (const range of ranges) {
    if (!['link', 'image'].includes(range.node.type)) continue;
    try {
      const url = new URL(range.node.url, appOrigin),
        value = /^\/issues\/([^/?#]+)$/.exec(url.pathname)?.[1];
      const target = url.origin === appOrigin ? byOld.get(value) : null;
      if (!target) continue;
      const local = text.slice(range.start, range.end),
        offset = local.indexOf(
          range.node.url,
          (range.node.children?.at(-1)?.position?.end?.offset ?? range.start) - range.start,
        );
      if (offset < 0) {
        ambiguous.push({
          start: range.start,
          end: range.end,
          code: value,
          reason: 'escaped-url-needs-review',
        });
        continue;
      }
      url.pathname = '/issues/' + target.id;
      const replacement = range.node.url.startsWith('/')
        ? url.pathname + url.search + url.hash
        : url.href;
      edits.push({
        start: range.start + offset,
        end: range.start + offset + range.node.url.length,
        before: range.node.url,
        after: replacement,
        targetId: target.id,
        reason: 'native-key-url-to-stable-uuid',
      });
    } catch {}
  }
  for (const match of text.matchAll(CODES)) {
    const code = match[0],
      start = match.index,
      end = start + code.length,
      old = byOld.get(code),
      current = byNew.get(code);
    if (!old || old.newCode === code) continue;
    const decision = decisions[String(start)];
    if (decision && typeof decision === 'object') {
      if (typeof decision.evidence !== 'string' || decision.evidence.trim().length < 8) {
        ambiguous.push({ start, end, code, reason: 'decision-evidence-missing' });
        continue;
      }
      if (decision.target_id === null) continue;
      const chosen = byId.get(decision.target_id);
      if (!chosen || ![chosen.oldCode, chosen.newCode].includes(code)) {
        ambiguous.push({ start, end, code, reason: 'invalid-decision' });
        continue;
      }
      if (chosen.newCode !== code)
        edits.push({
          start,
          end,
          before: code,
          after: chosen.newCode,
          targetId: chosen.id,
          reason: 'explicit-identity-decision',
          evidence: decision.evidence,
        });
      continue;
    }
    const range = ranges.find((r) => r.start <= start && end <= r.end);
    let intended = null,
      reason = null;
    if (range?.node.type === 'link' || range?.node.type === 'image') {
      const node = range.node,
        labelStart = node.children?.[0]?.position?.start?.offset,
        labelEnd = node.children?.at(-1)?.position?.end?.offset;
      if (!Number.isInteger(labelStart) || start < labelStart || end > labelEnd) {
        try {
          const url = new URL(node.url, appOrigin);
          const nativeSafe = url.origin === appOrigin && /^\/issues\/[^/]+$/.test(url.pathname);
          const sourceSafe =
            url.protocol === 'https:' &&
            url.hostname === 'linear.app' &&
            /\/issue\/[^/]+/.test(url.pathname);
          if (!nativeSafe && !sourceSafe)
            ambiguous.push({ start, end, code, reason: 'unverified-code-url' });
        } catch {
          ambiguous.push({ start, end, code, reason: 'unverified-code-url' });
        }
        continue;
      }
      try {
        const url = new URL(node.url, appOrigin);
        if (url.origin === appOrigin) {
          const id = /^\/issues\/([^/?#]+)$/.exec(url.pathname)?.[1];
          intended = byId.get(id) ?? byOld.get(id);
          reason = 'native-uuid-link';
        } else if (url.protocol === 'https:' && url.hostname === 'linear.app') {
          const identity = /\/issue\/([^/]+)/.exec(url.pathname)?.[1];
          intended = bySourceId.get(identity) ?? byNew.get(identity);
          reason = 'linear-source-link';
        }
      } catch {}
      if (intended) {
        if (code !== intended.oldCode && code !== intended.newCode) {
          ambiguous.push({
            start,
            end,
            code,
            reason: 'label-and-link-disagree',
            targetId: intended.id,
          });
          continue;
        }
      } else {
        ambiguous.push({ start, end, code, reason: 'unknown-link-destination' });
        continue;
      }
    } else if (range) {
      if (origin === 'linear') continue;
      ambiguous.push({ start, end, code, reason: 'executable-or-literal-context' });
      continue;
    }
    if (!intended) {
      if (origin === 'tasks') {
        intended = old;
        reason = 'verified-native-origin';
      } else if (origin === 'linear') {
        continue;
      } else if (!current) {
        intended = old;
        reason = 'unambiguous-code';
      } else {
        ambiguous.push({
          start,
          end,
          code,
          reason: 'mixed-namespace',
          nativeTarget: old.id,
          linearTarget: current.id,
        });
        continue;
      }
    }
    if (intended.newCode !== code)
      edits.push({
        start,
        end,
        before: code,
        after: intended.newCode,
        targetId: intended.id,
        reason,
      });
  }
  edits.sort((a, b) => a.start - b.start);
  let output = '',
    last = 0;
  for (const edit of edits) {
    output += text.slice(last, edit.start) + edit.after;
    last = edit.end;
  }
  output += text.slice(last);
  return { text: output, edits, ambiguous };
}
