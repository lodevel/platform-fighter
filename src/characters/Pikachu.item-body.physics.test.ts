import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {Pikachu} from './Pikachu';
import {type CharacterInput} from './Character';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';

const require=createRequire(import.meta.url);
const Engine=require('../physics/matter/source/lib/core/Engine.js');
const Events=require('../physics/matter/source/lib/core/Events.js');
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const neutral:CharacterInput={moveX:0,moveY:0,jump:false};

import {captureSimulationAnimation,resolveSimulationAction} from './simulationSpriteAnimation';
import pikachuFrames from '../../assets/characters/pikachu/gameplay.json';
/** Reviewed native Have socket row of a drawing (gameplay.json itemAttachmentPoses). */
const getPikachuItemAttachment=(sheet:string,nativeSample:number)=>((pikachuFrames.animations as unknown as Record<string,{itemAttachmentPoses?:{nativeSample:number;position:{x:number;y:number}}[]}>)[sheet]
  ?.itemAttachmentPoses?.find(row=>row.nativeSample===nativeSample)?.position)??null;
import {RUN_VELOCITY_DEAD_ZONE} from './spriteAnimationDriver';

function fixture(ledgeFacing?:1|-1){
 const engine=Engine.create();
 const names:Record<string,string>={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene:any={matter:{body:Body,add:{rectangle(x:number,y:number,w:number,h:number,options:object){const b=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,b);return b;}},world:{on(event:string,fn:(...args:any[])=>void){Events.on(engine,names[event]??event,fn);},off(event:string,fn:(...args:any[])=>void){Events.off(engine,names[event]??event,fn);},remove(body:any){Composite.remove(engine.world,body);}}}};
 const corner=ledgeFacing?{platformId:'item-contact-floor',side:ledgeFacing===1?'left' as const:'right' as const,x:ledgeFacing===1?-150:150,y:90}:null;
 const actor=new Pikachu(scene,{spawnX:corner?corner.x-12*ledgeFacing!:0,spawnY:corner?95:0});let frame=0;
 Composite.add(engine.world,Bodies.rectangle(0,corner?100:35,corner?300:3000,20,{isStatic:true,label:PLATFORM_LABELS.solid,...(corner?{plugin:{platformId:corner.platformId}}:{}),collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}));
 if(corner){actor.setFacing(ledgeFacing!);actor.setLedgeCandidates([corner]);Body.setVelocity(actor.body,{x:0,y:1});}
 const step=(input:CharacterInput=neutral)=>{
  actor.applyInput(input,++frame);
  stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});
 };
 for(let n=0;n<(corner?25:12);n++)step();
 if(corner)expect(actor.getLedgeHangState().name).toBe('hanging');
 return{actor,step};
}

describe('Pikachu held item uses the actual source body and ordinary controls',()=>{
 it.each([1,-1] as const)('keeps neutral WaitItem and moving walk/jump/crouch body routes distinct, facing%s',facing=>{
  const f=fixture();f.actor.setFacing(facing);f.actor.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});
  const item=f.actor.getPikachuItemPresentationState()!;expect(item.sheet).toBe('item_carry');
  const have=getPikachuItemAttachment(item.sheet,item.nativeSample)!;const p=f.actor.getPosition();
  expect(f.actor.getHeldItemWorldPosition()).toEqual({x:p.x+have.x*facing,y:p.y+have.y});
  f.step({...neutral,moveX:.5*facing});
  expect(f.actor.getPikachuItemPresentationState()).toBeNull();
  const action=resolveSimulationAction(captureSimulationAnimation(f.actor,0,false));expect(action.reviewedSheet).toBe('walk');
  const walkHave=getPikachuItemAttachment('walk',0)!;const w=f.actor.getPosition();
  expect(f.actor.getHeldItemWorldPosition()).toEqual({x:w.x+walkHave.x*facing,y:w.y+walkHave.y});
  f.step();f.step({...neutral,jump:true});
  expect(f.actor.getPikachuItemPresentationState()).toBeNull();
  expect(resolveSimulationAction(captureSimulationAnimation(f.actor,0,false)).reviewedSheet).toBe('jumpsquat');
  const squatHave=getPikachuItemAttachment('jumpsquat',0)!;const squatPosition=f.actor.getPosition();
  expect(f.actor.getHeldItemWorldPosition()).toEqual({x:squatPosition.x+squatHave.x*facing,y:squatPosition.y+squatHave.y});
  for(let n=0;n<5;n++)f.step({...neutral,jump:true});
  expect(f.actor.isGrounded()).toBe(false);expect(f.actor.getPikachuItemPresentationState()).toBeNull();
  expect(resolveSimulationAction(captureSimulationAnimation(f.actor,0,false)).reviewedSheet).toMatch(/^jump/);
  const jumpHave=getPikachuItemAttachment('jump',0)!;const jumpPosition=f.actor.getPosition();
  expect(f.actor.getHeldItemWorldPosition()).toEqual({x:jumpPosition.x+jumpHave.x*facing,y:jumpPosition.y+jumpHave.y});
  const c=fixture();c.actor.setFacing(facing);c.actor.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});c.step({...neutral,moveY:1});
  expect(c.actor.getPikachuItemPresentationState()).toBeNull();expect(resolveSimulationAction(captureSimulationAnimation(c.actor,0,false)).reviewedSheet).toBe('crouch_start');
  const crouchHave=getPikachuItemAttachment('crouch_start',0)!;const crouchPosition=c.actor.getPosition();
  expect(c.actor.getHeldItemWorldPosition()).toEqual({x:crouchPosition.x+crouchHave.x*facing,y:crouchPosition.y+crouchHave.y});
 });
 it('holds the sparse carry source clock through hitlag and excludes its106 endpoint from playback',()=>{
  const f=fixture();f.actor.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});f.step();const before=f.actor.getPikachuItemPresentationState();expect(before).toMatchObject({nativeAge:1,nativeSample:0});
  f.actor.armAttackerHitlag(3);for(let n=0;n<3;n++){f.step();expect(f.actor.getPikachuItemPresentationState()).toEqual(before);}
  for(let n=0;n<25;n++)f.step();expect(f.actor.getPikachuItemPresentationState()).toMatchObject({nativeAge:26,nativeSample:26});
  for(let n=0;n<80;n++)f.step();expect(f.actor.getPikachuItemPresentationState()).toMatchObject({nativeAge:0,nativeSample:0,artFrameIndex:0});
 });
 it.each([[1,'still'],[-1,'still'],[1,'moving'],[-1,'moving'],[1,'ledge'],[-1,'ledge']] as const)('keeps first real landing contact paired with its visible source body/socket before arbitration, facing%s route%s',(facing,route)=>{
  const f=fixture(route==='ledge'?facing:undefined);f.actor.setFacing(facing);f.actor.equipItem({definition:{itemClass:'battering'},canUse:()=>true,noteUse:()=>{},spendShot:()=>false,getAmmo:()=>null});
  const flightInput={...neutral,moveX:route==='moving'?.5*facing:0};
  f.step({...flightInput,jump:true});
  for(let n=0;n<8;n++)f.step(flightInput);
  expect(f.actor.isGrounded()).toBe(false);
  let landed=false;
  for(let n=0;n<120;n++){
   f.step(flightInput);
   if(f.actor.isGrounded()){landed=true;break;}
  }
  expect(landed).toBe(true);
  // Contact occurs in the solver after this step's input arbitration. Keep
  // the actual idle0/run0 drawing, but require its source body and Have.
  expect(f.actor.getJumpsUsed()).toBe(1);
  expect(f.actor.getLandingPresentationState()).toBeNull();
  expect(f.actor.getPikachuItemPresentationState()).toBeNull();
  // The pending landing suppresses the ordinary clock. Preserve the
  // existing classifier's visible idle0/run0 based on residual velocity.
  expect(f.actor.getOrdinaryPresentationState()).toBeNull();
  const sheet=route==='still'?'idle':'run';
  if(route!=='still')expect(Math.abs(f.actor.getVelocity().x)).toBeGreaterThan(RUN_VELOCITY_DEAD_ZONE);
  expect(resolveSimulationAction(captureSimulationAnimation(f.actor,0,false))).toMatchObject({reviewedSheet:sheet,frame:0});
  expect(f.actor.getActiveHurtboxes()).toHaveLength(12);
  const have=getPikachuItemAttachment(sheet,0)!;const position=f.actor.getPosition();
  expect(f.actor.getHeldItemWorldPosition()).toEqual({x:position.x+have.x*facing,y:position.y+have.y});
  f.step();
  expect(f.actor.getJumpsUsed()).toBe(0);
  expect(resolveSimulationAction(captureSimulationAnimation(f.actor,0,false)).reviewedSheet).toMatch(/^landing_(soft|hard)$/);
  expect(f.actor.getActiveHurtboxes()).toHaveLength(12);
  for(let n=0;n<40&&!f.actor.getPikachuItemPresentationState();n++)f.step();
  expect(f.actor.getPikachuItemPresentationState()?.sheet).toBe('item_carry');
 });
});

import {BEAM_SWORD_DEFINITION} from '../items/BeamSword';
import {STAR_ROD_DEFINITION} from '../items/StarRod';
import {HOME_RUN_BAT_DEFINITION} from '../items/HomeRunBat';
import {ItemEntity} from '../items/ItemEntity';
import {Inventory} from '../items/Inventory';
import {selectHeldItemSocket} from './heldItemSocket';
import type {ItemDefinition} from '../items/ItemDefinition';

/** Ultimate items phase 3: Pikachu's own item swing art (native h04swing / h06swing4bat files) replaces the
 * temporary attack sheets; the sword / star rod motions share the bat's drawn files (itemMotionClips). */
describe('Pikachu item swings play its native item swing clips',()=>{
 const holding=(def:ItemDefinition)=>{
  const f=fixture(),item=new ItemEntity(1,def,0,{x:0,y:0});item.markGrounded(0,{x:0,y:0});
  expect(new Inventory(f.actor).pickup(item,0,0,f.actor.getPosition())).toBe(true);
  for(let n=0;n<3;n++)f.step();
  return f;
 };
 const sheet=(f:ReturnType<typeof fixture>)=>resolveSimulationAction(captureSimulationAnimation(f.actor,0,false)).sheets[0];
 it.each([[HOME_RUN_BAT_DEFINITION,'item_bat_swing_1'],[BEAM_SWORD_DEFINITION,'item_bat_swing_1'],[STAR_ROD_DEFINITION,'item_bat_swing_1']] as const)
 ('%s jab plays %s with the item at the drawn mouth socket',(def,clip)=>{
  const f=holding(def);f.step({...neutral,attack:true});
  expect(f.actor.getActiveAttack()?.move.id).toBe(def.uses!.jab!.id);
  expect(sheet(f)).toBe(clip);
  expect(selectHeldItemSocket(captureSimulationAnimation(f.actor,0,false))).not.toBeNull();
 });
 it.each([BEAM_SWORD_DEFINITION,STAR_ROD_DEFINITION])('%s forward smash winds up on item_sword_swing_4, holds on its charge loop and swings on release',def=>{
  const f=holding(def),held={...neutral,attackHeavy:true};
  f.step(held);expect(f.actor.getActiveAttack()).toBeNull();expect(sheet(f)).toBe('item_sword_swing_4');
  for(let n=0;n<20;n++)f.step(held);
  expect(f.actor.getActiveAttack()).toBeNull();expect(sheet(f)).toBe('item_sword_swing_4_hold');
  expect(selectHeldItemSocket(captureSimulationAnimation(f.actor,0,false))).not.toBeNull();
  f.step();
  expect(f.actor.getActiveAttack()?.move.id).toBe(def.uses!.fsmash!.id);expect(sheet(f)).toBe('item_sword_swing_4');
 });
});
