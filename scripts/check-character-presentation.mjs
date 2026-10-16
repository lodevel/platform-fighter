import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const core = path.join(root, 'src/characterPresentation');

/** Check syntax, including re-exports and dynamic imports, instead of assuming
 * that the port layer checker also protects the renderer-neutral core. */
export function presentationBoundaryErrors(text, file) {
  const errors = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const check = value => {
    const target = value.startsWith('.') ? path.resolve(path.dirname(file), value) : null;
    if (!target || !target.startsWith(core + path.sep) || target.startsWith(path.join(core, 'legacy') + path.sep))
      errors.push(`${path.relative(root, file)}: portable presentation may not import ${value}`);
  };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) check(argument.text);
      else errors.push(`${path.relative(root, file)}: nonliteral module import in portable presentation`);
    }
    if (ts.isIdentifier(node) && ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'WebGLRenderingContext', 'WebGL2RenderingContext'].includes(node.text))
      errors.push(`${path.relative(root, file)}: browser dependency ${node.text} in portable presentation`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

export function checkCharacterPresentation() {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && file !== path.join(core, 'legacy')) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(file);
    }
  };
  walk(core);
  const errors = files.flatMap(file => presentationBoundaryErrors(fs.readFileSync(file, 'utf8'), file));
  if (errors.length) throw new Error(errors.join('\n'));
  return files.length;
}
