import type { LocomotionInput, LocomotionState, ResolvedLocomotionTuning } from './locomotionState';

/** Source-pose beta adapter. Native common turn/gait/kinetic consumers are
 * unavailable; source cancel22/20 guide these explicit beta windows, while
 * run-turn20 displays its end19. Source move=false means no Trans transport.
 * Evidence: integration/completion-gap-audit/turn-brake-source-runtime-proposal.json.
 */
export interface PikachuTurnBrakeState {
  readonly sheet: 'dash_turn' | 'run_turn' | 'run_brake' | 'run_brake_left';
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
  readonly targetFacing: 1 | -1;
  readonly duration: number;
}
export function tickPikachuTurnBrake(state: PikachuTurnBrakeState | null,
  previous: LocomotionState, input: LocomotionInput, tuning: ResolvedLocomotionTuning,
  eligible: boolean): PikachuTurnBrakeState | null {
  if (!eligible || !input.grounded || input.moveY >= tuning.crouchStickThreshold) return null;
  if (state) return state.framesElapsed + 1 < state.duration
    ? { ...state, framesElapsed: state.framesElapsed + 1 } : null;
  const full = Math.abs(input.moveX) >= tuning.dashStickThreshold;
  const direction: 1 | -1 = input.moveX < 0 ? -1 : 1;
  if (previous.name === 'initialDash' && previous.framesElapsed < tuning.dashDanceWindowFrames &&
      full && direction !== previous.dashFacing && input.prevMoveX * input.moveX <= 0)
    return { sheet: 'dash_turn', framesElapsed: 0, facing: previous.dashFacing,
      targetFacing: direction, duration: 22 };
  if (previous.name !== 'run') return null;
  if (full && direction !== previous.facing)
    return { sheet: 'run_turn', framesElapsed: 0, facing: previous.facing,
      targetFacing: direction, duration: 20 };
  if (!full) return {
    // Explicit beta gait choice from the accepted26-step run half-cycle,
    // independent of orientation. Native selector is not claimed.
    sheet: previous.framesElapsed % 26 < 13 ? 'run_brake' : 'run_brake_left',
    framesElapsed: 0, facing: previous.facing, targetFacing: previous.facing, duration: 20,
  };
  return null;
}
export function pikachuTurnBrakeVelocity(state: PikachuTurnBrakeState, velocity: number,
  tuning: ResolvedLocomotionTuning, groundAcceleration: number, groundDamping: number): number {
  if (state.sheet === 'dash_turn') {
    const target = state.targetFacing * tuning.initialDashSpeed;
    return velocity + Math.sign(target - velocity) * Math.min(Math.abs(target - velocity), groundAcceleration);
  }
  const next = velocity * (state.sheet === 'run_turn' ? tuning.pivotDamping : groundDamping);
  return Math.abs(next) < .01 ? 0 : next;
}
