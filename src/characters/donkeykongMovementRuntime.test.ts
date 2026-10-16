import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
const require=createRequire(import.meta.url);
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
function fixture(){
 const scene={matter:{add:{rectangle:Bodies.rectangle},body:Body,world:{on(){},off(){},remove(){}}}};
 const dk=new DonkeyKong(scene as any,{spawnX:300,spawnY:200});
 const ground=vi.spyOn(dk,'isGrounded').mockReturnValue(true);
 let frame=0;const tick=(moveX=0)=>dk.applyInput({moveX,jump:false},++frame);
 for(let i=0;i<10;i++)tick();
 return{dk,ground,tick};
}
describe('DK ordinary movement consumers (source coefficients; common controller setup remains adapted)',()=>{
 it('uses additive run acceleration and constant neutral traction once, restoring Matter friction on reset',()=>{
  const {dk,tick}=fixture();for(let i=0;i<25;i++)tick(1);
  expect(dk.getLocomotionStateName()).toBe('run');
  Body.setVelocity(dk.body,{x:5,y:0});tick(1);
  expect(dk.getVelocity().x).toBeCloseTo(5+(.044+.07337)*5,9);
  const friction=dk.body.friction;dk.preparePhysicsStep(0);expect(dk.body.friction).toBe(0);
  Body.setVelocity(dk.body,{x:5,y:0});tick(0);
  expect(dk.getPackedBodyState().turnBrake?.sheet).toBe('run_brake');
  expect(dk.getVelocity().x).toBeCloseTo(5-.123*5,9);
  dk.resetForRound(300,200);expect(dk.body.friction).toBe(friction);expect(dk.getPackedBodyState().turnBrake).toBeNull();
 });
 it('uses nonproportional half-stick air acceleration and fixed neutral brake',()=>{
  const {dk,ground,tick}=fixture();ground.mockReturnValue(false);tick();
  Body.setVelocity(dk.body,{x:2,y:0});tick(.5);
  expect(dk.getVelocity().x).toBeCloseTo(2+(.01+.5*.05)*5,9);
  Body.setVelocity(dk.body,{x:2,y:0});tick();expect(dk.getVelocity().x).toBeCloseTo(2-.015*5,9);
 });
 it('retains dash-turn flag3 facing adapter and permits source transition18 before cancel22',()=>{
  const {dk,tick}=fixture();tick(1);tick(-1);
  expect(dk.getPackedBodyState().turnBrake?.sheet).toBe('dash_turn');expect(dk.getFacing()).toBe(1);
  tick(-1);expect(dk.getFacing()).toBe(1);tick(-1);expect(dk.getFacing()).toBe(-1);
  for(let age=3;age<17;age++)tick(-1);
  expect(dk.getPackedBodyState().turnBrake).not.toBeNull();tick(-1);
  expect(dk.getPackedBodyState().turnBrake).toBeNull();expect(dk.getLocomotionStateName()).toBe('run');
 });
 it('freezes the run-turn drawing commitment and resumes run without an invented initial-dash burst',()=>{
  const {dk,tick}=fixture();for(let i=0;i<25;i++)tick(1);tick(-1);
  expect(dk.getPackedBodyState().turnBrake?.sheet).toBe('run_turn');
  dk.armAttackerHitlag(3);for(let i=0;i<3;i++){tick(-1);expect(dk.getPackedBodyState().turnBrake?.framesElapsed).toBe(0);}
  for(let age=1;age<33;age++)tick(-1);
  expect(dk.getPackedBodyState().turnBrake?.framesElapsed).toBe(32);tick(-1);
  expect(dk.getPackedBodyState().turnBrake).toBeNull();expect(dk.getLocomotionStateName()).toBe('run');
  expect(Math.abs(dk.getVelocity().x)).toBeLessThanOrEqual(1.873*5);
 });
});
