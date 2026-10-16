import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DONKEYKONG_AIR_MOVEMENT_PARAMETERS, DONKEYKONG_JUMP_TAKEOFF_PARAMETERS, stepDonkeyKongAirVelocity } from './donkeykongAirMovement';
import { groundJumpTakeoffVelocityX } from './jumpTakeoffVelocity';
describe('DK ordinary horizontal air control source fields and adapters', () => {
  it('reads all four coefficients independently from the original native fighter export', () => {
    const source = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
    const fighter = source.struct.list.struct.find((r: { hash40: { '@hash': string; '#text': string }[] }) =>
      r.hash40.some(f => f['@hash'] === 'fighter_kind' && f['#text'] === 'fighter_kind_donkey'));
    const value = (name: string) => Number(fighter.float.find((f: { '@hash': string }) => f['@hash'] === name)['#text']);
    expect(DONKEYKONG_AIR_MOVEMENT_PARAMETERS).toEqual({ accelerationMultiplier: value('air_accel_x_mul'),
      accelerationAdd: value('air_accel_x_add'), stableSpeed: value('air_speed_x_stable'), neutralBrake: value('air_brake_x') });
  });
  it('reads the takeoff coefficients from the same native export and applies stick + ground momentum under the cap', () => {
    const source = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
    const fighter = source.struct.list.struct.find((r: { hash40: { '@hash': string; '#text': string }[] }) =>
      r.hash40.some(f => f['@hash'] === 'fighter_kind' && f['#text'] === 'fighter_kind_donkey'));
    const value = (name: string) => Number(fighter.float.find((f: { '@hash': string }) => f['@hash'] === name)['#text']);
    expect(DONKEYKONG_JUMP_TAKEOFF_PARAMETERS).toEqual({ jumpSpeedX: value('jump_speed_x'),
      jumpSpeedXMul: value('jump_speed_x_mul'), jumpSpeedXMax: value('jump_speed_x_max') });
    const takeoff = (ground: number, stick: number) => groundJumpTakeoffVelocityX(DONKEYKONG_JUMP_TAKEOFF_PARAMETERS, ground, stick, 5);
    for (const direction of [1, -1]) {
      expect(takeoff(0, direction)).toBeCloseTo(direction * 4.75);               // standing: .95 x 5
      expect(takeoff(0, direction * .5)).toBeCloseTo(direction * 2.375);
      expect(takeoff(direction * 2, 0)).toBeCloseTo(direction * 1.6);             // momentum only: .4 x .8 x 5
      expect(takeoff(direction * 10.45, direction)).toBeCloseTo(direction * 8);   // dash: capped 1.6 x 5
      expect(takeoff(direction * 10.45, -direction)).toBeCloseTo(direction * 3.61); // reversed stick: (1.672 - .95) x 5
    }
  });
  it('uses additive analog acceleration in both directions and reaches source speed without overshoot', () => {
    for (const direction of [1, -1]) {
      expect(stepDonkeyKongAirVelocity({ velocityX: 0, stickX: direction })).toBeCloseTo(direction * .3);
      expect(stepDonkeyKongAirVelocity({ velocityX: 0, stickX: direction * .5 })).toBeCloseTo(direction * .175);
      expect(stepDonkeyKongAirVelocity({ velocityX: direction * 6, stickX: direction })).toBeCloseTo(direction * 6.04);
      let speed = 0;
      for (let age = 0; age < 100; age++) speed = stepDonkeyKongAirVelocity({ velocityX: speed, stickX: direction });
      expect(speed).toBeCloseTo(direction * 6.04);
    }
  });
  it('applies constant neutral braking instead of multiplicative damping and never reverses near zero', () => {
    for (const direction of [1, -1]) {
      expect(stepDonkeyKongAirVelocity({ velocityX: direction * 6.04, stickX: 0 })).toBeCloseTo(direction * 5.965);
      expect(stepDonkeyKongAirVelocity({ velocityX: direction * .075, stickX: 0 })).toBeCloseTo(0);
      expect(stepDonkeyKongAirVelocity({ velocityX: direction * .03, stickX: 0 })).toBe(0);
    }
    expect(stepDonkeyKongAirVelocity({ velocityX: 0, stickX: 0 })).toBe(0);
  });
  it('relaxes excess speed by air_brake_x on same-direction control down to the cap; opposite control reduces it; frozen steps unchanged', () => {
    for (const direction of [1, -1]) {
      expect(stepDonkeyKongAirVelocity({ velocityX: direction * 8, stickX: direction })).toBeCloseTo(direction * 7.925);
      expect(stepDonkeyKongAirVelocity({ velocityX: direction * 6.05, stickX: direction * .5 })).toBeCloseTo(direction * 6.04);
      let speed = direction * 8;
      for (let age = 0; age < 100; age++) speed = stepDonkeyKongAirVelocity({ velocityX: speed, stickX: direction });
      expect(speed).toBeCloseTo(direction * 6.04);
    }
    expect(stepDonkeyKongAirVelocity({ velocityX: 8, stickX: -1 })).toBeCloseTo(7.7);
    expect(stepDonkeyKongAirVelocity({ velocityX: -8, stickX: 1 })).toBeCloseTo(-7.7);
    for (const stickX of [-1, 0, 1]) expect(stepDonkeyKongAirVelocity({ velocityX: 8, stickX, frozen: true })).toBe(8);
  });
});
