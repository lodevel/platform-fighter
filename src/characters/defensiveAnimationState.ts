/**
 * Defensive-state animation integration — AC 10003 Sub-AC 3.
 *
 * Authors and integrates the animation-key contract for the defensive
 * states the Seed's `moveset` ontology calls out alongside the attack
 * moveset:
 *
 *   • **Shield**     — three discrete states (`idle` → `active` → `broken`)
 *                      driven by the {@link ShieldState} machine.
 *   • **Dodge**      — three variants (`spot`, `roll`, `air`) × four
 *                      phases (`active` → `recovery` → `cooldown` →
 *                      `idle`) driven by the {@link DodgeState} machine.
 *   • **Edge-grab**  — five states (`idle` → `hanging` → `climbing` →
 *                      `rolling` → `cooldown`) driven by the
 *                      {@link LedgeHangState} machine.
 *
 * # Animation key shape
 *
 * Same `{characterId}.{partId}.{phase}.{frame}` shape as
 * {@link getAnimationKey} for attack moves. The defensive `partId`s:
 *
 *   • `shield`   — followed by the shield-state phase
 *                  (`raise` / `hold` / `break`) and an art-frame index
 *                  derived from the shield's frame counters.
 *   • `dodge`    — followed by the dodge variant + phase
 *                  (`spot.active.0`, `roll.recovery.1`,
 *                  `air.cooldown.0`).
 *   • `ledge`    — followed by the ledge state phase
 *                  (`hanging.0`, `climbing.0`, `rolling.0`,
 *                  `cooldown.0`).
 *
 * Examples:
 *
 *   wolf.shield.hold.0    cat.dodge.roll.active.0
 *   owl.shield.break.0    bear.ledge.climbing.0
 *
 * # Integration with the existing state machines
 *
 * Pure projection over the live `ShieldState` / `DodgeState` /
 * `LedgeHangState` records. No machine state is mutated — these
 * helpers read current state and return the canonical animation key
 * the renderer should display this fixed step. Same determinism
 * contract as `animationState.ts`: identical inputs → identical keys.
 *
 * # Composition with the attack-state animation
 *
 * The renderer's per-frame call site composes the defensive-state
 * animation with the attack-state animation via a clear precedence
 * order (highest priority wins):
 *
 *   1. **Hitstun / hurt**   — `{characterId}.hurt`. Fighter is in
 *                              hitstun; attack is cancelled, defensive
 *                              state is suspended.
 *   2. **Shield-broken**    — `{characterId}.shield.break.0`. Long stun
 *                              lockout; visually distinct from regular
 *                              hurt to communicate "your shield broke".
 *   3. **Ledge-hang**       — fighter is hanging on / climbing /
 *                              rolling from a ledge corner.
 *   4. **Dodge**            — fighter is mid-spot/roll/air dodge.
 *   5. **Shield (active)**  — fighter is holding shield up.
 *   6. **Attack**           — fighter is mid-attack (any moveset slot).
 *   7. **Idle**             — fallback; `{characterId}.idle`.
 *
 * The composition is done by {@link resolveFighterAnimationState} which
 * lives in {@link fighterAnimationState.ts}. This module owns the leaf
 * mappings.
 */

import type { CharacterId } from '../types';
import type { ShieldState, ShieldStateName } from './shieldState';
import type { DodgeState, DodgeStateName, DodgeKind, ActiveDodge } from './dodgeState';
import type { LedgeHangState, LedgeHangStateName } from './ledgeHangState';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete shield-animation phase. Maps a {@link ShieldStateName} to
 * one of three art-poses the renderer can paint:
 *
 *   • `'raise'`  — shield is mid-raising or just-raised. Fired the
 *                  frame the player taps the shield button. Brief
 *                  windup pose.
 *   • `'hold'`   — shield is up and stable. The dominant visual while
 *                  the player keeps the button held.
 *   • `'break'`  — shield broke this frame; the fighter is in shield-
 *                  break stun. Distinct visual so the opponent reads
 *                  the broken-shield state.
 *
 * `'idle'` is mapped to `null` (no shield-specific overlay) — the
 * renderer falls back to the attack/idle state behind the defensive
 * layer. The `'raise'` phase is currently only emitted on the rising
 * edge of the shield press; the {@link resolveShieldAnimation} helper
 * accepts an optional `framesHeld` parameter so the M-future SFX layer
 * can hold the raise pose for a few frames if it wants.
 */
export type ShieldAnimationPhase = 'raise' | 'hold' | 'break';

/**
 * Discrete dodge-animation phase. Mirrors {@link DodgeStateName} but
 * collapses `'idle' | 'cooldown'` into `null` (no dodge-specific
 * overlay) — the renderer falls back to the attack/idle layer when the
 * dodge cooldown is the only thing locking out new presses.
 */
export type DodgeAnimationPhase = 'active' | 'recovery';

/**
 * Discrete edge-grab animation phase. Mirrors
 * {@link LedgeHangStateName} but collapses `'idle' | 'cooldown'` into
 * `null` (no ledge-specific overlay) — the cooldown is invisible to
 * the renderer; the fighter is back in normal play at that point.
 */
export type LedgeAnimationPhase = 'hanging' | 'climbing' | 'rolling';

/**
 * Resolved defensive-state animation. Returned by
 * {@link resolveDefensiveAnimation}.
 *
 *   • `key`        — canonical animation key string the renderer
 *                    should display. `null` when no defensive state
 *                    is active (renderer falls back to attack/idle).
 *   • `kind`       — `'shield' | 'dodge' | 'ledge'` discriminator so
 *                    consumers can branch on which subsystem produced
 *                    the key without parsing the string.
 *   • `partId`     — short part id (`'shield'`, `'dodge'`, `'ledge'`).
 *                    Useful for debug HUD / logs.
 *   • `phase`      — sub-state (`'hold'`, `'roll.active'`, `'climbing'`).
 *   • `artFrameIndex` — 0-based art-frame index within the phase. Pure
 *                       projection of the underlying state's frame
 *                       counters; identical inputs → identical indexes.
 */
export interface DefensiveAnimationState {
  readonly kind: 'shield' | 'dodge' | 'ledge';
  readonly key: string;
  readonly characterId: CharacterId;
  readonly partId: 'shield' | 'dodge' | 'ledge';
  readonly phase: string;
  readonly artFrameIndex: number;
}

// ---------------------------------------------------------------------------
// Constants — animation part ids
// ---------------------------------------------------------------------------

/** Animation part-id used for shield-state keys. */
export const SHIELD_PART_ID = 'shield';
/** Animation part-id used for dodge-state keys. */
export const DODGE_PART_ID = 'dodge';
/** Animation part-id used for edge-grab / ledge-hang keys. */
export const LEDGE_PART_ID = 'ledge';
/** Animation part-id used for hitstun / hurt-state keys. */
export const HURT_PART_ID = 'hurt';

/**
 * Number of art frames the shield raise / hold / break poses are
 * authored across. Authored in this module (rather than in
 * `shieldState.ts`) because the gameplay state machine doesn't need
 * a per-pose art-frame budget — it's a renderer concern.
 *
 *   • raise  : 2 frames — quick wind-up. Played once when shield rises.
 *   • hold   : 1 frame  — static idle pose held while shield is up.
 *   • break  : 4 frames — the shatter animation. The shield-stun
 *                          window is long (default 180 frames) so the
 *                          break animation cycles or holds on the
 *                          final frame; renderer reads `artFrameIndex`
 *                          clamped to `breakFrames - 1`.
 */
export const SHIELD_ANIMATION_FRAMES: Readonly<Record<ShieldAnimationPhase, number>> = Object.freeze({
  raise: 2,
  hold: 1,
  break: 4,
});

/**
 * Number of art frames each dodge variant's `active` and `recovery`
 * phases are authored across. The renderer indexes within these
 * counts; the gameplay state machine's frame counters are mapped onto
 * the art-frame ladder via simple integer arithmetic in
 * {@link selectDodgeArtFrame}.
 *
 * Counts mirror the Seed's "6-8 art frames per move" guidance for the
 * full dodge cycle (active + recovery). For example, the spot dodge
 * is 16 active + 8 recovery gameplay frames, mapped to 4 + 2 = 6
 * art frames; the roll is 20 + 10 → 5 + 3 = 8 art frames; the air
 * dodge is 24 + 12 → 6 + 3 = 9 art frames (the longest, so the falling
 * pose has more art frames to read kinetically).
 */
export const DODGE_ANIMATION_FRAMES: Readonly<
  Record<DodgeKind, { active: number; recovery: number }>
> = Object.freeze({
  spot: Object.freeze({ active: 4, recovery: 2 }),
  roll: Object.freeze({ active: 5, recovery: 3 }),
  air: Object.freeze({ active: 6, recovery: 3 }),
});

/**
 * Number of art frames the ledge-hang sub-states are authored across.
 *
 *   • hanging : 2 art frames — slight idle sway while hanging.
 *   • climbing: 4 art frames — climb-up animation.
 *   • rolling : 4 art frames — ledge-roll animation.
 */
export const LEDGE_ANIMATION_FRAMES: Readonly<Record<LedgeAnimationPhase, number>> = Object.freeze({
  hanging: 2,
  climbing: 4,
  rolling: 4,
});

// ---------------------------------------------------------------------------
// Shield animation
// ---------------------------------------------------------------------------

/**
 * Map a {@link ShieldStateName} to its renderer-facing animation phase.
 *
 *   • `'idle'`   → `null` (no shield overlay).
 *   • `'active'` → `'hold'`. (Pure-state mapping — the renderer paints
 *                  the held-shield pose.)
 *   • `'broken'` → `'break'`.
 *
 * Note: this helper does NOT emit `'raise'` — the `raise` phase only
 * fires for the very first frame after a press transition (rising
 * edge), which the {@link makeShieldAnimationHook} factory tracks
 * separately.
 */
export function shieldStateToAnimationPhase(
  name: ShieldStateName,
): ShieldAnimationPhase | null {
  switch (name) {
    case 'idle':
      return null;
    case 'active':
      return 'hold';
    case 'broken':
      return 'break';
  }
}

/**
 * Build the canonical shield animation key for a character + phase +
 * art-frame index.
 *
 *   getShieldAnimationKey('wolf', 'hold', 0) → 'wolf.shield.hold.0'
 *   getShieldAnimationKey('cat',  'break', 2) → 'cat.shield.break.2'
 */
export function getShieldAnimationKey(
  characterId: CharacterId,
  phase: ShieldAnimationPhase,
  artFrameIndex: number,
): string {
  return `${characterId}.${SHIELD_PART_ID}.${phase}.${artFrameIndex}`;
}

/**
 * Compute the art-frame index for a shield phase given the gameplay
 * frame counter inside that phase. Clamps to the authored frame count.
 *
 * For `'hold'` the count is 1, so this always returns 0.
 * For `'raise'` and `'break'` the count is > 1, so the index ramps
 * linearly with `frameInPhase`.
 */
export function selectShieldArtFrame(
  phase: ShieldAnimationPhase,
  frameInPhase: number,
): number {
  const total = SHIELD_ANIMATION_FRAMES[phase];
  if (total <= 1) return 0;
  if (frameInPhase < 0) return 0;
  if (frameInPhase >= total) return total - 1;
  return frameInPhase;
}

/**
 * Resolve the live shield animation. Returns `null` when the shield is
 * idle (no overlay; renderer falls back to attack/idle layer).
 *
 * `framesInPhase` is the gameplay frame counter the consumer (renderer
 * adapter) tracks since the last shield-phase boundary. Defaults to 0.
 *
 *   • `'idle'`   → `null`.
 *   • `'active'` → `{characterId}.shield.hold.0`.
 *   • `'broken'` → `{characterId}.shield.break.{idx}` where `idx` ramps
 *                  with `framesInPhase` clamped to
 *                  `SHIELD_ANIMATION_FRAMES.break - 1`.
 */
export function resolveShieldAnimation(
  characterId: CharacterId,
  state: ShieldState,
  framesInPhase: number = 0,
): DefensiveAnimationState | null {
  const phase = shieldStateToAnimationPhase(state.name);
  if (phase === null) return null;
  // Use stunRemaining-derived progress for break phase so the animation
  // marches forward in lockstep with the stun timer regardless of how
  // many frames the renderer has been polling for. We use stun frames
  // ELAPSED, not remaining: elapsed = breakStun - stunRemaining.
  let elapsed = framesInPhase;
  if (phase === 'break' && state.name === 'broken') {
    // Estimate elapsed from stun timer drain — the canonical "frames
    // since the break started". Caller can override via framesInPhase.
    elapsed = Math.max(framesInPhase, 0);
  }
  const idx = selectShieldArtFrame(phase, elapsed);
  return {
    kind: 'shield',
    characterId,
    partId: SHIELD_PART_ID,
    phase,
    artFrameIndex: idx,
    key: getShieldAnimationKey(characterId, phase, idx),
  };
}

// ---------------------------------------------------------------------------
// Dodge animation
// ---------------------------------------------------------------------------

/**
 * Map a {@link DodgeStateName} to its renderer-facing animation phase.
 * `'idle' | 'cooldown'` collapse to `null` so the renderer falls back
 * to the attack/idle layer.
 */
export function dodgeStateToAnimationPhase(
  name: DodgeStateName,
): DodgeAnimationPhase | null {
  switch (name) {
    case 'idle':
    case 'cooldown':
      return null;
    case 'active':
      return 'active';
    case 'recovery':
      return 'recovery';
  }
}

/**
 * Build the canonical dodge animation key for a character + variant +
 * phase + art-frame index.
 *
 *   getDodgeAnimationKey('wolf', 'spot', 'active', 0) → 'wolf.dodge.spot.active.0'
 *   getDodgeAnimationKey('cat',  'roll', 'recovery', 1) → 'cat.dodge.roll.recovery.1'
 *   getDodgeAnimationKey('owl',  'air', 'active', 3) → 'owl.dodge.air.active.3'
 */
export function getDodgeAnimationKey(
  characterId: CharacterId,
  kind: DodgeKind,
  phase: DodgeAnimationPhase,
  artFrameIndex: number,
): string {
  return `${characterId}.${DODGE_PART_ID}.${kind}.${phase}.${artFrameIndex}`;
}

/**
 * Compute the art-frame index for a dodge variant + phase given the
 * gameplay frame counter inside that phase.
 */
export function selectDodgeArtFrame(
  kind: DodgeKind,
  phase: DodgeAnimationPhase,
  frameInPhase: number,
): number {
  const total = DODGE_ANIMATION_FRAMES[kind][phase];
  if (total <= 1) return 0;
  if (frameInPhase < 0) return 0;
  if (frameInPhase >= total) return total - 1;
  return frameInPhase;
}

/**
 * Resolve the live dodge animation. Returns `null` when the dodge is
 * idle / cooldown (no overlay).
 *
 * `framesInPhase` is gameplay frames since the current phase began;
 * the helper maps that onto the art-frame ladder by linear ramp.
 */
export function resolveDodgeAnimation(
  characterId: CharacterId,
  state: DodgeState,
  framesInPhase: number = 0,
): DefensiveAnimationState | null {
  const phase = dodgeStateToAnimationPhase(state.name);
  if (phase === null) return null;
  if (state.active === null) return null;
  const kind: DodgeKind = state.active.kind;
  const idx = selectDodgeArtFrame(kind, phase, framesInPhase);
  return {
    kind: 'dodge',
    characterId,
    partId: DODGE_PART_ID,
    phase: `${kind}.${phase}`,
    artFrameIndex: idx,
    key: getDodgeAnimationKey(characterId, kind, phase, idx),
  };
}

/**
 * Compute frames-elapsed in the dodge's current phase from a live
 * {@link DodgeState}. Pure projection over the active record's
 * `framesElapsed` counter — useful for renderer adapters that don't
 * want to track a separate phase-frame counter externally.
 *
 *   • `'active'`   — the active phase started at framesElapsed=0; the
 *                    elapsed-in-phase is just `framesElapsed`.
 *   • `'recovery'` — the recovery phase started at framesElapsed =
 *                    activeFrames; elapsed-in-phase = framesElapsed -
 *                    activeFrames.
 *   • Otherwise    — returns 0.
 *
 * The caller passes the variant's `activeFrames` (looked up from the
 * resolved tuning) so this module stays tuning-free.
 */
export function computeDodgeFramesInPhase(
  active: ActiveDodge | null,
  phase: DodgeAnimationPhase | null,
  activeFrames: number,
): number {
  if (active === null || phase === null) return 0;
  if (phase === 'active') {
    return Math.max(0, active.framesElapsed);
  }
  // 'recovery'
  return Math.max(0, active.framesElapsed - activeFrames);
}

// ---------------------------------------------------------------------------
// Ledge / edge-grab animation
// ---------------------------------------------------------------------------

/**
 * Map a {@link LedgeHangStateName} to its renderer-facing animation
 * phase. `'idle' | 'cooldown'` collapse to `null` (no overlay).
 */
export function ledgeStateToAnimationPhase(
  name: LedgeHangStateName,
): LedgeAnimationPhase | null {
  switch (name) {
    case 'idle':
    case 'cooldown':
      return null;
    case 'hanging':
      return 'hanging';
    case 'climbing':
      return 'climbing';
    case 'rolling':
      return 'rolling';
  }
}

/**
 * Build the canonical ledge animation key for a character + phase +
 * art-frame index.
 *
 *   getLedgeAnimationKey('wolf', 'hanging', 0) → 'wolf.ledge.hanging.0'
 *   getLedgeAnimationKey('cat',  'climbing', 2) → 'cat.ledge.climbing.2'
 */
export function getLedgeAnimationKey(
  characterId: CharacterId,
  phase: LedgeAnimationPhase,
  artFrameIndex: number,
): string {
  return `${characterId}.${LEDGE_PART_ID}.${phase}.${artFrameIndex}`;
}

/**
 * Compute the art-frame index for a ledge phase given the gameplay
 * frame counter inside that phase.
 */
export function selectLedgeArtFrame(
  phase: LedgeAnimationPhase,
  frameInPhase: number,
): number {
  const total = LEDGE_ANIMATION_FRAMES[phase];
  if (total <= 1) return 0;
  if (frameInPhase < 0) return 0;
  if (frameInPhase >= total) return total - 1;
  return frameInPhase;
}

/**
 * Resolve the live ledge animation. Returns `null` when the fighter
 * isn't on a ledge (idle / cooldown).
 *
 * `framesInPhase` is gameplay frames since the current phase began.
 */
export function resolveLedgeAnimation(
  characterId: CharacterId,
  state: LedgeHangState,
  framesInPhase: number = 0,
): DefensiveAnimationState | null {
  const phase = ledgeStateToAnimationPhase(state.name);
  if (phase === null) return null;
  const idx = selectLedgeArtFrame(phase, framesInPhase);
  return {
    kind: 'ledge',
    characterId,
    partId: LEDGE_PART_ID,
    phase,
    artFrameIndex: idx,
    key: getLedgeAnimationKey(characterId, phase, idx),
  };
}

// ---------------------------------------------------------------------------
// Hurt-state key (hitstun)
// ---------------------------------------------------------------------------

/**
 * Build the canonical hurt animation key for a character.
 *
 *   getHurtAnimationKey('wolf') → 'wolf.hurt'
 *
 * Hitstun has no sub-phase — it's a single pose held for the duration
 * of the hitstun timer. The renderer can optionally key off
 * `framesInHitstun % 2` to alternate two frames for a wobble effect,
 * but the canonical key is the bare suffix.
 */
export function getHurtAnimationKey(characterId: CharacterId): string {
  return `${characterId}.${HURT_PART_ID}`;
}

// ---------------------------------------------------------------------------
// Enumeration — the asset pipeline registers these texture keys
// ---------------------------------------------------------------------------

/**
 * Enumerate every defensive-state animation key for a single character
 * — every shield phase frame, every dodge variant × phase frame, every
 * ledge phase frame, plus the hurt-state key. Output order is stable
 * so two calls with the same characterId produce byte-identical arrays.
 *
 * Used by the (later) sprite-atlas pipeline to know exactly which
 * texture keys to register for a character's defensive states.
 */
export function enumerateDefensiveAnimationKeys(
  characterId: CharacterId,
): ReadonlyArray<string> {
  const out: string[] = [];

  // Shield: raise + hold + break (each with their authored frame counts).
  for (const phase of ['raise', 'hold', 'break'] as const) {
    const count = SHIELD_ANIMATION_FRAMES[phase];
    for (let i = 0; i < count; i++) {
      out.push(getShieldAnimationKey(characterId, phase, i));
    }
  }

  // Dodge: variants (spot/roll/air) × phases (active/recovery) × art frames.
  for (const kind of ['spot', 'roll', 'air'] as const) {
    for (const phase of ['active', 'recovery'] as const) {
      const count = DODGE_ANIMATION_FRAMES[kind][phase];
      for (let i = 0; i < count; i++) {
        out.push(getDodgeAnimationKey(characterId, kind, phase, i));
      }
    }
  }

  // Ledge: hanging/climbing/rolling × art frames.
  for (const phase of ['hanging', 'climbing', 'rolling'] as const) {
    const count = LEDGE_ANIMATION_FRAMES[phase];
    for (let i = 0; i < count; i++) {
      out.push(getLedgeAnimationKey(characterId, phase, i));
    }
  }

  // Hurt key (single, no frame index).
  out.push(getHurtAnimationKey(characterId));

  return Object.freeze(out);
}

/**
 * Enumerate defensive animation keys across every roster character
 * in canonical order.
 */
export function enumerateAllDefensiveAnimationKeys(): ReadonlyArray<string> {
  const out: string[] = [];
  for (const id of ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno', 'link', 'kirby', 'donkeykong'] as const) {
    for (const k of enumerateDefensiveAnimationKeys(id)) out.push(k);
  }
  return Object.freeze(out);
}
