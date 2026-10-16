import {describe,it,expect} from 'vitest';
import {beginPikachuFinalOrientation,stepPikachuFinalOrientation,pikachuFinalMovementOrientation,
 transformPikachuFinalOrientationPoint,parsePikachuFinalOrientationState} from './pikachuFinalOrientation';
const id={runId:1,ownerIndex:0,ownerGeneration:2};
const start=()=>beginPikachuFinalOrientation({...id,frame:0,facing:1,phaseRevision:0});
const step=(phase:'attack'|'attack2'|'return'|'finish',revision:number,frame:number,x:number,y:number)=>({...id,frame,phase,phaseRevision:revision,
 actualOwnerTransition:true,clockAdvances:true,velocity:{basis:'world' as const,x,y}});
describe('source-guided Pika Final posture operator',()=>{
 it('aligns right/up and left/up after exactly one movement-facing mirror',()=>{
  const right=pikachuFinalMovementOrientation({x:3,y:-3},{facing:1,rotationDegrees:0});
  const left=pikachuFinalMovementOrientation({x:-3,y:-3},{facing:1,rotationDegrees:0});
  expect(right).toMatchObject({facing:1,rotationDegrees:-45});expect(left).toMatchObject({facing:-1,rotationDegrees:45});
  const r=transformPikachuFinalOrientationPoint({x:10,y:0},right),l=transformPikachuFinalOrientationPoint({x:10,y:0},left);
  expect(r.x).toBeCloseTo(7.07106781,7);expect(r.y).toBeCloseTo(-7.07106781,7);
  expect(l.x).toBeCloseTo(-7.07106781,7);expect(l.y).toBeCloseTo(-7.07106781,7);
 });
 it('uses native zeroX vertical tie−1 and explicit zero-vector hold',()=>{
  expect(pikachuFinalMovementOrientation({x:0,y:-3},{facing:1,rotationDegrees:0})).toMatchObject({facing:-1,rotationDegrees:90});
  expect(pikachuFinalMovementOrientation({x:0,y:0},{facing:1,rotationDegrees:-30}))
   .toEqual({facing:1,rotationDegrees:-30,precision:'AUTHORED_ZERO_VECTOR_HOLD'});
 });
 it('captures actual status initialized vector, then ignores same-status live changes',()=>{
  const attack=stepPikachuFinalOrientation(start(),step('attack',1,1,3,-3))!;
  const later=stepPikachuFinalOrientation(attack,{...step('attack',1,2,-3,3),actualOwnerTransition:false})!;
  expect(later.rotationDegrees).toBe(-45);expect(later.admittedWorldVelocity).toEqual({x:3,y:-3});
 });
 it('updates on genuine Attack2 revision and converts nativeYup once',()=>{
  const a=stepPikachuFinalOrientation(start(),step('attack',1,1,3,-3))!;
  const b=stepPikachuFinalOrientation(a,{...step('attack2',2,2,-3,3),velocity:{basis:'native',x:-3,y:3}})!;
  expect(b.facing).toBe(-1);expect(b.rotationDegrees).toBe(45);expect(b.admittedWorldVelocity).toEqual({x:-15,y:-15});
 });
 it('freezes local/global stop and duplicate calls; real FinalEnd resets0',()=>{
  const a=stepPikachuFinalOrientation(start(),step('attack',1,1,3,-3))!;
  expect(stepPikachuFinalOrientation(a,{...step('attack2',2,2,-3,3),clockAdvances:false})?.rotationDegrees).toBe(-45);
  expect(stepPikachuFinalOrientation(a,step('attack',1,1,-3,3))).toBe(a);
  expect(stepPikachuFinalOrientation(a,step('attack2',2,1,-3,-3)))
   .toMatchObject({phase:'attack2',phaseRevision:2,facing:-1,rotationDegrees:45});
  expect(stepPikachuFinalOrientation(a,step('finish',2,2,0,0))).toMatchObject({rotationDegrees:0,admittedWorldVelocity:null});
 });
 it('rejects renderer-only resets and stale generation, parses strict state',()=>{
  const a=stepPikachuFinalOrientation(start(),step('attack',1,1,3,-3))!;
  expect(()=>stepPikachuFinalOrientation(a,{...step('return',2,2,3,3),actualOwnerTransition:false})).toThrow();
  expect(stepPikachuFinalOrientation(a,{...step('attack2',2,2,-3,3),ownerGeneration:3})).toBeNull();
  expect(parsePikachuFinalOrientationState(a)).toEqual(a);
  expect(()=>parsePikachuFinalOrientationState({...a,extra:1})).toThrow();
  expect(()=>parsePikachuFinalOrientationState({...a,admittedWorldVelocity:null})).toThrow();
  expect(()=>parsePikachuFinalOrientationState({...a,rotationDegrees:45})).toThrow();
 });
});
