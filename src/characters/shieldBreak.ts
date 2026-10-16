/** Shield break for every fighter (SmashWiki Shield break / Shield jump / Stun):
 * the broken fighter is popped upward (intangible, except in the last 5 s of a timed
 * match), lands into furafura_start (50 samples), is stunned 400 - percent frames (shieldState.shieldBreakStunFrames)
 * (mash shortens it), then wakes through furafura_end (cancel 34: 33 locked frames).
 * Native rows are identical for DK, Link and Pikachu (motion_list furafura_*).
 * Source facts: docs/review/2026-10-12/link-character/rework/source-contracts/shield-break-phases.json.
 */
import type { CharacterId } from '../types';
export type ShieldBreakPhase = 'pop' | 'start' | 'loop' | 'wake' | 'tail';
export type ShieldBreakOrientation = 'face-up' | 'face-down';
export interface ShieldBreakState {
  readonly phase: ShieldBreakPhase;
  readonly framesElapsed: number;
  readonly generation: number;
  readonly lastFrame: number;
  readonly facing: 1 | -1;
  /** The stun budget of the loop phase (shieldState.shieldBreakStunFrames: 400 - percent). */
  readonly stunFrames: number;
  readonly loopRemaining: number;
  readonly airborneObserved: boolean;
  readonly orientation: ShieldBreakOrientation | null;
}
export interface ShieldBreakStep {
  readonly frame: number;
  readonly generation: number;
  readonly clockAdvances: boolean;
  readonly grounded: boolean;
  readonly landingOrientation: ShieldBreakOrientation | null;
  /** Supplied accepted logical mash dose, not an inferred native input timer. */
  readonly mashReduction: number;
  readonly interruption: 'accepted-hit' | 'capture' | 'stock-reset' | 'new-action' | null;
}
export interface ShieldBreakEvent {
  readonly kind: 'landed' | 'start' | 'loop' | 'wake' | 'actionable' | 'tail-ended' | 'interrupted';
}
const PHASES: readonly string[] = ['pop', 'start', 'loop', 'wake', 'tail'];
export const SHIELD_BREAK_SOURCE = Object.freeze({
  popNaturalSamples: 31,
  startNaturalSamples: 50, loopNaturalSamples: 101,
  wakeLockedAdvancingFrames: 33, wakeNativeCancelFrame: 34, wakeNaturalSamples: 50,
});
function integer(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid shield-break ${field}`);
}
function orientation(value: unknown): value is ShieldBreakOrientation {
  return value === 'face-up' || value === 'face-down';
}
function validate(state: ShieldBreakState): void {
  if (!state || !PHASES.includes(state.phase)) throw new TypeError('Invalid shield-break phase');
  integer(state.framesElapsed, 'age'); integer(state.generation, 'generation'); integer(state.lastFrame, 'frame');
  if (state.facing !== 1 && state.facing !== -1) throw new TypeError('Invalid shield-break facing');
  if (![state.stunFrames, state.loopRemaining].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    || state.loopRemaining > state.stunFrames) throw new TypeError('Invalid shield-break budget');
  if (typeof state.airborneObserved !== 'boolean' || state.orientation !== null && !orientation(state.orientation)
    || state.phase === 'pop' && state.orientation !== null
    || state.phase !== 'pop' && (!state.airborneObserved || state.orientation === null))
    throw new TypeError('Invalid shield-break landing receipt');
  if ((state.phase === 'pop' || state.phase === 'start') && state.loopRemaining !== state.stunFrames
    || state.phase === 'loop' && state.loopRemaining <= 0
    || (state.phase === 'wake' || state.phase === 'tail') && state.loopRemaining !== 0)
    throw new TypeError('Invalid shield-break budget phase');
  if (state.phase === 'start' && state.framesElapsed >= 50
    || state.phase === 'wake' && state.framesElapsed >= 33
    || state.phase === 'tail' && (state.framesElapsed < 33 || state.framesElapsed >= 50))
    throw new TypeError('Invalid shield-break phase age');
}
export function beginShieldBreak(input: {
  readonly frame: number; readonly generation: number; readonly facing: 1 | -1; readonly stunFrames: number;
}): ShieldBreakState {
  const state: ShieldBreakState = { phase: 'pop', framesElapsed: 0,
    generation: input.generation, lastFrame: input.frame, facing: input.facing,
    stunFrames: input.stunFrames, loopRemaining: input.stunFrames,
    airborneObserved: false, orientation: null };
  validate(state); return Object.freeze(state);
}
export function stepShieldBreak(state: ShieldBreakState, input: ShieldBreakStep): {
  readonly state: ShieldBreakState | null; readonly events: readonly ShieldBreakEvent[];
} {
  validate(state); integer(input.frame, 'frame'); integer(input.generation, 'generation');
  if (!Number.isFinite(input.mashReduction) || input.mashReduction < 0) throw new TypeError('Invalid supplied shield-break mash');
  if (input.generation !== state.generation || input.interruption !== null)
    return { state: null, events: [{ kind: 'interrupted' }] };
  if (input.frame <= state.lastFrame) return { state, events: [] };
  const next = { ...state, lastFrame: input.frame };
  if (!input.clockAdvances) return { state: Object.freeze(next), events: [] };
  if (state.phase !== 'pop' && !input.grounded) return { state: null, events: [{ kind: 'interrupted' }] };
  const age = state.framesElapsed + 1;
  if (state.phase === 'pop') {
    const airborneObserved = state.airborneObserved || !input.grounded;
    if (state.airborneObserved && input.grounded) {
      if (!orientation(input.landingOrientation)) throw new TypeError('Actual shield-break landing needs selected orientation');
      return { state: Object.freeze({ ...next, phase: 'start', framesElapsed: 0, airborneObserved,
        orientation: input.landingOrientation }), events: [{ kind: 'landed' }] };
    }
    return { state: Object.freeze({ ...next, airborneObserved, framesElapsed: age }), events: [] };
  }
  if (state.phase === 'start' && age >= SHIELD_BREAK_SOURCE.startNaturalSamples) {
    const remaining = state.stunFrames;
    return { state: Object.freeze({ ...next, phase: remaining > 0 ? 'loop' : 'wake', framesElapsed: 0,
      loopRemaining: remaining }), events: [{ kind: remaining > 0 ? 'loop' : 'wake' }] };
  }
  if (state.phase === 'loop') {
    const remaining = Math.max(0, state.loopRemaining - 1 - input.mashReduction);
    return { state: Object.freeze({ ...next, phase: remaining > 0 ? 'loop' : 'wake',
      framesElapsed: remaining > 0 ? age : 0, loopRemaining: remaining }),
      events: remaining > 0 ? [] : [{ kind: 'wake' }] };
  }
  if (state.phase === 'wake' && age >= SHIELD_BREAK_SOURCE.wakeLockedAdvancingFrames)
    return { state: Object.freeze({ ...next, phase: 'tail', framesElapsed: age }), events: [{ kind: 'actionable' }] };
  if (state.phase === 'tail' && age >= SHIELD_BREAK_SOURCE.wakeNaturalSamples)
    return { state: null, events: [{ kind: 'tail-ended' }] };
  return { state: Object.freeze({ ...next, framesElapsed: age }), events: [] };
}
export function shieldBreakControlsLocked(state: ShieldBreakState): boolean {
  return state.phase !== 'tail';
}
export function selectShieldBreakPresentation(state: ShieldBreakState): {
  readonly motion: string; readonly rawAge: number; readonly facing: 1 | -1; readonly terminal: boolean;
  readonly phase: ShieldBreakPhase; readonly controlsLocked: boolean;
} {
  validate(state);
  const suffix = state.orientation === 'face-down' ? 'd' : 'u';
  // Grounded SHIELD_BREAK_DOWN owns the one actual50-sample FurafuraStart;
  // status and motion names differ. Never add a second50-frame body phase.
  const motion = state.phase === 'pop' ? 'shield_break_fly'
    : state.phase === 'start' ? `furafura_start_${suffix}` : state.phase === 'loop' ? 'furafura' : 'furafura_end';
  return Object.freeze({ motion, rawAge: state.phase === 'pop' ? Math.min(30, state.framesElapsed) : state.framesElapsed,
    facing: state.facing, terminal: state.phase !== 'loop', phase: state.phase,
    controlsLocked: shieldBreakControlsLocked(state) });
}
/** Public pop intangibility is distinct from ordinary invincibility. Last5s
 * exception and actual collision admission are supplied by the Scene clock. */
export function shieldBreakProtection(state: ShieldBreakState, lastFiveSecondsException: boolean): {
  readonly intangible: boolean; readonly invincible: false; readonly provenance: string;
} {
  return { intangible: state.phase === 'pop' && !lastFiveSecondsException, invincible: false,
    provenance: 'Public shield-pop rule (SmashWiki Shield break); native rows have no XLU window.' };
}
export function parseShieldBreakState(value: unknown): ShieldBreakState | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Malformed shield-break state');
  const keys = ['phase', 'framesElapsed', 'generation', 'lastFrame', 'facing', 'stunFrames',
    'loopRemaining', 'airborneObserved', 'orientation'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Unknown shield-break state field');
  const state = value as ShieldBreakState;
  validate(state); return Object.freeze({ ...state });
}

/** Native shield_break_y per fighter (native-fighter-param.json, fighter_kind_*). */
const SHIELD_BREAK_POP_HEIGHT_NATIVE: Readonly<Record<CharacterId, number>> = Object.freeze({
  donkeykong: 43.5, link: 41, pikachu: 36.2 });
/** The pop: the fighter's shield_break_y (5 px per native unit) under its own gravity
 * (px per step squared), gravity added once before each step. */
export function shieldBreakPopPlan(fighter:CharacterId,gravityPx:number){
  if(!Number.isFinite(gravityPx)||gravityPx<=0)throw new TypeError('Shield pop needs a finite positive gravity');
  const height=SHIELD_BREAK_POP_HEIGHT_NATIVE[fighter]*5,gravity=gravityPx;
  const ascendingSteps=Math.ceil((Math.sqrt(1+8*height/gravity)-1)/2);
  const initialUpwardSpeed=(height+gravity*ascendingSteps*(ascendingSteps+1)/2)/ascendingSteps;
  return Object.freeze({height,gravity,ascendingSteps,initialVelocityY:-initialUpwardSpeed});
}
