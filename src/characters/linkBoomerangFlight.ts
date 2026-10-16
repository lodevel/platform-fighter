/** Source-valued article motion with named engine scheduler adapters.
 * Source/selection: source-contracts/boomerang-flight-consumer-selection.json.
 * Scene owns real posed Waist registration, sweeps, packet contacts and catch
 * admission. Retained FLY/TURN/HOP callers and unresolved common kinetic/terrain
 * dispatch are distinguished in the source receipt.
 */
import { LINK_BOOMERANG_SOURCE as P, type LinkBoomerangContactPhase,
  type LinkBoomerangThrowKind } from './linkBoomerang';

export interface LinkBoomerangVector { readonly x: number; readonly y: number; }
export type LinkBoomerangRetirement = 'lifetime' | 'return-distance' | 'catch' | 'clash-ground' | 'teardown';
export interface LinkBoomerangFlightState {
  readonly id: number;
  readonly originalOwnerIndex: number;
  readonly originalOwnerGeneration: number;
  readonly attributedOwnerIndex: number;
  readonly throwKind: LinkBoomerangThrowKind;
  readonly phase: 'fly' | 'turn' | 'clash' | 'retired';
  readonly releaseAge: number;
  readonly phaseAge: number;
  readonly life: number;
  /** Admission-snapshotted current authoring values, never refreshed by a
   * reflector/repick or owner-generation change. Default source values remain
   * independently selected in the source contract. */
  readonly initialSpeedNative: number;
  readonly lifetimeFrames: number;
  readonly returnSpeedCapNative: number;
  readonly position: LinkBoomerangVector;
  readonly velocity: LinkBoomerangVector;
  readonly pixelsPerNativeUnit: number;
  /** Native XY-up angle; world velocity Y is down. */
  readonly angleRadians: number;
  readonly turnDistanceNative: number;
  readonly followFrames: number;
  /** Retained reflection flag disables parent aim/catch even after a return
   * reflection. Attribution and original parent identity are distinct. */
  readonly reflected: boolean;
  readonly pendingInfliction: boolean;
  readonly terrainCorrection: 'air' | 'none';
  readonly lastFrame: number | null;
  readonly retirement: LinkBoomerangRetirement | null;
}
export interface LinkBoomerangOwnerCue {
  readonly linked: boolean;
  readonly sameTeamOwner: boolean;
  /** Actual current native Waist projection, never actor ROOT fallback. */
  readonly waist: LinkBoomerangVector | null;
  /** Actual actor source ROOT Y; absent data must not use body-centre Y. */
  readonly sourceRootY?: number | null;
  /** Native parent result is supplied by the real catch admission consumer. */
  readonly eventAccepted: boolean;
  readonly mayPlayCatch: boolean;
}
export type LinkBoomerangFlightEvent =
  | { readonly kind: 'turn'; readonly id: number }
  | { readonly kind: 'catch'; readonly id: number; readonly ownerIndex: number;
      readonly parentAccepted: boolean; readonly playPresentation: boolean }
  | { readonly kind: 'retire'; readonly id: number; readonly reason: LinkBoomerangRetirement };
export interface LinkBoomerangSweep {
  readonly from: LinkBoomerangVector;
  readonly to: LinkBoomerangVector;
  readonly contactPhase: LinkBoomerangContactPhase | null;
}
export interface LinkBoomerangFlightStep {
  readonly state: LinkBoomerangFlightState;
  readonly events: readonly LinkBoomerangFlightEvent[];
  /** Resolve this transaction before its retire event, including life0's last
   * movement. Catch/distance admission at the old position produces no sweep. */
  readonly sweep: LinkBoomerangSweep | null;
}

function integer(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid Boomerang ${field}`);
  return value;
}
function vector(value: LinkBoomerangVector): LinkBoomerangVector {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('Nonfinite Boomerang vector');
  return Object.freeze({ x: value.x, y: value.y });
}
function state(value: LinkBoomerangFlightState): LinkBoomerangFlightState {
  integer(value.lifetimeFrames, 'selected lifetime');
  if (value.lifetimeFrames === 0 || ![value.initialSpeedNative, value.returnSpeedCapNative]
    .every(v => Number.isFinite(v) && v >= 0)) throw new TypeError('Invalid snapshotted Boomerang authoring values');
  return Object.freeze({ ...value, position: vector(value.position), velocity: vector(value.velocity) });
}
function wrap(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  return wrapped;
}
function nativeSpeed(value: LinkBoomerangFlightState): number {
  return Math.hypot(value.velocity.x, value.velocity.y) / value.pixelsPerNativeUnit;
}
function velocity(angle: number, speed: number, scale: number): LinkBoomerangVector {
  return { x: Math.cos(angle) * speed * scale, y: -Math.sin(angle) * speed * scale };
}
function result(value: LinkBoomerangFlightState, events: readonly LinkBoomerangFlightEvent[],
  sweep: LinkBoomerangSweep | null = null): LinkBoomerangFlightStep {
  return Object.freeze({ state: state(value), events: Object.freeze(events.map(event => Object.freeze(event))),
    sweep: sweep ? Object.freeze({ ...sweep, from: vector(sweep.from), to: vector(sweep.to) }) : null });
}
function retire(value: LinkBoomerangFlightState, reason: LinkBoomerangRetirement,
  events: readonly LinkBoomerangFlightEvent[] = [], sweep: LinkBoomerangSweep | null = null): LinkBoomerangFlightStep {
  return result({ ...value, phase: 'retired', retirement: reason },
    [...events, { kind: 'retire', id: value.id, reason }], sweep);
}

export function beginLinkBoomerangFlight(input: {
  readonly id: number; readonly originalOwnerIndex: number; readonly originalOwnerGeneration: number;
  readonly origin: LinkBoomerangVector; readonly facing: 1 | -1; readonly angleDegrees: number;
  readonly throwKind: LinkBoomerangThrowKind; readonly pixelsPerNativeUnit: number;
  readonly initialSpeedNative?: number;
  readonly lifetimeFrames?: number;
  readonly returnSpeedCapNative?: number;
}): LinkBoomerangFlightState {
  integer(input.id, 'id'); integer(input.originalOwnerIndex, 'owner');
  integer(input.originalOwnerGeneration, 'generation');
  if (input.facing !== 1 && input.facing !== -1) throw new TypeError('Invalid Boomerang facing');
  if (!Number.isFinite(input.angleDegrees) || Math.abs(input.angleDegrees) > P.maximumVerticalDeviationDegrees)
    throw new RangeError('Boomerang release angle exceeds the selected source limit');
  if (input.throwKind !== 'tilt' && input.throwKind !== 'smash') throw new TypeError('Invalid Boomerang throw kind');
  if (!Number.isFinite(input.pixelsPerNativeUnit) || input.pixelsPerNativeUnit <= 0)
    throw new RangeError('Positive Boomerang source/world scale required');
  const localAngle = input.angleDegrees * Math.PI / 180;
  const angle = input.facing === 1 ? localAngle : Math.PI - localAngle;
  const initialSpeedNative = input.initialSpeedNative ?? P.initialSpeedNative[input.throwKind];
  const lifetimeFrames = input.lifetimeFrames ?? P.publicLifetimeFrames[input.throwKind];
  const returnSpeedCapNative = input.returnSpeedCapNative ?? P.returnMaximumSpeedNative;
  if (![initialSpeedNative, returnSpeedCapNative].every(v => Number.isFinite(v) && v >= 0))
    throw new TypeError('Current Boomerang speeds must be finite and nonnegative');
  integer(lifetimeFrames, 'selected lifetime');
  if (lifetimeFrames === 0) throw new RangeError('Current Boomerang lifetime must be positive');
  return state({ id: input.id, originalOwnerIndex: input.originalOwnerIndex,
    originalOwnerGeneration: input.originalOwnerGeneration, attributedOwnerIndex: input.originalOwnerIndex,
    throwKind: input.throwKind, phase: 'fly', releaseAge: 0, phaseAge: 0,
    life: lifetimeFrames, initialSpeedNative, lifetimeFrames, returnSpeedCapNative, position: input.origin,
    velocity: velocity(angle, initialSpeedNative, input.pixelsPerNativeUnit),
    pixelsPerNativeUnit: input.pixelsPerNativeUnit, angleRadians: angle,
    turnDistanceNative: 0, followFrames: 128, reflected: false, pendingInfliction: false,
    terrainCorrection: 'air', lastFrame: null, retirement: null });
}

export function linkBoomerangFlightContactPhase(value: LinkBoomerangFlightState): LinkBoomerangContactPhase | null {
  return value.phase === 'turn' ? 'return' : value.phase === 'fly'
    ? value.phaseAge < 10 ? 'clean' : 'late' : null;
}

export function stepLinkBoomerangFlight(value: LinkBoomerangFlightState, input: {
  readonly frame: number; readonly clockAdvances: boolean;
  readonly owner: LinkBoomerangOwnerCue | null;
  /** Actual accepted outgoing collision receipt, including native shield
   * infliction. Retained ALL mask is0x7f; explicit clash/HOP has priority. */
  readonly confirmedInfliction?: boolean;
  /** Native APPLY_FLY_SPEED flag's external producer is unavailable. Root
   * selected true for ordinary released flight; caller can supply actual flag. */
  readonly applyFlySpeed?: boolean;
  readonly clashGrounded?: boolean;
  /** Match/article teardown is explicit; an owner stock generation change
   * alone is not silently converted into an unrecovered native destruction. */
  readonly teardown?: boolean;
}): LinkBoomerangFlightStep {
  integer(input.frame, 'frame');
  if (value.phase === 'retired') return result(value, []);
  const latched = input.confirmedInfliction ? markLinkBoomerangInfliction(value) : value;
  if (value.lastFrame !== null && input.frame < value.lastFrame) throw new RangeError('Boomerang clock moved backwards');
  if (input.teardown) return retire({ ...latched, lastFrame: input.frame }, 'teardown');
  if (value.lastFrame === input.frame) return result(latched, []);
  if (!input.clockAdvances) return result({ ...latched, lastFrame: input.frame }, []);
  let current: LinkBoomerangFlightState = { ...latched, lastFrame: input.frame };
  const events: LinkBoomerangFlightEvent[] = [];
  if (current.phase === 'clash' && input.clashGrounded) return retire(current, 'clash-ground');
  // Native is_penetration0: retain accepted infliction through local stop and
  // enter TURN before the next outgoing sweep. Native exact status/exec timing
  // is separate from this selected fixedstep transaction.
  if (current.phase === 'fly' && current.pendingInfliction) {
    current = { ...current, phase: 'turn', phaseAge: 0, pendingInfliction: false,
      turnDistanceNative: 0, followFrames: 128, terrainCorrection: 'air',
      angleRadians: current.angleRadians <= 0 ? current.angleRadians + Math.PI : current.angleRadians - Math.PI };
    events.push({ kind: 'turn', id: current.id });
  }
  const owner = input.owner;
  const parentAvailable = owner?.linked === true && owner.sameTeamOwner && !current.reflected;
  if (owner?.waist) vector(owner.waist);
  if (owner?.sourceRootY !== null && owner?.sourceRootY !== undefined) {
    if (!Number.isFinite(owner.sourceRootY)) throw new TypeError('Nonfinite Boomerang parent source ROOT');
    if (current.phase === 'turn' && owner.linked &&
      Math.abs(owner.sourceRootY - current.position.y) >= 4 * 10 * current.pixelsPerNativeUnit)
      current = { ...current, terrainCorrection: 'none' };
  }
  // Turn fastshift checks catch first, then the accumulated RETURN distance.
  // The retained caller uses vec3 distance; this game projects it to XY.
  if (current.phase === 'turn') {
    if (parentAvailable && owner?.waist &&
      Math.hypot(owner.waist.x - current.position.x, owner.waist.y - current.position.y) <= 9 * current.pixelsPerNativeUnit)
      return retire(current, 'catch', [...events, { kind: 'catch', id: current.id, ownerIndex: current.originalOwnerIndex,
        parentAccepted: owner.eventAccepted, playPresentation: owner.eventAccepted && owner.mayPlayCatch }]);
    if (current.turnDistanceNative >= P.turningDistanceNative[current.throwKind] * 10)
      return retire(current, 'return-distance', events);
  }
  if (current.life <= 0) return retire(current, 'lifetime', events);
  let angle = current.angleRadians;
  let speed = nativeSpeed(current);
  let followFrames = current.followFrames;
  let turnDistanceNative = current.turnDistanceNative;
  let nextVelocity: LinkBoomerangVector;
  if (current.phase === 'clash') {
    nextVelocity = { x: current.velocity.x,
      y: Math.min(P.clash.terminalFallSpeedNative * current.pixelsPerNativeUnit,
        current.velocity.y + P.clash.gravityNative * current.pixelsPerNativeUnit) };
  } else {
    if (current.phase === 'turn') {
      if (parentAvailable && owner?.waist && followFrames > 0) {
        const target = Math.atan2(-(owner.waist.y - current.position.y), owner.waist.x - current.position.x);
        const delta = wrap(target - angle), limit = P.returnAngleStepDegrees * Math.PI / 180;
        angle += Math.max(-limit, Math.min(limit, delta));
        followFrames -= 1;
      }
      speed = Math.min(current.returnSpeedCapNative, speed + P.decelerationNative);
      turnDistanceNative += speed;
      if (turnDistanceNative >= 19 * 10) followFrames = 0;
    } else speed = Math.max(P.minimumSpeedNative, speed - P.decelerationNative);
    nextVelocity = velocity(angle, speed, current.pixelsPerNativeUnit);
  }
  const position = { x: current.position.x + nextVelocity.x, y: current.position.y + nextVelocity.y };
  const sweep = { from: current.position, to: position, contactPhase: linkBoomerangFlightContactPhase(current) };
  let next: LinkBoomerangFlightState = { ...current, position, velocity: nextVelocity,
    angleRadians: angle, life: current.life - 1, releaseAge: current.releaseAge + 1,
    phaseAge: current.phaseAge + 1, followFrames, turnDistanceNative };
  if (current.phase === 'fly' && speed <= P.minimumSpeedNative && input.applyFlySpeed !== false) {
    // Native threshold/flag recovered; boundary scheduling remains selected.
    // The final outgoing sweep retains
    // its outgoing packet; TURN's new3% packet begins the following step.
    next = { ...next, phase: 'turn', phaseAge: 0, pendingInfliction: false, turnDistanceNative: 0, followFrames: 128,
      terrainCorrection: 'air',
      angleRadians: angle <= 0 ? angle + Math.PI : angle - Math.PI };
    events.push({ kind: 'turn', id: current.id });
  }
  if (next.life <= 0) return retire(next, 'lifetime', events, sweep);
  return result(next, events, sweep);
}

/** Real collision consumer calls this once; no age/velocity mutation during
 * contact or local stop. HOP and already-returning articles do not relatch. */
export function markLinkBoomerangInfliction(value: LinkBoomerangFlightState): LinkBoomerangFlightState {
  return value.phase === 'fly' && !value.pendingInfliction ? state({ ...value, pendingInfliction: true }) : value;
}

/** Actual swept terrain contact -> native correction/notification admission.
 * Scene owns the opaque event0x18b78d41a0 response (bounce/pass-through).
 * Pinned Ghidra checks correction!=NONE; a reconstructed Rust consumer has
 * that equality reversed. Side-first simultaneous corner handling is selected
 * engine policy, not recovered native cached-correction scheduler parity. */
export function applyLinkBoomerangTerrainContact(value: LinkBoomerangFlightState, input: {
  readonly side: boolean; readonly vertical: boolean; readonly statusChanging: boolean;
}): { readonly state: LinkBoomerangFlightState; readonly notifyTerrain: boolean } {
  if (value.phase === 'fly') return Object.freeze({ state: value, notifyTerrain: input.side || input.vertical });
  if (value.phase !== 'turn' || value.terrainCorrection === 'none')
    return Object.freeze({ state: value, notifyTerrain: false });
  if (input.side && !input.statusChanging)
    return Object.freeze({ state: state({ ...value, terrainCorrection: 'none' }), notifyTerrain: false });
  return Object.freeze({ state: value, notifyTerrain: input.vertical });
}

/** Terrain response may redirect motion without reflector ownership/flag
 * mutation. The actual response formula is a separately recorded adapter. */
export function redirectLinkBoomerangFlight(value: LinkBoomerangFlightState,
  redirectedVelocity: LinkBoomerangVector): LinkBoomerangFlightState {
  vector(redirectedVelocity);
  return value.phase === 'retired' ? value : state({ ...value, velocity: redirectedVelocity,
    angleRadians: Math.atan2(-redirectedVelocity.y, redirectedVelocity.x) });
}

/** Reflector supplies actual world velocity and attribution. No source damage
 * multiplier or owner catch reset is inferred from being a projectile. */
export function reflectLinkBoomerangFlight(value: LinkBoomerangFlightState,
  ownerIndex: number, reflectedVelocity: LinkBoomerangVector): LinkBoomerangFlightState {
  integer(ownerIndex, 'reflected owner'); vector(reflectedVelocity);
  if (value.phase === 'retired' || value.phase === 'clash') return value;
  return state({ ...value, attributedOwnerIndex: ownerIndex, reflected: true,
    velocity: reflectedVelocity, angleRadians: Math.atan2(-reflectedVelocity.y, reflectedVelocity.x) });
}

/** Native HOP uses hop_speed_x * PostureLR. An actual posture cue or supplied
 * velocity takes precedence; only absent registration uses the coordinator's
 * authored incoming-travel fallback, including after reflection. */
export function clashLinkBoomerangFlight(value: LinkBoomerangFlightState,
  input: { readonly velocityWorld?: LinkBoomerangVector; readonly postureFacing?: 1 | -1 } = {}): LinkBoomerangFlightState {
  if (value.phase === 'retired' || value.phase === 'clash') return value;
  if (input.postureFacing !== undefined && input.postureFacing !== 1 && input.postureFacing !== -1)
    throw new TypeError('Invalid Boomerang clash posture');
  const travel = input.postureFacing ?? (Math.sign(value.velocity.x) || Math.sign(Math.cos(value.angleRadians)) || 1);
  const hop = input.velocityWorld ?? { x: P.clash.horizontalSpeedNative * travel * value.pixelsPerNativeUnit,
    y: -P.clash.verticalSpeedNative * value.pixelsPerNativeUnit };
  vector(hop);
  return state({ ...value, phase: 'clash', phaseAge: 0, life: P.clash.lifetimeFrames, pendingInfliction: false,
    velocity: hop, angleRadians: Math.atan2(-hop.y, hop.x) });
}

/** Closed saved flight state. Admission authoring values persist with actual
 * remaining clocks; restore cannot refresh an existing article's lifetime. */
export function parseLinkBoomerangFlightState(value: unknown): LinkBoomerangFlightState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Malformed Boomerang checkpoint');
  const s = value as LinkBoomerangFlightState;
  const keys = ['id', 'originalOwnerIndex', 'originalOwnerGeneration', 'attributedOwnerIndex', 'throwKind', 'phase',
    'releaseAge', 'phaseAge', 'life', 'initialSpeedNative', 'lifetimeFrames', 'returnSpeedCapNative',
    'position', 'velocity', 'pixelsPerNativeUnit', 'angleRadians', 'turnDistanceNative', 'followFrames',
    'reflected', 'pendingInfliction', 'terrainCorrection', 'lastFrame', 'retirement'];
  if (Object.keys(s).some(key => !keys.includes(key))) throw new TypeError('Unknown Boomerang checkpoint field');
  for (const key of ['id', 'originalOwnerIndex', 'originalOwnerGeneration', 'attributedOwnerIndex',
    'releaseAge', 'phaseAge', 'life', 'followFrames'] as const) integer(s[key], key);
  if (s.lastFrame !== null) integer(s.lastFrame, 'last frame');
  if (!['tilt', 'smash'].includes(s.throwKind) || !['fly', 'turn', 'clash', 'retired'].includes(s.phase)
    || typeof s.reflected !== 'boolean' || typeof s.pendingInfliction !== 'boolean'
    || !['air', 'none'].includes(s.terrainCorrection) || !Number.isFinite(s.pixelsPerNativeUnit) || s.pixelsPerNativeUnit <= 0
    || !Number.isFinite(s.angleRadians) || !Number.isFinite(s.turnDistanceNative) || s.turnDistanceNative < 0)
    throw new TypeError('Malformed Boomerang checkpoint phase');
  const retirements = ['lifetime', 'return-distance', 'catch', 'clash-ground', 'teardown'];
  if (s.phase === 'retired' ? !retirements.includes(s.retirement as string) : s.retirement !== null)
    throw new TypeError('Malformed Boomerang retirement');
  const lifeCap = s.phase === 'clash' ? P.clash.lifetimeFrames
    : s.phase === 'retired' ? Math.max(s.lifetimeFrames, P.clash.lifetimeFrames) : s.lifetimeFrames;
  if (s.life > lifeCap) throw new TypeError('Boomerang checkpoint refreshes lifetime');
  return state(s);
}
