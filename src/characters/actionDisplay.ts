/**
 * What a character package shows for the drawing the legacy art selector chose: the package action
 * (the exported clip id, scripts/character-package/legacyClips.ts) at a tick of its own clock, plus the
 * placement the legacy draw adds (port/src/fighters/poses.ts): Final and special rotation, squash and
 * the shooting overlay's waist line.
 */
import pikachuGameplay from '../../assets/characters/pikachu/gameplay.json';
import { legacySheet } from '../assets/legacyFighterSheets';
import { EFFECT_ACTION_PREFIX } from '../../character/package/types';
import type { ActionDisplay, ActionDisplayOverlay } from '../characterPresentation/contracts';
import type { CharacterId } from '../types';
import { getPackedBodyRenderMetrics, installedPackedSheet, packedBodyProfile, selectPackedDrawing } from './packedBodyPresentation';
import { selectPikachuAuxiliaryBody } from './pikachuAuxiliaryBody';
import { getPikachuReviewedStateClock, getPikachuSheetRenderMetrics } from './pikachuPresentation';
import { PIKACHU_QUICK_ROT_PIVOT, PIKACHU_SPECIAL_ROT_PIVOT } from './pikachuSpecialTransforms';
import { shootingLayerLayout, upperBodyCutRow, type LayerMetrics } from './upperBodyLayer';
import type { ActionPose, SimulationAnimationSnapshot } from './simulationSpriteAnimation';

const reviewedClips = pikachuGameplay.animations as Readonly<Record<string, { readonly frameWindows?: readonly unknown[] }>>;

/** The clip, and package action, a runtime sheet draws: a packed fighter's alias, and Pikachu's forward tilt texture is the `ftilt` clip. */
export function clipOfSheet(id: CharacterId, sheet: string): string {
  return id === 'pikachu' && sheet === 'tilt' ? 'ftilt' : installedPackedSheet(id, sheet);
}

/** The package action of an effect strip (`fx__<name>` → `effect.<name>`), placed and timed by the game's effect code. */
export function effectAction(sheet: string): string {
  return EFFECT_ACTION_PREFIX + sheet.replace(/^fx__/, '');
}

/** Which clock decides an ordinary Pikachu clip's drawings: its auxiliary source table when it has one, else its reviewed windows. */
export function pikachuClipClock(sheet: string): 'auxiliary' | 'reviewed' | null {
  if (selectPikachuAuxiliaryBody(sheet, 0) !== null) return 'auxiliary';
  return reviewedClips[sheet]?.frameWindows?.length ? 'reviewed' : null;
}

/** The drawing an ordinary clip shows at an age on its own clock, which is what the package action of the same id shows. */
export function clipDrawingAt(id: CharacterId, sheet: string, age: number): { readonly artFrameIndex: number; readonly nativeSample?: number } | null {
  if (packedBodyProfile(id)) return selectPackedDrawing(id, sheet, age);
  if (id !== 'pikachu') return null;
  const clock = pikachuClipClock(sheet);
  return clock === 'auxiliary' ? selectPikachuAuxiliaryBody(sheet, age) : clock === 'reviewed' ? getPikachuReviewedStateClock(sheet, age) : null;
}

/** A drawing chosen by the legacy selector: the texture sheet it comes from and its index. */
export interface ShownDrawing { readonly sheet: string; readonly frameIndex: number }

/** Longest search for the first tick showing a drawing; longer than any installed clip. */
const SEARCH_TICKS = 1200;
const firstTicks = new Map<string, number | null>();

function showsAt(id: CharacterId, shown: ShownDrawing, tick: number): boolean {
  try { return clipDrawingAt(id, shown.sheet, tick)?.artFrameIndex === shown.frameIndex; } catch { return false; }
}

/** `preferred` when the clip shows the drawing then, else the first tick it does (null: never). */
function tickShowing(id: CharacterId, shown: ShownDrawing, preferred: number): number | null {
  if (Number.isInteger(preferred) && preferred >= 0 && showsAt(id, shown, preferred)) return preferred;
  const key = `${id}/${shown.sheet}/${shown.frameIndex}`;
  if (!firstTicks.has(key)) {
    let found: number | null = null;
    for (let tick = 0; tick < SEARCH_TICKS && found === null; tick++) if (showsAt(id, shown, tick)) found = tick;
    firstTicks.set(key, found);
  }
  return firstTicks.get(key)!;
}

/** The package action and tick of a pose; null when its drawing is not shown by any tick of an exported action. */
function shownAction(id: CharacterId, pose: ActionPose, shown: ShownDrawing, stateElapsed: number): { action: string; tick: number } | null {
  if (pose.display) return pose.display;
  const clock = pose.frame ?? stateElapsed;
  // A pose on its clip's own clock shows that clip's package action at the same tick.
  if (pose.directArtFrame !== undefined || pose.reviewedSheet || pose.nativeTimedSheet) return { action: shown.sheet, tick: clock };
  // Generic fallbacks (attack timeline, phase, hold, duration, fixed rate) choose a drawing rather than a tick:
  // show it at the pose's clock when the clip agrees, else at the first tick the clip shows it.
  const tick = tickShowing(id, shown, clock);
  return tick === null ? null : { action: shown.sheet, tick };
}

/** Root row, scale and body centre of a sheet's drawings, as the legacy draw places them. */
function layerMetrics(id: CharacterId, sheet: string): LayerMetrics | null {
  if (id === 'pikachu') {
    const m = getPikachuSheetRenderMetrics(sheet);
    return { rootY: m.originY * m.frameHeight, scaleToWorld: m.scaleToWorld, bodyCentreFromRootY: m.bodyCentreFromRootY };
  }
  const m = getPackedBodyRenderMetrics(id, sheet), image = legacySheet(id, sheet);
  return m && image ? { rootY: m.originY * image.frameHeight, scaleToWorld: m.scaleToWorld, bodyCentreFromRootY: m.bodyCentreFromRootY } : null;
}

function overlayDisplay(id: CharacterId, pose: ActionPose, base: ShownDrawing, upper: ShownDrawing, stateElapsed: number): ActionDisplayOverlay | null {
  const shown = shownAction(id, pose, upper, stateElapsed), lower = layerMetrics(id, base.sheet), top = layerMetrics(id, upper.sheet);
  if (!shown || !lower || !top) return null;
  const layout = shootingLayerLayout(id, base.sheet, base.frameIndex, upper.sheet, upper.frameIndex);
  const designY = (row: number, m: LayerMetrics) => (row - m.rootY) * m.scaleToWorld;
  return { ...shown, offset: { x: layout?.upperOffsetX ?? 0, y: layout?.upperOffsetY ?? 0 },
    clip: { base: designY(layout?.lowerCutRow ?? upperBodyCutRow(id, lower), lower),
      overlay: designY(layout?.upperCutRow ?? upperBodyCutRow(id, top), top) } };
}

/** The package display of a selected pose; null when its drawing is not part of any exported action. */
export function describeActionDisplay(s: SimulationAnimationSnapshot, pose: ActionPose, texture: ShownDrawing,
  upperTexture: ShownDrawing | null, stateElapsed: number): ActionDisplay | null {
  const id = s.characterId, clip = (shown: ShownDrawing) => ({ ...shown, sheet: clipOfSheet(id, shown.sheet) });
  const base = clip(texture), upper = upperTexture && clip(upperTexture), shown = shownAction(id, pose, base, stateElapsed);
  if (!shown) return null;
  // Skull Bash and Quick Attack turn the body about the move's pivot.
  const special = s.pikachuSpecial, turn = id === 'pikachu' && special && special.bodyRotation !== 0
    && (special.kind === 'skullBash' || special.kind === 'quickAttack') ? special : null;
  const rotation = turn ? turn.bodyRotation : pose.display?.rotation;
  const scale = { x: pose.scaleX ?? 1, y: pose.scaleY ?? 1 };
  const overlay = pose.overlay && upper ? overlayDisplay(id, pose.overlay, base, upper, stateElapsed) : null;
  return { action: shown.action, tick: shown.tick, facing: pose.facing ?? s.facing,
    ...(rotation ? { rotation } : {}),
    ...(turn ? { pivot: { ...(turn.kind === 'quickAttack' ? PIKACHU_QUICK_ROT_PIVOT : PIKACHU_SPECIAL_ROT_PIVOT) } } : {}),
    ...(scale.x !== 1 || scale.y !== 1 ? { scale } : {}),
    ...(overlay ? { overlay } : {}) };
}

/** The package display of a sheet shown at an age of its own clock outside a match pose (menus, knockout flight). */
export function sheetDisplay(id: CharacterId, sheet: string, age: number, facing: 1 | -1): ActionDisplay {
  return { action: clipOfSheet(id, sheet), tick: Math.max(0, age), facing };
}
