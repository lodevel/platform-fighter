import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DONKEYKONG_TAUNTS } from './donkeykongTaunts';
import { validateTauntSet } from './tauntSchema';

describe('DK sourced taunt action clock and independent native drawing lifetime', () => {
  it('derives every facing cancellation from native motion and presentation from retained authenticated animation extents', () => {
    const raw = readFileSync('docs/review/2026-10-06/dk-all-attack-values/sources/motion-list.yml', 'utf8');
    const receipt = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/taunt-native-clip-extents.json', 'utf8')) as {
      motions: { selector: string; path: string; sha256: string; nativeLastSample: number; presentationFrames: number }[];
    };
    expect(receipt.motions).toHaveLength(6);
    for (const kind of ['up', 'side', 'down'] as const) for (const facing of ['r', 'l']) {
      const selector = `appeal_${kind === 'up' ? 'hi' : kind === 'side' ? 's' : 'lw'}_${facing}`;
      const block = new RegExp(`^  ${selector}:\\n([\\s\\S]*?)(?=^  \\w+:)`, 'm').exec(raw)![1]!;
      expect(DONKEYKONG_TAUNTS[kind].cancelAfterFrames).toBe(Number(/cancel_frame: (\d+)/.exec(block)![1]) - 1);
      const motion = receipt.motions.find(row => row.selector === selector)!;
      expect(createHash('sha256').update(readFileSync(motion.path)).digest('hex')).toBe(motion.sha256);
      expect(DONKEYKONG_TAUNTS[kind].presentationFrames).toBe(motion.nativeLastSample + 1);
    }
    expect(() => validateTauntSet(DONKEYKONG_TAUNTS)).not.toThrow();
  });
});
