import {describe,it,expect} from 'vitest';
import {CRATE_DEFINITION,CRATE_THROW_PROFILE} from './Crate';
import {advanceNativeItemVelocity,itemAttackLaunchVelocity,nativeItemReleaseVelocity,nativeItemThrowHit,ultimateItemThrowProfile} from './nativeItemThrow';
import {HOME_RUN_BAT_DEFINITION} from './HomeRunBat';
import {FIGHTER_ITEM_PROFILES,getItemActionPlan,itemReleaseVelocity,DEFAULT_FIGHTER_ITEM_PROFILE} from './itemActions';
import {ITEM_DROP_RNG_STREAM,heldItemDropChance,rollHeldItemDrop} from './heldItemDrop';
import {Rng} from '../utils/Rng';
import {LINK_REMOTE_BOMB_ITEM_DEFINITION} from './LinkRemoteBombItem';
import {computeReferenceKnockback} from '../characters/referenceKnockback';

describe('source crate throw packet and kinetics',()=>{
  it('applies the item multiplier twice horizontally, once vertically, in either facing',()=>{
    // Independent forward-native3.4 at60deg, DK1.09, item.7,5px/unit.
    const raw={x:9.265,y:-16.04745073212565,power:1};
    const release=nativeItemReleaseVelocity(CRATE_THROW_PROFILE,raw);
    expect(release.x).toBeCloseTo(4.53985,10);
    expect(release.y).toBeCloseTo(-11.233215512487954,10);
    expect(release.power).toBe(1);
    expect(nativeItemReleaseVelocity(CRATE_THROW_PROFILE,{...raw,x:-raw.x}).x).toBeCloseTo(-4.53985,10);
  });
  it('caps down throws immediately and consumes the native vertical outer limit on upward launch',()=>{
    expect(nativeItemReleaseVelocity(CRATE_THROW_PROFILE,{x:30,y:30,power:1})).toEqual({x:12,y:11,power:1});
    expect(nativeItemReleaseVelocity(CRATE_THROW_PROFILE,{x:0,y:-26.16,power:1}).y).toBe(-12);
  });
  it('brakes to zero without reversing and preserves the source fall cap',()=>{
    expect(advanceNativeItemVelocity(CRATE_THROW_PROFILE,{vx:-.005,vy:10.9})).toEqual({vx:-0,vy:11});
    expect(advanceNativeItemVelocity(CRATE_THROW_PROFILE,{vx:2,vy:-3})).toEqual({vx:1.9875,vy:-2.4});
  });
  it('uses native-unit impact speed, source packet flags and reference knockback',()=>{
    const hit=nativeItemThrowHit(CRATE_THROW_PROFILE,{vx:-3,vy:4});
    expect(hit.damage).toBeCloseTo(16.2,10);
    expect(hit).toMatchObject({facing:-1,direct:false,hitlagMultiplier:.4000000059604645,sdiMultiplier:1,referenceKnockbackMultiplier:.8,
      knockback:{reference:{base:30,growth:80,angle:361,fixed:0}}});
    // The throw power modifies base damage, not its additive or speed terms.
    expect(nativeItemThrowHit(CRATE_THROW_PROFILE,{vx:3,vy:4},.5).damage).toBeCloseTo(8.7,10);
  });
  it('declares heavy pickup bounds separately from its attack sphere and permits no item-use override',()=>{
    expect(CRATE_DEFINITION.heavy).toBe(true);
    expect(CRATE_DEFINITION.pickupBounds).toEqual({offsetX:0,offsetY:-37.5,width:89,height:75});
    expect(CRATE_DEFINITION.uses).toBeUndefined();
    expect(CRATE_DEFINITION.throwProfile.attackRadius).toBeCloseTo(9.12,5);
  });
  it('retains explicit force false/true and absence independently of the known native attribute',()=>{
    const ordinary=nativeItemThrowHit(CRATE_THROW_PROFILE,{vx:0,vy:0});
    expect(ordinary.nativeCollisionAttribute).toBe('collision_attr_normal');
    expect(ordinary).not.toHaveProperty('nativeForceReaction');
    for(const nativeForceReaction of [false,true]){
      const hit=nativeItemThrowHit({...CRATE_THROW_PROFILE,nativeForceReaction},{vx:0,vy:0});
      expect(hit.nativeForceReaction).toBe(nativeForceReaction);
      expect(hit.damage).toBe(ordinary.damage);
      expect(hit.knockback).toEqual(ordinary.knockback);
    }
  });
});

/** universal-rules.json dropToss.damageFormula / groundedDropHalved / knockbackMultiplier (SmashWiki Item_throw). */
describe('Ultimate thrown-item damage: d - 0.4 + speed*3, ground drop halves d, knockback x0.8',()=>{
  const standard={...DEFAULT_FIGHTER_ITEM_PROFILE,tossSpeedMultiplier:1};
  const hitFor=(profile:ReturnType<typeof ultimateItemThrowProfile>,action:Parameters<typeof getItemActionPlan>[0])=>{
    const release=nativeItemReleaseVelocity(profile,itemReleaseVelocity(getItemActionPlan(action,standard),1,standard));
    return nativeItemThrowHit(profile,{vx:release.x,vy:release.y},release.power);
  };
  it('Capsule base 8: a standard-toss normal forward throw deals 15.4 (spec example)',()=>{
    const capsuleLike=ultimateItemThrowProfile({damage:8});
    expect(hitFor(capsuleLike,'throw-ground-forward-ordinary').damage).toBeCloseTo(15.4,10);
    expect(capsuleLike.referenceKnockbackMultiplier).toBe(.8);
  });
  it('Home-Run Bat: SmashWiki Ultimate thrown table (drop 11.9, dash 21.8, forward smash 22.5)',()=>{
    const bat=HOME_RUN_BAT_DEFINITION.throwProfile;
    expect(hitFor(bat,'ground-drop').damage).toBeCloseTo(11.9,10);
    expect(hitFor(bat,'dash-throw').damage).toBeCloseTo(21.8,10);
    expect(hitFor(bat,'throw-ground-forward-strong').damage).toBeCloseTo(22.5,1);
    expect(hitFor(bat,'throw-ground-forward-ordinary').damage).toBeCloseTo(19.3,0);
    expect(nativeItemThrowHit(bat,{vx:0,vy:0}).referenceKnockbackMultiplier).toBe(.8);
  });
  it('a weaker tosser deals less: Pikachu (0.93) vs DK (1.09) forward smash throws of the same item',()=>{
    const bat=HOME_RUN_BAT_DEFINITION.throwProfile;
    const damage=(id:'donkeykong'|'pikachu')=>{const f=FIGHTER_ITEM_PROFILES[id]!;
      const v=nativeItemReleaseVelocity(bat,itemReleaseVelocity(getItemActionPlan('throw-ground-forward-strong',f),1,f));
      return nativeItemThrowHit(bat,{vx:v.x,vy:v.y},v.power).damage;};
    expect(damage('donkeykong')).toBeCloseTo(12-.4+3.64*1.09*3,8);
    expect(damage('pikachu')).toBeCloseTo(12-.4+3.64*.93*3,8);
  });
});

/** universal-rules.json dropToss.dropChanceWhenHit: chance = ceil(base damage) / 70, on its own named stream. */
describe('held item drop on hit',()=>{
  it('uses ceil(base damage)/70',()=>{
    expect(heldItemDropChance(7)).toBeCloseTo(7/70,12);
    expect(heldItemDropChance(7.2)).toBeCloseTo(8/70,12);
    expect(heldItemDropChance(0)).toBe(0);
    expect(heldItemDropChance(200)).toBe(1);
  });
  it('rolls once on the item-drop stream and never touches another stream',()=>{
    expect(ITEM_DROP_RNG_STREAM).toBe('item-drop');
    const a=new Rng(42),b=new Rng(42);
    const draws=Array.from({length:200},()=>rollHeldItemDrop(a,14));
    const expected=Array.from({length:200},()=>b.next()<14/70);
    expect(draws).toEqual(expected);
    expect(draws.filter(Boolean).length).toBeGreaterThan(20);
    expect(draws.filter(Boolean).length).toBeLessThan(70);
  });
});

describe('a free item launched by an attack',()=>{
  it("flies along the hit's own reference launch for a neutral airborne target, mirrored by the launch facing",()=>{
    expect(LINK_REMOTE_BOMB_ITEM_DEFINITION.launchedByAttacks).toBe(true);
    // Link jab hit 1 packet (SmashWiki Link_(SSBU)/Neutral_attack/Hit_1): 3%, 361, BKB 25, KBG 25.
    const reference={angle:361,base:25,growth:25,fixed:0};
    for(const facing of [1,-1] as const){
      const expected=computeReferenceKnockback(reference,0,3,100,facing,false).vector;
      const launched=itemAttackLaunchVelocity({damage:3,knockback:{x:0,y:0,scaling:0,reference},facing});
      expect(launched).toEqual({vx:expected.x,vy:expected.y});
      expect(Math.sign(launched.vx)).toBe(facing);
      expect(launched.vy).toBeLessThan(0);
      expect(Math.hypot(launched.vx,launched.vy)).toBeCloseTo((18*.25+25)*.03*5,10);
    }
  });
});
