import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** What each character folder may import. Anything under `src/` or `port/` (the game) is never allowed,
 * so packages, evaluation and the lab keep working without the game. Checking every file's direct
 * imports against its folder's rule covers the whole graph, since no rule admits an outside folder. */
const RULES: Record<string, { folders: string[]; packages: string[] }> = {
  package: { folders: ['package'], packages: [] },
  evaluator: { folders: ['evaluator', 'package'], packages: [] },
  render: { folders: ['render', 'package'], packages: [] },
  candidates: { folders: ['candidates', 'package', 'evaluator'], packages: ['node:', 'pngjs'] },
  testing: { folders: ['testing', 'package'], packages: [] },
  lab: { folders: ['lab', 'package', 'evaluator', 'render'], packages: ['three'] },
};
const TEST_PACKAGES = ['vitest', 'node:', 'typescript', 'pngjs'];

it('character folders import only what their boundary allows', () => {
  const root = path.dirname(fileURLToPath(import.meta.url)), violations: string[] = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file), folder = relative.split(path.sep)[0]!;
    const rule = RULES[folder], isTest = file.endsWith('.test.ts');
    if (!rule && relative !== 'boundaries.test.ts') { violations.push(`${relative}: folder ${folder} has no boundary rule`); continue; }
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) {
        const allowed = [...(rule?.packages ?? []), ...(isTest ? TEST_PACKAGES : [])];
        if (!allowed.some(name => specifier === name || specifier.startsWith(name.endsWith(':') ? name : `${name}/`))) violations.push(`${relative} → ${specifier}`);
        continue;
      }
      const target = path.relative(root, path.resolve(path.dirname(file), specifier));
      const targetFolder = target.split(path.sep)[0]!;
      if (target.startsWith('..') || !(rule?.folders ?? []).concat(isTest ? ['testing'] : []).includes(targetFolder)) violations.push(`${relative} → ${specifier}`);
    }
  }
  expect(violations).toEqual([]);
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : /\.(ts|mts|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true), found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
