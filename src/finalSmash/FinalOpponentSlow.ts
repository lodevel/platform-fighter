/** Selected engine adapter for native SLOW_OPPONENT(slow_mul,slow_time).
 * Wrapper proves argument order, not reciprocal units or clock domain.
 * Coordinator selects reciprocal local rate for advancing global duration;
 * Matter timeScale is leased once, never repeated velocity multiplication. */
import type { CharacterInput } from '../characters/Character';
export interface FinalOpponentSlowState {
  readonly runId: number; readonly rate: number; readonly expiresFrame: number;
  readonly originalTimeScale: number; readonly accumulator: number;
  readonly pending: CharacterInput | null;
}
export function beginFinalOpponentSlow(runId: number, divisor: number, duration: number, frame: number,
  originalTimeScale: number): FinalOpponentSlowState {
  if (![divisor,duration,originalTimeScale].every(Number.isFinite) || divisor < 1 || duration < 0 || originalTimeScale <= 0)
    throw new Error('Invalid explicit Final opponent slow policy');
  return { runId, rate: 1/divisor, expiresFrame: frame+duration, originalTimeScale, accumulator: 0, pending: null };
}
export function stepFinalOpponentSlow(state: FinalOpponentSlowState, raw: CharacterInput, frame: number) {
  if (frame >= state.expiresFrame) return { state: null, input: raw };
  const accumulator=state.accumulator+state.rate;
  // Retain real edges until next local sample; analog aim uses latest input.
  const prior=state.pending;
  const pending={...raw,jump:raw.jump||!!prior?.jump,attack:raw.attack||prior?.attack,
    attackHeavy:raw.attackHeavy||prior?.attackHeavy,special:raw.special||prior?.special,
    shield:raw.shield||prior?.shield,dodge:raw.dodge||prior?.dodge,grab:raw.grab||prior?.grab,
    appeal:raw.appeal||prior?.appeal};
  if (accumulator+1e-10<1) return { state:{...state,accumulator,pending},input:null };
  return { state:{...state,accumulator:Math.max(0,accumulator-1),pending:null},input:pending };
}
