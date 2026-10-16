import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { buildPikachuSmashWithAuthoredHurtboxes, type PikachuAuthoredSmash } from './pikachuSmashHurtboxes';
import { pikachuUpSmashPose } from './pikachuUpSmashPose';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { selectSimulationAttackFrame } from './simulationSpriteAnimation';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };


function fixture(action: PikachuAuthoredSmash, saved: boolean) {
  const move = buildPikachuSmashWithAuthoredHurtboxes(action);
  const slot = action === 'forward-smash' ? 'smash' : action === 'up-smash' ? 'upSmash' : 'downSmash';
  const engine = Engine.create(); engine.gravity.y = 1;
  const names: Record<string,string> = { collisionstart:'collisionStart', collisionactive:'collisionActive', collisionend:'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x:number,y:number,w:number,h:number,options:object) {
    const body=Bodies.rectangle(x,y,w,h,options); Composite.add(engine.world,body); return body;
  } }, world: { remove(body:any) { Composite.remove(engine.world,body); },
    on(name:string,fn:any) { Events.on(engine,names[name]??name,fn); },
    off(name:string,fn:any) { Events.off(engine,names[name]??name,fn); } } } };
  const options={spawnX:0,spawnY:0,width:40,height:50};
  let actor: Character;
  if(saved) {
    const data=parseCharacterDataFile(JSON.parse(JSON.stringify({
      ...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{[slot]:move},
    })));
    const reloaded=parseCharacterDataFile(serializeCharacterDataSpec(data));
    actor=createCharacterById(scene,reloaded.id,options); applyCharacterMoveOverrides(actor,reloaded);
  } else {
    actor=new Character(scene,{id:'donkeykong',...options}); registerFighterAttack(actor,move); if (slot === 'smash') actor.setHeavyAttack(move.id);
    else if (slot === 'upSmash') actor.setUpSmash(move.id);
    else actor.setDownSmash(move.id);
  }
  Composite.add(engine.world,Bodies.rectangle(0,35,2000,20,{isStatic:true,label:PLATFORM_LABELS.solid,
    collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
  const step=(input:CharacterInput=neutral)=>{actor.applyInput(input); stepCharacterPhysics({characters:[actor],
    bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,
    stepWorld:dt=>Engine.update(engine,dt)});};
  for(let i=0;i<12;i++)step();
  return {actor,step,move,close(){actor.destroy();Engine.clear(engine);Composite.clear(engine.world,false);}};
}


// These tests verify the existing isolated shared charge consumer, not the
// unresolved native keep120/status hold-frame conversion.
function expectedDamages(action: PikachuAuthoredSmash, elapsed: number): number[] {
  if (action === 'forward-smash') {
    if (elapsed < 14 || elapsed >= 29) return [];
    return [elapsed < 16 ? 15 : elapsed < 19 ? 18 : 12];
  }
  if (action === 'up-smash') {
    if (elapsed < 9 || elapsed >= 17) return [];
    return elapsed < 12 ? [14,13,13] : Array(3).fill(elapsed < 14 ? 11 : 7);
  }
  if (elapsed === 22) return [3];
  return [7,8,10,11,13,14,16,17,19,20].includes(elapsed) ? [2,2,2] : [];
}

describe('Pikachu sourced smash candidates through shared input and save/load', () => {
  it('refuses copied, fractional, wrong-phase and absent tail anchors', () => {
    const first = PIKACHU_NATIVE_ATTACKS['pikachu/AttackHi4'][0]!;
    for (const elapsed of [9,18,10.5,NaN]) expect(() => pikachuUpSmashPose(first, elapsed)).toThrow();
    expect(() => pikachuUpSmashPose({...first},10)).toThrow('Unsupported');
  });
  for (const action of ['forward-smash','up-smash','down-smash'] as const)
    for (const saved of [false,true]) for (const facing of [1,-1] as const) {
      it(`${action} retains regional power, gaps, drawings and receiving freeze after30held steps / saved${saved} / facing${facing}`, () => {
        const f = fixture(action,saved), {actor,step,move} = f;
        try {
          actor.setFacing(facing);
          const held = {...neutral, attackHeavy:true, moveY: action === 'up-smash' ? -1 : action === 'down-smash' ? 1 : 0};
          step(held);
          expect(actor.getActiveAttack()).toBeNull();
          expect(actor.getAnimationActionState().chargeStartupElapsed).toBe(0);
          expect(actor.getActiveHurtboxes()).toHaveLength(12);
          for(let i=0;i<move.chargeStartFrame!;i++) {
            step(held);
            expect(actor.getAnimationActionState().chargeStartupElapsed).toBe(i+1);
            expect(actor.getActiveHurtboxes()).toHaveLength(12);
          }
          for(let i=0;i<30;i++) {
            step(held); expect(actor.getActiveAttack()).toBeNull();
            expect(actor.getAnimationActionState().chargeStartupElapsed).toBe(move.chargeStartFrame);
          }
          expect(actor.getChargeProgress()).toBeCloseTo(.5);
          const heldHurtboxes = actor.getActiveHurtboxes();
          actor.armAttackerHitlag(3);
          for (let i=0;i<3;i++) {
            step(held);
            expect(actor.getAnimationActionState()).toMatchObject({
              chargeStartupElapsed: move.chargeStartFrame, chargeHeldFrames: 30,
            });
            expect(actor.getActiveAttack()).toBeNull();
            expect(actor.getActiveHurtboxes()).toEqual(heldHurtboxes);
          }
          step();
          expect(actor.getAnimationActionState().chargeStartupElapsed).toBeUndefined();
          expect(actor.getActiveAttack()?.move.id).toBe(move.id);
          expect(actor.getActiveAttack()?.framesElapsed).toBe(move.chargeStartFrame);
          const total = move.startupFrames + move.activeFrames + move.recoveryFrames;
          for(let elapsed=move.chargeStartFrame!;elapsed<total;elapsed++) {
            const active = actor.getActiveAttack()!; expect(active.framesElapsed).toBe(elapsed);
            const hits = active.hitboxBody?.plugin.collisionHits ?? [];
            const expected = expectedDamages(action, elapsed);
            expect(hits).toHaveLength(expected.length);
            hits.forEach((hit:any, i:number) => expect(hit.damage).toBeCloseTo(expected[i]! * 1.2));
            expect(actor.getActiveHurtboxes()).toHaveLength(12);
            const drawing = selectSimulationAttackFrame(active.move,elapsed,action === 'forward-smash' ? 13 : action === 'up-smash' ? 18 : 26,'smash');
            if (elapsed === move.startupFrames || elapsed === total-2) {
              const capsules = actor.getActiveHurtboxes(), contacts=JSON.stringify(hits);
              actor.armAttackerHitlag(3);
              for(let i=0;i<3;i++) { step(); expect(actor.getActiveAttack()!.framesElapsed).toBe(elapsed);
                expect(actor.getActiveHurtboxes()).toEqual(capsules);
                expect(JSON.stringify(actor.getActiveAttack()!.hitboxBody?.plugin.collisionHits ?? [])).toBe(contacts);
                expect(selectSimulationAttackFrame(active.move,elapsed,action === 'forward-smash' ? 13 : action === 'up-smash' ? 18 : 26,'smash')).toBe(drawing); }
            }
            step();
          }
          expect(actor.getActiveAttack()).toBeNull(); expect(actor.getActiveHurtboxes()).toHaveLength(1);
        } finally { f.close(); }
      });
    }
});
