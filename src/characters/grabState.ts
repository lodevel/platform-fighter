/**
 * Grab/throw state machine — post-M2 grab/throw subsystem.
 *
 * Pure-function state machine that drives the grabber's side of the
 * grab → hold → throw pipeline. Mirrors the file-shape of
 * `shieldState.ts` and `dodgeState.ts` so the runtime can wire it in
 * with the same per-fixed-step pattern:
 *
 *     this.grabState = tickGrab(this.grabState, input, spec);
 *
 * # State machine
 *
 *     idle
 *      │
 *      │  applyGrabPress(state, spec)        — input.grabPressed && grounded
 *      ▼
 *     whiffStartup (framesElapsed < startupFrames)
 *      │
 *      │  framesElapsed === startupFrames
 *      ▼
 *     whiffActive  (framesElapsed < startup + active)
 *      │ ┌───────── applyGrabConnect(state, spec)  — runtime callback on hitbox catch
 *      │ │
 *      │ ▼
 *      │ holding   (framesElapsed → 0; pummelCooldownRemaining drains)
 *      │   │
 *      │   ├── applyThrowRelease(state, dir, spec)  — input pressed a stick direction
 *      │   │     │
 *      │   │     ▼
 *      │   │   throwing  (framesElapsed → ThrowSpec.animationFrames)
 *      │   │     │
 *      │   │     ▼
 *      │   │   cooldown (throwRecoveryFrames)
 *      │   │     │
 *      │   │     ▼
 *      │   │   idle
 *      │   │
 *      │   └── framesElapsed === holdFramesMax     — auto mash-out release
 *      │           │
 *      │           ▼
 *      │       cooldown
 *      │           │
 *      │           ▼
 *      │       idle
 *      │
 *      ▼  (no connect during active window)
 *     whiffRecovery (framesElapsed → whiffRecoveryFrames)
 *      │
 *      ▼
 *     idle
 *
 * # Determinism
 *
 * Every transition is a pure function of `(state, input, spec)`. No
 * `Math.random()`, no `Date.now()`, no Phaser side effects. Identical
 * inputs produce identical state trajectories — verified by
 * `grabState.test.ts`.
 *
 * # Out of scope
 *
 *   • The TARGET-side `'grabbed'` state (pinning the victim, blocking
 *     their input). Lives on the target's `Character` and is wired
 *     by the runtime collision handler that calls `applyGrabConnect`.
 *   • Mash-out by the target. The flat `holdFramesMax` cap is the
 *     M0 contract; a follow-up sub-task can layer percent-scaled
 *     mash-out on top.
 *   • Pummel attack hitbox spawning (the runtime fires it via the
 *     existing combat pipeline — this state machine just gates
 *     when a pummel is permitted via `pummelCooldownRemaining`).
 */

import type { GrabSpec } from './grabSchema';
import type { ThrowDirection } from './throwSchema';

/** Discrete grab-machine status names. */
export type GrabStateName =
  | 'idle'
  | 'whiffStartup'
  | 'whiffActive'
  | 'whiffRecovery'
  | 'holding'
  | 'throwing'
  | 'cooldown';

/** Transient sub-record stored when the grabber is acting. */
export interface ActiveGrab {
  /** Frames elapsed in the current named state. */
  readonly framesElapsed: number;
  /**
   * For `'holding'`: frames until the next pummel may fire. Zero
   * outside `'holding'` (and immediately after a connect, so the
   * first pummel can fire frame-1).
   */
  readonly pummelCooldownRemaining: number;
  /** For `'throwing'`: which direction was selected. Null otherwise. */
  readonly throwDirection: ThrowDirection | null;
}

/**
 * Full grab state record.
 *
 *   • `name`              — current state-machine label.
 *   • `active`            — null in `'idle'` and `'cooldown'`; populated
 *                           in every other state with frame counters.
 *   • `cooldownRemaining` — frames left in the post-action cooldown.
 *                           Drains in `'cooldown'` and `'whiffRecovery'`.
 */
export interface GrabState {
  readonly name: GrabStateName;
  readonly active: ActiveGrab | null;
  readonly cooldownRemaining: number;
}

/**
 * Per-frame input snapshot the state machine consumes.
 *
 *   • `grabPressed` — rising-edge of the grab button this frame.
 *   • `grounded`    — true iff the grabber is on a platform.
 *                     Grabs are ground-only (M0 — Smash air-grab is
 *                     out of scope).
 *   • `pummelPressed` — rising-edge of the attack button while
 *                       holding. Only consumed in `'holding'`.
 *   • `throwDirection` — non-null iff a stick direction was pressed
 *                        this frame while holding. Triggers a throw
 *                        release.
 */
export interface GrabInput {
  readonly grabPressed: boolean;
  readonly grounded: boolean;
  readonly pummelPressed: boolean;
  readonly throwDirection: ThrowDirection | null;
}

// ---------------------------------------------------------------------------
// Constructors / queries
// ---------------------------------------------------------------------------

/** Initial state: idle, no active record, no cooldown. */
export function createGrabState(): GrabState {
  return Object.freeze({
    name: 'idle',
    active: null,
    cooldownRemaining: 0,
  });
}

/** True iff the grabber is currently holding a target. */
export function isHoldingGrab(state: GrabState): boolean {
  return state.name === 'holding';
}

/** True iff a throw animation is in flight (not yet released). */
export function isThrowing(state: GrabState): boolean {
  return state.name === 'throwing';
}

/**
 * True iff the grabber is in any *committal* state — grab whiff,
 * holding, throwing, or post-throw cooldown. The runtime layer
 * suppresses other actions (movement, attacks, jump) while this is
 * true.
 */
export function isGrabActing(state: GrabState): boolean {
  return state.name !== 'idle';
}

/**
 * True iff a pummel can fire THIS frame. Requires `name === 'holding'`
 * AND `pummelCooldownRemaining === 0`. The runtime checks this before
 * applying pummel damage to the target.
 */
export function canPummel(state: GrabState): boolean {
  return state.name === 'holding' && (state.active?.pummelCooldownRemaining ?? 1) === 0;
}

// ---------------------------------------------------------------------------
// Pure step function
// ---------------------------------------------------------------------------

/**
 * Advance the grab state machine by one fixed step.
 *
 * The runtime calls this once per fixed step; on a connect
 * (collision) it calls {@link applyGrabConnect} BEFORE the next
 * tick to transition `'whiffActive'` → `'holding'`. On a throw
 * direction press while holding, the per-frame tick consumes
 * `input.throwDirection` and transitions into `'throwing'`.
 *
 * Order of operations (deterministic):
 *
 *   1. **Cooldown drain**: if `'cooldown'`, drain
 *      `cooldownRemaining` and transition to `'idle'` when zero.
 *
 *   2. **Whiff phases**: advance `framesElapsed` for whiffStartup /
 *      whiffActive / whiffRecovery; transition through them as
 *      frame thresholds hit.
 *
 *   3. **Holding**: advance `framesElapsed`. Drain
 *      `pummelCooldownRemaining`. If `input.throwDirection !== null`,
 *      transition to `'throwing'`. If `framesElapsed >=
 *      holdFramesMax`, transition to `'cooldown'` (auto release —
 *      no damage, no throw).
 *
 *   4. **Throwing**: advance `framesElapsed`. When it reaches
 *      `getThrowAnimationFrames(spec, throwDirection)`, transition
 *      to `'cooldown'` with `cooldownRemaining = throwRecoveryFrames`.
 *      The runtime separately calls `combat.ts:computeKnockback` on
 *      the target with the spec's throw values and inspects this
 *      transition to know "release just fired."
 *
 *   5. **Idle**: if `input.grabPressed && input.grounded`,
 *      transition to `'whiffStartup'`. Otherwise stay idle.
 *
 * Pure: identical `(state, input, spec)` triples produce identical
 * outputs.
 */
export function tickGrab(
  state: GrabState,
  input: GrabInput,
  spec: GrabSpec,
): GrabState {
  // 1. Cooldown drain ----------------------------------------------------
  if (state.name === 'cooldown') {
    const next = state.cooldownRemaining - 1;
    if (next <= 0) {
      return createGrabState();
    }
    return Object.freeze({
      name: 'cooldown',
      active: null,
      cooldownRemaining: next,
    });
  }

  // 2. Whiff phases ------------------------------------------------------
  if (state.name === 'whiffStartup') {
    const elapsed = (state.active?.framesElapsed ?? 0) + 1;
    // Transition into active window once startup completes.
    if (elapsed >= spec.startupFrames) {
      return Object.freeze({
        name: 'whiffActive',
        active: Object.freeze({
          framesElapsed: 0,
          pummelCooldownRemaining: 0,
          throwDirection: null,
        }),
        cooldownRemaining: 0,
      });
    }
    return Object.freeze({
      name: 'whiffStartup',
      active: Object.freeze({
        framesElapsed: elapsed,
        pummelCooldownRemaining: 0,
        throwDirection: null,
      }),
      cooldownRemaining: 0,
    });
  }

  if (state.name === 'whiffActive') {
    const elapsed = (state.active?.framesElapsed ?? 0) + 1;
    // Transition to whiffRecovery once active window closes without a connect.
    if (elapsed >= spec.activeFrames) {
      return Object.freeze({
        name: 'whiffRecovery',
        active: Object.freeze({
          framesElapsed: 0,
          pummelCooldownRemaining: 0,
          throwDirection: null,
        }),
        cooldownRemaining: 0,
      });
    }
    return Object.freeze({
      name: 'whiffActive',
      active: Object.freeze({
        framesElapsed: elapsed,
        pummelCooldownRemaining: 0,
        throwDirection: null,
      }),
      cooldownRemaining: 0,
    });
  }

  if (state.name === 'whiffRecovery') {
    const elapsed = (state.active?.framesElapsed ?? 0) + 1;
    if (elapsed >= spec.whiffRecoveryFrames) {
      return createGrabState();
    }
    return Object.freeze({
      name: 'whiffRecovery',
      active: Object.freeze({
        framesElapsed: elapsed,
        pummelCooldownRemaining: 0,
        throwDirection: null,
      }),
      cooldownRemaining: 0,
    });
  }

  // 3. Holding -----------------------------------------------------------
  if (state.name === 'holding') {
    // Throw direction press wins immediately — transition to 'throwing'.
    if (input.throwDirection !== null) {
      return Object.freeze({
        name: 'throwing',
        active: Object.freeze({
          framesElapsed: 0,
          pummelCooldownRemaining: 0,
          throwDirection: input.throwDirection,
        }),
        cooldownRemaining: 0,
      });
    }
    const elapsed = (state.active?.framesElapsed ?? 0) + 1;
    let pummelCooldown = Math.max(
      0,
      (state.active?.pummelCooldownRemaining ?? 0) - 1,
    );
    // Pummel press resets the cooldown if we were ready and a press came in.
    if (input.pummelPressed && pummelCooldown === 0 && spec.pummel) {
      pummelCooldown = spec.pummel.cooldownFrames;
    }
    if (elapsed >= spec.holdFramesMax) {
      // Auto mash-out release — drop into cooldown, no throw fired.
      return Object.freeze({
        name: 'cooldown',
        active: null,
        cooldownRemaining: spec.throwRecoveryFrames,
      });
    }
    return Object.freeze({
      name: 'holding',
      active: Object.freeze({
        framesElapsed: elapsed,
        pummelCooldownRemaining: pummelCooldown,
        throwDirection: null,
      }),
      cooldownRemaining: 0,
    });
  }

  // 4. Throwing ----------------------------------------------------------
  if (state.name === 'throwing') {
    const dir = state.active?.throwDirection;
    const elapsed = (state.active?.framesElapsed ?? 0) + 1;
    const animFrames = dir ? spec.throws[dir].animationFrames : 1;
    if (elapsed >= animFrames) {
      // Release fires this frame — runtime applies damage / knockback
      // separately. State machine transitions into cooldown.
      return Object.freeze({
        name: 'cooldown',
        active: null,
        cooldownRemaining: spec.throwRecoveryFrames,
      });
    }
    return Object.freeze({
      name: 'throwing',
      active: Object.freeze({
        framesElapsed: elapsed,
        pummelCooldownRemaining: 0,
        throwDirection: dir ?? null,
      }),
      cooldownRemaining: 0,
    });
  }

  // 5. Idle --------------------------------------------------------------
  if (input.grabPressed && input.grounded) {
    return Object.freeze({
      name: 'whiffStartup',
      active: Object.freeze({
        framesElapsed: 0,
        pummelCooldownRemaining: 0,
        throwDirection: null,
      }),
      cooldownRemaining: 0,
    });
  }
  return state;
}

// ---------------------------------------------------------------------------
// Runtime callbacks (called from outside the per-frame tick)
// ---------------------------------------------------------------------------

/**
 * Transition `'whiffActive'` → `'holding'` on a successful grab
 * connect. The runtime calls this from the collision handler when
 * the grab's range hitbox contacts a target.
 *
 * No-op (returns state unchanged) if the grabber isn't currently in
 * `'whiffActive'` — defensive against duplicate collision events.
 */
export function applyGrabConnect(state: GrabState): GrabState {
  if (state.name !== 'whiffActive') return state;
  return Object.freeze({
    name: 'holding',
    active: Object.freeze({
      framesElapsed: 0,
      pummelCooldownRemaining: 0,
      throwDirection: null,
    }),
    cooldownRemaining: 0,
  });
}

/**
 * Force-release the grab. Runtime calls this when:
 *
 *   • The held target mash-breaks free (target-side concern).
 *   • The grabber takes a hit / enters hitstun.
 *   • The grabber's stocks are exhausted (KO mid-grab).
 *
 * Transitions into `'cooldown'` with the spec's throw recovery so the
 * grabber pays a small cost. Returns state unchanged if not currently
 * `'holding'`.
 */
export function applyGrabBreak(
  state: GrabState,
  spec: GrabSpec,
): GrabState {
  if (state.name !== 'holding') return state;
  return Object.freeze({
    name: 'cooldown',
    active: null,
    cooldownRemaining: spec.throwRecoveryFrames,
  });
}

/**
 * Hard reset — used by respawn / round-end. Returns a fresh idle
 * state regardless of what was active.
 */
export function resetGrabState(): GrabState {
  return createGrabState();
}
