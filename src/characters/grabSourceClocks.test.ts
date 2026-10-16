import {describe,expect,it} from 'vitest';
import {DONKEYKONG_GRAB} from './DonkeyKong';
import {PIKACHU_GRAB} from './Pikachu';
import {createGrabState,resolveGrabThrowClock,stepGrabWithEvents,tickGrab,type GrabState} from './grabState';
import {beginGrabSourcePresentation,stepGrabSourcePresentation} from './grabSourcePresentation';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
import {validateGrabSpec} from './grabSchema';
import type {ThrowDirection} from './throwSchema';
const input={grabPressed:false,grounded:true,pummelPressed:false,throwDirection:null};
const rows:[ThrowDirection,boolean,boolean,number,number][]=[['back',false,false,15,39],['up',false,false,14,43],['down',false,false,19,54],...([false,true].flatMap(air=>[['forward',true,air,15,45],['back',true,air,16,42],['up',true,air,15,29],['down',true,air,17,44]])) as [ThrowDirection,boolean,boolean,number,number][]];
describe('Explicit source grab clocks; native callback ordering remains an adapter',()=>{
 it.each(rows)('%s cargo%s air%s releases native%d-1, retains total%d',(dir,cargo,air,n,total)=>{
  const selected=(cargo?(air?DONKEYKONG_GRAB.cargo!.airThrows!:DONKEYKONG_GRAB.cargo!.throws):DONKEYKONG_GRAB.throws)[dir];
  expect(resolveGrabThrowClock(DONKEYKONG_GRAB,selected)).toEqual({releaseAge:n-1,recoveryFrames:total-n+1,totalFrames:total});
  let state:GrabState={name:'throwing',active:{framesElapsed:0,pummelCooldownRemaining:0,throwDirection:dir,cargo,throwAirborne:air},cooldownRemaining:0};
  for(let age=1;age<total;age++){state=tickGrab(state,input,DONKEYKONG_GRAB);if(age<n-1)expect(state.name).toBe('throwing');else expect(state.name).toBe('cooldown');if(age===n-1)expect(state.cooldownRemaining).toBe(total-n+1);}
  expect(tickGrab(state,input,DONKEYKONG_GRAB).name).toBe('idle');
 });
 it('keeps unopted Pikachu release/recovery clock and forward cargo entry separate',()=>{
  expect(PIKACHU_GRAB.throwClock).toBeUndefined();const move=PIKACHU_GRAB.throws.back;
  expect(resolveGrabThrowClock(PIKACHU_GRAB,move).releaseAge).toBe(move.animationFrames);
  const state:GrabState={name:'holding',active:{framesElapsed:5,pummelCooldownRemaining:0,throwDirection:null},cooldownRemaining:0};
  const after=tickGrab(state,{...input,throwDirection:'forward'},DONKEYKONG_GRAB);
  expect(after).toMatchObject({name:'holding',active:{cargo:true,cargoStartupRemaining:16}});
 });
 it('accepts cooldown1 pummel atomically, rejects cooldown2/throw/expiry/cargo',()=>{
  const holding=(remaining:number):GrabState=>({name:'holding',active:{framesElapsed:5,pummelCooldownRemaining:remaining,throwDirection:null},cooldownRemaining:0});
  const press={...input,pummelPressed:true};
  expect(stepGrabWithEvents(holding(1),press,DONKEYKONG_GRAB)).toMatchObject({pummelStarted:true,state:{active:{pummelCooldownRemaining:21}}});
  expect(stepGrabWithEvents(holding(2),press,DONKEYKONG_GRAB).pummelStarted).toBe(false);
  expect(stepGrabWithEvents(holding(0),{...press,throwDirection:'back'},DONKEYKONG_GRAB).pummelStarted).toBe(false);
  expect(stepGrabWithEvents(holding(0),press,{...DONKEYKONG_GRAB,holdFramesMax:6}).pummelStarted).toBe(false);
  const cargo={...holding(0),active:{...holding(0).active!,cargo:true}};
  expect(stepGrabWithEvents(cargo,press,DONKEYKONG_GRAB).pummelStarted).toBe(false);
  expect(stepGrabWithEvents(createGrabState(),press,DONKEYKONG_GRAB).pummelStarted).toBe(false);
 });
 it('freezes source contact age1, skips born/duplicate frames, ends age7 independently of cooldown',()=>{
  let clock=beginGrabSourcePresentation(10,-1);expect(stepGrabSourcePresentation(clock,10,7)).toBe(clock);
  clock=stepGrabSourcePresentation(clock,11,7)!;expect(clock.framesElapsed).toBe(1);
  for(let frame=12;frame<27;frame++)clock=stepGrabSourcePresentation(clock,frame,7,true)!;
  expect(clock.framesElapsed).toBe(1);expect(clock.facing).toBe(-1);
  for(let frame=27;frame<32;frame++)clock=stepGrabSourcePresentation(clock,frame,7)!;
  expect(clock.framesElapsed).toBe(6);expect(stepGrabSourcePresentation(clock,32,7)).toBeNull();
 });
 it('persists all three opt-ins through full JSON and leaves omitted PK fields unchanged',()=>{
  for(const id of ['donkeykong','pikachu'] as const){const spec=getAuthorableCharacterSpec(id),parsed=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));expect(parsed.moves!.grab).toEqual(spec.moves!.grab);}
 });
 it.each([{throwClock:'bad'},{pummel:{...DONKEYKONG_GRAB.pummel!,motionFrames:0}},{cargo:{...DONKEYKONG_GRAB.cargo!,entryMotionFrames:15}},{throws:{...DONKEYKONG_GRAB.throws,back:{...DONKEYKONG_GRAB.throws.back,animationFrames:1}}}])('rejects invalid source field %j',patch=>{
  expect(()=>validateGrabSpec({...DONKEYKONG_GRAB,...patch} as typeof DONKEYKONG_GRAB)).toThrow();
 });
});
