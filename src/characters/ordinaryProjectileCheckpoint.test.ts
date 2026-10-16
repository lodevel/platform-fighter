import { describe, expect, it } from 'vitest';
import { parseOrdinaryProjectileCheckpoint } from './ordinaryProjectileCheckpoint';

/** Independent restore-boundary fixtures; prepared only until final stage. */
function row() { return {
  id:0,attackInstanceKey:'birth-0-4-10-0',ownerSlotIndex:1,creatorPlayerIndex:0,creatorGeneration:4,bornFrame:10,
  moveId:'item.rayGun.shot',facing:-1,visualFacing:1,damage:7,knockback:{x:3,y:-2,scaling:.2},
  hitlagMultiplier:null,sdiMultiplier:0,reflectable:true,absorbable:false,x:95,y:25,vx:-12,vy:0,
  width:12,height:4,remainingLife:{kind:'unbounded'},spawnedThisFrameByMove:'item.rayGun.shot',ignoreStaleMoves:true,
  visualRecipe:{kind:'item-shot',visual:'laser'},visualTransform:{angle:0,scaleX:1,scaleY:1,visible:true},
  boomerang:null,
}; }
function snapshot(r: unknown= row()) { return {schema:'ordinary-world-projectiles/1',frame:14,nextProjectileId:1,projectileSpawnLatch:['0:move'],rows:[r]}; }
describe('ordinary projectile checkpoint boundary',()=>{
  it('preserves reflected attribution separately from creator and actual renderer facing',()=>{
    const parsed=parseOrdinaryProjectileCheckpoint(JSON.parse(JSON.stringify(snapshot())));
    expect(parsed.rows[0]).toMatchObject({ownerSlotIndex:1,creatorPlayerIndex:0,creatorGeneration:4,facing:-1,visualFacing:1,
      remainingLife:{kind:'unbounded'},reflectable:true,absorbable:false,sdiMultiplier:0});
    expect(Object.isFrozen(parsed.rows[0])).toBe(true);
  });
  it('preserves finite terminal0 and cannot conceal Infinity as a JSON-null finite life',()=>{
    const r={...row(),remainingLife:{kind:'finite',frames:0}};
    expect(parseOrdinaryProjectileCheckpoint(snapshot(r)).rows[0]!.remainingLife).toEqual({kind:'finite',frames:0});
    for(const life of [{kind:'finite',frames:null},{kind:'finite',frames:Infinity},{kind:'unbounded',frames:null}])
      expect(()=>parseOrdinaryProjectileCheckpoint(snapshot({...row(),remainingLife:life}))).toThrow();
  });
  it('rejects duplicate ID/instance, future birth, invalid dimensions and unclosed renderer data',()=>{
    const s=snapshot();
    expect(()=>parseOrdinaryProjectileCheckpoint({...s,rows:[row(),row()]})).toThrow();
    expect(()=>parseOrdinaryProjectileCheckpoint({...s,nextProjectileId:2,rows:[row(),{...row(),id:1}]})).toThrow();
    for(const r of [{...row(),bornFrame:15},{...row(),id:1},{...row(),width:0},{...row(),vx:NaN},
      {...row(),visualRecipe:{kind:'item-shot',visual:'unknown'}},{...row(),visualTransform:{...row().visualTransform,textureKey:'borrowed'}}])
      expect(()=>parseOrdinaryProjectileCheckpoint(snapshot(r))).toThrow();
  });
  it('retains actual generic Boomerang hit targets and return/late packets without creating a Set or resetting age',()=>{
    const r={...row(),visualRecipe:{kind:'boomerang'},remainingLife:{kind:'finite',frames:32},boomerang:{
      age:25,returning:true,outboundFrames:20,returnSpeed:6,returnDamage:3,
      returnKnockback:{x:1,y:-1,scaling:0},lateOutbound:{startFrame:10,damage:4,knockback:{x:2,y:-1,scaling:.1}},hitTargets:[0,2]}};
    const parsed=parseOrdinaryProjectileCheckpoint(snapshot(r));
    expect(parsed.rows[0]!.boomerang).toMatchObject({age:25,returning:true,hitTargets:[0,2],returnDamage:3});
    expect(()=>parseOrdinaryProjectileCheckpoint(snapshot({...r,boomerang:{...r.boomerang,hitTargets:[2,2]}}))).toThrow();
    expect(()=>parseOrdinaryProjectileCheckpoint(snapshot({...r,visualRecipe:{kind:'item-shot',visual:'star'}}))).toThrow();
  });
});
