import {describe,expect,it} from 'vitest';
import {DONKEYKONG_DTILT,DONKEYKONG_JAB} from './DonkeyKong';
import {PIKACHU_JAB} from './Pikachu';
import {applyDonkeyKongMoveProtection,getDonkeyKongPairedProtectionTimeline,resolveDonkeyKongProtectionClock} from './donkeykongPairedProtectionClock';
import {getPackedBodyDrawing,resolvePackedBodyAction,resolvePackedPairedMoveDrawing,selectPackedBodyReceiving,getPackedAttackCollisionPose} from './packedBodyPresentation';
import type {AttackMove} from './attacks';
import type {SimulationAnimationSnapshot} from './simulationSpriteAnimation';
const snapshot=(move:AttackMove,elapsed:number,facing:1|-1)=>({characterId:'donkeykong',facing,grounded:true,
 packedBody:{surfaceTech:null,committed:null,heavyItem:null,itemCue:null,clock:null},ledgeHang:{active:null},dodge:{active:null},activeAttack:{move,framesElapsed:elapsed,facing}} as unknown as SimulationAnimationSnapshot);
const boxes=[{id:'shoulder',region:'shoulderl',offsetX:10,offsetY:0,width:5,height:5},
 {id:'arm',region:'arml',offsetX:20,offsetY:0,width:5,height:5},
 {id:'palm',region:'handl',offsetX:30,offsetY:0,width:5,height:5},
 {id:'head',region:'head',offsetX:0,offsetY:0,width:5,height:5}];
describe('paired DK source-animation protection domain; authored retiming is continuous',()=>{
 it('pins actual full dtilt source phases5/2/17 and the independent native5..7 region window',()=>{
  expect(getDonkeyKongPairedProtectionTimeline(DONKEYKONG_DTILT)?.timeline).toEqual({startup:5,active:2,recovery:17,endFrame:24});
  expect(DONKEYKONG_DTILT.protectionWindows).toEqual([{startFrame:4,endFrame:7,regions:['arml','shoulderl']}]);
 });
 it.each([3.999,4,6.999,7])('stock continuous source age%s protects only declared shoulder/arm',age=>{
  expect(resolveDonkeyKongProtectionClock(DONKEYKONG_DTILT,age)).toEqual({domain:'paired-source',age,endFrame:24});
  const protectedBoxes=applyDonkeyKongMoveProtection(boxes,DONKEYKONG_DTILT,age);
  expect(protectedBoxes.map(h=>h.intangible===true)).toEqual([age>=4&&age<7,age>=4&&age<7,false,false]);
 });
 it.each([1,-1] as const)('custom phase clocks pair drawing, receiving, attack and protection both face%s',facing=>{
  const custom={...DONKEYKONG_DTILT,startupFrames:10,activeFrames:4,recoveryFrames:8};
  for(const [elapsed,sourceAge] of [[7.999,3.9995],[8,4],[10,5],[13.999,6.9995],[14,7]] as const){
   const s=snapshot(custom,elapsed,facing),clock=resolveDonkeyKongProtectionClock(custom,elapsed),drawing=resolvePackedPairedMoveDrawing('donkeykong',custom,elapsed)!;
   const action=resolvePackedBodyAction(s)!,attack=getPackedAttackCollisionPose(s)!,receiving=selectPackedBodyReceiving(s)!;
   expect(clock.age).toBeCloseTo(sourceAge,8);expect(clock.domain).toBe('paired-source');
   expect(drawing.sourceActionAge).toBeCloseTo(sourceAge,8);expect(action.frame).toBeCloseTo(sourceAge,8);
   expect(attack.sourceActionAge).toBeCloseTo(sourceAge,8);expect(attack.nativeSample).toBe(drawing.nativeSample);
   const expected=applyDonkeyKongMoveProtection(getPackedBodyDrawing('donkeykong','dtilt',sourceAge)!.hurtboxes,custom,elapsed);
   expect(receiving).toEqual(expected);
   expect(receiving.filter(h=>h.intangible).every(h=>h.region==='arml'||h.region==='shoulderl')).toBe(true);
   expect(receiving.some(h=>h.intangible)).toBe(sourceAge>=4&&sourceAge<7);
   expect(receiving.filter(h=>h.region==='handl'||h.region==='head').every(h=>!h.intangible)).toBe(true);
  }
 });
 it('retired paired ages cannot borrow protection through gameplay elapsed',()=>{
  const shortened={...DONKEYKONG_DTILT,startupFrames:2,activeFrames:1,recoveryFrames:2};
  expect(resolveDonkeyKongProtectionClock(shortened,5)).toEqual({domain:'paired-source',age:null,endFrame:24});
  expect(applyDonkeyKongMoveProtection(boxes,shortened,5)).toBe(boxes);
 });
 it('preserves generic/nonpaired gameplay domain and scopes the marker to DK identity',()=>{
  const unpaired={...DONKEYKONG_DTILT,id:'donkeykong.forward-tilt'};
  expect(resolveDonkeyKongProtectionClock(unpaired,5).domain).toBe('gameplay');
  const other={...PIKACHU_JAB,protectionWindows:[{startFrame:4,endFrame:7,regions:['arml']}]};
  expect(resolveDonkeyKongProtectionClock(other,5)).toEqual({domain:'gameplay',age:5,endFrame:other.startupFrames+other.activeFrames+other.recoveryFrames});
  expect(applyDonkeyKongMoveProtection(boxes,other,5).map(h=>h.intangible===true)).toEqual([false,true,false,false]);
 });
 it('persisted authored windows retain source coordinates after retiming, including wildcard',()=>{
  const custom={...DONKEYKONG_JAB,startupFrames:8,activeFrames:4,recoveryFrames:9,protectionWindows:[{startFrame:4,endFrame:5,regions:['*']}]};
  expect(applyDonkeyKongMoveProtection(boxes,custom,7).every(h=>!h.intangible)).toBe(true);
  expect(applyDonkeyKongMoveProtection(boxes,custom,8).every(h=>h.intangible)).toBe(true);
  expect(applyDonkeyKongMoveProtection(boxes,custom,10).every(h=>!h.intangible)).toBe(true);
 });
});
