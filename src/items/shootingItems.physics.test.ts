/**
 * Shooting items (Ultimate items phase 4) and the held-item direction fix on DK and Pikachu in a real Matter world.
 * Sources: docs/review/2026-10-11/ultimate-items/phase-4/sources.json.
 */
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Pikachu } from '../characters/Pikachu';
import type { Character, CharacterInput } from '../characters/Character';
import { captureSimulationAnimation, resolveSimulationAction } from '../characters/simulationSpriteAnimation';
import { itemPhysicsFixture, NEUTRAL_INPUT as neutral } from './itemPhysicsFixture';
import { BEAM_SWORD_DEFINITION } from './BeamSword';
import { RAY_GUN_DEFINITION } from './RayGun';
import { SUPER_SCOPE_DEFINITION } from './SuperScope';
import { FIRE_FLOWER_DEFINITION } from './FireFlower';

const FIGHTERS = [['donkeykong', DonkeyKong], ['pikachu', Pikachu]] as const;
const body = (a: Character) => {
  const action = resolveSimulationAction(captureSimulationAnimation(a, 0, false));
  return { sheet: action.sheets[0], upper: action.overlay?.sheets[0] ?? null };
};
/** Forward = within 45° of horizontal in the facing direction (Phaser degrees, 0 = up, 90 = forward when facing right). */
const pointsForward = (angle: number, facing: 1 | -1) => Math.abs(angle * facing - 90) < 45;

describe.each(FIGHTERS)('%s: the held item points along its native axis at the action frame', (_id, Fighter) => {
  // Phase-3 root review: the charged / tapped Beam Sword forward smash drew the blade BEHIND the fighter at the
  // contact (drawing-sample angle of the native h04swing4 drawings 12 / 18), while the hitbox is in front.
  it.each([1, -1] as const)('Beam Sword forward smash: blade forward on the hitbox frame (facing %i)', facing => {
    const f = itemPhysicsFixture(Fighter, BEAM_SWORD_DEFINITION);
    f.actor.setFacing(facing);
    f.step({ ...neutral, attackHeavy: true });
    f.step();
    let checked = false;
    for (let n = 0; n < 40 && !checked; n++) {
      const a = f.actor.getActiveAttack();
      if (a?.hitboxBody) {
        const socket = f.actor.getHeldItemSocket();
        expect(pointsForward(socket.angle!, facing), `angle ${socket.angle} facing ${facing}`).toBe(true);
        checked = true;
      } else f.step();
    }
    expect(checked).toBe(true);
  });

  it.each([1, -1] as const)('Ray Gun: barrel forward when the shot leaves (facing %i)', facing => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    f.actor.setFacing(facing);
    f.step({ ...neutral, attack: true });
    for (let n = 0; n < 8; n++) f.step();
    expect(f.actor.consumeItemShots()).toHaveLength(1);
    expect(pointsForward(f.actor.getHeldItemSocket().angle!, facing)).toBe(true);
  });
});

describe.each(FIGHTERS)('%s firing a Ray Gun', (_id, Fighter) => {
  it('neutral attack fires: no attack lock, one 5% shot on frame 9, the next shot free on frame 25', () => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    f.step({ ...neutral, attack: true });
    expect(f.actor.getActiveAttack()).toBeNull();
    expect(f.actor.getItemShootingState()).not.toBeNull();
    expect(body(f.actor)).toEqual({ sheet: 'item_lgun_shoot', upper: null });
    const shots: number[] = [];
    for (let n = 1; n < 30; n++) {
      f.step();
      for (const s of f.actor.consumeItemShots()) { shots.push(n); expect(s.shot.damage).toBe(5); }
      if (n === 23) expect(f.actor.getItemShootingState()).not.toBeNull();
      if (n === 24) expect(f.actor.getItemShootingState()).toBeNull();
    }
    expect(shots).toEqual([8]);
    expect(f.bat.getAmmo()).toBe(15);
  });

  it('walking forward / backward while firing: legs walk under the upper-body layer, facing kept, walk speed', () => {
    for (const dir of [1, -1] as const) {
      const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
      f.actor.setFacing(1);
      f.step({ ...neutral, attack: true });
      for (let n = 0; n < 12; n++) f.step({ ...neutral, moveX: dir });
      expect(f.actor.getFacing()).toBe(1);
      expect(body(f.actor)).toEqual({ sheet: dir === 1 ? 'item_shoot_legs_walk_f' : 'item_shoot_legs_walk_b', upper: 'item_lgun_shoot_upper' });
      const walk = (f.actor as unknown as { resolvedLocomotionTuning: { walkMaxSpeed: number } }).resolvedLocomotionTuning.walkMaxSpeed;
      expect(Math.abs(f.actor.getVelocity().x)).toBeLessThanOrEqual(walk * (dir === 1 ? 1 : .87) + 1e-6);
      expect(Math.sign(f.actor.getVelocity().x)).toBe(dir);
    }
  });

  it('a press out of a run fires too (dash attack input) and the legs slow to the shooting walk', () => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    for (let n = 0; n < 20; n++) f.step({ ...neutral, moveX: 1 });
    f.step({ ...neutral, moveX: 1, attack: true });
    expect(f.actor.getActiveAttack()).toBeNull();
    expect(f.actor.getItemShootingState()).not.toBeNull();
    for (let n = 0; n < 10; n++) f.step({ ...neutral, moveX: 1 });
    expect(body(f.actor).upper).toBe('item_lgun_shoot_upper');
  });

  it('jumping while firing: jump-squat legs, then the airborne shot motion; the shot still leaves', () => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    f.step({ ...neutral, attack: true });
    f.step({ ...neutral, jump: true });
    expect(body(f.actor)).toEqual({ sheet: 'item_shoot_legs_jump_squat', upper: 'item_lgun_shoot_upper' });
    let shots = 0, airborne = false;
    for (let n = 0; n < 10; n++) {
      f.step({ ...neutral, jump: true });
      shots += f.actor.consumeItemShots().length;
      if (!f.actor.isGrounded()) { airborne = true; expect(body(f.actor)).toEqual({ sheet: 'item_lgun_shoot_air', upper: null }); }
    }
    expect(airborne).toBe(true);
    expect(shots).toBe(1);
  });

  it('neutral aerial fires in the air; a forward aerial stays the fighter\'s own', () => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    f.step({ ...neutral, jump: true });
    for (let n = 0; n < 10; n++) f.step();
    f.step({ ...neutral, attack: true });
    expect(f.actor.getItemShootingState()).not.toBeNull();
    const g = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    g.step({ ...neutral, jump: true });
    for (let n = 0; n < 10; n++) g.step();
    g.step({ ...neutral, moveX: g.actor.getFacing(), attack: true });
    expect(g.actor.getItemShootingState()).toBeNull();
    expect(g.actor.getActiveAttack()?.move.id.startsWith('item.')).toBe(false);
  });

  it('the empty gun is thrown forward on the fire press', () => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    while (f.bat.spendShot()) { /* empty it */ }
    f.step({ ...neutral, attack: true });
    expect(f.actor.getItemShootingState()).toBeNull();
    expect(f.actor.getItemActionState()?.plan.action).toBe('throw-ground-forward-ordinary');
  });
});

describe.each(FIGHTERS)('%s firing a Super Scope and a Fire Flower', (_id, Fighter) => {
  const shotsOf = (f: ReturnType<typeof itemPhysicsFixture>, inputs: CharacterInput[]) => {
    const ids: string[] = [];
    for (const input of inputs) { f.step(input); ids.push(...f.actor.consumeItemShots().map(s => s.shot.id)); }
    return ids;
  };
  it('a tapped scope fires five 1% shots; a 110-frame hold fires one stage-10 shot (16 ammo)', () => {
    const tap = itemPhysicsFixture(Fighter, SUPER_SCOPE_DEFINITION);
    expect(shotsOf(tap, [{ ...neutral, attack: true }, ...Array(80).fill(neutral)])).toEqual(Array(5).fill('item.superScope.rapid'));
    expect(tap.bat.getAmmo()).toBe(67);
    const hold = itemPhysicsFixture(Fighter, SUPER_SCOPE_DEFINITION);
    const held = { ...neutral, attack: true };
    const ids = shotsOf(hold, [...Array(120).fill(held), ...Array(60).fill(neutral)]);
    expect(ids).toEqual(['item.superScope.charge10']);
    expect(hold.bat.getAmmo()).toBe(56);
  });

  it('a held Fire Flower streams flames while walking, on the loop motion over the walking legs', () => {
    const f = itemPhysicsFixture(Fighter, FIRE_FLOWER_DEFINITION);
    const held = { ...neutral, attack: true };
    const ids = shotsOf(f, [held, ...Array(40).fill({ ...held, moveX: 1 })]);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids)).toEqual(new Set(['item.fireFlower.flame']));
    expect(body(f.actor)).toEqual({ sheet: 'item_shoot_legs_walk_f', upper: 'item_fflower_shoot_loop_upper' });
    expect(f.bat.getAmmo()).toBeLessThan(420);
  });
});

describe.each(FIGHTERS)('%s aims a held Super Scope forward', (_id, Fighter) => {
  it.each([1, -1] as const)('the scope points forward while charging and when the tap shots leave (facing %i)', facing => {
    const f = itemPhysicsFixture(Fighter, SUPER_SCOPE_DEFINITION);
    f.actor.setFacing(facing);
    for (let n = 0; n < 30; n++) f.step({ ...neutral, attack: true });
    expect(body(f.actor).sheet).toBe('item_scope_wait');
    expect(pointsForward(f.actor.getHeldItemSocket().angle!, facing)).toBe(true);
  });
});
