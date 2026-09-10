# Linear references and tickets-app interaction contract

Observed: 2026-09-10. Status: design requirements and public-source research, **not a completed UI rewrite**. Source inspected: tickets-app main `58f2425cae7b635548d781719d14d140e0f35e11`.

## User requirement

> «Никаких форм не должно быть: ты просто сразу попадаешь на страницу тикета, но поля пустые, имеют плейсхолдеры и редактируются инлайн. Везде должен быть такой подход».

Spelling and punctuation normalized; intended scope retained. This requirement supersedes the older creation dialog and global Save/Preview/Markdown patterns. It is a product decision, not a claim that every Linear interaction is identical.

## Primary references

| Source | What it establishes | How we use it |
| --- | --- | --- |
| [Create issues](https://linear.app/docs/creating-issues) | Linear documents both a modal (`C`) and fullscreen creation (`V`), plus draft behavior. | Choose fullscreen/page-first as our default. Do not copy the modal just because it is the first public screenshot. |
| [Edit issues](https://linear.app/docs/editing-issues) | Title and description are edited directly by clicking them. | No separate edit form or navigation away from the object. |
| [Inline editing announcement](https://linear.app/changelog/2022-06-09-inline-editing) | Historical primary evidence of inline editing, automatic saving and fullscreen creation. | Corroboration of the interaction model, not evidence of 2026 pixel geometry. |
| [Editor](https://linear.app/docs/editor) | A rich editor with Markdown and keyboard workflows. | One document surface, contextual formatting, predictable text editing. |
| [Documents](https://linear.app/docs/documents) | Projects share the issue editor and document bodies edit in place. | Shared editor primitives rather than one CRUD form per entity. |
| [Labels](https://linear.app/docs/labels) | Labels are contextual issue properties with a compact picker. | Click the current value or placeholder to change it. |

### Public visual reference: editor surface

![Official Linear editor reference; this is not a tickets-app screenshot](https://webassets.linear.app/images/ornj730p/production/7e24eaf2c9e80406b3fc082445476c0a04a16b03-2160x1327.png?auto=format&dpr=2&q=95&w=1440)

Source: Linear's Editor documentation. The public image shows text-first editing and compact property controls. Its presentation background is not an application surface to copy. The screenshot's product version is not independently dated.

The public creation image was also inspected: its title and body are visually plain text, not conventional boxed inputs; properties are compact controls. Public docs explicitly establish fullscreen creation, but a current authenticated fullscreen creation session has **not** been inspected. Do not claim 1:1 reproduction or measured pixel values from it. External product images remain reference links; no third-party fonts, assets or private workspace data were copied into the app.

## Current implementation gaps

| Current code | Problem | Required replacement |
| --- | --- | --- |
| `src/app/main.tsx` | `createOpen` opens a modal; no explicit draft-page route. | A dedicated new-object route in the normal workspace shell. |
| `src/features/issue-create/ui.tsx` | Standalone `Modal` and `form`, visually boxed title/body, separate component from detail. | Empty instance of the shared entity editor. |
| `src/widgets/issue-details/ui.tsx` | Permanent input presentation, Preview/Markdown switch, global Save bar. | Text-like resting state, click-in-place edit and field-level committed saves. |
| Existing visual baselines | Approve what was implemented, not likeness to Linear. | Inspect new captures against references before deliberate baseline changes. |

## Target contract

`/issues/new` and `/issues/:id` share a document surface: toolbar/breadcrumb, title, description, property rail (stacked on mobile), contextual related content. Title and body placeholders occupy the final text positions. No create form first and "real ticket" page second. Project/parent defaults travel as structured state or validated IDs; private content does not travel in URLs.

A new object is a draft until deliberately created. Opening and leaving an empty page must not publish a ticket. Keep a compact Create action in the page toolbar, not a form footer. Repeated activation/network uncertainty must not create duplicates; retries reuse the same idempotent payload. On success replace the route with the durable object ID without remounting or losing in-flight text.

Existing objects save committed field edits in place. Preserve drafts on errors and conflicts; do not silently overwrite. Cancel affects the active field, not unrelated edits. Property controls stay compact and keyboard-operable. The document body should support rich editing with Markdown round trips; replacing a textarea border alone is not implementation of this contract.

Apply this model to issues, epics, projects, cycles, milestones, labels and saved views. Authentication, secrets and destructive confirmation are separate interaction categories, not reasons to reintroduce entity creation forms.

## Required evidence before calling the rewrite complete

Browser tests must cover new and existing entities, draft navigation/recovery, errors/conflicts, repeat clicks, permissions, IME, focus restoration, narrow screens and related-object defaults. Include at least one project and cycle workflow before claiming "everywhere". Compare screenshots of the same state and viewport; old green baselines cannot establish fidelity. Keep any unmet requirement visible in the PR and verification report.

## Skills evaluated

[Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), blob `a5333457c414d20d625f307df945842c0952ecc3`, and [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines), blob `ceae92ab319216a68274168fba9b63b998b65997`, were read on the observation date. The former is useful for intentional visual design; the latter for interaction/accessibility review. Neither contains our specific page-first product requirement. Use the original repository-specific [reference-led-product-ui skill](../skills/reference-led-product-ui/SKILL.md) to bind references and acceptance criteria to this app. Upstream skill files have not been vendored or silently installed.
