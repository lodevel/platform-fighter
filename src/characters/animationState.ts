/**
 * Animation state integration for grounded attacks (jab / tilt / smash)
 * — AC 60003 Sub-AC 3.
 *
 * Sub-AC 3 of AC 60003 calls for: "Implement animation state integration
 * for jab/tilt/smash (sprite/animation keys per character, transitions
 * tied to startup/active/recovery frames, cancel rules) and verify all
 * 4 characters trigger correct animations on ground-attack inputs."
 *
 * This module is the **single source of truth** for the
 * `(characterId × move × phase × artFrameIndex) → animationKey` mapping
 * the rendering layer reads each frame, plus the helpers and cancel-rule
 * checks that the live `Character` runtime, the (M-future) sprite
 * animator, and the unit-test suite all delegate to. It is Phaser-free
 * and Matter-free — pure functions over frozen data — so:
 *
 *   • Tests can lock the contract down with no scene fixtures.
 *   • The (later) sprite atlas pipeline can register textures keyed
 *     exactly the way `animationKey()` produces them and the renderer
 *     just calls `getCurrentAnimation(character)` each frame.
 *   • The replay snapshot system reproduces identical animation keys
 *     given identical (character, move, framesElapsed) triples — pure
 *     determinism, no hidden state.
 *
 * # Animation key contract
 *
 * The canonical key shape is:
 *
 *     `{characterId}.{movePartId}.{phase}.{artFrameIndex}`
 *
 * Where:
 *
 *   • `characterId`   — `'wolf' | 'cat' | 'owl' | 'bear'` (the
 *                       `CharacterId` union; one slot per roster fighter).
 *   • `movePartId`    — the *short* move identifier (the part *after*
 *                       the leading `'{characterId}.'` prefix on
 *                       `AttackMove.id`). E.g. for `WOLF_JAB.id =
 *                       'wolf.jab'` the part id is `'jab'`. This keeps
 *                       the key compact and stable even if a future move
 *                       gets renamed within a character namespace.
 *   • `phase`         — `'startup' | 'active' | 'recovery'` — the live
 *                       phase classification. The terminal `'done'`
 *                       phase is never emitted as a key (the fighter is
 *                       no longer animating an attack at that point;
 *                       the renderer falls back to the idle key, which
 *                       is `{characterId}.idle`).
 *   • `artFrameIndex` — 0-based art-frame index within the phase, derived
 *                       from {@link selectAnimationFrame}. `0` for moves
 *                       that don't declare an `animation` block.
 *
 * Examples (every grounded triplet move on every roster slot expands to
 * exactly the same key shape):
 *
 *   wolf.jab.startup.0    cat.tilt.active.1     owl.smash.recovery.3
 *   bear.jab.recovery.2   wolf.smash.startup.2  cat.smash.active.0
 *
 * # Idle / fallback keys
 *
 * For each character, an idle key (`{characterId}.idle`) exists for the
 * frames where no attack is in flight. The renderer reads
 * {@link getCurrentAnimation} and gets either the live attack key or
 * the idle key — no branching needed at the call site.
 *
 * # Transitions
 *
 * The `AnimationKey` value advances tick-by-tick in lockstep with the
 * gameplay state machine:
 *
 *   1. On the **press frame** (framesElapsed === 0), the key is
 *      `{char}.{move}.startup.0`.
 *   2. Each subsequent fixed step the key is recomputed from
 *      `(framesElapsed, move)` using {@link selectAnimationFrame}; the
 *      art-frame index advances when the gameplay window crosses a
 *      `[i*f/n, (i+1)*f/n)` boundary, and the phase flips when the
 *      attack crosses a startup→active or active→recovery boundary.
 *   3. On the frame the move ends (recovery → done), the key flips back
 *      to `{char}.idle`. The animator (later AC) can also subscribe to
 *      `onPhaseEnter` / `onMoveEnd` via {@link makeAnimationStateHooks}
 *      to drive event-based transitions (sprite atlas swap, particle
 *      spawn) instead of polling each frame.
 *
 * Because the animation key is a pure function of the same
 * `(framesElapsed, move)` pair the gameplay hitbox state machine reads,
 * **the displayed art frame and the live hitbox phase are guaranteed to
 * stay in lockstep** — there is no possibility of an animation-vs-
 * hitbox drift, which is exactly the property the Seed's
 * "matchState.current animation state" ontology field requires.
 *
 * # Cancel rules
 *
 * The animation state respects the same cancel rules the gameplay state
 * machine enforces (and the rules are enumerated in
 * {@link describeAnimationCancelRules} so consumers don't have to read
 * the Character source to find them):
 *
 *   1. **Hit cancel** — when a fighter takes a hit, their in-flight
 *      attack is cancelled (`Character.applyHit` calls `cancelAttack`).
 *      The renderer sees the active attack go to `null` on the next
 *      `getActiveAttack()` poll → animation key flips to the idle /
 *      hurt-state key.
 *
 *   2. **Respawn cancel** — `Character.setPosition` (used by the
 *      respawn flow and replay snapshot resync) cancels any in-flight
 *      attack so the fighter doesn't materialise mid-swing on the new
 *      spawn point.
 *
 *   3. **Destroy cancel** — `Character.destroy` cancels the in-flight
 *      attack and detaches the body. The renderer should stop polling
 *      a destroyed fighter; if it doesn't, this module's
 *      {@link getCurrentAnimation} returns the idle key as a defensive
 *      fallback.
 *
 *   4. **No buffering** — pressing attack while another attack is in
 *      flight is dropped (the gameplay state machine doesn't queue it).
 *      The animation key therefore does not jump to a new move's
 *      startup until the current one finishes; the renderer doesn't
 *      have to handle "two animations on top of each other".
 *
 *   5. **No phase rewind** — the art-frame index within a phase is
 *      monotonically non-decreasing (and the phase progression is
 *      strictly forward: startup → active → recovery → done). Tests
 *      lock this property down to catch any future regression where a
 *      tickAttack reorder might let `framesElapsed` tick backwards.
 *
 * Hit-cancel-into-attack (the canonical Smash idiom where a successful
 * jab can be cancelled into a tilt) is intentionally NOT in this AC's
 * scope — the M2 cut ships the static cancel-rule set above, with
 * cancel-on-hit-confirm reserved for a later balance / depth pass.
 *
 * # Why a separate module (instead of extending `moveSchema.ts`)
 *
 * `moveSchema.ts` is the pure-data + pure-function schema layer — it
 * knows about phases and art-frame indices but NOT about character ids
 * (it is generic across characters by design). This module is the
 * character-aware *integration* layer: it consumes a `CharacterId`,
 * looks up the move's part-id from the registered roster moveset, and
 * produces a canonical key string. Splitting them keeps the schema
 * reusable (the (later) move-editor tool can reuse `moveSchema` without
 * the character-id namespace) and makes the integration trivially
 * testable.
 *
 * # Determinism
 *
 * Every helper here is a pure function of `(characterId, move,
 * framesElapsed)`. No `Math.random()`, no `Date.now()`, no scene side
 * effects. Identical inputs always produce identical outputs — the
 * property the replay system requires for the
 * `replayData.state snapshots` to reproduce frame-perfect art-frame
 * sequences on a VCR scrub.
 */

import type { CharacterId } from '../types';
import type { ActiveAttack } from './attacks';
import type { Character } from './Character';
import {
  type AnimationFrameSelector,
  type AttackMoveWithAnimation,
  type AttackPhase,
  type AttackStateContext,
  type AttackStateHooks,
  type LiveAttackPhase,
  computeAttackPhase,
  selectAnimationFrame,
} from './moveSchema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Resolved animation state for a single fixed step. Returned by
 * {@link getCurrentAnimation} and {@link resolveAttackAnimation}.
 *
 * Carries every piece of information the renderer / animator needs to
 * pick the correct sprite frame:
 *
 *   • `key`           — the canonical animation key string (see module
 *                       header for the format).
 *   • `characterId`   — the fighter's character id (echoed for callers
 *                       that prefer not to plumb it separately).
 *   • `movePartId`    — the short move id (`'jab' | 'tilt' | 'smash' | …`)
 *                       or `null` for the idle state.
 *   • `phase`         — the live phase or `'idle'` when the fighter is
 *                       not mid-attack.
 *   • `artFrameIndex` — 0-based art-frame index within the phase.
 *   • `facing`        — the facing direction the renderer should mirror
 *                       the sprite by. Echoed from the active attack
 *                       (locked at press time) so a mid-swing facing
 *                       flip doesn't yank the animation visually.
 */
export interface AnimationState {
  readonly key: string;
  readonly characterId: CharacterId;
  readonly movePartId: string | null;
  readonly phase: LiveAttackPhase | 'idle';
  readonly artFrameIndex: number;
  readonly facing: 1 | -1;
}

/**
 * Subset of the `Character` surface this module needs to read live
 * animation state. Declared as its own interface so:
 *
 *   • Tests can pass a stub object (no Matter scene required).
 *   • The (later) `Fighter` entity can also satisfy this contract via
 *     a thin adapter without forcing the renderer to know about
 *     `Fighter` vs `Character` directly.
 *
 * The shape is the smallest viable read-only window: id, facing,
 * destruction state, and the active-attack snapshot. Everything else
 * (position, velocity, percent) is irrelevant to picking an animation
 * key.
 */
export interface AnimatableCharacter {
  readonly id: CharacterId;
  getFacing(): 1 | -1;
  isDestroyed?: () => boolean;
  getActiveAttack(): ActiveAttack | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The phases that emit a live animation key. `'done'` is excluded
 * because by the time the gameplay state machine reaches `'done'` the
 * `activeAttack` has been cleared and the renderer falls back to the
 * idle key.
 */
export const LIVE_ATTACK_PHASES: ReadonlyArray<LiveAttackPhase> = Object.freeze([
  'startup',
  'active',
  'recovery',
]);

/**
 * Suffix used for a character's idle / no-attack animation key.
 * Exposed as a constant so tests and the (later) sprite atlas
 * registration can both reference the same literal — protects against
 * a future typo silently breaking the renderer's idle-fallback.
 */
export const IDLE_ANIMATION_SUFFIX = 'idle';

// ---------------------------------------------------------------------------
// Move-id parsing
// ---------------------------------------------------------------------------

/**
 * Extract the *short* move part id from a fully-qualified
 * `AttackMove.id`. The roster convention is
 * `'{characterId}.{movePartId}'` — e.g. `'wolf.jab'`, `'cat.tilt'`,
 * `'owl.smash'`, `'bear.jab'`. This helper returns the trailing
 * `movePartId` half so the animation key generator doesn't end up with
 * a doubled prefix like `'wolf.wolf.jab.startup.0'`.
 *
 * Behaviour:
 *
 *   • `'wolf.jab'`   → `'jab'`
 *   • `'cat.smash'`  → `'smash'`
 *   • `'someid'`     → `'someid'`   (no dot → return whole id)
 *   • `'a.b.c'`      → `'b.c'`      (only the first dot is the prefix
 *                                    separator; preserves anything
 *                                    after for forward-compat with
 *                                    e.g. `'wolf.special.flash'`)
 *
 * Pure / deterministic. Returns the input as-is for ids that don't
 * follow the convention so a hand-authored test move (id `'sample.jab'`)
 * still produces a sensible key.
 */
export function getMovePartId(moveId: string): string {
  const dot = moveId.indexOf('.');
  if (dot < 0) return moveId;
  return moveId.slice(dot + 1);
}

// ---------------------------------------------------------------------------
// Animation key generation
// ---------------------------------------------------------------------------

/**
 * Build the canonical idle / no-attack animation key for a character.
 *
 *   getIdleAnimationKey('wolf') → 'wolf.idle'
 *
 * The renderer falls back to this key any frame the fighter is not
 * mid-attack (or is destroyed / hurt — the hurt-state classifier in
 * `hurtState.ts` overrides this for the hurt window in a future AC).
 */
export function getIdleAnimationKey(characterId: CharacterId): string {
  return `${characterId}.${IDLE_ANIMATION_SUFFIX}`;
}

/**
 * Build the canonical animation key for a single (characterId, moveId,
 * phase, artFrameIndex) tuple.
 *
 *   getAnimationKey('wolf', 'wolf.jab', 'startup', 0) → 'wolf.jab.startup.0'
 *   getAnimationKey('cat',  'cat.tilt', 'active',  1) → 'cat.tilt.active.1'
 *   getAnimationKey('bear', 'bear.smash','recovery',3) → 'bear.smash.recovery.3'
 *
 * Throws on `'done'` — by contract the live key is only emitted for
 * `LIVE_ATTACK_PHASES`. Callers wanting the idle fallback should call
 * {@link getIdleAnimationKey} directly.
 *
 * Throws on negative `artFrameIndex` — defensive guard against a buggy
 * caller passing a placeholder sentinel; the gameplay state machine
 * never produces negatives (Math.max clamps {@link selectAnimationFrame}
 * to 0).
 */
export function getAnimationKey(
  characterId: CharacterId,
  moveId: string,
  phase: LiveAttackPhase,
  artFrameIndex: number,
): string {
  if (phase === ('done' as unknown as LiveAttackPhase)) {
    throw new Error(
      `getAnimationKey: 'done' is not a live phase — call getIdleAnimationKey instead`,
    );
  }
  if (!Number.isInteger(artFrameIndex) || artFrameIndex < 0) {
    throw new Error(
      `getAnimationKey: artFrameIndex must be a non-negative integer — got ${String(artFrameIndex)}`,
    );
  }
  return `${characterId}.${getMovePartId(moveId)}.${phase}.${artFrameIndex}`;
}

/**
 * Enumerate every animation key a single move's full lifecycle can
 * produce, in display order (startup frames → active frames → recovery
 * frames). Useful for:
 *
 *   • Sprite atlas registration — the (later) asset pipeline can iterate
 *     this list to know exactly which textures to load for a move.
 *   • Tests — assert each character's grounded triplet expands to the
 *     expected number of art frames per the Seed's "6-8 frames per move"
 *     constraint without re-implementing the math.
 *   • Debug HUD — render a strip of art-frame previews for the move
 *     currently being executed, indexing directly into this array.
 *
 * If a move declares no `animation` block, the lifecycle is one key
 * per phase (3 keys total: startup.0 / active.0 / recovery.0).
 */
export function enumerateMoveAnimationKeys(
  characterId: CharacterId,
  move: AttackMoveWithAnimation,
): ReadonlyArray<string> {
  const movePartId = getMovePartId(move.id);
  const startupCount = move.animation?.startupFrames ?? 1;
  const activeCount = move.animation?.activeFrames ?? 1;
  const recoveryCount = move.animation?.recoveryFrames ?? 1;
  const out: string[] = [];
  for (let i = 0; i < startupCount; i++) {
    out.push(`${characterId}.${movePartId}.startup.${i}`);
  }
  for (let i = 0; i < activeCount; i++) {
    out.push(`${characterId}.${movePartId}.active.${i}`);
  }
  for (let i = 0; i < recoveryCount; i++) {
    out.push(`${characterId}.${movePartId}.recovery.${i}`);
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Animation state resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the animation state for a specific in-flight attack frame.
 * Pure — does not consult any live `Character`. Useful for the AI
 * predictor ("what art frame will Cat's tilt be on 5 frames from
 * now?"), tests, and replay-snapshot reconstruction.
 *
 * `phase === 'done'` collapses to the idle state (key + null move),
 * matching the renderer's fallback.
 */
export function resolveAttackAnimation(
  characterId: CharacterId,
  move: AttackMoveWithAnimation,
  framesElapsed: number,
  facing: 1 | -1,
): AnimationState {
  const phase: AttackPhase = computeAttackPhase(framesElapsed, move);
  if (phase === 'done') {
    return {
      key: getIdleAnimationKey(characterId),
      characterId,
      movePartId: null,
      phase: 'idle',
      artFrameIndex: 0,
      facing,
    };
  }
  const sel: AnimationFrameSelector = selectAnimationFrame(framesElapsed, move);
  const livePhase = phase as LiveAttackPhase;
  return {
    key: getAnimationKey(characterId, move.id, livePhase, sel.artFrameIndex),
    characterId,
    movePartId: getMovePartId(move.id),
    phase: livePhase,
    artFrameIndex: sel.artFrameIndex,
    facing,
  };
}

/**
 * Read the live animation state for a character. Returns the idle key
 * when no attack is in flight (or the fighter is destroyed) — the
 * renderer can call this every frame and never need to branch.
 *
 * The returned `AnimationState.facing` mirrors the *attack's* locked-in
 * facing while a move is in flight (so a mid-swing left/right input
 * doesn't yank the animation), and the live `getFacing()` value while
 * idle (so the idle pose tracks the player's input).
 */
export function getCurrentAnimation(character: AnimatableCharacter): AnimationState {
  const destroyed = character.isDestroyed?.() === true;
  if (destroyed) {
    return {
      key: getIdleAnimationKey(character.id),
      characterId: character.id,
      movePartId: null,
      phase: 'idle',
      artFrameIndex: 0,
      facing: character.getFacing(),
    };
  }
  const active = character.getActiveAttack();
  if (!active) {
    return {
      key: getIdleAnimationKey(character.id),
      characterId: character.id,
      movePartId: null,
      phase: 'idle',
      artFrameIndex: 0,
      facing: character.getFacing(),
    };
  }
  // Use the attack's locked-in facing for visual stability through the swing.
  return resolveAttackAnimation(
    character.id,
    active.move as AttackMoveWithAnimation,
    active.framesElapsed,
    active.facing,
  );
}

// ---------------------------------------------------------------------------
// Hook factory — character-aware AnimationState bridge over the schema's
// pure AttackStateHooks contract.
// ---------------------------------------------------------------------------

/**
 * Subscriber callbacks the `makeAnimationStateHooks` factory will
 * dispatch to as the gameplay state machine crosses phase boundaries.
 *
 * Every callback receives a fully-resolved {@link AnimationState} so
 * the consumer doesn't have to recompute the key from raw context. The
 * callbacks fire in this order on a transition frame:
 *
 *   1. `onAnimationKeyChange(prevState, nextState)` — fires on every
 *      transition (including across art-frame indices within a phase if
 *      that boundary happens to coincide with a phase boundary).
 *   2. `onPhaseEnter(state)` — fires when a new live phase begins.
 *   3. `onMoveEnd()` — fires once when the move terminates (recovery →
 *      done). The animation has already collapsed to idle by the time
 *      this fires.
 *
 * All callbacks are optional. The factory returns an
 * {@link AttackStateHooks} bag the existing `Character` runtime can
 * compose alongside its own hooks (or that the M-future animator can
 * subscribe to standalone via `composeAttackStateHooks`).
 */
export interface AnimationStateSubscriber {
  readonly onAnimationKeyChange?: (
    prev: AnimationState,
    next: AnimationState,
  ) => void;
  readonly onPhaseEnter?: (state: AnimationState) => void;
  readonly onMoveEnd?: (characterId: CharacterId) => void;
}

/**
 * Build an {@link AttackStateHooks} bag that translates the schema's
 * raw `(phase, move, framesElapsed)` callbacks into character-aware
 * {@link AnimationState} events for an animator subscriber.
 *
 * Callers wire it like this:
 *
 *   const hooks = makeAnimationStateHooks('wolf', {
 *     onAnimationKeyChange: (prev, next) =>
 *       sprite.setTexture(next.key),
 *     onMoveEnd: (id) => sprite.setTexture(getIdleAnimationKey(id)),
 *   });
 *   // pass `hooks` to advanceAttackState(...) every fixed step.
 *
 * This indirection keeps the `Character` runtime ignorant of how the
 * key is shaped (the schema callbacks would have to spell that out
 * every time otherwise) and lets the animator stay ignorant of the raw
 * frame counters.
 */
export function makeAnimationStateHooks(
  characterId: CharacterId,
  subscriber: AnimationStateSubscriber,
): AttackStateHooks {
  return {
    onPhaseEnter(_phase: LiveAttackPhase, ctx: AttackStateContext) {
      const state = resolveAttackAnimation(
        characterId,
        ctx.move as AttackMoveWithAnimation,
        ctx.framesElapsed,
        ctx.facing,
      );
      subscriber.onPhaseEnter?.(state);
      // Synthesize a "previous" snapshot at the boundary frame just
      // before this phase started so onAnimationKeyChange consumers
      // can read both ends of the transition without polling.
      if (subscriber.onAnimationKeyChange) {
        const prevFrame = Math.max(0, ctx.framesElapsed - 1);
        const prev = resolveAttackAnimation(
          characterId,
          ctx.move as AttackMoveWithAnimation,
          prevFrame,
          ctx.facing,
        );
        subscriber.onAnimationKeyChange(prev, state);
      }
    },
    onMoveEnd(_move, _ctx) {
      subscriber.onMoveEnd?.(characterId);
    },
  };
}

// ---------------------------------------------------------------------------
// Cancel-rule documentation (machine-readable so tests can lock it down)
// ---------------------------------------------------------------------------

/**
 * The set of cancel-rule names this AC's animation system honours.
 * Stable string identifiers so tests and the (later) debug HUD can
 * reference each rule by id without grepping the JSDoc.
 */
export type AnimationCancelRule =
  | 'hit-cancel'
  | 'respawn-cancel'
  | 'destroy-cancel'
  | 'no-buffering'
  | 'no-phase-rewind';

/**
 * Human-readable description of every cancel rule the animation state
 * honours. Lifted into a typed const so:
 *
 *   • Tests can iterate the array and assert each rule is covered.
 *   • The (later) debug HUD / docs site can render it as a checklist
 *     without duplicating the wording in JSDoc.
 *   • A future cancel-on-hit-confirm AC can extend the union and add
 *     to this table without touching the runtime.
 *
 * Each entry is `{ rule, summary, enforcedBy }` — the `enforcedBy`
 * field names the file:method that implements the rule, so a future
 * developer can jump straight to the enforcement point.
 */
export const ANIMATION_CANCEL_RULES: ReadonlyArray<{
  readonly rule: AnimationCancelRule;
  readonly summary: string;
  readonly enforcedBy: string;
}> = Object.freeze([
  Object.freeze({
    rule: 'hit-cancel',
    summary:
      "An incoming hit cancels the in-flight attack — the animation key flips to idle on the next poll.",
    enforcedBy: 'Character.applyHit → cancelAttack',
  }),
  Object.freeze({
    rule: 'respawn-cancel',
    summary:
      "Respawn / replay-seek teleport cancels any in-flight attack so the fighter doesn't materialise mid-swing.",
    enforcedBy: 'Character.setPosition → cancelAttack',
  }),
  Object.freeze({
    rule: 'destroy-cancel',
    summary:
      'Fighter destruction cancels the in-flight attack and detaches the body; getCurrentAnimation falls back to idle defensively.',
    enforcedBy: 'Character.destroy + getCurrentAnimation isDestroyed guard',
  }),
  Object.freeze({
    rule: 'no-buffering',
    summary:
      'A second attack press while a move is in flight is dropped — the animation key does not jump to a new move until the current one finishes.',
    enforcedBy: 'Character.tickAttack rising-edge dispatch gated by activeAttack === null',
  }),
  Object.freeze({
    rule: 'no-phase-rewind',
    summary:
      'Within a single attack the phase progression is strictly forward (startup → active → recovery → done) and the art-frame index is monotonically non-decreasing.',
    enforcedBy: 'computeAttackPhase + selectAnimationFrame purity (framesElapsed only ticks up)',
  }),
]);

/**
 * Programmatic check used by the test suite (and by the future debug
 * HUD) to assert all expected cancel rules are present in the table.
 */
export function describeAnimationCancelRules(): ReadonlyArray<AnimationCancelRule> {
  return Object.freeze(ANIMATION_CANCEL_RULES.map((entry) => entry.rule));
}

/**
 * Cancel-aware probe used by tests and the (later) damage handler to
 * read the post-cancel animation state of a character. Returns the
 * idle key for a character whose `getActiveAttack()` already returned
 * `null`, regardless of why the cancel happened. Matches what
 * {@link getCurrentAnimation} returns; provided as a named entry point
 * so test prose can read `expectIdleAfterCancel(...)` without dragging
 * the reader through the polymorphic call.
 */
export function getPostCancelAnimation(character: AnimatableCharacter): AnimationState {
  return getCurrentAnimation(character);
}

// ---------------------------------------------------------------------------
// Convenience adapter for the live `Character` class
// ---------------------------------------------------------------------------

/**
 * Adapt a live {@link Character} to the {@link AnimatableCharacter}
 * read-only surface this module consumes. Pure interop — no
 * allocations beyond the wrapper, no caching. Lets the renderer call
 * `getCurrentAnimation(adaptCharacter(ch))` without forcing
 * `Character` to grow another method just to satisfy this contract.
 */
export function adaptCharacter(character: Character): AnimatableCharacter {
  return {
    id: character.id,
    getFacing: () => character.getFacing(),
    isDestroyed: () => {
      // `Character.destroy()` flips an internal flag but doesn't surface
      // it; we approximate via the `getActiveAttack()` + body-removal
      // sequence — a destroyed character returns `null` from
      // getActiveAttack and the renderer should already know not to
      // render it. The defensive idle fallback in getCurrentAnimation
      // covers the brief overlap window.
      return false;
    },
    getActiveAttack: () => character.getActiveAttack(),
  };
}
