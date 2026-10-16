/** Prepared closed snapshot fixtures; execution belongs to final verification. */
import {describe,expect,it} from 'vitest';
import {parseLinkArrowLaunchPlan,parseLinkSwordBeamPlan} from './linkArticlePlanValidation';
function arrow(){return {releaseAge:3,arrowIndex:1,damage:5.25,speedNative:3.125,firingAngleDegrees:2.3,
  gravityNative:.054,lifetimeFrames:46,stuckLifetimeFrames:30,radiusNative:1.35,
  referenceKnockback:{angle:361,base:25,growth:110,fixed:0},hitlagMultiplier:.8,
  sdiMultiplier:1,shieldDamageAdd:0,rehitFrames:0,setoff:'on',lrCheck:'forward',situation:'ground-air',
  targetCategory:'all',absorbable:false,friendlyFire:false,reflectable:true,direct:false};}
function beam(){return {damage:7.25,life:35,speedNative:2.65,scale:.875,rootOffset:{x:55,y:-30},brakeNative:.01,
  capsule:{start:{x:-35,y:-2.5},end:{x:35,y:-2.5},radius:9}};}
describe('closed intrinsic article source snapshots',()=>{
  it('round trips fractional authored amplitudes and distinct fixed/variable knockback without filling fields',()=>{
    const data=arrow(),parsed=parseLinkArrowLaunchPlan(JSON.parse(JSON.stringify(data)));
    expect(parsed).toEqual(data);expect(parsed.damage).toBe(5.25);
    data.referenceKnockback={angle:47.5,base:0,growth:0,fixed:33.25};
    expect(parseLinkArrowLaunchPlan(data).referenceKnockback).toEqual(data.referenceKnockback);
  });
  it('rejects missing, unknown and non-object source plans or nested knockback',()=>{
    for(const malformed of [null,[],{...arrow(),unknown:1},{...arrow(),speedNative:undefined},
      {...arrow(),referenceKnockback:{...arrow().referenceKnockback,unknown:true}},
      {...arrow(),referenceKnockback:null}])expect(()=>parseLinkArrowLaunchPlan(malformed)).toThrow();
  });
  it('does not permit source literal flags to become silent authoring overrides',()=>{
    for(const [key,value] of Object.entries({sdiMultiplier:0,shieldDamageAdd:1,rehitFrames:1,setoff:'off',
      lrCheck:'position',situation:'air',targetCategory:'fighters',absorbable:true,friendlyFire:true,reflectable:false,direct:true}))
      expect(()=>parseLinkArrowLaunchPlan({...arrow(),[key]:value})).toThrow();
    for(const override of [{releaseAge:.5},{arrowIndex:2},{lifetimeFrames:46.5},{stuckLifetimeFrames:0},
      {radiusNative:0},{gravityNative:-1},{damage:NaN},{speedNative:Infinity}])
      expect(()=>parseLinkArrowLaunchPlan({...arrow(),...override})).toThrow();
  });
  it('retains independently supplied beam geometry and prevents snapshot aliases from changing it',()=>{
    const data=beam(),parsed=parseLinkSwordBeamPlan(data);
    expect(parsed).toEqual(data);data.rootOffset.x=0;data.capsule.start.x=0;
    expect(parsed.rootOffset.x).toBe(55);expect(parsed.capsule.start.x).toBe(-35);
    expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.capsule.start)).toBe(true);
    const a=arrow(),p=parseLinkArrowLaunchPlan(a);a.referenceKnockback.base=999;
    expect(p.referenceKnockback.base).toBe(25);expect(Object.isFrozen(p.referenceKnockback)).toBe(true);
  });
  it('rejects partial, guessed, invalid and extended beam state instead of defaulting source geometry',()=>{
    for(const override of [{rootOffset:null},{rootOffset:{x:55,y:-30,z:0}},
      {capsule:{...beam().capsule,radius:0}},{capsule:{...beam().capsule,start:{x:NaN,y:0}}},
      {damage:-1},{life:35.5},{scale:0},{brakeNative:-.1},{unknown:true}])
      expect(()=>parseLinkSwordBeamPlan({...beam(),...override})).toThrow();
  });
});
