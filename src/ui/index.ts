
export {
  DAMAGE_HUD_COLOR_RAMP,
  formatDamagePercent,
  damagePercentColor,
  colorIntToHexString,
} from './damageHudFormat';
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
export {
  TickRateMeter,
  formatFpsLine,
  formatRate,
  fpsHealthColor,
  FPS_HEALTH_RAMP,
} from './fpsCounterFormat';
export type { TickRateMeterOptions } from './fpsCounterFormat';
export {
  CAPTURE_PROMPT_LABEL,
  CAPTURE_HOVER_HINT,
  CAPTURE_CANCEL_KEYCODE,
  CAPTURE_CANCEL_GAMEPAD_BUTTON,
  CAPTURE_AXIS_TRIGGER_THRESHOLD,
  buildKeyboardCaptureBinding,
  buildGamepadButtonCaptureBinding,
  buildGamepadAxisCaptureBinding,
  captureBindingsForAction,
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
  formatControlsHelpLine,
  formatStickLabel,
  formatDeviceLabel,
  formatGamepadBinding,
  formatGamepadSource,
  formatKeyCode,
  groupStickBindings,
  inferDeviceOption,
  inferKeyboardHalf,
  nextDeviceOption,
  buildActionRows,
} from './rebindingScreenFormat';
export type {
  BindingDisplayItem,
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
  formatConflictEntryPrompt,
  formatConflictResolutionPrompt,
  groupConflictsForBanner,
  isAllowedOverlap,
} from './bindingConflicts';
export type {
  BindingConflict,
  BindingConflictKind,
  BindingConflictSeverity,
  BindingLocation,
  ConflictReport,
} from './bindingConflicts';
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
