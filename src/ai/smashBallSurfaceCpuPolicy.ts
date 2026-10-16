/** Authored SmashBall strategy using actual support and registered attack data.
 * Safe goals are geometric, not a guarantee against external combat/physics.
 * Adjacent jumps require a current selected-kinetics proof plus a real executor;
 * otherwise only the current surface is pursued and base air recovery remains.
 */
import type { CharacterInput } from '../characters/Character';
import type { FinalResource } from '../finalSmash/finalSmashSchema';
export interface SmashBallCpuSurface { readonly id: number; readonly minX: number; readonly maxX: number; readonly topY: number; }
export interface SmashBallSurfaceCpuActor {
  readonly playerIndex: number; readonly generation: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly sourceRoot: { readonly x: number; readonly y: number };
  readonly feetY: number; readonly halfWidth: number;
  readonly velocity: { readonly x: number; readonly y: number };
  readonly facing: 1 | -1; readonly grounded: boolean; readonly mayJump: boolean; readonly mayAttack: boolean;
  readonly currentNeutralAttackIdentity?: string | null;
  readonly hasHeldItem?: boolean;
  readonly currentKineticIdentity?: { readonly selectedKineticConsumer: string; readonly tuningIdentity: string };
  /** Actual selected horizontal braking preview when recovered. Omission uses
   * only observed one-step velocity anticipation, labelled strategy heuristic. */
  readonly stoppingDistanceWorld?: number;
}
export interface SmashBallCpuJumpProof {
  readonly actorGeneration: number; readonly fromSurfaceId: number; readonly toSurfaceId: number;
  readonly selectedKineticConsumer: string; readonly tuningIdentity: string;
  readonly halfWidth: number;
  readonly surfaceGeometryIdentity: string;
  readonly origin: { readonly x: number; readonly feetY: number };
  readonly moveX: -1 | 1;
  /** Supplied by the actual current kinetic consumer, never a guessed jump
   * impulse/height. Absolute WORLD foot-centre/velocity at each fixed step.
   * Sample zero is the current PRE-launch state, not an already-set impulse. */
  readonly samples: readonly { readonly frame: number; readonly x: number; readonly feetY: number;
    readonly velocityX: number; readonly velocityY: number }[];
  /** Caller proves complete actual terrain/underside/wall sweeps separately;
   * a list of horizontal top surfaces alone cannot certify those contacts. */
  readonly completeTerrainSweep: true;
}
export interface SmashBallSurfaceCpuContext {
  readonly frame?: number;
  readonly actor: SmashBallSurfaceCpuActor; readonly surfaces: readonly SmashBallCpuSurface[];
  readonly supportBodyId: number | null;
  readonly ball: { readonly position: { readonly x: number; readonly y: number }; readonly radius: number;
    readonly variant: 'ordinary' | 'heavy'; readonly active: boolean } | null;
  readonly eligible: boolean; readonly availableResource: FinalResource | null; readonly activeFinal: boolean;
  readonly previousAttackHeld: boolean;
  /** Absolute WORLD bounds of actual current first-active attack contacts.
   * No body-torso or generic reach replacement when paired data is missing. */
  readonly attackContactRange?: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number } | null;
  readonly attackContactProvenance?: { readonly moveIdentity: string; readonly generation: number;
    readonly frame: number; readonly actorPosition: { readonly x: number; readonly y: number };
    readonly sourceRoot: { readonly x: number; readonly y: number };
    readonly facing: 1 | -1; readonly intent: 'neutral-ground-light'; readonly heldItemRoute: 'unarmed';
    readonly previewKind: 'first-active' } | null;
  readonly jumpProofs?: readonly SmashBallCpuJumpProof[];
  /** Actual Scene owns an advancing/checkpointed proof executor; without it,
   * this stateless policy must never start a jump it cannot follow through. */
  readonly canExecuteJumpProof?: boolean;
}
export interface SmashBallSurfaceCpuDecision {
  readonly input: CharacterInput;
  readonly strategy: 'base' | 'pursue-current-surface' | 'wait-at-safe-edge' | 'brake-safe-surface'
    | 'attack-ball' | 'release-attack' | 'jump-proved-surface';
  readonly surfaceId?: number;
  readonly jumpProof?: SmashBallCpuJumpProof;
  /** Scene-owned retained strategy target, never a physics/facing command.
   * Relocate with normal input, then turn normally to the preview's facing;
   * fresh actual geometry must reach before attack. */
  readonly surfaceGoal?: { readonly x: number; readonly attackFacing: 1 | -1;
    readonly neutralAttackIdentity: string; readonly surfaceGeometryIdentity: string;
    readonly actorGeneration: number; readonly halfWidth: number;
    readonly ballPosition: { readonly x: number; readonly y: number } };
}
function finitePoint(p: { x: number; y: number }): boolean { return Number.isFinite(p.x) && Number.isFinite(p.y); }
function liveSurface(s: SmashBallCpuSurface): boolean {
  return Number.isSafeInteger(s.id) && s.id >= 0 && [s.minX, s.maxX, s.topY].every(Number.isFinite) && s.minX < s.maxX;
}
/** Exact snapshot of all supplied actual support geometry. A moved/resized or
 * newly enabled surface invalidates a cached complete-terrain proof. */
export function smashBallCpuSurfaceGeometryIdentity(surfaces: readonly SmashBallCpuSurface[]): string | null {
  if (surfaces.some(s => !liveSurface(s)) || new Set(surfaces.map(s => s.id)).size !== surfaces.length) return null;
  return JSON.stringify([...surfaces].sort((a, b) => a.id - b.id).map(s => [s.id, s.minX, s.maxX, s.topY]));
}
function interval(s: SmashBallCpuSurface, halfWidth: number) {
  const left = s.minX + halfWidth, right = s.maxX - halfWidth;
  return left <= right ? { left, right } : null;
}
function intent(base: CharacterInput, moveX: number, attack = false, jump = false): CharacterInput {
  return Object.freeze({ ...base, moveX, moveY: 0, jump, attack, attackHeavy: false,
    attackStickX: 0, attackStickY: 0, special: false, shield: false, grab: false, dodge: false,
    dropThrough: false, ledgeRelease: null, appeal: false });
}
/** Validate the actual proof against its current origin/identity and earliest
 * descending platform crossing, including the complete hull at landing.
 * Does not reconstruct unrecovered native kinetics from parameter names. */
export function smashBallCpuJumpProofLanding(proof: SmashBallCpuJumpProof, actor: SmashBallSurfaceCpuActor,
  surfaces: readonly SmashBallCpuSurface[], supportBodyId: number): { surfaceId: number; x: number } | null {
  if (proof.actorGeneration !== actor.generation || proof.fromSurfaceId !== supportBodyId
    || proof.toSurfaceId === supportBodyId || !proof.selectedKineticConsumer.trim() || !proof.tuningIdentity.trim()
    || !actor.currentKineticIdentity
    || proof.selectedKineticConsumer !== actor.currentKineticIdentity.selectedKineticConsumer
    || proof.tuningIdentity !== actor.currentKineticIdentity.tuningIdentity
    || proof.halfWidth !== actor.halfWidth || !Number.isFinite(actor.halfWidth) || actor.halfWidth <= 0
    || proof.surfaceGeometryIdentity !== smashBallCpuSurfaceGeometryIdentity(surfaces)
    || proof.completeTerrainSweep !== true || proof.origin.x !== actor.position.x || proof.origin.feetY !== actor.feetY
    || proof.moveX !== 1 && proof.moveX !== -1 || proof.samples.length < 3) return null;
  const source = surfaces.find(s => s.id === supportBodyId), target = surfaces.find(s => s.id === proof.toSurfaceId);
  if (!source || !target || !liveSurface(source) || !liveSurface(target)) return null;
  const safe = interval(target, actor.halfWidth); if (!safe) return null;
  const first = proof.samples[0]!;
  if (first.frame !== 0 || first.x !== actor.position.x || first.feetY !== actor.feetY
    || first.velocityX !== actor.velocity.x || first.velocityY !== actor.velocity.y) return null;
  let airborne = false, rising = false;
  for (let i = 0; i < proof.samples.length; i++) {
    const sample = proof.samples[i]!;
    if (sample.frame !== i || ![sample.x, sample.feetY, sample.velocityX, sample.velocityY].every(Number.isFinite)) return null;
    rising ||= sample.velocityY < 0;
    airborne ||= sample.feetY < source.topY;
    if (!i || !airborne) continue;
    const prior = proof.samples[i - 1]!;
    if (sample.feetY <= prior.feetY) continue;
    let firstTouch: { fraction: number; surface: SmashBallCpuSurface; x: number } | null = null;
    for (const s of surfaces) {
      if (!liveSurface(s) || prior.feetY > s.topY || sample.feetY < s.topY) continue;
      const fraction = (s.topY - prior.feetY) / (sample.feetY - prior.feetY);
      const x = prior.x * (1 - fraction) + sample.x * fraction;
      if (x + actor.halfWidth < s.minX || x - actor.halfWidth > s.maxX) continue;
      if (!firstTouch || fraction < firstTouch.fraction || fraction === firstTouch.fraction && s.id < firstTouch.surface.id)
        firstTouch = { fraction, surface: s, x };
    }
    if (firstTouch) return rising && firstTouch.surface.id === target.id && firstTouch.x >= safe.left && firstTouch.x <= safe.right
      ? { surfaceId: target.id, x: firstTouch.x } : null;
  }
  return null;
}
export function smashBallSurfaceCpuInput(base: CharacterInput,
  context: SmashBallSurfaceCpuContext): SmashBallSurfaceCpuDecision {
  const a = context.actor, ball = context.ball;
  const preserve = (): SmashBallSurfaceCpuDecision => Object.freeze({ input: base, strategy: 'base' });
  if (!context.eligible || context.activeFinal || context.availableResource !== null || !ball?.active
    || !a.grounded || !a.mayAttack || context.supportBodyId === null
    || !Number.isSafeInteger(a.playerIndex) || a.playerIndex < 0 || !Number.isSafeInteger(a.generation) || a.generation < 0
    || !finitePoint(a.position) || !finitePoint(a.sourceRoot) || !finitePoint(a.velocity) || !finitePoint(ball.position)
    || !Number.isFinite(a.feetY) || !Number.isFinite(a.halfWidth) || a.halfWidth <= 0
    || !Number.isFinite(ball.radius) || ball.radius <= 0 || a.facing !== 1 && a.facing !== -1
    || ball.variant !== 'ordinary' && ball.variant !== 'heavy') return preserve();
  const range = context.attackContactRange;
  const provenance = context.attackContactProvenance;
  if (!provenance || !a.currentNeutralAttackIdentity || a.hasHeldItem !== false
    || !Number.isSafeInteger(context.frame) || context.frame! < 0 || provenance.frame !== context.frame
    || provenance.actorPosition.x !== a.position.x || provenance.actorPosition.y !== a.position.y
    || provenance.sourceRoot.x !== a.sourceRoot.x || provenance.sourceRoot.y !== a.sourceRoot.y
    || provenance.moveIdentity !== a.currentNeutralAttackIdentity || provenance.generation !== a.generation
    || provenance.facing !== a.facing || provenance.intent !== 'neutral-ground-light'
    || provenance.heldItemRoute !== 'unarmed' || provenance.previewKind !== 'first-active') return preserve();
  if (!range || ![range.minX, range.maxX, range.minY, range.maxY].every(Number.isFinite)
    || range.minX > range.maxX || range.minY > range.maxY) return preserve();
  const current = context.surfaces.find(s => s.id === context.supportBodyId);
  if (!current || !liveSurface(current)) return preserve();
  const safe = interval(current, a.halfWidth); if (!safe) return preserve();
  const surfaceGeometryIdentity = smashBallCpuSurfaceGeometryIdentity(context.surfaces);
  if (surfaceGeometryIdentity === null) return preserve();
  const rootOffsetX = a.sourceRoot.x - a.position.x;
  // Position the actual registered contact envelope, rather than the torso or
  // ROOT, beneath the Ball. Ahead-only envelopes can have a real empty gap
  // near the body; stopping directly under the Ball would never hit it.
  const contactOffsetX = (range.minX + range.maxX) / 2 - a.position.x;
  const wantedX = ball.position.x - contactOffsetX;
  const goalX = Math.max(safe.left, Math.min(safe.right, wantedX));
  const surfaceGoal = Object.freeze({ x: goalX, attackFacing: a.facing,
    neutralAttackIdentity: a.currentNeutralAttackIdentity!, surfaceGeometryIdentity,
    actorGeneration: a.generation, halfWidth: a.halfWidth, ballPosition: Object.freeze({ ...ball.position }) });
  // Reverse outward momentum before reaching the hull boundary. Without a
  // native brake preview this is only one observed-step anticipation, never
  // a promised instantaneous stop or a hidden actor-velocity write.
  const suppliedStop = a.stoppingDistanceWorld;
  if (suppliedStop !== undefined && (!Number.isFinite(suppliedStop) || suppliedStop < 0)) return preserve();
  const excursion = suppliedStop ?? Math.abs(a.velocity.x);
  const stoppingX = a.position.x + Math.sign(a.velocity.x) * excursion;
  if (a.velocity.x > 0 && stoppingX >= safe.right || a.velocity.x < 0 && stoppingX <= safe.left)
    return Object.freeze({ input: intent(base, -Math.sign(a.velocity.x)), strategy: 'brake-safe-surface', surfaceId: current.id, surfaceGoal });
  if (range && [range.minX, range.maxX, range.minY, range.maxY].every(Number.isFinite)
    && range.minX <= range.maxX && range.minY <= range.maxY) {
    const x = Math.max(range.minX, Math.min(range.maxX, ball.position.x));
    const y = Math.max(range.minY, Math.min(range.maxY, ball.position.y));
    if ((x - ball.position.x) ** 2 + (y - ball.position.y) ** 2 <= ball.radius ** 2)
      return Object.freeze({ input: intent(base, 0, !context.previousAttackHeld),
        strategy: context.previousAttackHeld ? 'release-attack' : 'attack-ball', surfaceId: current.id, surfaceGoal });
  }
  if (a.mayJump && context.canExecuteJumpProof) {
    const currentDistance = Math.hypot(goalX + rootOffsetX - ball.position.x, a.sourceRoot.y - ball.position.y);
    const candidates = (context.jumpProofs ?? []).flatMap(proof => {
      const landing = smashBallCpuJumpProofLanding(proof, a, context.surfaces, current.id);
      if (!landing) return [];
      const s = context.surfaces.find(s => s.id === landing.surfaceId)!;
      const distance = Math.hypot(landing.x + rootOffsetX - ball.position.x,
        s.topY + a.sourceRoot.y - a.feetY - ball.position.y);
      return distance < currentDistance ? [{ proof, landing, distance }] : [];
    }).sort((x, y) => x.distance - y.distance || x.landing.surfaceId - y.landing.surfaceId);
    if (candidates.length) return Object.freeze({ input: intent(base, candidates[0]!.proof.moveX, false, true),
      strategy: 'jump-proved-surface', surfaceId: candidates[0]!.landing.surfaceId, jumpProof: candidates[0]!.proof });
  }
  // Goal lies inside the current support even when the Ball is beyond it.
  // One observed-step anticipation is an authored stopping heuristic, not
  // a fabricated attack reach or a promised instantaneous physics stop.
  const dx = goalX - a.position.x;
  const atGoal = dx === 0 || Math.abs(dx) <= Math.abs(a.velocity.x);
  return Object.freeze({ input: intent(base, atGoal ? 0 : Math.sign(dx)),
    strategy: atGoal ? 'wait-at-safe-edge' : 'pursue-current-surface', surfaceId: current.id, surfaceGoal });
}
