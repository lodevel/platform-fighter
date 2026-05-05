/**
 * In-match damage HUD — Sub-AC 3 of AC 60003.
 *
 * Renders each fighter's current damage percentage on screen as a row
 * of large, colour-coded percent meters pinned to the bottom of the
 * viewport (the canonical Smash-Bros layout). One panel per active
 * player slot; each panel shows:
 *
 *   • The player's display label  ("P1 WOLF", "P2 CAT", …) in the
 *     player's roster colour.
 *   • The live percent number     ("0%", "23%", "152%") in a colour
 *     that ramps from white → yellow → orange → red as the percent
 *     climbs (see {@link damagePercentColor}).
 *
 * The panel is the SOLE source of truth for the on-screen damage
 * readout. The legacy debug `p1Text` / `p2Text` lines on `MatchScene`
 * still print percent for engineer eyes, but a casual player should
 * never need to read those — the bottom-strip meters are the contract.
 *
 * Why this lives in `src/ui/` (not on `MatchScene`):
 *   • Single responsibility — the scene already juggles physics, input,
 *     respawn, match-end, camera. Pulling the HUD out keeps each
 *     module focused and lets us add a stocks meter, timer, and replay
 *     overlay later without making the scene file untenable.
 *   • Reusability — the same HUD will be reused by the (M4) replay
 *     player and the (M3) stage-builder preview without duplication.
 *   • Testability — Phaser-touching code is mockable through a thin
 *     scene shim; pure formatting (clamp, ramp) lives in the sibling
 *     `damageHudFormat.ts` so the unit suite runs in plain Node.
 *
 * Determinism note: the HUD is render-only. It reads percents handed
 * to it each render frame and updates Phaser text — no Matter mutation,
 * no RNG reads. Replays produce identical HUD frames because the
 * underlying percents are themselves deterministic.
 */

import type Phaser from 'phaser';
import {
  colorIntToHexString,
  damagePercentColor,
  formatDamagePercent,
} from './damageHudFormat';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-player static config — name + roster colour. Doesn't change for
 * the duration of a match. The label is used verbatim (uppercased so
 * "Wolf" reads "P1 WOLF" without each call site shouting at the API).
 */
export interface DamageHudPlayer {
  /** 0-based slot — matches `StockTracker` / `BlastZoneWatcher`. */
  readonly playerIndex: number;
  /** Display name (typically the character name: "Wolf", "Cat", …). */
  readonly displayName: string;
  /** Hex 0xRRGGBB tint for the label. White if omitted. */
  readonly labelColor?: number;
}

/** Cosmetic / layout tuning. Sensible defaults for the M1 viewport. */
export interface DamageHudOptions {
  /** Distance in px from the bottom edge of the viewport. Default 28. */
  readonly bottomMargin?: number;
  /**
   * Width reserved for each player's panel. Panels are centred as a
   * row across the viewport. Default 220 px — fits four panels on a
   * 1280-wide viewport with comfortable gaps.
   */
  readonly panelWidth?: number;
  /** Horizontal gap between adjacent panels. Default 32 px. */
  readonly panelGap?: number;
  /** Font size of the percent text in px. Default 56 — readable at 1080p. */
  readonly percentFontSize?: number;
  /** Font size of the label text in px. Default 18. */
  readonly labelFontSize?: number;
}

// ---------------------------------------------------------------------------
// Internal — minimal scene shape so tests can mock without Phaser
// ---------------------------------------------------------------------------

/**
 * Shape we actually call on `Phaser.Scene`. Keeping it narrow lets the
 * test suite satisfy it with a hand-rolled object rather than booting a
 * full Phaser game.
 */
interface HudTextLike {
  setText(value: string): HudTextLike;
  setColor(color: string): HudTextLike;
  setOrigin(x: number, y?: number): HudTextLike;
  setScrollFactor(x: number, y?: number): HudTextLike;
  setPosition(x: number, y: number): HudTextLike;
  setDepth(depth: number): HudTextLike;
  destroy(): void;
  text: string;
}

interface HudSceneLike {
  scale: { gameSize: { width: number; height: number } };
  add: {
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): HudTextLike;
  };
}

// ---------------------------------------------------------------------------
// Default tuning
// ---------------------------------------------------------------------------

const DEFAULTS: Required<DamageHudOptions> = {
  bottomMargin: 28,
  panelWidth: 220,
  panelGap: 32,
  percentFontSize: 56,
  labelFontSize: 18,
};

// Render depth — well above stage / character sprites so the HUD never
// disappears behind a tall platform. The exact value is arbitrary; it
// just has to beat the gameplay layer.
const HUD_DEPTH = 1000;

// ---------------------------------------------------------------------------
// DamageHud
// ---------------------------------------------------------------------------

/**
 * Bottom-strip damage HUD. One instance per match; created in
 * `MatchScene.create()` and updated once per render frame from the
 * scene's render hook.
 *
 * Lifecycle:
 *
 *   const hud = new DamageHud(scene, [
 *     { playerIndex: 0, displayName: 'Wolf', labelColor: 0xffb0a0 },
 *     { playerIndex: 1, displayName: 'Cat',  labelColor: 0xa0d8ff },
 *   ]);
 *   // every render frame:
 *   hud.update([wolfPercent, catPercent]);
 *   // teardown:
 *   hud.destroy();
 */
export class DamageHud {
  private readonly scene: HudSceneLike;
  private readonly options: Required<DamageHudOptions>;
  private readonly players: ReadonlyArray<DamageHudPlayer>;

  /** Per-slot label text objects. Same length as `players`. */
  private readonly labelTexts: HudTextLike[] = [];
  /** Per-slot percent text objects. Same length as `players`. */
  private readonly percentTexts: HudTextLike[] = [];

  /**
   * Last-rendered formatted percent string per slot. Cached so the
   * `update()` hot path can skip a `setText` call when nothing changed
   * — Phaser text rebuilds its texture on every `setText`, and at 60 Hz
   * that's a non-trivial source of garbage.
   */
  private readonly lastRenderedText: string[] = [];

  /**
   * Last-rendered colour-ramp value per slot. Same caching rationale as
   * `lastRenderedText`.
   */
  private readonly lastRenderedColor: number[] = [];

  /** Set true on `destroy()` so a stray late `update()` is a no-op. */
  private destroyed = false;

  constructor(
    scene: Phaser.Scene | HudSceneLike,
    players: ReadonlyArray<DamageHudPlayer>,
    options: DamageHudOptions = {},
  ) {
    if (players.length === 0) {
      throw new Error('DamageHud: at least one player is required');
    }
    // Cast through `unknown` because `Phaser.Scene` has many more
    // members than we touch — `HudSceneLike` is the structural subset
    // the constructor actually consumes.
    this.scene = scene as unknown as HudSceneLike;
    this.options = { ...DEFAULTS, ...stripUndefined(options) };
    this.players = players.slice();

    this.layoutAndCreate();
  }

  // -------------------------------------------------------------------------
  // Per-render-frame update
  // -------------------------------------------------------------------------

  /**
   * Refresh every slot's percent text from the supplied array.
   *
   * `percents[i]` is the damage percent for `players[i]` (i.e. positional
   * — NOT keyed by `playerIndex`). The caller is expected to assemble
   * the array in the same order it constructed the HUD with; this
   * mirrors how `MatchScene` already iterates `playerSlots`.
   *
   * Idempotent — calling with identical percents twice in a row is a
   * no-op (no `setText` work) thanks to the cached `lastRenderedText`.
   *
   * Defensive: percents shorter than the player roster reads the
   * missing entries as 0 % so a partial reset doesn't crash the HUD.
   */
  update(percents: ReadonlyArray<number>): void {
    if (this.destroyed) return;

    for (let i = 0; i < this.players.length; i += 1) {
      const raw = percents[i];
      const value = typeof raw === 'number' ? raw : 0;
      const formatted = formatDamagePercent(value);
      const color = damagePercentColor(value);

      const labelText = this.labelTexts[i];
      const percentText = this.percentTexts[i];
      if (!labelText || !percentText) continue;

      if (this.lastRenderedText[i] !== formatted) {
        percentText.setText(formatted);
        this.lastRenderedText[i] = formatted;
      }
      if (this.lastRenderedColor[i] !== color) {
        percentText.setColor(colorIntToHexString(color));
        this.lastRenderedColor[i] = color;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------------

  /**
   * Re-run the layout pass. Useful when the viewport resizes; `MatchScene`
   * can hook this to `scale.on('resize')` if responsive layout becomes
   * a concern. For M1 we lay out once at construction.
   */
  relayout(): void {
    if (this.destroyed) return;
    const positions = this.computePanelCenters();
    const labelY = this.computeLabelY();
    const percentY = this.computePercentY();
    for (let i = 0; i < this.players.length; i += 1) {
      const cx = positions[i];
      const labelText = this.labelTexts[i];
      const percentText = this.percentTexts[i];
      if (cx === undefined || !labelText || !percentText) continue;
      labelText.setPosition(cx, labelY);
      percentText.setPosition(cx, percentY);
    }
  }

  /**
   * Read-only snapshot of the percent text objects. Tests use this to
   * assert the HUD reflects the supplied percents without reaching into
   * private state. Do NOT mutate the returned array.
   */
  getPercentTexts(): ReadonlyArray<HudTextLike> {
    return this.percentTexts;
  }

  /** Same idea as {@link getPercentTexts} but for the label row. */
  getLabelTexts(): ReadonlyArray<HudTextLike> {
    return this.labelTexts;
  }

  /** Number of player slots managed. Mirrors `players.length`. */
  size(): number {
    return this.players.length;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * Destroy every text object the HUD owns. Idempotent — `MatchScene`
   * calls this from its SHUTDOWN handler, and we want `destroy()` to be
   * safe whether or not it has been called before.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.labelTexts) t.destroy();
    for (const t of this.percentTexts) t.destroy();
    this.labelTexts.length = 0;
    this.percentTexts.length = 0;
    this.lastRenderedText.length = 0;
    this.lastRenderedColor.length = 0;
  }

  // -------------------------------------------------------------------------
  // Internal — initial layout + text creation
  // -------------------------------------------------------------------------

  private layoutAndCreate(): void {
    const positions = this.computePanelCenters();
    const labelY = this.computeLabelY();
    const percentY = this.computePercentY();

    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i]!;
      const cx = positions[i];
      if (cx === undefined) continue;

      const labelTint = player.labelColor ?? 0xffffff;
      const labelText = this.scene.add
        .text(cx, labelY, `P${player.playerIndex + 1} ${player.displayName.toUpperCase()}`, {
          fontFamily: 'monospace',
          fontSize: `${this.options.labelFontSize}px`,
          color: colorIntToHexString(labelTint),
        })
        .setOrigin(0.5, 1)
        .setScrollFactor(0, 0)
        .setDepth(HUD_DEPTH);

      // Initial percent always reads "0%" white. The first `update()`
      // call after construction will overwrite both fields if the
      // simulation has progressed.
      const initialColor = damagePercentColor(0);
      const percentText = this.scene.add
        .text(cx, percentY, formatDamagePercent(0), {
          fontFamily: 'monospace',
          fontSize: `${this.options.percentFontSize}px`,
          color: colorIntToHexString(initialColor),
        })
        .setOrigin(0.5, 1)
        .setScrollFactor(0, 0)
        .setDepth(HUD_DEPTH);

      this.labelTexts.push(labelText);
      this.percentTexts.push(percentText);
      this.lastRenderedText.push(formatDamagePercent(0));
      this.lastRenderedColor.push(initialColor);
    }
  }

  /**
   * Centre x-coordinate of each panel along the bottom strip.
   *
   * Formula: equal-width panels with `panelGap` spacing between them,
   * the whole row centred in the viewport so 1, 2, 3, or 4 players all
   * read symmetric.
   */
  private computePanelCenters(): number[] {
    const { panelWidth, panelGap } = this.options;
    const n = this.players.length;
    const totalWidth = n * panelWidth + (n - 1) * panelGap;
    const viewportWidth = this.scene.scale.gameSize.width;
    const startX = (viewportWidth - totalWidth) / 2 + panelWidth / 2;
    const centres: number[] = [];
    for (let i = 0; i < n; i += 1) {
      centres.push(startX + i * (panelWidth + panelGap));
    }
    return centres;
  }

  /** Y coordinate of the percent text baseline (origin 0.5, 1). */
  private computePercentY(): number {
    return this.scene.scale.gameSize.height - this.options.bottomMargin;
  }

  /** Y coordinate of the label text baseline (origin 0.5, 1). */
  private computeLabelY(): number {
    // Label sits directly above the percent number. We subtract roughly
    // the percent font height plus a small gap so the two rows hug.
    const gap = 6;
    return (
      this.computePercentY() -
      this.options.percentFontSize -
      gap
    );
  }
}

/**
 * Strip `undefined` values so they don't override defaults during a
 * spread merge. (Spreading `{ a: undefined }` over `{ a: 5 }` results
 * in `{ a: undefined }` — not what we want.)
 */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}
