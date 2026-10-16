import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {spawnGrabHitbox,type AttackCollisionHit} from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import {DonkeyKongCatchCollisionPoseConsumer,applyDonkeyKongPairedCatchGeometry,readDonkeyKongCatchPose,
  type DonkeyKongCatchCollisionPoseRow} from './donkeykongCatchCollisionPose';

const require=createRequire(import.meta.url),Bodies=require('../physics/matter/source/lib/factory/Bodies.js'),Body=require('../physics/matter/source/lib/body/Body.js');
const scene={matter:{body:Body,add:{rectangle:Bodies.rectangle}}} as unknown as PhysicsHost;
const source={id:'donkeykong.catch-fixture',hitbox:{offsetX:30,offsetY:7,width:50,height:20},collisionHits:[
 {id:0,situation:'ground' as const,targetCategory:'fighter' as const,capsule:{start:{x:10,y:7},end:{x:50,y:7},radius:6}},
 {id:1,situation:'air' as const,capsule:{start:{x:12,y:7},end:{x:55,y:7},radius:4}},
] satisfies readonly AttackCollisionHit[]};
const regions=(negative=false)=>[0,1].map(id=>({id,capsule:{start:{x:(negative?-1:1)*(100+id*2),y:-5},end:{x:(negative?-1:1)*(120+id*2),y:0},radius:8}}));
const row=(negative=false):DonkeyKongCatchCollisionPoseRow=>({artFrameIndex:1,nativeSample:8,regions:regions(negative)});
const select=(rows:readonly DonkeyKongCatchCollisionPoseRow[]|undefined,facing:1|-1=1)=>readDonkeyKongCatchPose({sheet:'grab',sourceGameplayAge:7,facing,rows,drawing:{artFrameIndex:1,nativeSample:8}});

describe('optional DK paired CATCH metadata validation; source activity remains authoritative',()=>{
 it('keeps explicit malformed-row IDs diagnostic instead of accepting a capsule',()=>{
  const bad={...row(),regions:[{id:0,capsule:{start:{x:NaN,y:0},end:{x:1,y:0},radius:8}}]};
  expect(select([bad])).toMatchObject({optedIn:true,pose:null,fallbackReason:'invalid-capsule',providedRegionIds:[0]});
 });
 it.each([
  {name:'absent',rows:undefined,reason:'missing-clip-metadata',opted:false},
  {name:'unmatched',rows:[{...row(),artFrameIndex:0}],reason:'missing-pose-row',opted:true},
  {name:'empty active',rows:[{...row(),regions:[]}],reason:'empty-active-row',opted:true},
  {name:'sample mismatch',rows:[{...row(),nativeSample:9}],reason:'paired-sample-mismatch',opted:true},
  {name:'duplicate row',rows:[row(),row()],reason:'duplicate-pose-row',opted:true},
  {name:'duplicate region',rows:[{...row(),regions:[regions()[0]!,regions()[0]!]}],reason:'invalid-capsule',opted:true},
  {name:'overflowing finite radius',rows:[{...row(),regions:[{...regions()[0]!,capsule:{...regions()[0]!.capsule,radius:Number.MAX_VALUE}}]}],reason:'invalid-capsule',opted:true},
  {name:'negative radius',rows:[{...row(),regions:[{...regions()[0]!,capsule:{...regions()[0]!.capsule,radius:-1}}]}],reason:'invalid-capsule',opted:true},
 ])('$name falls back without inventing catch suppression',({rows,reason,opted})=>{
  expect(select(rows)).toMatchObject({optedIn:opted,pose:null,fallbackReason:reason});
 });
 it('reports unavailable paired receiving/drawing instead of selecting catch independently',()=>{
  expect(readDonkeyKongCatchPose({sheet:'grab',sourceGameplayAge:7,facing:1,rows:[row()],drawing:null})).toMatchObject({pose:null,fallbackReason:'paired-drawing-unavailable'});
 });
 it('rejects a valid capsule row with the wrong authoritative source ID set',()=>{
  const pose=select([{...row(),regions:[regions()[0]!]}]).pose!;
  expect(applyDonkeyKongPairedCatchGeometry(source.collisionHits,pose,1)).toBeNull();
 });
});

describe('one real Matter CATCH sensor owns source geometry and solved root',()=>{
 it.each([1,-1] as const)('pivot D*A conversion mirrors exactly once actor face%s',actorFacing=>{
  const sensor=spawnGrabHitbox(scene,{id:'donkeykong',bodyId:42,position:{x:600,y:300}},source,actorFacing);
  const consumer=new DonkeyKongCatchCollisionPoseConsumer(),id=sensor.id;
  const selection=select([row(true)],(-actorFacing) as 1|-1);
  const result=consumer.sync(scene,sensor,source,{x:650,y:310},selection);
  expect(sensor.id).toBe(id);expect(sensor.position.x).toBeCloseTo(650+111*actorFacing);
  expect(sensor.position.y).toBeCloseTo(307.5);expect(sensor.bounds.max.x-sensor.bounds.min.x).toBeCloseTo(38);
  expect(result).toMatchObject({ownerBodyId:42,reason:null,sourceGeometryRestored:false,sourceRegionIds:[0,1]});
  for(let i=0;i<2;i++){
   const {capsule:changed,...rules}=sensor.plugin.collisionHits[i];
   const {capsule:original,...sourceRules}=source.collisionHits[i]!;
   expect(rules).toEqual(sourceRules);expect(changed).not.toEqual(original);expect(changed.start.x).toBe(100+i*2);
  }
  expect(sensor.plugin.ownerAnchoredContact).toBe(true);expect(sensor.plugin.postPhysicsContactOnly).toBe(true);
 });
 it.each([1,-1] as const)('restores source after override while fallback continues to track owner face%s',facing=>{
  const sensor=spawnGrabHitbox(scene,{id:'donkeykong',position:{x:600,y:300}},source,facing),original=sensor.plugin.collisionHits;
  const consumer=new DonkeyKongCatchCollisionPoseConsumer();consumer.sync(scene,sensor,source,{x:600,y:300},select([row()],facing));
  const result=consumer.sync(scene,sensor,source,{x:700,y:350},select([{...row(),regions:[]}],facing));
  expect(sensor.plugin.collisionHits).toBe(original);expect(sensor.position.x).toBeCloseTo(700+31.5*facing);expect(sensor.position.y).toBe(357);
  expect(sensor.bounds.max.x-sensor.bounds.min.x).toBeCloseTo(55);expect(result).toMatchObject({reason:'empty-active-row',sourceGeometryRestored:true});
  expect(sensor.plugin.ownerAnchoredContact).toBe(true);expect(sensor.plugin.postPhysicsContactOnly).toBe(true);
  consumer.sync(scene,sensor,source,{x:750,y:360},select(undefined,facing));
  expect(sensor.position.x).toBeCloseTo(750+31.5*facing);expect(sensor.plugin.collisionHits).toBe(original);
 });
 it('a selected wrong ID set restores complete source rules',()=>{
  const sensor=spawnGrabHitbox(scene,{id:'donkeykong',position:{x:0,y:0}},source,1),original=sensor.plugin.collisionHits;
  const consumer=new DonkeyKongCatchCollisionPoseConsumer();
  expect(consumer.sync(scene,sensor,source,{x:20,y:0},select([{...row(),regions:[regions()[0]!]}]))).toMatchObject({reason:'active-id-set-mismatch',providedRegionIds:[0],sourceGeometryRestored:true});
  expect(sensor.plugin.collisionHits).toBe(original);
 });
 it('unopted source sensors remain untouched and forgotten owners do not carry state into another sensor',()=>{
  const consumer=new DonkeyKongCatchCollisionPoseConsumer();
  const sensor=spawnGrabHitbox(scene,{id:'donkeykong',position:{x:0,y:0}},source,1),before=structuredClone(sensor.bounds),position={...sensor.position};
  expect(consumer.sync(scene,sensor,source,{x:100,y:200},select(undefined))).toBeNull();
  expect(sensor.bounds).toEqual(before);expect(sensor.position).toEqual(position);expect(sensor.plugin.ownerAnchoredContact).toBeUndefined();
  consumer.sync(scene,sensor,source,{x:0,y:0},select([row()]));expect(consumer.owns(sensor)).toBe(true);consumer.forget(sensor);expect(consumer.owns(sensor)).toBe(false);
  const next=spawnGrabHitbox(scene,{id:'donkeykong',position:{x:300,y:0}},source,1);
  expect(consumer.sync(scene,next,source,{x:400,y:0},select(undefined))).toBeNull();expect(next.position.x).toBe(331.5);
 });
});
