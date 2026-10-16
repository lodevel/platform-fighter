import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { spawnHitbox, type AttackMove } from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { DonkeyKongAttackCollisionPoseConsumer, type DonkeyKongAttackCollisionPose } from './donkeykongAttackCollisionPose';

const require=createRequire(import.meta.url);
const Bodies=require('../physics/matter/source/lib/factory/Bodies.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const scene={matter:{body:Body,add:{rectangle:Bodies.rectangle}}} as unknown as PhysicsHost;
const move:AttackMove={id:'donkeykong.fixture',type:'jab',damage:8,knockback:{x:1,y:-1,scaling:0},
  startupFrames:4,activeFrames:2,recoveryFrames:10,cooldownFrames:0,
  hitbox:{offsetX:20,offsetY:0,width:4,height:4},collisionHits:[{id:0,
    capsule:{start:{x:20,y:0},end:{x:20,y:0},radius:2},damage:8,direct:false,tripChance:.4,shieldSetoffMultiplier:.58,nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false}]};
const pose=(facing:1|-1):DonkeyKongAttackCollisionPose=>({sheet:'review_pilot_fixture',artFrameIndex:0,nativeSample:5,gameplayAge:4,facing,
  collisionHits:[{id:0,capsule:{start:{x:80,y:0},end:{x:90,y:0},radius:3}}]});

describe('paired attack geometry boundary on a real Matter sensor',()=>{
  it.each([1,-1] as const)('restores the fixed source sensor after one review age facing%s',facing=>{
    const sensor=spawnHitbox(scene,{id:'donkeykong',position:{x:600,y:300}},move,facing);
    const original={position:{...sensor.position},bounds:structuredClone(sensor.bounds),hits:sensor.plugin.collisionHits};
    const consumer=new DonkeyKongAttackCollisionPoseConsumer();
    consumer.sync(scene,sensor,move,{x:600,y:300},pose(facing));
    expect(sensor.position.x).toBeCloseTo(600+85*facing);
    expect(sensor.bounds.max.x-sensor.bounds.min.x).toBeCloseTo(16);
    const {capsule:ignored,...rules}=sensor.plugin.collisionHits[0];
    const {capsule:sourceCapsule,...sourceRules}=original.hits[0];
    expect(rules).toEqual(sourceRules);expect(ignored).not.toEqual(sourceCapsule);
    expect(sensor.plugin.postPhysicsContactOnly).toBe(true);
    consumer.sync(scene,sensor,move,{x:650,y:300},null);
    expect(sensor.position).toEqual(original.position);
    expect(sensor.bounds.min.x).toBeCloseTo(original.bounds.min.x);
    expect(sensor.bounds.max.x).toBeCloseTo(original.bounds.max.x);
    expect(sensor.plugin.collisionHits).toBe(original.hits);
    expect(sensor.plugin.ownerAnchoredContact).toBeUndefined();
    expect(sensor.plugin.postPhysicsContactOnly).toBeUndefined();
    expect(sensor.plugin.donkeykongCollisionPose).toBeUndefined();
  });
  it('preserves ordinary aerial tracking when a paired age retires',()=>{
    const aerial={...move,type:'aerial' as const};
    const sensor=spawnHitbox(scene,{id:'donkeykong',position:{x:600,y:300}},aerial,1);
    const consumer=new DonkeyKongAttackCollisionPoseConsumer();
    consumer.sync(scene,sensor,aerial,{x:600,y:300},pose(1));
    consumer.sync(scene,sensor,aerial,{x:650,y:310},null);
    expect(sensor.position).toEqual({x:670,y:310});
    expect(sensor.bounds.max.x-sensor.bounds.min.x).toBeCloseTo(4);
  });
  it('rejects a missing active source ID before changing the sensor',()=>{
    const sensor=spawnHitbox(scene,{id:'donkeykong',position:{x:600,y:300}},move,1);
    const before={position:{...sensor.position},bounds:structuredClone(sensor.bounds),hits:sensor.plugin.collisionHits};
    const consumer=new DonkeyKongAttackCollisionPoseConsumer();
    expect(()=>consumer.sync(scene,sensor,move,{x:600,y:300},{...pose(1),collisionHits:[]})).toThrow('ID0');
    expect(sensor.position).toEqual(before.position);expect(sensor.bounds).toEqual(before.bounds);
    expect(sensor.plugin.collisionHits).toBe(before.hits);
  });
});
