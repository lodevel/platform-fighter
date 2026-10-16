import type { LocomotionInput, LocomotionState, ResolvedLocomotionTuning } from './locomotionState';
import { stepDonkeyKongGroundVelocity } from './donkeykongGroundMovement';
import { DONKEYKONG_UFD_STATS } from './donkeykongUfdStats';

/** DK-only input adapter; Pikachu's existing state/physics path is untouched.
 * Native YAML cancel22/20 yields21/19; turn_run cancel0 remains status-owned.
 * The run-turn33-step exit uses DK's retained animation extent as an authored
 * commitment, not a recovered native status exit. Native flag3/transition18/
 * stop15 are retained separately; common flag consumers are not reconstructed.
 */
export interface DonkeyKongTurnBrakeState {
  readonly sheet: 'dash_turn' | 'run_turn' | 'run_brake' | 'run_brake_left';
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
  readonly targetFacing: 1 | -1;
  readonly duration: number;
}
export const DONKEYKONG_TURN_BRAKE_DURATIONS = Object.freeze({ dashTurn: 21, runTurn: 33, runBrake: 19 });
/** Authored calibration, not a recovered native selector (no primary source states DK's
 * RunBrakeR/L rule). Each a02run motion frame was matched to the first pose of a02runbraker
 * (right foot planted ahead) and a02runbrakel (left foot ahead) by foot position
 * (tools/dk_native_pose.py): frames 8-24 of the 35-frame cycle are nearest the right brake,
 * the rest the left. The run clip draws native frame (age % 35) + 1, so ages 7-23 brake right. */
export function donkeyKongRunGaitSide(runAge: number): 'right' | 'left' {
  const age = runAge % 35;
  return age >= 7 && age <= 23 ? 'right' : 'left';
}
export function tickDonkeyKongTurnBrake(state: DonkeyKongTurnBrakeState | null,
  previous: LocomotionState, input: LocomotionInput, tuning: ResolvedLocomotionTuning,
  eligible: boolean, options: { readonly frozen?: boolean } = {}): DonkeyKongTurnBrakeState | null {
  if (options.frozen) return state;
  if (!eligible || !input.grounded || input.moveY >= tuning.crouchStickThreshold) return null;
  if (state) return state.framesElapsed + 1 < state.duration
    ? { ...state, framesElapsed: state.framesElapsed + 1 } : null;
  const full = Math.abs(input.moveX) >= tuning.dashStickThreshold;
  const direction: 1 | -1 = input.moveX < 0 ? -1 : 1;
  if (previous.name === 'initialDash' && previous.framesElapsed < tuning.dashDanceWindowFrames
    && full && direction !== previous.dashFacing && input.prevMoveX * input.moveX <= 0) {
    return { sheet: 'dash_turn', framesElapsed: 0, facing: previous.dashFacing,
      targetFacing: direction, duration: DONKEYKONG_TURN_BRAKE_DURATIONS.dashTurn };
  }
  if (previous.name !== 'run') return null;
  if (full && direction !== previous.facing) return { sheet: 'run_turn', framesElapsed: 0,
    facing: previous.facing, targetFacing: direction, duration: DONKEYKONG_TURN_BRAKE_DURATIONS.runTurn };
  if (!full) return { sheet: donkeyKongRunGaitSide(previous.framesElapsed) === 'left' ? 'run_brake_left' : 'run_brake',
    framesElapsed: 0, facing: previous.facing, targetFacing: previous.facing,
    duration: DONKEYKONG_TURN_BRAKE_DURATIONS.runBrake };
  return null;
}
export function donkeyKongTurnBrakeNativeMarkers(state: DonkeyKongTurnBrakeState): {
  readonly turnDashFlag: boolean; readonly dashToRunEnabled: boolean; readonly runBrakeStopFlag: boolean;
} {
  const nativeFrame = state.framesElapsed + 1;
  return { turnDashFlag: state.sheet === 'dash_turn' && nativeFrame >= 3,
    // UFD "Pivot Dash Frames 17": the turn dash runs 17 frames before it may become a run
    // (native turn_dash transition at frame 18 agrees).
    dashToRunEnabled: state.sheet === 'dash_turn' && state.framesElapsed >= DONKEYKONG_UFD_STATS.pivotDashFrames,
    runBrakeStopFlag: state.sheet === 'run_turn' && nativeFrame >= 15 };
}
/** Common facing semantics unknown: the explicit 2D adapter flips at source
 * TURN_DASH flag3; run-turn captured input flips on entry. */
export function donkeyKongTurnBrakeFacing(state: DonkeyKongTurnBrakeState): 1 | -1 {
  return state.sheet === 'dash_turn' && !donkeyKongTurnBrakeNativeMarkers(state).turnDashFlag
    ? state.facing : state.targetFacing;
}
export function donkeyKongTurnBrakeVelocity(state: DonkeyKongTurnBrakeState, velocity: number,
  tuning: ResolvedLocomotionTuning, authoredDashReversalAcceleration: number, frozen = false): number {
  if (!Number.isFinite(velocity) || !Number.isFinite(authoredDashReversalAcceleration) || authoredDashReversalAcceleration < 0)
    throw new RangeError('DK turn adapter requires finite velocity and nonnegative acceleration');
  if (frozen) return velocity;
  if (state.sheet === 'dash_turn') {
    const target = state.targetFacing * tuning.initialDashSpeed;
    return velocity + Math.sign(target - velocity) * Math.min(Math.abs(target - velocity), authoredDashReversalAcceleration);
  }
  return stepDonkeyKongGroundVelocity({ velocityX: velocity, stickX: 0, phase: 'brake' });
}
