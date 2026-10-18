/**
 * Writes today's fighters as character packages for the character lab:
 *   npx tsx scripts/export-character-packages.ts [--out .tmp/character-packages] [donkeykong link pikachu]
 * Each package directory gets character.json (canonical), its pages and export-report.json.
 * Fails when any action differs from the game or the package does not validate.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, withRevision } from '../character/package/canonical';
import { exportFighter } from './character-package/exportLegacy';
import { EXPORTED_FIGHTERS, isExportedFighter } from './character-package/legacyClips';

const args = process.argv.slice(2), outIndex = args.indexOf('--out');
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1]! : '.tmp/character-packages');
const named = args.filter((arg, i) => !arg.startsWith('--') && i !== outIndex + 1);
const fighters = named.length ? named : EXPORTED_FIGHTERS;
let failed = false;
for (const fighter of fighters) {
  if (!isExportedFighter(fighter)) throw new Error(`Unknown fighter ${fighter}`);
  const { pkg, pageSources, report } = exportFighter(fighter);
  const dir = path.join(out, fighter), final = await withRevision(pkg);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'pages'), { recursive: true });
  for (const [file, source] of pageSources) copyFileSync(source, path.join(dir, file));
  writeFileSync(path.join(dir, 'character.json'), canonicalJson(final));
  writeFileSync(path.join(dir, 'export-report.json'), JSON.stringify({ revision: final.revision, ...report }, null, 1) + '\n');
  const bad = report.problems.length + report.validation.length;
  failed ||= bad > 0;
  process.stdout.write(`${fighter}: ${report.actions.length} actions, ${Object.keys(pkg.drawings).length} drawings, ` +
    `${pageSources.size} pages, ${report.skipped.length} clips skipped, ${report.verifiedTicks} ticks verified, ${bad} problems → ${path.relative(process.cwd(), dir)}\n`);
}
if (failed) process.exit(1);
