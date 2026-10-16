import type { MatchConfig } from '../types';
import { resolveItemFrequency } from '../items/itemSpawnSettings';

/**
 * Ultimate's 1v1 multiplier. SmashWiki "1v1 multiplier": "When a match is started with only two
 * players and items off, characters take 1.2× damage from all sources. It does not activate if a
 * match is started with more than 2 players and items off, even after two players are left
 * standing." It changes damage taken only: not knockback, hitstun, hitlag, shieldstun, KO
 * thresholds or shield damage. https://www.ssbwiki.com/1v1_multiplier
 *
 * Pure function of the match-start config, which replay files record verbatim (`matchConfig`
 * with `players` and `itemFrequency`), so a replay re-derives the same rule.
 */
export const ONE_ON_ONE_DAMAGE_TAKEN_MULTIPLIER = 1.2;

export function oneOnOneDamageTakenMultiplier(config: Pick<MatchConfig, 'players' | 'itemFrequency'>): number {
  return config.players.length === 2 && resolveItemFrequency(config.itemFrequency) === 'off'
    ? ONE_ON_ONE_DAMAGE_TAKEN_MULTIPLIER : 1;
}
