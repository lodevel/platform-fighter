import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_NAIR, LINK_FAIR, LINK_BAIR, LINK_UAIR, LINK_DAIR, LINK_USMASH, LINK_DSMASH } from './Link';
import { CHARACTER_LABEL, type CharacterInput } from './Character';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function setup(grounded = false) {
  const engine = Engine.create();
  if (!grounded) engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const fighter = new Link(scene, { spawnX: 0, spawnY: 0, fallAccel: grounded ? 0.3 : 0 });
  const hits: Array<{ frame: number; damage: number; target: number; facing: number; y: number; angle?: number; instance?: object }> = [];
  const handler = new HitboxDamageHandler((target, hit, context) => {
    hits.push({ frame: fighter.getActiveAttack()?.framesElapsed ?? -1,
      damage: hit.damage, target, facing: hit.facing, y: hit.knockback.y, angle: hit.knockback.reference?.angle, instance: context.attackInstance });
  });
  handler.registerPlayer(0, fighter.body);
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const target = (index: number, x: number, y: number) => {
    const body = Bodies.rectangle(x, y, 10, 10, { isStatic: true, isSensor: true,
      label: CHARACTER_LABEL, plugin: { characterId: 'wolf' },
      collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
    Composite.add(engine.world, body); handler.registerPlayer(index, body); return body;
  };
  const step = (input: CharacterInput = neutral) => {
    fighter.applyInput(input); Engine.update(engine, 1000 / 60); fighter.applyPostPhysicsVelocityConstraints();
  };
  const frames = (n: number) => { for (let i = 0; i < n; i++) step(); };
  if (grounded) {
    Composite.add(engine.world, Bodies.rectangle(0, 48, 1600, 20, { isStatic: true,
      label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    frames(10);
  }
  return { fighter, engine, hits, target, step, frames, handler };
}

describe('Link normals with real Matter collision events', () => {
  it.each([
    [LINK_FAIR, 30, -3, [[15,8],[23,10]]],
    [LINK_BAIR, -28, -3, [[5,5],[14,7]]],
    [LINK_USMASH, 8, -32, [[9,4],[24,3],[40,11]]],
  ] as const)('%s connects its separate strikes and leaves harmless gaps', (move, x, y, contacts) => {
    const { fighter, target, hits, step } = setup();
    target(1,x,y); fighter.attemptAttack(move.id);
    const activeFrames: number[] = [];
    for (let i = 0; i < move.startupFrames + move.activeFrames + move.recoveryFrames; i++) {
      step();
      if (fighter.getActiveAttack()?.hitboxBody) activeFrames.push(fighter.getActiveAttack()!.framesElapsed);
    }
    expect(hits.map(h => [h.frame,h.damage])).toEqual(contacts);
    expect(new Set(hits.map(h => h.instance)).size).toBe(1);
    expect(hits[0]?.instance).toBeDefined();
    const windows = move.id === 'link.fair' ? [[15,17],[23,25]]
      : move.id === 'link.bair' ? [[5,8],[14,17]] : [[9,15],[24,30],[40,45]];
    expect(activeFrames).toEqual(windows.flatMap(([a,b]) => Array.from({ length:b!-a! },(_,i)=>a!+i)));
  });

  it.each([
    [LINK_NAIR, 0, -2, 8, 9, 6],
    [LINK_UAIR, 0, -35, 13, 15, 13],
    [LINK_DAIR, 0, 30, 19, 18, 15],
  ] as const)('%s late replacement cannot hit an already struck victim again', (move,x,y,late,earlyDamage,lateDamage) => {
    const { fighter,target,hits,frames,step } = setup();
    target(1,x,y); const newcomer = target(2,600,y);
    fighter.attemptAttack(move.id); frames(late-1);
    Body.setPosition(newcomer,{ x,y }); step(); frames(3);
    expect(hits.map(h=>[h.target,h.damage])).toEqual([[1,earlyDamage],[2,lateDamage]]);
    if (move.id === 'link.dair') expect(hits.map(h => h.angle)).toEqual([270,60]);
  });

  it('down smash swings in front, then behind, and launches outward', () => {
    const { fighter,target,hits,frames } = setup();
    target(1,45,14); target(2,-45,14);
    fighter.attemptAttack(LINK_DSMASH.id); frames(27);
    expect(hits.map(h=>[h.frame,h.target,h.damage,h.facing])).toEqual([[11,1,16,1],[23,2,11,-1]]);
  });

  it('left plus attack selects back air and keeps its facing while drifting backward', () => {
    const { fighter,target,hits,step } = setup();
    target(1,-30,-3);
    step({ ...neutral,moveX:-1,attack:true });
    expect(fighter.getActiveAttack()).toMatchObject({ move:{ id:'link.bair' }, facing:1 });
    for(let i=0;i<10;i++) {
      step({ ...neutral,moveX:-1 });
      expect(fighter.getFacing()).toBe(1);
      const a = fighter.getActiveAttack()!;
      if(a.hitboxBody) expect(a.hitboxBody.position.x).toBeLessThan(fighter.getPosition().x);
    }
    expect(hits[0]).toMatchObject({ target:1,damage:5,facing:-1 });
    expect(fighter.getPosition().x).toBeLessThan(-5);
  });

  it('early down air spikes an airborne opponent and lifts a grounded opponent', () => {
    const { fighter,target,hits,frames,handler } = setup();
    handler.setGroundedLookup(index => index === 2);
    target(1,-8,30); target(2,8,30);
    fighter.attemptAttack('link.dair'); frames(14);
    expect(hits.map(h=>[h.target,h.damage,h.angle]).sort()).toEqual([[1,18,270],[2,18,60]]);
  });

  it('a new nair can hit the same victim again after the first attack ends', () => {
    const { fighter,target,hits,frames } = setup();
    target(1,0,-2); fighter.attemptAttack(LINK_NAIR.id); frames(38);
    expect(fighter.attemptAttack(LINK_NAIR.id)).toBe(true); frames(10);
    expect(hits.map(h=>h.damage)).toEqual([9,9]);
  });

  it('a live hitbox stays fixed through hitlag in a world with gravity', () => {
    const { fighter,frames,step } = setup(true);
    fighter.attemptAttack('link.dsmash'); frames(23);
    const sensor = fighter.getActiveAttack()!.hitboxBody!;
    const before = { position: { ...sensor.position }, min:{ ...sensor.bounds.min }, max:{ ...sensor.bounds.max } };
    fighter.armAttackerHitlag(6);
    for(let i=0;i<5;i++) {
      step();
      expect(fighter.getActiveAttack()?.framesElapsed).toBe(23);
      expect({ position:sensor.position,min:sensor.bounds.min,max:sensor.bounds.max }).toEqual(before);
    }
  });

  it('a jab tap inside the SmashWiki continuation window (frames 10-35) advances at once', () => {
    const { fighter,step,frames } = setup(true);
    step({ ...neutral, attack:true }); frames(9);
    step({ ...neutral, attack:true });
    expect(fighter.getActiveAttack()?.move.id).toBe('link.jab2');
  });

  it('a jab tap made before the window opens is buffered and advances at the opening', () => {
    const { fighter,step,frames } = setup(true);
    step({ ...neutral, attack:true }); frames(2);
    step({ ...neutral, attack:true });
    expect(fighter.getActiveAttack()?.move.id).toBe('link.jab');
    frames(9);
    expect(fighter.getActiveAttack()?.move.id).toBe('link.jab2');
  });

  it.each([4,5,6])('tapping attack every %i frames chains jab 1-2-3', gap => {
    const { fighter,step } = setup(true);
    const seen: string[] = [];
    for (let frame = 0; frame < 60; frame++) {
      step({ ...neutral, attack: frame % gap === 0 });
      const id = fighter.getActiveAttack()?.move.id;
      if (id && seen.at(-1) !== id) seen.push(id);
    }
    expect(seen.slice(0, 3)).toEqual(['link.jab','link.jab2','link.jab3']);
  });

  it('one queued tap advances only one jab stage', () => {
    const { fighter,step,frames } = setup(true);
    step({ ...neutral, attack:true }); frames(5);
    step({ ...neutral, attack:true }); frames(12);
    expect(fighter.getActiveAttack()?.move.id).toBe('link.jab2');
  });

  const stepUntilSmash2 = (fighter: Link, step: (input?: CharacterInput) => void, limit: number) => {
    for (let i = 0; i < limit; i++) { step(); if (fighter.getActiveAttack()?.move.id === 'link.smash2') return i + 1; }
    return -1;
  };

  it.each(['attack', 'attackHeavy'] as const)('buffers an early optional slash with %s until the SmashWiki window (frames 23-36) opens', button => {
    const { fighter,step,frames } = setup(true);
    fighter.attemptAttack('link.smash'); frames(17);
    step({ ...neutral, [button]:true });
    expect(fighter.getActiveAttack()?.move.id).toBe('link.smash');
    const waited = stepUntilSmash2(fighter, step, 9);
    expect(waited).toBeGreaterThanOrEqual(3);
    expect(fighter.getActiveAttack()).toMatchObject({ framesElapsed:0, move:{ id:'link.smash2' } });
    frames(22);
    expect(fighter.getActiveAttack()?.move.id).toBe('link.smash2');
  });

  it('each jab stage shares one swing identity across victims and gets a fresh identity on reuse', () => {
    const { fighter, target, hits, step, frames } = setup(true);
    target(1, 30, -3); target(2, 34, -3);
    step({ ...neutral, attack: true });
    frames(10); step({ ...neutral, attack: true });
    expect(fighter.getActiveAttack()?.move.id).toBe('link.jab2');
    frames(8); step({ ...neutral, attack: true });
    expect(fighter.getActiveAttack()?.move.id).toBe('link.jab3');
    frames(7);
    expect(hits.map(hit => hit.damage)).toEqual([3, 3, 3, 3, 4, 4]);
    const stages = [hits.slice(0, 2), hits.slice(2, 4), hits.slice(4, 6)];
    for (const stage of stages) {
      expect(stage[0]!.instance).toBeDefined();
      expect(stage[1]!.instance).toBe(stage[0]!.instance);
      expect(new Set(stage.map(hit => hit.target))).toEqual(new Set([1, 2]));
    }
    expect(new Set(stages.map(stage => stage[0]!.instance)).size).toBe(3);
    while (fighter.getActiveAttack()) step();
    step({ ...neutral, attack: true }); frames(8);
    expect(hits).toHaveLength(8);
    expect(hits[6]!.instance).toBe(hits[7]!.instance);
    expect(stages.some(stage => stage[0]!.instance === hits[6]!.instance)).toBe(false);
  });

  it.each(['attack','attackHeavy'] as const)('forward smash accepts its optional second slash with %s', button => {
    const { fighter,step,frames } = setup(true);
    fighter.attemptAttack('link.smash'); frames(22);
    step({ ...neutral, [button]:true });
    expect(fighter.getActiveAttack()).toMatchObject({ framesElapsed:0, move:{ id:'link.smash2' } });
    frames(9);
    expect(fighter.getActiveAttack()?.hitboxBody?.plugin.damage).toBe(13);
  });

  it('holding attack does not automatically perform the optional slash', () => {
    const { fighter,step } = setup(true);
    fighter.attemptAttack('link.smash');
    for (let i=0;i<35;i++) step({ ...neutral, attack:true });
    expect(fighter.getActiveAttack()?.move.id).toBe('link.smash');
  });

  it.each([
    ['link.smash',0,16,8], ['link.usmash',-1,9,4], ['link.dsmash',1,11,3],
  ] as const)('%s tap and maximum charge preserve input-to-contact timing', (id,moveY,first,holdFrame) => {
    const run = (charge: boolean) => {
      const { fighter,step } = setup(true);
      for (let frame=0;frame<100;frame++) {
        step({ ...neutral, moveY, attackHeavy: charge ? frame < holdFrame + 63 : frame===0 });
        const a = fighter.getActiveAttack();
        if (a?.hitboxBody) return { id:a.move.id, frame, charge:a.chargeHeldFrames,
          damage:a.hitboxBody.plugin.damage };
      }
      throw new Error(`No hitbox for ${id}`);
    };
    expect(run(false)).toMatchObject({ id,frame:first,charge:0 });
    expect(run(true)).toMatchObject({ id,frame:first+61,charge:60 });
    const { fighter,step } = setup(true);
    for(let frame=0;frame<=holdFrame;frame++) step({ ...neutral,moveY,attackHeavy:true });
    expect(fighter.getAnimationActionState().chargeHeldFrames).toBe(0);
  });

  it('charged forward smash carries its charge into the optional follow-up', () => {
    const { fighter,step } = setup(true);
    step({ ...neutral,attackHeavy:true });
    for(let i=0;i<70;i++) step({ ...neutral,attackHeavy:true });
    while((fighter.getActiveAttack()?.framesElapsed ?? 0)<20) step();
    step({ ...neutral,attack:true });
    expect(stepUntilSmash2(fighter, step, 9)).toBeGreaterThan(0);
    expect(fighter.getActiveAttack()).toMatchObject({ chargeHeldFrames:60, move:{ id:'link.smash2' } });
    for(let i=0;i<9;i++) step();
    expect(fighter.getActiveAttack()?.hitboxBody?.plugin.damage).toBeCloseTo(18.2);
  });

  it('the forward-smash follow-up closes after its input window', () => {
    const { fighter,step,frames } = setup(true);
    fighter.attemptAttack('link.smash'); frames(37);
    step({ ...neutral,attack:true });
    expect(stepUntilSmash2(fighter, step, 8)).toBe(-1);
    expect(fighter.getActiveAttack()?.move.id).toBe('link.smash');
  });
});
