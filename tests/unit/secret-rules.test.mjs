import { test, expect } from 'bun:test';
import { forbiddenTrackedPaths } from '../../scripts/secret-rules.mjs';
test('forced tracking cannot bypass environment and database file protection', () => {
  const privatePaths = [
    '.env.local',
    'src/.env.production.local',
    '.vercel/project.json',
    '.data/tickets.sqlite',
    'secrets/private.pem',
    '.neon',
  ];
  expect(
    forbiddenTrackedPaths([
      ...privatePaths,
      '.env.example',
      'src/.env.example',
      'README.md',
      'bun.lock',
      'docs/screenshots/issues.png',
    ]),
  ).toEqual(privatePaths);
});
