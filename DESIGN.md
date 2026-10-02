---
name: Tickets
version: alpha
description: Compact, keyboard-first issue tracking. Calm surfaces; explicit state and recovery.
---

# Tickets design system

## Overview

An independent Linear-inspired interface, not Linear branding or copied product assets. Optimize for repeatedly finding, inspecting and changing work rather than decorating a dashboard. Keep the task title dominant, metadata quiet but readable, and the selected state unmistakable. Dark and light themes share geometry.

The document follows Google Labs' [DESIGN.md](https://github.com/google-labs-code/design.md) idea of persistent design context plus rationale. Its numeric source is deliberately **not duplicated in YAML**: [DTCG JSON](tokens/tickets.tokens.json) is authoritative. This is not a claim of conformance to Google's entire alpha schema.

## Colors

Use generated semantic variables: `--color-canvas`, `--color-sidebar`, `--color-panel`, `--color-elevated`, `--color-hover`, `--color-selected`, `--color-border`, `--color-text`, `--color-muted`, and `--color-accent`. The violet accent denotes action/selection, not arbitrary decoration. Status, priority and user-defined label colors are additional information, never the sole state indicator.

Identifiers and dates are readable text: use `--color-muted`, **not** `--color-subtle`. The initial Storybook axe run caught insufficient contrast in the latter, especially over selected rows. Preserve a minimum 4.5:1 contrast for ordinary text on its actual surface, including hover and selection. Do not disable the contrast rule to make the tests green. User-defined colors need independent future contrast policy; a passing fixed fixture does not certify every possible user color.

## Typography

`font.family` prefers Inter with a system sans-serif fallback; identifiers use `font.mono`. No font binaries are bundled. Use the generated `font.size`, `font.weight` and `font.line` scales. Rows use compact body text; Markdown content uses a more readable line height. Truncate titles in lists, but show the full title in detail. Long URLs and unbroken text must not widen the viewport.

## Layout

The tokenized desktop shell has a 244 px sidebar, 46 px toolbar, 42 px rows and 32 px controls. Touch-oriented controls target 44 px. Spacing uses `space.*`; avoid inventing a new spacing scale inside a feature. The board scrolls horizontally inside its own region; the page itself should not overflow horizontally.

On narrow screens, navigation becomes an accessible modal, dense metadata can be omitted from rows, and issue properties stack with content. The desktop issue rail is not squeezed into a 393 px viewport. Stable deep links, URL filters and browser Back must remain usable.

## Elevation & Depth

Prefer flat surfaces separated by quiet borders. Cards on the board have one shallow elevation level. Popovers, command menu and dialogs must sit above content with restrained backdrop treatment. Avoid nested decorative cards, large gradients and excessive shadows.

## Shapes

Use the generated 4/6/8/12 px radius scale; pill shapes are reserved for labels/avatars. Icons normally use the 16 px token. Keep icon-only actions named for assistive technology, not merely titled on hover.

## Components

Own Base UI wrappers in `src/shared/ui`; compose them in features and widgets rather than copying them. Every component has a disabled/pending treatment. Status pickers expose a combobox name. Dialogs have a title, initial focus, Escape handling and focus restoration; destructive actions require explicit confirmation. Command shortcuts must not steal keystrokes from inputs/editors.

New issues, projects and cycles open directly as shared inline document pages. A private new draft publishes only on Create; existing fields commit in place without a global edit form. Title Enter commits and Escape cancels; rich/source descriptions keep newlines and support Escape/IME. All field hit areas expand around resting text without moving its baseline.

Issue rows expose a separate selection checkbox and open action. Drag-and-drop is an enhancement: status changes remain available without dragging. Preserve the user's unsaved Markdown across server refreshes; clean forms may refresh, dirty forms must never be silently overwritten. A conflict response displays the current server version and keeps the draft.

Markdown is stored as GFM. The editable document uses Tiptap with Markdown serialization; unsupported HTML, footnotes and reference definitions use source editing to avoid loss. Read-only Markdown previews never execute raw HTML. Task checkboxes expose their own task text and do not absorb nested task names. Remote images are links rather than automatically loaded tracking requests. Empty, loading, failure and permission-denied states must offer a meaningful next action, not a blank panel.

## Do's and Don'ts

Use `bun run tokens:build` after changing DTCG JSON, and commit all generated CSS/TypeScript/reference changes together. `bun run tokens:check` rejects drift. Supported token types include sRGB colors, dimensions, duration, font family/weight, numbers and cubic-bezier curves, plus same-type aliases and cycle detection; unsupported formats fail rather than being silently coerced.

Run Storybook interactions/axe and Playwright separately. A successful screenshot capture is not a regression test. Inspect new images and their exact source commit before approving baselines. Normal CI compares existing images and never updates them. Screenshots in [docs/screenshots](docs/screenshots) come from the running React application with synthetic demo data, not static design mockups.

Keep layout styles in the app stylesheet and reusable primitives. Never edit generated token files by hand, introduce a second server-state store, hide a failure behind a success toast, or claim pixel-perfect Linear parity.

## Measured document geometry

`document.*` DTCG tokens calibrate the desktop document against the public Linear issue demo at 1440×1000 / DPR 1. Transparent borders were removed from resting fields so their width no longer adds a hidden 1 px text inset; focus uses a paint-only outline/inset shadow. A separate document minimum keeps the action rhythm stable when the body is short. Responsive breakpoints still replace desktop gutters rather than squeezing a desktop rail.

The repo publishes native-coordinate 50% overlays and a 4× absolute-difference crop, not a made-up similarity score. System font rendering is an explicit remaining difference: no external font tracking requests or font binaries are introduced merely to make screenshots match.
