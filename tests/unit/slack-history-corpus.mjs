// Redacted observed Slack notifications, used as test data only.
//
// Provenance: the controller read these from the existing integration channel on 14 October 2026.
// They were posted there by the Linear integration. The workspace and its contents are private, so
// every title, person, team, project, label value, workspace ID and link below has been REPLACED.
// The message syntax and layout were preserved. These are redacted observed messages, not verbatim
// originals and not synthetic inventions. Never replay them into a real channel.
// `observed` keeps the redacted Linear layout for comparison. `expected` is written by hand for
// Tasks and is checked independently of the renderer.
export const provenance = Object.freeze({
  source: 'redacted observed messages, integration channel, 2026-10-14',
  redacted: ['titles', 'people', 'teams', 'projects', 'labels', 'workspace ids', 'links', 'bodies'],
});

export const observedCreated = {
  case: 'created EX-329 (Slack ts redacted)',
  observed: {
    header: '*Taylor* created an issue in the <https://example.test/team/EX/all|Team One> team',
    attachmentTitle: 'EX-329 Review worker safety',
    bodyHeadings: [
      'What',
      'Why (motivation)',
      'User impact',
      'Cost of inaction',
      'Acceptance criteria',
      'Screenshots',
      'Deploy',
      'Links',
      'Skipped gates',
    ],
    footer: { State: 'Todo', Labels: 'session:example-1' },
    actions: ['Subscribe'],
  },
  // Same body shape: Markdown headings, bullets and links.
  description: [
    '## What',
    'Stop the worker from removing busy runners.',
    '## Why (motivation)',
    '- Jobs fail in the middle of a step',
    '- Retries cost **time**',
    '## User impact',
    'Builds stop without a reason.',
    '## Cost of inaction',
    'More failed builds.',
    '## Acceptance criteria',
    '- [ ] Busy runners survive scale-down',
    '## Screenshots',
    'None.',
    '## Deploy',
    'Normal release.',
    '## Links',
    '- [Runbook](https://example.test/runbook)',
    '## Skipped gates',
    'None.',
  ].join('\n'),
  expected: {
    headings: [
      '\u200b*What*\u200b',
      '\u200b*Why (motivation)*\u200b',
      '\u200b*User impact*\u200b',
      '\u200b*Cost of inaction*\u200b',
      '\u200b*Acceptance criteria*\u200b',
      '\u200b*Screenshots*\u200b',
      '\u200b*Deploy*\u200b',
      '\u200b*Links*\u200b',
      '\u200b*Skipped gates*\u200b',
    ],
    bullets: ['• Jobs fail in the middle of a step', '• Retries cost *time*'],
    // A user link is readable text, never Slack link markup.
    link: '• Runbook (https://example.test/runbook)',
  },
};

// A second creation showed four label names and "and 1 more".
export const observedCreatedLabels = {
  case: 'created EX-1692 label overflow',
  observed: { Labels: 'label-1, label-2, label-3, label-4 and 1 more' },
  labels: ['label-a', 'label-b', 'label-c', 'label-d', 'label-e'],
  expected: 'label-a, label-b, label-c, label-d and 1 more',
};

export const observedStatus = [
  {
    case: 'status Done with priority and project (EX-269)',
    observed:
      ':white_check_mark:  *Taylor* changed issue status to *Done* in <https://example.test/team/EX/all|Team One> team',
    fields: { Priority: 'Medium', Project: 'Project Alpha' },
  },
  {
    case: 'status Done with priority, no project (EX-234)',
    observed:
      ':white_check_mark:  *Taylor* changed issue status to *Done* in <https://example.test/team/EX/all|Team One> team',
    fields: { Priority: 'High' },
  },
  {
    case: 'status In Progress without optional fields (EX-325)',
    observed:
      '*Taylor* changed issue status to *In Progress* in <https://example.test/team/EX/all|Team One> team',
    fields: {},
  },
];

export const observedComments = [
  {
    case: 'comment EX-326, a new channel message, not a thread reply',
    observed:
      '*Taylor* commented on <https://example.test/issue/EX-326/slug#comment-0000|EX-326 Example comment target>',
    body: 'Confirmed on the second runner.',
    expected: 'Confirmed on the second runner.',
  },
  {
    case: 'long comment EX-301 with headings, bullets, code, escapes and links',
    observed: 'zero-width wrapped *Causes*/*Change*/*CI*/*Open* headings',
    body: [
      '## Causes',
      '- The timer fires before `idle_check` returns',
      '- Limit was < 5 and ≤ 10 in practice',
      '## Change',
      '- Edited `src/worker/scale.ts`',
      '## CI',
      'See [run 42](https://example.test/ci/42).',
      '## Open',
      '- A & B remain',
    ].join('\n'),
    expected: [
      '\u200b*Causes*\u200b',
      '• The timer fires before `idle_check` returns',
      '• Limit was &lt; 5 and ≤ 10 in practice',
      '\u200b*Change*\u200b',
      '• Edited `src/worker/scale.ts`',
      '\u200b*CI*\u200b',
      'See run 42 (https://example.test/ci/42).',
      '\u200b*Open*\u200b',
      '• A &amp; B remain',
    ].join('\n'),
  },
  {
    case: 'comment EX-1507 with nested markup shown escaped',
    observed: '&lt;scr&lt;script&gt;ipt&gt;',
    body: 'Sanitizer input <scr<script>ipt> stays inert.',
    expected: 'Sanitizer input &lt;scr&lt;script&gt;ipt&gt; stays inert.',
  },
];
