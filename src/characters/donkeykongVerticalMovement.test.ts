import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DONKEYKONG_VERTICAL_PARAMETERS, DONKEYKONG_ORDINARY_VERTICAL_PROFILE,
  DONKEYKONG_MINI_HOP_IMPULSE, DONKEYKONG_AIR_JUMP_IMPULSE, DONKEYKONG_FALL_SPEED,
  DONKEYKONG_FAST_FALL_SPEED, DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS,
  stepDonkeyKongOrdinaryVertical, donkeyKongVerticalPrePhysicsVelocity,
  donkeyKongFullHopCarriedVelocityY } from './donkeykongVerticalMovement';

const evidence = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics';
function nativeParameters() {
  const source = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
  const fighter = source.struct.list.struct.find((r: { hash40: { '@hash': string; '#text': string }[] }) =>
    r.hash40.some(f => f['@hash'] === 'fighter_kind' && f['#text'] === 'fighter_kind_donkey'));
  return (name: string): number => {
    const row = fighter.float.find((f: { '@hash': string }) => f['@hash'] === name);
    if (!row) throw new Error(`Missing native DK field ${name}`);
    return Number(row['#text']);
  };
}

describe('DK sourced ordinary vertical fields and explicit initial full-hop calibration', () => {
  it('matches eight native fighter fields and retains independently hashed research captures', () => {
    const native = nativeParameters(), p = DONKEYKONG_VERTICAL_PARAMETERS;
    for (const [selected, source] of [[p.gravityNative, 'air_accel_y'],
      [p.fullHopHeightNative, 'jump_y'], [p.fullHopInitialHeightNative, 'jump_initial_y'],
      [p.miniHopHeightNative, 'mini_jump_y'], [p.airJumpHeightNative, 'jump_aerial_y'],
      [p.fallSpeedNative, 'air_speed_y_stable'], [p.fastFallSpeedNative, 'dive_speed_y'],
      [p.excessFallBrakeNative, 'air_brake_y']] as const) expect(selected).toBe(native(source));
    const contract = JSON.parse(readFileSync(`${evidence}/ordinary-vertical-source-contract.json`, 'utf8'));
    for (const pin of contract.sources as { path: string; sha256: string }[]) {
      expect(createHash('sha256').update(readFileSync(pin.path)).digest('hex')).toBe(pin.sha256);
    }
    const published = readFileSync(`${evidence}/sources/jump-page75.web.json`, 'utf8');
    expect(published).toContain('sqrt (2gH) + g / 2');
    expect(published).toContain('sqrt (2gH) - g / 2');
  });

  it('uses published0F mini/air impulses and reaches independently expected1F values', () => {
    const native = nativeParameters(), g = native('air_accel_y');
    for (const [impulse, field] of [[DONKEYKONG_MINI_HOP_IMPULSE, 'mini_jump_y'],
      [DONKEYKONG_AIR_JUMP_IMPULSE, 'jump_aerial_y']] as const) {
      expect(impulse / 5).toBeCloseTo(Math.sqrt(2 * g * native(field)) + g / 2, 12);
      expect(stepDonkeyKongOrdinaryVertical({ velocityY: -impulse }) / -5)
        .toBeCloseTo(Math.sqrt(2 * g * native(field)) - g / 2, 12);
    }
  });

  it('fits the sourced first-four-step height and continues continuously into ballistic remaining height', () => {
    const native = nativeParameters(), velocities = DONKEYKONG_ORDINARY_VERTICAL_PROFILE.fullHopStepVelocitiesY;
    expect(velocities).toHaveLength(4);
    expect(-velocities.reduce((a, b) => a + b, 0)).toBeCloseTo(native('jump_initial_y') * 5, 10);
    let y = 0, velocity = 0, peak = 0;
    for (let step = 0; step < 100; step++) {
      const previous = velocity;
      velocity = stepDonkeyKongOrdinaryVertical({ velocityY: velocity, fullHopStep: step });
      if (step === 4) expect(velocity - previous).toBeCloseTo(native('air_accel_y') * 5, 12);
      y += velocity; peak = Math.max(peak, -y);
    }
    // Published midpoint formula leaves <.001px discrete apex error; the curve
    // is an authored fit, never independently recovered native acceleration.
    expect(Math.abs(peak - native('jump_y') * 5)).toBeLessThan(.001);
    expect(peak).toBeCloseTo(169.999852635158, 9);
  });

  it('returns to ordinary gravity at any interrupted initial-step boundary', () => {
    for (let step = 0; step < 4; step++) {
      const velocity = stepDonkeyKongOrdinaryVertical({ velocityY: 0, fullHopStep: step });
      expect(stepDonkeyKongOrdinaryVertical({ velocityY: velocity }) - velocity).toBeCloseTo(.425, 12);
      expect(stepDonkeyKongOrdinaryVertical({ velocityY: velocity, fullHopStep: step, frozen: true })).toBe(velocity);
    }
  });

  it('owns the complete gravity dose across different Matter world gravities', () => {
    const desired = stepDonkeyKongOrdinaryVertical({ velocityY: -10 });
    for (const matterGravity of [0, 5 / 18, .8, -.2]) {
      expect(donkeyKongVerticalPrePhysicsVelocity(desired, matterGravity) + matterGravity).toBeCloseTo(-9.575, 12);
    }
    expect(donkeyKongVerticalPrePhysicsVelocity(-38.473691966570634, 5 / 18) + 5 / 18)
      .toBeCloseTo(-38.473691966570634, 12);
  });

  it('caps ordinary fall, applies instant fast fall and relaxes excess fall gradually', () => {
    expect(stepDonkeyKongOrdinaryVertical({ velocityY: 8 })).toBe(DONKEYKONG_FALL_SPEED);
    expect(stepDonkeyKongOrdinaryVertical({ velocityY: 0, fastFall: true })).toBe(DONKEYKONG_FAST_FALL_SPEED);
    expect(stepDonkeyKongOrdinaryVertical({ velocityY: 13.04, relaxExcessFall: true })).toBeCloseTo(12.965, 12);
    expect(stepDonkeyKongOrdinaryVertical({ velocityY: 8.16, relaxExcessFall: true })).toBe(DONKEYKONG_FALL_SPEED);
    expect(stepDonkeyKongOrdinaryVertical({ velocityY: 7, relaxExcessFall: true })).toBeCloseTo(7.425, 12);
  });

  it('an interrupted opening carries the ordinary speed that rises the rest of the full hop', () => {
    const profile = DONKEYKONG_ORDINARY_VERTICAL_PROFILE, samples = profile.fullHopStepVelocitiesY;
    expect(donkeyKongFullHopCarriedVelocityY(profile, samples.length)).toBe(samples[samples.length - 1]);
    for (let consumed = 1; consumed < samples.length; consumed++) {
      let y = samples.slice(0, consumed).reduce((sum, v) => sum + v, 0), top = y;
      let vy = donkeyKongFullHopCarriedVelocityY(profile, consumed);
      expect(vy).toBeGreaterThan(samples[consumed - 1]!);
      for (let i = 0; i < 80; i++) { vy = stepDonkeyKongOrdinaryVertical({ velocityY: vy }); y += vy; top = Math.min(top, y); }
      expect(-top).toBeCloseTo(DONKEYKONG_VERTICAL_PARAMETERS.fullHopHeightNative * 5, 2);
    }
  });

  it('keeps full-footstool beta basis separate from the large authored initial full-hop step', () => {
    expect(DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS).toBe(14.305555555555552);
    expect(DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS)
      .toBeLessThan(Math.abs(DONKEYKONG_ORDINARY_VERTICAL_PROFILE.fullHopStepVelocitiesY[0]!));
  });
});
