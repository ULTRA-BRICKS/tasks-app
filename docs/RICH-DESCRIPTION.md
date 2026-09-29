# Rich task descriptions over lossless Markdown

User requirement (UB-75, 29 September 2026): the production task 53e322fa-26b4-4793-a341-2e76037483e2 (UB-35) opened as raw Markdown in a textarea under the notice "This description contains extended Markdown. Source editing preserves every element." The user rejected it ("Так не надо! Поправь."). Every description must open in the one rich-text surface required by the page-first contract in AGENTS.md; there are no Preview/Markdown tabs and no whole-description source mode.

## Root cause

`RichDescription` switched the whole description to a source textarea whenever a regular expression found `<!--`, anything shaped like an HTML tag, a footnote or a reference definition. The regex also matched Linear-style link destinations such as `[label](<https://…>)`, so UB-35 fell back because of one ordinary link. On the 1,791 production descriptions read on 29 September, 656 (39%) fell back: 537 because of `](<…>)` links, 176 because of text such as `<CODE>` or `<Routes>`, 13 because of comments and 2 because of footnotes.

## Design

Storage stays Markdown. The editor stays Tiptap 3.30.3 with the same extensions; the change is how a Markdown string becomes a document and back.

1. **Block segmentation.** `micromark` with GFM (the parser the server already uses for Linear source comparison) splits the stored Markdown into top-level blocks. Each block keeps its exact source bytes and the exact whitespace that follows it.
2. **Per-block verification.** Each block is parsed by Tiptap and serialized again. The block is rich-editable only when the reserialized Markdown has the same CommonMark/GFM syntax tree as the original (positions and list looseness ignored, exactly as the server's `markdownEquivalent` does), and the Tiptap document passes the schema check.
3. **Read-only elements instead of source mode.** An element the editor cannot represent is kept as an atom that renders its original Markdown as text and serializes it byte-for-byte:
   - inline: raw HTML text (`<CODE>`, `<Routes>`, `<!-- … -->`, `<issue id="…" />`), footnote references and reference-style links/images keep the surrounding paragraph, list item or table editable;
   - block: HTML blocks, reference and footnote definitions, and any block whose Tiptap round trip changes meaning (for example a link whose text is inline code, which Tiptap's schema cannot hold).
     A read-only element is selectable and deletable as a whole; its text cannot be edited in place. Raw HTML is never rendered as HTML.
4. **Byte-preserving save.** On every edit the current top-level nodes are matched to the original blocks (longest common subsequence over their serialized Markdown). An original block that is still present unchanged is written with its original bytes and original following whitespace; only edited, added or moved blocks use Tiptap's serializer. Opening a description and leaving it unchanged never writes anything; editing one paragraph leaves every other block byte-identical.
5. **Task lists.** GFM task items render as labelled checkboxes. Toggling one saves immediately (the same commit path as blur), so the change survives a reload without another click.

Two small schema adjustments make Linear-imported bodies round-trip: images are inline nodes inside paragraphs (a Markdown image is inline; the previous block image merged "caption:\n\n![image](…)" list items into one paragraph), and a paragraph whose text starts with `#` is written as `\#` so it cannot turn into a heading. Images still render as a link with the alt text; external images are not loaded.

## Supported constructs

Rich and editable: paragraphs, ATX and setext headings (saved as ATX when edited), bold, italic, strikethrough, inline code, links (including `<…>` destinations and autolinks), images/attachments (shown as links), bullet, ordered and nested lists, GFM task lists, blockquotes, fenced and indented code, horizontal rules, hard breaks and GFM tables.

Read-only inside the rich surface: raw HTML, reference definitions and reference-style links/images, footnotes and footnote definitions, and any block the verification in step 2 rejects.

Measured on the same production snapshot (1,673 non-empty descriptions, including UB-35) with the final code, outside Git because workspace bodies are not test fixtures: every description saves back byte-identical when unchanged; appending text to the first plain paragraph of each of the 1,623 descriptions that have one changes only that paragraph and keeps every other block byte-identical. 1,610 descriptions (96%) have no read-only block and 1,514 (90%) have no read-only element at all; 68 of 17,314 blocks (0.4%) are read-only, and the rest of those descriptions remains rich.

## Acceptance → tests

| Acceptance                                                                                  | Test                                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| UB-35-shaped and Linear-shaped bodies load as rich blocks; unchanged save is byte-identical | `tests/unit/description-markdown.test.ts`                                      |
| Editing one block leaves every other block byte-identical; checkbox toggle changes one line | `tests/unit/description-markdown.test.ts`                                      |
| Unsupported constructs become read-only atoms that keep their exact bytes                   | `tests/unit/description-markdown.test.ts`                                      |
| Task page shows headings and checkboxes, no textarea, no notice                             | `tests/e2e/inline.spec.ts` "structured descriptions open in the rich editor …" |
| Toggling a checkbox persists after reload; editing a heading saves                          | `tests/e2e/inline.spec.ts`                                                     |
| Title-only edits, Escape and the command menu keep extended Markdown unchanged              | existing `tests/e2e/inline.spec.ts` cases, now asserting the rich surface      |
| Storybook: rich surface, read-only elements, Escape, checkbox toggle commits                | `src/shared/ui/document/document.stories.tsx` `StructuredMarkdown`             |
| A 120,000-character body with a comment opens rich, stays editable, survives a reload       | `tests/e2e/knowledge-performance.spec.ts`                                      |

Visual proof: desktop 1440×900 Chromium and phone 390×844 WebKit and Chromium, at rest and while editing, stored with the UB-75 evidence outside Git.

## Notes

- **Bundle.** No new package is downloaded: `mdast-util-from-markdown`, `micromark-extension-gfm` and `mdast-util-gfm` already ship with `react-markdown`/`remark-gfm`, and `@tiptap/extension-paragraph` is the same 3.30.3 build StarterKit already bundles (now a direct dependency because the paragraph is extended). The editor chunk stays lazy.
- **Accessibility.** The description stays one `textbox` named Description. Checkboxes are named by their task text. Read-only elements are `contenteditable=false`, show their Markdown as text and carry the title "Read-only Markdown, kept exactly as written".
- **Separators.** An original gap without a blank line (for example `## Deploy\nDeployed: no`) is kept next to an edited block only when the first line of the following block still starts a new block; otherwise a blank line is written.
- **Large bodies.** Opening a 120,000-character description (the knowledge performance fixture) parses once in about 0.4–0.8 s; typing into its one large paragraph re-serializes only that paragraph (about 60 ms in Bun).
- **Serialization.** Unchanged blocks keep their bytes. An edited block uses Tiptap's Markdown output, so its own formatting can normalize (for example `*` bullets become `-`, a setext heading becomes ATX, a loose list becomes tight); its meaning is unchanged. Blocks are matched by their serialized Markdown, so when two blocks that serialize the same (for example `* item` and `- item`) swap places, each keeps its meaning but may take the other's original formatting.
- **Removed.** The source textarea (`SourceEditor`), its notice and the `maxLength`/`descriptionMaxLength` props that only that textarea enforced. Knowledge documents keep their size check on save (`src/pages/knowledge/model.ts`: 500,000 characters for documents, 100,000 otherwise, text retained with an error), and the API rejects request bodies above 1 MiB (`BODY_TOO_LARGE`). Issue descriptions never had a client-side limit.

## Rejected alternatives

- Enabling rich editing everywhere and trusting Tiptap's serializer: it rewrites `\##` into a heading, drops raw HTML and merges image list items, so it is not lossless.
- A second source/preview toggle: contradicts the page-first contract and the user's request.
- Replacing Tiptap: the existing extension set covers the content once unsupported elements are atoms; a new editor would change bundle, accessibility and serialization without need.

## Out of scope

Rich editing of footnotes, raw HTML and reference-style links; exact preservation of formatting inside an edited block; server-side length limits.
