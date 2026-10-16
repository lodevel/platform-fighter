import {describe, expect, it} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
import {itemPhysicsFixture} from '../items/itemPhysicsFixture';
import {HOME_RUN_BAT_DEFINITION} from '../items/HomeRunBat';

describe.each([1, -1] as const)('DK knockdown support loss facing %s', facing => {
  it.each(['face-up', 'face-down'] as const)('retires %s floor lock and accelerates while airborne, then resolves a real landing', posture => {
    const f = itemPhysicsFixture(DonkeyKong, HOME_RUN_BAT_DEFINITION);
    f.inventory.detachWithoutDrop(); f.actor.setFacing(facing);
    const direction = facing * (posture === 'face-down' ? 1 : -1);
    f.actor.applyHit({damage: 18.9, knockback: {x: 12, y: -10, scaling: 0},
      facing: direction as 1 | -1, minHitstunFrames: 45, hitlagMultiplier: 0});
    let sawAirborne = false;
    for (let frame = 0; frame < 300 && !f.actor.isKnockedDown(); frame++) {
      f.step();
      if (!f.actor.isGrounded()) {
        sawAirborne = true;
        expect(f.actor.getReactionPresentationState()?.kind).not.toBe('prone');
      }
    }
    expect(sawAirborne).toBe(true); expect(f.actor.isGrounded()).toBe(true);
    expect(f.actor.isKnockedDown()).toBe(true);
    expect(f.actor.getReactionPresentationState()).toMatchObject({kind: 'prone', origin: posture});

    // Remove only this supporting collision pair; the lower catch surface
    // remains a real solid floor. No character state or grounded flag is set.
    f.floor.collisionFilter.mask = 0;
    const floorTop = f.floor.bounds.min.y;
    const lower = f.actor.getTuning().height / 2 + floorTop + 260;
    f.scene.matter.add.rectangle(0, lower, 6000, 20, {isStatic: true, label: 'platform.solid',
      collisionFilter: {category: f.floor.collisionFilter.category}});
    f.step(); expect(f.actor.isGrounded()).toBe(false);
    let previousDownSpeed = f.actor.getVelocity().y;
    for (let frame = 0; frame < 8; frame++) {
      f.step();
      expect(f.actor.isKnockedDown()).toBe(false);
      expect(f.actor.getReactionPresentationState()?.kind).not.toBe('prone');
      expect(f.actor.getVelocity().y).toBeGreaterThan(previousDownSpeed);
      previousDownSpeed = f.actor.getVelocity().y;
    }
    for (let frame = 0; frame < 180 && !f.actor.isKnockedDown(); frame++) f.step();
    expect(f.actor.isGrounded()).toBe(true);
    expect(f.actor.isKnockedDown()).toBe(true);
  });
});
