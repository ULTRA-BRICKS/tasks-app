import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  analyzeSource,
  buildManifest,
  evaluate,
  scanTree,
  stableStringify,
  type Classification,
  type FileEntry,
} from '../../scripts/state-ownership.ts';

const entry = (extra: Partial<FileEntry> = {}): FileEntry => ({
  scope: 'shipped',
  owner: 'fixture',
  baselineMechanism: 'React useState',
  stateLibOwner: 'useLocalState registry',
  anchors: ['/spec#s4-9'],
  parityTests: ['tests/unit/state-local-hook.test.tsx'],
  ...extra,
});
const classification = (files: Classification['files']): Classification => ({
  schema: 1,
  files,
});
const run = (sources: Record<string, string>, files: Classification['files']) =>
  evaluate({ sources, classification: classification(files), fileExists: () => true });
const rules = (result: { violations: Array<{ rule: string }> }) =>
  result.violations.map((violation) => violation.rule);

test('detects named, aliased, namespace and default-import hook usage', () => {
  const sites = analyzeSource(
    'src/x.tsx',
    [
      "import React, { useState as local, useReducer } from 'react';",
      "import * as R from 'react';",
      "import { useLocalState as owned } from '../shared/lib/state';",
      "import * as Q from '@tanstack/react-query';",
      "import { useQuery as read, useMutation } from '@tanstack/react-query';",
      'export function A() {',
      '  const [a, setA] = local(0);',
      '  const [b, dispatch] = useReducer((s: number) => s, 0);',
      '  const [c, setC] = R.useState(1);',
      '  const [d] = React.useState(() => 2);',
      '  const [e, setE] = owned("");',
      '  const q = Q.useQuery({ queryKey: ["ns"] });',
      '  const r = read({ queryKey: ["aliased"] });',
      '  const m = useMutation({ mutationFn: async () => 1 });',
      '}',
    ].join('\n'),
  );
  expect(
    sites.map((site: { hook: string; family: string }) => `${site.family}:${site.hook}`),
  ).toEqual([
    'react-state:useState',
    'react-state:useReducer',
    'react-state:useState',
    'react-state:useState',
    'local-state:useLocalState',
    'query:useQuery',
    'query:useQuery',
    'query:useMutation',
  ]);
  const handle = sites.find((site: { binding: string }) => site.binding === '[d]');
  expect(handle?.hasSetter).toBe(false);
  expect(sites[0].hasSetter).toBe(true);
});

test('does not treat an unrelated function with a hook name as an owner', () => {
  const sites = analyzeSource(
    'src/y.ts',
    'function useState() { return 1; }\nexport const v = useState();\n',
  );
  expect(sites).toEqual([]);
});

test('RED: a new unclassified React-local owner in an unknown file is rejected', () => {
  const result = run(
    {
      'src/new/ui.tsx':
        "import { useState } from 'react';\nexport const A = () => { const [x, setX] = useState(0); return x + setX; };",
    },
    {},
  );
  expect(rules(result)).toContain('unclassified-file');
});

test('RED: a mutable React-local owner in a classified shipped file is rejected', () => {
  const result = run(
    {
      'src/new/ui.tsx':
        "import { useState } from 'react';\nexport const A = () => { const [x, setX] = useState(0); return x + setX; };",
    },
    { 'src/new/ui.tsx': entry() },
  );
  expect(rules(result)).toEqual(['unowned-mutable-state']);
});

test('GREEN: the same file passes when the state uses the registry binding', () => {
  const result = run(
    {
      'src/new/ui.tsx':
        "import { useLocalState } from '../shared/lib/state';\nexport const A = () => { const [x, setX] = useLocalState(0); return x + setX; };",
    },
    { 'src/new/ui.tsx': entry() },
  );
  expect(result.violations).toEqual([]);
  expect(result.sites).toHaveLength(1);
});

test('GREEN: a setter-less React handle passes only with a matching justified handle entry', () => {
  const source =
    "import { useState } from 'react';\nexport const A = () => { const [controller] = useState(() => ({})); return controller; };";
  expect(rules(run({ 'src/h.tsx': source }, { 'src/h.tsx': entry() }))).toEqual([
    'unclassified-handle',
  ]);
  const classified = entry({
    handles: [
      {
        binding: '[controller]',
        category: 'opaque-framework-resource',
        reason: 'controller allocation',
      },
    ],
  });
  expect(run({ 'src/h.tsx': source }, { 'src/h.tsx': classified }).violations).toEqual([]);
  const renamed = source.replace('[controller]', '[other]');
  expect(rules(run({ 'src/h.tsx': renamed }, { 'src/h.tsx': classified })).sort()).toEqual([
    'stale-handle',
    'unclassified-handle',
  ]);
  expect(rules(run({ 'src/h.tsx': 'export const A = 1;' }, { 'src/h.tsx': classified }))).toEqual([
    'stale-file',
  ]);
});

test('RED/GREEN: external adapter hook counts must match the classified count', () => {
  const source =
    "import { useQuery, useMutation } from '@tanstack/react-query';\nexport const A = () => { useQuery({ queryKey: ['a'] }); useMutation({ mutationFn: async () => 1 }); };";
  expect(rules(run({ 'src/q.tsx': source }, { 'src/q.tsx': entry() }))).toEqual(['adapter-count']);
  expect(
    run(
      { 'src/q.tsx': source },
      { 'src/q.tsx': entry({ adapterHooks: { useQuery: 1, useMutation: 1 } }) },
    ).violations,
  ).toEqual([]);
  const extra = source.replace(
    'useMutation({',
    'useMutation({ mutationFn: async () => 2 }); useMutation({',
  );
  expect(
    rules(
      run(
        { 'src/q.tsx': extra },
        { 'src/q.tsx': entry({ adapterHooks: { useQuery: 1, useMutation: 1 } }) },
      ),
    ),
  ).toEqual(['adapter-count']);
});

test('baseline-branch files may keep React-local state but must be selected by the backend switch', () => {
  const source =
    "import { useState } from 'react';\nexport const A = () => { const [x, setX] = useState(0); return x + setX; };";
  const files = {
    'src/f/baseline.tsx': entry({ scope: 'baseline-branch', selectedBy: 'src/f/index.ts' }),
  };
  expect(
    rules(run({ 'src/f/baseline.tsx': source, 'src/f/index.ts': 'export {};' }, files)),
  ).toEqual(['baseline-not-selected']);
  const selector =
    "const impl = stateBackend === 'baseline' ? await import('./baseline') : await import('./state-lib');";
  expect(
    run({ 'src/f/baseline.tsx': source, 'src/f/index.ts': selector }, files).violations,
  ).toEqual([]);
});

test('a stale file entry without matching source is rejected', () => {
  expect(rules(run({}, { 'src/gone.tsx': entry() }))).toEqual(['stale-file']);
});

test('incomplete classification metadata is rejected', () => {
  const source =
    "import { useLocalState } from '../shared/lib/state';\nexport const A = () => useLocalState(0);";
  const result = run(
    { 'src/m.tsx': source },
    { 'src/m.tsx': entry({ anchors: ['spec 4.9'], parityTests: [] }) },
  );
  expect(rules(result).sort()).toEqual(['bad-anchor', 'missing-parity']);
});

test('real tree: every shipped owner is classified and the committed manifest is current', () => {
  const classificationFile = JSON.parse(
    readFileSync('docs/state-ownership-classification.json', 'utf8'),
  );
  const result = evaluate({ sources: scanTree('src'), classification: classificationFile });
  expect(result.violations).toEqual([]);
  const manifest = buildManifest(result, classificationFile);
  expect(readFileSync('docs/state-migration-manifest.json', 'utf8')).toBe(
    stableStringify(manifest),
  );
});

test('real tree mutation: appending a new useState owner to a shipped file is rejected', () => {
  const classificationFile = JSON.parse(
    readFileSync('docs/state-ownership-classification.json', 'utf8'),
  );
  const sources = scanTree('src');
  const target = 'src/features/command-menu/ui.tsx';
  expect(sources[target]).toBeDefined();
  const mutated = {
    ...sources,
    [target]:
      "import { useState as sneaky } from 'react';\n" +
      sources[target] +
      '\nexport function Injected() { const [v, setV] = sneaky(0); return [v, setV]; }\n',
  };
  expect(rules(evaluate({ sources: mutated, classification: classificationFile }))).toEqual([
    'unowned-mutable-state',
  ]);
  const baselineHidden = {
    ...sources,
    'src/features/hidden/baseline.tsx':
      "import { useState } from 'react';\nexport const H = () => useState(0);\n",
  };
  expect(rules(evaluate({ sources: baselineHidden, classification: classificationFile }))).toEqual([
    'unclassified-file',
  ]);
});

test('RED/GREEN: browser-native uncontrolled disclosure and default* inputs are inventoried', () => {
  const source = [
    'export const A = () => (',
    '  <div>',
    '    <details><summary>More</summary></details>',
    '    <input defaultValue="x" />',
    '  </div>',
    ');',
  ].join('\n');
  const sites = analyzeSource('src/n.tsx', source);
  expect(sites.map((site: { hook: string; family: string }) => `${site.family}:${site.hook}`)).toEqual([
    'dom-native:<details>',
    'dom-native:defaultValue',
  ]);
  expect(rules(run({ 'src/n.tsx': source }, { 'src/n.tsx': entry() }))).toEqual(['dom-native-count']);
  expect(
    run({ 'src/n.tsx': source }, { 'src/n.tsx': entry({ domNative: { '<details>': 1, defaultValue: 1 } }) })
      .violations,
  ).toEqual([]);
});

test('a details element whose open attribute is rendered is not counted as browser-native', () => {
  const owned = [
    'export const A = ({ open }: { open: boolean }) => (',
    '  <details open={open}><summary>More</summary></details>',
    ');',
  ].join('\n');
  const spread = 'export const B = (p: object) => <details {...p}><summary>More</summary></details>;';
  const siteLabels = (source: string) =>
    analyzeSource('src/o.tsx', source).map((site: { hook: string }) => site.hook);
  expect(siteLabels(owned)).toEqual([]);
  // A spread cannot be proven to control `open`, so it stays inventoried.
  expect(siteLabels(spread)).toEqual(['<details>']);
});
