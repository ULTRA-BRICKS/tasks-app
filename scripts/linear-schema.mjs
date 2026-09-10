import { readFile, writeFile } from 'node:fs/promises';
import { generateLinearSchema } from '../packages/linear/contract.mjs';
const file = new URL('../packages/linear/schema.graphql', import.meta.url);
const expected = generateLinearSchema();
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8').catch(() => null)) !== expected)
    throw new Error('Linear subset schema is stale; run bun run graphql:generate');
  console.log('Linear subset matches the pinned upstream AST.');
} else {
  await writeFile(file, expected);
  console.log('Generated Linear-compatible subset SDL.');
}
