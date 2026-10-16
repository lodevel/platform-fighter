/** Native DK SuperLift status translation. Retained primary function bodies:
 * mechanics/sources/heavy-status/verified.json and heavy-native-status-contract.
 * Motion-end integer sample adapters are explicit; common jump/kinetic setup,
 * speed-linked walking rates and raw-KB→reaction-frame conversion remain outside
 * this controller. Native Y stick is positive upward, unlike project screen Y.
 */
export type DonkeyKongHeavyCarryStatus = 'wait' | 'walk' | 'turn' | 'jump-squat' | 'jump' | 'fall' | 'landing' | 'pass';
export const DONKEYKONG_HEAVY_STATUS_RULES = Object.freeze({
  walkStick: .18, turnStick: -.2, turnTimer: 1,
  passStickY: -.6875, passFlickFrames: 6,
  turnSamples: 12, jumpSquatSamples: 6, landingSamples: 18, jumpSamples: 26,
  reactionFlyThresholdFrames: 32,
});
export interface DonkeyKongHeavyCarryState {
  readonly phase: DonkeyKongHeavyCarryStatus;
  readonly age: number;
  readonly facing: 1 | -1;
  readonly targetFacing: 1 | -1;
  readonly turnTimer: number;
  readonly turnCompleted: boolean;
  readonly reserveMiniJump: boolean;
}
export interface DonkeyKongHeavyCarryObservation {
  readonly grounded: boolean;
  readonly holdingHeavy: boolean;
  readonly nativeStickX?: number;
  readonly nativeStickY?: number;
  readonly downFlickAge?: number | null;
  readonly passableFloor?: boolean;
  readonly freshJump?: boolean;
  readonly jumpHeld?: boolean;
  readonly freshAttack?: boolean;
  readonly frozen?: boolean;
  /** Caller provides actual source motion-end for jump or custom drawing
   * resources. Fixed6/12/18 adapters apply when this is omitted. */
  readonly motionEnded?: boolean;
}
export type DonkeyKongHeavyCarryEvent =
  | { readonly kind: 'throw'; readonly facing: 1 | -1 }
  | { readonly kind: 'reverse-facing'; readonly facing: 1 | -1 }
  | { readonly kind: 'ground-jump'; readonly mini: boolean }
  | { readonly kind: 'pass-platform' }
  | { readonly kind: 'release-carry-state'; readonly destination: 'wait' | 'fall' };

export function beginDonkeyKongHeavyCarry(grounded: boolean, facing: 1 | -1): DonkeyKongHeavyCarryState {
  return { phase: grounded ? 'wait' : 'fall', age: 0, facing, targetFacing: facing,
    turnTimer: 1, turnCompleted: false, reserveMiniJump: false };
}
function enter(state: DonkeyKongHeavyCarryState, phase: DonkeyKongHeavyCarryStatus): DonkeyKongHeavyCarryState {
  return { ...state, phase, age: 0, turnTimer: 1, turnCompleted: false, reserveMiniJump: false,
    targetFacing: phase === 'turn' ? state.facing === 1 ? -1 : 1 : state.facing };
}
function ended(state: DonkeyKongHeavyCarryState, observation: DonkeyKongHeavyCarryObservation): boolean {
  if (observation.motionEnded !== undefined) return observation.motionEnded;
  const total = state.phase === 'turn' ? DONKEYKONG_HEAVY_STATUS_RULES.turnSamples
    : state.phase === 'jump-squat' ? DONKEYKONG_HEAVY_STATUS_RULES.jumpSquatSamples
      : state.phase === 'landing' ? DONKEYKONG_HEAVY_STATUS_RULES.landingSamples
        : state.phase === 'jump' ? DONKEYKONG_HEAVY_STATUS_RULES.jumpSamples : null;
  return total !== null && state.age >= total;
}

export function tickDonkeyKongHeavyCarry(state: DonkeyKongHeavyCarryState, observation: DonkeyKongHeavyCarryObservation): {
  state: DonkeyKongHeavyCarryState | null; events: readonly DonkeyKongHeavyCarryEvent[];
} {
  if (!observation.holdingHeavy) return { state: null,
    events: [{ kind: 'release-carry-state', destination: observation.grounded ? 'wait' : 'fall' }] };
  if (observation.frozen) return { state, events: [] };
  const events: DonkeyKongHeavyCarryEvent[] = [];
  let next = { ...state, age: state.age + 1 };
  if (state.phase === 'turn' && !state.turnCompleted) {
    if (state.turnTimer >= 0) next.turnTimer = state.turnTimer - 1;
    else {
      next.turnCompleted = true; next.facing = state.targetFacing;
      events.push({ kind: 'reverse-facing', facing: next.facing });
    }
  }
  if (state.phase === 'jump-squat' && observation.jumpHeld === false) next.reserveMiniJump = true;
  // Native turn and squat test motion-end before their remaining input routes.
  if ((state.phase === 'turn' || state.phase === 'jump-squat') && ended(next, observation)) {
    if (state.phase === 'jump-squat') {
      events.push({ kind: 'ground-jump', mini: next.reserveMiniJump });
      return { state: enter(next, 'jump'), events };
    }
    return { state: enter(next, observation.grounded ? 'wait' : 'fall'), events };
  }
  if (state.phase === 'landing') {
    if (!observation.grounded) return { state: enter(next, 'fall'), events };
    if (ended(next, observation)) return { state: enter(next, 'wait'), events };
    return { state: next, events };
  }
  // Throw entry is a separate action; caller leaves the carry phase and owns
  // the delayed release. Native ground turn gates attack on completed facing.
  const mayThrow = state.phase === 'wait' || state.phase === 'walk' || state.phase === 'jump'
    || state.phase === 'fall' || state.phase === 'pass'
    || observation.grounded && (state.phase === 'jump-squat' || state.phase === 'turn' && next.turnCompleted);
  if (observation.freshAttack && mayThrow) return { state: next,
    events: [...events, { kind: 'throw', facing: next.facing }] };
  if (state.phase === 'jump') {
    return { state: ended(next, observation) ? enter(next, 'fall') : next, events };
  }
  if (!observation.grounded) return { state: state.phase === 'fall' || state.phase === 'pass' ? next : enter(next, 'fall'), events };
  if (state.phase === 'fall' || state.phase === 'pass') return { state: enter(next, 'landing'), events };
  if (state.phase === 'jump-squat') return { state: next, events };
  if (observation.freshJump && (state.phase !== 'turn' || next.turnCompleted)) {
    return { state: enter(next, 'jump-squat'), events };
  }
  if (state.phase === 'turn') return { state: next, events };
  const stick = observation.nativeStickX ?? 0;
  if (!Number.isFinite(stick)) throw new RangeError('Heavy carry stick must be finite');
  if (stick * next.facing <= DONKEYKONG_HEAVY_STATUS_RULES.turnStick) return { state: enter(next, 'turn'), events };
  if (state.phase === 'wait' && stick * next.facing >= DONKEYKONG_HEAVY_STATUS_RULES.walkStick)
    return { state: enter(next, 'walk'), events };
  if (state.phase === 'walk' && Math.abs(stick) < DONKEYKONG_HEAVY_STATUS_RULES.walkStick)
    return { state: enter(next, 'wait'), events };
  const downAge = observation.downFlickAge;
  if ((observation.nativeStickY ?? 0) <= DONKEYKONG_HEAVY_STATUS_RULES.passStickY && downAge !== null
    && downAge !== undefined && downAge >= 0 && downAge < DONKEYKONG_HEAVY_STATUS_RULES.passFlickFrames
    && observation.passableFloor) return { state: enter(next, 'pass'), events: [...events, { kind: 'pass-platform' }] };
  return { state: next, events };
}

/** Native calc_reaction_frame's output is supplied by the caller. Do not pass
 * damage percent or raw knockback here without an independently sourced adapter.
 * Native sleep/sleep_ex bypass resistance and drop the held object. */
export function resolveDonkeyKongHeavyCarryDamage(reactionFrames: number, collisionAttribute: string): {
  resistsReaction: boolean; dropItem: boolean;
} {
  if (!Number.isFinite(reactionFrames) || reactionFrames < 0) throw new RangeError('Reaction frames must be finite and nonnegative');
  const sleep = collisionAttribute === 'collision_attr_sleep' || collisionAttribute === 'collision_attr_sleep_ex';
  const resistsReaction = reactionFrames < DONKEYKONG_HEAVY_STATUS_RULES.reactionFlyThresholdFrames && !sleep;
  return { resistsReaction, dropItem: !resistsReaction };
}

export function donkeyKongHeavyCarryMayGrabLedge(): false {
  // All captured SuperLift air statuses initialize CLIFF_CHECK_NONE and their
  // complete acquired private loops never enable a cliff transition.
  return false;
}
