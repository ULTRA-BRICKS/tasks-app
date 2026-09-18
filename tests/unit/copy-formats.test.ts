import { test, expect } from 'bun:test';
import { buildCopyValues } from '../../src/shared/lib/copy-formats';
test('copy formats preserve raw Markdown, Unicode and the canonical item link', () => {
  const values = buildCopyValues(
    {
      id: 'item-id',
      key: 'GL-42',
      title: 'Задача [review]',
      body: '## Heading\n\n**Keep** this → text',
      path: '/issues/item-id',
      kind: 'issue',
    },
    'https://tasks.example.test',
  );
  expect(values.id).toBe('GL-42');
  expect(values.link).toBe('https://tasks.example.test/issues/item-id');
  expect(values.markdown).toContain('## Heading\n\n**Keep** this → text');
  expect(values.linkedTitle).toBe(
    '[GL-42 Задача \\[review\\]](https://tasks.example.test/issues/item-id)',
  );
  expect(values.prompt).toContain('## Heading');
  expect(values.branch).toBe('gl-42/review');
});
test('navigation query strings do not masquerade as team or view identifiers', () => {
  const value = buildCopyValues(
    { id: 'team-uuid', title: 'Team', path: '/issues?team_id=team-uuid', kind: 'team' },
    'https://tasks.example.test',
  );
  expect(value.id).toBe('team-uuid');
  expect(value.link).toContain('?team_id=team-uuid');
});
test('branch labels cannot inject path traversal, Git ref punctuation or whitespace', () => {
  const value = buildCopyValues(
    { key: 'GL-2', title: '../bad.lock / name~^: test', path: '/issues/2' },
    'https://tasks.example.test',
  );
  expect(value.branch).toBe('gl-2/bad-lock-name-test');
  expect(value.branch).not.toContain('..');
  expect(value.branch).not.toContain(' ');
});
