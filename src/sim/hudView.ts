import type { FinalHudModel } from '../finalSmash/finalSmashPresentation';
import type { CharacterId, MatchMode } from '../types';

/**
 * The HUD part of the render contract (STEP5-DESIGN.md §4, `SimView.hud`):
 * plain data MatchSim produces every frame and the HTML HUD draws.
 */
export interface HudPlayerView {
  readonly playerIndex: number;
  /** 1-based player slot (P1..P4), which sets the player colour. */
  readonly slotIndex: number;
  readonly characterId: CharacterId;
  /** Costume, for the plate's portrait. */
  readonly paletteIndex: number;
  readonly cpu: boolean;
  readonly damage: number;
  readonly stocks: number;
  /** Time mode score (KOs minus falls). */
  readonly score: number;
  readonly eliminated: boolean;
  readonly final: FinalHudModel | null;
}

export interface HudView {
  readonly mode: MatchMode;
  /** Seconds left in time mode, null in stock mode. */
  readonly secondsLeft: number | null;
  readonly suddenDeath: boolean;
  readonly players: ReadonlyArray<HudPlayerView>;
}
