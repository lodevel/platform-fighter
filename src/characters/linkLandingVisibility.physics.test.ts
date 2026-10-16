import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createCharacterById, applyCharacterMoveOverrides } from './characterFactory';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { captureSimulationAnimation, resolveSimulationAction } from './simulationSpriteAnimation';
import { createArtFrameSelector, MANIFEST_ART_CATALOG } from './artFrameSelector';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

function fixture() {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const b = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, b); return b;
  } }, world: { on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); }, remove(b: any) { Composite.remove(engine.world, b); } } } };
  const actor = createCharacterById(scene, 'link', { spawnX: 0, spawnY: 0 });
  let frame = 0;
  const step = () => { actor.applyInput({ moveX: 0, moveY: 0, jump: false }, frame++); Engine.update(engine, 1000 / 60); actor.applyPostPhysicsVelocityConstraints(); };
  return { actor, engine, step, snapshot: () => captureSimulationAnimation(actor, frame, false) };
}

describe('Link saved aerial landing visibility', () => {
  for (const facing of [1, -1] as const) it.each([
    ['nair', 'landing_air_n', 6], ['fair', 'landing_air_f', 11], ['bair', 'landing_air_b', 6],
    ['uair', 'landing_air_hi', 14], ['dair', 'landing_air_lw', 19],
  ] as const)('retains %s source drawing throughout real landing lag, facing ' + facing, (slot, sheet, lag) => {
    const f = fixture(), original = getAuthorableCharacterSpec('link'), move = original.moves![slot]!;
    const saved = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec({ ...original,
      moves: { [slot]: { ...move, id: `saved.${slot}` } } }))));
    applyCharacterMoveOverrides(f.actor, saved); f.actor.setFacing(facing);
    expect(f.actor.attemptAttack(`saved.${slot}`)).toBe(true);
    for (let n = 0; n < 13; n++) f.step();
    const position = f.actor.getPosition();
    Composite.add(f.engine.world, Bodies.rectangle(position.x, position.y + f.actor.getTuning().height / 2 + 10,
      2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
        collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    Body.setVelocity(f.actor.body, { x: 0, y: 3 }); f.step(); f.step();
    const selector = createArtFrameSelector(MANIFEST_ART_CATALOG);
    let samples = 0;
    while (f.actor.getLandingPresentationState()?.kind === 'aerial') {
      const snapshot = f.snapshot();
      expect(snapshot.landingPresentation).toMatchObject({ moveId: `saved.${slot}`, sourcePoseId: `link.${slot}` });
      expect(resolveSimulationAction(snapshot)).toMatchObject({ sheets: [sheet] });
      expect(selector.select(snapshot)?.key).toBe(`link.${sheet}.anim`);
      samples++; expect(samples).toBeLessThanOrEqual(lag); f.step();
    }
    expect(samples).toBe(lag);
    expect(selector.select(f.snapshot())).not.toBeNull();
    f.actor.destroy(); Engine.clear(f.engine);
  });
});

describe('Link accepted footstool presentation', () => {
  it.each([1, -1] as const)('renders the owned front/back/air/performer routes, facing %s', facing => {
    for (const kind of ['front', 'back', 'air', 'performer'] as const) {
      const f = fixture(), contact = { jumperIndex: 1, jumperGeneration: 0, recipientIndex: 0, recipientGeneration: 0 };
      f.actor.setFacing(facing);
      if (kind === 'front' || kind === 'back') {
        Composite.add(f.engine.world, Bodies.rectangle(0, f.actor.getTuning().height / 2 + 10, 2000, 20,
          { isStatic: true, label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
        Body.setVelocity(f.actor.body, { x: 0, y: 3 });
        for (let n = 0; n < 10; n++) f.step();
        expect(f.actor.isGrounded()).toBe(true);
      }
      // Accepted-contact fixtures isolate presentation ownership here; the
      // browser regression obtains these entries from the actual jump resolver.
      if (kind === 'performer') { f.actor.queueFootstoolJump(false, contact); f.step(); }
      else f.actor.applyFootstoolRecipient(kind !== 'air', f.snapshot().frame,
        f.actor.getPosition().x + (kind === 'back' ? -1 : 1) * facing, contact);
      const selector = createArtFrameSelector(MANIFEST_ART_CATALOG), sheets = new Set<string>();
      for (let n = 0; n < (kind === 'air' ? 30 : 9); n++) {
        const snapshot = f.snapshot(), route = f.actor.getSourceLinkFootstoolPresentationRoute();
        expect(route).not.toBeNull();
        expect(snapshot.packedBody.footstool).toMatchObject({ sheet: route!.motion, age: route!.rawAge, facing });
        const art = selector.select(snapshot); expect(art).not.toBeNull();
        sheets.add(art!.key); f.step();
      }
      expect([...sheets]).toEqual(kind === 'air' ? ['link.a06stepairpose.anim', 'link.a06stepfall.anim']
        : [`link.${kind === 'front' ? 'a06steppose' : kind === 'back' ? 'a06stepback' : 'a06stepjump'}.anim`]);
      f.actor.destroy(); Engine.clear(f.engine);
    }
  });
});
