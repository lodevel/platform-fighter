/**
 * Phaser-free formatting helpers for the controller-reconnect prompt
 * overlay (AC 14 Sub-AC 3).
 *
 * Sub-AC 1 wired the browser's `gamepadconnected` /
 * `gamepaddisconnected` events into the engine via
 * {@link GamepadConnectionMonitor}; Sub-AC 2 pauses the simulation when
 * a disconnect affects a live human slot. Sub-AC 3 closes the UX loop:
 * a centred overlay panel that names the affected player slot(s),
 * shows the waiting state ("Waiting for controller…"), and
 * acknowledges partial-vs-full reconnect transitions so a multi-pad
 * pull-out reads as a single coherent event instead of a re-flickering
 * banner.
 *
 * Why a separate format module
 * ----------------------------
 *
 * The Phaser-touching overlay (`ReconnectPromptOverlay.ts`) imports
 * Phaser, which drags in browser globals (`navigator`, `document`, …)
 * at module-eval time. The string + colour decisions therefore have to
 * live behind that import line if the unit suite is going to exercise
 * every branch under plain Node + vitest. This file mirrors the layout
 * of `damageHudFormat.ts`, `desyncReportFormat.ts`, and
 * `rebindingScreenFormat.ts` — one helper per concern, each a pure
 * function.
 *
 * Determinism: every helper is a pure function — same input → same
 * output, no `Math.random()`, no wall-clock reads. The Sub-AC 1
 * replay-marker design relies on this — the overlay can be repainted
 * frame-deterministically when a recorded disconnect re-fires during
 * playback.
 */

import type { PlayerBindingsIndex } from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Snapshot the overlay paints
// ---------------------------------------------------------------------------

/**
 * Snapshot of every reconnect-prompt-relevant fact the overlay needs to
 * render a frame. The snapshot is the single argument to every
 * formatter in this file so the overlay never has to reconcile multiple
 * sources mid-paint.
 *
 * `affectedSlots` is the canonical "which slot(s) lost their pad?"
 * list — same shape as
 * {@link DisconnectPauseEvent.affectedSlotsTotal} so the overlay can
 * pass its `event.affectedSlotsTotal` (or a partially-recovered
 * subset) straight in.
 *
 * `padLabels` is an *optional* parallel list of short device names
 * ("Xbox 360 Controller", "DualSense Wireless Controller", …). When
 * present and non-empty, the body line cites the device (`Plug pad
 * "Xbox 360 Controller" back in`) — useful when more than one
 * disconnected pad's id is known. When empty / null, the body falls
 * back to the generic "controller" wording. Order is intentionally
 * decoupled from `affectedSlots` because a single pad disconnect can
 * affect multiple slots.
 *
 * `phase` tracks the overlay's lifecycle so partial-reconnect renders
 * don't flicker the banner heading from "lost" to "lost-still" between
 * frames — the overlay decides phase from the controller's pause /
 * resume payloads.
 */
export interface ReconnectPromptSnapshot {
  /** Slots whose pads are still considered disconnected. */
  readonly affectedSlots: ReadonlyArray<PlayerBindingsIndex>;
  /** Device-id labels for the disconnected pads (length-independent of slots). */
  readonly padLabels?: ReadonlyArray<string> | null;
  /** Which phase of the disconnect/reconnect cycle the overlay is in. */
  readonly phase: ReconnectPromptPhase;
}

/**
 * Lifecycle states the overlay paints into the prompt sub-line.
 *
 *   • `'waiting'` — at least one pad is still missing. The overlay is
 *     visible and the body line says "Waiting for controller…".
 *   • `'partial-reconnect'` — one of several missing pads just came
 *     back; the overlay stays visible because *other* pads are still
 *     out, and the body line says "Still waiting…".
 *   • `'reconnected'` — every tracked pad is back. The overlay can hide
 *     itself; the formatter still produces a string in case the UI wants
 *     to flash a "connected!" toast on the way out.
 *   • `'acknowledged'` — the player chose to keep playing without a
 *     reconnect (Sub-AC 2's `acknowledgeAndResume()` path). The overlay
 *     can hide itself; the formatter produces an explicit string so a
 *     telemetry pipeline can distinguish a hardware reconnect from a
 *     manual dismiss.
 */
export type ReconnectPromptPhase =
  | 'waiting'
  | 'partial-reconnect'
  | 'reconnected'
  | 'acknowledged';

// ---------------------------------------------------------------------------
// Slot label helpers
// ---------------------------------------------------------------------------

/**
 * Human-readable slot label — `"P1"`, `"P2"`, … . Exported because the
 * MatchScene uses the same wording in adjacent banners (the "GAME!"
 * results splash, the stocks line) so a glance reads consistently.
 */
export function formatSlotLabel(slot: PlayerBindingsIndex): string {
  return `P${slot}`;
}

/**
 * Combine a slot list into a comma-joined label suitable for the prompt
 * heading. Empty / unknown lists fall back to a generic noun so the
 * overlay never paints an empty string. Ordering of the input is
 * preserved — the disconnect controller already returns slots in
 * ascending order.
 *
 *   formatAffectedSlotsLabel([])              → "Controller"
 *   formatAffectedSlotsLabel([1])             → "P1"
 *   formatAffectedSlotsLabel([1, 3])          → "P1 + P3"
 *   formatAffectedSlotsLabel([1, 2, 4])       → "P1, P2 + P4"
 *
 * The Oxford-style join (`A, B + C`) keeps the heading scannable on a
 * narrow centred panel — a comma-only join (`A, B, C`) tends to read
 * as a list of three items where one of them just happens to also be
 * "C". The plus-sign explicitly spells out the conjunction.
 */
export function formatAffectedSlotsLabel(
  slots: ReadonlyArray<PlayerBindingsIndex>,
): string {
  if (!slots || slots.length === 0) return 'Controller';
  if (slots.length === 1) return formatSlotLabel(slots[0]!);
  if (slots.length === 2) {
    return `${formatSlotLabel(slots[0]!)} + ${formatSlotLabel(slots[1]!)}`;
  }
  // 3+ — comma-separated for the leading slots, plus-sign for the last.
  const head = slots.slice(0, -1).map((s) => formatSlotLabel(s)).join(', ');
  const tail = formatSlotLabel(slots[slots.length - 1]!);
  return `${head} + ${tail}`;
}

// ---------------------------------------------------------------------------
// Prompt headline / body
// ---------------------------------------------------------------------------

/**
 * One-line headline for the overlay panel, tied to the phase.
 *
 *   formatPromptHeadline({affectedSlots:[1], phase:'waiting'})
 *     → "P1 — Controller disconnected"
 *
 *   formatPromptHeadline({affectedSlots:[1,3], phase:'waiting'})
 *     → "P1 + P3 — Controllers disconnected"
 *
 *   formatPromptHeadline({affectedSlots:[1,3], phase:'partial-reconnect'})
 *     → "P1 + P3 — Still disconnected"
 *
 *   formatPromptHeadline({affectedSlots:[], phase:'reconnected'})
 *     → "Controller reconnected"
 *
 *   formatPromptHeadline({affectedSlots:[], phase:'acknowledged'})
 *     → "Continuing without controller"
 *
 * The pluralisation flips "Controller" ↔ "Controllers" on slot count
 * so a multi-pad pull doesn't read as a single-pad event.
 */
export function formatPromptHeadline(snapshot: ReconnectPromptSnapshot): string {
  const slots = snapshot.affectedSlots ?? [];
  const phase = snapshot.phase;
  const label = formatAffectedSlotsLabel(slots);
  const noun = slots.length <= 1 ? 'Controller' : 'Controllers';
  switch (phase) {
    case 'waiting':
      return slots.length === 0
        ? `${noun} disconnected`
        : `${label} — ${noun} disconnected`;
    case 'partial-reconnect':
      return slots.length === 0
        ? `${noun} disconnected`
        : `${label} — Still disconnected`;
    case 'reconnected':
      // Reconnected always reads in the singular even after a multi-pad
      // pull — by the time we hit this phase every tracked pad is back,
      // and "controllers reconnected" implies more pads than the actual
      // resolved set (which may be one).
      return 'Controller reconnected';
    case 'acknowledged':
      return 'Continuing without controller';
    default: {
      // Unknown phase — degrade to the waiting copy so a future phase
      // slipped through still produces a coherent overlay.
      const exhaustive: never = phase;
      return `${noun} disconnected (${String(exhaustive)})`;
    }
  }
}

/**
 * Two-or-three-line body the overlay paints under the headline. Lines
 * are returned as a frozen array so the overlay can iterate them onto
 * stacked text objects with stable spacing. Length is *not* fixed —
 * the overlay uses `array.length` to decide how many text slots to
 * paint and hides the unused slots.
 *
 *   waiting (no padLabels):
 *     [ "Plug the controller back in to resume.",
 *       "Press Start on a connected pad to continue without it." ]
 *
 *   waiting (with padLabel):
 *     [ 'Plug "Xbox 360 Controller" back in to resume.',
 *       "Press Start on a connected pad to continue without it." ]
 *
 *   partial-reconnect:
 *     [ "Still waiting on the remaining controller(s).",
 *       "Press Start on a connected pad to continue without it." ]
 *
 *   reconnected:
 *     [ "Resuming match…" ]
 *
 *   acknowledged:
 *     [ "Match continued. Plug a controller in any time to take over." ]
 *
 * The "Press Start" hint is intentionally generic — not every pad
 * carries a `Start` button under the same name, but every player
 * recognises the menu / pause button. The Sub-AC 3 overlay is
 * informational + manual-dismiss; the actual binding for "continue
 * unbound" is wired in Sub-AC 4 (or whichever later sub-AC owns the
 * acknowledge gesture).
 */
export function formatPromptBodyLines(
  snapshot: ReconnectPromptSnapshot,
): ReadonlyArray<string> {
  const phase = snapshot.phase;
  const padLabels = snapshot.padLabels ?? [];
  switch (phase) {
    case 'waiting': {
      const padHint = pickPadHintLabel(padLabels);
      const headLine =
        padHint === null
          ? 'Plug the controller back in to resume.'
          : `Plug "${padHint}" back in to resume.`;
      return Object.freeze([
        headLine,
        'Press Start on a connected pad to continue without it.',
      ]);
    }
    case 'partial-reconnect': {
      const remaining = snapshot.affectedSlots?.length ?? 0;
      const noun = remaining <= 1 ? 'controller' : 'controllers';
      return Object.freeze([
        `Still waiting on the remaining ${noun}.`,
        'Press Start on a connected pad to continue without it.',
      ]);
    }
    case 'reconnected':
      return Object.freeze(['Resuming match…']);
    case 'acknowledged':
      return Object.freeze([
        'Match continued. Plug a controller in any time to take over.',
      ]);
    default: {
      const exhaustive: never = phase;
      return Object.freeze([`Unknown phase: ${String(exhaustive)}`]);
    }
  }
}

/**
 * Pick the most informative pad label to splice into the prompt body.
 * Returns `null` when no usable label is available — empty strings,
 * pure-whitespace strings, and obvious "Unknown Gamepad (xxxx-xxxx)"
 * sentinels are filtered. A non-empty label is trimmed and length-
 * capped so a 200-char browser id doesn't blow the panel layout.
 *
 * Exported for unit testing — `formatPromptBodyLines` is the canonical
 * caller.
 */
export function pickPadHintLabel(
  padLabels: ReadonlyArray<string>,
): string | null {
  if (!padLabels || padLabels.length === 0) return null;
  for (const raw of padLabels) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    // Skip obvious "Unknown Gamepad" placeholders — UA-specific but the
    // string "Unknown" is a strong signal the id wasn't resolved.
    if (/^unknown gamepad/i.test(trimmed)) continue;
    if (trimmed.length <= 48) return trimmed;
    return `${trimmed.slice(0, 45)}…`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Slot accent strip
// ---------------------------------------------------------------------------

/**
 * Per-slot accent colour the overlay paints alongside the headline so
 * a player whose colour-blind setup makes the text read identical to
 * another slot still gets a per-slot cue. Mirrors the
 * `slot.paletteSwap.labelColor` palette the `DamageHud` already uses,
 * keyed to the *default* palette index for each slot. Overrides
 * (e.g. P1 picked Wolf palette 5) are not reflected — the overlay is a
 * fast cue, not a per-match colour mirror.
 *
 * The hex values match the M1 menu palette exactly so the overlay
 * tone matches the rest of the HUD.
 */
export const RECONNECT_SLOT_ACCENTS: ReadonlyArray<{
  readonly slot: PlayerBindingsIndex;
  readonly color: number;
}> = Object.freeze([
  Object.freeze({ slot: 1, color: 0xff7b6b }), // warm red — Wolf default
  Object.freeze({ slot: 2, color: 0x6bb8ff }), // cool blue — Cat default
  Object.freeze({ slot: 3, color: 0x6cf0c2 }), // mint green — P3 default
  Object.freeze({ slot: 4, color: 0xffe066 }), // straw yellow — P4 default
]);

/**
 * Resolve the accent tint for a slot. Falls back to a neutral slate so
 * an unknown slot index doesn't paint an undefined integer.
 */
export function slotAccentColor(slot: PlayerBindingsIndex | number): number {
  for (const entry of RECONNECT_SLOT_ACCENTS) {
    if (entry.slot === slot) return entry.color;
  }
  return 0xa0a0b8;
}

/**
 * Phaser uses `'#rrggbb'` for `Text` colours; mirrors
 * `damageHudFormat.colorIntToHexString`. Repeated here (not re-
 * exported) so the overlay can swap between the two without a chain
 * of cross-file imports.
 */
export function colorIntToHexString(value: number): string {
  if (!Number.isFinite(value)) return '#000000';
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Top-level multi-line assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the full text the overlay paints — headline followed by the
 * body lines. The overlay places each line on its own Phaser text
 * object; the test suite reads the array verbatim. Returned frozen so
 * the overlay can't accidentally mutate the snapshot.
 *
 *   buildPromptLines({ affectedSlots:[1], phase:'waiting' })
 *     → [ "P1 — Controller disconnected",
 *         "Plug the controller back in to resume.",
 *         "Press Start on a connected pad to continue without it." ]
 */
export function buildPromptLines(
  snapshot: ReconnectPromptSnapshot,
): ReadonlyArray<string> {
  const headline = formatPromptHeadline(snapshot);
  const body = formatPromptBodyLines(snapshot);
  return Object.freeze([headline, ...body]);
}

/**
 * Returns `true` when the overlay should be on screen given the
 * snapshot — `'waiting'` and `'partial-reconnect'` phases keep it
 * visible, the terminal phases (`'reconnected'`, `'acknowledged'`)
 * release it. Pure helper so the test suite can assert visibility
 * without booting Phaser.
 */
export function shouldShowOverlay(snapshot: ReconnectPromptSnapshot): boolean {
  if (!snapshot) return false;
  const phase = snapshot.phase;
  return phase === 'waiting' || phase === 'partial-reconnect';
}
