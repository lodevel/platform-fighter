import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { LINK_JAB, LINK_NAIR, LINK_NEUTRAL_SPECIAL, LINK_UP_SPECIAL } from './Link';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

function world() {
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
  const ch = new Character(scene, { id: 'link', spawnX: 0, spawnY: 0 });
  for (const move of [LINK_JAB, LINK_NAIR, LINK_NEUTRAL_SPECIAL, LINK_UP_SPECIAL]) {
    registerFighterAttack(ch, move);
  }
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
  const startUpSpecial = (elapsed = 1) => {
    step({ ...NEUTRAL, moveY: -1, special: true });
    expect(ch.getActiveAttack()?.move.id).toBe(LINK_UP_SPECIAL.id);
    for (let frame = 1; frame < elapsed; frame++) step();
  };
  const recovery = () => ch.getAnimationActionState().landingRecoveryRemaining;
  const hitboxes = () => Composite.allBodies(engine.world).filter((body: any) =>
    body.collisionFilter.category === COLLISION_CATEGORIES.HITBOX);
  return { ch, scene, engine, step, land, startUpSpecial, recovery, hitboxes };
}

describe('special landing through real Matter contact', () => {
  it('aerial Spin Attack touchdown cancels hitboxes and commits exactly 30 input steps', () => {
    const { ch, step, land, startUpSpecial, recovery, hitboxes } = world();
    startUpSpecial(7);
    land();
    expect(hitboxes().length).toBeGreaterThan(0);
    let previousSpeed = Math.abs(ch.getVelocity().x);
    for (let locked = 1; locked <= 30; locked++) {
      expect(ch.canUseItemsBeforeInput()).toBe(false);
      step({ ...NEUTRAL, moveX: 1, shield: true });
      expect(recovery()).toBe(30 - locked + 1);
      expect(ch.getActiveAttack()).toBeNull();
      expect(hitboxes()).toHaveLength(0);
      expect(Math.abs(ch.getVelocity().x)).toBeLessThanOrEqual(previousSpeed);
      previousSpeed = Math.abs(ch.getVelocity().x);
      expect(ch.isShielding()).toBe(false);
      expect(ch.canAttack()).toBe(false);
    }
    expect(ch.canUseItemsBeforeInput()).toBe(true);
    step({ ...NEUTRAL, shield: true });
    expect(recovery()).toBe(0);
    expect(ch.isShielding()).toBe(true);
  });

  it('Spin Attack that finishes airborne keeps its 30-step helpless landing commitment', () => {
    const { ch, step, land, startUpSpecial, recovery } = world();
    startUpSpecial();
    for (let frame = 0; frame < 100 && ch.getActiveAttack() !== null; frame++) step();
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.isHelpless()).toBe(true);
    land();
    for (let locked = 1; locked <= 30; locked++) {
      step({ ...NEUTRAL, shield: true });
      expect(recovery()).toBe(30 - locked + 1);
      expect(ch.isHelpless()).toBe(false);
      expect(ch.isShielding()).toBe(false);
    }
    step({ ...NEUTRAL, shield: true });
    expect(ch.isShielding()).toBe(true);
  });

  it.each(['jump', 'attack', 'special'] as const)(
    'buffered %s opens on the first free special-landing step', action => {
      const { ch, step, land, startUpSpecial, recovery } = world();
      startUpSpecial();
      land();
      for (let locked = 1; locked < 30; locked++) step();
      step({ ...NEUTRAL, [action]: true });
      expect(recovery()).toBe(1);
      expect(ch.getJumpsquatRemaining()).toBe(0);
      expect(ch.getActiveAttack()).toBeNull();
      expect(ch.getAnimationActionState().chargingMove).toBeNull();
      step();
      expect(recovery()).toBe(0);
      if (action === 'jump') expect(ch.getJumpsquatRemaining()).toBe(3);
      else if (action === 'attack') expect(ch.getActiveAttack()?.move.id).toBe(LINK_JAB.id);
      // The fresh bow's charge is owned by Link's own special controller; on a plain Character it starts as a move.
      else expect(ch.getActiveAttack()?.move.id).toBe(LINK_NEUTRAL_SPECIAL.id);
    },
  );

  // The grounded Spin Attack is owned by Link's spin controller (no special landing lag): Link.groundSpin.physics.test.ts.
  it('hitlag freezes the full special landing recovery until simulation resumes', () => {
    const { ch, step, land, startUpSpecial, recovery } = world();
    startUpSpecial();
    land();
    step();
    expect(recovery()).toBe(30);
    ch.armAttackerHitlag(3);
    for (let frozen = 0; frozen < 3; frozen++) {
      step();
      expect(recovery()).toBe(30);
    }
    step();
    expect(recovery()).toBe(29);
  });

  it.each((['round reset', 'hit', 'capture', 'ledge catch'] as const).flatMap(interruption =>
    (['active', 'completed'] as const).map(phase => ({ interruption, phase }))))(
    '$interruption clears the $phase aerial special landing commitment', ({ interruption, phase }) => {
      const { ch, scene, step, land, startUpSpecial, recovery } = world();
      startUpSpecial(12);
      if (phase === 'completed') {
        for (let frame = 0; frame < 100 && ch.getActiveAttack() !== null; frame++) step();
        expect(ch.getActiveAttack()).toBeNull();
        expect(ch.isHelpless()).toBe(true);
      }
      if (interruption === 'round reset') {
        ch.resetForRound(0, -500);
      } else if (interruption === 'hit') {
        ch.applyHit({ damage: 1, knockback: { x: 0, y: -1, scaling: 0 }, facing: 1 });
        for (let frame = 0; frame < 100 && (ch.isInHitstun() || ch.getHitlagRemaining() > 0); frame++) step();
        expect(ch.isInHitstun()).toBe(false);
      } else if (interruption === 'capture') {
        const grabber = new Character(scene, { id: 'donkeykong', spawnX: 5000, spawnY: 0 });
        ch.applyGrabbed(grabber);
        expect(ch.isGrabbed()).toBe(true);
        step();
        ch.releaseFromGrab();
      } else {
        const pos = ch.getPosition();
        ch.setLedgeCandidates([{ ...pos, side: 'right', platformId: 'edge' }]);
        Body.setVelocity(ch.body, { x: 0, y: 2 });
        step();
        expect(ch.isHangingOnLedge()).toBe(true);
        step({ ...NEUTRAL, ledgeRelease: 'dropDown' });
        ch.setLedgeCandidates([]);
      }
      expect(ch.getActiveAttack()).toBeNull();
      expect(ch.isHelpless()).toBe(false);
      land();
      step();
      expect(recovery()).toBe(2);
      step();
      step({ ...NEUTRAL, shield: true });
      expect(recovery()).toBe(0);
      expect(ch.isShielding()).toBe(true);
    },
  );

  it.each([{ action: 'special', lag: 30 }, { action: 'air dodge', lag: 10 }])(
    'an incoming hit interrupts $action landing recovery', ({ action, lag }) => {
      const { ch, step, land, startUpSpecial, recovery } = world();
      if (action === 'special') startUpSpecial();
      else step({ ...NEUTRAL, dodge: true });
      land();
      step();
      expect(recovery()).toBe(lag);
      const hit = ch.applyHit({ damage: 1, knockback: { x: 0, y: -1, scaling: 0 }, facing: 1 });
      expect(hit.hitstunFrames).toBeGreaterThan(0);
      expect(ch.getDamagePercent()).toBe(1);
      expect(recovery()).toBe(0);
      step();
      expect(recovery()).toBe(0);
    },
  );

  it.each(['active', 'recovery'] as const)(
    'a neutral air dodge landing during %s replaces its airborne remainder with 10 steps', phase => {
      const { ch, step, land, recovery } = world();
      step({ ...NEUTRAL, dodge: true });
      expect(ch.isDodgeInvincible()).toBe(false); // Source frames 1–2 are vulnerable.
      if (phase === 'recovery') {
        for (let frame = 0; frame < 100 && ch.getDodgeState().name === 'active'; frame++) step();
      }
      expect(ch.getDodgeState().name).toBe(phase);
      land();
      for (let locked = 1; locked <= 10; locked++) {
        expect(ch.canUseItemsBeforeInput()).toBe(false);
        step({ ...NEUTRAL, shield: true });
        expect(recovery()).toBe(10 - locked + 1);
        expect(ch.isDodging()).toBe(false);
        expect(ch.isDodgeInvincible()).toBe(false);
        expect(ch.isShielding()).toBe(false);
      }
      expect(ch.canUseItemsBeforeInput()).toBe(true);
      step({ ...NEUTRAL, shield: true });
      expect(recovery()).toBe(0);
      expect(ch.isShielding()).toBe(true);
    },
  );

  it.each(['active', 'recovery'] as const)(
    'a directional air dodge landing during %s loses its burst and invincibility for 19 steps', phase => {
      const { ch, step, land, recovery } = world();
      step({ ...NEUTRAL, moveX: 1, moveY: 1, dodge: true });
      expect(ch.getVelocity().x).toBeGreaterThan(0);
      expect(ch.isDodgeInvincible()).toBe(false);
      if (phase === 'recovery') {
        for (let frame = 0; frame < 100 && ch.getDodgeState().name === 'active'; frame++) step();
      }
      expect(ch.getDodgeState().name).toBe(phase);
      land();
      let previousSpeed = Math.abs(ch.getVelocity().x);
      for (let locked = 1; locked <= 19; locked++) {
        step({ ...NEUTRAL, moveX: 1, shield: true });
        expect(recovery()).toBe(19 - locked + 1);
        expect(Math.abs(ch.getVelocity().x)).toBeLessThanOrEqual(previousSpeed);
        previousSpeed = Math.abs(ch.getVelocity().x);
        expect(ch.isDodging()).toBe(false);
        expect(ch.isDodgeInvincible()).toBe(false);
        expect(ch.isShielding()).toBe(false);
      }
      step({ ...NEUTRAL, shield: true });
      expect(ch.isShielding()).toBe(true);
    },
  );

  it('catching and releasing a ledge restores an air dodge consumed before the catch', () => {
    const { ch, step } = world();
    step({ ...NEUTRAL, dodge: true });
    expect(ch.isDodging()).toBe(true);
    const pos = ch.getPosition();
    ch.setLedgeCandidates([{ ...pos, side: 'right', platformId: 'edge' }]);
    Body.setVelocity(ch.body, { x: 0, y: 2 });
    step();
    expect(ch.isHangingOnLedge()).toBe(true);
    expect(ch.isDodging()).toBe(false);
    step({ ...NEUTRAL, ledgeRelease: 'dropDown' });
    ch.setLedgeCandidates([]);
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.isGrounded()).toBe(false);
    step({ ...NEUTRAL, dodge: true });
    expect(ch.getDodgeState().active?.kind).toBe('air');
    expect(ch.isDodgeInvincible()).toBe(false);
  });

  it('a hit during airborne dodge recovery clears the dodge and its pending landing penalty', () => {
    const { ch, step, land, recovery } = world();
    step({ ...NEUTRAL, moveX: 1, moveY: 1, dodge: true });
    for (let frame = 0; frame < 100 && ch.getDodgeState().name === 'active'; frame++) step();
    expect(ch.getDodgeState().name).toBe('recovery');
    const hit = ch.applyHit({ damage: 1, knockback: { x: 0, y: -1, scaling: 0 }, facing: 1 });
    expect(hit.hitstunFrames).toBeGreaterThan(0);
    expect(ch.isDodging()).toBe(false);
    expect(ch.isDodgeInvincible()).toBe(false);
    for (let frame = 0; frame < 100 && (ch.isInHitstun() || ch.getHitlagRemaining() > 0); frame++) step();
    expect(ch.isInHitstun()).toBe(false);
    land();
    step();
    expect(recovery()).toBe(2);
    step();
    step({ ...NEUTRAL, shield: true });
    expect(recovery()).toBe(0);
    expect(ch.isShielding()).toBe(true);
  });

  it.each([{ terminalSteps: 0, lag: 2 }, { terminalSteps: 4, lag: 5 }])(
    'an air dodge completed before touchdown uses ordinary $lag-step landing', ({ terminalSteps, lag }) => {
      const { ch, step, land, recovery } = world();
      step({ ...NEUTRAL, dodge: true });
      for (let frame = 0; frame < 100 && ch.isDodging(); frame++) step();
      expect(ch.isDodging()).toBe(false);
      land(terminalSteps);
      for (let locked = 1; locked <= lag; locked++) {
        step({ ...NEUTRAL, shield: true });
        expect(recovery()).toBe(lag - locked + 1);
        expect(ch.isShielding()).toBe(false);
      }
      step({ ...NEUTRAL, shield: true });
      expect(ch.isShielding()).toBe(true);
    },
  );
});
