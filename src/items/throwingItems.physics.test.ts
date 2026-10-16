/**
 * Throwing items (Ultimate items phase 5) on DK and Pikachu in a real Matter world: the Bob-omb explosion's launch, the
 * downward-throw meteor, and the Banana Peel slip (a soft trip). Sources: docs/review/2026-10-11/ultimate-items/phase-5/sources.json.
 */
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Pikachu } from '../characters/Pikachu';
import { SLIP_OPTION_LOCK_FRAMES, TRIP_OPTION_LOCK_FRAMES } from '../characters/Character';
import { itemPhysicsFixture, NEUTRAL_INPUT as neutral } from './itemPhysicsFixture';
import { BOB_OMB_DEFINITION, BOB_OMB_EXPLOSION, itemExplosionHit } from './BobOmb';
import { BANANA_PEEL_DEFINITION, bananaSlipHit } from './BananaPeel';
import { thrownItemHit } from './nativeItemThrow';

const FIGHTERS = [['donkeykong', DonkeyKong], ['pikachu', Pikachu]] as const;
const throughHitlag = (f: ReturnType<typeof itemPhysicsFixture>) => {
  for (let n = 0; n < 60 && f.actor.isInHitlag(); n++) f.step();
  f.step();
};

describe.each(FIGHTERS)('%s receiving throwing-item hits', (_id, Fighter) => {
  it.each([1, -1] as const)('a Bob-omb explosion deals 25%% and launches up and away from the blast (facing %i)', facing => {
    const f = itemPhysicsFixture(Fighter, BANANA_PEEL_DEFINITION);
    f.actor.applyHitDetailed(itemExplosionHit(BOB_OMB_EXPLOSION, facing));
    expect(f.actor.getDamagePercent()).toBe(25);
    throughHitlag(f);
    const v = f.actor.getVelocity();
    expect(Math.sign(v.x)).toBe(facing);
    expect(v.y).toBeLessThan(0);
  });

  it('a Bob-omb thrown downward meteors an airborne target', () => {
    const f = itemPhysicsFixture(Fighter, BANANA_PEEL_DEFINITION);
    const p = f.actor.getPosition();
    f.actor.setPosition(p.x, p.y - 300);
    f.step();
    expect(f.actor.isGrounded()).toBe(false);
    f.actor.applyHitDetailed(thrownItemHit(BOB_OMB_DEFINITION, 'throw-air-down-ordinary', { vx: 0, vy: 10 }, 1, 1, false));
    expect(f.actor.getDamagePercent()).toBeCloseTo(30.6, 9);
    throughHitlag(f);
    expect(f.actor.getVelocity().y).toBeGreaterThan(0);
  });

  it('stepping on a Banana Peel: 0%, a soft trip whose options open after 30 frames (a hard trip: 39)', () => {
    const slipped = itemPhysicsFixture(Fighter, BANANA_PEEL_DEFINITION);
    slipped.actor.applyHitDetailed(bananaSlipHit(1));
    expect(slipped.actor.getDamagePercent()).toBe(0);
    for (let n = 0; n < 60 && !slipped.actor.isTripped(); n++) slipped.step();
    expect(slipped.actor.isTripped()).toBe(true);
    // The slip is soft: its options open on the 30th frame, as applyTrip(true).
    for (let n = 0; n < SLIP_OPTION_LOCK_FRAMES - 1; n++) slipped.step();
    slipped.step({ ...neutral, moveX: 1 });
    expect(slipped.actor.isTripped()).toBe(false);
    // Option lock: a roll input on the lock's last frame is refused, the next frame it is taken.
    const getsUp = (soft: boolean, frames: number) => {
      const f = itemPhysicsFixture(Fighter, BANANA_PEEL_DEFINITION);
      f.actor.applyTrip(soft);
      for (let n = 0; n < frames - 1; n++) f.step();
      f.step({ ...neutral, moveX: 1 });
      return !f.actor.isTripped();
    };
    expect(getsUp(true, SLIP_OPTION_LOCK_FRAMES - 1)).toBe(false);
    expect(getsUp(true, SLIP_OPTION_LOCK_FRAMES)).toBe(true);
    expect(getsUp(false, SLIP_OPTION_LOCK_FRAMES)).toBe(false);
    expect(getsUp(false, TRIP_OPTION_LOCK_FRAMES)).toBe(true);
  });

  it('a thrown Banana Peel slips a grounded target but not an airborne one', () => {
    const ground = itemPhysicsFixture(Fighter, BANANA_PEEL_DEFINITION);
    ground.actor.applyHitDetailed(thrownItemHit(BANANA_PEEL_DEFINITION, 'throw-ground-forward-ordinary', { vx: 8, vy: 0 }, 1, 1, true));
    expect(ground.actor.getDamagePercent()).toBeCloseTo(4.1, 9);
    for (let n = 0; n < 60 && !ground.actor.isTripped(); n++) ground.step();
    expect(ground.actor.isTripped()).toBe(true);
    const air = itemPhysicsFixture(Fighter, BANANA_PEEL_DEFINITION);
    const p = air.actor.getPosition();
    air.actor.setPosition(p.x, p.y - 300);
    air.step();
    air.actor.applyHitDetailed(thrownItemHit(BANANA_PEEL_DEFINITION, 'throw-air-forward-ordinary', { vx: 8, vy: 0 }, 1, 1, false));
    for (let n = 0; n < 60; n++) air.step();
    expect(air.actor.isTripped()).toBe(false);
  });
});
