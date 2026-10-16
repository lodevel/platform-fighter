import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { buildPikachuNormalMove, pikachuNormalFrame } from './pikachuNormalMoves';
import { pikachuUpTiltPose } from './pikachuUpTiltPose';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { spawnHitbox } from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function world() {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { remove(body: any) { Composite.remove(engine.world, body); },
    on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); } } } };
  return { engine, scene };
}

/** Checks authored 2D geometry execution; art/native parity is separate. */
describe('Pikachu up-tilt captured-tail projection', () => {
  it('preserves source damage/radius/launch across all7active steps and keeps clear boundaries', () => {
    for (let game=7;game<=13;game++) {
      const hits=pikachuNormalFrame('up-tilt',game-1,pikachuUpTiltPose).collisionHits;
      expect(hits.map(h=>h.capsule.radius)).toEqual([10,19,17.5]);
      expect(hits.every(h=>h.damage===5)).toBe(true);
      expect(hits.map(h=>h.knockback?.reference?.angle)).toEqual([105,105,110]);
      expect(hits.map(h=>h.knockback?.reference?.base)).toEqual([40,45,45]);
    }
    expect(pikachuNormalFrame('up-tilt',5,pikachuUpTiltPose).collisionHits).toEqual([]);
    expect(pikachuNormalFrame('up-tilt',13,pikachuUpTiltPose).collisionHits).toEqual([]);
  });
  it('rejects invalid samples and unrelated source regions instead of supplying a generic tail', () => {
    const row=PIKACHU_NATIVE_ATTACKS['pikachu/AttackHi3'][0]!;
    for(const f of [6,14,7.5,NaN])expect(()=>pikachuUpTiltPose(row,f)).toThrow();
    expect(()=>pikachuUpTiltPose({...row},7)).toThrow('Unsupported');
    expect(()=>pikachuUpTiltPose(PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirHi'][0]!,7)).toThrow('Unsupported');
  });
  for(let game=7;game<=13;game++)for(const facing of [1,-1] as const) {
    it(`contacts three moving tail anchors and misses beyond their envelope game${game}/facing${facing}`,()=>{
      const source=pikachuNormalFrame('up-tilt',game-1,pikachuUpTiltPose);
      const maxX=Math.max(...source.collisionHits.map(h=>h.capsule.start.x+h.capsule.radius));
      const points=[...source.collisionHits.map(h=>({x:h.capsule.start.x,y:h.capsule.start.y,expected:true})),{x:maxX+2,y:0,expected:false}];
      for(const point of points){
        const {engine,scene}=world();
        const target=Bodies.rectangle(point.x*facing,point.y,1,1,{isStatic:true,isSensor:true,label:CHARACTER_LABEL,
          plugin:{characterId:'probe'},collisionFilter:{category:COLLISION_CATEGORIES.CHARACTER}});
        Composite.add(engine.world,target);
        const move=buildPikachuNormalMove('up-tilt',pikachuUpTiltPose);
        const sensor=spawnHitbox(scene as unknown as PhysicsHost,{id:'fixture',bodyId:999,position:{x:0,y:0}},
          {...move,collisionHits:source.collisionHits},facing);
        const hits:number[]=[];const handler=new HitboxDamageHandler((_target,hit)=>{hits.push(hit.damage);return{confirmed:true};});
        handler.registerPlayer(1,target);handler.setGroundedLookup(()=>true);
        handler.setHurtboxLookup(()=>[{id:'probe',offsetX:0,offsetY:0,width:1,height:1}]);
        for(let i=0;i<3;i++){Engine.update(engine,1000/60);handler.sampleHurtboxContacts([sensor]);}
        expect(hits).toEqual(point.expected?[5]:[]);
        Engine.clear(engine);Composite.clear(engine.world,false);
      }
    });
  }
  it.each([1,-1] as const)('routes actual grounded vertical input and freezes the changing tail clock facing%s',facing=>{
    const {engine,scene}=world();engine.gravity.y=1;
    const actor=new Character(scene,{id:'donkeykong',spawnX:0,spawnY:0,width:40,height:50});
    const up=buildPikachuNormalMove('up-tilt',pikachuUpTiltPose),down=buildPikachuNormalMove('down-tilt');
    registerFighterAttack(actor,up);registerFighterAttack(actor,down);actor.setUpTilt(up.id);actor.setDownTilt(down.id);
    const floor=Bodies.rectangle(0,35,2000,20,{isStatic:true,label:PLATFORM_LABELS.solid,
      collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}});Composite.add(engine.world,floor);
    const step=(input:CharacterInput=neutral)=>{actor.applyInput(input);stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,
      deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});};
    for(let i=0;i<12;i++)step();actor.setFacing(facing);step({...neutral,moveY:-1,attack:true});
    expect(actor.getActiveAttack()?.move.id).toBe(up.id);
    for(let i=0;i<7;i++)step();
    const elapsed=actor.getActiveAttack()!.framesElapsed,regions=JSON.stringify(actor.getActiveAttack()!.hitboxBody!.plugin.collisionHits);
    actor.armAttackerHitlag(3);
    for(let i=0;i<3;i++){step();expect(actor.getActiveAttack()!.framesElapsed).toBe(elapsed);expect(JSON.stringify(actor.getActiveAttack()!.hitboxBody!.plugin.collisionHits)).toBe(regions);}
    step();expect(actor.getActiveAttack()!.framesElapsed).toBe(elapsed+1);
    while(actor.getActiveAttack())step();step({...neutral,moveY:1,attack:true});
    expect(actor.getActiveAttack()?.move.id).toBe(down.id);
    actor.destroy();Engine.clear(engine);Composite.clear(engine.world,false);
  });
});
