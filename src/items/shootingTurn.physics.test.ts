import { describe, expect, it } from 'vitest';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Pikachu } from '../characters/Pikachu';
import { itemPhysicsFixture, NEUTRAL_INPUT as idle } from './itemPhysicsFixture';
import { RAY_GUN_DEFINITION } from './RayGun';
import { SUPER_SCOPE_DEFINITION } from './SuperScope';
import { FIRE_FLOWER_DEFINITION } from './FireFlower';

for (const [id, Fighter] of [['donkeykong', DonkeyKong], ['pikachu', Pikachu]] as const)
  describe(`${id}: new shooting direction`, () => {
    it.each([1, -1] as const)('an empty gun is thrown in the newly turned direction %i', facing => {
      const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
      f.actor.setFacing(facing);
      while (f.bat.spendShot()) { /* empty the held gun */ }
      f.step({ ...idle, moveX: -facing * .5, attack: true });
      expect(f.actor.getItemShootingState()).toBeNull();
      expect(f.actor.getItemActionState()?.facing).toBe(-facing);
    });
    it.each([1, -1] as const)('a shot interrupts a running turn toward %i', facing => {
      const f = itemPhysicsFixture(Fighter, SUPER_SCOPE_DEFINITION);
      f.actor.setFacing(-facing as 1 | -1);
      for (let age = 0; age < 10; age++) f.step({ ...idle, moveX: -facing });
      f.step({ ...idle, moveX: facing });
      f.step({ ...idle, moveX: facing, attack: true });
      expect(f.actor.getItemShootingState()).not.toBeNull();
      expect(f.actor.getFacing()).toBe(facing);
      expect(f.actor.getItemShootingState()!.facing).toBe(facing);
    });
    for (const weapon of [RAY_GUN_DEFINITION, SUPER_SCOPE_DEFINITION, FIRE_FLOWER_DEFINITION])
      it.each([1, -1] as const)(`${weapon.type}: a turn on the firing step commits the new facing %i`, facing => {
        const f = itemPhysicsFixture(Fighter, weapon);
        f.actor.setFacing(facing);
        // A walk tilt avoids an unrelated smash-throw flick; movement and fire arrive in one fixed step.
        f.step({ ...idle, moveX: -facing * .5, attack: true });
        expect(f.actor.getItemShootingState()).not.toBeNull();
        expect(f.actor.getFacing()).toBe(-facing);
        expect(f.actor.getItemShootingState()!.facing).toBe(-facing);
        const shots = [];
        for (let age = 0; age < 65; age++) {
          f.step(idle); shots.push(...f.actor.consumeItemShots());
        }
        expect(shots.length).toBeGreaterThan(0);
        expect(shots.every(shot => shot.facing === -facing)).toBe(true);
      });
  });
