// Enforce port/ARCHITECTURE.md: layers only depend downward, and sibling
// features never import each other. Run: node scripts/check-layers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { checkCharacterPresentation } from '../../scripts/check-character-presentation.mjs';

const SRC = path.resolve(import.meta.dirname, '../src');
/** Higher rank may import lower rank, never the reverse. */
const RANK = { engine: 0, arena: 1, fighters: 2, match: 3, ui: 4, entries: 5 };
/** Folders whose files must not import each other (siblings talk through a registry or contract). */
const ISOLATED = ['arena/themes', 'ui/screens'];
/** Within a layer, these sub-folders may not reach "up" into the listed folders. */
const INNER = {
  'arena/kit': ['arena/themes', 'arena/hazards'],
  'arena/hazards': ['arena/themes'],
  'ui/shell': ['ui/screens', 'ui/components', 'ui/model', 'ui/assets'],
  'ui/model': ['ui/screens', 'ui/components'],
  'ui/components': ['ui/screens'],
};

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})(SRC);

const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const layerOf = (r) => r.split('/')[0];
const errors = [];
for (const file of files) {
  const from = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!target.startsWith(SRC + path.sep)) continue; // game code in ../src is allowed everywhere
    const to = rel(target);
    const [fl, tl] = [layerOf(from), layerOf(to)];
    if (!(fl in RANK) || !(tl in RANK)) { errors.push(`${from}: unknown layer in import of ${to}`); continue; }
    if (RANK[tl] > RANK[fl]) errors.push(`${from} → ${to}: ${fl} may not depend on ${tl}`);
    for (const folder of ISOLATED) {
      // The folder's index.ts is its registry and may import every member.
      if (path.posix.dirname(from) === folder && path.posix.dirname(to) === folder && !from.endsWith('/index.ts'))
        errors.push(`${from} → ${to}: files in ${folder}/ must not import each other`);
    }
    for (const [folder, banned] of Object.entries(INNER)) {
      if (from.startsWith(folder + '/') && banned.some((b) => to.startsWith(b + '/')))
        errors.push(`${from} → ${to}: ${folder}/ may not depend on ${banned.join(', ')}`);
    }
  }
}
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log(`layers ok (${files.length} modules)`);
console.log(`portable presentation imports ok (${checkCharacterPresentation()} modules)`);
