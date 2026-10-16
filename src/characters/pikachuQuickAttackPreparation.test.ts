import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PIKACHU_QUICK_ATTACK_HISTORICAL_PARAMETERS as params, PIKACHU_QUICK_ATTACK_HISTORICAL_SOURCE as source,
  PIKACHU_QUICK_ATTACK_BINARY_FIXTURE_PARAMETERS as binaryParams, PIKACHU_QUICK_ATTACK_BINARY_FIXTURE_SOURCE as binarySource,
  preparePikachuAirborneWarp, preparePikachuSecondWarpCheck, preparePikachuWarpBranch, preparePikachuWarpCounter } from './pikachuQuickAttackPreparation';

describe('independent historical Quick Attack preparation, outside runtime', () => {
  it('compares all six used values and hashes with original Ultimate CSV, not the Smash4 column', () => {
    const bytes = readFileSync('docs/review/2026-10-06/pikachu-character/sources/native-vl-sheet-pikachu.csv');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.csvSha256);
    const rows = JSON.parse(readFileSync('docs/review/2026-10-06/pikachu-character/sources/native-vl-sheet-pikachu.json', 'utf8')).rows;
    for (const [key, hash] of Object.entries(source.fields)) {
      const row = rows.find((row: { hash40: string }) => row.hash40 === hash);
      expect(row.ultimate_value).toBe(params[key as keyof typeof params]);
      const raw = row.ultimate_raw as string;
      expect(raw.startsWith('0x') ? Number.parseInt(raw.slice(2), 16) : Number(raw)).toBe(row.ultimate_value);
    }
    expect(source.gamePatch).toBeNull();
    expect(source.productionQualified).toBe(false);
  });

  it('retains actual binary typed values/Float32 bytes and keeps provenance gates separate from mapping', () => {
    const binary = readFileSync('docs/review/2026-10-06/pikachu-character/sources/native-vl-prcrs-pikachu.prc');
    expect(createHash('sha256').update(binary).digest('hex')).toBe(binarySource.sha256);
    const comparison = JSON.parse(readFileSync('docs/review/2026-10-06/pikachu-character/sources/native-vl-prcrs-sheet-comparison.json', 'utf8'));
    for (const [key, hash] of Object.entries(source.fields)) {
      const row = comparison.rows.find((row: { hash40: string }) => row.hash40 === hash);
      const expected = binaryParams[key as keyof typeof binaryParams];
      expect(row.native_group).toBe('param_special_hi');
      expect(row.native_list_index).toBe(0);
      expect(row.native_value).toBe(expected);
      expect(row.matches_at_native_storage_precision).toBe(true);
      if (row.native_type === 'Float') {
        expect(binary.readFloatLE(row.native_offset + 1)).toBe(expected);
        expect(`0x${binary.readUInt32LE(row.native_offset + 1).toString(16).padStart(8, '0')}`).toBe(row.float32_bits);
      } else {
        expect(row.native_type).toBe('I32');
        expect(binary.readInt32LE(row.native_offset + 1)).toBe(expected);
      }
    }
    expect(binaryParams.secondSpeedMultiplier).not.toBe(params.secondSpeedMultiplier);
    expect(Math.fround(params.secondSpeedMultiplier)).toBe(binaryParams.secondSpeedMultiplier);
    expect(binarySource).toMatchObject({ gamePatch: null, unmodifiedVanillaVerified: false, productionQualified: false });
  });

  it.each([1, -1] as const)('uses absolute raw directions and separate11/9.9 speeds with facing%s', facing => {
    const first = preparePikachuAirborneWarp({ x: facing, y: 0 }, 0, facing, params);
    expect(first.velocity).toEqual({ x: facing * 11, y: 0 });
    const second = preparePikachuAirborneWarp({ x: -facing, y: 0 }, 1, facing, params);
    expect(second.velocity.x).toBeCloseTo(-facing * 9.9);
    expect(second.facing).toBe(-facing);
    expect(preparePikachuSecondWarpCheck(first.direction, { x: -facing, y: 0 }, 1, params).accepted).toBe(true);
  });

  it('defaults weak/neutral airborne input upward, preserves vertical facing and includes stick0.5', () => {
    for (const stick of [{ x: 0, y: 0 }, { x: 0.499, y: 0 }]) {
      expect(preparePikachuAirborneWarp(stick, 0, -1, params)).toMatchObject({ velocity: { x: 0, y: 11 }, facing: -1 });
    }
    expect(preparePikachuAirborneWarp({ x: 0.5, y: 0 }, 0, -1, params)).toMatchObject({ velocity: { x: 11, y: 0 }, facing: 1 });
    expect(preparePikachuSecondWarpCheck({ x: 1, y: 0 }, { x: 0, y: 0.5 }, 1, params).accepted).toBe(true);
    expect(preparePikachuSecondWarpCheck({ x: 1, y: 0 }, { x: 0, y: 0.499 }, 1, params).accepted).toBe(false);
  });

  it('rejects same direction and small turns, allows turns above35, and preserves strict angle inequality', () => {
    const previous = { x: 1, y: 0 };
    for (const degrees of [0, 34, 34.999]) {
      const angle = degrees * Math.PI / 180;
      expect(preparePikachuSecondWarpCheck(previous, { x: Math.cos(angle), y: Math.sin(angle) }, 1, params).accepted).toBe(false);
    }
    const above = 35.001 * Math.PI / 180;
    expect(preparePikachuSecondWarpCheck(previous, { x: Math.cos(above), y: Math.sin(above) }, 1, params).accepted).toBe(true);
    // Exact right-angle fixture establishes strictness without claiming f32
    // vec2_angle parity at the historical35degree floating-point boundary.
    expect(preparePikachuSecondWarpCheck(previous, { x: 0, y: 1 }, 1, { ...params, secondAngleDegrees: 90 }).accepted).toBe(false);
  });

  it('consumes the one phase1 opportunity after rejected input and prevents later/third bursts', () => {
    const previous = { x: 1, y: 0 }, changed = { x: 0, y: 1 };
    expect(preparePikachuWarpBranch(0, previous, changed, 1, params)).toEqual({ phase: 0, enterWarp: false });
    const rejected = preparePikachuWarpBranch(1, previous, previous, 1, params);
    expect(rejected).toEqual({ phase: 2, enterWarp: false });
    expect(preparePikachuWarpBranch(rejected.phase as 2, previous, changed, 1, params).enterWarp).toBe(false);
    expect(preparePikachuWarpBranch(1, previous, changed, 1, params).enterWarp).toBe(true);
    expect(preparePikachuWarpBranch(1, previous, changed, 2, params)).toEqual({ phase: 2, enterWarp: false });
  });

  it('freezes native countdown under explicit stop and ends below0 without inferring travel steps', () => {
    let counter = params.moveCounterInitial;
    for (let i = 0; i < 20; i++) expect(preparePikachuWarpCounter(counter, true)).toEqual({ counter: 5, enterEnd: false });
    for (let expected = 4; expected >= 0; expected--) {
      const next = preparePikachuWarpCounter(counter, false);
      expect(next).toEqual({ counter: expected, enterEnd: false }); counter = next.counter;
    }
    expect(preparePikachuWarpCounter(counter, false)).toEqual({ counter: -1, enterEnd: true });
  });

  it('rejects missing/invalid directions and params instead of supplying roster defaults', () => {
    expect(() => preparePikachuSecondWarpCheck({ x: 0, y: 0 }, { x: 0, y: 1 }, 1, params)).toThrow('previous applied');
    expect(() => preparePikachuAirborneWarp({ x: NaN, y: 0 }, 0, 1, params)).toThrow('finite');
    expect(() => preparePikachuAirborneWarp({ x: 1, y: 0 }, 0, 1, { ...params, speedAdd: NaN })).toThrow('parameter bundle');
    expect(() => preparePikachuWarpCounter(1.5, false)).toThrow('integer');
  });
});
