import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DONKEYKONG_GROUND_MOVEMENT_PARAMETERS, stepDonkeyKongGroundVelocity } from './donkeykongGroundMovement';

describe('DK running and constant braking source adapter', () => {
  it('retains independently pinned native fighter parameters and experimental formula provenance', () => {
    const raw = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
    const entry = raw.struct.list.struct.find((row: { hash40: { '@hash': string; '#text': string }[] }) =>
      row.hash40.some(field => field['@hash'] === 'fighter_kind' && field['#text'] === 'fighter_kind_donkey'));
    const scalar = (name: string) => Number(entry.float.find((row: { '@hash': string }) => row['@hash'] === name)['#text']);
    expect(DONKEYKONG_GROUND_MOVEMENT_PARAMETERS).toEqual({ runAccelerationMultiplier: scalar('run_accel_mul'),
      runAccelerationAdd: scalar('run_accel_add'), runSpeedMaximum: scalar('run_speed_max'), groundBrake: scalar('ground_brake') });
    const receipt = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/movement-source-research.json', 'utf8'));
    expect(receipt.findings.walk).toContain('omits complex formula');
    expect(receipt.files.some((file: { url?: string }) => file.url === 'https://w.atwiki.jp/smashsp_kensyou/pages/94.html')).toBe(true);
  });

  it('applies native add plus analog mul per step, symmetrically', () => {
    expect(stepDonkeyKongGroundVelocity({ velocityX: 0, stickX: 1, phase: 'run' })).toBeCloseTo(.58685, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: 0, stickX: .5, phase: 'run' })).toBeCloseTo(.403425, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: 0, stickX: -1, phase: 'run' })).toBeCloseTo(-.58685, 8);
  });

  it('caps acceleration while decaying dash overspeed over distinct steps', () => {
    expect(stepDonkeyKongGroundVelocity({ velocityX: 9.2, stickX: 1, phase: 'run' })).toBeCloseTo(9.365, 8);
    const first = stepDonkeyKongGroundVelocity({ velocityX: 10.45, stickX: 1, phase: 'run' });
    expect(first).toBeCloseTo(9.835, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: first, stickX: 1, phase: 'run' })).toBeCloseTo(9.365, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: -10.45, stickX: -1, phase: 'run' })).toBeCloseTo(-9.835, 8);
  });

  it('uses constant traction through neutral/braking without sign overshoot', () => {
    expect(stepDonkeyKongGroundVelocity({ velocityX: 4, stickX: 0, phase: 'run' })).toBeCloseTo(3.385, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: -4, stickX: 1, phase: 'brake' })).toBeCloseTo(-3.385, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: .1, stickX: 0, phase: 'brake' })).toBe(0);
    expect(stepDonkeyKongGroundVelocity({ velocityX: -.1, stickX: 0, phase: 'brake' })).toBe(0);
  });

  it('leaves turn selection to caller and freezes all motion without draining velocity', () => {
    expect(stepDonkeyKongGroundVelocity({ velocityX: -3, stickX: 1, phase: 'run' })).toBeCloseTo(-2.41315, 8);
    expect(stepDonkeyKongGroundVelocity({ velocityX: 10.45, stickX: 1, phase: 'run', frozen: true })).toBe(10.45);
    expect(() => stepDonkeyKongGroundVelocity({ velocityX: 0, stickX: 1.1, phase: 'run' })).toThrow(RangeError);
  });
});
