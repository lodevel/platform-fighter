import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { buildPikachuBackAirWithAuthoredHurtboxes, PIKACHU_BACK_AIR_AUTHORED_HURTBOX_POSES } from './pikachuBackAirHurtboxes';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { selectSimulationAttackFrame } from './simulationSpriteAnimation';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import type { HitInfo } from './combat';
import { pikachuBackAirPose } from './pikachuBackAirPose';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { validateAerialMove } from './aerialSchema';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields } from '../characterBuilder/characterEditorFields';

const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput={moveX:0,moveY:0,jump:false};

function fixture(saved:boolean,facing:1|-1,x:number,y:number) {
  const engine=Engine.create();engine.gravity.y=0;
  const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
  const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){
    const body=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,body);return body;
  }},world:{on(name:string,fn:any){Events.on(engine,names[name]??name,fn);},
    off(name:string,fn:any){Events.off(engine,names[name]??name,fn);},remove(body:any){Composite.remove(engine.world,body);}}}};
  const move=buildPikachuBackAirWithAuthoredHurtboxes();
  const options={spawnX:0,spawnY:0,width:40,height:50,fallAccel:0};
  const data=parseCharacterDataFile(JSON.parse(JSON.stringify({...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{bair:move}})));
  const ch=saved?createCharacterById(scene,data.id,options):new Character(scene,{id:'donkeykong',...options});
  if(saved)applyCharacterMoveOverrides(ch,data);else registerFighterAttack(ch,move);
  const target=Bodies.rectangle(x*facing,y,1,1,{isStatic:true,isSensor:true,label:CHARACTER_LABEL,
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
    ch.applyInput(input);const pos=ch.getPosition();Body.setPosition(target,{x:pos.x+x*facing,y:pos.y+y});
    stepCharacterPhysics({characters:[ch],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,
      deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt),afterSubstep:()=>handler.sampleHurtboxContacts(Composite.allBodies(engine.world))});
  };
  step();ch.setFacing(facing);step({...neutral,attackHeavy:true,attackStickX:-facing,attackStickY:0});
  const destroy=()=>{ch.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};
  return{ch,step,contacts,destroy};
}

/** Real stationary-relative Matter probes; not moving-opponent combo or native
 * autolink trajectory/hitstop qualification. Expected contacts come from UFD/native
 * intervals, independently of the generated pose count. */
describe('Pikachu back-air six rolling strikes and authored receiving timeline',()=>{
  for(const saved of [false,true])for(const facing of [1,-1] as const)for(const [x,y,expected] of [
    [-35,7.5,[3,7,11,15,19,23]],[-75.9,7.5,[8,11,15,19]],[34.75,-10,[24]],[-79,7.5,[]],
  ] as const)it(`routes saved${saved}/facing${facing}/probe${x},${y}`,()=>{
    const {ch,step,contacts,destroy}=fixture(saved,facing,x,y);
    const rows=PIKACHU_BACK_AIR_AUTHORED_HURTBOX_POSES.filter(row=>row.action==='back-air');
    for(let e=0;e<43;e++){
      const active=ch.getActiveAttack()!;expect(active.move.id).toBe('pikachu.back-air');expect(active.framesElapsed).toBe(e);
      expect(ch.getFacing()).toBe(facing);expect(active.facing).toBe(facing);
      const index=selectSimulationAttackFrame(active.move,e,24,'bair');const row=rows[index]!;
      expect(e).toBeGreaterThanOrEqual(row.startElapsed);expect(e).toBeLessThan(row.endElapsed);
      expect(ch.getActiveHurtboxes()).toEqual(row.hurtboxes);
      const inContact=[3,4,7,8,11,12,15,16,19,20,23,24].includes(e);
      expect(!!active.hitboxBody).toBe(inContact);
      if(inContact){const hits=active.hitboxBody!.plugin.collisionHits;
        expect(hits).toHaveLength(e<23?2:1);
        for(const hit of hits){
          expect(hit.capsule.radius).toBe(e<23?21:25);expect(hit.damage).toBe(e<23?1:3.5);
          expect(hit.knockback.reference).toEqual(e<23?{angle:367,base:0,growth:100,fixed:40}:{angle:45,base:40,growth:160});
          expect(hit.launchDirection).toBe(e<23?'position':'back');expect(hit.hitlagMultiplier).toBe(e<23?1:2);
        }
      }
      if(e===5){const boxes=ch.getActiveHurtboxes();ch.armAttackerHitlag(3);
        for(let i=0;i<3;i++){step();expect(ch.getActiveAttack()!.framesElapsed).toBe(5);expect(ch.getActiveAttack()!.hitboxBody).toBeNull();expect(ch.getActiveHurtboxes()).toEqual(boxes);expect(selectSimulationAttackFrame(ch.getActiveAttack()!.move,5,24,'bair')).toBe(index);}
      }
      step();
    }
    expect(ch.getActiveAttack()).toBeNull();expect(ch.getActiveHurtboxes()).toHaveLength(1);
    expect(contacts.map(c=>c.elapsed)).toEqual(expected);
    expect(contacts.map(c=>c.hit.damage)).toEqual(expected.map(e=>e<23?1:3.5));destroy();
  });
  it('preserves the projected fighter basis through JSON and rejects invalid basis or anchors',()=>{
    const move=buildPikachuBackAirWithAuthoredHurtboxes();
    const base={...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{bair:move}};
    expect(parseCharacterDataFile(JSON.parse(JSON.stringify(base))).moves!.bair!.geometryFacing).toBe('fighter');
    expect(()=>parseCharacterDataFile({...base,moves:{bair:{...move,geometryFacing:'sideways'}}})).toThrow('geometryFacing');
    expect(()=>validateAerialMove({...move,geometryFacing:'sideways' as any})).toThrow('geometryFacing');
    const row=PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirB'][0]!;
    for(const game of [3,6,26,4.5,NaN])expect(()=>pikachuBackAirPose(row,game)).toThrow();
    expect(()=>pikachuBackAirPose({...row},4)).toThrow('Unsupported');
    expect(()=>pikachuBackAirPose(PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirHi'][0]!,4)).toThrow('Unsupported');
  });
  it('retains the fighter basis and drawing/capsule transport after a real Lab regional damage edit',()=>{
    const move=buildPikachuBackAirWithAuthoredHurtboxes();
    const base={...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{bair:move}};
    const edit=new CharacterEditState(parseCharacterDataFile(base));
    const path=['hitWindows','0','collisionHits','0','damage'];
    expect(buildCharacterEditorFields(edit.getSpec(),'move','bair').find(field=>field.id===path.join('.'))?.value).toBe(1);
    edit.setMoveNumericField('bair',path,1.25);
    const loaded=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(edit.getSpec())))).moves!.bair!;
    expect(loaded.geometryFacing).toBe('fighter');expect(loaded.hitWindows![0]!.collisionHits![0]!.damage).toBe(1.25);
    expect(loaded.animation).toEqual(move.animation);expect(loaded.hurtboxModifiers).toEqual(move.hurtboxModifiers);
  });
});
