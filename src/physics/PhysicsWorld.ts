/// <reference path="./matter/types.d.ts" />
/**
 * The physics surface the simulation uses: exactly the subset of Phaser's
 * `MatterPhysics` (`scene.matter`) that Character, attacks, stage bodies and
 * hazards call (STEP5-DESIGN §3). `createMatterPhysicsWorld` is the one
 * implementation; a Phaser scene's `scene.matter` still satisfies it
 * structurally (previews, the stage builder).
 */
export type Body = MatterJS.BodyType;
export interface Vec2 { x: number; y: number }
export type PhysicsEventName = 'collisionstart' | 'collisionactive' | 'collisionend' | 'beforeupdate' | 'afterupdate';
/** A contact pair as the collision events deliver it (Phaser's `IPair` types its bodies as the `Body` module). */
export type CollisionPair = Omit<MatterJS.IPair, 'bodyA' | 'bodyB'> & { readonly bodyA: Body; readonly bodyB: Body };
export interface CollisionEvent { readonly pairs: ReadonlyArray<CollisionPair> }
/** Body options; Matter also copies `plugin` (the hitbox / platform payload), which Phaser's typings omit. */
export type BodyOptions = MatterJS.IChamferableBodyDefinition & { readonly plugin?: object };

export interface PhysicsWorld {
  readonly add: {
    rectangle(x: number, y: number, w: number, h: number, options: BodyOptions): Body;
  };
  /** The Matter `Body` module. */
  readonly body: {
    setVelocity(body: Body, v: Vec2): void;
    setPosition(body: Body, p: Vec2): void;
    setInertia(body: Body, inertia: number): void;
    setAngularVelocity(body: Body, velocity: number): void;
    scale(body: Body, sx: number, sy: number): void;
    getVelocity(body: Body): Vec2;
  };
  readonly world: {
    on(event: PhysicsEventName, fn: (event: CollisionEvent) => void): void;
    off(event: PhysicsEventName, fn: (event: CollisionEvent) => void): void;
    remove(body: Body): void;
    getAllBodies(): Body[];
    step(deltaMs: number): void;
    /** The engine's own gravity object: stepCharacterPhysics mutates it in place (F3). */
    readonly localWorld: { readonly gravity: { x: number; y: number; scale: number } };
    /**
     * The Matter engine, as Phaser's `world.engine`: MatchScene's history
     * evidence reads the live contact pairs, and a match starts at timestamp 0.
     */
    readonly engine: PhysicsEngineState;
  };
}

/** The parts of the Matter engine read outside the step. */
export interface PhysicsEngineState {
  readonly pairs: { readonly list: ReadonlyArray<MatterJS.IPair> };
  readonly timing: { timestamp: number };
}

/** What Character, attacks, stage bodies and hazards receive instead of a Phaser scene. */
export interface PhysicsHost { readonly matter: PhysicsWorld }
