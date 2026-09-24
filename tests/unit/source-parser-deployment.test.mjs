import { test, expect } from 'bun:test';
import { fileURLToPath } from 'node:url';
test('server Markdown parsing does not load virtual filesystem aliases missing from Vercel tracing', async () => {
  let virtualFileDependency = false;
  const build = await Bun.build({
    entrypoints: [
      fileURLToPath(
        new URL('../../packages/server/modules/linear-import/source-contract.mjs', import.meta.url),
      ),
    ],
    target: 'bun',
    write: false,
    plugins: [
      {
        name: 'detect-virtual-file-dependency',
        setup(builder) {
          builder.onResolve(
            { filter: /^(?:vfile|unist-util-visit-parents|mdast-util-from-markdown)(?:\/|$)/ },
            () => {
              virtualFileDependency = true;
              return { path: 'vfile', external: true };
            },
          );
        },
      },
    ],
  });
  expect(build.success).toBe(true);
  expect(virtualFileDependency).toBe(false);
});

test('deployment lint explicitly excludes only generated parser output even without a Git checkout', async () => {
  const config = await Bun.file(new URL('../../.oxlintrc.json', import.meta.url)).json();
  expect(config.ignorePatterns).toContain('packages/generated/server-markdown.mjs');
  expect(config.ignorePatterns).not.toContain('packages/**');
  expect(config.ignorePatterns).not.toContain('packages/parsers/**');
  expect(config.ignorePatterns).not.toContain('scripts/**');
});
