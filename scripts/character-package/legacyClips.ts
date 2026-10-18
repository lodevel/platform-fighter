/**
 * Which game function decides the drawing of each installed clip, for the temporary
 * character package export (deleted with the legacy `frames.json` readers in Phase 6).
 * Every sampler calls the game's own selection code; nothing here re-implements a rule.
 */
import donkeykongFrames from '../../assets/characters/donkeykong/frames.json';
import linkFrames from '../../assets/characters/link/frames.json';
import pikachuFrames from '../../assets/characters/pikachu/frames.json';
import pikachuFinalVisual from '../../assets/characters/pikachu/final-visual-frames.json';
import type { CharacterId } from '../../src/types';
import { getPackedBodyRenderMetrics, selectPackedDrawing } from '../../src/characters/packedBodyPresentation';
import { getPikachuSheetRenderMetrics } from '../../src/characters/pikachuPresentation';
import { pikachuAuxiliaryBodyLoopFrames } from '../../src/characters/pikachuAuxiliaryBody';
import { clipDrawingAt, pikachuClipClock } from '../../src/characters/actionDisplay';
import { DIRECTIONAL_AIR_DODGE_ACTION, directionalDodgeDrawing } from '../../src/characters/pikachuDirectionalDodge';
import { sampleFinalBodyPose } from '../../src/characterPresentation/legacy/finalPoseData';
import { finalVictimBodyPose } from '../../src/finalSmash/finalVictimBodyPose';
import type { FinalVictimFighter, FinalVictimProfileKey } from '../../src/finalSmash/finalVictimPresentation';
import { pikachuFinalVisualPose } from '../../port/src/fighters/finalVisual';

export type ExportedFighter = 'donkeykong' | 'link' | 'pikachu';
export const EXPORTED_FIGHTERS: readonly ExportedFighter[] = ['donkeykong', 'link', 'pikachu'];

/** One displayed drawing: a frame of a sheet with the placement the game draws it with. */
export interface ClipSample {
  readonly sheet: string;
  readonly frame: number;
  readonly sample?: number;
  /** Root position as a fraction of the sheet's cell. */
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly bodyCentreFromRootY: number;
}

export interface ExportClip {
  /** Package action id. */
  readonly action: string;
  /** frames.json clip whose held-item rows apply, when the action shows that clip. */
  readonly socketClip?: string;
  /** Which game function decides the drawing (reported). */
  readonly clock: string;
  readonly loop: number | null;
  readonly sample: (age: number) => ClipSample | null;
}

export interface SkippedClip { readonly clip: string; readonly reason: string }

interface FramesClip {
  readonly strip: string; readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number;
  readonly atlas?: readonly number[]; readonly trims?: readonly (readonly number[])[]; readonly columns?: number;
  readonly frameWindows?: readonly { readonly startFrame: number }[]; readonly nativeSampleIndices?: readonly number[];
  readonly loopDuration?: number | null; readonly coordinateOrigin?: string;
}
interface FramesFile {
  readonly animations: Readonly<Record<string, FramesClip>>;
  readonly runtimeFinalVictimProfiles?: { readonly profiles: Readonly<Record<string, unknown>> };
}
interface VisualFile {
  readonly pages: Readonly<Record<string, FramesClip>>;
  readonly clips: Readonly<Record<string, { readonly loopDuration: number | null }>>;
}

export const FRAMES: Readonly<Record<ExportedFighter, FramesFile>> = {
  donkeykong: donkeykongFrames as unknown as FramesFile,
  link: linkFrames as unknown as FramesFile,
  pikachu: pikachuFrames as unknown as FramesFile,
};
export const PIKACHU_FINAL_VISUAL = pikachuFinalVisual as unknown as VisualFile;

/** The sheet layout and file of every sheet a fighter's actions can show. */
export function sheetsOf(fighter: ExportedFighter): ReadonlyMap<string, FramesClip> {
  const sheets = new Map<string, FramesClip>();
  for (const [name, clip] of Object.entries(FRAMES[fighter].animations))
    sheets.set(name, fighter === 'pikachu' ? { ...clip, strip: `animations/${name}.png` } : clip);
  if (fighter === 'pikachu') for (const [name, page] of Object.entries(PIKACHU_FINAL_VISUAL.pages)) sheets.set(name, page);
  return sheets;
}

/** Every displayable action of a fighter with its sampler, and the clips that have no data-driven timing. */
export function exportClips(fighter: ExportedFighter): { clips: ExportClip[]; skipped: SkippedClip[] } {
  const frames = FRAMES[fighter], clips: ExportClip[] = [], skipped: SkippedClip[] = [];
  const victims = new Set(Object.keys(frames.runtimeFinalVictimProfiles?.profiles ?? {}));
  for (const [name, clip] of Object.entries(frames.animations)) {
    if (name.startsWith('fx__')) { skipped.push({ clip: name, reason: 'Final Smash or article effect: placed by effect cues, exported with effects later' }); continue; }
    if (victims.has(name)) { clips.push(victimClip(fighter, name)); continue; }
    if (name.startsWith('final_victim_')) { skipped.push({ clip: name, reason: 'victim strip with no victim profile in this file' }); continue; }
    const chosen = fighter === 'pikachu' ? pikachuClip(name, clip) : packedClip(fighter, name, clip);
    if (typeof chosen === 'string') skipped.push({ clip: name, reason: chosen }); else clips.push(chosen);
  }
  if (fighter === 'pikachu') clips.push(directionalAirDodgeClip());
  return { clips, skipped };
}

function packedClip(fighter: 'donkeykong' | 'link', name: string, clip: FramesClip): ExportClip | string {
  if (name.startsWith('final') && clip.coordinateOrigin === 'actorSourceRoot') return {
    action: name, socketClip: name, clock: 'sampleFinalBodyPose', loop: clip.loopDuration ?? null,
    sample: age => {
      const pose = sampleFinalBodyPose(fighter, name, age);
      return pose && { sheet: pose.sheet, frame: pose.index, sample: pose.sample, originX: pose.originX, originY: pose.originY,
        scale: pose.scaleToWorld, bodyCentreFromRootY: pose.bodyCentreFromRootY };
    },
  };
  if (!clip.frameWindows?.length && !clip.nativeSampleIndices?.length) return 'no timing in data (game falls back to a fixed frame rate)';
  const metrics = getPackedBodyRenderMetrics(fighter, name);
  if (!metrics) return 'no render metrics';
  const placed = (drawing: { artFrameIndex: number; nativeSample: number }): ClipSample => ({ sheet: name, frame: drawing.artFrameIndex,
    sample: drawing.nativeSample, originX: metrics.originX, originY: metrics.originY, scale: metrics.scaleToWorld,
    bodyCentreFromRootY: metrics.bodyCentreFromRootY });
  // A review pilot holds one drawing that game code substitutes at a single age of another move; the action is that drawing.
  const pilotAge = clip.frameWindows?.[0]?.startFrame ?? 0;
  if (pilotAge > 0) return {
    action: name, socketClip: name, clock: `pilot drawing (game shows it at age ${pilotAge} of its move)`, loop: null,
    sample: () => { const drawing = selectPackedDrawing(fighter, name, pilotAge); return drawing && placed(drawing); },
  };
  return {
    action: name, socketClip: name, clock: clip.frameWindows?.length ? 'selectPackedDrawing (windows)' : 'selectPackedDrawing (native samples)',
    loop: clip.loopDuration ?? null,
    sample: age => { const drawing = selectPackedDrawing(fighter, name, age); return drawing && placed(drawing); },
  };
}

function pikachuClip(name: string, clip: FramesClip): ExportClip | string {
  const visual = PIKACHU_FINAL_VISUAL.clips[name];
  if (visual) return {
    action: name, clock: 'pikachuFinalVisualPose', loop: visual.loopDuration,
    sample: age => {
      const pose = pikachuFinalVisualPose(name, age);
      return pose && { sheet: pose.key.slice('char.pikachu.'.length), frame: pose.frame, sample: pose.nativeSample,
        originX: pose.originX, originY: pose.originY, scale: pose.scale, bodyCentreFromRootY: pose.bodyCentreFromRootY };
    },
  };
  // The auxiliary source tables drive the display whenever a clip has one (simulationSpriteAnimation's auxiliary states).
  const clock = pikachuClipClock(name);
  if (!clock) return 'no timing in data or source tables';
  return {
    action: name, socketClip: name, clock: clock === 'auxiliary' ? 'selectPikachuAuxiliaryBody' : 'getPikachuReviewedStateClock',
    loop: clock === 'auxiliary' ? pikachuAuxiliaryBodyLoopFrames(name) : clip.loopDuration ?? null,
    sample: age => { const pose = clipDrawingAt('pikachu', name, age); return pose && pikachuPlaced(name, pose.artFrameIndex, pose.nativeSample); },
  };
}

function pikachuPlaced(sheet: string, frame: number, sample?: number): ClipSample {
  const metrics = getPikachuSheetRenderMetrics(sheet);
  return { sheet, frame, ...(sample === undefined ? {} : { sample }),
    originX: metrics.originX, originY: metrics.originY, scale: metrics.scaleToWorld, bodyCentreFromRootY: metrics.bodyCentreFromRootY };
}

/** The directional air dodge shows neutral `air_dodge` drawings on its own sample table, never ending. */
function directionalAirDodgeClip(): ExportClip {
  return {
    action: DIRECTIONAL_AIR_DODGE_ACTION, socketClip: 'air_dodge', clock: 'directionalDodgeDrawing', loop: null,
    sample: age => { const drawing = directionalDodgeDrawing(age, age + 1); return drawing && pikachuPlaced(drawing.sheet, drawing.artFrameIndex, drawing.nativeSample); },
  };
}

function victimClip(fighter: FinalVictimFighter, name: string): ExportClip {
  return {
    action: name, clock: 'finalVictimBodyPose', loop: null,
    sample: age => {
      const pose = finalVictimBodyPose({ targetFighter: fighter, profileKey: name as FinalVictimProfileKey, authoredAge: age,
        facing: 1, sampleBasis: 'authored-final-victim-recipe-index', nativeSample: null });
      return pose && { sheet: pose.sheet, frame: pose.index, originX: pose.originX, originY: pose.originY,
        scale: pose.scaleToWorld, bodyCentreFromRootY: pose.bodyCentreFromRootY };
    },
  };
}

export const isExportedFighter = (id: CharacterId | string): id is ExportedFighter => (EXPORTED_FIGHTERS as readonly string[]).includes(id);
