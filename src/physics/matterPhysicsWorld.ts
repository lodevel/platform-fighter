import Matter from './matter/matter';
import { GAME_CONFIG } from '../engine/constants';
import type { PhysicsEngineState, PhysicsEventName, PhysicsWorld } from './PhysicsWorld';

/**
 * The Phaser-free physics world (STEP5-DESIGN §3, sub-step 5.3): the same
 * Matter source, resolver globals, gravity object and event order as the
 * game's `scene.matter` today, so the simulation stays bit-identical.
 *
 * The only importer of the Matter fork; verified by the golden replays.
 */
const EVENT_NAMES: Readonly<Record<PhysicsEventName, string>> = {
  collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  beforeupdate: 'beforeUpdate', afterupdate: 'afterUpdate',
};

/** The resolver globals Phaser's MatterPhysics constructor writes (MatterPhysics.js:388-392). */
export const PHASER_RESOLVER_GLOBALS = Object.freeze({
  _restingThresh: 4, _restingThreshTangent: 6, _positionDampen: 0.9, _positionWarming: 0.8, _frictionNormalMultiplier: 5,
});

export function createMatterPhysicsWorld(): PhysicsWorld {
  Object.assign(Matter.Resolver, PHASER_RESOLVER_GLOBALS);
  // As Phaser's World: Engine.create(config) deep-merges { x: 0, y: gravity } over the default { scale: 0.001 }.
  const engine = Matter.Engine.create({ enableSleeping: false, gravity: { x: 0, y: GAME_CONFIG.gravity } });
  return {
    add: {
      rectangle(x, y, w, h, options) {
        const body = Matter.Bodies.rectangle(x, y, w, h, options);
        Matter.Composite.add(engine.world, body);
        return body;
      },
    },
    body: Matter.Body,
    world: {
      // Matter appends listeners, so registration order is call order, as with Phaser's proxy.
      on: (event, fn) => Matter.Events.on(engine, EVENT_NAMES[event], fn as (e: never) => void),
      off: (event, fn) => Matter.Events.off(engine, EVENT_NAMES[event], fn as (e: never) => void),
      remove: (body) => Matter.Composite.remove(engine.world, body),
      getAllBodies: () => Matter.Composite.allBodies(engine.world),
      step: (deltaMs) => Matter.Engine.update(engine, deltaMs),
      localWorld: engine.world as unknown as { readonly gravity: { x: number; y: number; scale: number } },
      engine: engine as unknown as PhysicsEngineState,
    },
  };
}

