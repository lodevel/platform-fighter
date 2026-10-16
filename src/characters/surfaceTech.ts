/** Wall tech, wall-jump tech and ceiling tech: one path for every fighter.
 * Common native rows (motion_list, identical for DK, Link and Pikachu): passive_wall
 * xlu 1..21 (cancel 0: no native exit), passive_ceil xlu 1..18 cancel 27,
 * passive_wall_jump no xlu. Per-fighter values are each fighter's native
 * passive_* fighter params and the authored status durations listed below.
 * Provenance: completion-2026-10-08/mechanics/surface-context-contract.json (DK),
 * completion-gap-audit/surface-tech-source-runtime-proposal.json (Pikachu).
 */

export type SurfaceTechKind = 'wall' | 'wall-jump' | 'ceiling';
/** Ultimate tech input: an 11-frame window, then a 40-frame lockout after a missed one. */
export const TECH_INPUT_FRAMES = 11;
export const TECH_LOCKOUT_FRAMES = 40;
/** The wall-jump tech's native drawing extent; it is actionable after its entry step. */
const WALL_JUMP_TECH_FRAMES = 40;

export interface SurfaceTechProfile {
  /** Native passive_wall_x_speed, passive_wall_jump_{x,y}_speed, passive_ceil_x_speed (5 px per unit). */
  readonly passiveWallSpeedX: number;
  readonly passiveWallJumpSpeedX: number;
  readonly passiveWallJumpSpeedY: number;
  readonly passiveCeilingSpeedX: number;
  /** passive_wall has cancel 0, so its committed duration is authored. */
  readonly wallDurationFrames: number;
  readonly ceilingDurationFrames: number;
  /** Native passive_ceil Trans per step; when present the ceiling tech follows it with gravity held. */
  readonly ceilingRootDeltas?: readonly { readonly x: number; readonly y: number }[];
}

export interface SurfaceTechState {
  readonly kind: SurfaceTechKind;
  readonly facing: 1 | -1;
  readonly outward: 1 | -1;
  readonly framesElapsed: number;
  readonly durationFrames: number;
}
export function beginSurfaceTech(kind: SurfaceTechKind, facing: 1 | -1, outward: 1 | -1, profile: SurfaceTechProfile): SurfaceTechState {
  const durationFrames = kind === 'ceiling' ? profile.ceilingDurationFrames
    : kind === 'wall-jump' ? WALL_JUMP_TECH_FRAMES : profile.wallDurationFrames;
  if (!Number.isInteger(durationFrames) || durationFrames <= 0) throw new RangeError('Surface tech requires a positive status duration');
  return { kind, facing, outward, framesElapsed: 0, durationFrames };
}
export function tickSurfaceTech(state: SurfaceTechState,
  input: { readonly frozen?: boolean; readonly grounded?: boolean } = {}): SurfaceTechState | null {
  if (input.frozen) return state;
  if (input.grounded || state.framesElapsed + 1 >= state.durationFrames) return null;
  return { ...state, framesElapsed: state.framesElapsed + 1 };
}
/** Intangible on frames 1-20 (wall) and 1-17 (ceiling); the wall-jump tech has none. */
export function surfaceTechProtected(state: SurfaceTechState): boolean {
  return state.framesElapsed < (state.kind === 'wall' ? 20 : state.kind === 'ceiling' ? 17 : 0);
}
/** Ultimate wall-tech jump has no lag: after its entry step ordinary air actions are open. */
export function surfaceTechActionable(state: SurfaceTechState): boolean {
  return state.kind === 'wall-jump' && state.framesElapsed > 0;
}
export interface SurfaceTechEligibility {
  readonly surface: 'wall' | 'ceiling';
  readonly airborne: boolean;
  readonly tumbling: boolean;
  readonly hitstunRemaining: number;
  readonly bufferRemaining: number;
  readonly lockoutRemaining: number;
  readonly launchSpeedPixels: number;
  readonly jumpHeld: boolean;
}
/** Speed 6 native units (30 px) is the common untechable boundary. */
export function selectSurfaceTech(input: SurfaceTechEligibility): SurfaceTechKind | null {
  if (!input.airborne || !input.tumbling || input.hitstunRemaining <= 0
    || input.bufferRemaining <= 0 || input.lockoutRemaining > 0
    || !Number.isFinite(input.launchSpeedPixels) || input.launchSpeedPixels < 0
    || input.launchSpeedPixels >= 30) return null;
  return input.surface === 'ceiling' ? 'ceiling' : input.jumpHeld ? 'wall-jump' : 'wall';
}
/** The native speeds applied once as entry velocities. Ceiling keeps the incoming X, clamped to its speed. */
export function surfaceTechEntryVelocity(state: SurfaceTechState, profile: SurfaceTechProfile,
  incomingX = 0): { readonly x: number; readonly y: number } {
  if (!Number.isFinite(incomingX)) throw new RangeError('Incoming surface velocity must be finite');
  if (state.kind === 'ceiling') return { x: Math.max(-profile.passiveCeilingSpeedX * 5,
    Math.min(profile.passiveCeilingSpeedX * 5, incomingX)), y: 0 };
  if (state.kind === 'wall-jump') return { x: state.outward * profile.passiveWallJumpSpeedX * 5,
    y: -profile.passiveWallJumpSpeedY * 5 };
  return { x: state.outward * profile.passiveWallSpeedX * 5, y: 0 };
}
/** Root displacement between two ceiling-tech ages, mirrored by facing; null without a root track. */
export function surfaceTechCeilingDisplacement(previous: SurfaceTechState, next: SurfaceTechState,
  profile: SurfaceTechProfile): { readonly x: number; readonly y: number } | null {
  const track = profile.ceilingRootDeltas;
  if (!track || next.kind !== 'ceiling') return null;
  const a = track[previous.framesElapsed], b = track[next.framesElapsed];
  if (!a || !b) throw new Error('Ceiling tech age is outside its root track');
  return { x: (b.x - a.x) * next.facing, y: b.y - a.y };
}
export interface TechInputWindow {
  readonly bufferRemaining: number;
  readonly lockoutRemaining: number;
}
/** A fresh press (edges only, never a held shield) opens the window; ages pause during hitlag. */
export function advanceTechInputWindow(state: TechInputWindow,
  input: { readonly pressed: boolean; readonly canTechLaunch: boolean; readonly frozen?: boolean }): TechInputWindow {
  let { bufferRemaining, lockoutRemaining } = state;
  if (!input.frozen) {
    lockoutRemaining = Math.max(0, lockoutRemaining - 1);
    if (bufferRemaining > 0) {
      bufferRemaining -= 1;
      if (bufferRemaining === 0) lockoutRemaining = TECH_LOCKOUT_FRAMES;
    }
  }
  if (input.canTechLaunch && input.pressed && bufferRemaining === 0 && lockoutRemaining === 0) {
    bufferRemaining = TECH_INPUT_FRAMES;
  }
  return { bufferRemaining, lockoutRemaining };
}
/** Caller normal is the Matter pair normal directed toward the fighter. A floor normal
 * (negative Y) is never a surface tech; .9 is the authored slope boundary. */
export function classifySurfaceTechContact(normal: { readonly x: number; readonly y: number }):
  { readonly kind: 'wall' | 'ceiling'; readonly outward: 1 | -1 } | null {
  if (!Number.isFinite(normal.x) || !Number.isFinite(normal.y)) return null;
  if (normal.y >= .9) return { kind: 'ceiling', outward: normal.x < 0 ? -1 : 1 };
  if (Math.abs(normal.x) >= .9) return { kind: 'wall', outward: normal.x < 0 ? -1 : 1 };
  return null;
}
