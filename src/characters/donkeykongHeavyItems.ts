import { fighterItemProfile, selectItemStrength, type ItemStrength } from '../items/itemActions';
import type { CharacterId } from '../types';
import type { DonkeyKongHeavyCarryState } from './donkeykongHeavyCarry';

/** Native DK heavy-item command callbacks and published throw table.
 * Source: mechanics/heavy-item-runtime-contract.json. Heavy action commands
 * contain no rate override; this timeline selects an authored unit rate.
 * Pickup's native rate is 2 times an unrecovered engine query; heavy throw's
 * common rate consumer is missing (workbook parameter 1.33 is retained).
 * Back's release
 * occurs BEFORE REVERSE_LR in the same native20 callback.
 * Sourced carry transitions and the conditional reaction-frame armor rule are
 * in donkeykongHeavyCarry; lift kinetics and reaction conversion stay unresolved.
 */
export type DonkeyKongHeavyDirection = 'forward' | 'back' | 'up' | 'down';
export type DonkeyKongHeavyItemAction = 'pickup' | `throw-${DonkeyKongHeavyDirection}-${ItemStrength}`;
export interface DonkeyKongHeavyItemPlan {
  readonly action: DonkeyKongHeavyItemAction;
  readonly motion: string;
  readonly nativeScript: string;
  readonly selectedMotionRate: 1;
  readonly sourceEventFrame: number;
  readonly sourceReverseAfterRelease?: true;
  readonly sourceReverseBeforeReleaseFrame?: number;
  readonly sourceOffset?: { readonly x: number; readonly y: number };
  readonly nativeCancelFrame: number;
  readonly durationFrames: number;
  readonly throwParameters?: { readonly speedNative: number; readonly angleDegrees: number; readonly power: number };
}
/** One fighter's heavy-item data: the native ItemHeavy* callbacks (pickup / release frames, the back throw's
 * REVERSE_LR, THROW_ITEM_OFFSET) and how its carry walks. Everything else (cancel frames, throw table, clocks) is
 * shared. Sources: DK mechanics/heavy-item-runtime-contract.json; Pikachu
 * docs/review/2026-10-06/pikachu-character/sources/scripts/pikachu/ItemHeavy*.txt; Link native ItemHeavy* callbacks
 * (fresh rebuild, prcFighterParam @609dc95f Link row). */
export interface FighterHeavyItemProfile {
  readonly pickupEvent: number;
  readonly releaseEvents: Readonly<Record<DonkeyKongHeavyDirection, number>>;
  /** The back throw turns around after its release callback (same native frame), or before it on this frame. */
  readonly backReverse: 'after-release' | number;
  readonly sourceOffsets: Readonly<Record<DonkeyKongHeavyDirection, { readonly x: number; readonly y: number }>>;
  readonly carry: {
    /** Ground-only carry (no jumps, dash, air carry or attacks; held items are dropped in the air), else DK's
     * native carry status (donkeykongHeavyCarry). */
    readonly groundOnly: boolean;
    /** null: DK's walk speed and acceleration × the cargo walk multiplier (SmashWiki). Otherwise the walk is capped
     * at the native item_lift_speed_max and accelerates by a calibrated ground-acceleration multiplier or by the
     * native item_lift_accel_add (the common lift consumer is missing; adapters, not native formulas). */
    readonly walk: null | { readonly maximumSpeedNative: number; readonly groundAccelMultiplier?: number;
      readonly accelerationNative?: number };
  };
  /** Native fighter_param item_lift_* (record). */
  readonly lift: { readonly accelerationMultiplierNative: number; readonly accelerationAddNative: number;
    readonly maximumSpeedNative: number };
}

/** Native lift parameters (supporting record only). The grounded heavy walk follows SmashWiki
 * instead: DK's walk speed and acceleration × 1.1 (Character.ts, GrabSpec cargo.walkMultiplier). */
export const DONKEYKONG_HEAVY_CARRY_PARAMETERS = Object.freeze({
  accelerationMultiplierNative: .0976923, accelerationAddNative: .03, maximumSpeedNative: 1.3246,
  armorThresholdNative: null, jumpVelocityNative: null, gravityScaleNative: null,
});
export const FIGHTER_HEAVY_ITEM_PROFILES: Readonly<Partial<Record<CharacterId, FighterHeavyItemProfile>>> = Object.freeze({
  donkeykong: Object.freeze({
    pickupEvent: 5, releaseEvents: Object.freeze({ forward: 18, back: 20, up: 15, down: 14 }), backReverse: 'after-release',
    sourceOffsets: Object.freeze({ forward: { x: 21, y: 10 }, back: { x: -23, y: 10 }, up: { x: 0, y: 42 }, down: { x: 0, y: 1 } }),
    carry: Object.freeze({ groundOnly: false, walk: null }),
    lift: DONKEYKONG_HEAVY_CARRY_PARAMETERS,
  }),
  pikachu: Object.freeze({
    pickupEvent: 4, releaseEvents: Object.freeze({ forward: 22, back: 22, up: 15, down: 14 }), backReverse: 19,
    sourceOffsets: Object.freeze({ forward: { x: 12, y: 16 }, back: { x: 14, y: 16 }, up: { x: -3, y: 18 }, down: { x: 0, y: 1 } }),
    // Acceleration calibrated (.5 of the ground acceleration), independent of DK's 1.1 walk multiplier.
    carry: Object.freeze({ groundOnly: true, walk: Object.freeze({ maximumSpeedNative: .84208, groundAccelMultiplier: .5 }) }),
    lift: Object.freeze({ accelerationMultiplierNative: .0607692, accelerationAddNative: .03, maximumSpeedNative: .84208 }),
  }),
  link: Object.freeze({
    pickupEvent: 4, releaseEvents: Object.freeze({ forward: 20, back: 20, up: 14, down: 13 }), backReverse: 'after-release',
    sourceOffsets: Object.freeze({ forward: { x: 18, y: 15 }, back: { x: -20, y: 15 }, up: { x: 0, y: 28 }, down: { x: 0, y: 3 } }),
    carry: Object.freeze({ groundOnly: true, walk: Object.freeze({ maximumSpeedNative: 1.08988, accelerationNative: .03 }) }),
    lift: Object.freeze({ accelerationMultiplierNative: .08, accelerationAddNative: .03, maximumSpeedNative: 1.08988 }),
  }),
});

/** A fighter's heavy-item profile; fighters without item work use Donkey Kong's. */
export function fighterHeavyItemProfile(id: CharacterId): FighterHeavyItemProfile {
  return FIGHTER_HEAVY_ITEM_PROFILES[id] ?? FIGHTER_HEAVY_ITEM_PROFILES.donkeykong!;
}

/** The heavy action plan: the fighter's callbacks over the shared timeline and throw table. Heavy action commands
 * contain no rate override; this timeline selects an authored unit rate. */
export function heavyItemPlan(fighter: CharacterId, action: DonkeyKongHeavyItemAction): DonkeyKongHeavyItemPlan {
  const profile = fighterHeavyItemProfile(fighter);
  if (action === 'pickup') return { action, motion: 'item_heavy_get', nativeScript: 'ItemHeavyGet',
    selectedMotionRate: 1, sourceEventFrame: profile.pickupEvent, nativeCancelFrame: 25, durationFrames: 24 };
  const [, direction, strength] = action.split('-') as [string, DonkeyKongHeavyDirection, ItemStrength];
  const strong = strength === 'strong';
  const suffix = direction === 'forward' ? 'f' : direction === 'back' ? 'b' : direction === 'up' ? 'hi' : 'lw';
  const scriptSuffix = direction === 'forward' ? 'F' : direction === 'back' ? 'B' : direction === 'up' ? 'Hi' : 'Lw';
  const side = direction === 'forward' || direction === 'back';
  const cancel = side ? 40 : 30;
  const reverse = direction !== 'back' ? {} : profile.backReverse === 'after-release'
    ? { sourceReverseAfterRelease: true as const } : { sourceReverseBeforeReleaseFrame: profile.backReverse };
  return { action, motion: `item_heavy_throw_${suffix}${strong ? '4' : ''}`,
    nativeScript: `ItemHeavyThrow${scriptSuffix}${strong ? '4' : ''}`, selectedMotionRate: 1,
    sourceEventFrame: profile.releaseEvents[direction], ...reverse,
    sourceOffset: { ...profile.sourceOffsets[direction] },
    nativeCancelFrame: cancel, durationFrames: cancel - 1,
    throwParameters: { speedNative: side ? strong ? 4.4 : 3.4 : strong ? 6 : 4.8,
      angleDegrees: direction === 'up' ? 90 : direction === 'down' ? strong ? -70 : -90 : strong ? 17 : 60,
      power: 1 } };
}

/** Ground-only heavy carry step: walk or wait by the stick, turn at once (authored; the common heavy-turn status is
 * missing). The sparse native heavy walk / wait drawings follow this clock. */
export function stepGroundOnlyHeavyCarry(state: DonkeyKongHeavyCarryState, moveX: number): DonkeyKongHeavyCarryState {
  const facing: 1 | -1 = moveX < -.18 ? -1 : moveX > .18 ? 1 : state.facing;
  const phase = Math.abs(moveX) >= .18 ? 'walk' : 'wait';
  return { ...state, phase, age: phase === state.phase ? state.age + 1 : 0, facing,
    targetFacing: facing, turnCompleted: true, reserveMiniJump: false };
}
/** A ground-only carry's body motion: the native heavy walk on the carry clock; otherwise the lift's last drawing
 * held (native item_heavy_get; no heavy wait motion was captured). */
export function groundOnlyHeavyCarryMotion(carry: Pick<DonkeyKongHeavyCarryState, 'phase' | 'age'>): { motion: string; age: number } {
  return carry.phase === 'walk' ? { motion: 'item_heavy_walk', age: carry.age } : { motion: 'item_heavy_get', age: 24 };
}
/** Heavy neutral input throws forward; no dash-throw or Z-drop exists.
 * Caller supplies the desired direction's actual qualified flick age. */
export function selectDonkeyKongHeavyThrow(input: {
  readonly direction: DonkeyKongHeavyDirection | 'drop'; readonly airborne: boolean; readonly directionFlickAge: number | null;
}): DonkeyKongHeavyItemAction {
  const direction = input.direction === 'drop' ? 'forward' : input.direction;
  return `throw-${direction}-${input.direction === 'drop' ? 'ordinary' : selectItemStrength(input.airborne, input.directionFlickAge)}`;
}
export function donkeyKongHeavyReleaseVelocity(plan: DonkeyKongHeavyItemPlan, entryFacing: 1 | -1, fighter: CharacterId = 'donkeykong'): { x: number; y: number; power: number } {
  if (!plan.throwParameters) throw new RangeError('Heavy pickup has no release velocity');
  const direction = plan.action.startsWith('throw-back-') ? -entryFacing : entryFacing;
  const angle = plan.throwParameters.angleDegrees * Math.PI / 180;
  const profile = fighterItemProfile(fighter);
  const speed = plan.throwParameters.speedNative * profile.tossSpeedMultiplier * 5;
  return { x: Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle) * speed * direction,
    y: -Math.sin(angle) * speed, power: plan.throwParameters.power * profile.tossPowerMultiplier };
}
export interface DonkeyKongHeavyItemState {
  readonly plan: DonkeyKongHeavyItemPlan; readonly framesElapsed: number;
  readonly nativeFrame: number; readonly entryFacing: 1 | -1; readonly facing: 1 | -1; readonly eventEmitted: boolean;
}
export type DonkeyKongHeavyItemEvent = { readonly kind: 'pickup' | 'release' | 'reverse-facing'; readonly facing: 1 | -1 };
export function beginDonkeyKongHeavyItemAction(action: DonkeyKongHeavyItemAction, facing: 1 | -1, fighter: CharacterId = 'donkeykong'): {
  state: DonkeyKongHeavyItemState; events: readonly DonkeyKongHeavyItemEvent[];
} {
  return { state: { plan: heavyItemPlan(fighter, action), framesElapsed: 0, nativeFrame: 1,
    entryFacing: facing, facing, eventEmitted: false }, events: [] };
}
export function tickDonkeyKongHeavyItemAction(state: DonkeyKongHeavyItemState, input: {
  readonly frozen?: boolean; readonly interrupted?: boolean;
} = {}): { state: DonkeyKongHeavyItemState | null; events: readonly DonkeyKongHeavyItemEvent[] } {
  if (input.interrupted) return { state: null, events: [] };
  if (input.frozen) return { state, events: [] };
  const age = state.framesElapsed + 1, nativeFrame = state.nativeFrame + state.plan.selectedMotionRate;
  const events: DonkeyKongHeavyItemEvent[] = [];
  let emitted = state.eventEmitted, facing = state.facing;
  const reverse = state.plan.sourceReverseBeforeReleaseFrame;
  if (reverse !== undefined && state.nativeFrame < reverse && nativeFrame >= reverse) {
    facing = facing === 1 ? -1 : 1;
    events.push({ kind: 'reverse-facing', facing });
  }
  if (!emitted && nativeFrame >= state.plan.sourceEventFrame) {
    // Native heavy back callback releases in OLD facing, then reverses.
    events.push({ kind: state.plan.action === 'pickup' ? 'pickup' : 'release', facing });
    emitted = true;
    if (state.plan.sourceReverseAfterRelease) {
      facing = facing === 1 ? -1 : 1;
      events.push({ kind: 'reverse-facing', facing });
    }
  }
  return { state: age < state.plan.durationFrames ? { ...state, framesElapsed: age, nativeFrame, facing, eventEmitted: emitted } : null, events };
}

export function canDonkeyKongStartHeavyPickup(input: {
  readonly grounded: boolean; readonly holdingItem: boolean; readonly candidateHeavy: boolean;
  readonly candidateAvailable: boolean; readonly actionable: boolean; readonly externallyBlocked?: boolean;
}): boolean {
  return input.grounded && !input.holdingItem && input.candidateHeavy && input.candidateAvailable
    && input.actionable && !input.externallyBlocked;
}
export function getDonkeyKongHeavyCarryPolicy(grounded: boolean, busy: boolean) {
  return { canWalk: grounded && !busy, canJump: grounded && !busy, canThrow: !busy,
    canRetainOnLedgeFall: true, canDash: false, canAirJump: false, canAttack: false,
    canSpecial: false, canShield: false, canDodge: false, canTaunt: false, canZDrop: false } as const;
}
export type DonkeyKongHeavyCarryPhase = 'wait' | 'walk-slow' | 'walk-middle' | 'walk-fast' | 'turn'
  | 'jump-squat' | 'jump' | 'fall' | 'landing';
/** Explicit caller phase: no invented gait thresholds or cancel0 commitments. */
export function getDonkeyKongHeavyCarryMotion(phase: DonkeyKongHeavyCarryPhase) {
  const key = phase.replaceAll('-', '_');
  const speedLinkedWalk = phase.startsWith('walk-');
  return { motion: `super_lift_${key}`, authoredDrawingRate: 1 as const,
    nativeStatusRate: speedLinkedWalk ? null : 1, scriptMotionRateOverride: null, nativeCancelFrame: 0,
    // Native status exits at motion end, never at cancel0. These are the
    // selected integer-sample adapters over retained resource extents.
    durationFrames: phase === 'turn' ? 12 : phase === 'jump-squat' ? 6 : phase === 'landing' ? 18 : null,
    loop: ['wait', 'walk-slow', 'walk-middle', 'walk-fast', 'fall'].includes(phase),
    statusOwned: true as const };
}

/** Native fighter_param walk_middle_ratio=.5/walk_fast_ratio=.75 support this
 * speed-normalized adapter. Their missing common status consumer and native
 * drawing rates are not recovered, so this is not native gait parity. */
export function selectDonkeyKongHeavyWalkGait(speed: number, maximum: number): 'walk-slow' | 'walk-middle' | 'walk-fast' {
  const fraction = maximum > 0 ? Math.min(1, Math.abs(speed) / maximum) : 0;
  return fraction < .5 ? 'walk-slow' : fraction < .75 ? 'walk-middle' : 'walk-fast';
}
