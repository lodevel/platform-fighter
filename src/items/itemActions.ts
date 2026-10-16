/**
 * The one item pickup / throw / drop planner for every fighter (Ultimate items, phase 2).
 *
 * Generalised from Donkey Kong's native item planner. What varies per fighter
 * lives in a {@link FighterItemProfile} (release frames, toss strength, item
 * acquisition range); everything else is the shared Ultimate rule set
 * (docs/review/2026-10-11/ultimate-items/spec/universal-rules.json):
 *   • `dropToss.inputs/directions/smashThrow/dashThrow/zDrop`: grab (or shield+attack) throws in four
 *     directions, a tapped stick is a smash throw (ground and air), a throw out of a dash is a dash
 *     throw, a neutral press drops (ground drop for battering/shooting items only, Z-drop in the air);
 *   • `dropToss.frameTotals`: every fighter's totals are 24 (forward/back) / 23 (up, ground drop) /
 *     19 (down) / 29 (dash); SmashWiki's per-character release ("Throw") frames are carried over;
 *   • `dropToss.tossStrengthTable` + `tossStrengthByWeight`: release speed and angle per throw kind,
 *     times the fighter's toss strength;
 *   • `dropToss.groundedDropHalved`: a ground drop throws with power 0.5.
 * Sources and labels per value: docs/review/2026-10-11/ultimate-items/phase-2/sources.json.
 *
 * Phaser-free and deterministic.
 */
import type { CharacterId } from '../types';
import type { ItemClass } from './ItemDefinition';

export type ItemDirection = 'forward' | 'back' | 'up' | 'down' | 'drop';
export type ItemStrength = 'ordinary' | 'strong';
export type ItemAction = 'pickup-standing' | 'pickup-walking'
  | 'ground-drop' | 'air-z-drop' | 'dash-throw'
  | `throw-${'ground' | 'air'}-${Exclude<ItemDirection, 'drop'>}-${ItemStrength}`;

// ---------------------------------------------------------------------------
// Per-fighter data
// ---------------------------------------------------------------------------

/** Native item acquisition range (fighter_param item_range_*), native units. */
export interface ItemCatchRange {
  readonly ground: { readonly front: number; readonly frontMax: number; readonly back: number; readonly height: number; readonly offsetY: number };
  readonly air: { readonly front: number; readonly back: number; readonly height: number; readonly offsetY: number };
}

export interface FighterItemProfile {
  /** fighter_param throw_item_speed_mul (SmashWiki: toss strength ≈ 1 + (weight − 100) / 300). */
  readonly tossSpeedMultiplier: number;
  /** fighter_param throw_item_power_mul. */
  readonly tossPowerMultiplier: number;
  /** Frame of the pickup / release callback in each item motion (1-based native frame). */
  readonly events: Readonly<{ pickup: number; forward: number; back: number; up: number; down: number; drop: number; dash: number }>;
  /** Back throws turn the fighter around (REVERSE_LR) on this frame, before the release. */
  readonly backReverseFrame: number;
  /** FT_MOTION_RATE of the dash throw. */
  readonly dashMotionRate: number;
  readonly catchRange: ItemCatchRange;
}

/** Native fighter_param (Coolsonickirby prcFighterParam, revision 609dc95f) and WuBoytH
 * item motion scripts; release frames equal SmashWiki Item_throw "Throw" columns. */
export const FIGHTER_ITEM_PROFILES: Readonly<Partial<Record<CharacterId, FighterItemProfile>>> = Object.freeze({
  donkeykong: Object.freeze({
    tossSpeedMultiplier: 1.09, tossPowerMultiplier: 1,
    events: Object.freeze({ pickup: 2, forward: 10, back: 14, up: 15, down: 8, drop: 7, dash: 6 }),
    backReverseFrame: 11, dashMotionRate: .92,
    catchRange: Object.freeze({
      ground: Object.freeze({ front: 18, frontMax: 27, back: 9.71429, height: 14.25, offsetY: 7.125 }),
      air: Object.freeze({ front: 13.5, back: 9.71429, height: 19, offsetY: 9.5 }),
    }),
  }),
  pikachu: Object.freeze({
    tossSpeedMultiplier: .93, tossPowerMultiplier: 1,
    events: Object.freeze({ pickup: 2, forward: 12, back: 14, up: 15, down: 8, drop: 7, dash: 5 }),
    backReverseFrame: 7, dashMotionRate: .92,
    catchRange: Object.freeze({
      ground: Object.freeze({ front: 11.5, frontMax: 14.5, back: 5.72857, height: 8, offsetY: 4 }),
      air: Object.freeze({ front: 8.625, back: 5.72857, height: 10, offsetY: 5 }),
    }),
  }),
  // Link (fresh rebuild): prcFighterParam @609dc95f Link row and the ItemLight* release callbacks.
  link: Object.freeze({
    tossSpeedMultiplier: 1.01333, tossPowerMultiplier: 1,
    events: Object.freeze({ pickup: 2, forward: 7, back: 9, up: 11, down: 6, drop: 5, dash: 4 }),
    backReverseFrame: 4, dashMotionRate: .92,
    catchRange: Object.freeze({
      ground: Object.freeze({ front: 13.5, frontMax: 17.5, back: 6.78571, height: 12.75, offsetY: 6.375 }),
      air: Object.freeze({ front: 10.125, back: 6.78571, height: 17, offsetY: 8.5 }),
    }),
  }),
});

/** Authored stand-in for fighters without item work (masked roster): standard toss strength and
 * Donkey Kong's frames and range. Only DK and Pikachu are playable. */
export const DEFAULT_FIGHTER_ITEM_PROFILE: FighterItemProfile = Object.freeze({
  ...FIGHTER_ITEM_PROFILES.donkeykong!, tossSpeedMultiplier: 1,
});

export function fighterItemProfile(id: CharacterId): FighterItemProfile {
  return FIGHTER_ITEM_PROFILES[id] ?? DEFAULT_FIGHTER_ITEM_PROFILE;
}

// ---------------------------------------------------------------------------
// Input: direction and smash (flick) strength
// ---------------------------------------------------------------------------

/** Stick magnitude at or below which a throw press is neutral (a drop). */
const NEUTRAL_THROW_STICK = .4;

/** The single throw-direction resolver: dominant stick axis relative to the entry facing
 * (horizontal wins ties); a neutral stick is a drop. */
export function resolveItemThrowDirection(moveX: number, moveY: number, entryFacing: 1 | -1): ItemDirection {
  if (Math.max(Math.abs(moveX), Math.abs(moveY)) <= NEUTRAL_THROW_STICK) return 'drop';
  if (Math.abs(moveY) > Math.abs(moveX)) return moveY < 0 ? 'up' : 'down';
  return moveX * entryFacing > 0 ? 'forward' : 'back';
}

/** Published normal-sensitivity smash-input window: a directional flick younger than 6 (ground)
 * or 8 (air) frames makes a smash throw. */
export function selectItemStrength(airborne: boolean, directionFlickAge: number | null): ItemStrength {
  return directionFlickAge !== null && Number.isInteger(directionFlickAge)
    && directionFlickAge >= 0 && directionFlickAge < (airborne ? 8 : 6) ? 'strong' : 'ordinary';
}
export type ItemWorldDirection = 'left' | 'right' | 'up' | 'down';
export interface ItemFlickState {
  readonly qualifiedDirection: ItemWorldDirection | null;
  readonly flickDirection: ItemWorldDirection | null;
  readonly flickAge: number | null;
}
export const EMPTY_ITEM_FLICK: ItemFlickState = Object.freeze({ qualifiedDirection: null, flickDirection: null, flickAge: null });
/** Threshold .66, reset dead zone .3 and dominant axis (horizontal ties) are explicit input
 * adapters; the source sets the 6/8 windows, not the stick thresholds. A held direction never
 * refreshes. Frozen (hitlag) steps pause the age. */
export function advanceItemFlick(state: ItemFlickState,
  input: { readonly moveX: number; readonly moveY: number; readonly frozen?: boolean }): ItemFlickState {
  if (!Number.isFinite(input.moveX) || !Number.isFinite(input.moveY)
    || Math.abs(input.moveX) > 1 || Math.abs(input.moveY) > 1) throw new RangeError('Item stick must be finite in[-1,1]');
  const max = Math.max(Math.abs(input.moveX), Math.abs(input.moveY));
  let qualifiedDirection = state.qualifiedDirection;
  if (max < .3) qualifiedDirection = null;
  else if (max >= .66) qualifiedDirection = Math.abs(input.moveY) > Math.abs(input.moveX)
    ? input.moveY < 0 ? 'up' : 'down' : input.moveX < 0 ? 'left' : 'right';
  if (qualifiedDirection !== null && qualifiedDirection !== state.qualifiedDirection) {
    return { qualifiedDirection, flickDirection: qualifiedDirection, flickAge: 0 };
  }
  return { qualifiedDirection, flickDirection: state.flickDirection,
    flickAge: state.flickAge === null ? null : state.flickAge + (input.frozen ? 0 : 1) };
}
export function itemFlickStrength(state: ItemFlickState, airborne: boolean,
  direction: ItemDirection, entryFacing: 1 | -1): ItemStrength {
  const world = direction === 'up' || direction === 'down' ? direction
    : direction === 'drop' ? null : (direction === 'forward' ? entryFacing : -entryFacing) === 1 ? 'right' : 'left';
  return state.flickDirection === world ? selectItemStrength(airborne, state.flickAge) : 'ordinary';
}

// ---------------------------------------------------------------------------
// Eligibility and selection
// ---------------------------------------------------------------------------

/** Throws start when actionable, or cancel a shield, a jump squat, the first 3 frames of a roll
 * (glide toss, SmashWiki 2-frame window measured natively as 3) or a neutral air dodge (Z-drop). */
export function eligibleItemThrowContext(input: {
  readonly airborne: boolean; readonly normalActionable: boolean; readonly externallyBlocked?: boolean;
  readonly shielding?: boolean; readonly jumpSquatActive?: boolean;
  readonly dodgeKind?: 'roll' | 'back-roll' | 'spot' | 'air-neutral' | 'air-directional';
  readonly dodgeAge?: number; readonly direction: ItemDirection;
}): 'ordinary' | 'shield-cancel' | 'jump-cancel' | 'roll-cancel' | 'air-z-drop-cancel' | null {
  if (input.externallyBlocked) return null;
  if (input.normalActionable) return 'ordinary';
  if (!input.airborne && input.shielding) return 'shield-cancel';
  if (!input.airborne && input.jumpSquatActive) return 'jump-cancel';
  if (input.dodgeAge !== undefined && Number.isInteger(input.dodgeAge)
    && input.dodgeAge >= 0 && input.dodgeAge < 3) {
    if (!input.airborne && (input.dodgeKind === 'roll' || input.dodgeKind === 'back-roll')) return 'roll-cancel';
    if (input.airborne && input.dodgeKind === 'air-neutral' && input.direction === 'drop') return 'air-z-drop-cancel';
  }
  return null;
}

/** Strong = a fresh directional flick, never merely a held stick. A neutral ground press drops
 * only the item classes SmashWiki lists (battering, shooting); other items are thrown forward. */
export function selectItemThrow(input: {
  readonly airborne: boolean; readonly direction: ItemDirection;
  readonly strength: ItemStrength; readonly dashing?: boolean;
  readonly groundDropAllowed?: boolean;
}): ItemAction {
  if (input.direction === 'drop') return input.airborne ? 'air-z-drop'
    : input.groundDropAllowed ? 'ground-drop' : 'throw-ground-forward-ordinary';
  if (!input.airborne && input.dashing && input.direction === 'forward' && input.strength === 'ordinary') return 'dash-throw';
  return `throw-${input.airborne ? 'air' : 'ground'}-${input.direction}-${input.strength}`;
}

/** The throw a press with a held light item starts, or null. Grab (or shield + attack) releases any item along the
 * stick (a neutral stick drops); the attack or smash button throws a throwing item (universal-rules.json
 * attackInput.throwingItemAttackButton: "pressing the attack button will simply throw the item"), a neutral stick
 * throwing it forward and the smash button making a smash throw. */
export function selectHeldItemPress(input: {
  readonly releasePress: boolean; readonly attackPress: boolean; readonly smashPress: boolean;
  readonly itemClass: ItemClass; readonly airborne: boolean; readonly dashing: boolean;
  readonly moveX: number; readonly moveY: number; readonly entryFacing: 1 | -1; readonly flick: ItemFlickState;
}): ItemAction | null {
  const attackThrow = input.itemClass === 'throwing' && (input.attackPress || input.smashPress);
  if (!input.releasePress && !attackThrow) return null;
  const resolved = resolveItemThrowDirection(input.moveX, input.moveY, input.entryFacing);
  const direction = !input.releasePress && resolved === 'drop' ? 'forward' : resolved;
  const strength = !input.releasePress && input.smashPress ? 'strong'
    : itemFlickStrength(input.flick, input.airborne, direction, input.entryFacing);
  return selectItemThrow({ airborne: input.airborne, direction, strength, dashing: input.dashing,
    groundDropAllowed: input.itemClass === 'battering' || input.itemClass === 'shooting' });
}

/** Attack near a grounded item picks it up (SmashWiki Item). From a dash or run the press is the
 * dash attack, whose 5-frame catch window takes the item; walking uses the walking pickup. */
export function selectGroundPickup(input: { readonly moveX: number; readonly locomotion: string }):
  'pickup-standing' | 'pickup-walking' | null {
  if (input.locomotion === 'initialDash' || input.locomotion === 'run') return null;
  return Math.abs(input.moveX) > .1 ? 'pickup-walking' : 'pickup-standing';
}

// ---------------------------------------------------------------------------
// Action plans
// ---------------------------------------------------------------------------

export interface ItemActionPlan {
  readonly action: ItemAction;
  /** Native motion name; presentation maps it to the fighter's body sheet. */
  readonly motion: string | null;
  readonly nativeScript: string | null;
  readonly sourceEventFrame: number;
  readonly sourceReverseFrame?: number;
  readonly nativeMotionRate: number;
  readonly durationFrames: number;
  readonly throwParameters?: { readonly speedNative: number; readonly angleDegrees: number; readonly power: number };
}

/** Ultimate totals (dropToss.frameTotals) and the native pickup cancel frames (8 / 20 − 1). */
const DURATION = Object.freeze({ forward: 24, back: 24, up: 23, down: 19, drop: 23, dash: 29, pickupStanding: 7, pickupWalking: 19 });

export function getItemActionPlan(action: ItemAction, profile: FighterItemProfile): ItemActionPlan {
  const e = profile.events;
  if (action === 'air-z-drop') return { action, motion: null, nativeScript: null,
    sourceEventFrame: 1, nativeMotionRate: 1, durationFrames: 0,
    throwParameters: { speedNative: 0, angleDegrees: 0, power: 1 } };
  if (action === 'pickup-standing' || action === 'pickup-walking') {
    const walking = action === 'pickup-walking';
    return { action, motion: walking ? 'item_light_walk_get' : 'item_light_get',
      nativeScript: walking ? 'ItemLightWalkGet' : 'ItemLightGet', sourceEventFrame: e.pickup,
      nativeMotionRate: 1, durationFrames: walking ? DURATION.pickupWalking : DURATION.pickupStanding };
  }
  if (action === 'ground-drop') return { action, motion: 'item_light_throw_drop',
    nativeScript: 'ItemLightThrowDrop', sourceEventFrame: e.drop, nativeMotionRate: 1, durationFrames: DURATION.drop,
    throwParameters: { speedNative: 2.1, angleDegrees: 100, power: .5 } };
  if (action === 'dash-throw') return { action, motion: 'item_light_throw_dash',
    nativeScript: 'ItemLightThrowDash', sourceEventFrame: e.dash, nativeMotionRate: profile.dashMotionRate,
    durationFrames: DURATION.dash, throwParameters: { speedNative: 3.4, angleDegrees: 12, power: 1 } };
  const [, situation, direction, strength] = action.split('-') as [string, 'ground' | 'air', Exclude<ItemDirection, 'drop'>, ItemStrength];
  const air = situation === 'air', strong = strength === 'strong';
  const suffix = direction === 'forward' ? 'f' : direction === 'back' ? 'b' : direction === 'up' ? 'hi' : 'lw';
  const scriptSuffix = direction === 'forward' ? 'F' : direction === 'back' ? 'B' : direction === 'up' ? 'Hi' : 'Lw';
  return { action, motion: `item_light_throw_${air ? 'air_' : ''}${suffix}${strong ? '4' : ''}`,
    nativeScript: `ItemLightThrow${air ? 'Air' : ''}${scriptSuffix}${strong ? '4' : ''}`,
    sourceEventFrame: e[direction], ...(direction === 'back' ? { sourceReverseFrame: profile.backReverseFrame } : {}),
    nativeMotionRate: 1, durationFrames: DURATION[direction],
    throwParameters: { speedNative: direction === 'up' ? strong ? 4.1 : 3.1
      : direction === 'down' ? strong ? 4.62 : 3.3 : strong ? 3.64 : 2.6,
      angleDegrees: direction === 'up' ? 90 : direction === 'down' ? -90 : strong ? 11 : air ? 14 : 17,
      power: 1 } };
}

/** Fighter release velocity (px/frame, screen y down, 5 px per native unit), before the item's own
 * speed factors and caps (nativeItemReleaseVelocity). Entry facing sets the world direction even
 * after a back throw's REVERSE_LR. */
export function itemReleaseVelocity(plan: ItemActionPlan, entryFacing: 1 | -1, profile: FighterItemProfile) {
  if (!plan.throwParameters) throw new RangeError('Pickup has no item release velocity');
  const p = plan.throwParameters, radians = p.angleDegrees * Math.PI / 180;
  const speed = p.speedNative * profile.tossSpeedMultiplier;
  const direction = plan.action.includes('-back-') ? -entryFacing : entryFacing;
  let x = Math.cos(radians) * speed * direction;
  let y = -Math.sin(radians) * speed;
  if (Math.abs(x) < 1e-12) x = 0;
  if (Math.abs(y) < 1e-12) y = 0;
  return { x: x * 5, y: y * 5, power: p.power * profile.tossPowerMultiplier };
}

// ---------------------------------------------------------------------------
// Action clock
// ---------------------------------------------------------------------------

export interface ItemActionState {
  readonly plan: ItemActionPlan;
  readonly framesElapsed: number;
  readonly nativeFrame: number;
  readonly facing: 1 | -1;
  readonly eventEmitted: boolean;
  readonly reverseEmitted: boolean;
}
export type ItemActionEvent = { readonly kind: 'pickup' | 'release' | 'reverse-facing'; readonly facing: 1 | -1 };
export interface ItemActionStep {
  readonly state: ItemActionState | null;
  readonly events: readonly ItemActionEvent[];
}

export function beginItemAction(action: ItemAction, facing: 1 | -1, profile: FighterItemProfile): ItemActionStep {
  const plan = getItemActionPlan(action, profile);
  if (action === 'air-z-drop') return { state: null, events: [{ kind: 'release', facing }] };
  return { state: { plan, framesElapsed: 0, nativeFrame: 1, facing,
    eventEmitted: false, reverseEmitted: false }, events: [] };
}

/** Entry is native frame 1 / age 0. Each unfrozen step advances the motion by its rate and emits
 * each callback once when crossed. Interruption before the callback leaves ownership unchanged. */
export function tickItemAction(state: ItemActionState,
  input: { readonly frozen?: boolean; readonly interrupted?: boolean } = {}): ItemActionStep {
  if (input.interrupted) return { state: null, events: [] };
  if (input.frozen) return { state, events: [] };
  const framesElapsed = state.framesElapsed + 1;
  if (framesElapsed >= state.plan.durationFrames) return { state: null, events: [] };
  const nativeFrame = state.nativeFrame + state.plan.nativeMotionRate;
  let facing = state.facing, reverseEmitted = state.reverseEmitted, eventEmitted = state.eventEmitted;
  const events: ItemActionEvent[] = [];
  if (!reverseEmitted && state.plan.sourceReverseFrame !== undefined && nativeFrame >= state.plan.sourceReverseFrame) {
    facing = facing === 1 ? -1 : 1; reverseEmitted = true;
    events.push({ kind: 'reverse-facing', facing });
  }
  if (!eventEmitted && nativeFrame >= state.plan.sourceEventFrame) {
    eventEmitted = true;
    events.push({ kind: state.plan.action.startsWith('pickup-') ? 'pickup' : 'release', facing });
  }
  return { state: { ...state, framesElapsed, nativeFrame, facing, reverseEmitted, eventEmitted }, events };
}

/** Body sheet a fighter draws for an item action (engine key names, native motion contract). */
export function itemActionSheet(plan: ItemActionPlan): string {
  return plan.action === 'pickup-standing' ? 'item_pickup_stand' : plan.action === 'pickup-walking' ? 'item_pickup_walk'
    : plan.motion?.replace('item_light_throw_', 'item_throw_') ?? 'item_carry';
}
