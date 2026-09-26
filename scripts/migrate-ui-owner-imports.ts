/** One-time, syntax-directed import migration for the isolated comparison branch. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import ts from 'typescript';
const files = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)],
  );
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const owners: Array<{ path: string; line: number; binding: string; mechanism: string }> = [];
for (const file of files('src')) {
  if (!/\.tsx?$/.test(file) || /\.stories\.|baseline|reference|shared\/lib\/state\//.test(file))
    continue;
  let text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements)
        if ((item.propertyName ?? item.name).text === 'useState') names.add(item.name.text);
  }
  const edits: Array<{ start: number; end: number }> = [];
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements.length > 1 &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      names.has(node.initializer.expression.text)
    ) {
      edits.push({
        start: node.initializer.expression.getStart(source),
        end: node.initializer.expression.getEnd(),
      });
      owners.push({
        path: file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        binding: node.name.getText(source),
        mechanism: '/spec#s4-9',
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!edits.length) continue;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + 'useLocalState' + text.slice(edit.end);
  const updated = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of [...updated.statements].reverse()) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    )
      continue;
    const clause = statement.importClause,
      bindings = clause?.namedBindings;
    if (!clause || !bindings || !ts.isNamedImports(bindings)) continue;
    const remaining = bindings.elements.filter((item) => {
      if (!names.has(item.name.text)) return true;
      let used = false;
      function refs(node: ts.Node) {
        if (ts.isImportDeclaration(node)) return;
        if (ts.isIdentifier(node) && node.text === item.name.text) used = true;
        ts.forEachChild(node, refs);
      }
      refs(updated);
      return used;
    });
    const replacement =
      remaining.length || clause.name
        ? printer.printNode(
            ts.EmitHint.Unspecified,
            ts.factory.updateImportDeclaration(
              statement,
              statement.modifiers,
              ts.factory.updateImportClause(
                clause,
                clause.isTypeOnly,
                clause.name,
                remaining.length ? ts.factory.createNamedImports(remaining) : undefined,
              ),
              statement.moduleSpecifier,
              statement.attributes,
            ),
            updated,
          )
        : '';
    text =
      text.slice(0, statement.getStart(updated)) + replacement + text.slice(statement.getEnd());
  }
  let path = relative(dirname(file), 'src/shared/lib/state').replaceAll('\\', '/');
  if (!path.startsWith('.')) path = './' + path;
  text = `import {useLocalState} from ${JSON.stringify(path)};\n` + text;
  writeFileSync(file, text);
}
writeFileSync(
  'docs/state-ui-owner-migration.json',
  JSON.stringify(
    { baselineRevision: 'a4ae80b1aae42293674f091c14ab9b59b37609e0', owners },
    null,
    2,
  ) + '\n',
);
console.log(
  `Moved ${owners.length} mutable UI owners in ${new Set(owners.map((owner) => owner.path)).size} source files; lifecycle-only initializers and baseline modules are preserved.`,
);
