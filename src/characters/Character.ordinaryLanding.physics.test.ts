import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { CharacterInput, CharacterOptions } from './Character';
import './attackRegistration';
import { LINK_NAIR, LINK_JAB as LINK_JAB1, LINK_SMASH, LINK_NEUTRAL_SPECIAL , Link } from './Link';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

function world(options: Partial<CharacterOptions> = {}) {
  const engine = Engine.create();
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const ch = new Link(scene, { spawnX: 0, spawnY: 0, ...options });
  ch.registerAttack(LINK_JAB1);
  ch.registerAttack(LINK_NAIR);
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    Engine.update(engine, 1000 / 60);
    ch.applyPostPhysicsVelocityConstraints();
  };
  const land = (terminalSteps = 0) => {
    for (let frame = 0; frame < terminalSteps; frame++) {
      Body.setVelocity(ch.body, { x: 0, y: ch.getTuning().maxFallSpeed });
      step();
    }
    const pos = ch.getPosition();
    const floor = Bodies.rectangle(pos.x, pos.y + ch.getTuning().height / 2 + 11, 2000, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    });
    Composite.add(engine.world, floor);
    Body.setVelocity(ch.body, { x: 0, y: terminalSteps ? ch.getTuning().maxFallSpeed : 2 });
    step();
    expect(ch.isGrounded()).toBe(true);
    return floor;
  };
  const recovery = () => ch.getAnimationActionState().landingRecoveryRemaining;
  return { ch, engine, step, land, recovery };
}

describe('ordinary landing through real Matter contact', () => {
  it.each([{ terminalSteps: 0, lag: 2 }, { terminalSteps: 4, lag: 5 }])(
    'Link commits exactly $lag input steps after $terminalSteps terminal fall steps', ({ terminalSteps, lag }) => {
      const { ch, step, land, recovery } = world();
      land(terminalSteps);
      for (let locked = 1; locked <= lag; locked++) {
        step({ ...NEUTRAL, moveX: 1, shield: true, dropThrough: true });
        expect(recovery()).toBe(lag - locked + 1);
        expect(ch.getVelocity().x).toBe(0);
        expect(ch.isShielding()).toBe(false);
        expect(ch.isInDropThroughWindow()).toBe(false);
        expect(ch.canAttack()).toBe(false);
      }
      step({ ...NEUTRAL, shield: true });
      expect(recovery()).toBe(0);
      expect(ch.isShielding()).toBe(true);
    },
  );

  it.each(['jump', 'attack'] as const)('a buffered %s begins on the first free landing step', (action) => {
    const { ch, step, land } = world();
    land(4);
    for (let locked = 1; locked < 5; locked++) step();
    step({ ...NEUTRAL, [action]: true });
    expect(ch.getJumpsquatRemaining()).toBe(0);
    expect(ch.getActiveAttack()).toBeNull();
    step();
    if (action === 'jump') expect(ch.getJumpsquatRemaining()).toBe(3);
    else expect(ch.getActiveAttack()?.move.id).toBe(LINK_JAB1.id);
  });

  it.each([
    ['attack', 'jab'], ['attackHeavy', 'fsmash'],
  ] as const)('buffered %s cannot bypass landing through a held item use', (button, use) => {
    const { ch, step, land } = world();
    ch.registerAttack(LINK_SMASH);
    const itemMove = { ...LINK_JAB1, id: 'item.test.use', jabChain: undefined };
    ch.addAttack(itemMove);
    let fired = 0;
    ch.equipItem({ definition: { itemClass: 'battering', uses: { [use]: itemMove } }, canUse: () => true, noteUse: () => { fired++; }, spendShot: () => false, getAmmo: () => null });
    land(4);
    for (let locked = 1; locked < 5; locked++) step();
    step({ ...NEUTRAL, [button]: true });
    expect(fired).toBe(0);
    step();
    expect(fired).toBe(1);
    step();
    expect(fired).toBe(1);
  });

  it('a buffered charged special starts charging only after ordinary landing recovery', () => {
    const { ch, step, land } = world();
    ch.registerAttack(LINK_NEUTRAL_SPECIAL);
    land(4);
    for (let locked = 1; locked < 5; locked++) step();
    step({ ...NEUTRAL, special: true });
    expect(ch.getAnimationActionState().chargingMove).toBeNull();
    step();
    expect(ch.getAnimationActionState().chargingMove?.id).toBe(LINK_NEUTRAL_SPECIAL.id);
  });

  it.each([{ terminalSteps: 2, lag: 2 }, { terminalSteps: 3, lag: 5 }])(
    'counts touchdown in the terminal-speed threshold after $terminalSteps earlier steps', ({ terminalSteps, lag }) => {
      const { step, land, recovery } = world();
      land(terminalSteps); step();
      expect(recovery()).toBe(lag);
    },
  );

  it('a new air jump breaks the terminal-speed streak before a shallow landing', () => {
    const { ch, step, land, recovery } = world();
    for (let frame = 0; frame < 4; frame++) {
      Body.setVelocity(ch.body, { x: 0, y: ch.getTuning().maxFallSpeed });
      step();
    }
    step({ ...NEUTRAL, jump: true });
    expect(ch.getVelocity().y).toBeLessThan(0);
    land(); step();
    expect(recovery()).toBe(2);
  });

  it.each([{ elapsed: 1, lag: 2 }, { elapsed: 5, lag: 6 }])(
    'aerial landing at $elapsed uses $lag steps, replacing rather than adding penalties', ({ elapsed, lag }) => {
      const { ch, step, land, recovery } = world();
      step({ ...NEUTRAL, attack: true });
      for (let frame = 1; frame < elapsed; frame++) step();
      land();
      expect(ch.getActiveAttack()?.framesElapsed).toBe(elapsed);
      for (let locked = 1; locked <= lag; locked++) {
        step({ ...NEUTRAL, shield: true });
        expect(recovery()).toBe(lag - locked + 1);
        expect(ch.isShielding()).toBe(false);
      }
      step({ ...NEUTRAL, shield: true });
      expect(ch.isShielding()).toBe(true);
    },
  );

  it('ordinary landing does not extend a separate attack cooldown into a defense lock', () => {
    const { ch, step, land, recovery } = world();
    ch.registerAttack({ ...LINK_JAB1, id: 'landing.cooldown', startupFrames: 1,
      activeFrames: 1, recoveryFrames: 1, cooldownFrames: 20 });
    ch.attemptAttack('landing.cooldown');
    for (let frame = 0; frame < 5; frame++) step();
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getCooldownRemaining()).toBeGreaterThan(10);
    land();
    step(); step();
    expect(recovery()).toBe(1);
    step({ ...NEUTRAL, shield: true });
    expect(recovery()).toBe(0);
    expect(ch.getCooldownRemaining()).toBeGreaterThan(0);
    expect(ch.isShielding()).toBe(true);
  });

  it('hitlag freezes ordinary recovery and a round reset clears it', () => {
    const { ch, step, land, recovery } = world();
    land(4); step();
    expect(recovery()).toBe(5);
    ch.armAttackerHitlag(3);
    for (let frozen = 0; frozen < 3; frozen++) {
      step();
      expect(recovery()).toBe(5);
    }
    ch.resetForRound(0, -500);
    expect(recovery()).toBe(0);
    step({ ...NEUTRAL, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe(LINK_NAIR.id);
  });

  it('zero authored ordinary landing frames leave the touchdown step actionable', () => {
    const { ch, step, land, recovery } = world({ softLandingFrames: 0, hardLandingFrames: 0 });
    land(4);
    step({ ...NEUTRAL, shield: true });
    expect(recovery()).toBe(0);
    expect(ch.isShielding()).toBe(true);
  });
});
