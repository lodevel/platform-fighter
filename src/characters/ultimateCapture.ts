/** Ultimate published ordinary-grab rules. Input thresholds/tie order are
 * explicit logical-input adapters, not recovered native clatter code. */
export const ULTIMATE_CAPTURE_MIN_FRAMES = 19;
export const ULTIMATE_GRAB_RELEASE_FRAMES = 29;
export const ULTIMATE_POST_RELEASE_GRAB_IMMUNITY_FRAMES = 60;
export function ultimateCaptureFrames(entryPercent: number): number {
  if (!Number.isFinite(entryPercent) || entryPercent < 0) throw new Error('capture entry percent must be finite and nonnegative');
  return Math.floor(90 + 1.7 * entryPercent);
}
export interface CaptureMashInput {
  readonly moveX: number; readonly moveY?: number; readonly jump: boolean;
  readonly attack?: boolean; readonly attackHeavy?: boolean;
  readonly attackStickX?: number; readonly attackStickY?: number;
  readonly special?: boolean; readonly shield?: boolean; readonly dodge?: boolean;
  readonly grab?: boolean; readonly appeal?: boolean;
}
export type CaptureMashAction = 'left'|'right'|'up'|'down'|'jump'|'attack'|'special'|'shield'|'grab';
const ACTIONS: readonly CaptureMashAction[] = ['left','right','up','down','jump','attack','special','shield','grab'];
/** Cardinal threshold .5 and stick-first tie order are authored policies. */
export function captureMashHeld(input: CaptureMashInput): readonly CaptureMashAction[] {
  const held: CaptureMashAction[] = [];
  if(input.moveX < -.5) held.push('left'); if(input.moveX > .5) held.push('right');
  if((input.moveY??0) < -.5) held.push('up'); if((input.moveY??0) > .5) held.push('down');
  if(input.jump) held.push('jump');
  // Dedicated heavy button shares attack's logical identity. A right-stick
  // attack alone is excluded; appeal is never a mash action.
  if(input.attack || (input.attackHeavy && !input.attackStickX && !input.attackStickY)) held.push('attack');
  if(input.special) held.push('special'); if(input.shield || input.dodge) held.push('shield');
  if(input.grab) held.push('grab'); return held;
}
export interface CaptureMashState {
  readonly previousHeld: readonly CaptureMashAction[];
  readonly lastAccepted: {readonly action: CaptureMashAction; readonly frame: number; readonly button: boolean}|null;
  readonly reduction: number;
}
export function initialCaptureMash(input: CaptureMashInput): CaptureMashState {
  return {previousHeld:captureMashHeld(input),lastAccepted:null,reduction:0};
}
/** Frames removed per accepted mash input: stick vs button. */
export interface MashWeights { readonly stick: number; readonly button: number }
/** Grab escape (the existing capture rule). */
export const CAPTURE_MASH_WEIGHTS: MashWeights = Object.freeze({ stick: 8, button: 14.4 });
/** SmashWiki Stun, shield break: "Button mashing reduces the duration of shield break stun by ...
 * 3 frames per input in later games (5.4 for buttons in Smash 4 and Ultimate)". */
export const SHIELD_BREAK_MASH_WEIGHTS: MashWeights = Object.freeze({ stick: 3, button: 5.4 });
export function tickCaptureMash(state: CaptureMashState, input: CaptureMashInput, frame: number,
  weights: MashWeights = CAPTURE_MASH_WEIGHTS): CaptureMashState {
  const held=captureMashHeld(input);
  // One rising logical input per actual unfrozen captive step. Source button
  // spacing is2 for same action,3 for changed action (including next stick).
  const candidate=ACTIONS.find(action=>held.includes(action)&&!state.previousHeld.includes(action));
  if(!candidate)return {...state,previousHeld:held};
  const last=state.lastAccepted;
  if(last?.button && frame-last.frame < (candidate===last.action ? 2 : 3)) return {...state,previousHeld:held};
  const button=ACTIONS.indexOf(candidate)>=4;
  return {previousHeld:held,lastAccepted:{action:candidate,frame,button},reduction:state.reduction+(button?weights.button:weights.stick)};
}
/** Clamp TOTAL hold duration; clamping remaining time would prevent escape
 * under continuous mashing and contradict the published19-frame minimum. */
export function reducedCaptureFrames(initialFrames: number, mash: CaptureMashState): number {
  return Math.max(ULTIMATE_CAPTURE_MIN_FRAMES,initialFrames-mash.reduction);
}
