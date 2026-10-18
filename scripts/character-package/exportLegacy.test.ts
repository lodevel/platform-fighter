import { describe, expect, it } from 'vitest';
import { canonicalJson, withRevision } from '../../character/package/canonical';
import { isEffectAction } from '../../character/package/types';
import { exportFighter } from './exportLegacy';
import { EXPORTED_FIGHTERS } from './legacyClips';

describe('legacy character export', () => {
  it.each(EXPORTED_FIGHTERS)('%s matches the game at every tick and validates', async fighter => {
    const { pkg, report } = exportFighter(fighter);
    expect(report.problems).toEqual([]);
    expect(report.validation).toEqual([]);
    expect(report.verifiedTicks).toBeGreaterThan(400_000);
    // Only DK's three clips without timing data stay out; every effect strip is an `effect.` action.
    expect(report.skipped.map(s => s.clip)).toEqual(fighter === 'donkeykong' ? ['attack', 'up_special', 'review_legacy_grab'] : []);
    expect(Object.keys(pkg.actions).filter(isEffectAction).length).toBe({ donkeykong: 5, link: 3, pikachu: 4 }[fighter]);
    const text = canonicalJson(await withRevision(pkg));
    expect(canonicalJson(JSON.parse(text))).toBe(text);
    expect(canonicalJson(await withRevision(exportFighter(fighter).pkg))).toBe(text);
  }, 60_000);
});
