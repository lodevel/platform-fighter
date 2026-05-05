/**
 * Shield state machine — AC 60301 Sub-AC 1.
 *
 * Implements the Smash-style defensive shield mechanic as a pure,
 * deterministic data-and-functions module so the runtime (`Character`),
 * the AI (`shouldShield?` heuristics), the HUD (shield-bar renderer),
 * and the replay snapshot system can all read / step / reproduce the
 * same state without coupling to Phaser or Matter.
 *
 * The mechanic at a glance
 * ------------------------
 *
 *   • While the **shield button** is held (and the fighter is not
 *     `'broken'`-stunned), the fighter enters the `'active'` state:
 *       - All horizontal motion is suppressed (the controller zeroes
 *         `vx` while shielded — see `Character.applyInput`).
 *       - Attacks are locked out (`Character` refuses new attack presses
 *         while shield is up).
 *       - Incoming hits drain shield health by the move's damage
 *         instead of pushing the fighter's damage % and triggering
 *         knockback / hitstun (see `applyShieldHit`).
 *   • Shield health **decays** at a small per-frame rate while raised so
 *     the player can't stay turtled forever — a common Smash-style
 *     anti-camp tax.
 *   • Once the button is released the shield enters the `'idle'` state.
 *     After a short `regenDelayFrames` grace (so a tap-and-release isn't
 *     instantly refilled), shield health regenerates back toward
 *     `maxHealth` at `regenPerFrame`.
 *   • If shield health hits zero (a heavy hit drains the last few HP, or
 *     decay caps it out while raised), the shield **breaks**. The
 *     fighter enters the `'broken'` stun state for `breakStunFrames`
 *     frames during which:
 *       - Input is suppressed (no movement, no attacks, no shield raise).
 *       - The fighter is helpless (the runtime layer interprets this
 *         the same way it does hitstun).
 *       - Stun decrements once per fixed step; on stun-end the shield
 *         resets to a small `postBreakHealth` value (mirrors Smash's
 *         "you start with a sliver after the stun ends").
 *
 * Why a separate file
 * -------------------
 *
 *   • Pure-function, no `Math.random`, no wall-clock — the replay layer
 *     can re-run a recorded match through these helpers and confirm
 *     identical shield-bar trajectories. Determinism is the M4 hard
 *     contract; this module sits inside it.
 *   • Easy unit tests with no scene fixtures, no Matter, no Phaser. The
 *     state is a tiny readonly record.
 *   • Mirrors the structure of `hurtState.ts` (AC 8) and `aerialSchema.ts`
 *     (AC 60101) — the engine's pattern is "state machines live in pure
 *     modules; the Character class wires them into the per-frame tick".
 *
 * Boundaries
 * ----------
 *
 * Out of scope for this sub-AC (lands later in the M-future passes):
 *   • Shield-poking / shield-stun frames on the attacker (we apply
 *     damage to the shield but don't bounce the attacker on a perfect-
 *     parry — that's a separate mechanic).
 *   • Shield tilt / directional shield (Smash's offset-by-stick variant).
 *   • Shield grab (grab as a buffered "shield + grab press" action — the
 *     grab system is its own sub-AC; shield state only knows whether
 *     the shield is raised, not what the player can do out of it).
 *
 * Determinism note: every state mutation is a pure function of
 * `(state, input, defaults)`. Identical inputs produce identical state
 * trajectories — verified by the unit tests in `shieldState.test.ts`.
 */

import { computeShieldstun, SHIELDSTUN_MAX_FRAMES } from './combat';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete shield-machine status.
 *
 *   • `'idle'`   — shield is down. Health is regenerating (after a brief
 *                  delay) up to `maxHealth`. The fighter is free to
 *                  move / attack / jump.
 *   • `'active'` — shield is held up. Health is decaying. Incoming hits
 *                  drain health by the hit's damage. Movement / attacks
 *                  are suppressed at the runtime layer.
 *   • `'broken'` — shield health hit zero. The fighter is stunned for
 *                  `breakStunFrames` and cannot raise the shield again
 *                  until the stun timer drains. Stun ticks down once per
 *                  `tickShield` call.
 */
export type ShieldStateName = 'idle' | 'active' | 'broken';

/**
 * Tunable parameters for the shield state machine. All fields are
 * optional with reasonable defaults from {@link SHIELD_DEFAULTS}; the
 * `Character` layer can override per-character (e.g. a heavyweight
 * Bear could carry a tankier shield).
 */
export interface ShieldTuning {
  /** Maximum shield health, in shield-HP units. Default 50. */
  readonly maxHealth?: number;
  /**
   * Health decay per frame while the shield is `'active'` (held up).
   * The Smash-style anti-camp tax — shield naturally drains so a player
   * can't turtle indefinitely. Default 0.15 → ~5.5 s from full to empty
   * at 60 Hz before any incoming hits.
   */
  readonly decayPerFrame?: number;
  /**
   * Health regen per frame while the shield is `'idle'`, applied after
   * `regenDelayFrames` of grace since the last drop / hit. Default
   * 0.25 → ~3.3 s from empty to full at 60 Hz.
   */
  readonly regenPerFrame?: number;
  /**
   * Frames after the most recent damage / decay tick before regen
   * resumes. Mirrors the "wait a beat after a heavy poke before your
   * shield comes back" feel. Default 30 (~0.5 s @ 60 Hz).
   */
  readonly regenDelayFrames?: number;
  /**
   * Stun frames applied on shield-break. The fighter is locked out of
   * input for this many frames. Default 180 (~3 s @ 60 Hz) — long
   * enough that the attacker can confirm a punish, short enough that
   * the round doesn't grind to a halt.
   */
  readonly breakStunFrames?: number;
  /**
   * Shield health restored after the break-stun ends. Mirrors Smash's
   * "you come out of the shatter with a sliver of shield." Default 10.
   */
  readonly postBreakHealth?: number;
  /**
   * Minimum shield health required to raise the shield from `'idle'`.
   * Below this the press is ignored — the player has to wait for regen.
   * Default 1 (any positive HP works) — set higher to make the tail end
   * of the shield bar useless.
   */
  readonly minHealthToRaise?: number;
}

/**
 * Fully-defaulted shield tuning. Shape mirrors `Required<ShieldTuning>`
 * so call sites that read tuning don't have to optional-chain.
 */
export type ResolvedShieldTuning = Required<ShieldTuning>;

/**
 * Read-only shield state record. Carried per-fighter; advanced by
 * {@link tickShield} once per fixed step.
 *
 * `framesSinceLastDamage` is the regen-delay clock — it counts up while
 * idle and resets to 0 every time something reduces `health` (decay tick
 * while active, hit absorbed, stun resolution restoring `postBreakHealth`).
 * Once the count clears `regenDelayFrames` the regen tick starts adding
 * to `health`.
 */
export interface ShieldState {
  readonly name: ShieldStateName;
  readonly health: number;
  /**
   * Frames remaining in the `'broken'` stun lockout. Always 0 outside
   * of the broken state. Drains by 1 per `tickShield` call until it
   * reaches 0; the next tick transitions back to `'idle'` with health
   * set to `postBreakHealth`.
   */
  readonly stunRemaining: number;
  /**
   * Smash-style **shieldstun** — frames remaining in the post-block
   * lockout while the shield is still active. After a successful block,
   * the defender is locked into the shield (can't drop, can't roll out,
   * can't grab) for this many fixed steps. Computed by
   * `combat.ts:computeShieldstun(damage)`. Always 0 outside the active
   * state, and also 0 while no recent hit has landed on the shield.
   *
   * Distinct from `stunRemaining` (break stun): break stun fires when
   * the shield's HP drops to 0 and the character is helpless;
   * shieldstun keeps the shield UP but blocks early drops.
   */
  readonly blockStunRemaining: number;
  /**
   * Frames since `health` was last reduced (by decay or a hit) — used
   * to gate regen. While `'idle'` and this is `>= regenDelayFrames`,
   * regen ticks in. Resets to 0 on every health drop.
   */
  readonly framesSinceLastDamage: number;
}

/**
 * Per-frame input that drives the shield state machine. Just the held
 * state of the shield button — rising-edge / release detection is
 * pure-derivable from successive ticks.
 */
export interface ShieldInput {
  /** True iff the shield button is held this fixed step. */
  readonly held: boolean;
}

/**
 * Result of feeding a hit to a raised shield. `absorbed: true` means
 * the shield ate the hit and the runtime should NOT apply knockback /
 * hitstun / damage % to the fighter; the new state may be `'broken'`
 * if the hit drained the last HP.
 *
 * `absorbed: false` means the shield was not raised (idle or broken);
 * the runtime should fall through to the normal `applyHit` path.
 */
export interface ShieldHitResult {
  readonly absorbed: boolean;
  readonly state: ShieldState;
  /** True iff the hit broke the shield this call. */
  readonly broke: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Canonical shield tuning. Numbers chosen to feel Smash-ish:
 *   • A clean shield (50 HP) absorbs roughly 4-5 typical jabs (10-12 dmg
 *     each) before breaking.
 *   • Decay drains a full shield in ~5.5 s of holding — longer than any
 *     reasonable defensive moment, shorter than "stand here and wait
 *     out the timer".
 *   • Regen refills empty → full in ~3.3 s.
 *   • Break stun is 3 s — long enough for a finisher, short enough that
 *     the match keeps moving.
 */
export const SHIELD_DEFAULTS: ResolvedShieldTuning = Object.freeze({
  maxHealth: 50,
  decayPerFrame: 0.15,
  regenPerFrame: 0.25,
  regenDelayFrames: 30,
  breakStunFrames: 180,
  postBreakHealth: 10,
  minHealthToRaise: 1,
});

// ---------------------------------------------------------------------------
// Constructors / queries
// ---------------------------------------------------------------------------

/**
 * Initial state for a freshly-spawned fighter. Full HP, idle, no stun,
 * regen-delay clock past the threshold so a player who immediately
 * shields hasn't lost any HP yet.
 */
export function createShieldState(
  tuning: ResolvedShieldTuning = SHIELD_DEFAULTS,
): ShieldState {
  return Object.freeze({
    name: 'idle',
    health: tuning.maxHealth,
    stunRemaining: 0,
    blockStunRemaining: 0,
    framesSinceLastDamage: tuning.regenDelayFrames,
  });
}

/** Resolve a partial tuning into a fully-defaulted record. */
export function resolveShieldTuning(
  overrides?: ShieldTuning,
): ResolvedShieldTuning {
  if (!overrides) return SHIELD_DEFAULTS;
  return {
    maxHealth: overrides.maxHealth ?? SHIELD_DEFAULTS.maxHealth,
    decayPerFrame: overrides.decayPerFrame ?? SHIELD_DEFAULTS.decayPerFrame,
    regenPerFrame: overrides.regenPerFrame ?? SHIELD_DEFAULTS.regenPerFrame,
    regenDelayFrames:
      overrides.regenDelayFrames ?? SHIELD_DEFAULTS.regenDelayFrames,
    breakStunFrames:
      overrides.breakStunFrames ?? SHIELD_DEFAULTS.breakStunFrames,
    postBreakHealth:
      overrides.postBreakHealth ?? SHIELD_DEFAULTS.postBreakHealth,
    minHealthToRaise:
      overrides.minHealthToRaise ?? SHIELD_DEFAULTS.minHealthToRaise,
  };
}

/**
 * True iff the shield is currently in the `'active'` (held-up) state.
 * The runtime layer reads this to decide "should I zero out movement
 * this step?" / "should I block the attack press?".
 */
export function isShieldRaised(state: ShieldState): boolean {
  return state.name === 'active';
}

/**
 * True iff the fighter is in shield-break stun. Like `isInHitstun`,
 * the runtime layer suppresses input during this window.
 */
export function isShieldBroken(state: ShieldState): boolean {
  return state.name === 'broken';
}

/**
 * Shield-break stun frames remaining (0 outside the broken state).
 * Convenience accessor — the same value lives on `state.stunRemaining`
 * but a named getter reads better at HUD / AI call sites.
 */
export function getShieldStunRemaining(state: ShieldState): number {
  return state.name === 'broken' ? state.stunRemaining : 0;
}

/**
 * Shieldstun (post-block hold-stun) frames remaining. Returns 0 unless
 * the shield is `'active'` AND was hit recently — in which case the
 * defender is locked into the shield (cannot drop, cannot roll out,
 * cannot grab) until this counter reaches 0.
 *
 * The runtime layer should query this in the shield-release path: a
 * release press while `getShieldHoldStunRemaining(state) > 0` is
 * silently ignored (the state machine `tickShield` enforces the same
 * rule, but the accessor reads better at call sites).
 */
export function getShieldHoldStunRemaining(state: ShieldState): number {
  return state.name === 'active' ? state.blockStunRemaining : 0;
}

/**
 * True iff the shield is in shieldstun (active state, recently hit).
 * The runtime can branch on this to suppress alternate-action presses
 * (dodge, grab, drop) until the lockout clears.
 */
export function isInShieldstun(state: ShieldState): boolean {
  return state.name === 'active' && state.blockStunRemaining > 0;
}

// ---------------------------------------------------------------------------
// Pure step function
// ---------------------------------------------------------------------------

/**
 * Advance the shield state machine by one fixed step.
 *
 * Order of operations (deterministic):
 *
 *   1. **Broken → idle** transition: if currently `'broken'`, drain the
 *      stun timer. When it hits 0, transition to `'idle'` with health
 *      restored to `postBreakHealth` and the regen-delay clock reset.
 *      No press is consumed during stun — the held state is ignored.
 *
 *   2. **Idle ↔ active** transition driven by `held`:
 *
 *        - `held && state.name === 'idle' && health >= minHealthToRaise`
 *          → transition to `'active'`. Health unchanged on the raise
 *          frame (decay starts NEXT frame).
 *
 *        - `!held && state.name === 'active'`
 *          → transition to `'idle'`. The regen-delay clock starts at
 *          `framesSinceLastDamage` (carried over) so a held-then-released
 *          shield doesn't insta-regen.
 *
 *   3. **Active tick**: if still `'active'`, drain `decayPerFrame` and
 *      reset `framesSinceLastDamage` to 0 (any drop blocks regen). If
 *      health hits 0 → transition to `'broken'` with `stunRemaining`
 *      armed.
 *
 *   4. **Idle regen tick**: if still `'idle'`, increment
 *      `framesSinceLastDamage` and, once the clock clears
 *      `regenDelayFrames`, add `regenPerFrame` to health (clamped at
 *      `maxHealth`).
 *
 * All numbers are continuous floats (not integers) — the replay layer
 * preserves them byte-equivalently as long as the inputs match.
 */
export function tickShield(
  state: ShieldState,
  input: ShieldInput,
  tuning: ResolvedShieldTuning = SHIELD_DEFAULTS,
): ShieldState {
  // 1. Broken-stun drain ---------------------------------------------------
  if (state.name === 'broken') {
    const next = state.stunRemaining - 1;
    if (next <= 0) {
      // Stun ends — return to idle with a sliver of HP. Reset regen
      // clock to 0 so the player has to wait a beat before refilling.
      return Object.freeze({
        name: 'idle',
        health: clampToMax(tuning.postBreakHealth, tuning.maxHealth),
        stunRemaining: 0,
        blockStunRemaining: 0,
        framesSinceLastDamage: 0,
      });
    }
    return Object.freeze({
      name: 'broken',
      health: state.health,
      stunRemaining: next,
      blockStunRemaining: 0,
      framesSinceLastDamage: state.framesSinceLastDamage,
    });
  }

  // 2. Press / release transitions ----------------------------------------
  // Shieldstun override: while `blockStunRemaining > 0` the shield
  // cannot be dropped — a release press is silently ignored. The
  // counter drains at the bottom of this function regardless of held.
  let nextName: ShieldStateName = state.name;
  if (input.held) {
    if (state.name === 'idle' && state.health >= tuning.minHealthToRaise) {
      nextName = 'active';
    }
  } else {
    if (state.name === 'active' && state.blockStunRemaining <= 0) {
      nextName = 'idle';
    }
  }

  // Drain shieldstun by 1 each tick (whether held or not). New value
  // is shared by both 'active' and 'idle' branches below.
  const nextBlockStun = Math.max(0, state.blockStunRemaining - 1);

  // 3. Active decay -------------------------------------------------------
  if (nextName === 'active') {
    const drained = state.health - tuning.decayPerFrame;
    if (drained <= 0) {
      // Decay drained the last HP this frame — break.
      return Object.freeze({
        name: 'broken',
        health: 0,
        stunRemaining: tuning.breakStunFrames,
        blockStunRemaining: 0,
        framesSinceLastDamage: 0,
      });
    }
    return Object.freeze({
      name: 'active',
      health: drained,
      stunRemaining: 0,
      blockStunRemaining: nextBlockStun,
      framesSinceLastDamage: 0,
    });
  }

  // 4. Idle regen ---------------------------------------------------------
  // `nextName === 'idle'` here. Tick the regen-delay clock; once it
  // clears the threshold, add regen to health (capped at maxHealth).
  const sinceDamage = state.framesSinceLastDamage + 1;
  let health = state.health;
  if (sinceDamage >= tuning.regenDelayFrames) {
    health = clampToMax(health + tuning.regenPerFrame, tuning.maxHealth);
  }
  return Object.freeze({
    name: 'idle',
    health,
    stunRemaining: 0,
    blockStunRemaining: 0,
    framesSinceLastDamage: sinceDamage,
  });
}

/**
 * Apply an incoming hit to a (possibly) raised shield.
 *
 *   • If the shield is `'active'`, the hit's damage is subtracted from
 *     `health`. If the resulting health is `<= 0` the shield breaks
 *     (transition to `'broken'` with `stunRemaining = breakStunFrames`).
 *     `absorbed: true` — the runtime layer should not apply knockback
 *     or hitstun for this hit.
 *
 *   • If the shield is `'idle'` or `'broken'`, the hit is NOT absorbed.
 *     Returns the original state unchanged with `absorbed: false`. The
 *     runtime layer falls through to the normal damage / knockback path.
 *
 * `damage` is the same scalar carried by `HitInfo.damage` (percent
 * units). Negative values are treated as 0 — defensive against bad
 * tuning data.
 */
export function applyShieldHit(
  state: ShieldState,
  damage: number,
  tuning: ResolvedShieldTuning = SHIELD_DEFAULTS,
): ShieldHitResult {
  if (state.name !== 'active') {
    return { absorbed: false, state, broke: false };
  }
  const safeDamage = damage > 0 ? damage : 0;
  const drained = state.health - safeDamage;
  if (drained <= 0) {
    return {
      absorbed: true,
      broke: true,
      state: Object.freeze({
        name: 'broken',
        health: 0,
        stunRemaining: tuning.breakStunFrames,
        blockStunRemaining: 0,
        framesSinceLastDamage: 0,
      }),
    };
  }
  // Successful block (shield survived) — arm shieldstun so the
  // defender is locked in the shield for a few frames. Stacks
  // additively if the shield is hit again before the previous
  // shieldstun has drained, capped at SHIELDSTUN_MAX_FRAMES.
  const incomingBlockStun = computeShieldstun(safeDamage);
  const stackedBlockStun = Math.min(
    state.blockStunRemaining + incomingBlockStun,
    SHIELDSTUN_MAX_FRAMES,
  );
  return {
    absorbed: true,
    broke: false,
    state: Object.freeze({
      name: 'active',
      health: drained,
      stunRemaining: 0,
      blockStunRemaining: stackedBlockStun,
      framesSinceLastDamage: 0,
    }),
  };
}

/**
 * Force-reset the shield state to a fresh idle (used by respawn /
 * replay seek). Health is restored to full so a fighter dropped back
 * into the world isn't immediately at break risk.
 */
export function resetShieldState(
  tuning: ResolvedShieldTuning = SHIELD_DEFAULTS,
): ShieldState {
  return createShieldState(tuning);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampToMax(value: number, max: number): number {
  if (value > max) return max;
  if (value < 0) return 0;
  return value;
}
