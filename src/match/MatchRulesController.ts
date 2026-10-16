import type { MatchConfig } from '../types';
import { StockTracker, DEFAULT_STOCK_COUNT } from './StockTracker';
import type { MatchStatsTracker } from './MatchStatsTracker';
import { createMatchTimer, resolveTimeModeResult, MATCH_FPS } from './timeMode';

// One stock at 300% follows the Smash sudden-death starting rule.
// https://www.smashbros.com/wiiu-3ds/sp/us/howto/entry9.html
export const LIVE_SUDDEN_DEATH_PERCENT = 300;

export type MatchRuleEvent =
  | { readonly kind: 'suddenDeath'; readonly participants: ReadonlyArray<number> }
  | { readonly kind: 'finished'; readonly winnerIndex: number | null };

/** Live match rules, independent of scene rendering and wall-clock time. */
export class MatchRulesController {
  readonly mode: MatchConfig['mode'];
  readonly timeLimitFrames: number | null;
  private phase: 'playing' | 'suddenDeath' | 'finished' = 'playing';
  private lastFrame = -1;
  private timeScores: ReadonlyArray<number> | null = null;
  private suddenDeathStarted = false;

  constructor(
    config: MatchConfig,
    private readonly stocks: StockTracker,
    private readonly stats: MatchStatsTracker,
  ) {
    this.mode = config.mode;
    this.timeLimitFrames = config.mode === 'time'
      ? createMatchTimer(config.timeLimitSeconds).framesRemaining
      : null;
  }

  static stockOptions(config: MatchConfig): { stockCount: number; unlimitedStocks: boolean } {
    const requested = config.stockCount;
    return {
      stockCount: config.mode === 'time' ? 1
        : Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_STOCK_COUNT,
      unlimitedStocks: config.mode === 'time',
    };
  }

  getPhase(): 'playing' | 'suddenDeath' | 'finished' { return this.phase; }
  isSuddenDeath(): boolean { return this.suddenDeathStarted; }
  getSecondsRemaining(): number | null {
    return this.timeLimitFrames === null ? null
      : Math.ceil(Math.max(0, this.timeLimitFrames - (this.lastFrame + 1)) / MATCH_FPS);
  }
  getScores(frame: number): ReadonlyArray<number> {
    return this.timeScores ?? this.stats.getAllStats(frame).map(s => s.kos - s.deaths);
  }

  /** Called after this frame's collisions/respawns; repeated frames cannot advance it. */
  update(frame: number): MatchRuleEvent | null {
    if (this.phase === 'finished' || frame <= this.lastFrame) return null;
    this.lastFrame = frame;
    if (this.mode === 'stocks' || this.phase === 'suddenDeath') {
      if (!this.stocks.isMatchOver()) return null;
      this.phase = 'finished';
      return { kind: 'finished', winnerIndex: this.stocks.getWinner() };
    }
    if (frame + 1 < this.timeLimitFrames!) return null;
    const result = resolveTimeModeResult(this.stats.getAllStats(frame).map(s => ({ kos: s.kos, falls: s.deaths })));
    this.timeScores = Object.freeze([...result.scores]);
    if (!result.tied) {
      this.phase = 'finished';
      return { kind: 'finished', winnerIndex: result.winnerIndex };
    }
    const best = Math.max(...result.scores);
    const participants = result.scores.flatMap((score, i) => score === best ? [i] : []);
    this.stocks.setUnlimitedStocks(false);
    for (let i = 0; i < this.stocks.playerCount; i++) {
      this.stocks.setStocks(i, participants.includes(i) ? 1 : 0);
    }
    this.phase = 'suddenDeath';
    this.suddenDeathStarted = true;
    return { kind: 'suddenDeath', participants: Object.freeze(participants) };
  }
}
