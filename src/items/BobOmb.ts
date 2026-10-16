/**
 * Bob-omb — Super Smash Bros. Ultimate throwing / explosive / living item (replaces the test Bomb).
 *
 * Every value is listed with its source and label in docs/review/2026-10-11/ultimate-items/phase-5/sources.json:
 *   • sourced (SmashWiki Bob-omb / Item / Item_throw, wins): explosion 25%; thrown damage per throw kind (Ultimate
 *     column, 30.6–33.5%); meteor smash when thrown downward, otherwise diagonally upward; the explosion never harms
 *     the user; ignores the 0.8× thrown-item knockback multiplier; horizontal throw speed cap 3; explodes when thrown
 *     into a player, when hit by an attack (held or not) and when it walks into a player; an un-picked Bob-omb stands
 *     up, walks back and forth on its platform (turning at edges), then stands still flashing red and explodes; a held
 *     one flashes red after a while and then explodes in the holder's hands; light throwing item;
 *   • native-derived (SmashWiki silent; WuBoytH SSBU-Dumped-Scripts @59004685 item/bombhei game_Born / game_BornThrow,
 *     ultimate-13.0.1 item_common row bombhei): explosion angle 361 / KBG 90 / BKB 30 / radius 12 units / hitlag ×0.5,
 *     thrown kinetics (gravity 0.074, max fall 2.0, air brake 0.0025, outer limit x 3, throw rebound), receiving size 3,
 *     body size;
 *   • authored (SmashWiki only qualitative, native bombhei_* params not dumped locally): idle-to-walk, walk and flash
 *     frames, held fuse, walk speed, explosion active frames, the meteor angle (270).
 * SSB4-scoped rules carried over (Ultimate not restated): it walks toward the nearest fighter, and it can be picked up
 * while walking.
 *
 * Phaser-free and deterministic: the runtime state is a plain record on the ItemEntity.
 */
import type { HitInfo } from '../characters/combat';
import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import { ultimateItemThrowProfile } from './nativeItemThrow';

/** A spawned explosion (add-spawned-object: the drawn circle is this radius). */
export interface ItemExplosionSpec {
  readonly damage: number;
  /** Damage-area radius, px (native units × 5). */
  readonly radius: number;
  /** Centre of the blast above the item root, px. */
  readonly centreAboveRoot: number;
  readonly activeFrames: number;
  readonly knockback: { readonly base: number; readonly growth: number; readonly fixed: number; readonly angle: number };
  readonly hitlagMultiplier: number;
  /** The blast also hits the item's user (Link's Remote Bomb). */
  readonly hitsOwner?: true;
}

export interface BobOmbSpec {
  /** Grounded frames before it stands up and walks. */
  readonly idleFrames: number;
  /** Frames it walks before it stops and flashes. */
  readonly walkFrames: number;
  /** Frames it flashes red before exploding (grounded and held). */
  readonly flashFrames: number;
  /** Held frames before the held fuse starts flashing. */
  readonly heldFuseFrames: number;
  /** px / frame. */
  readonly walkSpeed: number;
  /** Receiving / walking-contact radius, px. */
  readonly contactRadius: number;
  readonly explosion: ItemExplosionSpec;
}

export type BobOmbPhase = 'idle' | 'walking' | 'flashing';

export interface BobOmbState {
  readonly phase: BobOmbPhase;
  /** Grounded frames spent in `phase`. */
  readonly phaseFrames: number;
  /** Frames held in a hand (cumulative). */
  readonly heldFrames: number;
  readonly direction: 1 | -1;
}

export const BOB_OMB_INITIAL_STATE: BobOmbState = Object.freeze({ phase: 'idle', phaseFrames: 0, heldFrames: 0, direction: 1 });

/** Where the Bob-omb is this step: in a hand, lying / walking on a platform, or in flight. */
export type BobOmbSituation = 'held' | 'grounded' | 'airborne';

/**
 * One fixed step of the fuse. `toward` is the direction of the nearest fighter, used when it starts walking.
 * Returns the next state and whether it explodes now.
 */
export function stepBobOmb(spec: BobOmbSpec, state: BobOmbState, situation: BobOmbSituation,
  toward: 1 | -1): { readonly state: BobOmbState; readonly explode: boolean } {
  if (situation === 'airborne') return { state, explode: false };
  if (situation === 'held') {
    const heldFrames = state.heldFrames + 1;
    return { state: { ...state, phase: 'idle', phaseFrames: 0, heldFrames },
      explode: heldFrames >= spec.heldFuseFrames + spec.flashFrames };
  }
  const phaseFrames = state.phaseFrames + 1;
  if (state.phase === 'idle') return { state: phaseFrames >= spec.idleFrames
    ? { ...state, phase: 'walking', phaseFrames: 0, direction: toward } : { ...state, phaseFrames }, explode: false };
  if (state.phase === 'walking') return { state: phaseFrames >= spec.walkFrames
    ? { ...state, phase: 'flashing', phaseFrames: 0 } : { ...state, phaseFrames }, explode: false };
  return { state: { ...state, phaseFrames }, explode: phaseFrames >= spec.flashFrames };
}

/** Flashing red: standing still before the grounded explosion, or the held fuse running out. */
export function bobOmbFlashing(spec: BobOmbSpec, state: BobOmbState): boolean {
  return state.phase === 'flashing' || state.heldFrames >= spec.heldFuseFrames;
}

/** The explosion's hit on one target; `facing` sends it away from the blast centre (native ATTACK_LR_CHECK_POS).
 * Explosive hitboxes skip the 0.8× thrown-item knockback multiplier (SmashWiki Item_throw). */
export function itemExplosionHit(spec: ItemExplosionSpec, facing: 1 | -1, damageMultiplier = 1): HitInfo {
  return { damage: spec.damage * damageMultiplier, knockback: { x: 0, y: 0, scaling: 0, reference: spec.knockback },
    facing, hitlagMultiplier: spec.hitlagMultiplier, sdiMultiplier: 1, direct: false };
}

/** game_Born / game_BornThrow: ATTACK_FP 25%, angle 361, KBG 90, FKB 0, BKB 30, size 12, collision_attr_fire, hitlag 0.5. */
export const BOB_OMB_EXPLOSION: ItemExplosionSpec = Object.freeze({
  damage: 25,
  radius: 60,
  // item_common bombhei mapcoll_size_down 3.9 units: the body centre above the feet.
  centreAboveRoot: 19.5,
  // Authored: the native hitbox lives for the Born status, whose length is not dumped.
  activeFrames: 4,
  knockback: Object.freeze({ base: 30, growth: 90, fixed: 0, angle: 361 }),
  hitlagMultiplier: .5,
});

export const BOB_OMB_SPEC: BobOmbSpec = Object.freeze({
  // Authored (SmashWiki: "after a while" / "within a few seconds of its appearance").
  idleFrames: 300,
  // Authored (SmashWiki: "a brief period of walking").
  walkFrames: 300,
  // Authored (SmashWiki: "stand still while flashing red, and then explode" / "shortly after").
  flashFrames: 60,
  // Authored (SmashWiki: "held by a player for a while").
  heldFuseFrames: 540,
  // Authored (bombhei_walk_speed not dumped).
  walkSpeed: 1.5,
  // item_common bombhei hitsize 3 units.
  contactRadius: 15,
  explosion: BOB_OMB_EXPLOSION,
});

const THROW = 31.6, THROW_VERTICAL = 30.6, THROW_STRONG = 33.5;

export const BOB_OMB_DEFINITION: ItemDefinition = Object.freeze({
  type: 'bobOmb',
  itemClass: 'throwing',
  // It never idles out: its own fuse ends it (SmashWiki: "Bob-omb itself explodes rather than despawns").
  ttlFrames: Number.MAX_SAFE_INTEGER,
  brokenDespawnFrames: 0,
  // item_common bombhei: throw_speed_mul 1, gravity 0.074, gravity max 2.0, air brake 0.0025, outer limit x 3
  // (SmashWiki Item_throw: horizontal speed cap 3) and y 3 (an up throw is capped too: SmashWiki's up and down throws
  // deal the same 30.6%), bound_refspeed_throw 0.12 / 0.2 / 1.7; body centre 3.9 units up,
  // clip sphere 3.7. The formula damage is replaced by the SmashWiki table below for every throw kind.
  throwProfile: ultimateItemThrowProfile({ damage: 25, mapBottom: 3.9, attackRadius: 3.7,
    kinetics: Object.freeze({ gravity: .074, terminalFallSpeed: 2, airBrakeX: .0025, maxSpeedX: 3, maxSpeedY: 3,
      throwRebound: Object.freeze({ mul: .12, addX: .2, addY: 1.7 }) }),
    // The thrown Bob-omb's hit is its explosion: explosion launch, no 0.8× multiplier.
    knockback: BOB_OMB_EXPLOSION.knockback, referenceKnockbackMultiplier: 1 }),
  thrownHit: Object.freeze({
    // SmashWiki Bob-omb#Damage_output, Ultimate column. "Air throw" (30.6) is read as the Z-drop.
    damageByAction: Object.freeze({
      'throw-ground-forward-ordinary': THROW, 'throw-ground-back-ordinary': THROW,
      'throw-ground-up-ordinary': THROW_VERTICAL, 'throw-ground-down-ordinary': THROW_VERTICAL,
      'dash-throw': THROW_STRONG,
      'throw-ground-forward-strong': THROW_STRONG, 'throw-ground-back-strong': THROW_STRONG,
      'throw-ground-up-strong': THROW_VERTICAL, 'throw-ground-down-strong': THROW_VERTICAL,
      'air-z-drop': THROW_VERTICAL,
      'throw-air-forward-ordinary': THROW, 'throw-air-back-ordinary': THROW,
      'throw-air-up-ordinary': THROW_VERTICAL, 'throw-air-down-ordinary': THROW_VERTICAL,
      'throw-air-forward-strong': THROW_STRONG, 'throw-air-back-strong': THROW_STRONG,
      'throw-air-up-strong': THROW_VERTICAL, 'throw-air-down-strong': THROW_VERTICAL,
    }),
    // Meteor smash when thrown downward (SmashWiki); the angle is authored (straight down).
    downKnockback: Object.freeze({ ...BOB_OMB_EXPLOSION.knockback, angle: 270 }),
  }),
  bobOmb: BOB_OMB_SPEC,
  // item_common bombhei pickup_range 6 × 6 units around the body centre.
  pickupBounds: Object.freeze({ offsetX: 0, offsetY: -19.5, width: 30, height: 30 }),
  visual: Object.freeze({ spriteKey: ASSET_KEYS.itemBobOmb, width: 40, height: 46, restAngle: 0 }),
});
