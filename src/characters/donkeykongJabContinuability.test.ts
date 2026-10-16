import {describe,expect,it} from 'vitest';
import {DONKEYKONG_JAB} from './DonkeyKong';
import {donkeyKongJabCanAdvance,donkeyKongRetainedJabCanAdvance,retainDonkeyKongJabContinuation,tickDonkeyKongJabContinuation} from './donkeykongJabContinuability';
import timing from '../../docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/ground-input-boundary-sources/wiki-neutral-hit1-timing-observation.json';
const move={...DONKEYKONG_JAB,jabChain:{nextId:'donkeykong.jab2',advanceWindowStart:7,continuationWindowEndFrame:28}};
describe('DK opt-in source continuability, technical transition distinct from raw combo flag',()=>{
 it('binds technical native8..28 with an end-exclusive source [7,28) interval',()=>{
  expect(timing.timing.continuability_native_frames).toEqual([8,28]);expect(timing.timing.interruptible_native_frame).toBe(25);
  expect(donkeyKongJabCanAdvance(move,6.999)).toBe(false);expect(donkeyKongJabCanAdvance(move,7)).toBe(true);
 });
 it('uses canonical phases for early chaining, not edited raw elapsed',()=>{
  const custom={...move,startupFrames:8,activeFrames:4,recoveryFrames:9};
  expect(donkeyKongJabCanAdvance(custom,7)).toBe(false);expect(donkeyKongJabCanAdvance(custom,12.499)).toBe(false);
  expect(donkeyKongJabCanAdvance(custom,12.5)).toBe(true);expect(donkeyKongJabCanAdvance(custom,21)).toBe(false);
 });
 it('preserves source retirement24, identity/facing/generation and final legal27 without a lock',()=>{
  const origin={};let s=retainDonkeyKongJabContinuation(move,origin,-1,3,100)!;
  expect(s.sourceAge).toBe(24);expect(s.originAttack).toBe(origin);expect(s.entryFacing).toBe(-1);expect(donkeyKongRetainedJabCanAdvance(s)).toBe(true);
  for(let f=101;f<=103;f++)s=tickDonkeyKongJabContinuation(s,{frame:f,resetGeneration:3,interrupted:false,frozen:false})!;
  expect(s.sourceAge).toBe(27);expect(donkeyKongRetainedJabCanAdvance(s)).toBe(true);
  expect(tickDonkeyKongJabContinuation(s,{frame:104,resetGeneration:3,interrupted:false,frozen:false})).toBeNull();
 });
 it('does not double advance the retirement tick or a repeated frame, freezes then advances once',()=>{
  let s=retainDonkeyKongJabContinuation(move,{},1,0,20)!;
  s=tickDonkeyKongJabContinuation(s,{frame:20,resetGeneration:0,interrupted:false,frozen:false})!;expect(s.sourceAge).toBe(24);
  s=tickDonkeyKongJabContinuation(s,{frame:21,resetGeneration:0,interrupted:false,frozen:true})!;expect(s.sourceAge).toBe(24);
  s=tickDonkeyKongJabContinuation(s,{frame:21,resetGeneration:0,interrupted:false,frozen:false})!;expect(s.sourceAge).toBe(24);
  s=tickDonkeyKongJabContinuation(s,{frame:22,resetGeneration:0,interrupted:false,frozen:false})!;expect(s.sourceAge).toBe(25);
 });
 it.each([{interrupted:true,resetGeneration:0},{interrupted:false,resetGeneration:1}])('retires on interruption or generation discontinuity %j',o=>{
  expect(tickDonkeyKongJabContinuation(retainDonkeyKongJabContinuation(move,{},1,0,1),{...o,frame:2,frozen:true})).toBeNull();
 });
 it('leaves absent opt-ins and other identities on their original clocks',()=>{
  const unopt={...move,jabChain:{nextId:'donkeykong.jab2',advanceWindowStart:7}};
  expect(donkeyKongJabCanAdvance(unopt,7)).toBeNull();expect(retainDonkeyKongJabContinuation(unopt,{},1,0,1)).toBeNull();
  expect(donkeyKongJabCanAdvance({...move,id:'pikachu.jab'},7)).toBeNull();
 });
});
