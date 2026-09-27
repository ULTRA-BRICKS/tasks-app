import { test, expect } from 'bun:test';
import { buildSchema, parse, validate } from 'graphql';
import {
  SOURCE_MODELS,
  readSourcePage,
  readSourceEntity,
} from '../../packages/server/modules/linear-live/client.mjs';
// This is the upstream contract, not packages/linear/schema.graphql (our deliberately limited adapter).
const schema = buildSchema(
  await Bun.file(new URL('../../vendor/linear/schema.graphql', import.meta.url)).text(),
);
for (const [collection, model] of Object.entries(SOURCE_MODELS))
  test(
    'upstream ' + collection + ' metadata/full queries conform to the pinned provider schema',
    async () => {
      const queries = [];
      const fetcher = async (_url, options) => {
        const { query } = JSON.parse(options.body);
        queries.push(query);
        expect(validate(schema, parse(query)).map((e) => e.message)).toEqual([]);
        return Response.json({
          data: query.includes('SyncPage')
            ? { [model.many]: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
            : { [model.one]: null },
        });
      };
      const env = { LINEAR_API_TOKEN: 'synthetic-test-token' };
      await readSourcePage(env, collection, { limit: 40 }, { fetcher });
      await readSourceEntity(env, collection, '00000000-0000-4000-8000-000000000001', { fetcher });
      expect(queries).toHaveLength(2);
    },
  );
