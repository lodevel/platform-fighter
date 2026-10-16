import { describe, expect, it } from 'vitest';
import type { MatchConfig } from '../types';
import { MatchRulesController } from './MatchRulesController';
import { StockTracker } from './StockTracker';
import { MatchStatsTracker } from './MatchStatsTracker';
import { MatchEndDetector } from './MatchEndDetector';

function match(mode: 'stocks' | 'time', stockCount = 3, playerCount = 2) {
  const config: MatchConfig = {
    mode, stockCount, timeLimitSeconds: 1, stageId: 'flat', rngSeed: 12,
    players: Array.from({ length: playerCount }, (_, i) => ({ index: (i + 1) as 1 | 2 | 3 | 4, characterId: 'link', paletteIndex: 0, inputType: 'ai' })),
  };
  const stocks = new StockTracker({ playerCount, ...MatchRulesController.stockOptions(config), respawnDelayFrames: 2 });
  const stats = new MatchStatsTracker({ playerCount });
  return { stocks, stats, rules: new MatchRulesController(config, stocks, stats) };
}

describe('live match rules', () => {
  it.each([1, 5])('ends a %i-stock match on the chosen final loss', count => {
    const { stocks, rules } = match('stocks', count);
    expect(stocks.initialStocks).toBe(count);
    for (let i = 0; i < count; i++) {
      stocks.loseStock(1, i * 3);
      stocks.consumePendingRespawns(i * 3 + 2);
      const event = rules.update(i * 3 + 2);
      expect(event).toEqual(i === count - 1 ? { kind: 'finished', winnerIndex: 0 } : null);
    }
  });

  it('respawns indefinitely in Time without duplicate fall events during respawn', () => {
    const { stocks, rules } = match('time');
    for (let frame = 0; frame < 15; frame += 3) {
      expect(stocks.loseStock(1, frame).eliminated).toBe(false);
      expect(stocks.loseStock(1, frame).respawnFrame).toBe(frame + 2);
      expect(stocks.consumePendingRespawns(frame + 2)).toHaveLength(1);
      expect(rules.update(frame + 2)).toBeNull();
    }
    expect(stocks.getStocks(1)).toBe(1);
  });

  it('resolves the score on precisely the 60th step, then preserves the ending hold', () => {
    const { stocks, stats, rules } = match('time');
    stats.recordDamage(0, 1, 10, 20);
    stats.recordStockLoss(1, 25);
    const end = new MatchEndDetector(stocks, { detectStockElimination: false, endingDurationFrames: 3, statsTracker: stats });
    for (let frame = 0; frame < 59; frame++) expect(rules.update(frame)).toBeNull();
    expect(rules.getSecondsRemaining()).toBe(1);
    const event = rules.update(59);
    expect(event).toEqual({ kind: 'finished', winnerIndex: 0 });
    expect(rules.getSecondsRemaining()).toBe(0);
    end.finish(59, 0, { mode: 'time', scores: rules.getScores(59) });
    expect(end.getPhase()).toBe('ending');
    expect(end.getResultPayload()?.scores).toEqual([1, -1]);
    end.update(61);
    expect(end.consumeShouldTransition()).toBe(false);
    end.update(62);
    expect(end.consumeShouldTransition()).toBe(true);
    expect(end.consumeShouldTransition()).toBe(false);
    expect(rules.update(62)).toBeNull();
  });

  it('a self-destruct costs a point without awarding an opponent KO', () => {
    const { stats, rules } = match('time');
    stats.recordStockLoss(0, 10);
    expect(rules.update(59)).toEqual({ kind: 'finished', winnerIndex: 1 });
    expect(rules.getScores(59)).toEqual([-1, 0]);
  });

  it('only tied leaders enter one-stock sudden death, with original time scores retained', () => {
    const { stocks, stats, rules } = match('time', 5, 4);
    stats.recordStockLoss(1, 10);
    stats.recordStockLoss(3, 11);
    expect(rules.update(59)).toEqual({ kind: 'suddenDeath', participants: [0, 2] });
    expect([0, 1, 2, 3].map(i => stocks.getStocks(i))).toEqual([1, 0, 1, 0]);
    expect(rules.update(59)).toBeNull();
    expect(rules.update(60)).toBeNull();
    stocks.loseStock(2, 61);
    stats.recordStockLoss(2, 61);
    expect(rules.update(61)).toEqual({ kind: 'finished', winnerIndex: 0 });
    expect(rules.getScores(61)).toEqual([0, -1, 0, -1]);
    expect(rules.isSuddenDeath()).toBe(true);
  });

  it('simultaneous final falls produce a draw rather than an arbitrary winner', () => {
    const { stocks, rules } = match('stocks', 1);
    stocks.loseStock(0, 2); stocks.loseStock(1, 2);
    expect(rules.update(2)).toEqual({ kind: 'finished', winnerIndex: null });
  });

  it('resetting a Time tracker after sudden death restores unlimited respawns', () => {
    const { stocks, rules } = match('time');
    rules.update(59);
    stocks.loseStock(1, 60);
    expect(stocks.getStocks(1)).toBe(0);
    stocks.reset();
    expect(stocks.loseStock(1, 0).eliminated).toBe(false);
    expect(stocks.consumePendingRespawns(2)).toHaveLength(1);
  });

  it('new-round credit reset preserves scores and does not credit an old attack', () => {
    const { stats } = match('time');
    stats.recordDamage(0, 1, 10, 10);
    stats.clearAttribution();
    stats.recordStockLoss(1, 20);
    expect(stats.getAllStats(20).map(s => ({ kos: s.kos, deaths: s.deaths, damage: s.damageDealt })))
      .toEqual([{ kos: 0, deaths: 0, damage: 10 }, { kos: 0, deaths: 1, damage: 0 }]);
  });
});
