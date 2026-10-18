/**
 * Phase 3 candidate: fewer stored drawings, each held longer.
 *   npx tsx character/candidates/holdsCandidate.ts <id> [--max-diff 0.02,0.04,0.08] [--max-hold 8] [--packages .tmp/character-packages]
 * Reads <packages>/<id> and writes, beside it:
 *   <id>~repack           the same drawings on freshly packed pages (the fair baseline);
 *   <id>~holds-<limit>    per limit, every drawing whose look differs from the drawing
 *                         that would replace it by at most <limit> (signatureDiff) is dropped
 *                         and the previous one held over its ticks, sockets following. No drawing
 *                         is held longer than <max-hold> ticks or the action's longest window.
 *                         Effect actions (`effect.*`) keep every drawing.
 * Each gets character.json and candidate-report.json. Node only; no game code.
 */
import { isEffectAction, type CharacterPackage, type DrawingId } from '../package/types';
import { readCandidateSource, writeCandidate } from './output';
import { readPage, repack, signature, signatureDiff, type Signature } from './pixels';
import { holdMap, retimeAction } from './retime';

const input = readCandidateSource('holdsCandidate.ts <id> [--max-diff 0.02,0.04] [--max-hold 8] [--packages dir]');
const { pkg: source, dir: sourceDir } = input;
const limits = (input.option('--max-diff') ?? '0.02,0.04,0.08').split(',').map(Number), maxHold = Number(input.option('--max-hold') ?? 8);

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

const IMPORTER = { name: 'holds candidate', version: '3' };
const write = (name: string, candidate: CharacterPackage, limit: number | null) => writeCandidate(input, name, IMPORTER,
  { maxDiff: limit, maxHold: limit === null ? null : maxHold }, dir => repack(candidate, sourceDir, dir));

await write('repack', source, null);
for (const limit of limits) {
  // Effects keep every drawing: each shows for one tick of a short burst or one step of a spin.
  const actions = Object.fromEntries(Object.entries(source.actions).map(([name, action]) =>
    [name, isEffectAction(name) ? action : retimeAction(action, holdMap(action.drawings.windows, diff, limit, maxHold))]));
  await write(`holds-${limit}`, withoutUnused({ ...source, actions }), limit);
}
