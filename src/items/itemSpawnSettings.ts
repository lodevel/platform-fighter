/**
 * Items spawn-frequency settings — the tuning table that turns the
 * headline {@link ItemFrequency} dial in `MatchConfig` into concrete
 * runtime numbers the spawn manager consumes (T3 items framework,
 * AC 10 Sub-AC 2).
 *
 * The dial has four positions — `off`, `low`, `med`, `high` — modelled
 * after Smash-style match settings. Each non-`off` position resolves
 * to:
 *
 *   • A `[minIntervalFrames, maxIntervalFrames]` window the spawn
 *     manager rolls a uniform random value inside, using the match-
 *     scoped `MatchRng`, to schedule the next spawn tick. Two
 *     simulations driven through the same seed + frequency produce
 *     identical spawn schedules (replay determinism — see
 *     `evaluation_principles.determinism_preservation`).
 *   • A max-items-on-field cap. Once that many live items exist on
 *     the stage at once the spawn manager idles until a slot frees up,
 *     so a "high" match still can't drown the stage in unbounded
 *     items.
 *
 * Phaser-free on purpose so the same table is reusable by:
 *   • The runtime `ItemSpawnManager` (a later sub-AC).
 *   • Headless replay tooling that has to reproduce spawn ticks
 *     without booting Phaser.
 *   • Unit tests that exercise spawn-window math under plain Node.
 *
 * All numbers are expressed in **fixed-step frames at 60 Hz**. The
 * fixed-step engine advances the spawn manager one frame per tick, so
 * 60 frames = 1 second of in-match time. Authoring in frames (rather
 * than seconds) keeps the determinism guarantee front-and-centre and
 * matches the units used by the rest of the match-state modules
 * (`StockTracker`, `RespawnHandler`, `LavaHazard`, etc.).
 *
 * Why a static table (not config-driven):
 *   The four dial positions are intentionally pre-tuned, not free-form
 *   numeric inputs. The match-settings UI exposes the dial only — no
 *   sliders for raw frame counts — so locking the mapping here keeps
 *   replay metadata stable: a saved replay only needs to record the
 *   `'low' | 'med' | 'high' | 'off'` token; the spawn-window math is
 *   reconstructed from this table at playback time.
 */

import type { ItemFrequency } from '../types';
import { DEFAULT_ITEM_FREQUENCY } from '../types';

// ---------------------------------------------------------------------------
// Frequency dial positions
// ---------------------------------------------------------------------------

/**
 * Canonical ordered tuple of the four valid frequency dial positions.
 * Exported so menu UI, validators, and replay-migration code can
 * iterate the full set without hard-coding string literals at every
 * call site.
 *
 * Order is significant — it matches the visual progression a player
 * sees on the match-settings dial (off → low → med → high) and is the
 * order the lobby UI cycles through on a single button press.
 */
export const ITEM_FREQUENCIES: ReadonlyArray<ItemFrequency> = Object.freeze([
  'off',
  'low',
  'med',
  'high',
]);

// ---------------------------------------------------------------------------
// Spawn-interval mapping table
// ---------------------------------------------------------------------------

/**
 * Min/max spawn-interval window for one frequency dial position.
 * The spawn manager picks a uniform random integer in
 * `[minIntervalFrames, maxIntervalFrames]` (inclusive on both ends)
 * each time it schedules the next spawn tick.
 *
 * Invariants enforced by the table builder below:
 *   • `1 <= minIntervalFrames <= maxIntervalFrames`
 *   • Both values are integer frame counts (no fractional frames)
 */
export interface ItemSpawnInterval {
  /** Inclusive lower bound on the next-spawn delay, in fixed-step frames. */
  readonly minIntervalFrames: number;
  /** Inclusive upper bound on the next-spawn delay, in fixed-step frames. */
  readonly maxIntervalFrames: number;
}

/**
 * Frequency-dial → spawn-interval mapping.
 *
 * Tuning rationale (60 Hz fixed-step; 60 frames = 1 s):
 *
 *   • `'off'`  : `null` — items disabled. The spawn manager checks
 *     for `null` and short-circuits without ever scheduling a spawn.
 *     Distinct from a "very long interval" so the off path is also
 *     `MatchRng`-free (no roll consumed) and the saved replay header
 *     records "no items" unambiguously.
 *   • `'low'`  : 12–20 s (720–1200 frames). Sparse — players notice
 *     individual spawns; rounds rarely see more than a handful.
 *   • `'med'`  : 6–12 s (360–720 frames). Default — items are a
 *     regular feature of the round without dominating it.
 *   • `'high'` : 2–5 s (120–300 frames). Chaotic — items are part of
 *     every exchange; bombers and ray guns are the headline event.
 *
 * The windows overlap intentionally at neither extreme so a player
 * stepping the dial up always perceives a frequency change (`high`'s
 * worst case is faster than `med`'s best case).
 */
export const ITEM_SPAWN_FREQUENCY_TABLE: Readonly<
  Record<ItemFrequency, ItemSpawnInterval | null>
> = Object.freeze({
  off: null,
  low: Object.freeze({ minIntervalFrames: 720, maxIntervalFrames: 1200 }),
  med: Object.freeze({ minIntervalFrames: 360, maxIntervalFrames: 720 }),
  high: Object.freeze({ minIntervalFrames: 120, maxIntervalFrames: 300 }),
});

// ---------------------------------------------------------------------------
// Max-items-on-field cap
// ---------------------------------------------------------------------------

/**
 * Hard upper bound on simultaneous live items, regardless of dial
 * position. The per-frequency caps below are validated against this
 * constant by `assertItemSpawnSettingsInvariants` so a future tuning
 * pass can't accidentally raise a single dial above what the rest of
 * the framework — pickup proximity probes, replay snapshot cost, the
 * 4-fighter HUD — was designed to handle.
 *
 * Tuned conservatively for a 4-player FFA on a Battlefield-shaped
 * stage: even at the cap, every live fighter has at most one item
 * within a short pickup hop, and the snapshot system stays well below
 * its per-frame budget.
 */
export const MAX_ITEMS_ON_FIELD_HARD_LIMIT = 8;

/**
 * Per-frequency cap on the number of items the spawn manager will
 * keep live on the stage at once. When the field is full the manager
 * idles — it does NOT roll a delay only to skip the spawn — so the
 * `MatchRng` consumption pattern stays deterministic regardless of
 * how items are picked up or destroyed.
 *
 *   • `'off'`  : 0 — items disabled; cap matches.
 *   • `'low'`  : 1 — one item at a time keeps the round paced.
 *   • `'med'`  : 2 — small cap; the stage feels lively without
 *     turning into a litter pile.
 *   • `'high'` : 4 — chaotic-but-manageable; matches the 4-player
 *     FFA cap so every fighter can plausibly hold an item at once.
 */
export const MAX_ITEMS_ON_FIELD_BY_FREQUENCY: Readonly<
  Record<ItemFrequency, number>
> = Object.freeze({
  off: 0,
  low: 1,
  med: 2,
  high: 4,
});

// ---------------------------------------------------------------------------
// Drop-from-above spawn behaviour (T3 items framework, AC 90301 Sub-AC 1)
// ---------------------------------------------------------------------------

/**
 * Vertical offset, in design pixels, between the **drop-in point** an
 * item materialises at and the {@link ItemSpawnAnchor} it targets.
 *
 * Smash-style "items rain in from above": the spawn manager doesn't
 * teleport an item to the anchor — it materialises the item this many
 * design pixels *above* the anchor (smaller Y in screen-space) and the
 * spawn callsite attaches a Matter.js body with normal gravity so the
 * item falls naturally toward the anchor surface. The drop animation
 * is what gives items their characteristic "the stage just dropped a
 * fresh weapon, watch it fall" beat that players visually parse as
 * "go grab it".
 *
 * Tuning rationale (60 Hz fixed-step, gravity = 1.0 in Matter units):
 *
 *   • A 280 px drop on a 1080 px design height places the materialise
 *     point ~26 % of the screen above the anchor — comfortably below
 *     the upper blast-zone (which sits well above the design viewport)
 *     so an anchor authored near the top of the stage still produces a
 *     visible drop animation rather than spawning offscreen.
 *   • At 1.0 gravity the fall takes ~30–40 fixed-step frames (≈ 0.5 s)
 *     before settling — long enough to read on the HUD, short enough
 *     that the contested-pickup window opens fast.
 *   • Authored anchors already hover 60 px above their platform's top
 *     edge (`FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset`), so the
 *     effective fall distance from the materialise point to the
 *     platform surface is ~340 px — which sells the "rain from above"
 *     feel without making players wait for the item to arrive.
 *
 * Why a single global constant (rather than a per-stage / per-anchor
 * field):
 *   • Consistency across stages — a player who learns "items take
 *     about half a second to land" carries that timing knowledge to
 *     every match.
 *   • Replay determinism — the drop point is derived purely from the
 *     anchor + this constant, so a saved replay's recorded anchor
 *     index resolves to the same spawn position on playback without
 *     persisting per-spawn coordinates.
 *   • Open-closed: a stage that wants a custom drop height authors a
 *     higher-up anchor; no schema change required.
 *
 * The constant is positive — the helper {@link getItemSpawnPosition}
 * subtracts it from the anchor Y so callers don't have to remember
 * Phaser's screen-space Y direction.
 */
export const ITEM_SPAWN_DROP_HEIGHT_PX = 280;

/**
 * Compute the **drop-in point** for an item targeting `anchor`.
 *
 * Returns `{ x: anchor.x, y: anchor.y - dropHeight }` — the position
 * the spawn callsite should materialise the item at. The callsite then
 * attaches a Matter.js body with normal gravity so the item falls from
 * this point toward (and past, until it hits a platform) the anchor's
 * Y. See {@link ITEM_SPAWN_DROP_HEIGHT_PX} for the tuning rationale.
 *
 * Defensive clamp: the returned Y is clamped to a minimum of 0 so an
 * anchor authored unusually close to the top of the stage can never
 * produce a negative-Y drop point that the renderer would treat as
 * "above the design viewport" (which would skip culling tests and
 * render a frame outside the camera bounds). The clamp is a safety net
 * — every authored anchor on the built-in roster sits well below this
 * threshold.
 */
export function getItemSpawnPosition(anchor: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: anchor.x,
    y: Math.max(0, anchor.y - ITEM_SPAWN_DROP_HEIGHT_PX),
  };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an arbitrary `ItemFrequency | undefined` from `MatchConfig`
 * to the canonical dial value the spawn manager will use. Treats
 * `undefined` as {@link DEFAULT_ITEM_FREQUENCY} so a back-compat
 * `MatchConfig` (no `itemFrequency` field) still produces a valid
 * runtime setting without forcing every `MatchConfig` builder to
 * synthesise a default.
 *
 * Unknown / corrupt values are treated identically to `undefined` —
 * defensive behaviour for a corrupt replay header that mutates the
 * frequency token between schema versions.
 */
export function resolveItemFrequency(
  value: ItemFrequency | undefined,
): ItemFrequency {
  if (value === undefined) return DEFAULT_ITEM_FREQUENCY;
  if (!ITEM_FREQUENCIES.includes(value)) return DEFAULT_ITEM_FREQUENCY;
  return value;
}

/**
 * Look up the `[min, max]` spawn-interval window for the resolved
 * frequency. Returns `null` for `'off'` so callers can short-circuit
 * the spawn-scheduling loop without consuming an RNG roll.
 */
export function getItemSpawnInterval(
  frequency: ItemFrequency,
): ItemSpawnInterval | null {
  return ITEM_SPAWN_FREQUENCY_TABLE[frequency];
}

/**
 * Look up the max-items-on-field cap for the resolved frequency. A
 * cap of `0` (the `'off'` case) tells the spawn manager to skip
 * spawning entirely.
 */
export function getMaxItemsOnField(frequency: ItemFrequency): number {
  return MAX_ITEMS_ON_FIELD_BY_FREQUENCY[frequency];
}

// ---------------------------------------------------------------------------
// Invariant checks (defensive — covered by unit tests)
// ---------------------------------------------------------------------------

/**
 * Defensive runtime assertion that the spawn-settings tables remain
 * internally consistent. Called once in tests; a future tuning PR
 * that breaks an invariant fails CI rather than silently producing a
 * non-deterministic spawn schedule.
 *
 * Invariants:
 *   1. Every {@link ItemFrequency} value has an entry in both tables.
 *   2. `'off'` resolves to `null` interval and `0` cap; no other dial
 *      position is allowed to use those sentinel values.
 *   3. For every non-`off` dial: `1 <= min <= max`, both integers.
 *   4. Per-frequency cap ≤ {@link MAX_ITEMS_ON_FIELD_HARD_LIMIT}.
 *   5. Stepping the dial up never raises the min interval (frequency
 *      monotonically increases as the dial moves off → low → med →
 *      high) — a sanity check that catches accidental dial-swaps in
 *      a tuning PR.
 *   6. Stepping the dial up never lowers the cap (more items, not
 *      fewer, as the dial advances).
 */
export function assertItemSpawnSettingsInvariants(): void {
  // (1) — every dial position present in both tables.
  for (const f of ITEM_FREQUENCIES) {
    if (!(f in ITEM_SPAWN_FREQUENCY_TABLE)) {
      throw new Error(`ITEM_SPAWN_FREQUENCY_TABLE missing entry for "${f}"`);
    }
    if (!(f in MAX_ITEMS_ON_FIELD_BY_FREQUENCY)) {
      throw new Error(
        `MAX_ITEMS_ON_FIELD_BY_FREQUENCY missing entry for "${f}"`,
      );
    }
  }

  // (2) — 'off' uses sentinel values; nothing else does.
  if (ITEM_SPAWN_FREQUENCY_TABLE.off !== null) {
    throw new Error("ITEM_SPAWN_FREQUENCY_TABLE.off must be null");
  }
  if (MAX_ITEMS_ON_FIELD_BY_FREQUENCY.off !== 0) {
    throw new Error("MAX_ITEMS_ON_FIELD_BY_FREQUENCY.off must be 0");
  }
  for (const f of ITEM_FREQUENCIES) {
    if (f === 'off') continue;
    if (ITEM_SPAWN_FREQUENCY_TABLE[f] === null) {
      throw new Error(
        `ITEM_SPAWN_FREQUENCY_TABLE.${f} must not be null (only 'off' uses null)`,
      );
    }
    if (MAX_ITEMS_ON_FIELD_BY_FREQUENCY[f] === 0) {
      throw new Error(
        `MAX_ITEMS_ON_FIELD_BY_FREQUENCY.${f} must be > 0 (only 'off' uses 0)`,
      );
    }
  }

  // (3) — interval window well-formed.
  for (const f of ITEM_FREQUENCIES) {
    const w = ITEM_SPAWN_FREQUENCY_TABLE[f];
    if (w === null) continue;
    if (
      !Number.isInteger(w.minIntervalFrames) ||
      !Number.isInteger(w.maxIntervalFrames)
    ) {
      throw new Error(`ITEM_SPAWN_FREQUENCY_TABLE.${f} must use integer frames`);
    }
    if (w.minIntervalFrames < 1) {
      throw new Error(
        `ITEM_SPAWN_FREQUENCY_TABLE.${f}.minIntervalFrames must be >= 1`,
      );
    }
    if (w.minIntervalFrames > w.maxIntervalFrames) {
      throw new Error(
        `ITEM_SPAWN_FREQUENCY_TABLE.${f}: min must not exceed max`,
      );
    }
  }

  // (4) — per-frequency cap respected.
  for (const f of ITEM_FREQUENCIES) {
    const cap = MAX_ITEMS_ON_FIELD_BY_FREQUENCY[f];
    if (!Number.isInteger(cap) || cap < 0) {
      throw new Error(
        `MAX_ITEMS_ON_FIELD_BY_FREQUENCY.${f} must be a non-negative integer`,
      );
    }
    if (cap > MAX_ITEMS_ON_FIELD_HARD_LIMIT) {
      throw new Error(
        `MAX_ITEMS_ON_FIELD_BY_FREQUENCY.${f} (${cap}) exceeds hard limit (${MAX_ITEMS_ON_FIELD_HARD_LIMIT})`,
      );
    }
  }

  // (5) — interval monotonically decreases (= frequency increases) as
  // the dial steps up. We compare consecutive non-off positions.
  const nonOff = ITEM_FREQUENCIES.filter((f) => f !== 'off');
  for (let i = 1; i < nonOff.length; i++) {
    const prevKey = nonOff[i - 1];
    const currKey = nonOff[i];
    if (prevKey === undefined || currKey === undefined) continue;
    const prev = ITEM_SPAWN_FREQUENCY_TABLE[prevKey];
    const curr = ITEM_SPAWN_FREQUENCY_TABLE[currKey];
    if (prev === null || curr === null) continue;
    if (curr.minIntervalFrames > prev.minIntervalFrames) {
      throw new Error(
        `ITEM_SPAWN_FREQUENCY_TABLE: dial step ${prevKey} → ${currKey} must not raise min interval`,
      );
    }
    if (curr.maxIntervalFrames > prev.maxIntervalFrames) {
      throw new Error(
        `ITEM_SPAWN_FREQUENCY_TABLE: dial step ${prevKey} → ${currKey} must not raise max interval`,
      );
    }
  }

  // (6) — cap monotonically increases as the dial steps up.
  for (let i = 1; i < ITEM_FREQUENCIES.length; i++) {
    const prevKey = ITEM_FREQUENCIES[i - 1];
    const currKey = ITEM_FREQUENCIES[i];
    if (prevKey === undefined || currKey === undefined) continue;
    const prevCap = MAX_ITEMS_ON_FIELD_BY_FREQUENCY[prevKey];
    const currCap = MAX_ITEMS_ON_FIELD_BY_FREQUENCY[currKey];
    if (currCap < prevCap) {
      throw new Error(
        `MAX_ITEMS_ON_FIELD_BY_FREQUENCY: dial step ${prevKey} → ${currKey} must not lower cap`,
      );
    }
  }
}
