import { describe, expect, it } from 'vitest';
import { canonicalJson, withRevision } from '../../character/package/canonical';
import { exportFighter } from './exportLegacy';
import { EXPORTED_FIGHTERS } from './legacyClips';

describe('legacy character export', () => {
  it.each(EXPORTED_FIGHTERS)('%s matches the game at every tick and validates', async fighter => {
    const { pkg, report } = exportFighter(fighter);
    expect(report.problems).toEqual([]);
    expect(report.validation).toEqual([]);
    expect(report.verifiedTicks).toBeGreaterThan(400_000);
    // Only effect strips and DK's three clips without timing data stay out.
    expect(report.skipped.filter(s => !s.clip.startsWith('fx__')).map(s => s.clip))
      .toEqual(fighter === 'donkeykong' ? ['attack', 'up_special', 'review_legacy_grab'] : []);
    const text = canonicalJson(await withRevision(pkg));
    expect(canonicalJson(JSON.parse(text))).toBe(text);
    expect(canonicalJson(await withRevision(exportFighter(fighter).pkg))).toBe(text);
  }, 60_000);
});
