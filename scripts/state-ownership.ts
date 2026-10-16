/**
 * AST-backed state-ownership inventory and guard for the shipped Tasks entry.
 *
 * Parses every .ts/.tsx file under src/ with the repo's `typescript` dependency and
 * records each call/reference to useState, useReducer, useLocalState, TanStack Query
 * hooks and zustand store factories, resolved through the file's own imports (named
 * imports, aliases, namespace and default imports, re-exports).
 *
 * The hand-written classification (docs/state-ownership-classification.json) says why
 * each file may own what it owns. The guard rejects: an unknown file with owners, a
 * mutable React-local owner in a shipped file, an unjustified setter-less React handle,
 * a changed TanStack hook count, baseline files not selected by the backend switch,
 * stale entries and malformed anchors/parity metadata. The committed manifest
 * docs/state-migration-manifest.json is generated from the same data; counts are never
 * typed by hand.
 *
 *   bun scripts/state-ownership.ts            print counts
 *   bun scripts/state-ownership.ts --check    guard + manifest freshness (exit 1 on failure)
 *   bun scripts/state-ownership.ts --write    regenerate the manifest
 *
 * Stories and *.test.* files are excluded by name but still counted in the output,
 * never silently hidden.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type Family = 'react-state' | 'local-state' | 'query' | 'zustand-store' | 'dom-native';
export interface Site {
  path: string;
  line: number;
  hook: string;
  family: Family;
  via: 'named' | 'alias' | 'namespace' | 'reexport' | 'reference';
  binding: string;
  hasSetter: boolean;
  label: string;
}
export interface Violation {
  rule: string;
  path: string;
  message: string;
}
interface Handle {
  binding: string;
  category: string;
  reason: string;
}
export interface FileEntry {
  scope: 'shipped' | 'baseline-branch' | 'reference-branch';
  owner?: string;
  baselineMechanism?: string;
  stateLibOwner?: string;
  anchors?: string[];
  parityTests?: string[];
  parityGap?: string;
  handles?: Handle[];
  adapterHooks?: Record<string, number>;
  domNative?: Record<string, number>;
  selectedBy?: string;
}
export interface Classification {
  schema: number;
  header?: Record<string, unknown>;
  files: Record<string, FileEntry>;
}
export interface EvaluatedSite extends Site {
  category: string;
}
export interface Evaluation {
  sites: EvaluatedSite[];
  violations: Violation[];
  excluded: { files: number; sites: number; paths: string[] };
  scannedFiles: number;
}

const REACT_HOOKS: Record<string, Family> = { useState: 'react-state', useReducer: 'react-state' };
const QUERY_HOOKS = new Set([
  'useQuery',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useSuspenseInfiniteQuery',
  'useQueries',
  'useMutation',
]);
const ZUSTAND_HOOKS = new Set(['create', 'createStore']);
const LOCAL_STATE_MODULE = /(^|\/)state(\/(index|local))?$/;
const ANCHOR = /^\/spec#s\d+(-\d+)*$/;
const DOM_NATIVE_ATTRIBUTES = new Set(['defaultValue', 'defaultChecked']);
const EXCLUDED_NAME = /\.stories\.|\.test\./;

type Resolved = { family: Family; hook: string; alias: boolean };
function resolveImported(module: string, imported: string): Resolved | undefined {
  if (module === 'react' && REACT_HOOKS[imported])
    return { family: REACT_HOOKS[imported], hook: imported, alias: false };
  if (module === '@tanstack/react-query' && QUERY_HOOKS.has(imported))
    return { family: 'query', hook: imported, alias: false };
  if (module === 'zustand' && ZUSTAND_HOOKS.has(imported))
    return { family: 'zustand-store', hook: imported, alias: false };
  if (LOCAL_STATE_MODULE.test(module) && imported === 'useLocalState')
    return { family: 'local-state', hook: imported, alias: false };
  return undefined;
}

export function analyzeSource(path: string, text: string): Site[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const named = new Map<string, Resolved>();
  const namespaces = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) namespaces.set(clause.name.text, module);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, module);
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        const imported = (item.propertyName ?? item.name).text;
        const resolved = resolveImported(module, imported);
        if (resolved)
          named.set(item.name.text, { ...resolved, alias: item.name.text !== imported });
      }
  }
  const sites: Site[] = [];
  const line = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const compact = (node: ts.Node) => node.getText(source).replace(/\s+/g, '');
  function resolveCallee(expression: ts.Expression): (Resolved & { via: Site['via'] }) | undefined {
    if (ts.isIdentifier(expression)) {
      const found = named.get(expression.text);
      return found && { ...found, via: found.alias ? 'alias' : 'named' };
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const module = namespaces.get(expression.expression.text);
      const found = module ? resolveImported(module, expression.name.text) : undefined;
      return found && { ...found, via: 'namespace' };
    }
    return undefined;
  }
  function bindingOf(call: ts.Node) {
    const parent = call.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === call) {
      if (ts.isArrayBindingPattern(parent.name))
        return { binding: compact(parent.name), hasSetter: parent.name.elements.length > 1 };
      return { binding: compact(parent.name), hasSetter: true };
    }
    return { binding: '', hasSetter: true };
  }
  function labelOf(call: ts.CallExpression) {
    const first = call.arguments[0];
    if (!first || !ts.isObjectLiteralExpression(first)) return '';
    for (const property of first.properties)
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        (property.name.text === 'queryKey' || property.name.text === 'mutationKey')
      )
        return compact(property.initializer);
    return '';
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isExportDeclaration(node)) {
      const module =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
      if (module && node.exportClause && ts.isNamedExports(node.exportClause))
        for (const item of node.exportClause.elements) {
          const resolved = resolveImported(module, (item.propertyName ?? item.name).text);
          if (resolved)
            sites.push({
              path,
              line: line(item),
              hook: resolved.hook,
              family: resolved.family,
              via: 'reexport',
              binding: item.name.text,
              hasSetter: true,
              label: '',
            });
        }
      return;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const native = (hook: string, at: ts.Node) =>
        sites.push({
          path,
          line: line(at),
          hook,
          family: 'dom-native',
          via: 'named',
          binding: '',
          hasSetter: false,
          label: '',
        });
      // A `<details>` whose `open` is a rendered attribute is driven by an owner (counted as that
      // owner's hook site); only the uncontrolled element leaves its open flag to the browser.
      if (
        tag === 'details' &&
        !node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            ts.isIdentifier(attribute.name) &&
            attribute.name.text === 'open',
        )
      )
        native('<details>', node);
      for (const attribute of node.attributes.properties)
        if (
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          DOM_NATIVE_ATTRIBUTES.has(attribute.name.text)
        )
          native(attribute.name.text, attribute);
    }
    if (ts.isCallExpression(node)) {
      const resolved = resolveCallee(node.expression);
      if (resolved) {
        sites.push({
          path,
          line: line(node),
          hook: resolved.hook,
          family: resolved.family,
          via: resolved.via,
          ...bindingOf(node),
          label: resolved.family === 'query' ? labelOf(node) : '',
        });
        node.arguments.forEach(visit);
        return;
      }
    }
    if (ts.isIdentifier(node) && named.has(node.text)) {
      const parent = node.parent;
      const isCallee = ts.isCallExpression(parent) && parent.expression === node;
      const isName =
        ts.isTypeQueryNode(parent) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node);
      if (!isCallee && !isName) {
        const resolved = named.get(node.text)!;
        sites.push({
          path,
          line: line(node),
          hook: resolved.hook,
          family: resolved.family,
          via: 'reference',
          binding: '<reference>',
          hasSetter: false,
          label: '',
        });
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return sites;
}

const normalise = (binding: string) => binding.replace(/\s+/g, '');
const baseName = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.(tsx?|mjs)$/, '');

export function evaluate(input: {
  sources: Record<string, string>;
  classification: Classification;
  fileExists?: (path: string) => boolean;
}): Evaluation {
  const { sources, classification } = input;
  const exists = input.fileExists ?? existsSync;
  const violations: Violation[] = [];
  const sites: EvaluatedSite[] = [];
  const excluded = { files: 0, sites: 0, paths: [] as string[] };
  const entries = classification.files;
  const withSites = new Set<string>();
  let scannedFiles = 0;
  const bad = (rule: string, path: string, message: string) =>
    violations.push({ rule, path, message });

  for (const path of Object.keys(sources).sort()) {
    if (path.endsWith('.d.ts')) continue;
    const found = analyzeSource(path, sources[path]);
    if (EXCLUDED_NAME.test(path)) {
      excluded.files++;
      excluded.sites += found.length;
      if (found.length) excluded.paths.push(path);
      continue;
    }
    scannedFiles++;
    if (!found.length) continue;
    withSites.add(path);
    const entry = entries[path];
    if (!entry) {
      bad(
        'unclassified-file',
        path,
        `${found.length} state owner(s) in a file with no classification entry`,
      );
      continue;
    }
    validateEntry(path, entry, sources, exists, bad);
    const handles = [...(entry.handles ?? [])];
    const adapterSeen: Record<string, number> = {};
    const nativeSeen: Record<string, number> = {};
    for (const site of found) {
      let category: string;
      if (site.family === 'query') {
        category = 'external-adapter';
        adapterSeen[site.hook] = (adapterSeen[site.hook] ?? 0) + 1;
      } else if (site.family === 'dom-native') {
        category = 'browser-native';
        nativeSeen[site.hook] = (nativeSeen[site.hook] ?? 0) + 1;
      } else if (entry.scope !== 'shipped') {
        category = entry.scope;
      } else if (site.family === 'local-state') {
        category = 'app-state';
      } else if (site.hasSetter) {
        category = 'unowned-mutable-state';
        bad(
          'unowned-mutable-state',
          path,
          `line ${site.line}: ${site.hook} ${site.binding || '(unbound)'} is user-visible mutable state; use useLocalState`,
        );
      } else {
        const index = handles.findIndex((handle) => normalise(handle.binding) === site.binding);
        if (index < 0) {
          category = 'unclassified-handle';
          bad(
            'unclassified-handle',
            path,
            `line ${site.line}: setter-less ${site.hook} ${site.binding || '(unbound)'} needs a justified handle entry`,
          );
        } else {
          category = handles.splice(index, 1)[0].category;
        }
      }
      sites.push({ ...site, category });
    }
    if (entry.scope === 'shipped')
      for (const handle of handles)
        bad('stale-handle', path, `handle ${handle.binding} no longer matches a React-local site`);
    const expected = entry.adapterHooks ?? {};
    const hooks = [...new Set([...Object.keys(expected), ...Object.keys(adapterSeen)])].sort();
    const drift = hooks
      .filter((hook) => (expected[hook] ?? 0) !== (adapterSeen[hook] ?? 0))
      .map((hook) => `${hook}: classified ${expected[hook] ?? 0}, found ${adapterSeen[hook] ?? 0}`);
    if (drift.length) bad('adapter-count', path, drift.join('; '));
    const wanted = entry.domNative ?? {};
    const nativeDrift = [...new Set([...Object.keys(wanted), ...Object.keys(nativeSeen)])]
      .sort()
      .filter((hook) => (wanted[hook] ?? 0) !== (nativeSeen[hook] ?? 0))
      .map((hook) => `${hook}: classified ${wanted[hook] ?? 0}, found ${nativeSeen[hook] ?? 0}`);
    if (nativeDrift.length) bad('dom-native-count', path, nativeDrift.join('; '));
  }
  for (const path of Object.keys(entries).sort())
    if (!withSites.has(path))
      bad('stale-file', path, 'classification entry has no state owners in source');
  return { sites, violations, excluded, scannedFiles };
}

function validateEntry(
  path: string,
  entry: FileEntry,
  sources: Record<string, string>,
  exists: (path: string) => boolean,
  bad: (rule: string, path: string, message: string) => void,
) {
  for (const field of ['owner', 'baselineMechanism', 'stateLibOwner'] as const)
    if (!entry[field]?.trim()) bad('missing-field', path, `${field} is required`);
  if (!entry.anchors?.length) bad('bad-anchor', path, 'at least one /spec#sN-N anchor is required');
  for (const anchor of entry.anchors ?? [])
    if (!ANCHOR.test(anchor)) bad('bad-anchor', path, `anchor ${anchor} is not /spec#sN-N`);
  if (!entry.parityTests?.length && !entry.parityGap?.trim())
    bad('missing-parity', path, 'parityTests is empty and no parityGap explains it');
  for (const test of entry.parityTests ?? [])
    if (!exists(test)) bad('missing-parity-file', path, `parity test ${test} does not exist`);
  if (entry.scope === 'baseline-branch') {
    const selector = entry.selectedBy && sources[entry.selectedBy];
    const name = baseName(path);
    if (!selector || !(selector.includes(`'./${name}'`) || selector.includes(`"./${name}"`)))
      bad('baseline-not-selected', path, `${entry.selectedBy ?? '(none)'} does not load ./${name}`);
  }
}

export function scanTree(root = 'src'): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) out[path] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}

const count = (items: string[]) =>
  Object.fromEntries(
    [...new Set(items)].sort().map((key) => [key, items.filter((item) => item === key).length]),
  );

export function buildManifest(evaluation: Evaluation, classification: Classification) {
  const byFile = new Map<string, EvaluatedSite[]>();
  for (const site of evaluation.sites)
    byFile.set(site.path, [...(byFile.get(site.path) ?? []), site]);
  const files = [...byFile.keys()].sort().map((path) => {
    const entry = classification.files[path];
    const list = byFile.get(path)!;
    return {
      path,
      scope: entry.scope,
      owner: entry.owner,
      baselineMechanism: entry.baselineMechanism,
      stateLibOwner: entry.stateLibOwner,
      anchors: entry.anchors,
      parityTests: entry.parityTests,
      ...(entry.parityGap ? { parityGap: entry.parityGap } : {}),
      ...(entry.selectedBy ? { selectedBy: entry.selectedBy } : {}),
      ...(entry.handles?.length ? { handles: entry.handles } : {}),
      counts: count(list.map((site) => site.category)),
      sites: list.map((site) => ({
        line: site.line,
        hook: site.hook,
        family: site.family,
        via: site.via,
        binding: site.binding,
        ...(site.label ? { label: site.label } : {}),
        category: site.category,
      })),
    };
  });
  const all = evaluation.sites;
  return {
    schema: 2,
    ...classification.header,
    counts: {
      scannedFiles: evaluation.scannedFiles,
      filesWithOwners: files.length,
      sites: all.length,
      byFamily: count(all.map((site) => site.family)),
      byHook: count(all.map((site) => site.hook)),
      byCategory: count(all.map((site) => site.category)),
      byScope: count(all.map((site) => classification.files[site.path].scope)),
      shippedByCategory: count(
        all
          .filter((site) => classification.files[site.path].scope === 'shipped')
          .map((site) => site.category),
      ),
      excludedFiles: evaluation.excluded.files,
      excludedSites: evaluation.excluded.sites,
    },
    excluded: evaluation.excluded.paths,
    files,
  };
}

export const stableStringify = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

const MANIFEST = 'docs/state-migration-manifest.json';
const CLASSIFICATION = 'docs/state-ownership-classification.json';

function main(argv: string[]) {
  const classification: Classification = JSON.parse(readFileSync(CLASSIFICATION, 'utf8'));
  const evaluation = evaluate({ sources: scanTree('src'), classification });
  const manifest = buildManifest(evaluation, classification);
  const text = stableStringify(manifest);
  if (argv.includes('--write')) {
    writeFileSync(MANIFEST, text);
    console.log(`wrote ${MANIFEST}`);
  }
  console.log(JSON.stringify(manifest.counts, null, 2));
  for (const violation of evaluation.violations)
    console.error(`[${violation.rule}] ${violation.path}: ${violation.message}`);
  let failed = evaluation.violations.length > 0;
  if (argv.includes('--check') && !argv.includes('--write')) {
    const committed = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '';
    if (committed !== text) {
      console.error(
        `[stale-manifest] ${MANIFEST} differs from source; run: bun scripts/state-ownership.ts --write`,
      );
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exit(main(process.argv.slice(2)));
