/**
 * Fighter animation state integration — AC 10003 Sub-AC 3.
 *
 * Top-level animation-state resolver that composes the four animation
 * sources a live fighter can be in at any fixed step:
 *
 *   1. **Hurt / hitstun**     — `{characterId}.hurt`. Highest priority;
 *                                an in-flight attack is cancelled at the
 *                                runtime layer when a hit lands so the
 *                                hurt overlay never collides with an
 *                                active-attack key.
 *   2. **Shield-broken**      — `{characterId}.shield.break.{i}`. Long
 *                                stun lockout; visually distinct from
 *                                hurt.
 *   3. **Ledge-hang**         — `{characterId}.ledge.{hanging|climbing|
 *                                rolling}.{i}`. Fighter is on a ledge
 *                                corner.
 *   4. **Dodge**              — `{characterId}.dodge.{spot|roll|air}.{
 *                                active|recovery}.{i}`. I-frame /
 *                                punish-window pose.
 *   5. **Shield (active)**    — `{characterId}.shield.hold.0`. Held-up
 *                                shield pose.
 *   6. **Attack** (any slot)  — `{characterId}.{movePartId}.{phase}.{i}`.
 *                                Full moveset coverage via
 *                                {@link movesetAnimationDriver.ts}.
 *   7. **Idle**               — `{characterId}.idle`. Fallback.
 *
 * The composition rule is read top-to-bottom: the first source that
 * produces a non-null state wins. So a hit that arrives while the
 * fighter is mid-counter-special suspends the special's animation key
 * and emits the hurt key for the hitstun window.
 *
 * # Why a single composer
 *
 * Without it the renderer would have to query each subsystem
 * (`getActiveAttack()`, `getShieldState()`, `getDodgeState()`,
 * `getLedgeHangState()`, `isInHitstun()`) and apply the precedence
 * order at the call site. That's:
 *
 *   • A footgun (a future state can be added and forgotten).
 *   • Duplicated logic if multiple renderers / debug HUDs / replay
 *     scrubbers want to read the displayed pose.
 *   • Hard to test (requires a mock scene to instantiate a Character).
 *
 * The composer exposes a single
 * `resolveFighterAnimationState(snapshot)` entry point that operates on
 * a plain data snapshot (no Phaser, no Matter), making it trivially
 * testable and trivially reusable.
 *
 * # Determinism
 *
 * Every helper is a pure function over the snapshot. No `Math.random`,
 * no scene state. Identical snapshot → identical resolved state. The
 * replay scrubber re-derives the displayed pose from a logged snapshot
 * with byte-identical results.
 */

import type { CharacterId } from '../types';
import type { ActiveAttack } from './attacks';
import type { ShieldState } from './shieldState';
import type { DodgeState } from './dodgeState';
import type { LedgeHangState } from './ledgeHangState';
import type { AttackMoveWithAnimation } from './moveSchema';
import {
  type AnimationState,
  getIdleAnimationKey,
  resolveAttackAnimation,
} from './animationState';
import {
  type DefensiveAnimationState,
  computeDodgeFramesInPhase,
  dodgeStateToAnimationPhase,
  getHurtAnimationKey,
  getShieldAnimationKey,
  resolveDodgeAnimation,
  resolveLedgeAnimation,
  resolveShieldAnimation,
  selectShieldArtFrame,
} from './defensiveAnimationState';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminator for the layer that owns the live animation. Pure data
 * so consumers (debug HUD, AI logger) can branch on it without parsing
 * the key string.
 */
export type FighterAnimationLayer =
  | 'hurt'
  | 'shieldBreak'
  | 'ledge'
  | 'dodge'
  | 'shield'
  | 'attack'
  | 'idle';

/**
 * Resolved animation state for a single fighter at a single fixed
 * step. Returned by {@link resolveFighterAnimationState}. The `key`
 * field is the canonical animation key the renderer should display
 * this frame; the rest is metadata for debug HUD / AI logger / tests.
 */
export interface FighterAnimationState {
  readonly key: string;
  readonly layer: FighterAnimationLayer;
  readonly characterId: CharacterId;
  readonly facing: 1 | -1;
  /**
   * Discriminator inside the layer:
   *   • `'attack'` → the attack phase (`'startup' | 'active' | 'recovery'`).
   *   • `'shield'` / `'shieldBreak'` → the shield animation phase.
   *   • `'dodge'` → `'{kind}.{phase}'`.
   *   • `'ledge'` → `'hanging' | 'climbing' | 'rolling'`.
   *   • `'hurt'` / `'idle'` → `null`.
   */
  readonly phase: string | null;
  /**
   * 0-based art-frame index inside the phase. Always 0 for `'hurt'`
   * (single frame) and `'idle'` (single frame).
   */
  readonly artFrameIndex: number;
}

/**
 * Plain-data snapshot of a fighter's runtime state — the input to
 * {@link resolveFighterAnimationState}. Designed so the call site can
 * pass either a live `Character`, a {@link Fighter} adapter, or a
 * replay-snapshot record; all three converge on this shape.
 */
export interface FighterAnimationSnapshot {
  readonly characterId: CharacterId;
  readonly facing: 1 | -1;
  readonly destroyed: boolean;
  /** Live attack (`null` when idle). */
  readonly activeAttack: ActiveAttack | null;
  /** Current hitstun frames remaining (0 outside hitstun). */
  readonly hitstunRemaining: number;
  /** Current shield-state record. */
  readonly shield: ShieldState;
  /** Frames since the shield's last phase boundary; 0 if not shielding. */
  readonly shieldFramesInPhase?: number;
  /** Current dodge-state record. */
  readonly dodge: DodgeState;
  /**
   * Resolved active-frame budget for the dodge variant currently in
   * flight. Used to compute "frames since the recovery phase began" —
   * the variant tuning is owned by the dodge state machine, not this
   * resolver, so the caller passes it in. Defaults to 0 (the renderer
   * can paint `recovery.0` on the first recovery frame and the dodge
   * state machine controls when the recovery → cooldown boundary fires).
   *
   * Pass the resolved `DODGE_DEFAULTS[kind].activeFrames` (or the
   * caller's per-character override) so the recovery-phase art-frame
   * index ramps from 0 correctly.
   */
  readonly dodgeActiveFrames?: number;
  /** Current ledge-hang state record. */
  readonly ledgeHang: LedgeHangState;
  /** Frames since the ledge's last phase boundary; 0 outside ledge. */
  readonly ledgeFramesInPhase?: number;
}

// ---------------------------------------------------------------------------
// Composition rule
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical animation state for a fighter at a single
 * fixed step using the precedence order documented at the top of this
 * file.
 *
 * Returns `{key: '{characterId}.idle', layer: 'idle'}` when the
 * fighter is destroyed OR no defensive / attack state is active.
 * Otherwise returns the highest-priority active state's key.
 */
export function resolveFighterAnimationState(
  snapshot: FighterAnimationSnapshot,
): FighterAnimationState {
  const { characterId, facing } = snapshot;

  // Destroyed / fallback idle.
  if (snapshot.destroyed) {
    return idleState(characterId, facing);
  }

  // 1. Hitstun → hurt overlay. Highest priority.
  if (snapshot.hitstunRemaining > 0) {
    return {
      key: getHurtAnimationKey(characterId),
      layer: 'hurt',
      characterId,
      facing,
      phase: null,
      artFrameIndex: 0,
    };
  }

  // 2. Shield broken → break overlay.
  if (snapshot.shield.name === 'broken') {
    const elapsed = Math.max(0, snapshot.shieldFramesInPhase ?? 0);
    const idx = selectShieldArtFrame('break', elapsed);
    return {
      key: getShieldAnimationKey(characterId, 'break', idx),
      layer: 'shieldBreak',
      characterId,
      facing,
      phase: 'break',
      artFrameIndex: idx,
    };
  }

  // 3. Ledge state → ledge overlay.
  const ledgeAnim = resolveLedgeAnimation(
    characterId,
    snapshot.ledgeHang,
    snapshot.ledgeFramesInPhase ?? 0,
  );
  if (ledgeAnim !== null) {
    return defensiveToFighter(ledgeAnim, 'ledge', facing);
  }

  // 4. Dodge state → dodge overlay.
  const dodgePhase = dodgeStateToAnimationPhase(snapshot.dodge.name);
  if (dodgePhase !== null && snapshot.dodge.active !== null) {
    const framesInPhase = computeDodgeFramesInPhase(
      snapshot.dodge.active,
      dodgePhase,
      snapshot.dodgeActiveFrames ?? 0,
    );
    const dodgeAnim = resolveDodgeAnimation(
      characterId,
      snapshot.dodge,
      framesInPhase,
    );
    if (dodgeAnim !== null) {
      return defensiveToFighter(dodgeAnim, 'dodge', facing);
    }
  }

  // 5. Shield active (held up) → hold overlay.
  if (snapshot.shield.name === 'active') {
    const shieldAnim = resolveShieldAnimation(
      characterId,
      snapshot.shield,
      snapshot.shieldFramesInPhase ?? 0,
    );
    if (shieldAnim !== null) {
      return defensiveToFighter(shieldAnim, 'shield', facing);
    }
  }

  // 6. Active attack → attack overlay.
  if (snapshot.activeAttack !== null) {
    const attackState = resolveAttackAnimation(
      characterId,
      snapshot.activeAttack.move as AttackMoveWithAnimation,
      snapshot.activeAttack.framesElapsed,
      snapshot.activeAttack.facing,
    );
    return {
      key: attackState.key,
      layer: 'attack',
      characterId,
      facing: snapshot.activeAttack.facing,
      phase: attackState.phase === 'idle' ? null : attackState.phase,
      artFrameIndex: attackState.artFrameIndex,
    };
  }

  // 7. Idle fallback.
  return idleState(characterId, facing);
}

// ---------------------------------------------------------------------------
// Convenience adapters
// ---------------------------------------------------------------------------

/**
 * Adapt an {@link AnimationState} (from the attack-state resolver) to
 * the unified {@link FighterAnimationState} shape. Public so callers
 * that already have an attack-only AnimationState can promote it
 * uniformly.
 */
export function attackStateToFighter(
  attackState: AnimationState,
  facing: 1 | -1,
): FighterAnimationState {
  return {
    key: attackState.key,
    layer: attackState.movePartId === null ? 'idle' : 'attack',
    characterId: attackState.characterId,
    facing,
    phase: attackState.phase === 'idle' ? null : attackState.phase,
    artFrameIndex: attackState.artFrameIndex,
  };
}

/**
 * Helper — produces the canonical idle state.
 */
export function idleState(
  characterId: CharacterId,
  facing: 1 | -1,
): FighterAnimationState {
  return {
    key: getIdleAnimationKey(characterId),
    layer: 'idle',
    characterId,
    facing,
    phase: null,
    artFrameIndex: 0,
  };
}

/**
 * Internal — promote a {@link DefensiveAnimationState} to the unified
 * {@link FighterAnimationState} shape with the right layer label.
 */
function defensiveToFighter(
  d: DefensiveAnimationState,
  layer: FighterAnimationLayer,
  facing: 1 | -1,
): FighterAnimationState {
  return {
    key: d.key,
    layer,
    characterId: d.characterId,
    facing,
    phase: d.phase,
    artFrameIndex: d.artFrameIndex,
  };
}

// ---------------------------------------------------------------------------
// Animation state machine bindings — public API for renderer adapters
// ---------------------------------------------------------------------------

/**
 * Subscriber callback signature for a {@link FighterAnimationStateMachine}.
 * Fires whenever the resolved animation key changes between fixed steps.
 *
 * The first call after `attach()` always fires with `prev === null` so
 * the renderer can prime its initial texture without a separate "init"
 * branch.
 */
export type FighterAnimationKeyChangeListener = (
  next: FighterAnimationState,
  prev: FighterAnimationState | null,
) => void;

/**
 * Read-only minimal interface a {@link FighterAnimationStateMachine}
 * needs to drive itself off a live fighter. Mirrors the shape produced
 * by the live `Character` (and the M-future `Fighter` entity) so a
 * single adapter can drive both. Pass the snapshot getter at attach
 * time; the state machine polls it on every {@link tick} call.
 */
export interface FighterSnapshotProvider {
  getAnimationSnapshot(): FighterAnimationSnapshot;
}

/**
 * Lightweight animation state machine binding for a single fighter.
 * Wraps the {@link resolveFighterAnimationState} call site with:
 *
 *   • Last-known state caching so the listener fires only on actual
 *     key changes (not every fixed step).
 *   • One-shot priming on `attach()` so the renderer paints the
 *     correct initial texture.
 *   • Dispose-friendly subscriber bookkeeping (`detach()` clears the
 *     listener so the renderer can stop polling without leaking).
 *
 * Usage:
 *
 *   const sm = createFighterAnimationStateMachine(provider, (next) => {
 *     sprite.setTexture(next.key);
 *   });
 *   // every fixed step:
 *   sm.tick();
 *   // on scene shutdown:
 *   sm.detach();
 *
 * Pure data inside — no Phaser, no Matter, no DOM. Easily testable
 * with a hand-rolled provider stub.
 */
export interface FighterAnimationStateMachine {
  /**
   * Re-poll the snapshot provider; if the resolved animation key
   * differs from the last emitted one, fire the listener.
   */
  tick(): FighterAnimationState;
  /**
   * Read the most recently emitted state (post-{@link tick}). Returns
   * `null` only before the first tick.
   */
  current(): FighterAnimationState | null;
  /**
   * Detach the listener. Subsequent {@link tick} calls still resolve
   * and return the state but do not fire the listener.
   */
  detach(): void;
}

/**
 * Build a {@link FighterAnimationStateMachine} for a snapshot provider.
 * The listener fires once on the first {@link tick} (with `prev = null`)
 * and again every time the resolved animation key changes.
 *
 * The state machine never polls the provider on its own — the caller
 * (renderer scene's `update()`) drives `tick()` once per fixed step.
 * This keeps the binding deterministic and replay-friendly.
 */
export function createFighterAnimationStateMachine(
  provider: FighterSnapshotProvider,
  listener: FighterAnimationKeyChangeListener | null = null,
): FighterAnimationStateMachine {
  let last: FighterAnimationState | null = null;
  let activeListener: FighterAnimationKeyChangeListener | null = listener;

  return {
    tick(): FighterAnimationState {
      const snap = provider.getAnimationSnapshot();
      const next = resolveFighterAnimationState(snap);
      if (last === null || last.key !== next.key) {
        const prev = last;
        last = next;
        activeListener?.(next, prev);
      } else {
        // Even if key didn't change, refresh stored state so phase /
        // artFrameIndex (which can change without a key boundary on
        // single-frame phases) stays current.
        last = next;
      }
      return next;
    },
    current(): FighterAnimationState | null {
      return last;
    },
    detach(): void {
      activeListener = null;
    },
  };
}
