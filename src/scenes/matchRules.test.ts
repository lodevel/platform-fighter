import { describe, expect, it } from 'vitest';
import { NEW_MATCH_FINAL_RULES } from '../finalSmash/finalSmashSchema';
import {
  DEFAULT_MATCH_RULES, cycleItemFrequency, isItemEnabled, rulesConfigFields, rulesFromConfig, toggleFinalMeter, toggleItem,
} from './matchRules';

describe('matchRules', () => {
  it('starts fresh matches with a visible enabled meter, preserving explicit disabled rules', () => {
    expect(DEFAULT_MATCH_RULES.finalRules.meterEnabled).toBe(true);
    expect(rulesConfigFields(DEFAULT_MATCH_RULES).finalSmashRules?.meterEnabled).toBe(true);
    expect(rulesFromConfig({ mode: 'stocks', stockCount: 3,
      finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false } }).finalRules)
      .toEqual({ schemaVersion: 1, meterEnabled: false, smashBallEnabled: false });
  });
  it('cycles item frequency both ways and wraps', () => {
    expect(cycleItemFrequency(DEFAULT_MATCH_RULES, 1).itemFrequency).toBe('high');
    expect(cycleItemFrequency(cycleItemFrequency(DEFAULT_MATCH_RULES, 1), 1).itemFrequency).toBe('off');
    expect(cycleItemFrequency(DEFAULT_MATCH_RULES, -1).itemFrequency).toBe('low');
  });

  it('toggles the Final Smash meter without touching the Smash Ball rule', () => {
    const r = toggleFinalMeter(DEFAULT_MATCH_RULES);
    expect(r.finalRules.meterEnabled).toBe(!NEW_MATCH_FINAL_RULES.meterEnabled);
    expect(r.finalRules.smashBallEnabled).toBe(NEW_MATCH_FINAL_RULES.smashBallEnabled);
  });

  it('switches items off and on; the Smash Ball entry drives the Final rules', () => {
    const off = toggleItem(DEFAULT_MATCH_RULES, 'SmashBall');
    expect(isItemEnabled(off, 'SmashBall')).toBe(false);
    expect(off.finalRules.smashBallEnabled).toBe(false);
    expect(toggleItem(off, 'SmashBall').finalRules.smashBallEnabled).toBe(true);
    expect(isItemEnabled(toggleItem(DEFAULT_MATCH_RULES, 'homeRunBat'), 'homeRunBat')).toBe(false);
  });

  it('round-trips through a pending match config', () => {
    const edited = toggleItem(cycleItemFrequency(toggleFinalMeter(DEFAULT_MATCH_RULES), 1), 'SmashBall');
    const back = rulesFromConfig({ mode: 'stocks', stockCount: 3, ...rulesConfigFields(edited) });
    expect(back.itemFrequency).toBe(edited.itemFrequency);
    expect(back.finalRules).toEqual(edited.finalRules);
    expect(isItemEnabled(back, 'SmashBall')).toBe(false);
  });
});
