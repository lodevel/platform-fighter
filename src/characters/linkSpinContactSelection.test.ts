/** Spin contact selection: data packets and native capsules, then authored overrides. */
import {describe,it,expect} from 'vitest';
import {selectLinkSpinContact} from './linkSpinContactSelection';
import {FRESH_LINK_UP_SPECIAL as stock} from './linkFreshSpecials';
import type {LinkSpinState} from './linkSpinController';
import {linkGeometryCapsule} from './linkAttackData';
const state:LinkSpinState={phase:'ground-release',age:3,chargeFrames:0,damageMultiplier:1};
describe('shared source Spin contact selection',()=>{
  it('preserves source regional damage/launch with the native capsules of that age',()=>{
    const s=selectLinkSpinContact(state,stock)!;
    expect(s.authoringAge).toBe(7);expect(s.collisionHits.map(h=>h.damage)).toEqual([14,14,11.2]);
    expect(s.collisionHits.map(h=>h.capsule)).toEqual(s.collisionHits.map(h=>linkGeometryCapsule('link.spin.ground',3,'Clean hit',h.id)));
    expect(s.collisionHits[0]!.knockback?.reference).toBeDefined();expect(s.resolvedMove.id).toBe(stock.id);
  });
  it('applies global edited amplitude and source charge once',()=>{
    const s=selectLinkSpinContact({...state,chargeFrames:60,damageMultiplier:1.6},{...stock,damage:8})!;
    expect(s.collisionHits[0]!.damage).toBeCloseTo(44.8,12);
  });
  it('keeps custom charge amplitude separate from the source1.6 charge law',()=>{
    const move={...stock,damage:8,charge:{minChargeFrames:0,maxChargeFrames:60,minDamage:8,maxDamage:16,
      minKnockback:{x:0,y:0,scaling:0},maxKnockback:{x:0,y:0,scaling:0},knockbackMode:'damage-only' as const}};
    expect(selectLinkSpinContact({...state,chargeFrames:60,damageMultiplier:1.6},move)!.collisionHits[0]!.damage).toBe(56);
  });
  it('prioritizes empty window capsules over global geometry and reports actual gaps',()=>{
    const cap={id:99,capsule:{start:{x:1,y:2},end:{x:3,y:4},radius:1}};
    const move={...stock,collisionHits:[cap],hitWindows:[{startFrame:7,endFrame:9,collisionHits:[]}]};
    expect(selectLinkSpinContact(state,move)!.collisionHits).toEqual([]);
    expect(selectLinkSpinContact(state,{...move,hitWindows:[]})).toBeNull();
    expect(selectLinkSpinContact(state,{...stock,activeFrames:0})).toBeNull();
  });
  it('keeps exact window rectangles, relative facing and authored strike identity',()=>{
    const rect={offsetX:4,offsetY:-2,width:12,height:8};
    const s=selectLinkSpinContact(state,{...stock,collisionHits:[],hitWindows:[{startFrame:7,endFrame:9,hitbox:rect,facing:-1,group:'my-strike',damage:10}]})!;
    expect(s.rectangle).toEqual(rect);expect(s.geometryOwner).toBe('window-rectangle');
    expect(s.facingMultiplier).toBe(-1);expect(s.strike).toBe('my-strike');expect(s.resolvedMove.damage).toBe(35);
  });
  it('applies explicit authored capsules and their per-ID power',()=>{
    const cap={id:99,damage:10,capsule:{start:{x:1,y:2},end:{x:3,y:4},radius:1}};
    const s=selectLinkSpinContact({...state,damageMultiplier:1.6},{...stock,damage:8,collisionHits:[cap]})!;
    expect(s.collisionHits[0]!.damage).toBe(16);expect(s.collisionHits[0]!.capsule).toEqual(cap.capsule);
  });
});
