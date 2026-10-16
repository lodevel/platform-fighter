import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {DonkeyKong,DONKEYKONG_JAB} from './DonkeyKong';
import type {CharacterInput} from './Character';
import type {AttackMoveWithAnimation} from './moveSchema';
import {spawnHitbox} from './attacks';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {HitboxDamageHandler} from '../match/HitboxDamageHandler';
import {GAME_CONFIG} from '../engine/constants';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
const require=createRequire(import.meta.url),Engine=require('../physics/matter/source/lib/core/Engine.js'),Events=require('../physics/matter/source/lib/core/Events.js'),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js'),Composite=require('../physics/matter/source/lib/body/Composite.js');
const opt={...DONKEYKONG_JAB,jabChain:{nextId:'donkeykong.jab2',advanceWindowStart:7,continuationWindowEndFrame:28}};
function fixture(move:AttackMoveWithAnimation=opt,facing:1|-1=1){
 const engine=Engine.create();engine.gravity.y=GAME_CONFIG.gravity;
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,o:object){const b=Bodies.rectangle(x,y,w,h,o);Composite.add(engine.world,b);return b;}},world:{on(n:string,f:any){Events.on(engine,names[n]??n,f);},off(n:string,f:any){Events.off(engine,names[n]??n,f);},remove(b:any){Composite.remove(engine.world,b);}}}};
 const dk=new DonkeyKong(scene,{spawnX:0,spawnY:0}),victim=new DonkeyKong(scene,{spawnX:1000,spawnY:0});dk.addAttack(move);
 Composite.add(engine.world,Bodies.rectangle(500,52,2400,20,{isStatic:true,label:PLATFORM_LABELS.solid,collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 const fighters=[dk,victim],contacts:any[]=[];
 const handler=new HitboxDamageHandler((index,hit,context)=>{const result=fighters[index]!.applyHitDetailed(hit);contacts.push({index,hit,context,result,age:dk.getActiveAttack()?.framesElapsed});return{confirmed:result.outcome==='landed'};});
 handler.setFacingLookup(i=>fighters[i]!.getFacing());handler.setGroundedLookup(i=>fighters[i]!.isGrounded());handler.setHurtboxLookup(i=>fighters[i]!.getActiveHurtboxes());
 handler.registerPlayer(0,dk.body);handler.registerPlayer(1,victim.body);
 for(const n of ['collisionStart','collisionActive'])Events.on(engine,n,(e:any)=>handler.handleCollisionStart(e));
 let frame=0;
 const tick=(input:Partial<CharacterInput>={})=>{dk.applyInput({moveX:0,jump:false,...input},++frame);victim.applyInput({moveX:0,jump:false},frame);
  stepCharacterPhysics({characters:fighters,bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:GAME_CONFIG.fixedTimestepMs,stepWorld:delta=>Engine.update(engine,delta)});
  handler.sampleHurtboxContacts(Composite.allBodies(engine.world));return dk.getActiveAttack();};
 for(let n=0;n<20;n++)tick();expect(dk.isGrounded()).toBe(true);dk.setFacing(facing);
 const start=()=>{tick({attack:true});expect(dk.getActiveAttack()).toMatchObject({move:{id:'donkeykong.jab'},framesElapsed:0});tick();};
 const to=(age:number)=>{while(dk.getActiveAttack()&&dk.getActiveAttack()!.framesElapsed<age)tick();};
 const retire=()=>{start();const total=move.startupFrames+move.activeFrames+move.recoveryFrames;to(total-1);tick();expect(dk.getActiveAttack()).toBeNull();expect(dk.canAttack()).toBe(true);expect(dk.getDonkeyKongJabContinuation()?.sourceAge).toBe(24);};
 const cleanup=()=>{for(const f of fighters)f.destroy();Engine.clear(engine);Composite.clear(engine.world,false);};
 return{dk,victim,tick,start,to,retire,cleanup,contacts,scene,engine};
}
describe('DK continuation on settled real Matter/input clock; not full Match keyboard proof',()=>{
 it.each([1,-1] as const)('fresh edges pre23..26 reach retained final native28, then pre27/28 restart face%s',facing=>{
  for(const before of [23,24,25,26,27,28]){const f=fixture(opt,facing);try{f.start();for(let age=2;age<=before;age++)f.tick();
   f.tick({attack:true});expect(f.dk.getActiveAttack()).toMatchObject({move:{id:before<=26?'donkeykong.jab2':'donkeykong.jab'},framesElapsed:0,facing});expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();
  }finally{f.cleanup();}}
 });
 it.each([1,-1] as const)('held first edge never autochains, token has no sensor or extra busy period face%s',facing=>{
  const f=fixture(opt,facing);try{f.tick({attack:true});for(let age=1;age<=29;age++){f.tick({attack:true});expect(f.dk.getActiveAttack()?.move.id).not.toBe('donkeykong.jab2');if(age>=24){expect(f.dk.getActiveAttack()).toBeNull();expect(f.dk.canAttack()).toBe(true);expect(Composite.allBodies(f.engine.world).filter((b:any)=>b.label==='hitbox.attack')).toHaveLength(0);}}expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();}finally{f.cleanup();}
 });
 it('early custom chain follows canonical source age rather than edited actual startup/recovery',()=>{
  const f=fixture({...opt,startupFrames:8,activeFrames:4,recoveryFrames:9});try{f.start();f.to(6);f.tick({attack:true});expect(f.dk.getActiveAttack()?.framesElapsed).toBe(7);expect(f.dk.getActiveAttack()?.move.id).toBe('donkeykong.jab');
   f.to(12);expect(f.dk.getActiveAttack()?.move.id).toBe('donkeykong.jab');f.tick();expect(f.dk.getActiveAttack()).toMatchObject({move:{id:'donkeykong.jab2'},framesElapsed:0});
  }finally{f.cleanup();}
 });
 it('short total5 canonical retirement keeps an independently ticking neutral source tail',()=>{
  const f=fixture({...opt,startupFrames:2,activeFrames:1,recoveryFrames:2});try{f.retire();f.tick();expect(f.dk.getDonkeyKongJabContinuation()?.sourceAge).toBe(25);f.tick({attack:true});expect(f.dk.getActiveAttack()).toMatchObject({move:{id:'donkeykong.jab2'},framesElapsed:0});}finally{f.cleanup();}
 });
 it('freeze preserves original facing/source age, then resumes once and enters reviewed jab2',()=>{
  const f=fixture(opt,-1);try{f.retire();f.dk.armAttackerHitlag(4);for(let n=0;n<4;n++){f.tick();expect(f.dk.getDonkeyKongJabContinuation()?.sourceAge).toBe(24);}
   f.dk.setFacing(1);f.tick({attack:true});expect(f.dk.getActiveAttack()).toMatchObject({move:{id:'donkeykong.jab2'},framesElapsed:0,facing:-1});expect(f.dk.getFacing()).toBe(-1);
  }finally{f.cleanup();}
 });
 it.each([{moveX:.1},{moveY:1},{shield:true},{dodge:true},{jump:true},{grab:true},{special:true},{attackHeavy:true},{appeal:true}] as Partial<CharacterInput>[])('other movement/action intent retires neutral continuation %j',input=>{
  const f=fixture();try{f.retire();f.tick(input);expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();}finally{f.cleanup();}
 });
 it('reset and capture clear token immediately; no old generation survives',()=>{
  const f=fixture();try{f.retire();const generation=f.dk.getPositionResetGeneration();f.dk.resetForRound(0,0);expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();expect(f.dk.getPositionResetGeneration()).toBeGreaterThan(generation);
   for(let n=0;n<20;n++)f.tick();f.retire();f.dk.applyGrabbed(f.victim);expect(f.dk.isGrabbed()).toBe(true);expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();
  }finally{f.cleanup();}
 });
 it('real floor loss retires the tail, and new item ownership clears it immediately',()=>{
  const f=fixture();try{f.retire();Body.setPosition(f.dk.body,{x:0,y:-200});f.tick();f.tick();expect(f.dk.isGrounded()).toBe(false);expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();}finally{f.cleanup();}
  for(const heavy of [false,true]){const f=fixture();try{f.retire();if(heavy)f.dk.syncDonkeyKongHeavyItem(true);else f.dk.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();}finally{f.cleanup();}}
 });
 it('normal receiving sensor damage clears continuation before hitlag or next input',()=>{
  const f=fixture();try{f.retire();const pos=f.dk.getPosition();spawnHitbox(f.scene,{id:'incoming',bodyId:-1,position:pos},{id:'incoming.authored-token-interrupt',type:'jab',damage:2,knockback:{x:1,y:-1,scaling:0},startupFrames:0,activeFrames:4,recoveryFrames:0,cooldownFrames:0,hitbox:{offsetX:0,offsetY:0,width:200,height:200}},1);f.tick();expect(f.contacts.some(c=>c.index===0&&c.result.outcome==='landed')).toBe(true);expect(f.dk.getDamagePercent()).toBe(2);expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();}finally{f.cleanup();}
 });
 it.each([1,-1] as const)('late entry uses normal reviewed active jab2 strike sensor and source damage face%s',facing=>{
  const f=fixture(opt,facing);try{f.retire();f.tick({attack:true});expect(f.dk.getActiveAttack()?.framesElapsed).toBe(0);
   const p=f.dk.getPosition();f.victim.resetForRound(p.x+62.82*facing,p.y-47.92);f.victim.setInvincibility(0);
   f.to(3);expect(f.contacts.some(c=>c.index===1&&c.context.moveId==='donkeykong.jab2'&&c.age===3)).toBe(true);expect(f.victim.getDamagePercent()).toBe(6);expect(f.dk.getActiveAttack()?.hitboxBody?.plugin?.donkeykongCollisionPose?.nativeSample).toBe(4);
  }finally{f.cleanup();}
 });
 it('absent opt-in keeps existing gameplay chain clock and no retained source tail',()=>{
  const f=fixture({...opt,startupFrames:8,activeFrames:4,recoveryFrames:9,jabChain:{nextId:'donkeykong.jab2',advanceWindowStart:7}});try{f.start();f.to(6);f.tick({attack:true});expect(f.dk.getActiveAttack()?.move.id).toBe('donkeykong.jab2');expect(f.dk.getDonkeyKongJabContinuation()).toBeNull();}finally{f.cleanup();}
 });
});
