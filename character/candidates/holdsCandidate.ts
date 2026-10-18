/**
 * Phase 3 candidate: fewer stored drawings, each held longer.
 *   npx tsx character/candidates/holdsCandidate.ts <id> [--max-diff 0.02,0.04,0.08] [--max-hold 8] [--packages .tmp/character-packages]
 * Reads <packages>/<id> and writes, beside it:
 *   <id>~repack           the same drawings on freshly packed pages (the fair baseline);
 *   <id>~holds-<limit>    per limit, every drawing whose look differs from the drawing
 *                         that would replace it by at most <limit> (signatureDiff) is dropped
 *                         and the previous one held over its ticks, sockets following. No drawing
 *                         is held longer than <max-hold> ticks or the action's longest window.
 * Each gets character.json and candidate-report.json. Node only; no game code.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, withRevision } from '../package/canonical';
import { actionMemory, packageMemory, type MemoryEstimate } from '../package/memory';
import type { CharacterPackage, DrawingId } from '../package/types';
import { validatePackage } from '../package/validate';
import { readPage, repack, signature, signatureDiff, type Signature } from './pixels';
import { holdMap, retimeAction } from './retime';

const args = process.argv.slice(2), option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!id) throw new Error('Usage: holdsCandidate.ts <id> [--max-diff 0.02,0.04] [--max-hold 8] [--packages dir]');
const root = path.resolve(option('--packages') ?? '.tmp/character-packages'), sourceDir = path.join(root, id);
const limits = (option('--max-diff') ?? '0.02,0.04,0.08').split(',').map(Number), maxHold = Number(option('--max-hold') ?? 8);
const source = JSON.parse(readFileSync(path.join(sourceDir, 'character.json'), 'utf8')) as CharacterPackage;

const signatures = new Map<DrawingId, Signature>();
for (const [pageId, page] of Object.entries(source.pages)) {
  const png = readPage(sourceDir, page);
  for (const [drawingId, drawing] of Object.entries(source.drawings)) if (drawing.page === pageId) signatures.set(drawingId, signature(png, drawing));
}
const diffs = new Map<string, number>();
const diff = (a: DrawingId, b: DrawingId) => {
  if (a === b) return 0;
  const key = `${a}\n${b}`;
  if (!diffs.has(key)) diffs.set(key, signatureDiff(signatures.get(a)!, signatures.get(b)!));
  return diffs.get(key)!;
};

/** The package without drawings no action shows any more. */
function withoutUnused(pkg: CharacterPackage): CharacterPackage {
  const shown = new Set(Object.values(pkg.actions).flatMap(action => action.drawings.windows.map(w => w.drawing)));
  return { ...pkg, drawings: Object.fromEntries(Object.entries(pkg.drawings).filter(([drawing]) => shown.has(drawing))) };
}

async function write(name: string, candidate: CharacterPackage, limit: number | null): Promise<void> {
  const dir = path.join(root, `${id}~${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'pages'), { recursive: true });
  const packed = await withRevision({ ...repack(candidate, sourceDir, dir), revision: '',
    provenance: { importer: { name: 'holds candidate', version: '2' }, sources: { [`${id}/character.json`]: source.revision } } });
  const problems = validatePackage(packed);
  writeFileSync(path.join(dir, 'character.json'), canonicalJson(packed));
  const row = (m: MemoryEstimate) => ({ drawings: m.drawings, pages: m.pages, drawnPixels: m.drawnPixels, rgbaBytes: m.rgbaBytes, bc7Bytes: m.bc7Bytes });
  const actions = Object.keys(packed.actions).sort().map(action => ({ action,
    windows: [source.actions[action]!.drawings.windows.length, packed.actions[action]!.drawings.windows.length],
    drawings: [actionMemory(source, action).drawings, actionMemory(packed, action).drawings],
    drawnPixels: [actionMemory(source, action).drawnPixels, actionMemory(packed, action).drawnPixels] }));
  const total = row(packageMemory(packed));
  writeFileSync(path.join(dir, 'candidate-report.json'), JSON.stringify({ schema: 'character-candidate/1', candidate: name, source: { id, revision: source.revision },
    maxDiff: limit, maxHold: limit === null ? null : maxHold, problems, source_memory: row(packageMemory(source)), memory: total, actions }, null, 1) + '\n');
  console.log(`${id}~${name}: ${total.drawings} drawings, ${(total.drawnPixels / 1e6).toFixed(1)} M drawn px, ` +
    `RGBA8 ${(total.rgbaBytes / 2 ** 20).toFixed(1)} MiB, BC7 ${(total.bc7Bytes / 2 ** 20).toFixed(1)} MiB, ${problems.length} problems`);
}

await write('repack', source, null);
for (const limit of limits) {
  const actions = Object.fromEntries(Object.entries(source.actions).map(([name, action]) =>
    [name, retimeAction(action, holdMap(action.drawings.windows, diff, limit, maxHold))]));
  await write(`holds-${limit}`, withoutUnused({ ...source, actions }), limit);
}
