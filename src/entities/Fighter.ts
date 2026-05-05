/**
 * `Fighter` — the per-player runtime entity (Sub-AC 3.1 of AC 201).
 *
 * Sub-AC 3.2 (this update) wires the Fighter entity through to the
 * underlying `Character`'s movement and jump physics so callers that
 * iterate `fighters[]` can drive walk / run / jump / double-jump / fall
 * and read ground-contact state without having to drill into
 * `fighter.getCharacter().…` every time:
 *
 *   • `applyInput({ moveX, jump, attack? })` already routes one fixed
 *     step of input through the wrapped Character — i.e. left/right
 *     acceleration toward `maxRunSpeed`, ground vs air accel/damping,
 *     rising-edge jump impulse, multi-jump budget, fall integration
 *     (handled by Matter gravity).
 *   • `isGrounded()` exposes the Character's collision-driven support
 *     counter — `true` while a platform body sits below the character
 *     centre, `false` the moment that contact ends (walking off a
 *     ledge, jumping off a platform, mid-fall).
 *   • `getJumpsUsed()` / `getJumpsRemaining()` (added in this sub-AC)
 *     surface the jump budget. AI scripts and HUD overlays read these
 *     to decide "should this bot air-jump now?" or "draw N pip icons
 *     beside the damage meter".
 *   • `FighterStateSnapshot` carries `jumpsUsed` / `jumpsRemaining`
 *     alongside the existing position / velocity / facing / grounded
 *     fields so a single snapshot is enough for the (M4) replay system
 *     to resync movement state on a scrub seek.
 *
 * Where this fits in the architecture:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Fighter (this file) — "Player N is currently a Wolf in      │
 *   │   palette 3 with 3 stocks left and 47 % damage."            │
 *   │       │                                                     │
 *   │       └── owns ─────────► Character (../characters/         │
 *   │                              Character.ts)                  │
 *   │                            • Matter.js body                 │
 *   │                            • movement / jump physics        │
 *   │                            • attack state machine           │
 *   │                            • damage % accumulator           │
 *   │                            • applyHit → knockback           │
 *   │                            • respawn invincibility          │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Why Fighter is a *separate entity file* from Character:
 *
 *   • `Character` is the *physics-and-class* abstraction — "a Wolf body"
 *     vs "a Cat body". One Character per body in the world. It does not
 *     know which player slot owns it, what palette it's wearing, or how
 *     many stocks the player has burned.
 *
 *   • `Fighter` is the *player-slot* abstraction — "Player 2 is currently
 *     using a Wolf to fight at this stocks/damage state". One Fighter per
 *     active slot in a match. Stocks, palette index, and slot identity
 *     live here; they have no business cluttering `Character`'s body
 *     factory.
 *
 *   • This split makes the (later AC) per-player overlays (damage HUD,
 *     stock icons, "P2 KO'd!" banner) trivial: they iterate fighters,
 *     not characters, and read the slot identity directly off the entity
 *     instead of needing a side-table from `body → playerIndex`.
 *
 *   • The split also matches the Seed ontology: `playerSlot` is a
 *     distinct concept from `character`, and the runtime entity that
 *     marries them is exactly this class.
 *
 * What this entity owns:
 *
 *   1. Slot identity   — `playerIndex` (1..4), `characterId` (wolf/…),
 *                        `paletteIndex` (0..7).
 *   2. Physics body    — via the wrapped `Character` instance. Exposed
 *                        through delegating accessors so call sites that
 *                        iterate `fighters[]` don't have to drill into
 *                        `.character.body`.
 *   3. Damage state    — exposed via `getDamagePercent / setDamagePercent
 *                        / addDamage`. Delegates to Character.
 *   4. Knockback       — `applyHit(hit)` accepts a `HitInfo` and returns
 *                        the realised `KnockbackResult`. Identical
 *                        contract to Character.applyHit, but called on
 *                        the Fighter so collision handlers can iterate
 *                        the fighter list directly.
 *   5. Stocks counter  — local to the fighter (kept here, not in
 *                        StockTracker, because a Fighter is allowed to
 *                        be created without a tracker — e.g. a training-
 *                        mode dummy with infinite stocks). The match's
 *                        `StockTracker` and a Fighter's local count both
 *                        decrement in lockstep when wired together.
 *   6. KO counter      — bookkeeping for post-match stats ("Player 2 KO'd
 *                        Player 1 four times this round"). Incremented
 *                        externally by the (M2 / later) damage handler.
 *
 * Determinism: every state mutation is a pure function of (current
 * state, event, tuning). No `Math.random()`, no wall-clock reads. The
 * Character it wraps holds the same property, so a replay driving the
 * same `applyInput` / `applyHit` / `loseStock` calls produces an
 * identical Fighter state.
 *
 * What this entity deliberately does NOT do:
 *
 *   - Render the sprite / palette swap (M-future visual layer).
 *   - Decide WHEN to spawn / respawn (the StockTracker schedules; the
 *     scene calls `respawnAt`). This entity only mechanises the act.
 *   - Pick what to do each frame for AI fighters (the AI module
 *     synthesises `CharacterInput`s and feeds them into `applyInput`).
 *   - Persist its state (the replay system snapshots position +
 *     velocity + damage; the slot-identity fields are immutable for
 *     the match's duration so they live only in the match config).
 */

import type Phaser from 'phaser';

import { Character, type CharacterInput, type CharacterTuning } from '../characters/Character';
import type { ActiveAttack, AttackMove } from '../characters/attacks';
import type { HitInfo, KnockbackResult } from '../characters/combat';
import type { AnimationState } from '../characters/animationState';
import type { ShieldState } from '../characters/shieldState';
import type { DodgeState } from '../characters/dodgeState';
import { Bear } from '../characters/Bear';
import { Cat } from '../characters/Cat';
import { Owl } from '../characters/Owl';
import { Wolf } from '../characters/Wolf';
// Sub-AC 3 of the T2 refactor — every per-player runtime entity
// resolves its concrete `Character` subclass through the canonical
// `fighterRegistry`. The pre-existing per-class imports above remain
// because tests / type narrowing helpers (`fighter instanceof Wolf`)
// still need the concrete class symbols; the dispatch path is
// registry-mediated.
import { instantiateFighter } from '../characters/fighterRegistry';
import {
  getCharacterSpec,
  type CharacterPlaceholderVisual,
  type CharacterSpec,
} from '../characters/roster';
import type { CharacterId } from '../types';
// AC 10302 Sub-AC 2 — combat → audio bridge. Fighter is the natural
// owner of the per-stock KO event (the Character layer doesn't know about
// stocks); it also forwards its constructor's `sfxSink` option through
// to the wrapped Character so attack / shield / dodge SFX share one
// audio backend instance with the KO cue.
import { emitCombatSfx, type CombatSfxSink } from '../audio/combatAudio';
import { ASSET_KEYS } from '../assets/manifest';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Player slot index (1..4). Mirrors `PlayerSlot.index` from `../types`. */
export type FighterSlotIndex = 1 | 2 | 3 | 4;

/**
 * Construction options for a `Fighter`. Required fields are the slot
 * identity (who is this?) and spawn position (where do we drop them?).
 *
 * `stockCount` defaults to 3 (matches the Seed ontology
 * `match_config.stock_count: 3`). Pass `Infinity` for a training-mode
 * dummy that never goes out.
 *
 * `paletteIndex` is bounds-checked at construction so the visual layer
 * (later AC) can pull `palettes[paletteIndex]` without re-validating.
 */
export interface FighterOptions {
  readonly playerIndex: FighterSlotIndex;
  readonly characterId: CharacterId;
  /** 0..7 — one of the eight palette swaps generated per character. */
  readonly paletteIndex: number;
  readonly spawnX: number;
  readonly spawnY: number;
  /** Initial stocks. Default `DEFAULT_FIGHTER_STOCK_COUNT` (3). */
  readonly stockCount?: number;
  /**
   * Optional override of the underlying Character class. Almost always
   * left to the default factory below; tests use this to inject a
   * stub Character without spinning up Wolf / Cat / Owl / Bear.
   */
  readonly characterFactory?: CharacterFactory;
  /**
   * AC 10302 Sub-AC 2 — combat → audio bridge sink. Forwarded onto the
   * wrapped {@link Character} via `setSfxSink` immediately after
   * construction so attack / shield / dodge SFX fire from the per-frame
   * physics tick, and ALSO retained at the Fighter layer so the per-
   * stock KO cue (`'sfx.ko'`) fires from {@link Fighter.loseStock}.
   *
   * Production callers pass the {@link AudioManager} (which structurally
   * satisfies {@link CombatSfxSink} via its `playSfx` method); tests
   * pass a recorder fake. Optional / omitted ⇒ all combat audio is
   * silent for this fighter.
   *
   * The sink is a single shared instance — the Character layer voices
   * the in-flight events (jab, tilt, smash, aerial, shield raise, dodge
   * press) and the Fighter layer voices the per-stock KO event. Sharing
   * the instance means a future per-fighter mute toggle (e.g. "P3 is
   * silenced for stream") only has to filter once at the sink.
   */
  readonly sfxSink?: CombatSfxSink;
}

/**
 * Build a `Character` for a given character id at the given spawn point.
 * The default is `defaultCharacterFactory` below; tests inject a fake.
 */
export type CharacterFactory = (
  scene: Phaser.Scene,
  characterId: CharacterId,
  spawnX: number,
  spawnY: number,
) => Character;

/**
 * Read-only snapshot of a Fighter's runtime state. Returned by
 * `getState()` for use by the replay snapshot writer, the HUD, and
 * the AI's "what's the score?" query.
 */
export interface FighterStateSnapshot {
  readonly playerIndex: FighterSlotIndex;
  readonly characterId: CharacterId;
  readonly paletteIndex: number;
  readonly stocks: number;
  readonly stocksLost: number;
  readonly kos: number;
  readonly damagePercent: number;
  readonly position: { x: number; y: number };
  readonly velocity: { x: number; y: number };
  readonly facing: 1 | -1;
  readonly grounded: boolean;
  /**
   * Jumps consumed since the last landing (Sub-AC 3.2). 0 when the
   * fighter is fresh on the ground; up to `maxJumps` when fully spent
   * mid-air. Replay snapshots restore this value via the underlying
   * Character on resync so a scrub seek lands a fighter with the right
   * mid-air jump budget.
   */
  readonly jumpsUsed: number;
  /**
   * Air-jumps still available before the fighter must touch a platform
   * to recharge. Equals `maxJumps - jumpsUsed`, clamped at 0. Provided
   * pre-computed so the HUD doesn't have to fetch tuning to draw the
   * pip icons.
   */
  readonly jumpsRemaining: number;
  readonly inHitstun: boolean;
  readonly invincible: boolean;
  readonly eliminated: boolean;
  readonly destroyed: boolean;
  /**
   * AC 60301 Sub-AC 1 — live shield state machine snapshot. Carries
   * the shield's discrete name (`'idle' | 'active' | 'broken'`),
   * health, break-stun frames remaining, and regen-delay clock so the
   * HUD can paint a shield bar / break-shatter overlay and the replay
   * snapshot system can resync the shield on a scrub seek.
   */
  readonly shield: ShieldState;
  /**
   * Convenience flag — true iff the shield is raised this frame.
   * Equivalent to `shield.name === 'active'`; carried as a boolean so
   * AI heuristics ("is this opponent blocking?") don't have to import
   * the shield state-name union.
   */
  readonly isShielding: boolean;
  /**
   * Convenience flag — true iff the fighter is in shield-break stun.
   * Equivalent to `shield.name === 'broken'`. Useful for the HUD's
   * "shield shattered" visual cue.
   */
  readonly isShieldBroken: boolean;
  /**
   * AC 60302 Sub-AC 2 — live dodge / roll state machine snapshot.
   * Carries the dodge's discrete name (`'idle' | 'active' | 'recovery'
   * | 'cooldown'`), variant kind (spot / roll / air), locked-in facing,
   * frames elapsed, i-frame window remaining, and cooldown clock so
   * the HUD can paint a dodge-i-frame indicator and the replay
   * snapshot system can resync the dodge state on a scrub seek.
   */
  readonly dodge: DodgeState;
  /**
   * Convenience flag — true iff the fighter is mid-dodge (active or
   * recovery phase). Equivalent to `dodge.name === 'active' ||
   * dodge.name === 'recovery'`. AI heuristics ("is this opponent
   * committed to a dodge?") read this directly without the full
   * dodge-state-name union import.
   */
  readonly isDodging: boolean;
  /**
   * Convenience flag — true iff the dodge i-frame window is currently
   * open. Equivalent to `dodge.iframesRemaining > 0`. Distinct from
   * {@link isDodging}: the recovery phase is `isDodging === true` but
   * `isDodgeInvincible === false` (the punish window).
   */
  readonly isDodgeInvincible: boolean;
}

// ---------------------------------------------------------------------------
// Constants / defaults
// ---------------------------------------------------------------------------

/**
 * Default starting stock count. Mirrors `StockTracker.DEFAULT_STOCK_COUNT`
 * and the Seed's `match_config.stock_count: 3`. Kept as its own constant
 * (not imported from StockTracker) so the entity layer doesn't take a
 * dependency on the match-state engine — Fighters can exist outside of
 * a tracked match (training mode, replay viewer, AI sandbox).
 */
export const DEFAULT_FIGHTER_STOCK_COUNT = 3;

/** Maximum legal palette index. 8 palettes per character → indices 0..7. */
export const MAX_PALETTE_INDEX = 7;

// ---------------------------------------------------------------------------
// Default character factory
// ---------------------------------------------------------------------------

/**
 * Map a `CharacterId` to its concrete `Character` subclass. Wolf and
 * Cat shipped in M1; Owl joined the playable roster in AC 60004
 * Sub-AC 4 (mage archetype, grounded triplet); Bear joined in AC 60001
 * Sub-AC 1 (grappler archetype, grounded triplet) — every roster slot
 * now resolves to its concrete subclass. The match runtime composes
 * fighters off this factory, so AI and human input both flow through
 * the same code path regardless of which character was picked.
 *
 * The factory is broken out into a `const` (not inlined into the class
 * constructor) so tests can pass a `characterFactory` override without
 * having to subclass `Fighter`.
 */
export const defaultCharacterFactory: CharacterFactory = (
  scene,
  characterId,
  spawnX,
  spawnY,
) => {
  // Sub-AC 3 of the T2 refactor — dispatch is now delegated to
  // `fighterRegistry.ts`, the single source of truth that maps
  // `CharacterId` onto its concrete per-fighter subclass + frozen
  // {@link FighterContract}. The legacy in-line `switch (id)` block
  // (with its parallel `case` lines hard-coding `new Wolf(scene, ...)`
  // / `new Cat(...)` / etc.) is intentionally gone — adding a 5th
  // roster slot now only requires editing the registry, not this
  // factory and `characterFactory.createCharacterById` in lockstep.
  //
  // Behaviour preservation: the registry's `instantiateFighter`
  // invokes the same `new Wolf(scene, opts)` / `new Cat(scene, opts)`
  // / etc. that this factory called previously, so the wrapped
  // {@link Character} surface (registered moveset, tuning, body
  // geometry, palette, animation drivers, ...) is byte-for-byte
  // identical to the pre-registry path. The registry's lookup throws
  // with a descriptive message that mentions the offending id, which
  // preserves the fail-loud behaviour the previous default-case
  // exhaustiveness guard provided. The `Wolf` / `Cat` / `Owl` /
  // `Bear` imports above remain because tests and type-narrowing
  // helpers (`fighter instanceof Wolf`) still need the concrete class
  // symbols at the entity layer.
  return instantiateFighter(scene, characterId, { spawnX, spawnY });
};
// Reference the per-class imports so the bundler / linter does not
// warn about unused symbols. The classes themselves are required at
// the top of this file because tests and downstream type narrowing
// (`fighter instanceof Wolf`) still consume them; the dispatch path
// no longer mentions them by name.
void Wolf;
void Cat;
void Owl;
void Bear;

// ---------------------------------------------------------------------------
// Fighter
// ---------------------------------------------------------------------------

/**
 * Per-player runtime entity. One instance per active slot in a match.
 *
 * Lifecycle:
 *
 *   const fighter = new Fighter(scene, {
 *     playerIndex: 1,
 *     characterId: 'wolf',
 *     paletteIndex: 0,
 *     spawnX: 320, spawnY: 200,
 *   });
 *
 *   // every fixed step:
 *   fighter.applyInput(inputForP1);
 *
 *   // on a hit-collision pair:
 *   fighter.applyHit(hitInfo);
 *
 *   // on a blast-zone touch:
 *   const eliminated = fighter.loseStock();
 *   if (!eliminated) fighter.respawnAt(spawnX, spawnY, 90);
 *
 *   // teardown:
 *   fighter.destroy();
 */
export class Fighter {
  // -------------------------------------------------------------------------
  // Slot identity (immutable for the lifetime of the entity)
  // -------------------------------------------------------------------------

  readonly playerIndex: FighterSlotIndex;
  readonly characterId: CharacterId;
  readonly paletteIndex: number;
  readonly initialStocks: number;

  // -------------------------------------------------------------------------
  // Runtime state
  // -------------------------------------------------------------------------

  /** Wrapped physics + combat actor. Non-null until `destroy()`. */
  private character: Character;

  /**
   * AC 10302 Sub-AC 2 — combat → audio bridge sink. Latched at
   * construction (or via {@link setSfxSink}) and read by
   * {@link loseStock} to fire the per-stock KO cue (`'sfx.ko'`) on
   * every real stock loss.
   *
   * Stays in sync with the wrapped {@link Character}'s sink — both
   * setters update both layers so a single instance voices attacks,
   * defensive moves, AND KOs.
   */
  private sfxSink: CombatSfxSink | null = null;

  /** Stocks remaining. 0 = eliminated. */
  private stocks: number;

  /** Cumulative stocks lost across the match — for post-match stats. */
  private stocksLost = 0;

  /**
   * KOs scored by this fighter. Incremented externally by the damage /
   * blast-zone handler when one of this fighter's hitboxes lands the
   * blow that knocks another fighter out. Pure bookkeeping — does not
   * affect gameplay.
   */
  private kos = 0;

  private destroyed = false;

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  constructor(scene: Phaser.Scene, options: FighterOptions) {
    // ---- Validate slot identity ------------------------------------------
    // Catch mis-wiring at the entity boundary instead of letting an
    // out-of-range slot index leak into the input dispatcher / HUD.
    if (
      options.playerIndex !== 1 &&
      options.playerIndex !== 2 &&
      options.playerIndex !== 3 &&
      options.playerIndex !== 4
    ) {
      throw new Error(
        `Fighter: playerIndex must be 1, 2, 3, or 4 — got ${String(options.playerIndex)}`,
      );
    }
    if (
      !Number.isInteger(options.paletteIndex) ||
      options.paletteIndex < 0 ||
      options.paletteIndex > MAX_PALETTE_INDEX
    ) {
      throw new Error(
        `Fighter: paletteIndex must be an integer in [0, ${MAX_PALETTE_INDEX}] — got ${String(
          options.paletteIndex,
        )}`,
      );
    }

    const requestedStocks = options.stockCount ?? DEFAULT_FIGHTER_STOCK_COUNT;
    // Allow `Infinity` for training-mode dummies; otherwise require a
    // positive integer so the stocks counter is well-defined.
    if (
      requestedStocks !== Infinity &&
      (!Number.isInteger(requestedStocks) || requestedStocks < 1)
    ) {
      throw new Error(
        `Fighter: stockCount must be a positive integer or Infinity — got ${String(
          requestedStocks,
        )}`,
      );
    }

    this.playerIndex = options.playerIndex;
    this.characterId = options.characterId;
    this.paletteIndex = options.paletteIndex;
    this.initialStocks = requestedStocks;
    this.stocks = requestedStocks;

    // ---- Build the wrapped Character -------------------------------------
    const factory = options.characterFactory ?? defaultCharacterFactory;
    this.character = factory(scene, options.characterId, options.spawnX, options.spawnY);

    // ---- AC 10302 Sub-AC 2: wire the combat → audio sink -----------------
    // The factory signature doesn't carry arbitrary Character options
    // (it's intentionally narrow — `(scene, id, x, y)` — so AI scripts,
    // tests, and the production roster all share one entry point), so
    // we attach the sink post-construction via `setSfxSink`. Both the
    // Fighter-layer KO emit and the Character-layer attack / shield /
    // dodge emit now read from the same single instance.
    if (options.sfxSink !== undefined) {
      this.sfxSink = options.sfxSink;
      this.character.setSfxSink(options.sfxSink);
    }
  }

  // -------------------------------------------------------------------------
  // Wrapped character access
  // -------------------------------------------------------------------------

  /**
   * The underlying physics + combat actor. Exposed read-only so call
   * sites that need Matter-level access (collision handler reading
   * `body.label`, AI reading `getActiveAttack`) can drill in without us
   * re-exposing every Character method on Fighter.
   */
  getCharacter(): Character {
    return this.character;
  }

  /** Direct handle to the Matter body. Convenience accessor. */
  get body(): MatterJS.BodyType {
    return this.character.body;
  }

  // -------------------------------------------------------------------------
  // AC 10302 Sub-AC 2 — combat → audio sink wiring
  // -------------------------------------------------------------------------

  /**
   * Wire (or clear) the combat → audio sink that voices the per-stock
   * KO event from {@link loseStock} **and** the wrapped Character's
   * attack / shield / dodge events.
   *
   * Idempotent: passing the same sink twice is a no-op. Passing `null`
   * detaches both layers; subsequent combat events become silent
   * no-ops via the {@link emitCombatSfx} guard.
   *
   * Most production paths pass the {@link AudioManager} via the
   * constructor's `sfxSink` option; this setter exists so the
   * `MatchScene` can attach the manager after both the Fighter list
   * and the AudioManager are constructed (the scene wires the audio
   * layer in `create`, after the fighters are spawned).
   */
  setSfxSink(sink: CombatSfxSink | null): void {
    this.sfxSink = sink;
    if (!this.destroyed) {
      this.character.setSfxSink(sink);
    }
  }

  /** AC 10302 Sub-AC 2 — read the currently-attached audio sink (or `null`). */
  getSfxSink(): CombatSfxSink | null {
    return this.sfxSink;
  }

  // -------------------------------------------------------------------------
  // Per-frame input — delegated
  // -------------------------------------------------------------------------

  /**
   * Apply one fixed step of input. Routed straight through to the
   * underlying Character. No-op when the fighter is destroyed or has
   * been eliminated AND not yet respawned (the body is gone in that
   * window — input has nothing to drive).
   */
  applyInput(input: CharacterInput): void {
    if (this.destroyed) return;
    this.character.applyInput(input);
  }

  // -------------------------------------------------------------------------
  // Health / damage state
  // -------------------------------------------------------------------------

  /** Current accumulated damage percent. 0..MAX_DAMAGE_PERCENT. */
  getDamagePercent(): number {
    return this.character.getDamagePercent();
  }

  /**
   * Replace the damage percent directly. Used by the respawn flow
   * (reset to 0 on stock loss) and replay-snapshot resync.
   */
  setDamagePercent(percent: number): void {
    if (this.destroyed) return;
    this.character.setDamagePercent(percent);
  }

  /**
   * Add `delta` to the damage percent. Hazard ticks (lava, spikes) use
   * this directly so they get a percent bump without going through the
   * full `applyHit` knockback / hitstun machinery.
   *
   * Returns the new percent; no-op for a destroyed fighter.
   */
  addDamage(delta: number): number {
    if (this.destroyed) return this.character.getDamagePercent();
    return this.character.addDamage(delta);
  }

  // -------------------------------------------------------------------------
  // Knockback application — delegated
  // -------------------------------------------------------------------------

  /**
   * Apply an incoming hit. Returns the realised knockback / hitstun.
   * Idempotent for destroyed fighters — they ignore the hit and report
   * a zero result, mirroring the underlying `Character.applyHit` contract.
   *
   * Why this is on Fighter (not just Character):
   *   The (M2) damage handler iterates `fighters[]` to resolve hitbox
   *   collisions. Letting it call `fighter.applyHit(...)` keeps the
   *   per-player metadata (slot index, KO crediting) reachable in one
   *   step instead of forcing a `body → fighter` reverse lookup at the
   *   call site.
   */
  applyHit(hit: HitInfo): KnockbackResult {
    if (this.destroyed) {
      // Sub-AC 2 of AC 6: angle 0 is the conventional zero-launch sentinel.
      // Callers that care about direction must check `magnitude > 0` to
      // distinguish "no launch" from "launched horizontally right".
      return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
    }
    return this.character.applyHit(hit);
  }

  // -------------------------------------------------------------------------
  // Stocks
  // -------------------------------------------------------------------------

  /** Stocks remaining. 0 = eliminated. */
  getStocks(): number {
    return this.stocks;
  }

  /** Total stocks lost across the match (for post-match stats). */
  getStocksLost(): number {
    return this.stocksLost;
  }

  /** True iff the fighter has zero stocks left. */
  isEliminated(): boolean {
    return this.stocks <= 0;
  }

  /**
   * Decrement the stock counter by 1, clamped at 0. Returns `true` if
   * the fighter was eliminated by the loss (stocks hit 0), `false` if
   * they have stocks remaining.
   *
   * Idempotent: calling on an already-eliminated fighter is a no-op
   * that returns `true`. (That guards against duplicate blast-zone
   * collision events triggering a double-decrement.)
   *
   * NOTE: the match-level `StockTracker` independently tracks stocks
   * across all 4 players plus the respawn schedule. Fighter's local
   * counter is a per-entity convenience for queries like
   * `fighter.getStocks()` and stays in lockstep when the scene calls
   * both in the same frame. Keeping it here too means a Fighter built
   * without a tracker (training dummy, replay viewer) still has a
   * meaningful stocks value.
   */
  loseStock(): boolean {
    if (this.stocks <= 0) return true;
    this.stocks -= 1;
    this.stocksLost += 1;
    // AC 10302 Sub-AC 2 — fire the canonical KO cue on every real
    // stock loss (the early-return above filters duplicate blast-zone
    // collision events on an already-eliminated fighter, so the cue
    // can't double-voice on a body lingering past the boundary). The
    // Smash-style "ka-ching" plays for *every* KO — non-final stock
    // losses get the same audio feedback as the final one — because
    // the sound communicates "someone got KO'd," not "someone got
    // eliminated." The final-stock case (`stocks <= 0`) is voiced
    // additionally by the (later) results / elimination flow if the
    // designers want a separate cue; this emit is the per-KO event.
    emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxKo);
    return this.stocks <= 0;
  }

  /**
   * Restore stocks to the initial count. Used by the (later AC) match-
   * restart and replay-rewind flows. Does not reset KOs scored — those
   * are stats, not match state.
   */
  resetStocks(): void {
    this.stocks = this.initialStocks;
    this.stocksLost = 0;
  }

  // -------------------------------------------------------------------------
  // KO bookkeeping
  // -------------------------------------------------------------------------

  /** KOs scored by this fighter against opponents. */
  getKos(): number {
    return this.kos;
  }

  /**
   * Increment the KO counter. Called by the damage / blast-zone handler
   * when one of this fighter's hits lands the blow that eliminates an
   * opponent, or when an opponent crosses a blast zone after being
   * knocked back by this fighter (the handler decides which heuristic
   * applies; the entity just counts).
   */
  recordKo(): void {
    this.kos += 1;
  }

  /** Reset KO count (used by replay rewind / match restart). */
  resetKos(): void {
    this.kos = 0;
  }

  // -------------------------------------------------------------------------
  // Respawn
  // -------------------------------------------------------------------------

  /**
   * Drop the fighter back into the world at `(x, y)`, reset their damage
   * percent to 0, and grant the configured invincibility window.
   *
   * Routed entirely through the Character — Fighter is just the place
   * the call site finds the right combination of operations to perform
   * after `loseStock()` has been recorded.
   *
   * Defaults match the StockTracker contract: 90 frames (~1.5 s) of
   * grace at 60 Hz. Pass 0 to opt out (e.g. test-only setup).
   */
  respawnAt(x: number, y: number, invincibilityFrames = 90): void {
    if (this.destroyed) return;
    this.character.setPosition(x, y);
    this.character.setDamagePercent(0);
    this.character.setInvincibility(invincibilityFrames);
  }

  // -------------------------------------------------------------------------
  // Attack helpers (forwarded for entity-level convenience)
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the active attack. Returns `null` between
   * attacks. AI consumers iterate `fighters[]` and call this directly.
   */
  getActiveAttack(): ActiveAttack | null {
    return this.character.getActiveAttack();
  }

  /** True iff the fighter is currently in startup / active / recovery. */
  isAttacking(): boolean {
    return this.character.isAttacking();
  }

  /**
   * Sub-AC 3 of AC 60003 — read the live animation state for this
   * fighter (canonical animation key, phase, art-frame index, locked-in
   * facing). Forwarded from the wrapped {@link Character} so the
   * (later) renderer can iterate `fighters[]` and call this directly
   * each frame instead of drilling through `getCharacter()`.
   *
   * Returns the idle key (`'{characterId}.idle'`) any frame the
   * fighter is destroyed or not mid-attack.
   */
  getCurrentAnimation(): AnimationState {
    return this.character.getCurrentAnimation();
  }

  /**
   * Fire a registered attack by id. Returns `true` if the attack
   * started, `false` if it was rejected. Forwarded so the AI module
   * can drive specific moves through the entity rather than reaching
   * for `fighter.getCharacter().attemptAttack(id)`.
   */
  attemptAttack(id: string): boolean {
    if (this.destroyed) return false;
    return this.character.attemptAttack(id);
  }

  /** Look up an attack by id from the wrapped character's moveset. */
  getAttack(id: string): AttackMove | undefined {
    return this.character.getAttack(id);
  }

  // -------------------------------------------------------------------------
  // Roster spec accessors (Sub-AC 3.5 of AC 205)
  //
  // The Seed names "stats", "sprites/placeholders", and "move-set configs"
  // as the three things that define a playable character. Wolf and Cat
  // each ship a `CharacterSpec` aggregating those three pieces; we expose
  // them through the entity so any consumer that already iterates
  // `fighters[]` can read the full character definition without reaching
  // into the roster module by hand.
  // -------------------------------------------------------------------------

  /**
   * Full roster spec for this fighter's `characterId`. Always returns a
   * value because the roster lookup is exhaustive over `CharacterId`.
   * Use this when the call site needs more than one of `displayName` /
   * `tuning` / `moves` / `placeholder` — a single call beats four.
   */
  getSpec(): CharacterSpec {
    return getCharacterSpec(this.characterId);
  }

  /**
   * Human-readable name (`'Wolf'`, `'Cat'`). Drives the HUD label, the
   * results banner, the (M-future) character-select tile. Sourced from
   * the roster spec so a rename only has to land in one place.
   */
  getDisplayName(): string {
    return this.getSpec().displayName;
  }

  /**
   * Tuning record the underlying Character was constructed with.
   * Convenience shorthand for `fighter.getCharacter().getTuning()` —
   * AI scripts that ask "what's this fighter's max run speed?" don't
   * need to drill into the wrapped Character.
   */
  getTuning(): Required<CharacterTuning> {
    return this.character.getTuning();
  }

  /**
   * Frozen, ordered list of every move this character ships with. The
   * same array the underlying Character has registered via
   * `registerAttack`, in registration order. Read by AI behaviour
   * trees, the (M-future) move-list HUD, and replay debug overlays.
   */
  getMoves(): ReadonlyArray<AttackMove> {
    return this.getSpec().moves;
  }

  /**
   * Sprite / placeholder visual descriptor (primary fill colour, accent
   * stroke, label colour, body dimensions). Until the M-future asset
   * pipeline lands real sprite atlases, scenes paint each fighter as a
   * `Phaser.GameObjects.Rectangle` driven by this descriptor. Reading
   * it through the entity keeps the in-game body, the HUD label, and
   * the post-match banner colour-matched without scene-side hex
   * literals.
   */
  getPlaceholder(): CharacterPlaceholderVisual {
    return this.getSpec().placeholder;
  }

  // -------------------------------------------------------------------------
  // State queries (forwarded for entity-level convenience)
  // -------------------------------------------------------------------------

  /** Live world-space position. */
  getPosition(): { x: number; y: number } {
    return this.character.getPosition();
  }

  /** Live velocity in Matter px-per-step units. */
  getVelocity(): { x: number; y: number } {
    return this.character.getVelocity();
  }

  /** Last input-driven facing direction. 1 = right, -1 = left. */
  getFacing(): 1 | -1 {
    return this.character.getFacing();
  }

  /** True iff a platform body is currently supporting the fighter. */
  isGrounded(): boolean {
    return this.character.isGrounded();
  }

  /**
   * Jumps consumed since the last landing (Sub-AC 3.2).
   *
   * Goes from 0 (fresh on the ground) up to the Character's `maxJumps`
   * tuning value (default 2 — single + air-jump). Reset to 0 the first
   * frame the fighter is grounded with non-rising vertical velocity.
   * Exposed at the entity layer so AI scripts that iterate `fighters[]`
   * can ask "did this fighter already burn their air-jump?" without
   * reaching into `getCharacter()`.
   */
  getJumpsUsed(): number {
    return this.character.getJumpsUsed();
  }

  /**
   * Air-jumps remaining before the fighter must land to recharge
   * (Sub-AC 3.2). Equals `maxJumps - jumpsUsed`, floor-clamped at 0
   * so a defensively over-counted budget can't go negative.
   *
   * The HUD pip-renderer (later AC) and the AI's "should I burn my
   * second jump?" heuristic both read this directly.
   */
  getJumpsRemaining(): number {
    return this.character.getJumpsRemaining();
  }

  /** True iff the fighter is currently locked out by hitstun. */
  isInHitstun(): boolean {
    return this.character.isInHitstun();
  }

  /**
   * Frames of hitstun remaining; 0 when free to act.
   *
   * AC 8 — "Hitstun locks hit player in hurt state briefly". The "hurt
   * state" maps directly to `hitstunRemaining > 0` on the underlying
   * Character: while > 0 the player's input is suppressed (no walk,
   * jump, or attack), velocity damping is paused so knockback carries
   * cleanly through the air, and the timer drains exactly once per
   * `applyInput` call. Surfaced through Fighter so the HUD's hurt-state
   * indicator, the AI's "should I keep attacking?" heuristic, and the
   * replay debug overlay don't have to drill into `getCharacter()`.
   */
  getHitstunRemaining(): number {
    return this.character.getHitstunRemaining();
  }

  /** True iff the fighter is currently immune to incoming hits. */
  isInvincible(): boolean {
    return this.character.isInvincible();
  }

  /** True after `destroy()` has run. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Snapshot the entity's full runtime state for the replay system,
   * the post-match stats screen, and unit tests.
   */
  getState(): FighterStateSnapshot {
    return {
      playerIndex: this.playerIndex,
      characterId: this.characterId,
      paletteIndex: this.paletteIndex,
      stocks: this.stocks,
      stocksLost: this.stocksLost,
      kos: this.kos,
      damagePercent: this.character.getDamagePercent(),
      position: this.character.getPosition(),
      velocity: this.character.getVelocity(),
      facing: this.character.getFacing(),
      grounded: this.character.isGrounded(),
      jumpsUsed: this.character.getJumpsUsed(),
      jumpsRemaining: this.character.getJumpsRemaining(),
      inHitstun: this.character.isInHitstun(),
      invincible: this.character.isInvincible(),
      eliminated: this.stocks <= 0,
      destroyed: this.destroyed,
      shield: this.character.getShieldState(),
      isShielding: this.character.isShielding(),
      isShieldBroken: this.character.isShieldBroken(),
      dodge: this.character.getDodgeState(),
      isDodging: this.character.isDodging(),
      isDodgeInvincible: this.character.isDodgeInvincible(),
    };
  }

  // -------------------------------------------------------------------------
  // Shield queries (AC 60301 Sub-AC 1)
  //
  // Forwarded from the wrapped Character so the HUD shield-bar
  // renderer, the AI's "is this opponent blocking?" heuristic, and the
  // replay-snapshot system can iterate `fighters[]` without drilling
  // into `getCharacter()`.
  // -------------------------------------------------------------------------

  /** Read-only snapshot of the live shield state machine. */
  getShieldState(): ShieldState {
    return this.character.getShieldState();
  }

  /** Current shield health (0 while broken). */
  getShieldHealth(): number {
    return this.character.getShieldHealth();
  }

  /** True iff the shield is currently raised. */
  isShielding(): boolean {
    return this.character.isShielding();
  }

  /** True iff the shield is currently in shield-break stun. */
  isShieldBroken(): boolean {
    return this.character.isShieldBroken();
  }

  /** Frames remaining in the shield-break stun lockout (0 outside it). */
  getShieldStunRemaining(): number {
    return this.character.getShieldStunRemaining();
  }

  // -------------------------------------------------------------------------
  // Dodge queries (AC 60302 Sub-AC 2)
  //
  // Forwarded from the wrapped Character so the HUD i-frame indicator,
  // the AI's "is this opponent dodging?" heuristic, and the replay-
  // snapshot system can iterate `fighters[]` without drilling into
  // `getCharacter()`.
  // -------------------------------------------------------------------------

  /** Read-only snapshot of the live dodge state machine. */
  getDodgeState(): DodgeState {
    return this.character.getDodgeState();
  }

  /** True iff the fighter is currently mid-dodge (active or recovery phase). */
  isDodging(): boolean {
    return this.character.isDodging();
  }

  /** True iff the dodge i-frame window is currently open. */
  isDodgeInvincible(): boolean {
    return this.character.isDodgeInvincible();
  }

  /** Frames of dodge i-frames remaining (0 outside the active phase). */
  getDodgeIframesRemaining(): number {
    return this.character.getDodgeIframesRemaining();
  }

  /** Frames of dodge cooldown remaining (0 outside the cooldown phase). */
  getDodgeCooldownRemaining(): number {
    return this.character.getDodgeCooldownRemaining();
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * Release the Matter body and detach all listeners. Idempotent —
   * call sites that defensively destroy on scene shutdown can do so
   * without checking first.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.character.destroy();
  }
}
