/**
 * UI module.
 *
 * In-game HUD (percent meters, stocks, timer), menus, and the
 * VCR overlay for replay playback.
 *
 * Sub-AC 3 of AC 60003: the {@link DamageHud} component owns the
 * on-screen damage-percent readout for every active fighter — the
 * canonical Smash-Bros bottom strip. Pure formatting helpers live
 * in `damageHudFormat.ts` so they can be unit-tested under plain
 * Node without booting Phaser.
 */
export { DamageHud } from './DamageHud';
export type { DamageHudPlayer, DamageHudOptions } from './DamageHud';
export {
  DAMAGE_HUD_COLOR_RAMP,
  formatDamagePercent,
  damagePercentColor,
  colorIntToHexString,
} from './damageHudFormat';

// ---------------------------------------------------------------------------
// AC 60401 Sub-AC 1 — per-fighter shield bubble overlay
// ---------------------------------------------------------------------------
//
// Translucent coloured "bubble" rendered around each fighter while
// their shield key is held; ramps blue → amber → red as health drains
// and shrinks linearly with shield HP. Switches to a strobing red /
// cream "shatter" ring during the broken-state stun lockout. Pure
// formatter helpers (colour ramp, radius curve, strobe phase) live in
// `shieldBubbleFormat.ts` so the unit suite drives them under plain
// Node; the Phaser-touching component in `ShieldBubble.ts` wraps a
// single `Phaser.GameObjects.Arc` per fighter for trivial per-frame
// cost.
export { ShieldBubble, createShieldBubble } from './ShieldBubble';
export type {
  ShieldBubbleOptions,
  ShieldBubbleSnapshot,
  ShieldArcLike,
  ShieldBubbleSceneShim,
} from './ShieldBubble';
export {
  SHIELD_BUBBLE_ACTIVE_FILL_ALPHA,
  SHIELD_BUBBLE_ACTIVE_STROKE_ALPHA,
  SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH,
  SHIELD_BUBBLE_BROKEN_FILL_COLOR,
  SHIELD_BUBBLE_BROKEN_STROBE_PERIOD,
  SHIELD_BUBBLE_BROKEN_STROKE_COLOR,
  SHIELD_BUBBLE_BROKEN_STROKE_WIDTH,
  SHIELD_BUBBLE_FULL_PADDING,
  SHIELD_BUBBLE_HEALTH_COLOR_RAMP,
  SHIELD_BUBBLE_MIN_PADDING,
  computeShieldBubbleVisual,
  shieldBubbleActiveRadius,
  shieldBubbleBrokenStrobeOn,
  shieldBubbleHealthColor,
  shieldHealthFraction,
} from './shieldBubbleFormat';
export type {
  ShieldBubbleInput,
  ShieldBubbleVisual,
} from './shieldBubbleFormat';

// ---------------------------------------------------------------------------
// Per-fighter charge / wind-up indicator overlay
// ---------------------------------------------------------------------------
//
// Procedural "charging" effect drawn around each fighter while they wind
// a move up (Falcon-Punch-style specials, smash finishers, the heavy
// hammer swing) — a pulsing cool → hot aura ring plus a head-mounted
// charge bar, both driven off `Character.getChargeProgress()`. Pure
// formatter helpers (colour ramp, pulse phase, bar width) live in
// `chargeIndicatorFormat.ts` so the unit suite drives them under plain
// Node; the Phaser-touching component in `ChargeIndicator.ts` wraps an
// aura `Arc` + bar `Rectangle` pair per fighter for trivial per-frame
// cost.
export { ChargeIndicator, createChargeIndicator } from './ChargeIndicator';
export type {
  ChargeIndicatorOptions,
  ChargeIndicatorSnapshot,
  ChargeArcLike,
  ChargeRectLike,
  ChargeIndicatorSceneShim,
} from './ChargeIndicator';
export {
  CHARGE_INDICATOR_BAR_FILL_ALPHA,
  CHARGE_INDICATOR_BAR_GAP_ABOVE_HEAD,
  CHARGE_INDICATOR_BAR_HEIGHT,
  CHARGE_INDICATOR_BAR_TRACK_ALPHA,
  CHARGE_INDICATOR_BAR_WIDTH,
  CHARGE_INDICATOR_COLOR_RAMP,
  CHARGE_INDICATOR_MIN_PROGRESS_TO_SHOW,
  CHARGE_INDICATOR_PULSE_DEPTH,
  CHARGE_INDICATOR_PULSE_PERIOD_FAST,
  CHARGE_INDICATOR_PULSE_PERIOD_SLOW,
  CHARGE_INDICATOR_RING_FILL_ALPHA_MAX,
  CHARGE_INDICATOR_RING_FILL_ALPHA_MIN,
  CHARGE_INDICATOR_RING_PADDING,
  CHARGE_INDICATOR_RING_STROKE_ALPHA_MAX,
  CHARGE_INDICATOR_RING_STROKE_ALPHA_MIN,
  CHARGE_INDICATOR_RING_STROKE_WIDTH_MAX,
  CHARGE_INDICATOR_RING_STROKE_WIDTH_MIN,
  chargeIndicatorColor,
  chargeIndicatorPulseMultiplier,
  chargeIndicatorPulsePeriod,
  computeChargeIndicatorVisual,
} from './chargeIndicatorFormat';
export type {
  ChargeIndicatorInput,
  ChargeIndicatorVisual,
} from './chargeIndicatorFormat';

// ---------------------------------------------------------------------------
// Sub-AC 3 of AC 3 — FPS counter overlay
// ---------------------------------------------------------------------------
//
// Render-rate + simulation tick-rate readout pinned to the top-left of
// every gameplay scene. The Phaser-touching overlay class is in
// `FpsCounter.ts`; pure rolling-window + formatting helpers live in
// `fpsCounterFormat.ts` so the unit suite can drive them with a
// synthetic clock.
export { FpsCounter } from './FpsCounter';
export type { FpsCounterOptions } from './FpsCounter';
export {
  TickRateMeter,
  formatFpsLine,
  formatRate,
  fpsHealthColor,
  FPS_HEALTH_RAMP,
} from './fpsCounterFormat';
export type { TickRateMeterOptions } from './fpsCounterFormat';

// ---------------------------------------------------------------------------
// M5 input-rebinding screen layout (AC 40101 Sub-AC 1)
// ---------------------------------------------------------------------------

export { RebindingScreen } from './RebindingScreen';
export type {
  RebindingScreenOptions,
  RebindingScreenActionRowSnapshot,
  RebindingScreenPanelSnapshot,
  RebindingScreenSceneShim,
  RebindingScreenBindingsSource,
  RebindingCaptureResult,
} from './RebindingScreen';
export {
  CAPTURE_PROMPT_LABEL,
  CAPTURE_HOVER_HINT,
  CAPTURE_CANCEL_KEYCODE,
  CAPTURE_CANCEL_GAMEPAD_BUTTON,
  CAPTURE_AXIS_TRIGGER_THRESHOLD,
  buildKeyboardCaptureBinding,
  buildGamepadButtonCaptureBinding,
  buildGamepadAxisCaptureBinding,
  isAxisPastCaptureThreshold,
  isCaptureCancelKey,
  isCaptureCancelGamepadButton,
} from './bindingCapture';
export type { BindingCaptureState } from './bindingCapture';
export {
  clearGamepadCaptureLatches,
  createGamepadCaptureLatches,
  pollGamepadCaptureEvents,
  refreshGamepadCaptureLatches,
} from './bindingCapturePolling';
export type {
  GamepadCaptureEvent,
  GamepadCaptureLatches,
  GamepadSnapshot,
  PolledGamepad,
  PolledGamepadButton,
} from './bindingCapturePolling';
export {
  REBINDING_DEVICE_OPTIONS,
  DEFAULT_REBINDING_DEVICE_FOR_SLOT,
  formatActionLabel,
  formatBinding,
  formatBindingList,
  formatDeviceLabel,
  formatGamepadBinding,
  formatGamepadSource,
  formatKeyCode,
  inferDeviceOption,
  nextDeviceOption,
  buildActionRows,
} from './rebindingScreenFormat';
export type {
  RebindingActionRow,
  RebindingDeviceOption,
} from './rebindingScreenFormat';

// ---------------------------------------------------------------------------
// AC 40103 Sub-AC 3 — binding-conflict detection + resolution prompts
// ---------------------------------------------------------------------------

export {
  ALLOWED_OVERLAP_PAIRS,
  CONFLICT_TINT,
  bindingIdentity,
  bindingsConflict,
  conflictTintHexString,
  detectAllConflicts,
  detectInterPlayerKeyboardConflicts,
  detectInterPlayerKeyboardConflictsForSlots,
  detectIntraPlayerConflicts,
  formatConflictBannerLines,
  formatConflictResolutionPrompt,
  isAllowedOverlap,
} from './bindingConflicts';
export type {
  BindingConflict,
  BindingConflictKind,
  BindingConflictSeverity,
  BindingLocation,
  ConflictReport,
} from './bindingConflicts';

// ---------------------------------------------------------------------------
// AC 30203 Sub-AC 3 — M4 desync report overlay
// ---------------------------------------------------------------------------
//
// Phaser-touching overlay (DesyncReportOverlay) and its pure formatter
// helpers (desyncReportFormat) render the structured DesyncReport the
// `replay/DesyncRecoveryController` accumulates. The overlay surfaces
// the verdict, divergence list, diff summary, and recovery action
// buttons so a player can halt or continue playback from the in-game
// banner.
export { DesyncReportOverlay } from './DesyncReportOverlay';
export type {
  DesyncReportOverlayOptions,
  DesyncReportOverlayActions,
  DesyncReportOverlaySceneShim,
} from './DesyncReportOverlay';
export {
  DESYNC_VERDICT_COLOR_RAMP,
  buildBannerLines,
  buildDivergenceRows,
  formatDiffSummaryLine,
  formatDivergenceRow,
  formatHaltSummaryLine,
  formatStatLine,
  formatStatusLabel,
  formatToleranceLabel,
  formatVerdictLabel,
  shortChecksum,
  verdictColor,
} from './desyncReportFormat';
export type { DivergenceRow } from './desyncReportFormat';

// ---------------------------------------------------------------------------
// AC 14 Sub-AC 3 — controller reconnect-prompt overlay
// ---------------------------------------------------------------------------
//
// Phaser-touching overlay (ReconnectPromptOverlay) and its pure
// formatter helpers (reconnectPromptFormat) render the prompt the
// MatchScene shows while the {@link DisconnectPauseController} is
// holding a pause. The overlay surfaces the affected player slot(s),
// remediation copy, and a per-slot accent strip; the formatter
// produces the strings deterministically so unit tests can drive every
// branch under plain Node.
export { ReconnectPromptOverlay } from './ReconnectPromptOverlay';
export type {
  ReconnectPromptOverlayOptions,
  ReconnectPromptOverlaySceneShim,
} from './ReconnectPromptOverlay';
export {
  RECONNECT_SLOT_ACCENTS,
  buildPromptLines,
  formatAffectedSlotsLabel,
  formatPromptBodyLines,
  formatPromptHeadline,
  formatSlotLabel,
  pickPadHintLabel,
  shouldShowOverlay,
  slotAccentColor,
} from './reconnectPromptFormat';
export type {
  ReconnectPromptPhase,
  ReconnectPromptSnapshot,
} from './reconnectPromptFormat';

// ---------------------------------------------------------------------------
// AC 30301 Sub-AC 1 — M4 replay VCR control overlay
// ---------------------------------------------------------------------------
//
// `VcrOverlay` is the Phaser-touching presentation layer for the M4
// replay player's transport controls — pause / play / rewind /
// slow-motion toggle / frame-advance with keyboard shortcut bindings
// and visual band indicators (idle / hover / active / disabled). The
// pure formatting helpers (`vcrOverlayFormat`) live alongside so the
// vitest suite drives them under plain Node.
export { VcrOverlay, buildVcrPlaybackState } from './VcrOverlay';
export type {
  VcrOverlayOptions,
  VcrOverlayActions,
  VcrOverlaySceneShim,
  VcrKeyboardBinder,
  VcrPlaybackStateSource,
} from './VcrOverlay';
export {
  VCR_CONTROL,
  VCR_CONTROL_ORDER,
  VCR_BUTTON_LAYOUT,
  VCR_BUTTON_COLOR_RAMP,
  SLOW_MOTION_RATE,
  NORMAL_PLAYBACK_RATE,
  DEFAULT_REWIND_FRAMES,
  buildHeaderLines as buildVcrHeaderLines,
  buttonStateColor,
  findButtonLayout,
  findControlForKeyCode,
  formatPhaseLabel as formatVcrPhaseLabel,
  formatPlaybackRate,
  formatTimeline as formatVcrTimeline,
  resolveButtonBand,
  resolveSpaceShortcut,
} from './vcrOverlayFormat';
export type {
  VcrButtonLayout,
  VcrButtonVisualBand,
  VcrControl,
  VcrPlaybackState,
} from './vcrOverlayFormat';
