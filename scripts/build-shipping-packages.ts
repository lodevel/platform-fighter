/**
 * Rebuilds the character packages the game ships:
 *   npm run character:package [-- donkeykong link pikachu]
 * Per fighter: export today's art → hold drawings (limit 0.12) → store them at match size
 * with one 256-colour palette → copy into assets/characters/<id>/package/ (replacing the
 * previous copy), then rewrite assets/characters/packages.json, the index the game imports
 * (each package's revision and size). Work files go to .tmp/shipping-packages.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packageMemory } from '../character/package/memory';
import type { CharacterPackage } from '../character/package/types';
import { validatePackage } from '../character/package/validate';
import { EXPORTED_FIGHTERS } from './character-package/legacyClips';
import { PACKAGE_INDEX_SCHEMA, type PackageIndex } from '../port/src/fighters/packageIndex';

const ROOT = process.cwd(), WORK = path.join(ROOT, '.tmp/shipping-packages');
const HOLD_LIMIT = '0.12', COLORS = '256';
const INDEX = path.join(ROOT, 'assets/characters/packages.json');
const named = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const fighters = named.length ? named : [...EXPORTED_FIGHTERS];

const tsx = (script: string, ...args: string[]) =>
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), script, ...args], { cwd: ROOT, stdio: 'inherit' });

tsx('scripts/export-character-packages.ts', '--out', WORK, ...fighters);
const index: PackageIndex = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) as PackageIndex : { schema: PACKAGE_INDEX_SCHEMA, packages: {} };
for (const id of fighters) {
  tsx('character/candidates/holdsCandidate.ts', id, '--max-diff', HOLD_LIMIT, '--packages', WORK);
  tsx('character/candidates/shrinkCandidate.ts', `${id}~holds-${HOLD_LIMIT}`, '--colors', COLORS, '--packages', WORK);
  const source = path.join(WORK, `${id}~holds-${HOLD_LIMIT}~small-c${COLORS}`), target = path.join(ROOT, 'assets/characters', id, 'package');
  const pkg = JSON.parse(readFileSync(path.join(source, 'character.json'), 'utf8')) as CharacterPackage;
  const problems = validatePackage(pkg);
  if (problems.length) throw new Error(`${id}: the shipping package does not validate:\n${problems.join('\n')}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.join(target, 'pages'), { recursive: true });
  copyFileSync(path.join(source, 'character.json'), path.join(target, 'character.json'));
  let diskBytes = statSync(path.join(target, 'character.json')).size;
  for (const page of Object.values(pkg.pages)) {
    copyFileSync(path.join(source, page.file), path.join(target, page.file));
    diskBytes += statSync(path.join(target, page.file)).size;
  }
  const memory = packageMemory(pkg);
  index.packages[id] = { revision: pkg.revision, pages: memory.pages, drawings: memory.drawings, gpuBytes: memory.gpuBytes, diskBytes };
  process.stdout.write(`${id}: package ${pkg.revision.slice(0, 12)}, ${memory.pages} pages, ` +
    `GPU ${(memory.gpuBytes / 2 ** 20).toFixed(1)} MiB, disk ${(diskBytes / 2 ** 20).toFixed(1)} MiB → ${path.relative(ROOT, target)}\n`);
}
const sorted: PackageIndex = { schema: PACKAGE_INDEX_SCHEMA,
  packages: Object.fromEntries(Object.entries(index.packages).sort(([a], [b]) => a.localeCompare(b))) };
writeFileSync(INDEX, JSON.stringify(sorted, null, 1) + '\n');
