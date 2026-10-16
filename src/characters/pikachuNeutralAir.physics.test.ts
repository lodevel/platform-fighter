import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { buildPikachuNeutralAirWithAuthoredHurtboxes, PIKACHU_NEUTRAL_AIR_AUTHORED_HURTBOX_POSES } from './pikachuNeutralAirHurtboxes';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { selectSimulationAttackFrame } from './simulationSpriteAnimation';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { pikachuNeutralAirEffectState } from '../fx/pikachuNeutralAirEffects';
import type { HitInfo } from './combat';

const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput={moveX:0,moveY:0,jump:false};

function fixture(saved:boolean,facing:1|-1,x:number) {
  const engine=Engine.create();engine.gravity.y=0;
  const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
  const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){
    const body=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,body);return body;
  }},world:{on(name:string,fn:any){Events.on(engine,names[name]??name,fn);},
    off(name:string,fn:any){Events.off(engine,names[name]??name,fn);},remove(body:any){Composite.remove(engine.world,body);}}}};
  const move=buildPikachuNeutralAirWithAuthoredHurtboxes();
  const options={spawnX:0,spawnY:0,width:40,height:50,fallAccel:0};
  const data=parseCharacterDataFile(JSON.parse(JSON.stringify({...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{nair:move}})));
  const ch=saved?createCharacterById(scene,data.id,options):new Character(scene,{id:'donkeykong',...options});
  if(saved)applyCharacterMoveOverrides(ch,data);else registerFighterAttack(ch,move);
  const target=Bodies.rectangle(x*facing,0,1,1,{isStatic:true,isSensor:true,label:CHARACTER_LABEL,
    plugin:{characterId:'target'},collisionFilter:{category:COLLISION_CATEGORIES.CHARACTER}});
  Composite.add(engine.world,target);const contacts:{elapsed:number|undefined,hit:HitInfo}[]=[];
  const handler=new HitboxDamageHandler((index,hit)=>{
    if(index!==1)return{confirmed:false};contacts.push({elapsed:ch.getActiveAttack()?.framesElapsed,hit});return{confirmed:true};
  });
  handler.registerPlayer(0,ch.body);handler.registerPlayer(1,target);
  handler.setGroundedLookup(()=>false);handler.setFacingLookup(index=>index===0?facing:1);
  handler.setHurtboxLookup(index=>index===0?ch.getActiveHurtboxes():[{id:'probe',offsetX:0,offsetY:0,width:1,height:1}]);
  for(const event of ['collisionStart','collisionActive'])Events.on(engine,event,(e:any)=>handler.handleCollisionStart(e));
  const step=(input=neutral)=>{
    ch.applyInput(input);const pos=ch.getPosition();Body.setPosition(target,{x:pos.x+x*facing,y:pos.y});
    stepCharacterPhysics({characters:[ch],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,
      deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt),afterSubstep:()=>handler.sampleHurtboxContacts(Composite.allBodies(engine.world))});
  };
  step();ch.setFacing(facing);step({...neutral,attackHeavy:true,attackStickX:0,attackStickY:0});
  const destroy=()=>{ch.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};
  return{ch,step,contacts,destroy};
}

/** Real stationary-relative Matter probes; not moving-opponent combo or native
 * autolink trajectory/hitstop qualification. Expected contacts come from UFD/native
 * intervals, independently of the generated pose count. */
describe('Pikachu neutral-air four body strikes and authored receiving timeline',()=>{
  for(const saved of [false,true])for(const facing of [1,-1] as const)for(const [x,expected] of [
    [5,[2,8,14,20]],[34,[20]],[37,[]],
  ] as const)it(`routes saved${saved}/facing${facing}/probe${x}`,()=>{
    const {ch,step,contacts,destroy}=fixture(saved,facing,x);
    for(let e=0;e<38;e++){
      const active=ch.getActiveAttack()!;expect(active.move.id).toBe('pikachu.neutral-air');expect(active.framesElapsed).toBe(e);
      const index=selectSimulationAttackFrame(active.move,e,22,'nair');
      const row=PIKACHU_NEUTRAL_AIR_AUTHORED_HURTBOX_POSES[index]!;
      expect(e).toBeGreaterThanOrEqual(row.startElapsed);expect(e).toBeLessThan(row.endElapsed);
      expect(ch.getActiveHurtboxes()).toEqual(row.hurtboxes);
      const inContact=(e>=2&&e<6)||(e>=8&&e<12)||(e>=14&&e<18)||(e>=20&&e<22);
      expect(!!active.hitboxBody).toBe(inContact);
      if(inContact){const hit=active.hitboxBody!.plugin.collisionHits[0];
        expect(hit.capsule).toEqual({start:{x:5,y:0},end:{x:5,y:0},radius:e<20?27.5:30});
        expect(hit.damage).toBe(e<20?1.7:3.5);
        expect(hit.knockback.reference).toEqual(e<20?{angle:367,base:15,growth:80,fixed:45,setWeight:true}:{angle:60,base:50,growth:140});
      }
      if(e===6){const boxes=ch.getActiveHurtboxes();ch.armAttackerHitlag(3);
        for(let i=0;i<3;i++){step();expect(ch.getActiveAttack()!.framesElapsed).toBe(6);expect(ch.getActiveAttack()!.hitboxBody).toBeNull();expect(ch.getActiveHurtboxes()).toEqual(boxes);expect(selectSimulationAttackFrame(ch.getActiveAttack()!.move,6,22,'nair')).toBe(index);}
      }
      step();
    }
    expect(ch.getActiveAttack()).toBeNull();expect(ch.getActiveHurtboxes()).toHaveLength(1);
    expect(contacts.map(c=>c.elapsed)).toEqual(expected);
    expect(contacts.map(c=>c.hit.damage)).toEqual(expected.map(e=>e<20?1.7:3.5));destroy();
  });
  it('keeps source electrical activation, inferred loop ordering and explicit authored fade separate',()=>{
    expect(pikachuNeutralAirEffectState(0).effects).toEqual([]);
    expect(pikachuNeutralAirEffectState(1).effects.map(e=>e.kind)).toEqual(['cheek']);
    for(const e of [2,7,12,17])expect(pikachuNeutralAirEffectState(e)).toMatchObject({burnAlpha:.7,effects:[{kind:'cheek'},{kind:'spark',anchor:{x:0,y:15}}]});
    for(const e of [4,9,14,19])expect(pikachuNeutralAirEffectState(e).burnAlpha).toBe(.35);
    expect(pikachuNeutralAirEffectState(20).effects.map(e=>e.kind)).toEqual(['cheek','spark']);
    expect(pikachuNeutralAirEffectState(22).effects.map(e=>e.kind)).toEqual(['cheek']);
    expect(pikachuNeutralAirEffectState(23).effects).toEqual([]);
    expect(pikachuNeutralAirEffectState(undefined)).toEqual({effects:[],burnAlpha:0});
    expect(()=>pikachuNeutralAirEffectState(1.5)).toThrow();
  });
});
