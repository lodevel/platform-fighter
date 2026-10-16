/** Actual common control transitions -> fresh Link presentation phases.
 * This leaf adds no physics, input locks, random cadence or combat events.
 * Source extents and named common-caller adapters are documented in
 * runtime/common-presentation-controller.json. */
import type { LocomotionState } from './locomotionState';
import { LINK_COMMON_MOTION_FACTS, type LinkCommonFactMotion } from './linkCommonMotionFacts';

export type LinkBrakeSide = 'l' | 'r';
export interface LinkCommonPresentationInput {
  readonly frame: number;
  readonly generation: number;
  readonly clockAdvances: boolean;
  readonly grounded: boolean;
  readonly facing: 1 | -1;
  readonly velocityX: number;
  readonly inputX: number;
  readonly inputY: number;
  readonly ordinary: { readonly kind: string; readonly framesElapsed: number } | null;
  readonly locomotion: LocomotionState;
  readonly crouching: boolean;
  readonly shield: { readonly kind: 'hold' | 'release' | 'block' | 'parry' | 'broken'; readonly framesElapsed: number } | null;
  readonly uncommitted: boolean;
  readonly heldItem: boolean;
  /** Live passive ShieldGuard contact while physically crouching preserves
   * the selected wait clock; it is not a new ordinary crouch entry. */
  readonly passiveCrouchHold?: boolean;
  /** Actual pre-transition fresh posed sole/root cue; undefined for a tie or
   * unavailable/unqualified data. No filename-facing foot inference. */
  readonly brakeSide?: LinkBrakeSide;
}

interface MotionPhase {
  readonly motion: LinkCommonFactMotion;
  readonly age: number;
  readonly facing: 1 | -1;
  readonly family: 'turn' | 'brake' | 'crouch';
}
interface PreviousControl {
  readonly grounded: boolean;
  readonly facing: 1 | -1;
  readonly locomotion: LocomotionState['name'];
  readonly inputX: number;
  readonly crouching: boolean;
}
export interface LinkCommonPresentationState {
  readonly generation: number;
  readonly lastFrame: number | null;
  readonly previous: PreviousControl | null;
  readonly transition: MotionPhase | null;
  readonly crouch: MotionPhase | null;
  readonly shieldSession: { readonly age: number; readonly facing: 1 | -1; readonly interrupted: boolean;
    readonly kind: 'hold' | 'block' } | null;
  /** Explicit result of an authored wait caller re-entry cadence, not a
   * native random selector or a claimed looping NUANMB resource. */
  readonly idle: { readonly motion: 'wait' | 'wait_2' | 'wait_3'; readonly age: number; readonly facing: 1 | -1 } | null;
  readonly nextFallbackBrakeSide: LinkBrakeSide;
  readonly lastBrakeChoice: { readonly side: LinkBrakeSide; readonly source: 'posed-support' | 'authored-alternation' } | null;
}

function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Link common presentation requires nonnegative ${name}`);
  return value;
}
function frozen(state: LinkCommonPresentationState): LinkCommonPresentationState {
  return Object.freeze({ ...state,
    previous: state.previous ? Object.freeze({ ...state.previous }) : null,
    transition: state.transition ? Object.freeze({ ...state.transition }) : null,
    crouch: state.crouch ? Object.freeze({ ...state.crouch }) : null,
    shieldSession: state.shieldSession ? Object.freeze({ ...state.shieldSession }) : null,
    idle: state.idle ? Object.freeze({ ...state.idle }) : null,
    lastBrakeChoice: state.lastBrakeChoice ? Object.freeze({ ...state.lastBrakeChoice }) : null });
}
export function beginLinkCommonPresentation(generation: number): LinkCommonPresentationState {
  return frozen({ generation: integer(generation, 'generation'), lastFrame: null, previous: null,
    transition: null, crouch: null, shieldSession: null, idle: null,
    nextFallbackBrakeSide: 'l', lastBrakeChoice: null });
}
function phase(motion: LinkCommonFactMotion, facing: 1 | -1, family: MotionPhase['family']): MotionPhase {
  return { motion, age: 0, facing, family };
}
function advanceTransition(old: MotionPhase | null): MotionPhase | null {
  if (!old) return null;
  const age = old.age + 1;
  return age < LINK_COMMON_MOTION_FACTS[old.motion].sampleCount ? { ...old, age } : null;
}
function advanceCrouch(old: MotionPhase | null): MotionPhase | null {
  if (!old) return null;
  const age = old.age + 1;
  if (old.motion === 'squat' && age >= LINK_COMMON_MOTION_FACTS.squat.sampleCount)
    return phase('squat_wait', old.facing, 'crouch');
  if (old.motion === 'squat_rv' && age >= LINK_COMMON_MOTION_FACTS.squat_rv.sampleCount) return null;
  return { ...old, age };
}

export function stepLinkCommonPresentation(state: LinkCommonPresentationState,
  input: LinkCommonPresentationInput): LinkCommonPresentationState {
  integer(input.frame, 'frame'); integer(input.generation, 'generation');
  if (input.facing !== 1 && input.facing !== -1) throw new TypeError('Link common presentation requires facing');
  for (const value of [input.velocityX, input.inputX, input.inputY])
    if (!Number.isFinite(value)) throw new TypeError('Link common presentation requires finite controls');
  const current = state.generation === input.generation ? state : beginLinkCommonPresentation(input.generation);
  if (current.lastFrame === input.frame) return current;
  const raised = input.shield?.kind === 'hold' || input.shield?.kind === 'block';
  const passiveCrouch = input.passiveCrouchHold === true && input.grounded && input.crouching;
  // Real action/block admission can invalidate presentation during stop.
  // It never advances an age or consumes a locomotion transition.
  if (!input.clockAdvances) {
    const interrupted = !input.grounded || !input.uncommitted;
    const shieldSession = raised ? {
      age: current.shieldSession?.age ?? 0, facing: current.shieldSession?.facing ?? input.facing,
      interrupted: (current.shieldSession?.interrupted ?? false) || input.shield?.kind === 'block',
      kind: input.shield!.kind as 'hold' | 'block',
    } : null;
    return frozen({ ...current, lastFrame: input.frame, shieldSession,
      transition: interrupted ? null : current.transition,
      crouch: passiveCrouch ? current.crouch?.motion === 'squat_wait' ? current.crouch
        : phase('squat_wait', input.facing, 'crouch') : interrupted ? null : current.crouch,
      idle: interrupted || input.heldItem || input.crouching || input.locomotion.name !== 'standing' ||
        input.ordinary?.kind !== 'idle' ? null : current.idle });
  }
  const previous = current.previous;
  let transition = advanceTransition(current.transition);
  let crouch = advanceCrouch(current.crouch);
  let nextFallbackBrakeSide = current.nextFallbackBrakeSide;
  let lastBrakeChoice = current.lastBrakeChoice;
  const shieldSession = raised ? {
    age: current.shieldSession ? current.shieldSession.age + 1 : 0,
    facing: current.shieldSession?.facing ?? input.facing,
    interrupted: (current.shieldSession?.interrupted ?? false) || input.shield?.kind === 'block',
    kind: input.shield!.kind as 'hold' | 'block',
  } : null;

  const brake = (prefix: 'walk_brake' | 'run_brake') => {
    const side = input.brakeSide ?? nextFallbackBrakeSide;
    const source = input.brakeSide ? 'posed-support' as const : 'authored-alternation' as const;
    if (!input.brakeSide) nextFallbackBrakeSide = side === 'l' ? 'r' : 'l';
    lastBrakeChoice = { side, source };
    transition = phase(`${prefix}_${side}`, input.facing, 'brake');
  };
  if (!input.grounded || !input.uncommitted) {
    transition = null;
    // Existing held wait advances through a real passive contact, except
    // stop. A contact during the cosmetic start admits held wait once; it
    // does not restart an already-selected wait on subsequent blocks.
    crouch = passiveCrouch ? current.crouch?.motion === 'squat_wait' ? crouch
      : phase('squat_wait', input.facing, 'crouch') : null;
  } else if (input.crouching) {
    transition = null;
    if (!previous?.crouching || !crouch || crouch.motion === 'squat_rv') crouch = phase('squat', input.facing, 'crouch');
  } else {
    if (previous?.crouching) crouch = phase('squat_rv', input.facing, 'crouch');
    const oldGround = previous?.grounded === true;
    const priorFacing = previous?.facing ?? input.facing;
    const priorLocomotion = previous?.locomotion;
    const reversed = oldGround && priorFacing !== input.facing;
    const loco = input.locomotion.name;
    if (oldGround && priorLocomotion !== 'pivot' && loco === 'pivot') {
      crouch = null;
      transition = phase('turn_run', priorFacing, 'turn');
    } else if (reversed && loco === 'initialDash') {
      crouch = null;
      transition = phase('turn_dash', priorFacing, 'turn');
    } else if (reversed && (loco === 'walk' || loco === 'standing')) {
      crouch = null;
      transition = phase('turn', priorFacing, 'turn');
    } else if (oldGround && priorLocomotion === 'pivot' && loco !== 'pivot' && loco !== 'run' && loco !== 'initialDash') {
      crouch = null;
      transition = phase('turn_run_brake', input.facing, 'brake');
    } else if (oldGround && priorLocomotion === 'run' && loco !== 'run' && loco !== 'initialDash' && loco !== 'pivot') {
      crouch = null; brake('run_brake');
    } else if (oldGround && priorLocomotion === 'walk' && loco === 'standing') {
      crouch = null; brake('walk_brake');
    } else if (transition?.family === 'brake' && (loco === 'initialDash' || loco === 'run' || Math.sign(input.inputX) !== Math.sign(previous?.inputX ?? 0))) {
      // A newly committed movement intent interrupts a cosmetic brake tail.
      transition = null;
    }
  }
  const idleEligible = input.grounded && input.uncommitted && !input.heldItem && !input.crouching &&
    !input.shield && !transition && !crouch && input.locomotion.name === 'standing' &&
    input.ordinary?.kind === 'idle';
  let idle: LinkCommonPresentationState['idle'] = null;
  if (idleEligible) {
    const old = current.idle;
    if (!old) idle = { motion: 'wait', age: 0, facing: input.facing };
    else if (old.age + 1 >= LINK_COMMON_MOTION_FACTS[old.motion].sampleCount)
      idle = { motion: old.motion === 'wait' ? 'wait_2' : old.motion === 'wait_2' ? 'wait_3' : 'wait',
        age: 0, facing: input.facing };
    else idle = { ...old, age: old.age + 1 };
  }
  return frozen({ ...current, lastFrame: input.frame, transition, crouch, shieldSession, idle,
    nextFallbackBrakeSide, lastBrakeChoice, previous: { grounded: input.grounded, facing: input.facing,
      locomotion: input.locomotion.name, inputX: input.inputX, crouching: input.crouching } });
}

export interface LinkCommonPresentationRoute {
  readonly motion: LinkCommonFactMotion;
  readonly rawAge: number;
  readonly facing: 1 | -1;
  readonly terminal: true;
  readonly admission: 'shield-raise' | 'shield-hold' | 'crouch' | 'turn' | 'brake' | 'idle';
}
export function selectLinkCommonPresentation(state: LinkCommonPresentationState): LinkCommonPresentationRoute | null {
  const shield = state.shieldSession;
  if (shield?.kind === 'hold') {
    const raising = !shield.interrupted && shield.age < LINK_COMMON_MOTION_FACTS.guard_on.sampleCount;
    // Native guard's361samples are not a proven temporal loop. Root selected
    // raw0 until actual tilt/frame selection is recovered and body-reviewed.
    return { motion: raising ? 'guard_on' : 'guard', rawAge: raising ? shield.age : 0,
      facing: shield.facing, terminal: true, admission: raising ? 'shield-raise' : 'shield-hold' };
  }
  if (shield) return null; // Actual block/parry/release clocks outrank this leaf.
  const active = state.crouch ?? state.transition;
  if (active) return { motion: active.motion, rawAge: active.age, facing: active.facing,
    terminal: true, admission: active.family };
  const idle = state.idle;
  return idle ? { motion: idle.motion, rawAge: idle.age, facing: idle.facing,
    terminal: true, admission: 'idle' } : null;
}

/** Closed JSON boundary for deterministic snapshot/authoring restoration.
 * Validation asserts this leaf's own state shape, not native caller parity.
 * The actor still checks its actual position-reset generation separately. */
export function parseLinkCommonPresentationState(value: unknown,
  path = 'commonPresentation'): LinkCommonPresentationState {
  const fail = (at: string): never => { throw new TypeError(`Invalid Link common presentation ${at}`); };
  const record = (raw: unknown, at: string, fields: readonly string[]): Record<string, unknown> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(at);
    const parsed = raw as Record<string, unknown>;
    if (Object.keys(parsed).some(key => !fields.includes(key)) || fields.some(key => !(key in parsed))) return fail(at);
    return parsed;
  };
  const count = (raw: unknown, at: string): number =>
    typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : fail(at);
  const facing = (raw: unknown, at: string): 1 | -1 => raw === 1 || raw === -1 ? raw : fail(at);
  const side = (raw: unknown, at: string): LinkBrakeSide => raw === 'l' || raw === 'r' ? raw : fail(at);
  const boolean = (raw: unknown, at: string): boolean => typeof raw === 'boolean' ? raw : fail(at);
  const finite = (raw: unknown, at: string): number =>
    typeof raw === 'number' && Number.isFinite(raw) ? raw : fail(at);
  const phaseSets = {
    turn: ['turn', 'turn_dash', 'turn_run'],
    brake: ['walk_brake_l', 'walk_brake_r', 'run_brake_l', 'run_brake_r', 'turn_run_brake'],
    crouch: ['squat', 'squat_wait', 'squat_rv'],
  } as const;
  const motionPhase = (raw: unknown, at: string, families: readonly MotionPhase['family'][]): MotionPhase | null => {
    if (raw === null) return null;
    const parsed = record(raw, at, ['motion', 'age', 'facing', 'family']);
    const family = parsed.family;
    if ((family !== 'turn' && family !== 'brake' && family !== 'crouch') || !families.includes(family)) return fail(`${at}.family`);
    if (typeof parsed.motion !== 'string' || !(phaseSets[family] as readonly string[]).includes(parsed.motion)) return fail(`${at}.motion`);
    const motion = parsed.motion as LinkCommonFactMotion;
    const age = count(parsed.age, `${at}.age`);
    if (motion !== 'squat_wait' && age >= LINK_COMMON_MOTION_FACTS[motion].sampleCount) return fail(`${at}.age`);
    return { motion, age, family, facing: facing(parsed.facing, `${at}.facing`) };
  };
  const root = record(value, path, ['generation', 'lastFrame', 'previous', 'transition', 'crouch',
    'shieldSession', 'idle', 'nextFallbackBrakeSide', 'lastBrakeChoice']);
  let previous: PreviousControl | null = null;
  if (root.previous !== null) {
    const parsed = record(root.previous, `${path}.previous`, ['grounded', 'facing', 'locomotion', 'inputX', 'crouching']);
    const locomotion = parsed.locomotion;
    if (typeof locomotion !== 'string' || !['standing', 'walk', 'initialDash', 'run', 'pivot', 'crouch'].includes(locomotion))
      return fail(`${path}.previous.locomotion`);
    previous = { grounded: boolean(parsed.grounded, `${path}.previous.grounded`),
      facing: facing(parsed.facing, `${path}.previous.facing`), locomotion: locomotion as LocomotionState['name'],
      inputX: finite(parsed.inputX, `${path}.previous.inputX`), crouching: boolean(parsed.crouching, `${path}.previous.crouching`) };
  }
  let shieldSession: LinkCommonPresentationState['shieldSession'] = null;
  if (root.shieldSession !== null) {
    const parsed = record(root.shieldSession, `${path}.shieldSession`, ['age', 'facing', 'interrupted', 'kind']);
    if (parsed.kind !== 'hold' && parsed.kind !== 'block') return fail(`${path}.shieldSession.kind`);
    shieldSession = { age: count(parsed.age, `${path}.shieldSession.age`),
      facing: facing(parsed.facing, `${path}.shieldSession.facing`),
      interrupted: boolean(parsed.interrupted, `${path}.shieldSession.interrupted`), kind: parsed.kind };
  }
  let idle: LinkCommonPresentationState['idle'] = null;
  if (root.idle !== null) {
    const parsed = record(root.idle, `${path}.idle`, ['motion', 'age', 'facing']);
    const motion = parsed.motion;
    if (motion !== 'wait' && motion !== 'wait_2' && motion !== 'wait_3') return fail(`${path}.idle.motion`);
    const age = count(parsed.age, `${path}.idle.age`);
    if (age >= LINK_COMMON_MOTION_FACTS[motion].sampleCount) return fail(`${path}.idle.age`);
    idle = { motion, age, facing: facing(parsed.facing, `${path}.idle.facing`) };
  }
  let lastBrakeChoice: LinkCommonPresentationState['lastBrakeChoice'] = null;
  if (root.lastBrakeChoice !== null) {
    const parsed = record(root.lastBrakeChoice, `${path}.lastBrakeChoice`, ['side', 'source']);
    if (parsed.source !== 'posed-support' && parsed.source !== 'authored-alternation') return fail(`${path}.lastBrakeChoice.source`);
    lastBrakeChoice = { side: side(parsed.side, `${path}.lastBrakeChoice.side`), source: parsed.source };
  }
  return frozen({ generation: count(root.generation, `${path}.generation`),
    lastFrame: root.lastFrame === null ? null : count(root.lastFrame, `${path}.lastFrame`), previous,
    transition: motionPhase(root.transition, `${path}.transition`, ['turn', 'brake']),
    crouch: motionPhase(root.crouch, `${path}.crouch`, ['crouch']), shieldSession, idle,
    nextFallbackBrakeSide: side(root.nextFallbackBrakeSide, `${path}.nextFallbackBrakeSide`), lastBrakeChoice });
}
