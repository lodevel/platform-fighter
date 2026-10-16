import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { buildPikachuDashAttackWithAuthoredHurtboxes } from './pikachuDashAttackHurtboxes';
import { pikachuDashAttackPose } from './pikachuDashAttackPose';
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
const move = buildPikachuDashAttackWithAuthoredHurtboxes();

function fixture(saved: boolean) {
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
      ...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{dashAttack:move},
    })));
    const reloaded=parseCharacterDataFile(serializeCharacterDataSpec(data));
    actor=createCharacterById(scene,reloaded.id,options); applyCharacterMoveOverrides(actor,reloaded);
  } else {
    actor=new Character(scene,{id:'donkeykong',...options}); registerFighterAttack(actor,move); actor.setDashAttack(move.id);
  }
  Composite.add(engine.world,Bodies.rectangle(0,35,2000,20,{isStatic:true,label:PLATFORM_LABELS.solid,
    collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
  const step=(input:CharacterInput=neutral)=>{actor.applyInput(input); stepCharacterPhysics({characters:[actor],
    bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,
    stepWorld:dt=>Engine.update(engine,dt)});};
  for(let i=0;i<12;i++)step();
  return {actor,step,close(){actor.destroy();Engine.clear(engine);Composite.clear(engine.world,false);}};
}

describe('Pikachu fixed-root dash candidate in shared running fixture',()=>{
  it('rejects unreviewed, copied and wrong-phase native anchors',()=>{
    const [early,late]=PIKACHU_NATIVE_ATTACKS['pikachu/AttackDash'];
    for(const frame of [5,9,13,6.5,NaN])expect(()=>pikachuDashAttackPose(early!,frame)).toThrow();
    expect(()=>pikachuDashAttackPose(late!,8)).toThrow();
    expect(()=>pikachuDashAttackPose({...early!},6)).toThrow('Unsupported');
  });
  for(const saved of [false,true])for(const facing of [1,-1] as const) {
    it(`routes running light input and retains clocks across early/late freeze saved${saved}/facing${facing}`,()=>{
      const f=fixture(saved),{actor,step}=f;
      try {
        actor.setFacing(facing);step({...neutral,moveX:facing});
        Body.setVelocity(actor.body,{x:actor.getTuning().maxRunSpeed*facing,y:0});
        step({...neutral,moveX:facing,attack:true});
        expect(actor.getActiveAttack()?.move.id).toBe('pikachu.dash-attack');
        const drawings:number[]=[],contacts:number[][]=[];
        for(let elapsed=0;elapsed<35;elapsed++) {
          const active=actor.getActiveAttack()!;expect(active.framesElapsed).toBe(elapsed);
          drawings.push(selectSimulationAttackFrame(active.move,elapsed,13,'dash_attack'));
          const hits=active.hitboxBody?.plugin.collisionHits??[];
          contacts.push(hits.map((hit:any)=>hit.damage));
          expect(actor.getActiveHurtboxes()).toHaveLength(12);
          if(elapsed===7||elapsed===8) {
            expect(hits[0].capsule.radius).toBe(elapsed===7?25:20);
            expect(hits[0].knockback.reference).toMatchObject(elapsed===7?{angle:60,base:70,growth:88}:{angle:70,base:100,growth:50});
            const boxes=actor.getActiveHurtboxes(),source=JSON.stringify(hits);
            actor.armAttackerHitlag(3);
            for(let i=0;i<3;i++){step();expect(actor.getActiveAttack()!.framesElapsed).toBe(elapsed);
              expect(JSON.stringify(actor.getActiveAttack()!.hitboxBody!.plugin.collisionHits)).toBe(source);
              expect(actor.getActiveHurtboxes()).toEqual(boxes);}
          }
          step();
        }
        expect(drawings).toEqual([0,0,0,1,1,2,3,4,5,6,7,8,9,9,9,9,9,9,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,12]);
        expect(contacts.slice(0,5).every(h=>h.length===0)).toBe(true);
        expect(contacts.slice(5,8)).toEqual([[11],[11],[11]]);
        expect(contacts.slice(8,12)).toEqual([[6],[6],[6],[6]]);
        expect(contacts.slice(12).every(h=>h.length===0)).toBe(true);
        expect(actor.getActiveAttack()).toBeNull();expect(actor.getActiveHurtboxes()).toHaveLength(1);
      } finally {f.close();}
    });
  }
});
