import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePikachuFootstools, type FootstoolParticipant } from './pikachuFootstool';
import { DONKEYKONG_FOOTSTOOL_PARAMETERS, donkeyKongFootstoolContactProfile,
  donkeyKongFootstoolJumpVelocity, resolvePikachuAndDonkeyKongFootstools,
  canDonkeyKongFootstoolJump, DONKEYKONG_FOOTSTOOL_REPEAT_RULES } from './donkeykongFootstool';

function jumper(playerIndex: number, characterId = 'donkeykong', x = 0): FootstoolParticipant {
  return { playerIndex, characterId, x, y: 50, feetY: 95, velocityY: 1,
    head: { x, top: 20 }, freshJump: true, mayJump: true, mayReceive: true,
    attacking: false, grounded: false };
}
function target(playerIndex: number, x = 0): FootstoolParticipant {
  return { ...jumper(playerIndex, 'link', x), y: 140, feetY: 180,
    head: { x, top: 100 }, freshJump: false, grounded: true };
}
describe('DK source tread rules and combined deterministic footstool resolver', () => {
  it('binds every DK native scalar to the independent pinned fighter table entry', () => {
    const raw = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
    const entry = raw.struct.list.struct[1];
    expect(entry.hash40.find((row: { '@hash': string }) => row['@hash'] === 'fighter_kind')['#text']).toBe('fighter_kind_donkey');
    const scalar = (name: string) => Number(entry.float.find((row: { '@hash': string }) => row['@hash'] === name)['#text']);
    const integer = (name: string) => Number(entry.int.find((row: { '@hash': string }) => row['@hash'] === name)['#text']);
    expect(DONKEYKONG_FOOTSTOOL_PARAMETERS).toEqual({ jumpSpeedYMultiplier: scalar('tread_jump_speed_y_mul'),
      miniJumpSpeedYMultiplier: scalar('tread_mini_jump_speed_y_mul'), rangeOffsetY: scalar('tread_range_offset_y'),
      rangeWidth: scalar('tread_range_w'), rangeHeight: scalar('tread_range_h'),
      additionalRangeWidth: scalar('tread_range_add_w'), additionalRangeHeight: scalar('tread_range_add_h'),
      airRecipientRecoveryFrames: integer('tread_fall_recovery_frame'), postAttackLockoutFrames: 16 });
  });
  it('uses DK base-width20 rather than silently inheriting Pika15, with exact authored contact boundaries', () => {
    expect(donkeyKongFootstoolContactProfile()).toEqual({ halfWidthPixels: 20, halfHeightPixels: 15, headOffsetPixelsY: 5 });
    expect(resolvePikachuAndDonkeyKongFootstools([jumper(0, 'donkeykong', 20), target(1)])).toHaveLength(1);
    expect(resolvePikachuAndDonkeyKongFootstools([jumper(0, 'donkeykong', 20.001), target(1)])).toHaveLength(0);
    expect(resolvePikachuAndDonkeyKongFootstools([{ ...jumper(0), feetY: 110 }, target(1)])).toHaveLength(1);
    expect(resolvePikachuAndDonkeyKongFootstools([{ ...jumper(0), feetY: 110.001 }, target(1)])).toHaveLength(0);
    expect(resolvePikachuAndDonkeyKongFootstools([jumper(0, 'pikachu', 20), target(1)])).toHaveLength(0);
  });
  it('retains prior Pika outcomes/order for its supported snapshots, including phantom and rejected contacts', () => {
    const fixtures = [[jumper(2, 'pikachu'), target(1), target(3)],
      [jumper(2, 'pikachu'), { ...target(1), attacking: true }],
      [{ ...jumper(2, 'pikachu'), velocityY: -1 }, target(1)],
      [jumper(2, 'pikachu', 16), target(1)]];
    for (const participants of fixtures) {
      expect(resolvePikachuAndDonkeyKongFootstools(participants)).toEqual(resolvePikachuFootstools(participants));
    }
  });
  it('resolves mixed DK/Pika conflicts once from globally ordered participants, independent of source snapshot order', () => {
    const participants = [jumper(2, 'pikachu'), target(3), jumper(0)];
    const expected = [{ jumperIndex: 0, recipientIndex: 3, phantom: false, groundedRecipient: true }];
    expect(resolvePikachuAndDonkeyKongFootstools(participants)).toEqual(expected);
    expect(resolvePikachuAndDonkeyKongFootstools([...participants].reverse())).toEqual(expected);
    expect(resolvePikachuAndDonkeyKongFootstools([jumper(0, 'link'), target(1)])).toHaveLength(0);
  });
  it('retains phantom no-recipient-interruption flag and blocks DK during its source post-attack cooldown', () => {
    expect(resolvePikachuAndDonkeyKongFootstools([jumper(0), { ...target(1), attacking: true }]))
      .toEqual([{ jumperIndex: 0, recipientIndex: 1, phantom: true, groundedRecipient: true }]);
    expect(resolvePikachuAndDonkeyKongFootstools([{ ...jumper(0), footstoolAttackLockoutRemaining: 1 }, target(1)])).toHaveLength(0);
    expect(resolvePikachuAndDonkeyKongFootstools([{ ...jumper(0), footstoolAttackLockoutRemaining: 0 }, target(1)])).toHaveLength(1);
  });
  it('keeps source full/mini multipliers distinct and reduces repeated velocity by the published factor', () => {
    expect(donkeyKongFootstoolJumpVelocity(10)).toBe(-13);
    expect(donkeyKongFootstoolJumpVelocity(10, true)).toBe(-7);
    const first = donkeyKongFootstoolJumpVelocity(10), second = donkeyKongFootstoolJumpVelocity(10, false, 1);
    expect(second / first).toBeCloseTo(.75);
    expect(second * second / (first * first)).toBeCloseTo(.5625);
    expect(() => donkeyKongFootstoolJumpVelocity(0)).toThrow();
  });
  it('rejects the next computed speed strictly below the published native minimum', () => {
    const minimumBasis = .5 * 5 / 1.3;
    expect(canDonkeyKongFootstoolJump(minimumBasis)).toBe(true);
    expect(canDonkeyKongFootstoolJump(minimumBasis - .0001)).toBe(false);
    expect(canDonkeyKongFootstoolJump(minimumBasis, 1)).toBe(false);
    for (let count = 0; count < 12; count++) {
      const independentSpeedNative = 14.305555555555552 * 1.3 * .75 ** count / 5;
      expect(canDonkeyKongFootstoolJump(14.305555555555552, count))
        .toBe(independentSpeedNative >= .5);
    }
  });
  it('keeps the source eight-step cooldown distinct from post-attack lockout', () => {
    expect(DONKEYKONG_FOOTSTOOL_REPEAT_RULES.cooldownFrames).toBe(8);
    for (let remaining = 8; remaining > 0; remaining--)
      expect(canDonkeyKongFootstoolJump(10, 0, remaining)).toBe(false);
    expect(canDonkeyKongFootstoolJump(10, 0, 0)).toBe(true);
    expect(() => canDonkeyKongFootstoolJump(10, 0, -1)).toThrow();
    const captured = readFileSync('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/sources/jump-page75.web.json', 'utf8');
    expect(captured).toContain('0.75');
    expect(captured).toContain('0.5');
    expect(captured).toContain('8F');
  });
});
