import type { Character } from './Character';

const MATTER_BASE_DELTA_MS = 1000 / 60;
const BOUNDARY_EPSILON = 1e-10;

export interface CharacterPhysicsStepOptions {
  readonly characters: readonly Character[];
  readonly bodies: readonly MatterJS.BodyType[];
  readonly gravity: { x: number; y: number; scale?: number };
  readonly body: {
    setVelocity(body: MatterJS.BodyType, velocity: { x: number; y: number }): unknown;
    setAngularVelocity(body: MatterJS.BodyType, velocity: number): unknown;
  };
  readonly stepWorld: (deltaMs: number) => void;
  readonly deltaMs: number;
  /** Observe contacts/KO at the same outer frame, without advancing game clocks. */
  readonly afterSubstep?: () => void;
}

interface ReferencePlan {
  readonly character: Character;
  readonly token: object;
  readonly ticks: number;
  nextTick: number;
}

interface BodySettings {
  readonly body: MatterJS.BodyType;
  readonly frictionAir: number;
  queuedForceX: number;
  queuedForceY: number;
  queuedTorque: number;
}

function gravityVelocityY(
  body: MatterJS.BodyType,
  gravity: CharacterPhysicsStepOptions['gravity'],
  deltaMs: number,
): number {
  if (body.ignoreGravity || body.isStatic || body.isSleeping) return 0;
  return gravity.y * (gravity.scale ?? 0.001)
    * deltaMs * body.timeScale * MATTER_BASE_DELTA_MS;
}

/**
 * Run one outer physics frame, sampling collisions between grouped reference
 * launch ticks. Input, attacks, hazards and all other game clocks stay outside
 * this coordinator. Without compression the original single Matter step is
 * preserved exactly.
 *
 * For subdivision, ordinary bodies receive their full-frame force, gravity
 * and air friction once before transport. Constant-velocity substeps then
 * preserve their original free-flight displacement and final velocity. Only
 * Character's separately owned reference energy receives faster transport.
 */
export function stepCharacterPhysics(options: CharacterPhysicsStepOptions): void {
  const { characters, bodies, gravity, body: bodyApi, stepWorld, deltaMs, afterSubstep } = options;
  const plans: ReferencePlan[] = [];
  for (const character of characters) {
    const plan = character.getReferencePhysicsStep();
    if (plan === null) continue;
    if (!Number.isInteger(plan.ticks) || plan.ticks < 1) {
      throw new RangeError('Reference physics tick count must be a positive integer');
    }
    plans.push({ character, token: plan.token, ticks: plan.ticks, nextTick: 1 });
  }
  const characterGravity = new Map(characters.map(character =>
    [character, gravityVelocityY(character.body, gravity, deltaMs)] as const));

  if (!plans.some(plan => plan.ticks > 1)) {
    for (const character of characters) character.preparePhysicsStep(characterGravity.get(character)!);
    stepWorld(deltaMs);
    for (const character of characters) {
      character.applyPostPhysicsVelocityConstraints(characterGravity.get(character)!);
    }
    afterSubstep?.();
    return;
  }

  const boundarySet = new Set<number>([0, 1]);
  for (const plan of plans) {
    for (let tick = 1; tick < plan.ticks; tick++) boundarySet.add(tick / plan.ticks);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);
  const gravityBefore = { x: gravity.x, y: gravity.y };
  const settings: BodySettings[] = bodies.map(body => ({
    body, frictionAir: body.frictionAir, queuedForceX: 0, queuedForceY: 0, queuedTorque: 0,
  }));
  // Forces queued by observers belong to the next outer frame. Do not feed
  // them into the remaining substeps merely because collision sampling grew.
  const queueNewForces = () => {
    for (const state of settings) {
      state.queuedForceX += state.body.force.x;
      state.queuedForceY += state.body.force.y;
      state.queuedTorque += state.body.torque;
      state.body.force.x = 0;
      state.body.force.y = 0;
      state.body.torque = 0;
    }
  };

  try {
    for (const state of settings) {
      const current = state.body;
      if (!current.isStatic && !current.isSleeping) {
        const effectiveDelta = deltaMs * current.timeScale;
        const friction = 1 - current.frictionAir * effectiveDelta / MATTER_BASE_DELTA_MS;
        const forceToVelocity = effectiveDelta * MATTER_BASE_DELTA_MS;
        const gravityScale = current.ignoreGravity ? 0 : gravity.scale ?? 0.001;
        bodyApi.setVelocity(current, {
          x: current.velocity.x * friction
            + (current.force.x / current.mass + gravity.x * gravityScale) * forceToVelocity,
          y: current.velocity.y * friction
            + (current.force.y / current.mass + gravity.y * gravityScale) * forceToVelocity,
        });
        bodyApi.setAngularVelocity(current,
          current.angularVelocity * friction + current.torque / current.inertia * forceToVelocity);
      }
      // Engine.update normally consumes these buffers even for sleeping and
      // static bodies. Initial force is consumed, not restored for a second hit.
      current.force.x = 0;
      current.force.y = 0;
      current.torque = 0;
      current.frictionAir = 0;
    }
    for (const character of characters) character.preparePhysicsStep(characterGravity.get(character)!);
    gravity.x = 0;
    gravity.y = 0;

    for (let segment = 0; segment < boundaries.length - 1; segment++) {
      const start = boundaries[segment]!;
      const end = boundaries[segment + 1]!;
      for (const plan of plans) {
        if (plan.character.getReferencePhysicsStep()?.token !== plan.token) continue;
        if (plan.nextTick < plan.ticks && start + BOUNDARY_EPSILON >= plan.nextTick / plan.ticks) {
          plan.character.preparePhysicsStep(0, true);
          plan.nextTick += 1;
        }
      }

      const transported: Character[] = [];
      try {
        for (const plan of plans) {
          if (plan.character.getReferencePhysicsStep()?.token !== plan.token) continue;
          plan.character.beginReferenceTransport(plan.ticks);
          transported.push(plan.character);
        }
        stepWorld(deltaMs * (end - start));
      } finally {
        // Every fighter must expose canonical speed before anyone reconciles
        // contacts or observers read another fighter's velocity.
        for (const character of transported) character.endReferenceTransport();
      }
      for (const character of characters) character.applyPhysicsSubstepConstraints();
      afterSubstep?.();
      queueNewForces();
    }
    for (const character of characters) {
      character.applyPostPhysicsVelocityConstraints(characterGravity.get(character)!);
    }
  } finally {
    queueNewForces();
    gravity.x = gravityBefore.x;
    gravity.y = gravityBefore.y;
    for (const state of settings) {
      state.body.frictionAir = state.frictionAir;
      state.body.force.x = state.queuedForceX;
      state.body.force.y = state.queuedForceY;
      state.body.torque = state.queuedTorque;
    }
  }
}
