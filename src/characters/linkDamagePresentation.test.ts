/** Prepared for final verification; these fixtures prove selected adapters,
 * not the unrecovered native common height/RNG/roll/rate consumer. */
import {describe,it,expect} from 'vitest';
import {selectLinkDamagePresentation,linkActualReceivingHeight,linkReceivingRegionIdHeight} from './linkDamagePresentation';
import type {SourceDamagePresentationReceipt} from './sourceDamagePresentationReceipt';
const receipt:SourceDamagePresentationReceipt={eventSerial:1,generation:1,entryFrame:10,lastAdvancedFrame:10,framesElapsed:0,
  ownElectricStop:false,electricStopFramesElapsed:0,electricStopLastAdvancedFrame:10,
  entryFacing:1,groundedAtEntry:true,damageApplied:3,postHitPercent:200,initialHitstunFrames:14,initialStatusHitstunFrames:7,
  tumbleAtAdmission:false,referenceKnockback:40,launchVelocity:{x:4,y:-1},nativeCollisionAttribute:null,nativeLaunchAngleRadians:null,
  nativeAttackHeight:null,nativeAttackHeightSource:null,attackHeightContext:null,electric:false,
  sourceContactCapsuleWorld:null,receivingRegions:[{id:'head',centreWorld:{x:1,y:-70}}]};
const observation={localStop:false,nativeLaunchAngleRadians:null};
describe('actual Link damage motion receipt',()=>{
  it('recognizes current reviewed anatomical surfaces by exact stem and ordinal',()=>{
    const hit=(ids:string[])=>({...receipt,receivingRegions:ids.map(id=>({id,centreWorld:{x:1,y:2}}))});
    expect(selectLinkDamagePresentation(hit(['head-contour-0','head-contour-19']),observation)?.motion).toBe('damage_hi_1');
    expect(selectLinkDamagePresentation(hit(['foot-L-0','shin-L-2']),observation)?.motion).toBe('damage_lw_1');
    expect(linkActualReceivingHeight(hit(['palm-L-7','upper-arm-R-1','torso-2'])))
      .toEqual({height:'n',producer:'unanimous-anatomical-region'});
    expect(linkActualReceivingHeight(hit(['neck-1','head-contour-4'])).height).toBe('hi');
  });
  it('keeps unknown and mixed regions neutral without primitive-count weighting',()=>{
    const high=Array.from({length:25},(_,i)=>({id:`head-contour-${i}`,centreWorld:{x:1,y:-70}}));
    const low={id:'foot-R-0',centreWorld:{x:1,y:0}};
    for(const regions of [[...high,low],[low,...high].reverse()])
      expect(linkActualReceivingHeight({...receipt,receivingRegions:regions}))
        .toEqual({height:'n',producer:'mixed-or-unavailable-neutral'});
    expect(linkActualReceivingHeight({...receipt,receivingRegions:[...high,{id:'cap-0',centreWorld:{x:1,y:-70}}]}).producer)
      .toBe('mixed-or-unavailable-neutral');
    for(const id of ['head-decoration-0','head-contour-bogus','foot-L-01','palm-X-0','torso--1'])
      expect(linkReceivingRegionIdHeight(id)).toBeNull();
  });
  it('uses initial reference hitstun boundaries independently of percent and shortened engine budget',()=>{
    expect(selectLinkDamagePresentation(receipt,observation)?.motion).toBe('damage_hi_1');
    expect(selectLinkDamagePresentation({...receipt,postHitPercent:0,initialHitstunFrames:15},observation)?.motion).toBe('damage_hi_2');
    expect(selectLinkDamagePresentation({...receipt,initialHitstunFrames:20},observation)?.motion).toBe('damage_hi_2');
    expect(selectLinkDamagePresentation({...receipt,initialHitstunFrames:21},observation)?.motion).toBe('damage_hi_3');
  });
  it('requires actual tumble admission rather than imposing new launch physics from a tier',()=>{
    expect(selectLinkDamagePresentation({...receipt,initialHitstunFrames:40},observation)?.motion).toBe('damage_hi_3');
    expect(selectLinkDamagePresentation({...receipt,tumbleAtAdmission:true},observation)?.motion).toBe('damage_fly_hi');
    expect(selectLinkDamagePresentation({...receipt,groundedAtEntry:false},observation)?.motion).toBe('damage_air_1');
  });
  it('keeps cross-band contact independent of overlap-array ordering',()=>{
    const regions=[...receipt.receivingRegions!,{id:'foot-L',centreWorld:{x:1,y:0}}];
    expect(linkActualReceivingHeight({...receipt,receivingRegions:regions}).height).toBe('n');
    expect(linkActualReceivingHeight({...receipt,receivingRegions:[...regions].reverse()}).height).toBe('n');
    expect(linkActualReceivingHeight({...receipt,receivingRegions:[regions[1]!] }).height).toBe('lw');
  });
  it('uses explicit source height only within the conservative equal-root adapter',()=>{
    const low:SourceDamagePresentationReceipt={...receipt,nativeAttackHeight:'low',
      nativeAttackHeightSource:{sourceScript:'AttackLw3.txt',sourceLine:8},attackHeightContext:{attackerRootY:100,victimRootY:100}};
    expect(linkActualReceivingHeight(low)).toMatchObject({height:'lw',producer:'source-equal-root-override'});
    expect(linkActualReceivingHeight({...low,attackHeightContext:{attackerRootY:100,victimRootY:100.001}}).height).toBe('hi');
  });
  it('uses original resolved angle with strict top boundaries and inclusive selected meteor bounds',()=>{
    const fly={...receipt,tumbleAtAdmission:true};
    expect(selectLinkDamagePresentation(fly,{...observation,nativeLaunchAngleRadians:Math.PI/2})?.motion).toBe('damage_fly_top');
    expect(selectLinkDamagePresentation(fly,{...observation,nativeLaunchAngleRadians:1.22173})?.motion).toBe('damage_fly_hi');
    expect(selectLinkDamagePresentation(fly,{...observation,nativeLaunchAngleRadians:1.91986})?.motion).toBe('damage_fly_hi');
    expect(selectLinkDamagePresentation(fly,{...observation,nativeLaunchAngleRadians:270*Math.PI/180})?.motion).toBe('damage_fly_meteor');
    for(const degrees of [230,310])expect(selectLinkDamagePresentation(fly,{...observation,nativeLaunchAngleRadians:degrees*Math.PI/180})?.motion).toBe('damage_fly_meteor');
  });
  it('requires this victim flinch to own electric stop and uses its independent clock',()=>{
    const elec={...receipt,electric:true,framesElapsed:0,ownElectricStop:true,electricStopFramesElapsed:4,entryFacing:-1 as const};
    expect(selectLinkDamagePresentation(elec,observation)).toMatchObject({motion:'damage_elec',rawAge:4,facing:-1});
    expect(selectLinkDamagePresentation({...elec,ownElectricStop:false,electricStopFramesElapsed:0},
      {...observation,localStop:true})?.motion).toBe('damage_hi_1');
    expect(selectLinkDamagePresentation({...elec,electricStopFramesElapsed:70},observation)?.rawAge).toBe(70);
    expect(selectLinkDamagePresentation(null,observation)).toBeNull();
  });
});
