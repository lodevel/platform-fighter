import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { buildPikachuNormalMove, pikachuNormalFrame } from './pikachuNormalMoves';
import { pikachuDownAirPose } from './pikachuDownAirPose';
import { CHARACTER_LABEL } from './Character';
import { spawnHitbox } from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

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

/** Source values and real contact for the authored head projection. */
describe('Pikachu down-air captured-head projection', () => {
  it('retains early spike/late payload and all active/clear boundaries', () => {
    for (let game=14;game<=26;game++) {
      const hit=pikachuNormalFrame('down-air',game-1,pikachuDownAirPose).collisionHits[0]!;
      expect(hit.damage).toBe(game<16?13:12);
      expect(hit.capsule.radius).toBe(game<16?27.5:28.5);
      expect(hit.knockback?.reference).toMatchObject({angle:game<16?270:361,base:game<16?16:20,growth:game<16?86:84});
    }
    for(const elapsed of [0,12,26,46]) expect(pikachuNormalFrame('down-air',elapsed,pikachuDownAirPose).collisionHits).toEqual([]);
  });
  it('rejects unreviewed clocks and source anchors', () => {
    const row=PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirLw'][0]!;
    for(const game of [13,27,14.5,NaN])expect(()=>pikachuDownAirPose(row,game)).toThrow();
    expect(()=>pikachuDownAirPose({...row},14)).toThrow('Unsupported');
    expect(()=>pikachuDownAirPose(PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirHi'][0]!,14)).toThrow('Unsupported');
  });
  for(let game=14;game<=26;game++)for(const facing of [1,-1] as const) {
    it(`delivers centre/edge contact and misses beyond head reach game${game}/facing${facing}`,()=>{
      const source=pikachuNormalFrame('down-air',game-1,pikachuDownAirPose),hit=source.collisionHits[0]!,cap=hit.capsule;
      for(const [distance,confirmed] of [[0,true],[cap.radius+.25,true],[cap.radius+1,false]] as const) {
        const {engine,scene}=world();const target=Bodies.rectangle((cap.start.x+distance)*facing,cap.start.y,1,1,{isStatic:true,isSensor:true,label:CHARACTER_LABEL,plugin:{characterId:'probe'},collisionFilter:{category:COLLISION_CATEGORIES.CHARACTER}});
        Composite.add(engine.world,target);
        const move=buildPikachuNormalMove('down-air',pikachuDownAirPose);
        const sensor=spawnHitbox(scene as unknown as PhysicsHost,{id:'fixture',bodyId:999,position:{x:0,y:0}},{...move,collisionHits:source.collisionHits},facing);
        const contacts:{damage:number;region?:number}[]=[];
        const handler=new HitboxDamageHandler((_target,h,context)=>{contacts.push({damage:h.damage,region:context.collisionHitId});return{confirmed:true};});
        handler.registerPlayer(1,target);handler.setGroundedLookup(()=>false);handler.setHurtboxLookup(()=>[{id:'probe',offsetX:0,offsetY:0,width:1,height:1}]);
        for(let i=0;i<3;i++){Engine.update(engine,1000/60);handler.sampleHurtboxContacts([sensor]);}
        expect(contacts).toEqual(confirmed?[{damage:game<16?13:12,region:0}]:[]);
        Engine.clear(engine);Composite.clear(engine.world,false);
      }
    });
  }
});
