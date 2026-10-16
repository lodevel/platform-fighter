import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { buildPikachuUpAirWithAuthoredHurtboxes } from './pikachuUpAirHurtboxes';
import { buildPikachuVerticalTiltWithAuthoredHurtboxes } from './pikachuVerticalTiltHurtboxes';
import { selectSimulationAttackFrame } from './simulationSpriteAnimation';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields } from '../characterBuilder/characterEditorFields';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import type { AttackMoveWithAnimation } from './moveSchema';

const move = buildPikachuUpAirWithAuthoredHurtboxes();
const saved = () => ({ ...serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu')), moves: { uair: move } });
const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

function physicsFixture() {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); }, remove(body: any) { Composite.remove(engine.world, body); } } } };
  return { engine, scene };
}

describe('explicit attack drawing windows', () => {
  it.each(['up-tilt', 'down-tilt'] as const)('keeps saved %s drawings on the reviewed sparse receiving clock', action => {
    const tilt = buildPikachuVerticalTiltWithAuthoredHurtboxes(action);
    const slot = action === 'up-tilt' ? 'upLight' : 'downLight';
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify({
      ...serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu')), moves: { [slot]: tilt },
    })));
    const reloaded = parseCharacterDataFile(serializeCharacterDataSpec(loaded));
    const expected = action === 'up-tilt'
      ? [0,0,0,1,1,1,2,3,4,5,6,7,8,9,9,9,9,9,10,10,10,10,11,11,11,11]
      : [0,0,0,1,1,1,2,3,4,4,4,4,5,5,5,5,5,5];
    const count = action === 'up-tilt' ? 12 : 6;
    const savedTilt = reloaded.moves![slot]!;
    expect(expected.map((_, elapsed) => selectSimulationAttackFrame(savedTilt, elapsed, count)))
      .toEqual(expected);
    expect(savedTilt.hurtboxModifiers).toEqual(tilt.hurtboxModifiers);
    const edit = new CharacterEditState(reloaded);
    edit.setMoveNumericField(slot, ['animation', 'frameWindows', '2', 'artFrameIndex'], 3);
    const edited = parseCharacterDataFile(serializeCharacterDataSpec(edit.getSpec())).moves![slot]!;
    expect(selectSimulationAttackFrame(edited, 6, count)).toBe(3);
  });

  it('preserves the sparse source holds instead of interpolating seven active windows', () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 16, 17, 21, 22, 25, 26];
    expect(steps.map(e => selectSimulationAttackFrame(move, e, 11, 'uair')))
      .toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 8, 8, 9, 9, 10, 10, 10]);
  });

  it('round-trips the complete drawing/hurtbox clock through real save parsing', () => {
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(saved())));
    const reloaded = parseCharacterDataFile(serializeCharacterDataSpec(loaded));
    expect(reloaded.moves!.uair!.animation).toEqual(move.animation);
    expect(reloaded.moves!.uair!.hurtboxModifiers).toEqual(move.hurtboxModifiers);
  });

  it('exposes art indices to Lab editing and preserves the edited index on reload', () => {
    const edit = new CharacterEditState(parseCharacterDataFile(saved()));
    const fields = buildCharacterEditorFields(edit.getSpec(), 'move', 'uair');
    expect(fields.find(field => field.id === 'animation.frameWindows.2.artFrameIndex')?.value).toBe(2);
    edit.setMoveNumericField('uair', ['animation', 'frameWindows', '2', 'artFrameIndex'], 3);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(edit.getSpec()))));
    expect(loaded.moves!.uair!.animation!.frameWindows![2]!.artFrameIndex).toBe(3);
  });

  it('rejects incomplete, overlapping, empty, fractional and out-of-strip timelines', () => {
    const original = move.animation!.frameWindows!;
    const bad = [[], null, original.slice(1), original.slice(0, -1),
      [{ ...original[0], endFrame: 0 }, ...original.slice(1)],
      [{ ...original[0], endFrame: 3 }, ...original.slice(1)],
      [{ ...original[0], artFrameIndex: 11 }, ...original.slice(1)],
      [{ ...original[0], artFrameIndex: .5 }, ...original.slice(1)],
      [...original.slice(0, -1), { ...original.at(-1), endFrame: 27 }]];
    for (const frameWindows of bad) expect(() => parseCharacterDataFile({ ...saved(), moves: {
      uair: { ...move, animation: { ...move.animation, frameWindows } },
    } })).toThrow('frameWindows');
    for (const e of [-1, .5, NaN]) expect(() => selectSimulationAttackFrame(move, e, 11)).toThrow();
    expect(() => selectSimulationAttackFrame(move, 3, 10)).toThrow('matching loaded strip');
  });

  it.each([1, -1] as const)('keeps the saved factory drawing/contact clock frozen across early/late replacement facing%s', facing => {
    const {engine,scene}=physicsFixture();
    const data = parseCharacterDataFile(JSON.parse(JSON.stringify(saved())));
    const actor = createCharacterById(scene, data.id, { spawnX: 0, spawnY: 0, width: 40, height: 50 });
    applyCharacterMoveOverrides(actor, data); actor.setFacing(facing);
    const step = () => { actor.applyInput({ moveX: 0, moveY: 0, jump: false });
      stepCharacterPhysics({ characters: [actor], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
        body: Body, deltaMs: 1000 / 60, stepWorld: dt => Engine.update(engine, dt) }); };
    step(); actor.applyInput({ moveX: 0, moveY: 0, jump: false, attackHeavy: true, attackStickY: -1 });
    expect(actor.getActiveAttack()?.move.id).toBe('pikachu.up-air');
    while (actor.getActiveAttack()!.framesElapsed < 5) step();
    const before = actor.getActiveAttack()!;
    expect(selectSimulationAttackFrame(before.move, before.framesElapsed, 11)).toBe(4);
    expect(before.hitboxBody!.plugin.collisionHits.map((h: any) => h.damage)).toEqual([6, 6, 5]);
    const boxes = actor.getActiveHurtboxes(); actor.armAttackerHitlag(3);
    for (let i = 0; i < 3; i++) { step(); const frozen = actor.getActiveAttack()!;
      expect(frozen.framesElapsed).toBe(5); expect(selectSimulationAttackFrame(frozen.move, frozen.framesElapsed, 11)).toBe(4);
      expect(actor.getActiveHurtboxes()).toEqual(boxes); }
    step(); const resumed = actor.getActiveAttack()!;
    expect(resumed.framesElapsed).toBe(6); expect(selectSimulationAttackFrame(resumed.move, resumed.framesElapsed, 11)).toBe(5);
    expect(resumed.hitboxBody!.plugin.collisionHits.map((h: any) => h.damage)).toEqual([4, 4, 4]);
    actor.destroy(); Engine.clear(engine); Composite.clear(engine.world, false);
  });
  it.each([
    ['fair', 'forward', 1, 0], ['bair', 'back', -1, 0], ['nair', 'neutral', 0, 0],
    ['uair', 'up', 0, -1], ['dair', 'down', 0, 1],
  ] as const)('dispatches a new-ID saved %s via normal directional input', (slot,direction,stickX,stickY) => {
    // Synthetic ID/direction isolates transport from source-kit behavior.
    for(const facing of [1,-1] as const) {
      const {engine,scene}=physicsFixture();
      const replacement={...move,id:`saved-test.${slot}`,aerialDirection:direction};
      const data=parseCharacterDataFile(JSON.parse(JSON.stringify({...saved(),moves:{[slot]:replacement}})));
      const actor=createCharacterById(scene,data.id,{spawnX:0,spawnY:0,width:40,height:50});
      applyCharacterMoveOverrides(actor,data);actor.setFacing(facing);
      const step=(input:any)=>{actor.applyInput(input);stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});};
      step({moveX:0,moveY:0,jump:false});
      step({moveX:0,moveY:0,jump:false,attackHeavy:true,attackStickX:stickX*facing,attackStickY:stickY});
      expect(actor.getActiveAttack()?.move.id).toBe(replacement.id);
      expect((actor.getActiveAttack()?.move as AttackMoveWithAnimation).animation).toEqual(move.animation);
      actor.destroy();Engine.clear(engine);Composite.clear(engine.world,false);
    }
  });

});
