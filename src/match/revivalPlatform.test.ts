import { describe, expect, it } from 'vitest';
import {
  REVIVAL_PLATFORM_MAX_FRAMES,
  isRevivalDismountInput,
  revivalDismountInvincibilityFrames,
} from './revivalPlatform';

// SmashWiki Revival platform (https://www.ssbwiki.com/Revival_platform): the platform waits at most 5 seconds; after
// dropping off, invincibility is 120 frames in earlier games and, in Ultimate, "decreased proportionally to the amount of
// time the player spent waiting on the platform (the minimum being 1 second, or 60 frames)".
describe('revival platform (SmashWiki Revival platform)', () => {
  it('holds at most 300 frames (5 seconds)', () => {
    expect(REVIVAL_PLATFORM_MAX_FRAMES).toBe(300);
  });

  it('grants 120 frames on an immediate dismount, 60 at the 300-frame expiry, linearly between', () => {
    expect(revivalDismountInvincibilityFrames(0)).toBe(120);
    expect(revivalDismountInvincibilityFrames(150)).toBe(90);
    expect(revivalDismountInvincibilityFrames(300)).toBe(60);
    expect(revivalDismountInvincibilityFrames(1000)).toBe(60);
  });

  it('any stick movement or button press dismounts; a neutral input waits', () => {
    const neutral = { moveX: 0, moveY: 0, jump: false };
    expect(isRevivalDismountInput(neutral)).toBe(false);
    expect(isRevivalDismountInput({ ...neutral, moveX: 0.05 })).toBe(false);
    for (const input of [{ moveX: -1 }, { moveY: 1 }, { jump: true }, { attack: true }, { attackHeavy: true },
      { special: true }, { shield: true }, { dodge: true }, { grab: true }, { appeal: true }])
      expect(isRevivalDismountInput({ ...neutral, ...input })).toBe(true);
  });
});
