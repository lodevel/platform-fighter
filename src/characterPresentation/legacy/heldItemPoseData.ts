/**
 * Held-item socket: where the drawn hand (Pikachu: mouth) holds an item in the drawing a fighter shows
 * right now, and the item's direction there. One reader for every fighter with item art.
 *
 * Position rows are `itemAttachmentPoses` in the fighter's gameplay.json, one per drawing, derived from the native
 * item socket bone (DK and Link `HaveR`, Pikachu `Have`) at the drawing's native sample
 * (docs/review/2026-10-11/ultimate-items/phase-2/sockets/derive_item_sockets.py): world px from the body centre,
 * facing right. The item stays in the drawn hand.
 *
 * Direction comes from the fighter's item-axes.json (docs/review/2026-10-11/ultimate-items/phase-4/sockets/
 * derive_item_axes.py): the native bone's +Y (blades, bats, rods) or +Z (gun barrels) projected on the side view,
 * [Phaser degrees facing right (0 = up, 90 = forward), in-plane length 0..1]. A native-timed item clip carries one
 * entry per native frame, so the item turns with the native bone at 60 Hz between sparse drawings (a forward smash
 * swings through its forward contact frame even when no drawing sits on it); other clips carry one per drawing.
 * The drawing is the one the renderer selects (resolveSimulationAction + selectActionArtFrame); an upper-body overlay
 * (shooting while walking) holds the item, so its drawing wins. No row = no socket (hand anchor fallback).
 */
import donkeykongGameplay from '../../../assets/characters/donkeykong/gameplay.json';
import pikachuGameplay from '../../../assets/characters/pikachu/gameplay.json';
import linkGameplay from '../../../assets/characters/link/gameplay.json';
import donkeykongAxes from '../../../assets/characters/donkeykong/item-axes.json';
import pikachuAxes from '../../../assets/characters/pikachu/item-axes.json';
import linkAxes from '../../../assets/characters/link/item-axes.json';
import type { CharacterId } from '../../types';
import { resolveSimulationAction, selectActionArtFrame, type ActionPose, type SimulationAnimationSnapshot } from '../../characters/simulationSpriteAnimation';
import { clipOfSheet } from '../../characters/actionDisplay';
import { shootingLayerLayout, type ShootingLayerLayout } from '../../characters/upperBodyLayer';

export interface ItemAttachmentPose {
  readonly artFrameIndex: number;
  readonly nativeSample: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly angle: number;
}
/** Which native socket axis an item's sprite points along (its long axis, grip at the sprite bottom). */
export type ItemSocketAxis = 'y' | 'z';
type Axis = readonly [angle: number, length: number];
interface AxisEntry { readonly y: Axis; readonly z: Axis }
interface AxisClip { readonly drawings: readonly (AxisEntry | null)[]; readonly frames?: readonly AxisEntry[]; readonly loop?: number }
interface SocketClip { readonly frameCount: number; readonly itemAttachmentPoses?: readonly ItemAttachmentPose[] }

const CLIPS: Readonly<Partial<Record<CharacterId, Readonly<Record<string, SocketClip>>>>> = {
  donkeykong: donkeykongGameplay.animations as unknown as Record<string, SocketClip>,
  pikachu: pikachuGameplay.animations as unknown as Record<string, SocketClip>,
  link: linkGameplay.animations as unknown as Record<string, SocketClip>,
};
const AXES: Readonly<Partial<Record<CharacterId, Readonly<Record<string, AxisClip>>>>> = {
  donkeykong: donkeykongAxes.clips as unknown as Record<string, AxisClip>,
  pikachu: pikachuAxes.clips as unknown as Record<string, AxisClip>,
  link: linkAxes.clips as unknown as Record<string, AxisClip>,
};


/** The axis at the action's native frame when the clip has a per-frame table, else at the drawing. */
function selectAxis(clip: AxisClip | undefined, art: number, age: number | undefined): AxisEntry | null {
  if (!clip) return null;
  const frames = clip.frames;
  if (frames?.length && age !== undefined && Number.isFinite(age) && age >= 0) {
    const index = clip.loop ? Math.floor(age) % clip.loop : Math.min(Math.floor(age), frames.length - 1);
    return frames[index] ?? null;
  }
  return clip.drawings[art] ?? null;
}

export interface HeldItemSocket {
  readonly x: number;
  readonly y: number;
  /** Phaser degrees with facing applied (0 = up). */
  readonly angle: number;
  /** In-plane fraction of the item axis (1 = flat in the picture, small = pointing at / away from the camera). */
  readonly length: number;
}

/** The socket a clip's drawing holds at an action age, facing right, before any upper-body layer offset;
 * null without a socket row. Shared by the live socket below and the character package export. */
export function heldItemSocketAt(id: CharacterId, clip: string, art: number, age: number | undefined, axis: ItemSocketAxis = 'y'): HeldItemSocket | null {
  const row = CLIPS[id]?.[clip]?.itemAttachmentPoses?.find(r => r.artFrameIndex === art);
  if (!row) return null;
  const direction = selectAxis(AXES[id]?.[clip], art, age)?.[axis];
  return { x: row.position.x, y: row.position.y, angle: direction?.[0] ?? row.angle, length: direction?.[1] ?? 1 };
}

/** The same selected source-age drawings drive body joining, held item and shot origin. */
function selectShootingLayerLayout(s: SimulationAnimationSnapshot): ShootingLayerLayout | null {
  if (s.characterId !== 'pikachu') return null;
  const action = resolveSimulationAction(s), upperPose = action.overlay;
  if (!upperPose) return null;
  const clips = CLIPS[s.characterId];
  if (!clips) return null;
  const lowerSheet = action.sheets.find(name => clips[name]);
  const upperSheet = upperPose.sheets.find(name => clips[name]);
  if (!lowerSheet || !upperSheet) return null;
  const lowerArt = selectActionArtFrame(action, clips[lowerSheet]!.frameCount, lowerSheet, null);
  const upperArt = selectActionArtFrame(upperPose, clips[upperSheet]!.frameCount, upperSheet, null);
  if (lowerArt === null || upperArt === null) return null;
  return shootingLayerLayout(s.characterId, lowerSheet, lowerArt, upperSheet, upperArt);
}

/** The socket offset from the body centre with facing applied, or null without a socket row. */
export function sampleHeldItemSocket(s: SimulationAnimationSnapshot, axis: ItemSocketAxis = 'y'): HeldItemSocket | null {
  const clips = CLIPS[s.characterId];
  if (!clips) return null;
  const action = resolveSimulationAction(s);
  // The upper-body layer holds the item when one is composed over the legs.
  const pose: ActionPose = action.overlay ?? action;
  for (const sheet of pose.sheets) {
    const name = clipOfSheet(s.characterId, sheet);
    const clip = clips[name];
    if (!clip) continue;
    const art = selectActionArtFrame(pose, clip.frameCount, sheet, null);
    const socket = art === null ? null : heldItemSocketAt(s.characterId, name, art, pose.frame, axis);
    if (!socket) return null;
    const facing = action.facing ?? s.facing;
    const layout = selectShootingLayerLayout(s);
    return { x: (socket.x + (layout?.upperOffsetX ?? 0)) * facing,
      y: socket.y + (layout?.upperOffsetY ?? 0), angle: socket.angle * facing, length: socket.length };
  }
  return null;
}

/** Lowest in-plane scale a held item sprite is drawn at (authored foreshortening floor; the renderer draws the sprite
 * bottom on the socket with its height scaled by max(floor, socket length)). */
export const HELD_ITEM_MIN_FORESHORTENING = .35;

/** The point `share` of the way along a held item drawn from its grip (0 = grip, 1 = far end): the item's height,
 * foreshortened by the socket length, along the socket angle (degrees clockwise from up). */
function alongHeldItem(grip: { readonly x: number; readonly y: number }, angle: number, length: number, height: number, share: number) {
  const radians = angle * Math.PI / 180, drawn = height * Math.max(HELD_ITEM_MIN_FORESHORTENING, length) * share;
  return { x: grip.x + Math.sin(radians) * drawn, y: grip.y - Math.cos(radians) * drawn };
}

/** The drawn far end of a held item (a gun's muzzle, a blade's tip): the socket plus the sprite's drawn length along
 * the socket axis. Same rule the held-item renderer draws with; null when the socket has no axis (hand anchor
 * fallback), so the caller keeps its authored offset. Socket and result are in the same frame (world or body). */
export function heldItemMuzzle(socket: { readonly x: number; readonly y: number; readonly angle: number | null; readonly length: number },
  visual: { readonly height: number }): { x: number; y: number } | null {
  return socket.angle === null ? null : alongHeldItem(socket, socket.angle, socket.length, visual.height, 1);
}

/** How a held item's sprite is drawn: its bottom (`rootPosition`) on the grip and, when it turns with the hand, along
 * `turn` (angle in degrees with facing applied, in-plane length), mirrored for facing and foreshortened. `position`
 * is the sprite centre; `angle` is in radians. The one placement rule for every source of grip. */
export function heldItemPlacement(grip: { readonly x: number; readonly y: number }, height: number,
  turn: { readonly angle: number; readonly length: number; readonly facing: 1 | -1 } | null) {
  const rootPosition = { x: grip.x, y: grip.y };
  if (!turn) return { rootPosition, position: alongHeldItem(grip, 0, 1, height, .5), angle: 0, scaleX: 1, scaleY: 1 };
  return { rootPosition, position: alongHeldItem(grip, turn.angle, turn.length, height, .5), angle: turn.angle * Math.PI / 180,
    scaleX: turn.facing, scaleY: Math.max(HELD_ITEM_MIN_FORESHORTENING, turn.length) };
}
