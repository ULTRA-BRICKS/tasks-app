import { test, expect } from 'bun:test';
import { buildSchema, coerceInputValue } from 'graphql';
import { sourcePatch } from '../../packages/server/modules/linear-live/engine.mjs';
const schema = buildSchema(
  await Bun.file(new URL('../../vendor/linear/schema.graphql', import.meta.url)).text(),
);
const ids = new Map(
  ['teams', 'users', 'projects', 'initiatives'].map((kind) => [kind, crypto.randomUUID()]),
);
const resolver = { reverse: (kind, value) => (value === null ? null : ids.get(kind)) };
function validate(type, input) {
  const errors = [];
  coerceInputValue(input, schema.getType(type), (_path, _invalid, error) =>
    errors.push(error.message),
  );
  expect(errors).toEqual([]);
}
test('outbound project teams and lead use source UUIDs and valid GraphQL input fields', () => {
  const input = sourcePatch(
    'projects',
    { team_ids: ['native-team'], lead_id: 'native-person' },
    resolver,
  );
  expect(input).toEqual({ teamIds: [ids.get('teams')], leadId: ids.get('users') });
  validate('ProjectUpdateInput', input);
});
test('initiative status values are translated to the actual source enum, never lowercased native values', () => {
  for (const [native, source] of [
    ['planned', 'Planned'],
    ['active', 'Active'],
    ['completed', 'Completed'],
    ['canceled', 'Canceled'],
  ]) {
    const input = sourcePatch(
      'initiatives',
      { status: native, owner_id: 'native-person' },
      resolver,
    );
    expect(input.status).toBe(source);
    expect(input.ownerId).toBe(ids.get('users'));
    validate('InitiativeUpdateInput', input);
  }
});
test('document associations preserve clearing and map to source identifiers', () => {
  const input = sourcePatch(
    'documents',
    { project_id: 'native-project', initiative_id: null },
    resolver,
  );
  expect(input).toEqual({ projectId: ids.get('projects'), initiativeId: null });
  validate('DocumentUpdateInput', input);
});
