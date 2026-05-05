/**
 * Phaser-free formatting helpers for the M4 replay VCR overlay
 * (AC 30301 Sub-AC 1).
 *
 * The companion overlay (`VcrOverlay.ts`) talks Phaser. *This* module
 * owns the pure pieces:
 *
 *   • the `VcrControl` enum (the five buttons the overlay paints —
 *     rewind, play, pause, slow-motion toggle, frame-advance);
 *   • the `VcrPlaybackState` flag bag (what the overlay reads to decide
 *     which button is "active" / "highlighted" / "disabled");
 *   • {@link VCR_BUTTON_LAYOUT} — the canonical button order, default
 *     glyphs, ARIA-style accessible labels, and keyboard-shortcut keyCode
 *     used by the overlay and the unit suite alike;
 *   • {@link VCR_BUTTON_COLOR_RAMP} / {@link buttonStateColor} — the
 *     idle / hover / active / disabled tints; pinning these in one
 *     place keeps every overlay instance painting the same colours;
 *   • {@link formatTimeline} / {@link formatPlaybackRate} /
 *     {@link formatPhaseLabel} — the read-out strings the overlay shows
 *     above the buttons (cursor frame / slow-mo % / phase tag).
 *
 * Determinism note: every helper is a pure function of its arguments —
 * no `Math.random()`, no wall-clock reads, no Phaser/DOM imports. The
 * VCR overlay re-uses these in unit tests under plain Node and the
 * replay menu re-uses the same strings post-render.
 */

import { KEY_CODE, type KeyCode } from '../input/keyCodes';
import type { ReplayPlaybackPhase } from '../replay/ReplayPlaybackController';

// ---------------------------------------------------------------------------
// Control enum + canonical layout
// ---------------------------------------------------------------------------

/**
 * The five VCR buttons the overlay paints. Order is intentional —
 * iterators (`Object.values`, `for…of`) walk left-to-right rewind →
 * frame-advance, the same order players see in the UI.
 */
export const VCR_CONTROL = {
  /** Snap cursor backwards (default 60 frames / 1 second). */
  REWIND: 'rewind',
  /** Resume playback when paused (idempotent while playing). */
  PLAY: 'play',
  /** Halt playback (idempotent while paused). */
  PAUSE: 'pause',
  /** Toggle 25 % slow-motion. */
  SLOW_MOTION: 'slow-motion',
  /** Step the cursor forward exactly one fixed frame. */
  FRAME_ADVANCE: 'frame-advance',
} as const;

export type VcrControl = (typeof VCR_CONTROL)[keyof typeof VCR_CONTROL];

/** Stable left-to-right order for the button row. */
export const VCR_CONTROL_ORDER: ReadonlyArray<VcrControl> = Object.freeze([
  VCR_CONTROL.REWIND,
  VCR_CONTROL.PLAY,
  VCR_CONTROL.PAUSE,
  VCR_CONTROL.SLOW_MOTION,
  VCR_CONTROL.FRAME_ADVANCE,
]);

// ---------------------------------------------------------------------------
// Per-button static layout — glyph, label, keyboard shortcut
// ---------------------------------------------------------------------------

/**
 * One row in the canonical button table. The overlay walks
 * {@link VCR_BUTTON_LAYOUT} once at construction time to instantiate the
 * five Phaser text + rectangle pairs; the test suite walks it to assert
 * the buttons render in the documented order with the documented
 * accessible labels.
 */
export interface VcrButtonLayout {
  /** Stable identifier (matches the {@link VcrControl} enum). */
  readonly control: VcrControl;
  /**
   * Default glyph painted on the button face. Plain ASCII so it
   * round-trips through Phaser's bitmap font fallback even when WebGL
   * is unavailable. Real Unicode glyphs (▶ ⏸ ⏪ …) are reserved for the
   * canvas/WebGL path; tests assert the ASCII fallback.
   */
  readonly glyph: string;
  /** ARIA-style accessible name. Used for tooltip / debug text. */
  readonly label: string;
  /**
   * Keyboard shortcut bound to the button. `null` when the control has
   * no default shortcut (currently every control has one — kept for
   * forward compatibility with future buttons).
   */
  readonly shortcutKeyCode: KeyCode | null;
  /** Human-readable shortcut hint shown in the tooltip ("[ R ]"). */
  readonly shortcutHint: string;
}

/**
 * Canonical button table the overlay paints. Picked so:
 *
 *   • Spacebar plays / pauses (Smash menus, YouTube convention).
 *   • Comma / period frame-step (mirrors common video editors).
 *   • R rewinds ("R" for rewind — sits next to WASD so a 1P keyboard
 *     player can scrub without moving their hand).
 *   • S toggles slow-motion (mirrors "S"low — same row as Space).
 *
 * The overlay's `setBindings()` API can override any of these at
 * construction; the defaults match what the M4 design doc specs.
 */
export const VCR_BUTTON_LAYOUT: ReadonlyArray<VcrButtonLayout> = Object.freeze([
  Object.freeze({
    control: VCR_CONTROL.REWIND,
    glyph: '<<',
    label: 'Rewind',
    shortcutKeyCode: KEY_CODE.R,
    shortcutHint: '[ R ]',
  }),
  Object.freeze({
    control: VCR_CONTROL.PLAY,
    glyph: '>',
    label: 'Play',
    shortcutKeyCode: KEY_CODE.SPACE,
    shortcutHint: '[ Space ]',
  }),
  Object.freeze({
    control: VCR_CONTROL.PAUSE,
    glyph: '||',
    label: 'Pause',
    shortcutKeyCode: KEY_CODE.SPACE,
    shortcutHint: '[ Space ]',
  }),
  Object.freeze({
    control: VCR_CONTROL.SLOW_MOTION,
    glyph: '1/4x',
    label: 'Slow-motion',
    shortcutKeyCode: KEY_CODE.S,
    shortcutHint: '[ S ]',
  }),
  Object.freeze({
    control: VCR_CONTROL.FRAME_ADVANCE,
    glyph: '>|',
    label: 'Frame advance',
    shortcutKeyCode: KEY_CODE.F,
    shortcutHint: '[ F ]',
  }),
]);

/**
 * Lookup helper. Returns the layout entry for a control, or `null` if
 * the control isn't in the canonical table (defensive against a future
 * caller passing an unknown identifier).
 */
export function findButtonLayout(
  control: VcrControl,
): VcrButtonLayout | null {
  for (const entry of VCR_BUTTON_LAYOUT) {
    if (entry.control === control) return entry;
  }
  return null;
}

/**
 * Reverse lookup: which control owns the given keyCode? Returns `null`
 * for keys that have no binding. When two controls share a keyCode
 * (Play and Pause both bind Space), the active state-aware lookup
 * lives in {@link resolveSpaceShortcut} so the toggle behaves like a
 * media player; the simple lookup here returns the *first* match in
 * canonical order, which is `Play`.
 */
export function findControlForKeyCode(
  keyCode: number,
): VcrControl | null {
  for (const entry of VCR_BUTTON_LAYOUT) {
    if (entry.shortcutKeyCode === keyCode) return entry.control;
  }
  return null;
}

/**
 * Space toggles play ↔ pause depending on current playback state.
 * Returns the control that the overlay should fire when the player
 * presses Space:
 *
 *   • playing     → `pause`
 *   • paused      → `play`
 *   • finished    → `play`  (rewinds via Play if cursor at end — the
 *                            controller's seek+start re-arms playback)
 *   • everything else (idle / loaded) → `play`
 */
export function resolveSpaceShortcut(state: VcrPlaybackState): VcrControl {
  return state.isPlaying ? VCR_CONTROL.PAUSE : VCR_CONTROL.PLAY;
}

// ---------------------------------------------------------------------------
// Visual state — what the overlay reads to colour buttons
// ---------------------------------------------------------------------------

/**
 * Per-button visual band. The colour ramp pins the four bands the
 * overlay's hot path can transition between without re-paying a Phaser
 * `setColor` cost.
 *
 *   • idle      — unhighlighted neutral (grey)
 *   • hover     — pointer over the button (white)
 *   • active    — the *current* state of the player matches this
 *                 button (e.g. "Play" while playing → green)
 *   • disabled  — clickable but currently a no-op (e.g. "Frame advance"
 *                 while playing — that's what `Pause` is for)
 */
export type VcrButtonVisualBand = 'idle' | 'hover' | 'active' | 'disabled';

/**
 * Colour band per visual band. Mirrors the wider HUD palette used by
 * `desyncReportFormat` — same green for "active healthy" and same
 * slate for "neutral".
 */
export const VCR_BUTTON_COLOR_RAMP: ReadonlyArray<{
  readonly band: VcrButtonVisualBand;
  readonly color: number;
}> = Object.freeze([
  Object.freeze({ band: 'idle', color: 0xc0c0d0 }),
  Object.freeze({ band: 'hover', color: 0xffffff }),
  Object.freeze({ band: 'active', color: 0x6cf0c2 }),
  Object.freeze({ band: 'disabled', color: 0x606070 }),
]);

export function buttonStateColor(band: VcrButtonVisualBand): number {
  for (const entry of VCR_BUTTON_COLOR_RAMP) {
    if (entry.band === band) return entry.color;
  }
  return VCR_BUTTON_COLOR_RAMP[0]!.color;
}

/** Phaser uses `'#rrggbb'` for `Text` colours; mirrors `damageHudFormat.ts`. */
export function colorIntToHexString(value: number): string {
  if (!Number.isFinite(value)) return '#000000';
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Playback state — the read-only flags the overlay paints from
// ---------------------------------------------------------------------------

/**
 * Snapshot of the player state the VCR overlay paints from. Built by
 * the host scene every render frame from the `ReplayPlaybackController`
 * (or an equivalent shim). Pure data — no methods, no Phaser. The
 * overlay's `update()` consumes this and re-paints the buttons.
 */
export interface VcrPlaybackState {
  /** Underlying player phase — drives "active" highlighting. */
  readonly phase: ReplayPlaybackPhase;
  /** True iff the player is currently emitting frames every step. */
  readonly isPlaying: boolean;
  /** True iff the player is paused (loaded-but-not-playing or mid-replay halt). */
  readonly isPaused: boolean;
  /** True iff slow-motion is currently on. */
  readonly isSlowMotion: boolean;
  /** True iff the cursor has passed the last recorded frame. */
  readonly isFinished: boolean;
  /** Current cursor position (frame number). */
  readonly currentFrame: number;
  /** First recorded frame, or null if no replay loaded. */
  readonly firstFrame: number | null;
  /** Last recorded frame, or null if no replay loaded. */
  readonly lastFrame: number | null;
  /** Current playback rate — 1.0 is real-time, 0.25 is slow-motion. */
  readonly playbackRate: number;
}

/**
 * Resolve the visual band for a single button given the current
 * playback state and pointer hover flag. Pure — same input always
 * yields the same band.
 *
 * Semantics:
 *   • Play              → active while `isPlaying`
 *   • Pause             → active while `isPaused`
 *   • Slow-motion       → active while `isSlowMotion`
 *   • Rewind            → idle / disabled when no replay loaded
 *   • Frame advance     → active while paused (the canonical use case),
 *                         disabled while playing (would race the cursor)
 *
 * Hover always wins over idle but defers to active / disabled so the
 * highlight doesn't lie about what clicking does.
 */
export function resolveButtonBand(
  control: VcrControl,
  state: VcrPlaybackState,
  hovered: boolean,
): VcrButtonVisualBand {
  const noReplay = state.lastFrame === null;
  switch (control) {
    case VCR_CONTROL.PLAY:
      if (noReplay) return 'disabled';
      if (state.isPlaying) return 'active';
      return hovered ? 'hover' : 'idle';
    case VCR_CONTROL.PAUSE:
      if (noReplay) return 'disabled';
      if (state.isPaused) return 'active';
      return hovered ? 'hover' : 'idle';
    case VCR_CONTROL.REWIND:
      if (noReplay) return 'disabled';
      return hovered ? 'hover' : 'idle';
    case VCR_CONTROL.SLOW_MOTION:
      if (noReplay) return 'disabled';
      if (state.isSlowMotion) return 'active';
      return hovered ? 'hover' : 'idle';
    case VCR_CONTROL.FRAME_ADVANCE:
      if (noReplay) return 'disabled';
      // Frame advance only makes sense while paused; while playing the
      // cursor is already advancing.
      if (state.isPlaying) return 'disabled';
      return hovered ? 'hover' : 'idle';
    default: {
      const exhaustive: never = control;
      void exhaustive;
      return 'idle';
    }
  }
}

// ---------------------------------------------------------------------------
// Read-out strings — timeline / rate / phase
// ---------------------------------------------------------------------------

/**
 * "f1234 / f1800" style cursor read-out. Used as the secondary line of
 * the overlay so a player can see how far into the replay they are.
 * Returns "—" when no replay is loaded.
 */
export function formatTimeline(state: VcrPlaybackState): string {
  if (state.lastFrame === null || state.firstFrame === null) return '—';
  return `f${state.currentFrame} / f${state.lastFrame}`;
}

/**
 * Compact rate badge: "1.0x" / "0.25x". Trims trailing zeroes for a
 * tighter readout, but always keeps one decimal place so the badge
 * width stays stable across rate changes.
 */
export function formatPlaybackRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0.0x';
  // Two-decimal precision keeps 0.25 readable without padding integers
  // to ".00".
  const fixed = rate.toFixed(2);
  // Strip trailing zeros but always keep at least one decimal digit.
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '.0');
  return `${trimmed}x`;
}

/**
 * Friendly phase label. The overlay prints this in its header so the
 * player can tell "the replay finished" from "the replay is paused".
 */
export function formatPhaseLabel(phase: ReplayPlaybackPhase): string {
  switch (phase) {
    case 'idle':
      return 'no replay';
    case 'loaded':
      return 'paused';
    case 'playing':
      return 'playing';
    case 'finished':
      return 'finished';
    default: {
      const exhaustive: never = phase;
      return String(exhaustive);
    }
  }
}

/**
 * Build the multi-line header the overlay paints. Three lines:
 *
 *   "REPLAY PLAYBACK"               ← static title
 *   "playing · 1.0x"                ← phase + rate
 *   "f1234 / f1800"                 ← cursor read-out
 *
 * The overlay places each line on its own Phaser text object; tests
 * read the array verbatim.
 */
export function buildHeaderLines(state: VcrPlaybackState): ReadonlyArray<string> {
  return Object.freeze([
    'REPLAY PLAYBACK',
    `${formatPhaseLabel(state.phase)} · ${formatPlaybackRate(state.playbackRate)}`,
    formatTimeline(state),
  ]);
}

// ---------------------------------------------------------------------------
// Default constants (re-exported for the overlay + tests)
// ---------------------------------------------------------------------------

/** Slow-motion playback rate. 0.25x mirrors a quarter-speed video editor. */
export const SLOW_MOTION_RATE = 0.25;

/** Real-time (no slow-motion) playback rate. */
export const NORMAL_PLAYBACK_RATE = 1.0;

/** Default rewind step in frames (1 second @ 60 Hz). */
export const DEFAULT_REWIND_FRAMES = 60;
