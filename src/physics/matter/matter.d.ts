// Types for matter.js, the vendored Matter 0.20.0 fork (Phaser 3.90.0, MIT):
// only the surface createMatterPhysicsWorld uses. The global `MatterJS` body
// types are vendored alongside this declaration in types.d.ts.
declare const Matter: {
  Engine: { create(options?: object): MatterJS.Engine & { gravity: { x: number; y: number; scale: number }; world: MatterJS.World }; update(engine: MatterJS.Engine, delta: number): void };
  Composite: { add(composite: MatterJS.World, body: MatterJS.BodyType): void; remove(composite: MatterJS.World, body: MatterJS.BodyType): void; allBodies(composite: MatterJS.World): MatterJS.BodyType[] };
  Bodies: { rectangle(x: number, y: number, w: number, h: number, options?: MatterJS.IChamferableBodyDefinition): MatterJS.BodyType };
  Body: {
    setVelocity(body: MatterJS.BodyType, v: { x: number; y: number }): void; setPosition(body: MatterJS.BodyType, p: { x: number; y: number }): void;
    setInertia(body: MatterJS.BodyType, inertia: number): void; setAngularVelocity(body: MatterJS.BodyType, velocity: number): void;
    scale(body: MatterJS.BodyType, sx: number, sy: number): void;
    getVelocity(body: MatterJS.BodyType): { x: number; y: number };
  };
  Events: { on(target: object, name: string, fn: (event: never) => void): void; off(target: object, name: string, fn: (event: never) => void): void };
  Resolver: Record<'_restingThresh' | '_restingThreshTangent' | '_positionDampen' | '_positionWarming' | '_frictionNormalMultiplier', number>;
};
export default Matter;
