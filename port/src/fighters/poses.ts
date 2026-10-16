import { getPackedBodyRenderMetrics, installedPackedSheet, packedBodyProfile, selectPackedDrawing } from '../../../src/characters/packedBodyPresentation';
import { getPikachuReviewedStateClock, getPikachuSheetRenderMetrics } from '../../../src/characters/pikachuPresentation';
import type { CharacterId, StageLayout } from '../../../src/types';
import { PIKACHU_QUICK_ROT_PIVOT, PIKACHU_SPECIAL_ROT_PIVOT } from '../../../src/characters/pikachuSpecialTransforms';
import type { SimulationAnimationSnapshot, SimulationSpritePose } from '../../../src/characters/simulationSpriteAnimation';
import { finalBodyPose } from '../../../src/finalSmash/finalBodyPose';
import type { SpriteDraw } from '../engine/sprites/spriteLayer';
import { artTextureKey } from '../../../src/characters/artFrameSelector';
import { costumeRecolor } from './palette';
import { shootingLayerLayout, upperBodyCutRow } from '../../../src/characters/upperBodyLayer';
import type { KnockoutFlightView } from '../../../src/sim/knockoutFlight';

/**
 * Fighters for screens without a match (stage viewer, menu backdrop, demos),
 * each posed by its own presentation module from the game. The drawing's
 * root is placed at (x, y); real placement (body position, facing, state)
 * comes from MatchSim in step 6.
 */
type Facing = 1 | -1;
interface Metrics { originX: number; originY: number; scale: number; /** Body centre above the root (negative = up), design px. */ bodyCentreFromRootY: number; frameWidth?: number; frameHeight?: number }
interface Pose extends Metrics { key: string; frame: number }

/** A packed fighter's (DK, Link) sheet metrics, through its sheet aliases. */
function packedMetrics(id: CharacterId, sheet: string): Metrics | null {
  const installed = installedPackedSheet(id, sheet), clip = packedBodyProfile(id)?.clips[installed];
  const m = getPackedBodyRenderMetrics(id, installed);
  return m && { originX: m.originX, originY: m.originY, scale: m.scaleToWorld, bodyCentreFromRootY: m.bodyCentreFromRootY,
    frameWidth: clip?.frameWidth, frameHeight: clip?.frameHeight };
}
/** A packed fighter's drawing of a sheet at an age, on the clip's own clock. */
function packedPose(id: CharacterId, sheet: string, age: number): Pose | null {
  const clip = installedPackedSheet(id, sheet), m = packedMetrics(id, sheet);
  return m && { ...m, key: `char.${id}.${clip}`, frame: selectPackedDrawing(id, clip, age)?.artFrameIndex ?? 0 };
}

/** Where a sheet's drawing is rooted and how big it is: the game's presentation metrics, as MatchScene applies them. */
const METRICS: Readonly<Record<string, (sheet: string) => Metrics | null>> = {
  pikachu: (sheet) => {
    const m = getPikachuSheetRenderMetrics(sheet);
    return { originX: m.originX, originY: m.originY, scale: m.scaleToWorld, bodyCentreFromRootY: m.bodyCentreFromRootY, frameWidth: m.frameWidth, frameHeight: m.frameHeight };
  },
  donkeykong: (sheet) => packedMetrics('donkeykong', sheet),
  link: (sheet) => packedMetrics('link', sheet),
};

/** A fighter's drawing for any sheet (idle, crouch, tumble...), via its own presentation module's clock. */
const POSES: Readonly<Record<string, (sheet: string, age: number, facing: Facing) => Pose | null>> = {
  pikachu: (sheet, age) => {
    const m = METRICS.pikachu!(sheet);
    return m && { ...m, key: `char.pikachu.${sheet}`, frame: getPikachuReviewedStateClock(sheet, age)?.artFrameIndex ?? 0 };
  },
  donkeykong: (sheet, age) => packedPose('donkeykong', sheet, age),
  link: (sheet, age) => packedPose('link', sheet, age),
};

export interface IdleFighter {
  readonly characterId: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly depth?: number;
  /** Costume (palette index, 0 = the art as drawn). */
  readonly paletteIndex?: number;
  /** Uniform size multiplier on top of the fighter's world scale (menus). */
  readonly zoom?: number;
}

export function idleFighterDraw(f: IdleFighter, frame: number, tint: number): SpriteDraw | null {
  return fighterDraw(f, 'idle', frame, tint);
}

/** A fighter drawn with `sheet` at `age` frames into it, root at (x, y). */
export function fighterDraw(f: IdleFighter, sheet: string, age: number, tint: number): SpriteDraw | null {
  const p = POSES[f.characterId]?.(sheet, Math.max(0, age), f.facing);
  if (!p) return null;
  const scale = p.scale * (f.zoom ?? 1);
  // A flip mirrors the frame inside its box (Phaser), so a root-anchored
  // flip also mirrors the origin, as the game's presentation code does.
  return {
    key: p.key, frame: p.frame, x: f.x, y: f.y, depth: f.depth ?? 0, tint,
    recolor: costumeRecolor(f.characterId as CharacterId, f.paletteIndex ?? 0),
    originX: f.facing === -1 ? 1 - p.originX : p.originX, originY: p.originY,
    scaleX: scale, scaleY: scale, flipX: f.facing === -1,
  };
}

/** A fighter drawn from its body centre (what the simulation reports), e.g. a SimView fighter. */
export function fighterDrawAtBody(f: Omit<IdleFighter, 'y' | 'x'> & { position: { x: number; y: number } }, sheet: string, age: number, tint: number): SpriteDraw | null {
  const p = POSES[f.characterId]?.(sheet, Math.max(0, age), f.facing);
  if (!p) return null;
  // The root is below the body centre by the drawing's body-centre offset.
  return fighterDraw({ ...f, x: f.position.x, y: f.position.y - p.bodyCentreFromRootY }, sheet, age, tint);
}

/**
 * A simulation art pose (`createArtFrameSelector`) drawn at the body centre,
 * as MatchScene draws DK and Pikachu: the pose's sheet and frame, the
 * sheet's metrics, mirrored for facing. Null for fighters without metrics.
 * Pikachu's
 * Skull Bash and Quick Attack turn the body about the move's pivot.
 */
export function fighterDrawFromArt(
  f: { characterId: string; paletteIndex?: number; position: { x: number; y: number }; facing: Facing; depth?: number },
  art: SimulationSpritePose, tint: number, pikachuSpecial: SimulationAnimationSnapshot['pikachuSpecial'] = null,
  animation?: SimulationAnimationSnapshot,
): SpriteDraw | null {
  const sheet = art.key.replace(/\.anim$/, '').split('.').pop() ?? 'idle';
  const final = animation?.finalSmash;
  const finalMetrics = animation?.finalVictimSelection ? animation.finalVictimPose
    : final?.sheet ? finalBodyPose(f.characterId, final.sheet, final.age) : null;
  const base = METRICS[f.characterId]?.(sheet);
  const m = finalMetrics ? { ...finalMetrics, scale: finalMetrics.scaleToWorld } : base;
  const textureKey = artTextureKey(art.key);
  if (!m || !textureKey) return null;
  const flip = art.facing === -1;
  const draw: SpriteDraw = {
    key: textureKey, frame: art.frameIndex, x: f.position.x, y: f.position.y - m.bodyCentreFromRootY, depth: f.depth ?? 0, tint,
    recolor: costumeRecolor(f.characterId as CharacterId, f.paletteIndex ?? 0),
    originX: flip ? 1 - m.originX : m.originX, originY: m.originY, scaleX: m.scale * art.scaleX, scaleY: m.scale * art.scaleY, flipX: flip,
    rotation: finalMetrics && !animation?.finalVictimSelection ? (final?.rotationDegrees ?? 0) * Math.PI / 180 : 0,
  };
  const turn = pikachuSpecial && (pikachuSpecial.kind === 'skullBash' || pikachuSpecial.kind === 'quickAttack') ? pikachuSpecial : null;
  if (f.characterId !== 'pikachu' || !turn || turn.bodyRotation === 0 || !m.frameWidth || !m.frameHeight) return draw;
  // As MatchScene: move the origin to the declared source pivot (mirrored with
  // the fighter's facing, since a flip mirrors around the frame centre) and turn there.
  const pivot = turn.kind === 'quickAttack' ? PIKACHU_QUICK_ROT_PIVOT : PIKACHU_SPECIAL_ROT_PIVOT;
  const rootFromPivot = -m.bodyCentreFromRootY - pivot.y;
  const originX = m.originX + pivot.x / (m.frameWidth * m.scale);
  return {
    ...draw, originX: f.facing === 1 ? originX : 1 - originX, originY: m.originY - rootFromPivot / (m.frameHeight * m.scale),
    x: f.position.x + pivot.x * f.facing, y: f.position.y + pivot.y, rotation: turn.bodyRotation,
  };
}

/** Compose the selected shooting upper motion with its independently clocked legs.
 * These are the simulation's genuine native layers, using the existing Hip
 * registration. A plain torso/idle substitute would hide a missing layer. */
export function fighterDrawsFromArt(
  f: Parameters<typeof fighterDrawFromArt>[0], art: SimulationSpritePose, tint: number,
  pikachuSpecial: SimulationAnimationSnapshot['pikachuSpecial'] = null, animation?: SimulationAnimationSnapshot,
): SpriteDraw[] {
  const lower = fighterDrawFromArt(f, art, tint, pikachuSpecial, animation);
  if (!lower) return [];
  if (!art.overlay) return [lower];
  const upperArt: SimulationSpritePose = { ...art, ...art.overlay, overlay: undefined };
  const upper = fighterDrawFromArt(f, upperArt, tint);
  const lowerSheet = art.key.split('.')[1]!, upperSheet = upperArt.key.split('.')[1]!;
  const lm = METRICS[f.characterId]?.(lowerSheet), um = METRICS[f.characterId]?.(upperSheet);
  if (!upper || !lm?.frameHeight || !um?.frameHeight) throw new Error(`Missing shooting layer metrics: ${art.key}, ${upperArt.key}`);
  const registration = shootingLayerLayout(f.characterId as CharacterId, lowerSheet, art.frameIndex, upperSheet, upperArt.frameIndex);
  const cut = (m: Metrics) => upperBodyCutRow(f.characterId as CharacterId,
    { rootY: m.originY * m.frameHeight!, scaleToWorld: m.scale, bodyCentreFromRootY: m.bodyCentreFromRootY });
  return [
    { ...lower, clipRows: { top: registration?.lowerCutRow ?? cut(lm) } },
    { ...upper, x: upper.x + (registration?.upperOffsetX ?? 0) * art.facing,
      y: upper.y + (registration?.upperOffsetY ?? 0), depth: (f.depth ?? 0) + .01,
      clipRows: { bottom: registration?.upperCutRow ?? cut(um) } },
  ];
}

/** An accepted stage KO keeps the source tumble drawing visible through its
 * authored flight receipt, including the last stock. Its source root is
 * already positioned by the receipt; no second physical displacement. */
export function knockoutFlightDraw(flight: KnockoutFlightView, tint: number): SpriteDraw | null {
  const draw = fighterDraw({ characterId: flight.characterId, x: flight.sourceRoot.x, y: flight.sourceRoot.y,
    facing: flight.facing, paletteIndex: flight.paletteIndex, zoom: flight.scale, depth: 15 }, 'tumble', flight.age, tint);
  return draw && { ...draw, alpha: flight.alpha, rotation: flight.rotation };
}

/** Top of the widest solid platform, where idle fighters stand. */
export function groundTop(layout: StageLayout): number {
  const ground = layout.platforms.reduce((a, b) => (!b.passThrough && b.width > a.width ? b : a));
  return ground.y - ground.height / 2;
}

/** The stage viewer's stand-in cast on the first three spawn points. */
export function viewerFighterDraws(layout: StageLayout, frame: number, tint: number): SpriteDraw[] {
  const top = groundTop(layout);
  return (['donkeykong', 'pikachu', 'link'] as const).flatMap((characterId, i) => {
    const at = layout.spawnPoints[i % layout.spawnPoints.length];
    const draw = at && idleFighterDraw({ characterId, x: at.x, y: top, facing: i === 2 ? -1 : 1, depth: i }, frame, tint);
    return draw ? [draw] : [];
  });
}
