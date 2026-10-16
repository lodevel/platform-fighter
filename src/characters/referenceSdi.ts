import { REFERENCE_KNOCKBACK_PIXELS_PER_UNIT } from './referenceKnockback';

/** Community-tested Ultimate SDI distance and pulse limits, in fixed steps. */
export const SDI_NUDGE_PX = 2 * REFERENCE_KNOCKBACK_PIXELS_PER_UNIT;
export const SDI_INTERVAL_FRAMES = 4;
export const SDI_MAX_PULSES = 16;
/** Local resolved-input threshold; native stick thresholds are not recovered. */
export const SDI_STICK_THRESHOLD = 0.5;

export interface SdiVector { readonly x: number; readonly y: number }
export interface ReferenceSdiState {
  readonly previousDirections: number;
  readonly cooldownFrames: number;
  readonly pulses: number;
  readonly bufferedInput: SdiVector | null;
}

export function createReferenceSdiState(): ReferenceSdiState {
  return { previousDirections: 0, cooldownFrames: 0, pulses: 0, bufferedInput: null };
}

/**
 * Advance one victim hitlag step. A newly added cardinal component requests a
 * pulse; merely removing one does not. The first request during the four-step
 * interval is retained with its original vector. This follows the Ultimate
 * testing page's explicit input trace; competing secondary descriptions use
 * the latest request instead. ASDI and world-contact restrictions are separate.
 * https://w.atwiki.jp/smashsp_kensyou/pages/66.html
 */
export function stepReferenceSdi(
  state: ReferenceSdiState,
  input: SdiVector,
  hitboxMultiplier = 1,
): { state: ReferenceSdiState; displacement: SdiVector; pulsed: boolean } {
  const rawX = Number.isFinite(input.x) ? input.x : 0;
  const rawY = Number.isFinite(input.y) ? input.y : 0;
  const length = Math.max(1, Math.hypot(rawX, rawY));
  const stick = { x: rawX / length, y: rawY / length };
  const directions = (stick.x >= SDI_STICK_THRESHOLD ? 1 : 0)
    | (stick.x <= -SDI_STICK_THRESHOLD ? 2 : 0)
    | (stick.y >= SDI_STICK_THRESHOLD ? 4 : 0)
    | (stick.y <= -SDI_STICK_THRESHOLD ? 8 : 0);
  const added = (directions & ~state.previousDirections) !== 0;
  const cooldown = Math.max(0, state.cooldownFrames - 1);
  const multiplier = Number.isFinite(hitboxMultiplier) ? Math.max(0, hitboxMultiplier) : 1;
  let bufferedInput = state.bufferedInput;
  let pulse: SdiVector | null = null;
  if (state.pulses < SDI_MAX_PULSES && multiplier > 0) {
    if (cooldown === 0) {
      pulse = bufferedInput ?? (added ? stick : null);
      bufferedInput = null;
    } else if (added && bufferedInput === null) bufferedInput = stick;
  } else bufferedInput = null;
  return {
    state: { previousDirections: directions,
      cooldownFrames: pulse ? SDI_INTERVAL_FRAMES : cooldown,
      pulses: state.pulses + (pulse ? 1 : 0), bufferedInput },
    displacement: pulse ? { x: pulse.x * SDI_NUDGE_PX * multiplier, y: pulse.y * SDI_NUDGE_PX * multiplier }
      : { x: 0, y: 0 },
    pulsed: pulse !== null,
  };
}
