import { NEW_MATCH_FINAL_RULES, type FinalSmashRules } from '../finalSmash/finalSmashSchema';
import type { ItemSwitch } from '../items/itemCatalog';
import {
  DEFAULT_MODE_SELECT_STATE, STOCK_OPTIONS, TIME_LIMIT_OPTIONS, cycleMode, cycleQuantity, type ModeSelectState,
} from './modeSelect';
import type { ItemFrequency, MatchConfig } from '../types';

/**
 * The match rules the mode-select screen edits beyond `ModeSelectState`:
 * item frequency, Item Switch and Final Smash rules.
 *
 * Shared by the 3D menus' Rules screen and the Phaser ModeSelectScene
 * (until Phaser goes in step 9).
 */
export interface MatchRules {
  readonly shape: ModeSelectState;
  readonly itemFrequency: ItemFrequency;
  readonly itemSwitch: ItemSwitch;
  readonly finalRules: FinalSmashRules;
}

export const ITEM_FREQUENCIES: readonly ItemFrequency[] = ['off', 'low', 'med', 'high'];

export const DEFAULT_MATCH_RULES: MatchRules = Object.freeze({
  shape: DEFAULT_MODE_SELECT_STATE,
  itemFrequency: 'med',
  itemSwitch: Object.freeze({}),
  finalRules: NEW_MATCH_FINAL_RULES,
});

/** Rules from a pending config (coming back from a later screen). */
export function rulesFromConfig(config: Partial<MatchConfig> | undefined): MatchRules {
  if (!config) return DEFAULT_MATCH_RULES;
  const finalRules = config.finalSmashRules ?? NEW_MATCH_FINAL_RULES;
  return Object.freeze({
    shape: {
      mode: config.mode ?? DEFAULT_MODE_SELECT_STATE.mode,
      stockIndex: Math.max(0, STOCK_OPTIONS.indexOf(config.stockCount ?? 3)),
      timeIndex: Math.max(0, TIME_LIMIT_OPTIONS.indexOf(config.timeLimitSeconds ?? 180)),
    },
    itemFrequency: config.itemFrequency ?? 'med',
    itemSwitch: Object.freeze({ ...config.itemSwitch, ...(finalRules.smashBallEnabled ? {} : { SmashBall: false }) }),
    finalRules,
  });
}

export const cycleRulesMode = (r: MatchRules, d: number): MatchRules => ({ ...r, shape: cycleMode(r.shape, d) });
export const cycleRulesQuantity = (r: MatchRules, d: number): MatchRules => ({ ...r, shape: cycleQuantity(r.shape, d) });

export function cycleItemFrequency(r: MatchRules, d: number): MatchRules {
  const n = ITEM_FREQUENCIES.length;
  return { ...r, itemFrequency: ITEM_FREQUENCIES[(ITEM_FREQUENCIES.indexOf(r.itemFrequency) + d + n) % n]! };
}

export const toggleFinalMeter = (r: MatchRules): MatchRules =>
  ({ ...r, finalRules: Object.freeze({ ...r.finalRules, meterEnabled: !r.finalRules.meterEnabled }) });

export const isItemEnabled = (r: MatchRules, type: string): boolean => r.itemSwitch[type] !== false;

/** Toggle one Item Switch entry; the Smash Ball entry also drives the Final rules. */
export function toggleItem(r: MatchRules, type: string): MatchRules {
  const on = !isItemEnabled(r, type);
  return {
    ...r,
    itemSwitch: Object.freeze({ ...r.itemSwitch, [type]: on }),
    finalRules: type === 'SmashBall' ? Object.freeze({ ...r.finalRules, smashBallEnabled: on }) : r.finalRules,
  };
}

/** The config fields these rules own, to merge into the pending match config. */
export function rulesConfigFields(r: MatchRules): Pick<MatchConfig, 'itemFrequency' | 'itemSwitch' | 'finalSmashRules'> {
  return { itemFrequency: r.itemFrequency, itemSwitch: r.itemSwitch, finalSmashRules: r.finalRules };
}
