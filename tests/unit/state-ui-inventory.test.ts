import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)],
  );
}
export function reactStateOwners() {
  const owners: Array<{ path: string; line: number; name: string }> = [];
  for (const file of files('src')) {
    const path = relative('.', file);
    if (!/\.tsx?$/.test(path) || /\.stories\.|baseline|reference|shared\/lib\/state\//.test(path))
      continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const hooks = new Set<string>();
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
          if ((item.propertyName ?? item.name).text === 'useState') hooks.add(item.name.text);
    }
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isArrayBindingPattern(node.name) &&
        node.name.elements.length > 1 &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        hooks.has(node.initializer.expression.text)
      )
        owners.push({
          path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          name: node.name.getText(source),
        });
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return owners;
}
test('shipped mutable UI state is registered through state-lib rather than React-local owners', () => {
  expect(reactStateOwners()).toEqual([]);
});
