/**
 * Export today's fighters as character packages (`character-package/1`), exactly as the game
 * displays them. Each action is sampled tick by tick through the game's own selection code
 * (legacyClips.ts) and compressed into windows; the result is then re-evaluated with the
 * package evaluator over twice the sampled range and compared with the game, tick by tick.
 * Temporary migration code: deleted with the legacy readers when the game loads packages.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { frameRect } from '../../src/assets/packedFrames';
import { heldItemSocketAt } from '../../src/characterPresentation/legacy/heldItemPoseData';
import { characterCostumes } from '../../port/src/fighters/palette';
import { evaluate } from '../../character/evaluator/evaluate';
import { PACKAGE_SCHEMA, type Action, type CharacterPackage, type Drawing, type Page, type Schedule,
  type SocketTrack, type SocketWindow, type Window } from '../../character/package/types';
import { compress } from '../../character/package/schedule';
import { validatePackage } from '../../character/package/validate';
import { exportClips, sheetsOf, type ClipSample, type ExportClip, type ExportedFighter, type SkippedClip } from './legacyClips';

export const EXPORTER = { name: 'platform-fighter legacy export', version: '1' };
/** Ticks sampled per action; verification then covers twice this. Longer than any installed action. */
export const HORIZON = 1200;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export interface ActionReport {
  readonly action: string; readonly clock: string; readonly after: Schedule<Window>['after'];
  readonly ticks: number; readonly windows: number; readonly drawings: number; readonly sockets: readonly string[];
}
/** Identity of a placed drawing: the same sheet frame placed differently is a different drawing (`<sheet>/<frame>@<n>`). */
export const placementKey = (s: Pick<ClipSample, 'sheet' | 'frame' | 'originX' | 'originY' | 'scale'>): string =>
  JSON.stringify([s.sheet, s.frame, s.originX, s.originY, s.scale]);

export interface ExportResult {
  readonly pkg: CharacterPackage;
  /** Placement key → drawing id. */
  readonly placements: ReadonlyMap<string, string>;
  /** Package page file → source PNG (absolute). */
  readonly pageSources: ReadonlyMap<string, string>;
  readonly report: {
    readonly fighter: ExportedFighter; readonly actions: readonly ActionReport[]; readonly skipped: readonly SkippedClip[];
    /** Anything the export could not express or verify. Empty when the package matches the game exactly. */
    readonly problems: readonly string[]; readonly verifiedTicks: number; readonly validation: readonly string[];
  };
}

export function exportFighter(fighter: ExportedFighter): ExportResult {
  const sheets = sheetsOf(fighter), { clips, skipped } = exportClips(fighter), problems: string[] = [];
  const pages: Record<string, Page> = {}, pageSources = new Map<string, string>();
  const drawings: Record<string, Drawing> = {}, drawingByPlacement = new Map<string, string>();
  const actions: Record<string, Action> = {}, reports: ActionReport[] = [];

  const drawingFor = (s: ClipSample): string => {
    const placement = placementKey(s);
    const known = drawingByPlacement.get(placement);
    if (known) return known;
    const layout = sheets.get(s.sheet);
    if (!layout) throw new Error(`unknown sheet ${s.sheet}`);
    const width = layout.atlas?.[0] ?? (layout.columns ?? 1) * layout.frameWidth;
    const height = layout.atlas?.[1] ?? Math.ceil(layout.frameCount / (layout.columns ?? 1)) * layout.frameHeight;
    const rect = frameRect({ ...layout, atlas: layout.atlas as [number, number] | undefined,
      trims: layout.trims as never, columns: layout.columns ?? (layout.atlas ? undefined : 1) }, s.frame);
    if (!pages[s.sheet]) {
      const source = path.join(ROOT, 'assets/characters', fighter, layout.strip), file = `pages/${s.sheet}.png`;
      pages[s.sheet] = { file, width, height, sha256: createHash('sha256').update(readFileSync(source)).digest('hex') };
      pageSources.set(file, source);
    }
    let id = `${s.sheet}/${s.frame}`;
    for (let n = 1; drawings[id]; n++) id = `${s.sheet}/${s.frame}@${n}`;
    drawings[id] = { page: s.sheet, rect: [rect.x, rect.y, rect.w, rect.h], scale: s.scale,
      anchor: [s.originX * layout.frameWidth - rect.dx, s.originY * layout.frameHeight - rect.dy] };
    drawingByPlacement.set(placement, id);
    return id;
  };

  for (const clip of clips) {
    try {
      const samples = sampleAll(clip);
      const shown = samples.find(s => s !== null);
      if (!shown) { problems.push(`${clip.action}: never shows a drawing`); continue; }
      if (samples.some(s => s && s.bodyCentreFromRootY !== shown.bodyCentreFromRootY)) { problems.push(`${clip.action}: body centre changes within the action`); continue; }
      const drawingSchedule = compress(samples.map(s => s && { drawing: drawingFor(s), ...(s.sample === undefined ? {} : { sample: s.sample }) }), clip.loop);
      if (typeof drawingSchedule === 'string') { problems.push(`${clip.action}: ${drawingSchedule}`); continue; }
      const sockets = socketsOf(fighter, clip, samples, problems);
      actions[clip.action] = { bodyCentreFromRootY: shown.bodyCentreFromRootY, drawings: drawingSchedule,
        ...(Object.keys(sockets).length ? { sockets } : {}) };
      reports.push({ action: clip.action, clock: clip.clock, after: drawingSchedule.after, ticks: drawingSchedule.windows.at(-1)!.end,
        windows: drawingSchedule.windows.length, drawings: new Set(drawingSchedule.windows.map(w => w.drawing)).size, sockets: Object.keys(sockets) });
    } catch (error) {
      problems.push(`${clip.action}: ${(error as Error).message}`);
    }
  }

  const costumes = characterCostumes(fighter);
  const pkg: CharacterPackage = {
    schema: PACKAGE_SCHEMA, id: fighter, revision: '', pages, drawings, actions,
    ...(costumes ? { costumes } : {}),
    provenance: { importer: EXPORTER, sources: sourceHashes(fighter) },
  };
  const verifiedTicks = verify(pkg, clips.filter(c => actions[c.action]), drawingByPlacement, fighter, problems);
  return { pkg, placements: drawingByPlacement, pageSources, report: { fighter, actions: reports, skipped, problems, verifiedTicks, validation: validatePackage(pkg) } };
}

function sampleAll(clip: ExportClip): (ClipSample | null)[] {
  return Array.from({ length: HORIZON }, (_, age) => clip.sample(age));
}

const SOCKET_AXES = [['item', 'y'], ['item-z', 'z']] as const;

function socketsOf(fighter: ExportedFighter, clip: ExportClip, samples: readonly (ClipSample | null)[], problems: string[]): Record<string, SocketTrack> {
  const sockets: Record<string, SocketTrack> = {};
  if (!clip.socketClip) return sockets;
  for (const [name, axis] of SOCKET_AXES) {
    const values = samples.map((s, age) => s && socketValue(fighter, clip.socketClip!, s.frame, age, axis));
    if (values.every(v => v === null)) continue;
    const schedule = compress(values, clip.loop);
    if (typeof schedule === 'string') { problems.push(`${clip.action}: socket ${name}: ${schedule}`); continue; }
    sockets[name] = { space: 'body-centre', schedule };
  }
  if (sockets.item && sockets['item-z'] && JSON.stringify(sockets.item) === JSON.stringify(sockets['item-z'])) delete sockets['item-z'];
  return sockets;
}

function socketValue(fighter: ExportedFighter, clip: string, frame: number, age: number, axis: 'y' | 'z'): Omit<SocketWindow, 'start' | 'end'> | null {
  const socket = heldItemSocketAt(fighter, clip, frame, age, axis);
  return socket && { x: socket.x, y: socket.y, angle: socket.angle, length: socket.length };
}

/** Compares the package with the game at every tick up to twice the sampled range. Returns the ticks checked. */
function verify(pkg: CharacterPackage, clips: readonly ExportClip[], ids: ReadonlyMap<string, string>, fighter: ExportedFighter, problems: string[]): number {
  let checked = 0;
  for (const clip of clips) {
    const action = pkg.actions[clip.action]!;
    for (let age = 0; age < 2 * HORIZON; age++) {
      const expected = clip.sample(age), got = evaluate(pkg, { action: clip.action, tick: age, facing: 1 });
      const id = expected && ids.get(placementKey(expected));
      checked++;
      if ((id ?? null) !== got.drawing || (expected?.sample ?? undefined) !== got.sample) {
        problems.push(`${clip.action}: tick ${age} shows ${got.drawing ?? 'nothing'}, the game shows ${id ?? (expected ? 'an unexported drawing' : 'nothing')}`);
        break;
      }
      for (const [name, axis] of SOCKET_AXES) {
        const track = action.sockets?.[name] ?? (name === 'item-z' ? action.sockets?.item : undefined);
        if (!track || !expected || !clip.socketClip) continue;
        const want = socketValue(fighter, clip.socketClip, expected.frame, age, axis), have = got.sockets[name] ?? (name === 'item-z' ? got.sockets.item : undefined);
        if (JSON.stringify(want) !== JSON.stringify(have && { x: have.x, y: have.y, angle: have.angle, length: have.length })) {
          problems.push(`${clip.action}: socket ${name} differs from the game at tick ${age}`);
          age = 2 * HORIZON;
          break;
        }
      }
    }
  }
  return checked;
}

function sourceHashes(fighter: ExportedFighter): Record<string, string> {
  const files = [`assets/characters/${fighter}/frames.json`, `assets/characters/${fighter}/item-axes.json`,
    ...(fighter === 'pikachu' ? ['assets/characters/pikachu/final-visual-frames.json'] : []),
    'src/characters/palettes.ts', 'src/characters/paletteArtKeys.ts'];
  return Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex')]));
}

