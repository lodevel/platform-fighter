/**
 * Sprite animation driver — Sub-AC 2 of the M1 sprite-animation cut.
 *
 * Hooks the existing fighter state machine (movement + combat) onto the
 * loaded character spritesheets so each high-level state — `idle`,
 * `run`, `jump`, `fall`, `attack`, `hurt` — triggers the correct Phaser
 * sprite animation sequence at runtime.
 *
 * # Where this fits
 *
 * The wider animation pipeline already produces *symbolic* animation
 * keys per fixed step:
 *
 *   • `animationState.ts`             — `(character, move, phase, frame)`
 *                                        → `'wolf.jab.startup.0'` etc.
 *   • `fighterAnimationState.ts`      — composes hurt / shield / dodge /
 *                                        ledge / attack / idle into one key.
 *   • `defensiveAnimationState.ts`    — generates shield/dodge/ledge keys.
 *
 * Those modules emit per-phase, per-art-frame keys that are useful for
 * deterministic logging and the (future) full-atlas renderer. The M1
 * art delivery, however, ships **only four spritesheets per character**
 * (idle / run / jump / attack — see `assets/characters/<id>/animations/`).
 *
 * This driver is the bridge: it collapses the rich symbolic state down
 * to one of six discrete sprite animations the M1 art actually has, and
 * exposes a registry that registers the matching Phaser animations
 * against the loaded textures so a `sprite.play(animKey)` call in the
 * render loop just works.
 *
 * # Sprite-state taxonomy
 *
 * Six discrete, art-backed states:
 *
 *   • `idle`    — fighter is on the ground, not moving, not attacking,
 *                 not in hitstun. Loops the `idle` sheet.
 *   • `run`     — fighter is on the ground with horizontal velocity above
 *                 a small dead-zone OR a non-zero move-input. Loops the
 *                 `run` sheet.
 *   • `jump`    — fighter is airborne and rising (vy < 0). Plays the
 *                 `jump` sheet once and holds the last frame.
 *   • `fall`    — fighter is airborne and descending (vy >= 0). Reuses
 *                 the `jump` sheet (no separate fall art shipped); the
 *                 final frame of `jump` is the apex / fall pose.
 *   • `attack`  — an `ActiveAttack` is in flight (any move slot). Plays
 *                 the `attack` sheet once. The high-priority symbolic
 *                 key from `fighterAnimationState.ts` still drives the
 *                 hitbox spawn windows; this driver only chooses which
 *                 strip the renderer actually paints.
 *   • `hurt`    — `hitstunRemaining > 0`. M1 art has no dedicated hurt
 *                 sheet, so we hold the `idle` sheet's frame 0 and let
 *                 the existing palette-swap tint + invincibility-flicker
 *                 communicate the hurt window. The state is still
 *                 emitted distinctly so the renderer can also pulse a
 *                 tint or shake — and so a future `hurt.png` drop slots
 *                 in with one entry change here.
 *
 * # Determinism
 *
 * Every helper is a pure function over the input snapshot. No
 * `Math.random()`, no wall-clock reads. Identical snapshot → identical
 * resolved state → identical animation key. The replay system can
 * reconstruct the displayed sprite frame from a logged snapshot
 * byte-for-byte.
 *
 * # Phaser dependency
 *
 * The classifier and key composer are Phaser-free. Only
 * {@link registerCharacterSpriteAnimations} touches a Phaser scene's
 * `anims` manager — that helper is in this same file (rather than a
 * separate "registry" file) because keeping the key composition and the
 * registration call site together prevents the two halves from drifting
 * apart on a future renaming pass.
 */

import type Phaser from 'phaser';
import type { CharacterId } from '../types';
import { ASSET_KEYS } from '../assets/manifest';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discrete sprite-animation state. One per loaded spritesheet (with
 * `fall` collapsing onto `jump` and `hurt` collapsing onto `idle` for
 * the M1 art delivery — see module header).
 */
export type SpriteAnimationState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'attack'
  | 'hurt';

/**
 * Ordered list of every sprite-animation state. Useful for tests
 * (exhaustiveness) and for the registry helper (it iterates the four
 * canonical sheet keys, not this list — but this list is the canonical
 * taxonomy).
 */
export const SPRITE_ANIMATION_STATES: ReadonlyArray<SpriteAnimationState> =
  Object.freeze(['idle', 'run', 'jump', 'fall', 'attack', 'hurt']);

/**
 * Plain-data snapshot the classifier reads. Designed so any caller —
 * a live `Character`, a `Fighter` adapter, or a replay snapshot —
 * can converge on this shape with no Phaser / Matter dependency.
 *
 * Velocity is in Matter px-per-step units; positive `velocityY` means
 * "moving downward" (Phaser's screen-Y axis).
 */
export interface SpriteAnimationSnapshot {
  readonly characterId: CharacterId;
  /** True iff the fighter is currently in startup / active / recovery. */
  readonly isAttacking: boolean;
  /** Hitstun frames remaining (0 outside hitstun). */
  readonly hitstunRemaining: number;
  /** True iff a platform body is currently supporting the fighter. */
  readonly grounded: boolean;
  /** Live horizontal velocity. Used to choose run vs idle on the ground. */
  readonly velocityX: number;
  /** Live vertical velocity. Used to choose jump (rising) vs fall (descending). */
  readonly velocityY: number;
  /**
   * Optional movement-input magnitude on the horizontal axis. Lets the
   * classifier promote "player is holding left / right but velocity has
   * not yet built up" to `run`. Ignored when missing.
   */
  readonly moveInputX?: number;
  /** Fighter destruction flag — destroyed fighters always read as idle. */
  readonly destroyed: boolean;
}

/** Velocity dead-zone (px / fixed step) below which we read horizontal motion as still. */
export const RUN_VELOCITY_DEAD_ZONE = 0.25;

/** Move-input dead-zone for the optional input-aware promotion. */
export const RUN_INPUT_DEAD_ZONE = 0.15;

// ---------------------------------------------------------------------------
// Animation key composition
// ---------------------------------------------------------------------------

/**
 * Per-character spritesheet texture key for a given sheet slot. Mirrors
 * the manifest constants so the renderer and registry agree.
 *
 * Falls back to `null` for characters without a loaded sheet (Owl /
 * Bear in M1 — their `placeholder.spriteKey` is also null, so the
 * MatchScene renderer skips the sprite track entirely for them).
 */
export function getCharacterSpritesheetKey(
  characterId: CharacterId,
  sheet: 'idle' | 'run' | 'jump' | 'attack',
): string | null {
  switch (characterId) {
    case 'cat':
      switch (sheet) {
        case 'idle':
          return ASSET_KEYS.charCatIdle;
        case 'run':
          return ASSET_KEYS.charCatRun;
        case 'jump':
          return ASSET_KEYS.charCatJump;
        case 'attack':
          return ASSET_KEYS.charCatAttack;
      }
      break;
    case 'wolf':
      switch (sheet) {
        case 'idle':
          return ASSET_KEYS.charWolfIdle;
        case 'run':
          return ASSET_KEYS.charWolfRun;
        case 'jump':
          return ASSET_KEYS.charWolfJump;
        case 'attack':
          return ASSET_KEYS.charWolfAttack;
      }
      break;
    case 'owl':
      switch (sheet) {
        case 'idle':
          return ASSET_KEYS.charOwlIdle;
        case 'run':
          return ASSET_KEYS.charOwlRun;
        case 'jump':
          return ASSET_KEYS.charOwlJump;
        case 'attack':
          return ASSET_KEYS.charOwlAttack;
      }
      break;
    case 'bear':
      switch (sheet) {
        case 'idle':
          return ASSET_KEYS.charBearIdle;
        case 'run':
          return ASSET_KEYS.charBearRun;
        case 'jump':
          return ASSET_KEYS.charBearJump;
        case 'attack':
          return ASSET_KEYS.charBearAttack;
      }
      break;
  }
  return null;
}

/**
 * Compose the canonical Phaser animation key for a `(character, state)`
 * pair. The `.anim` suffix prevents key collision with the manifest's
 * texture keys (which already use `char.<id>.<sheet>`); a Phaser anim
 * and a Phaser texture share separate caches but a *single* string
 * registry per scene's `anims` manager, so the suffix keeps the
 * spritesheet keys callable as textures and the animation keys callable
 * as animations.
 *
 *   getSpriteAnimationKey('wolf', 'run')    → 'wolf.run.anim'
 *   getSpriteAnimationKey('cat',  'attack') → 'cat.attack.anim'
 *   getSpriteAnimationKey('cat',  'fall')   → 'cat.jump.anim'  (collapsed)
 *   getSpriteAnimationKey('cat',  'hurt')   → 'cat.idle.anim'  (collapsed)
 *
 * Returns `null` if the character has no source sheet (Owl / Bear in M1).
 */
export function getSpriteAnimationKey(
  characterId: CharacterId,
  state: SpriteAnimationState,
): string | null {
  const sheet = collapseStateToSheet(state);
  // Defensively check that the character has a loaded sheet — guards
  // the renderer from issuing a play() against a non-existent anim.
  if (getCharacterSpritesheetKey(characterId, sheet) === null) return null;
  return `${characterId}.${sheet}.anim`;
}

/**
 * Collapse the abstract sprite-animation state down to one of the four
 * actual loaded sheets for the M1 art delivery.
 *
 * Pure / deterministic. Exposed so tests can lock the collapse rule
 * down without re-deriving it from `getSpriteAnimationKey`.
 */
export function collapseStateToSheet(
  state: SpriteAnimationState,
): 'idle' | 'run' | 'jump' | 'attack' {
  switch (state) {
    case 'idle':
    case 'hurt': // M1 has no hurt sheet — hold idle pose; existing tint communicates hurt.
      return 'idle';
    case 'run':
      return 'run';
    case 'jump':
    case 'fall': // M1 has no fall sheet — reuse jump's apex frame.
      return 'jump';
    case 'attack':
      return 'attack';
  }
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Resolve the discrete sprite-animation state a fighter should display
 * this fixed step. Pure projection over the snapshot.
 *
 * # Precedence
 *
 *   1. **Destroyed** → `'idle'`        — defensive fallback.
 *   2. **Hurt**      → `'hurt'`        — `hitstunRemaining > 0`.
 *   3. **Attack**    → `'attack'`      — an active move is in flight.
 *   4. **Airborne**:
 *        - velocityY < 0 → `'jump'`   — rising.
 *        - velocityY ≥ 0 → `'fall'`   — at apex / descending.
 *   5. **Grounded movement**:
 *        - |velocityX| > RUN_VELOCITY_DEAD_ZONE → `'run'`
 *        - |moveInputX| > RUN_INPUT_DEAD_ZONE   → `'run'`  (input-aware promotion)
 *        - otherwise                            → `'idle'`
 *
 * The composition mirrors `fighterAnimationState.ts`'s priority order
 * (hurt > attack > pose) so the symbolic key and the sprite key never
 * disagree on which "layer" the fighter is in — a hurt key from the
 * symbolic resolver coincides with a `'hurt'` state here.
 */
export function classifySpriteAnimationState(
  snapshot: SpriteAnimationSnapshot,
): SpriteAnimationState {
  if (snapshot.destroyed) return 'idle';
  if (snapshot.hitstunRemaining > 0) return 'hurt';
  if (snapshot.isAttacking) return 'attack';

  if (!snapshot.grounded) {
    return snapshot.velocityY < 0 ? 'jump' : 'fall';
  }

  // Grounded. Run if either velocity OR input is past the dead-zone.
  const moving = Math.abs(snapshot.velocityX) > RUN_VELOCITY_DEAD_ZONE;
  const inputHeld =
    snapshot.moveInputX !== undefined &&
    Math.abs(snapshot.moveInputX) > RUN_INPUT_DEAD_ZONE;
  return moving || inputHeld ? 'run' : 'idle';
}

// ---------------------------------------------------------------------------
// Phaser anim registry
// ---------------------------------------------------------------------------

/**
 * Per-sheet metadata used by the registration helper. Frame counts here
 * MUST mirror the manifest's `frameCount` for each character's
 * spritesheet entry. Keeping the table local to this module lets the
 * registry decide animation cadence (frameRate, repeat) without
 * coupling the manifest to render-side concerns.
 */
interface SheetAnimSpec {
  /** Sheet slot name. */
  readonly sheet: 'idle' | 'run' | 'jump' | 'attack';
  /** Frame rate in frames per second. */
  readonly frameRate: number;
  /** Repeat count (-1 = loop forever, 0 = play once and stop). */
  readonly repeat: number;
  /**
   * Whether the animation should hold the last frame after finishing.
   * Used for `jump` / `attack` so the fighter doesn't snap back to
   * frame 0 between phase transitions.
   */
  readonly hold: boolean;
}

/**
 * Per-character animation specifications — frame rate / repeat / hold
 * tuned per sheet so the visual pacing matches the gameplay cadence
 * the symbolic state machine produces.
 *
 * Frame rates picked so:
 *   - `idle` loops at a calm 6 fps (breathing pose).
 *   - `run` loops at a brisk 12 fps to feel responsive.
 *   - `jump` plays once over ~5 frames at 12 fps (~0.4s) and holds the
 *     apex pose, matching the typical jump arc duration.
 *   - `attack` plays once at 18 fps so a 6-frame attack window covers
 *     ~0.33s — close to the median grounded-attack lockout (~20 frames
 *     @ 60fps gameplay = ~0.33s).
 *
 * The same spec table works for both Cat and Wolf — the per-character
 * frame counts come from the manifest entries, not this table.
 */
export const SPRITE_ANIM_SPECS: ReadonlyArray<SheetAnimSpec> = Object.freeze([
  Object.freeze({ sheet: 'idle', frameRate: 6, repeat: -1, hold: false }),
  Object.freeze({ sheet: 'run', frameRate: 12, repeat: -1, hold: false }),
  Object.freeze({ sheet: 'jump', frameRate: 12, repeat: 0, hold: true }),
  Object.freeze({ sheet: 'attack', frameRate: 18, repeat: 0, hold: true }),
]);

/**
 * Minimal Phaser anim-manager surface this module touches. Declared
 * narrowly so tests can satisfy it with a fake without faking the
 * whole `Phaser.Animations.AnimationManager`.
 *
 * Note: We *do* re-export Phaser-Anim and the underlying scene types
 * via the `Phaser` import above, but the helper takes the narrow
 * surface to keep the testing surface tight.
 */
export interface SceneAnimSurface {
  readonly anims: {
    exists(key: string): boolean;
    create(
      config: Phaser.Types.Animations.Animation,
    ): Phaser.Animations.Animation | false;
    generateFrameNumbers(
      key: string,
      config?: Phaser.Types.Animations.GenerateFrameNumbers,
    ): Phaser.Types.Animations.AnimationFrame[];
  };
  textures: { exists(key: string): boolean };
}

/**
 * Register the four canonical animations for a single character on a
 * scene's `anims` manager. Idempotent — re-entry checks `anims.exists`
 * before creating, so a repeated call (HMR, scene re-entry) is a no-op.
 *
 * Returns the list of registered animation keys (in canonical order:
 * idle / run / jump / attack). Returns `[]` for characters without a
 * loaded source sheet (Owl / Bear in M1).
 *
 * Behaviour notes:
 *   • Walks {@link SPRITE_ANIM_SPECS} so adding a new sheet (e.g.
 *     `hurt.png` in M2) is one entry change here.
 *   • Skips sheets whose underlying texture isn't loaded — protects
 *     against partial asset drops blowing up scene-create.
 *   • Always wires `hideOnComplete: false` so the sprite stays visible
 *     after a one-shot (`jump` / `attack`) finishes.
 */
export function registerCharacterSpriteAnimations(
  scene: SceneAnimSurface,
  characterId: CharacterId,
): ReadonlyArray<string> {
  const created: string[] = [];
  for (const spec of SPRITE_ANIM_SPECS) {
    const textureKey = getCharacterSpritesheetKey(characterId, spec.sheet);
    if (textureKey === null) continue;
    if (!scene.textures.exists(textureKey)) continue;
    const animKey = `${characterId}.${spec.sheet}.anim`;
    if (scene.anims.exists(animKey)) {
      // Idempotent — already registered (HMR, scene re-entry).
      created.push(animKey);
      continue;
    }
    const frames = scene.anims.generateFrameNumbers(textureKey, {});
    const result = scene.anims.create({
      key: animKey,
      frames,
      frameRate: spec.frameRate,
      repeat: spec.repeat,
      // `showOnStart` makes the sprite visible on play() — defensive
      // guard against an `setVisible(false)` from a parent overlay.
      showOnStart: true,
      // `hideOnComplete: false` keeps the sprite on-screen at the last
      // frame after a one-shot animation finishes (jump apex / attack
      // recovery pose).
      hideOnComplete: false,
    });
    if (result !== false) {
      created.push(animKey);
    }
  }
  return created;
}

/**
 * Register sprite animations for every character that ships with a
 * loaded source sheet. Walks the M1 roster (`cat`, `wolf`) plus any
 * future-loaded characters — Owl / Bear are no-ops until their assets
 * land. Returns the union of all registered animation keys.
 */
export function registerAllCharacterSpriteAnimations(
  scene: SceneAnimSurface,
  characters: ReadonlyArray<CharacterId> = ['cat', 'wolf', 'owl', 'bear'],
): ReadonlyArray<string> {
  const all: string[] = [];
  for (const id of characters) {
    for (const k of registerCharacterSpriteAnimations(scene, id)) {
      all.push(k);
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// State-machine binding — wires the classifier to a sprite.play() target
// ---------------------------------------------------------------------------

/**
 * Minimal sprite-play surface this module needs. Declared narrowly so
 * tests can satisfy the contract with a recorder fake without faking
 * Phaser's whole `GameObjects.Sprite`.
 */
export interface PlayableSprite {
  /**
   * Phaser's `play(key, ignoreIfPlaying)` signature. The driver always
   * passes `ignoreIfPlaying === true` so a same-state tick is a no-op.
   */
  play(
    key: string,
    ignoreIfPlaying?: boolean,
  ): unknown;
  /** Currently-playing animation handle (if any). */
  readonly anims?: { isPlaying?: boolean; getName?: () => string };
}

/**
 * Read-only provider of a fighter's per-frame sprite snapshot. Mirrors
 * the shape of `FighterSnapshotProvider` from `fighterAnimationState.ts`
 * so a single Fighter / Character can satisfy both contracts.
 */
export interface SpriteAnimationSnapshotProvider {
  getSpriteAnimationSnapshot(): SpriteAnimationSnapshot;
}

/**
 * Per-fighter sprite-animation state machine. Pulls a snapshot each
 * `tick()`, classifies the sprite state, and — when the resolved state
 * changes — issues a `sprite.play(animKey, true)` against the target
 * sprite. Returns the last-resolved state for callers that want to
 * mirror the choice into the HUD or debug overlay.
 */
export interface SpriteAnimationStateMachine {
  /** Re-poll, re-classify, fire the play() call on key changes. */
  tick(): SpriteAnimationState;
  /** Last-resolved sprite-state (or `null` before the first tick). */
  current(): SpriteAnimationState | null;
  /** Detach so subsequent ticks no-op (used on scene shutdown). */
  detach(): void;
}

/**
 * Build a {@link SpriteAnimationStateMachine} for a `(provider, sprite)`
 * pair. The state machine:
 *
 *   • Caches the last-emitted state so `play()` only fires on actual
 *     state transitions.
 *   • On the very first `tick()`, fires `play()` regardless so the
 *     sprite is primed to its initial pose.
 *   • Reads the per-character animation key off
 *     `getSpriteAnimationKey(characterId, state)`. If the lookup
 *     returns `null` (Owl / Bear without sheets), the state machine
 *     records the resolved state but does not call `play()`.
 *
 * Pure-data caller (recorder fake / live Phaser scene). No timer, no
 * scene event subscriptions — the host scene drives `tick()` from its
 * fixed-step update loop.
 */
export function createSpriteAnimationStateMachine(
  provider: SpriteAnimationSnapshotProvider,
  sprite: PlayableSprite,
): SpriteAnimationStateMachine {
  let last: SpriteAnimationState | null = null;
  let detached = false;
  return {
    tick(): SpriteAnimationState {
      const snap = provider.getSpriteAnimationSnapshot();
      const next = classifySpriteAnimationState(snap);
      if (detached) {
        last = next;
        return next;
      }
      const animKey = getSpriteAnimationKey(snap.characterId, next);
      // Fire play() on the first tick (last === null) OR on state change.
      // `ignoreIfPlaying = true` makes a same-key call a no-op inside
      // Phaser even if our cache is stale, so we never restart a
      // looping animation mid-cycle.
      const stateChanged = last === null || last !== next;
      if (animKey !== null && stateChanged) {
        sprite.play(animKey, true);
      }
      last = next;
      return next;
    },
    current(): SpriteAnimationState | null {
      return last;
    },
    detach(): void {
      detached = true;
    },
  };
}
