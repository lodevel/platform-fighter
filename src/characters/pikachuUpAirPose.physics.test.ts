import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { buildPikachuNormalMove, pikachuNormalFrame } from './pikachuNormalMoves';
import { pikachuUpAirPose } from './pikachuUpAirPose';
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

/** Checks authored 2D geometry execution; art/native parity is separate. */
describe('Pikachu up-air captured-tail projection', () => {
  it('preserves source damage/radius/launch across all5active steps and keeps clear boundaries', () => {
    for (let game=4;game<=8;game++) {
      const hits=pikachuNormalFrame('up-air',game-1,pikachuUpAirPose).collisionHits;
      expect(hits.map(h=>h.capsule.radius)).toEqual([20,25,20]);
      expect(hits.map(h=>h.damage)).toEqual(game<7?[6,6,5]:[4,4,4]);
      expect(hits.map(h=>h.knockback?.reference?.angle)).toEqual(game<7?[68,68,68]:[55,55,55]);
      expect(hits.map(h=>h.knockback?.reference?.base)).toEqual(game<7?[50,50,50]:[40,40,40]);
    }
    expect(pikachuNormalFrame('up-air',2,pikachuUpAirPose).collisionHits).toEqual([]);
    expect(pikachuNormalFrame('up-air',8,pikachuUpAirPose).collisionHits).toEqual([]);
  });
  it('rejects invalid samples and unrelated source regions instead of supplying a generic tail', () => {
    const row=PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirHi'][0]!;
    for(const f of [3,9,4.5,NaN])expect(()=>pikachuUpAirPose(row,f)).toThrow();
    expect(()=>pikachuUpAirPose({...row},4)).toThrow('Unsupported');
    expect(()=>pikachuUpAirPose(PIKACHU_NATIVE_ATTACKS['pikachu/AttackHi3'][0]!,4)).toThrow('Unsupported');
  });
  for(let game=4;game<=8;game++)for(const facing of [1,-1] as const) {
    it(`contacts three moving tail anchors and misses beyond their envelope game${game}/facing${facing}`,()=>{
      const source=pikachuNormalFrame('up-air',game-1,pikachuUpAirPose);
      const maxX=Math.max(...source.collisionHits.map(h=>h.capsule.start.x+h.capsule.radius));
      // The tip centre overlaps the higher-priority middle region. Probe
      // centres for coverage and the exposed tip edge for its own5% payload.
      const tip=source.collisionHits[2]!.capsule, middle=source.collisionHits[1]!.capsule;
      const dx=tip.start.x-middle.start.x,dy=tip.start.y-middle.start.y,length=Math.hypot(dx,dy);
      const points=[...source.collisionHits.map(h=>({x:h.capsule.start.x,y:h.capsule.start.y})),
        {x:tip.start.x+dx/length*tip.radius*.9,y:tip.start.y+dy/length*tip.radius*.9}, {x:maxX+2,y:0}];
      for(const point of points){
        const expected=source.collisionHits.find(hit=>{
          const x=Math.max(Math.abs(point.x-hit.capsule.start.x)-.5,0);
          const y=Math.max(Math.abs(point.y-hit.capsule.start.y)-.5,0);
          return Math.hypot(x,y)<=hit.capsule.radius;
        });
        const {engine,scene}=world();
        const target=Bodies.rectangle(point.x*facing,point.y,1,1,{isStatic:true,isSensor:true,label:CHARACTER_LABEL,
          plugin:{characterId:'probe'},collisionFilter:{category:COLLISION_CATEGORIES.CHARACTER}});
        Composite.add(engine.world,target);
        const move=buildPikachuNormalMove('up-air',pikachuUpAirPose);
        const sensor=spawnHitbox(scene as unknown as PhysicsHost,{id:'fixture',bodyId:999,position:{x:0,y:0}},
          {...move,collisionHits:source.collisionHits},facing);
        const hits:{damage:number;region?:number}[]=[];const handler=new HitboxDamageHandler((_target,hit,context)=>{hits.push({damage:hit.damage,region:context.collisionHitId});return{confirmed:true};});
        handler.registerPlayer(1,target);handler.setGroundedLookup(()=>true);
        handler.setHurtboxLookup(()=>[{id:'probe',offsetX:0,offsetY:0,width:1,height:1}]);
        for(let i=0;i<3;i++){Engine.update(engine,1000/60);handler.sampleHurtboxContacts([sensor]);}
        expect(hits).toEqual(expected?[{damage:expected.damage,region:expected.id}]:[]);
        Engine.clear(engine);Composite.clear(engine.world,false);
      }
    });
  }
});
