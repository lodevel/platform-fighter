/**
 * Shooting items (Ultimate items, phase 4): the fire session a held Ray Gun, Super Scope or Fire Flower runs.
 *
 * SmashWiki (docs/review/2026-10-11/ultimate-items/spec/universal-rules.json): shooting items fire on the neutral
 * attack and neutral aerial (`attackInput.shootingFire`); characters can run and jump while using them
 * (`attackInput.shootingMovement`); an empty one is thrown instead (`attackInput.emptyShootingItem`). So a session is
 * not an attack: the body keeps walking / jumping (Character limits the legs to the native shoot walk) while the
 * session advances its own clock, emits shots and spends ammo. The native motion of each phase (`ShootingClips`) is
 * drawn full-body when standing or airborne, and as the `_upper` layer over `item_shoot_legs_*` while the legs move.
 *
 * Three kinds, one state machine (values and labels per item in the item files and phase-4/sources.json):
 *   • single (Ray Gun): one shot on a fixed frame, the session lasts until the next shot may start;
 *   • scope (Super Scope): a raise (`start`); released during it = a tap → a rapid burst of `rapid.shots` shots,
 *     held through it = charging (`wait`) until release → one charged shot whose stage (cost / damage) grows with the
 *     charge; then the lowering (`end`);
 *   • stream (Fire Flower): a flame every `interval` frames while the button is held and fuel remains, at least
 *     `minShots` flames per press; fuel (ammo) is spent every streaming frame.
 * Ammo is spent through the caller's `spend(cost)` (ItemEntity.spendShot): a shot that cannot be paid is not fired
 * and ends the burst / stream.
 *
 * Phaser-free and deterministic: the state is plain data on the holder; no clock but the simulation step.
 */
import type { ItemShot } from '../characters/attacks';

/** Native motions of one phase: full body standing, upper-body layer over the shoot legs, airborne. */
export interface ShootingClips { readonly ground: string; readonly upper: string; readonly air: string }

export interface SingleShotSpec {
  readonly kind: 'single';
  readonly clips: ShootingClips;
  /** Ages 0 .. frames − 1; the next session may start on age `frames` (FAF − 1). */
  readonly frames: number;
  readonly shotFrame: number;
  readonly shot: ItemShot;
}

export interface ScopeStage { readonly stage: number; readonly cost: number; readonly shot: ItemShot }
export interface ScopeSpec {
  readonly kind: 'scope';
  readonly start: { readonly clips: ShootingClips; readonly frames: number };
  readonly wait: { readonly clips: ShootingClips };
  readonly rapid: { readonly clips: ShootingClips; readonly frames: number; readonly shotFrame: number; readonly shots: number; readonly shot: ItemShot };
  readonly fire: { readonly clips: ShootingClips; readonly frames: number; readonly shotFrame: number };
  readonly end: { readonly clips: ShootingClips; readonly frames: number };
  /** Charge frames to the last stage. */
  readonly chargeFrames: number;
  /** Ascending stages; the charge selects one evenly over `chargeFrames` (the last only at full charge). */
  readonly stages: readonly ScopeStage[];
}

export interface StreamSpec {
  readonly kind: 'stream';
  readonly start: { readonly clips: ShootingClips; readonly frames: number };
  readonly loop: { readonly clips: ShootingClips };
  readonly firstShotFrame: number;
  readonly interval: number;
  readonly minShots: number;
  /** Fuel (ammo) spent on every streaming frame, from the first flame on. */
  readonly fuelPerFrame: number;
  readonly shot: ItemShot;
}

export type ShootingSpec = SingleShotSpec | ScopeSpec | StreamSpec;

export type ShootingPhase = 'shoot' | 'start' | 'wait' | 'rapid' | 'fire' | 'end' | 'loop';

export interface ShootingState {
  readonly phase: ShootingPhase;
  /** Steps since the session started (-1 before its first step). */
  readonly age: number;
  /** Steps in the current phase. */
  readonly phaseAge: number;
  readonly facing: 1 | -1;
  /** The fire button has been released since the press. */
  readonly released: boolean;
  /** Scope charge frames; stream / rapid shots fired. */
  readonly charge: number;
  readonly shots: number;
}

export interface ShootingStep {
  /** Null when the session is over this step (the holder is free again). */
  readonly state: ShootingState | null;
  readonly shots: readonly ItemShot[];
}

export function startShooting(spec: ShootingSpec, facing: 1 | -1): ShootingState {
  const phase: ShootingPhase = spec.kind === 'single' ? 'shoot' : 'start';
  return { phase, age: -1, phaseAge: -1, facing, released: false, charge: 0, shots: 0 };
}

/** The scope stage a charge selects, capped by the ammo left (the strongest stage the item can pay for). */
export function scopeStageFor(spec: ScopeSpec, charge: number, ammo: number | null): ScopeStage | null {
  const last = spec.stages.length - 1;
  let index = Math.min(last, Math.floor(Math.max(0, charge) * last / spec.chargeFrames));
  while (index >= 0 && ammo !== null && spec.stages[index]!.cost > ammo) index -= 1;
  return index < 0 ? null : spec.stages[index]!;
}

const enter = (s: ShootingState, phase: ShootingPhase, extra: Partial<ShootingState> = {}): ShootingState =>
  ({ ...s, ...extra, phase, phaseAge: 0 });

/**
 * One simulation step of a session: advance its clock, then fire whatever this age fires. `held` is the attack
 * button this step; `spend(cost)` pays a shot (false = not enough ammo); `ammo` is what is left before this step.
 */
export function stepShooting(spec: ShootingSpec, state: ShootingState, held: boolean,
  spend: (cost: number) => boolean, ammo: number | null): ShootingStep {
  let s: ShootingState = { ...state, age: state.age + 1, phaseAge: state.phaseAge + 1, released: state.released || !held };
  const shots: ItemShot[] = [];
  const pay = (cost: number, shot: ItemShot): boolean => {
    if (!spend(cost)) return false;
    shots.push(shot);
    return true;
  };
  if (spec.kind === 'single') {
    if (s.phaseAge >= spec.frames) return { state: null, shots };
    if (s.phaseAge === spec.shotFrame) pay(1, spec.shot);
    return { state: s, shots };
  }
  if (spec.kind === 'scope') {
    if (s.phase === 'start' && s.phaseAge >= spec.start.frames) s = enter(s, s.released ? 'rapid' : 'wait');
    if (s.phase === 'wait') {
      if (held) s = { ...s, charge: Math.min(spec.chargeFrames, s.phaseAge) };
      else s = enter(s, 'fire');
    }
    if (s.phase === 'rapid') {
      if (s.phaseAge >= spec.rapid.frames) s = s.shots >= spec.rapid.shots ? enter(s, 'end') : enter(s, 'rapid');
      if (s.phase === 'rapid' && s.phaseAge === spec.rapid.shotFrame) {
        if (pay(1, spec.rapid.shot)) s = { ...s, shots: s.shots + 1 };
        else s = enter(s, 'end');
      }
    }
    if (s.phase === 'fire') {
      if (s.phaseAge >= spec.fire.frames) s = enter(s, 'end');
      else if (s.phaseAge === spec.fire.shotFrame) {
        const stage = scopeStageFor(spec, s.charge, ammo);
        if (stage) pay(stage.cost, stage.shot);
      }
    }
    if (s.phase === 'end' && s.phaseAge >= spec.end.frames) return { state: null, shots };
    return { state: s, shots };
  }
  // stream
  if (s.phase === 'start' && s.phaseAge >= spec.start.frames) s = enter(s, 'loop');
  if (s.age >= spec.firstShotFrame) {
    const done = s.shots >= spec.minShots && s.released;
    if (done || !spend(spec.fuelPerFrame)) return { state: null, shots };
    if ((s.age - spec.firstShotFrame) % spec.interval === 0) {
      shots.push(spec.shot);
      s = { ...s, shots: s.shots + 1 };
    }
  }
  return { state: s, shots };
}

/** The native motion and its age for the session's current phase. */
export function shootingMotion(spec: ShootingSpec, state: ShootingState): { readonly clips: ShootingClips; readonly age: number } {
  const age = Math.max(0, state.phaseAge);
  if (spec.kind === 'single') return { clips: spec.clips, age };
  if (spec.kind === 'stream') return state.phase === 'loop' ? { clips: spec.loop.clips, age } : { clips: spec.start.clips, age };
  const phase = state.phase === 'shoot' || state.phase === 'loop' ? 'start' : state.phase;
  return { clips: spec[phase].clips, age };
}
