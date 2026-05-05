/**
 * Aerial attack data schema — Sub-AC 1 of AC 60101.
 *
 * Extends the shared `AttackMoveWithAnimation` contract from
 * `moveSchema.ts` with the two aerial-specific concepts the rest of
 * the engine needs to model in-air combat correctly:
 *
 *   1. **Landing lag** — when an aerial attack is interrupted by a
 *      touchdown (the fighter lands while still mid-attack), the move's
 *      normal recovery is *replaced* by a "landing lag" recovery
 *      window. While locked in landing-lag, the fighter cannot dash,
 *      jump, attack, or shield. This is the canonical Smash-style
 *      "shfft! you got punished for landing in lag" mechanic — a poorly
 *      timed aerial leaves the fighter open for a counter-poke from
 *      the opponent.
 *
 *      Authored as a single integer `landingLagFrames` per move. Faster
 *      moves with more committal recovery (Wolf's bair finisher, Bear's
 *      heavy nair) carry larger landing-lag values; quick pokes (Cat's
 *      nair, Owl's forward-staff jab) carry smaller ones.
 *
 *      Reserved field — the runtime physics already supports the
 *      "interrupt recovery on landing" path through `Character.cancelAttack`,
 *      and a follow-up sub-AC will wire `landingLagFrames` into a
 *      `Character.lockoutFrames(...)` pass that drives the new lockout
 *      timer. Authoring this value today gives the (later AC) lockout
 *      handler a stable contract from day one.
 *
 *   2. **Auto-cancel windows** — frame ranges within a move during
 *      which a touchdown skips the landing-lag penalty entirely. The
 *      canonical "auto-cancel" rule: if your aerial finishes its
 *      hitbox cleanly and you land during a designated late window,
 *      you incur ZERO landing lag — the move blends into a clean
 *      landing animation.
 *
 *      Authored as `ReadonlyArray<AutoCancelWindow>`. Each window has a
 *      half-open `[startFrame, endFrame)` range over the move's
 *      gameplay-frame counter. The canonical pattern is two windows:
 *        - an early "before hitbox" window so a fighter who cancels
 *          their aerial input on the way down doesn't get punished
 *          by latency,
 *        - a late "after recovery" window so the recovery's tail
 *          frames don't punish a clean swing-and-land.
 *
 *      `isAutoCancelFrame(move, framesElapsed)` reads this as a pure
 *      predicate so the (later AC) lockout handler can branch on
 *      "would landing right now skip the lag?" without reaching into
 *      the move's internals.
 *
 * Why a separate file (and not just keep extending `moveSchema.ts`):
 *
 *   • `moveSchema.ts` is the shared *base* attack data contract — every
 *     move (jab, tilt, smash, aerial, special) reads from those types.
 *     Adding aerial-only fields there would force every grounded move
 *     to declare `landingLagFrames: 0`-or-undefined just to satisfy
 *     the schema, which is exactly the structural noise the
 *     "additive-only schema evolution" rule of the original module
 *     was designed to avoid.
 *
 *   • Aerial-specific concerns (auto-cancel, landing lag) are easier
 *     to find and audit in one file than scattered through
 *     `moveSchema.ts`. The (later AC) balance-pass tooling can
 *     iterate `AerialMove`s without filtering grounded moves out.
 *
 * Frame model (mirrors `AttackMove` and adds two timeline annotations):
 *
 *   ┌───── startup ──┬──── active ──┬──── recovery ────┬── cooldown ──┐
 *   │                │              │                  │              │
 *   │  hitbox idle   │  hitbox live │  hitbox despawned │ next press   │
 *   │                │              │                  │              │
 *   ├═══════ auto-cancel ═══════════┼──── lag-on-land ─┼═══════════════
 *   │   (if a window covers this    │  (touchdown here │
 *   │    frame, landing skips lag)  │  triggers the    │
 *   │                                │  landing-lag    │
 *   │                                │  lockout)        │
 *
 *   Touchdown OUTSIDE any auto-cancel window during *startup, active,
 *   or recovery* phases triggers `landingLagFrames` of lockout. Inside
 *   an auto-cancel window, touchdown produces a clean landing.
 *
 * Determinism: every helper here is a pure function of integer frame
 * counters and frozen move data. No `Math.random()`, no `Date.now()`,
 * no Matter / Phaser side effects. Identical inputs always produce
 * identical outputs — the property the replay system requires.
 *
 * Backwards compatibility: this module is purely additive. The existing
 * `AttackMove`, `AttackMoveWithAnimation`, the move data tables on
 * Wolf/Cat/Owl/Bear, and the runtime attack state machine all keep
 * working unchanged. The pre-existing `WOLF_NAIR` / `CAT_NAIR` records
 * (typed as plain `AttackMove`) remain in the moveset and the new
 * `AerialMove`-typed records (`WOLF_NAIR_AERIAL`, the fairs, the bairs,
 * the new Owl/Bear aerials) are appended as authored data ready for
 * the runtime wiring sub-AC. Mixing both shapes in a roster's
 * `moves` array stays type-safe because every `AerialMove` is also an
 * `AttackMove` (structural subtyping).
 */

import type { AttackMove } from './attacks';
import type {
  AttackMoveWithAnimation,
  AttackPhase,
} from './moveSchema';
import { computeAttackPhase, getMoveBusyFrames } from './moveSchema';

// ---------------------------------------------------------------------------
// Auto-cancel phase tagging (AC 60204 Sub-AC 4)
// ---------------------------------------------------------------------------

/**
 * The two valid frame-range "buckets" an auto-cancel window may live
 * in. Sub-AC 4 of AC 60204 requires every authored auto-cancel window
 * to be a *designated* startup-or-recovery range:
 *
 *   • `'startup'`  — landing during this window means the player
 *                    twitch-pressed an aerial on the way down and
 *                    touched the ground BEFORE the hitbox came out.
 *                    Cleanest possible cancel — no commitment cost.
 *
 *   • `'recovery'` — landing during this window means the swing
 *                    happened cleanly and the fighter is in the tail
 *                    end of the move (hitbox already despawned). A
 *                    well-spaced aerial-to-land combo lives in this
 *                    bucket: connect the hit, ride out the recovery,
 *                    touch down with no lag, follow up immediately.
 *
 * The `'active'` phase is intentionally excluded — auto-cancelling a
 * still-live hitbox would mean a fighter who landed mid-swing escapes
 * the recovery they just committed to AND keeps the hit they're
 * currently dealing. That's a degenerate balance footgun, so the
 * schema validator now rejects any window that overlaps `'active'`.
 *
 * The `'done'` phase is implicit — once a move's busy window is over
 * the fighter's already free, so "auto-cancel during done" is the
 * trivial truth `isAutoCancelFrame` already encodes (see line ~316).
 */
export type AutoCancelPhase = 'startup' | 'recovery';

// ---------------------------------------------------------------------------
// Aerial direction
// ---------------------------------------------------------------------------

/**
 * Which directional input the player held when starting the aerial.
 * Used by the (later AC) input layer to dispatch
 * "stick + jump + attack press" to the right move id, and by AI
 * predictors that need to enumerate "what aerials does this fighter
 * have in this matchup?".
 *
 *   - `'neutral'` : nair — no horizontal stick input.
 *   - `'forward'` : fair — stick toward facing direction.
 *   - `'back'`    : bair — stick away from facing direction. Hitbox
 *                   is authored facing-right like every other move and
 *                   the runtime mirrors it the same way; the
 *                   `'back'` label tells the input layer to dispatch
 *                   bair when the stick points opposite the fighter's
 *                   facing.
 *
 * `'up'` / `'down'` extend the union for the post-M2 directional
 * aerial kit (uair / dair). The runtime routing in
 * `extendedSlotResolver.ts` maps stick directions to these slots
 * with safe fallback to `fair` when an extended aerial isn't
 * authored.
 */
export type AerialDirection = 'neutral' | 'forward' | 'back' | 'up' | 'down';

// ---------------------------------------------------------------------------
// Auto-cancel windows
// ---------------------------------------------------------------------------

/**
 * Half-open `[startFrame, endFrame)` range over a move's gameplay-frame
 * counter. A touchdown landing during any frame `f` where
 * `startFrame <= f < endFrame` produces ZERO landing lag — the move
 * "auto-cancels" cleanly into the landing animation.
 *
 * The half-open convention matches `computeAttackPhase`'s exclusive
 * boundaries — same `f < startupFrames` style — so reasoning about
 * frame ranges stays consistent across the schema.
 */
export interface AutoCancelWindow {
  /** Inclusive lower bound on the gameplay-frame counter. */
  readonly startFrame: number;
  /** Exclusive upper bound. */
  readonly endFrame: number;
}

/**
 * Validate an auto-cancel window record. Used by the unit tests to
 * lock down the schema invariant ("startFrame < endFrame, both
 * non-negative"). Returns the window unchanged on success; throws
 * on a malformed record.
 *
 * Pure — no side effects.
 */
export function validateAutoCancelWindow(w: AutoCancelWindow): AutoCancelWindow {
  if (!Number.isInteger(w.startFrame) || !Number.isInteger(w.endFrame)) {
    throw new Error(
      `AutoCancelWindow: startFrame/endFrame must be integers, got [${w.startFrame}, ${w.endFrame})`,
    );
  }
  if (w.startFrame < 0) {
    throw new Error(
      `AutoCancelWindow: startFrame must be non-negative, got ${w.startFrame}`,
    );
  }
  if (w.endFrame <= w.startFrame) {
    throw new Error(
      `AutoCancelWindow: endFrame (${w.endFrame}) must be > startFrame (${w.startFrame})`,
    );
  }
  return w;
}

// ---------------------------------------------------------------------------
// AerialMove
// ---------------------------------------------------------------------------

/**
 * Full aerial-attack data record. Extends `AttackMoveWithAnimation`
 * with the two aerial-specific fields documented at the top of this
 * file:
 *
 *   • `landingLagFrames` — penalty lockout if landing happens
 *     mid-move and outside any auto-cancel window. The lockout
 *     replaces the move's remaining recovery; the fighter is
 *     committed to a landing animation for this many frames.
 *   • `autoCancelWindows` — frame ranges where landing skips the lag.
 *
 * Other fields (`hitbox`, `damage`, `knockback`, `startupFrames`,
 * `activeFrames`, `recoveryFrames`, `cooldownFrames`, `animation`,
 * `hurtboxModifiers`) come straight from the base contract — see
 * `attacks.ts` and `moveSchema.ts` for their semantics.
 *
 * Type narrowing: every `AerialMove` declares `type: 'aerial'` so a
 * caller iterating a moveset can `if (move.type === 'aerial')` and
 * have TypeScript narrow to the aerial-specific shape. The literal
 * type is enforced at the field level so a record can't claim to be
 * aerial without satisfying the rest of the contract.
 */
export interface AerialMove extends AttackMoveWithAnimation {
  /** Always `'aerial'` — narrows `AttackMove.type` to the aerial bucket. */
  readonly type: 'aerial';
  /**
   * Direction of the aerial. The (later AC) input layer reads this
   * to dispatch the right move based on horizontal stick relative to
   * facing; AI scripts read it to enumerate "what aerials are
   * available this matchup". The hitbox is still authored facing-right
   * regardless of this field; the runtime mirrors it by the
   * fighter's facing on spawn just like every other move.
   */
  readonly aerialDirection: AerialDirection;
  /**
   * Frames of lockout applied if the fighter lands mid-move OUTSIDE
   * any auto-cancel window. While locked the fighter has no input
   * authority — no movement, no jump, no attack press. The (later AC)
   * lockout handler will translate this into a `Character.hitstun`-
   * style lockout window when it lands a touchdown event.
   *
   * Range guidance:
   *   • Light pokes (Cat fair/bair, Owl fair) — 4-8 frames (~67-133 ms).
   *   • Standard nairs (Wolf nair, Cat nair) — 8-12 frames.
   *   • Heavy aerials (Bear nair, Wolf bair finisher) — 14-22 frames.
   * The values picked per character below follow this guidance so the
   * "ninja punishes Bear's whiffed bair" matchup feels right.
   */
  readonly landingLagFrames: number;
  /**
   * Frame ranges over the move's gameplay-frame counter during which
   * landing skips the lag entirely. Empty array (or omitted) means
   * "no auto-cancel — every landing during the move's busy window
   * triggers landing lag". The canonical pattern declares two
   * windows: one before the hitbox spawns (an "early-out") and one
   * after the recovery's last commit-heavy frame (a "clean swing-
   * and-land" window).
   *
   * Determinism: the array is frozen at module load — the schema
   * never mutates an authored record at runtime.
   */
  readonly autoCancelWindows?: ReadonlyArray<AutoCancelWindow>;
}

// ---------------------------------------------------------------------------
// Knockback angle helpers
// ---------------------------------------------------------------------------

/**
 * Standard math-convention launch angle for a move's knockback vector,
 * in radians: 0 rad = horizontal toward the attacker's facing,
 * +π/2 rad = straight up, ±π rad = behind, -π/2 rad = straight down.
 *
 * Note the sign flip on `y`: the knockback `y` field is in
 * Phaser/Matter screen-space (negative = up), but the canonical
 * "launch angle" convention in fighting-game theory and balance-pass
 * tooling treats positive Y as up — we negate so the returned angle
 * matches that intuition. A move with `knockback: { x: 1, y: -1 }`
 * (horizontal-and-up in screen space) returns `+π/4` (45° up-and-
 * forward) instead of `-π/4`.
 *
 * Determinism: pure function — same `(x, y)` always returns the same
 * angle. The `Math.atan2` call is IEEE-754 deterministic on every
 * platform Phaser runs on.
 */
export function getKnockbackLaunchAngleRadians(move: AttackMove): number {
  return Math.atan2(-move.knockback.y, move.knockback.x);
}

/**
 * Convenience wrapper — same angle as
 * `getKnockbackLaunchAngleRadians` but in degrees. Authored move
 * tables annotate the expected angle in degree form (45° up-forward,
 * 30° flat-forward, 80° steep-up) because that's how the balance pass
 * actually thinks about knockback trajectories.
 *
 * Returned in the standard `[-180, +180]` range.
 */
export function getKnockbackLaunchAngleDegrees(move: AttackMove): number {
  return (getKnockbackLaunchAngleRadians(move) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Auto-cancel predicates
// ---------------------------------------------------------------------------

/**
 * Pure predicate: at gameplay-frame `framesElapsed`, would a
 * touchdown skip the landing-lag penalty?
 *
 *   - Returns `true` iff `framesElapsed` falls in any of the move's
 *     `autoCancelWindows`.
 *   - Returns `false` if the move declares no auto-cancel windows
 *     (every landing triggers lag) or if `framesElapsed` falls
 *     outside every window.
 *   - Returns `true` once the move has fully ended (`framesElapsed >=
 *     busyTotal`) — once the move is done, the fighter's already
 *     landed cleanly and there's no lag to apply. This avoids the
 *     "what if landing happens *exactly* on the last recovery frame"
 *     edge case dictating gameplay.
 *
 * Note: this is a *predicate*, not a state machine. Callers (the
 * later-AC lockout handler) consult it on the touchdown frame and
 * branch accordingly; it doesn't track any "you've already
 * auto-cancelled" history.
 */
export function isAutoCancelFrame(
  move: AerialMove,
  framesElapsed: number,
): boolean {
  // Once the move is fully done, landing is always clean — no
  // recovery left to interrupt.
  const phase: AttackPhase = computeAttackPhase(framesElapsed, move);
  if (phase === 'done') return true;
  const windows = move.autoCancelWindows;
  if (!windows || windows.length === 0) return false;
  for (const w of windows) {
    if (framesElapsed >= w.startFrame && framesElapsed < w.endFrame) {
      return true;
    }
  }
  return false;
}

/**
 * Convenience helper that picks the right lockout value for a
 * touchdown event:
 *   - if landing on an auto-cancel frame: returns 0 (clean land).
 *   - otherwise: returns the move's `landingLagFrames`.
 *
 * The (later AC) `Character.onLand` path will read this and pass the
 * result through to its lockout timer.
 */
export function getLandingLagFrames(
  move: AerialMove,
  framesElapsed: number,
): number {
  return isAutoCancelFrame(move, framesElapsed) ? 0 : move.landingLagFrames;
}

// ---------------------------------------------------------------------------
// Auto-cancel phase classification (AC 60204 Sub-AC 4)
// ---------------------------------------------------------------------------

/**
 * Classify a single auto-cancel window against a move's startup /
 * active / recovery boundaries. Used by:
 *
 *   • The schema validator — reject any window that overlaps the
 *     `'active'` phase or straddles a phase boundary so authored
 *     records always live in one designated bucket.
 *   • The (later AC) balance-pass tooling — sort moves by "how much
 *     of their startup is auto-cancellable" or "do they have a
 *     recovery-side cancel window?" without re-deriving the math at
 *     every call site.
 *   • Unit tests — assert the per-character authored windows actually
 *     land in the bucket the design doc claims.
 *
 * Returns `null` if the window straddles a boundary or overlaps the
 * active phase (a malformed window). Pure — no side effects.
 *
 * Half-open semantics match `computeAttackPhase`:
 *   • startup phase = `[0, startupFrames)`
 *   • active  phase = `[startupFrames, startupFrames + activeFrames)`
 *   • recovery     = `[startupFrames + activeFrames, busyTotal)`
 *
 * A window `[w.startFrame, w.endFrame)` is classified as:
 *   • `'startup'`  iff `w.endFrame <= startupFrames`
 *   • `'recovery'` iff `w.startFrame >= startupFrames + activeFrames`
 *   • `null`       otherwise (overlaps active and/or straddles a phase)
 */
export function getAutoCancelWindowPhase(
  window: AutoCancelWindow,
  move: AerialMove,
): AutoCancelPhase | null {
  const startupEnd = move.startupFrames;
  const activeEnd = move.startupFrames + move.activeFrames;
  if (window.endFrame <= startupEnd) return 'startup';
  if (window.startFrame >= activeEnd) return 'recovery';
  return null;
}

/**
 * Group a move's `autoCancelWindows` by the phase they cover. Returns
 * a frozen record with two arrays — one for the "early-out" (startup)
 * windows, one for the "clean swing-and-land" (recovery) windows. The
 * arrays preserve authoring order; if a move declares no windows at
 * all, both arrays are empty.
 *
 * This is the public read-side of the Sub-AC 4 contract: callers that
 * want to ask "does this move have a recovery-side auto-cancel
 * window?" can `getAutoCancelWindowsByPhase(move).recovery.length > 0`
 * instead of replicating the phase math themselves.
 *
 * Throws if any window is malformed (would be classified `null`). The
 * stricter `validateAerialMove` runs the same check so authored data
 * passing validation is guaranteed to round-trip cleanly through this
 * helper.
 */
export function getAutoCancelWindowsByPhase(move: AerialMove): {
  readonly startup: ReadonlyArray<AutoCancelWindow>;
  readonly recovery: ReadonlyArray<AutoCancelWindow>;
} {
  const startup: AutoCancelWindow[] = [];
  const recovery: AutoCancelWindow[] = [];
  const windows = move.autoCancelWindows;
  if (windows && windows.length > 0) {
    for (const w of windows) {
      const phase = getAutoCancelWindowPhase(w, move);
      if (phase === 'startup') {
        startup.push(w);
      } else if (phase === 'recovery') {
        recovery.push(w);
      } else {
        throw new Error(
          `AerialMove '${move.id}': auto-cancel window [${w.startFrame}, ${w.endFrame}) overlaps the active phase [${move.startupFrames}, ${move.startupFrames + move.activeFrames}) — windows must be wholly within startup or wholly within recovery`,
        );
      }
    }
  }
  return Object.freeze({
    startup: Object.freeze(startup),
    recovery: Object.freeze(recovery),
  });
}

// ---------------------------------------------------------------------------
// Schema validators (used by tests and the move-editor tool)
// ---------------------------------------------------------------------------

/**
 * Verify a move record satisfies the aerial schema's invariants:
 *
 *   1. `type === 'aerial'`.
 *   2. `landingLagFrames` is a non-negative integer.
 *   3. Every auto-cancel window is well-formed
 *      (`startFrame < endFrame`, both non-negative integers).
 *   4. No two auto-cancel windows overlap (the predicate is
 *      well-defined either way, but overlapping windows are an
 *      authoring smell — flag them so balance-pass tooling sees a
 *      single canonical range per "auto-cancelable region").
 *   5. Auto-cancel windows fit within the move's busy frames
 *      `[0, busyTotal]` — windows extending past the move's end
 *      are silently degenerate (no landing can happen during them
 *      because the move is done by then), and almost always indicate
 *      a typo or a stale record after a frame-data tweak.
 *
 * Returns the move record unchanged on success; throws on the first
 * invariant violation. Tests call this on every per-character aerial
 * record so a future tuning pass can't accidentally publish a broken
 * window.
 */
export function validateAerialMove(move: AerialMove): AerialMove {
  if (move.type !== 'aerial') {
    throw new Error(
      `AerialMove '${move.id}': type must be 'aerial', got '${move.type}'`,
    );
  }
  if (!Number.isInteger(move.landingLagFrames) || move.landingLagFrames < 0) {
    throw new Error(
      `AerialMove '${move.id}': landingLagFrames must be a non-negative integer, got ${move.landingLagFrames}`,
    );
  }

  const windows = move.autoCancelWindows;
  if (windows && windows.length > 0) {
    const busyTotal = getMoveBusyFrames(move);
    const startupEnd = move.startupFrames;
    const activeEnd = move.startupFrames + move.activeFrames;
    // Validate each individual window (delegates to the per-window
    // helper for the clearest error message).
    for (const w of windows) {
      validateAutoCancelWindow(w);
      if (w.endFrame > busyTotal) {
        throw new Error(
          `AerialMove '${move.id}': auto-cancel window [${w.startFrame}, ${w.endFrame}) extends past busyTotal=${busyTotal}`,
        );
      }
      // AC 60204 Sub-AC 4 — every window must be a *designated*
      // startup or recovery range. A window that overlaps the
      // `active` phase or straddles a phase boundary is rejected:
      // auto-cancelling out of a still-live hitbox would let a
      // fighter both keep the hit AND skip the recovery they
      // committed to, which is a balance footgun.
      const isStartupWindow = w.endFrame <= startupEnd;
      const isRecoveryWindow = w.startFrame >= activeEnd;
      if (!isStartupWindow && !isRecoveryWindow) {
        throw new Error(
          `AerialMove '${move.id}': auto-cancel window [${w.startFrame}, ${w.endFrame}) overlaps the active phase [${startupEnd}, ${activeEnd}) — windows must be wholly within startup [0, ${startupEnd}) or wholly within recovery [${activeEnd}, ${busyTotal})`,
        );
      }
    }
    // Check pairwise non-overlap. Sort copy by startFrame so the
    // adjacent-pair scan finds any overlap in O(n log n).
    const sorted = [...windows].sort((a, b) => a.startFrame - b.startFrame);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      if (curr.startFrame < prev.endFrame) {
        throw new Error(
          `AerialMove '${move.id}': auto-cancel windows [${prev.startFrame}, ${prev.endFrame}) and [${curr.startFrame}, ${curr.endFrame}) overlap`,
        );
      }
    }
  }
  return move;
}

// ---------------------------------------------------------------------------
// Re-exports — single import path for consumers
// ---------------------------------------------------------------------------

export type { AttackMoveWithAnimation };
