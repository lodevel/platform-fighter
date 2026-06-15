/**
 * Sub-AC 2 of AC 60002 — hitbox→character damage resolver.
 *
 * `HitboxDamageHandler` is a thin Matter.js collision-event adapter
 * that sits between the world's `collisionstart` stream and each
 * fighter's `Character.applyHit`. Its only job is "tell me when an
 * attack hitbox sensor connects with a registered character, and
 * which player got hit, with what hit info."
 *
 * Why a separate class (and not, say, a closure inside MatchScene):
 *
 *   • Mirrors the {@link BlastZoneWatcher} architecture — every
 *     collision-derived match event has its own Phaser-free, pure-data
 *     adapter so the scene update loop stays readable, the unit tests
 *     stay Node-only, and the (later) replay-recorder can hook the
 *     same callback.
 *
 *   • Keeps the per-pair identity check (`is bodyA the hitbox? is
 *     bodyB a registered character body? are they on the same team?`)
 *     out of `Character` and `MatchScene`. Both classes care about
 *     "this player took a hit"; neither needs to know about Matter
 *     pair shapes.
 *
 *   • Lets us lock down the contract under deterministic Node tests:
 *     given this exact pair stream, the handler fires exactly N hit
 *     events, in this order, with these exact `HitInfo` payloads.
 *     That's the property the replay system relies on.
 *
 * Design notes:
 *
 *   • A hitbox body is identified by `label === HITBOX_LABEL`
 *     ('hitbox.attack') and carries a `plugin: HitboxPlugin` payload
 *     stamped at spawn time by {@link spawnHitbox}. The plugin holds
 *     the attacker's character id, the move id, the damage value, the
 *     base knockback vector, and the attacker's facing — i.e. every
 *     field needed to construct a `HitInfo` for `Character.applyHit`.
 *
 *   • Self-hit suppression: if the hitbox's `plugin.ownerId` matches
 *     the registered character id of the body it just touched, we
 *     skip the event. A fighter can never KO themselves with their
 *     own swing.
 *
 *   • Per-event de-duplication: a single Matter collision event can
 *     deliver the same `(hitbox, character)` overlap as multiple
 *     pairs in pathological cases (compound bodies, overlapping
 *     parts). We dedup by `(hitboxBody, targetIndex)` so a single
 *     overlap fires `applyHit` exactly once per event.
 *
 *   • Across-event semantics — AC 60103 Sub-AC 3 "hit confirmation
 *     and cleanup": within the lifetime of a single hitbox sensor
 *     body, each registered character can be hit AT MOST ONCE. This
 *     enforces the canonical Smash-style "one hit per move per
 *     target per swing" rule deterministically.
 *
 *     In practice, Matter fires `collisionstart` once per first-
 *     contact between two bodies, so for most attacks a per-event
 *     dedup is all that ever fires. But a target who is knocked away
 *     by the first contact and then re-enters the still-active
 *     hitbox (e.g. a multi-frame side-special whose travel carries
 *     the attacker back into the launched target) WILL produce a
 *     second `collisionstart` event for the same
 *     `(hitboxBody, targetBody)` pair. Without per-lifetime dedup,
 *     that second event would re-trigger damage / knockback /
 *     hitstun, double-hitting from one swing.
 *
 *     The dedup state lives in {@link confirmedHits} — a `WeakMap`
 *     keyed on the hitbox body so the entry is reclaimed
 *     automatically when Matter releases the body after
 *     `world.remove`. The owning attacker may also call
 *     {@link forgetHitbox} explicitly when it despawns the hitbox at
 *     the end of the active phase, giving us deterministic cleanup
 *     independent of GC timing — useful for replay-resync
 *     determinism and tests with synthetic body fixtures.
 *
 *   • Re-entrant safe — a callback that mutates the registry (e.g.
 *     "this hit just KO'd them, unregister") is allowed; the loop
 *     reads the registry per-pair, not in a snapshot.
 *
 * Determinism: every output is a pure function of (registry,
 * pair stream, hitbox plugin payloads). No `Math.random()`, no
 * wall-clock reads. Replays driving identical pair streams produce
 * byte-identical hit callbacks in identical order.
 */

import type { HitInfo } from '../characters/combat';
import type { HitboxPlugin } from '../characters/attacks';
import { CHARACTER_LABEL } from '../characters/Character';
import { HITBOX_LABEL } from '../characters/attacks';
import {
  type Hurtbox,
  isAllHurtboxesIntangible,
  resolveHurtboxDamageMultiplier,
} from '../characters/moveSchema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Plugin shape we expect on a registered character body. Mirrors the
 * `plugin: { characterId }` stamped by `Character`'s constructor —
 * we only read `characterId` (used to suppress self-hits).
 */
export interface CharacterBodyPlugin {
  readonly characterId?: string;
}

/**
 * Minimal shape of a body the handler needs to inspect. Both hitbox
 * sensors and character bodies expose `label` (for kind detection)
 * and `plugin` (for owner / character id lookup).
 */
export interface HitboxOrCharacterBody {
  readonly label?: string | null;
  /**
   * Matter assigns each body a unique numeric id at construction.
   * Used by self-hit suppression to identify "same instance" without
   * holding a body reference on the hitbox plugin (which would
   * stack-overflow Matter's `Common.extend` deep-clone).
   */
  readonly id?: number;
  readonly plugin?:
    | HitboxPlugin
    | CharacterBodyPlugin
    | Record<string, unknown>
    | null;
}

/** Shape of a Matter collision pair we care about. */
export interface HitboxPair {
  readonly bodyA: HitboxOrCharacterBody | null | undefined;
  readonly bodyB: HitboxOrCharacterBody | null | undefined;
}

export interface HitboxCollisionEvent {
  readonly pairs: ReadonlyArray<HitboxPair>;
}

/**
 * Context passed alongside every hit so the callback can:
 *   • Suppress hits from a specific attacker (e.g. spectator-mode
 *     debugging).
 *   • Log per-move statistics in the (later AC) HUD.
 *   • Attribute KOs to the right player for "WOLF KOs CAT" banners.
 */
export interface HitContext {
  /** Character id of the attacker that owns the hitbox. */
  readonly attackerOwnerId: string;
  /** Move id from the attacker's moveset that spawned the hitbox. */
  readonly moveId: string;
  /**
   * What kind of hitbox connected. Discriminates regular damage
   * hitboxes from grab range-sensors so the scene can route the
   * contact to the right resolver:
   *
   *   • `'attack'` — apply damage / knockback / hitstun via
   *     `Character.applyHit` (the canonical path).
   *   • `'grab'`   — call `grabber.resolveGrabConnect(target)` so
   *     both fighters transition into the grabber-holding /
   *     target-grabbed pair. No immediate damage; the throw release
   *     fires the launch later.
   *
   * Defaults to `'attack'` when the underlying plugin omits `kind`,
   * so the existing damage path keeps working unchanged.
   */
  readonly kind: 'attack' | 'grab';
}

/**
 * Callback fired when a hitbox sensor connects with a registered
 * character body. The scene wires this to:
 *
 *   (targetIndex, hit) => playerSlots[targetIndex].character.applyHit(hit)
 *
 * but tests can hook arbitrary loggers / spies to assert event shape
 * and ordering.
 */
export type HitConnectCallback = (
  targetIndex: number,
  hit: HitInfo,
  context: HitContext,
) => void;

/**
 * Sub-AC 2 of AC 10002 — per-target hurtbox lookup.
 *
 * Resolves the live hurtbox set the target is exposing this frame.
 * Wired by `MatchScene` to `playerSlots[targetIndex].character.getActiveHurtboxes()`
 * so the damage handler can apply the per-move hurtbox modifiers
 * declared on the move data:
 *
 *   • Every active hurtbox `intangible` → drop the hit entirely
 *     (no damage / knockback / hitstun, no confirmation registered
 *     so the same swing can still connect with the same target after
 *     the intangible window closes).
 *   • Any active hurtbox carries a `damageMultiplier` ≠ 1 → scale
 *     `hit.damage` by the resolved multiplier (max across the
 *     tangible set; see `resolveHurtboxDamageMultiplier`) before
 *     dispatch. The knockback vector is left unscaled — Smash-canonical
 *     damage scaling owns that math via `combat.computeKnockback`.
 *
 * Returning `null` (the default for unregistered slots) is treated as
 * "no hurtbox info available — fire the hit unmodified" so tests and
 * legacy call sites that don't wire a lookup keep working.
 */
export type HurtboxLookup = (targetIndex: number) => ReadonlyArray<Hurtbox> | null;

/**
 * Optional friendly-fire predicate. When set, the handler calls this
 * with `(attackerOwnerId, targetIndex)` BEFORE applying damage.
 * Returning `false` drops the hit (no damage / knockback / hitstun
 * fired, no confirmation registered so the same swing can still
 * connect with the same target if relations change later — e.g.
 * the summoner KOs and the creature becomes neutral). Returning
 * `true` falls through to the standard damage path.
 *
 * Used by the post-M2 creature subsystem so a summoner's own
 * creature can't damage them, mirroring the in-data
 * `actors/Actor.ts:canDamage` predicate. Free-for-all matches
 * leave this unset and the handler behaves identically to the
 * pre-M6.7 path.
 */
export type FriendlyFirePredicate = (
  attackerOwnerId: string,
  targetIndex: number,
) => boolean;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Stateless-ish collision adapter. Owns nothing but a registry of
 * `(playerIndex → body)` pairs and a hit callback. The scene
 * subscribes the handler's `handleCollisionStart` to Matter's
 * `collisionstart` stream and registers each player's body up-front.
 *
 * Lifecycle (mirrors {@link BlastZoneWatcher}):
 *
 *   const handler = new HitboxDamageHandler((targetIndex, hit) => {
 *     playerSlots[targetIndex].character.applyHit(hit);
 *   });
 *   handler.registerPlayer(0, p1.body);
 *   handler.registerPlayer(1, p2.body);
 *   scene.matter.world.on('collisionstart', e => handler.handleCollisionStart(e));
 *   // ...later:
 *   handler.unregisterPlayer(0); // when a player is eliminated
 */
export class HitboxDamageHandler {
  private readonly players: Map<number, HitboxOrCharacterBody> = new Map();
  private readonly bodyToIndex: Map<HitboxOrCharacterBody, number> = new Map();
  private readonly callback: HitConnectCallback;

  /**
   * Sub-AC 2 of AC 10002 — optional per-target hurtbox lookup. When
   * unset (the default), every confirmed hit fires unmodified —
   * matches the pre-Sub-AC-2 behaviour and keeps every existing test
   * fixture working without a code change.
   *
   * Wired by `MatchScene` to query each fighter's
   * `Character.getActiveHurtboxes()` so the damage handler can apply
   * intangible / damage-multiplier modifiers from the move data.
   */
  private hurtboxLookup: HurtboxLookup | null = null;

  /**
   * Optional friendly-fire predicate (post-M6.7). Default `null` —
   * the handler skips the check and behaves identically to the
   * pre-M6.7 path. Set by `MatchScene` once the creature subsystem
   * is wired so a creature's hitbox can't damage its summoner.
   */
  private friendlyFirePredicate: FriendlyFirePredicate | null = null;

  /**
   * AC 60103 Sub-AC 3 — per-hitbox-lifetime confirmed-hit registry.
   *
   * Keyed on the hitbox body object identity. The value is the set of
   * `targetIndex`es that this specific hitbox sensor has already
   * connected with at least once during its current active phase. A
   * pair whose `(hitboxBody, targetIndex)` tuple already appears in
   * this registry is silently dropped before the callback fires, so
   * the same swing never double-hits the same target.
   *
   * `WeakMap` semantics:
   *   • Entries are auto-reclaimed when the hitbox body is GC'd —
   *     i.e. after `despawnHitbox` releases the body and the attacker
   *     drops its `ActiveAttack.hitboxBody` reference.
   *   • For deterministic cleanup (replay-resync, test fixtures), the
   *     attacker can call {@link forgetHitbox} explicitly when it
   *     despawns the body — see `Character.tickAttack`.
   *   • {@link reset} purges the entire registry by replacing the
   *     map (the previous WeakMap is itself GC'd).
   */
  private confirmedHits: WeakMap<HitboxOrCharacterBody, Set<number>> =
    new WeakMap();

  constructor(callback: HitConnectCallback) {
    this.callback = callback;
  }

  /**
   * Register a player's body for hit-resolution. Re-registering the
   * same playerIndex replaces the previous body (used by the
   * post-M2 "swap fighter mid-match" feature).
   */
  registerPlayer(playerIndex: number, body: HitboxOrCharacterBody): void {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error(
        `HitboxDamageHandler: invalid playerIndex ${playerIndex}`,
      );
    }
    const existing = this.players.get(playerIndex);
    if (existing) this.bodyToIndex.delete(existing);
    this.players.set(playerIndex, body);
    this.bodyToIndex.set(body, playerIndex);
  }

  /**
   * Stop watching `playerIndex`. Used when a player is eliminated and
   * their body is hidden — we don't want a stray collision event for
   * a despawned body to fire a phantom hit.
   */
  unregisterPlayer(playerIndex: number): void {
    const body = this.players.get(playerIndex);
    if (body) this.bodyToIndex.delete(body);
    this.players.delete(playerIndex);
  }

  /** True iff `playerIndex` is currently registered. */
  isRegistered(playerIndex: number): boolean {
    return this.players.has(playerIndex);
  }

  /**
   * Drop every registered player. Used on scene shutdown / replay
   * rewind so the next match starts from a clean slate.
   *
   * Also purges the per-hitbox confirmed-hit registry. Replacing the
   * WeakMap (rather than iterating + deleting — WeakMap doesn't
   * expose iteration) is the canonical way to clear all entries; the
   * previous map is itself GC'd along with its cached body refs.
   *
   * The hurtbox lookup is preserved across resets — it's a wire-up
   * to the `MatchScene` registry, not match state. A scene swap that
   * needs to drop the lookup should call {@link setHurtboxLookup}(null)
   * explicitly.
   */
  reset(): void {
    this.players.clear();
    this.bodyToIndex.clear();
    this.confirmedHits = new WeakMap();
  }

  /**
   * Sub-AC 2 of AC 10002 — install (or remove) the per-target hurtbox
   * lookup. The handler queries this each candidate hit BEFORE
   * dispatching the callback to apply per-move hurtbox modifiers
   * (intangible windows / damage multipliers).
   *
   * Pass `null` to clear — the handler reverts to "fire the hit
   * unmodified" mode. Idempotent: calling with the same function twice
   * is a silent no-op replacement.
   *
   * Why a setter (rather than a constructor argument): the lookup wires
   * to `Character.getActiveHurtboxes()`, but the handler is constructed
   * before the player slots are registered. Late-binding the lookup
   * mirrors how {@link registerPlayer} is called after construction.
   */
  setHurtboxLookup(lookup: HurtboxLookup | null): void {
    this.hurtboxLookup = lookup;
  }

  /**
   * Install / clear the friendly-fire predicate. When set, every
   * incoming hit calls
   * `predicate(plugin.ownerId, targetIndex)` BEFORE the
   * confirmation registry update + the damage callback. A `false`
   * return drops the hit silently — no confirmation is recorded
   * (so the same swing can re-fire later if relations change), no
   * callback dispatch, no audit log entry. The (later) creature
   * subsystem wires this to the `actors/Actor.ts:canDamage`
   * predicate so a summoner's own creature can't damage them.
   *
   * Pass `null` to clear (default behaviour: every hit fires).
   */
  setFriendlyFirePredicate(predicate: FriendlyFirePredicate | null): void {
    this.friendlyFirePredicate = predicate;
  }

  /**
   * AC 60103 Sub-AC 3 — clean up the per-lifetime confirmed-hit set
   * for a hitbox body that has just been despawned. Called by the
   * attacker (`Character.tickAttack`) on the active → recovery
   * transition and by `cancelAttack` / `destroy`, so the next time
   * this body's slot in the WeakMap is consulted it starts empty.
   *
   * Idempotent: calling on a body the handler has never seen, or
   * twice in a row, is a silent no-op. The WeakMap also reclaims the
   * entry naturally once Matter releases the body — this method is
   * the deterministic-cleanup escape hatch for callers that need a
   * predictable post-despawn state (replay snapshots, scene rewinds,
   * unit tests with synthetic bodies that won't be GC'd).
   *
   * Why explicit cleanup AND a WeakMap: the WeakMap covers the
   * normal gameplay path (Matter GCs despawned bodies on its own
   * schedule, and the next attack creates a fresh body anyway, so
   * stale entries can't cause cross-swing bleed). The explicit hook
   * covers the determinism-sensitive paths where two different code
   * paths might inspect the registry at well-defined moments and the
   * GC schedule isn't a trustworthy synchronisation point.
   */
  forgetHitbox(body: HitboxOrCharacterBody | null | undefined): void {
    if (!body) return;
    this.confirmedHits.delete(body);
  }

  /**
   * Handle a Matter `collisionstart` event. For every pair where one
   * body is an attack hitbox sensor and the other is a registered
   * character (and the two are not on the same fighter), fire the
   * hit callback exactly once per `(hitboxBody, targetIndex)` pair.
   *
   * Filters applied, in order:
   *
   *   1. Drop pairs with null bodies (defensive — Matter can hand us
   *      these in pathological test fixtures).
   *   2. Drop pairs where both or neither body is a hitbox (non-hit
   *      collisions: character-platform, hitbox-hitbox).
   *   3. Drop pairs where the non-hitbox is not a registered
   *      character body (hitbox-platform, hitbox-blastZone — we
   *      don't care about those at this layer).
   *   4. Drop pairs where the hitbox plugin is missing or malformed
   *      (defensive — every spawnHitbox-built body has a plugin, but
   *      a synthetic body in a test fixture may not).
   *   5. Drop self-hits (hitbox owner === target's character id).
   *   6. Per-event dedup by `(hitboxBody, targetIndex)`.
   */
  handleCollisionStart(event: HitboxCollisionEvent): void {
    if (!event || !event.pairs || event.pairs.length === 0) return;

    // Per-event dedup: keyed on the (hitboxBody object identity,
    // targetIndex) tuple so the same hitbox can hit two different
    // characters in one event (an AoE move) but the same hitbox
    // can't hit the same character twice in one event.
    const fired = new Set<string>();

    for (const pair of event.pairs) {
      const a = pair.bodyA ?? null;
      const b = pair.bodyB ?? null;
      if (!a || !b) continue;

      const aIsHitbox = a.label === HITBOX_LABEL;
      const bIsHitbox = b.label === HITBOX_LABEL;
      // Both-hitbox or neither-hitbox: skip. Sensors filter each
      // other out via collision masks, so both-hitbox is impossible
      // in real gameplay; both-character / both-platform / mixed-
      // non-hitbox pairs are not our concern.
      if (aIsHitbox === bIsHitbox) continue;

      const hitboxBody = aIsHitbox ? a : b;
      const otherBody = aIsHitbox ? b : a;

      // Other body must be a registered character. We tolerate
      // hitbox-platform and hitbox-blastZone collisions (Matter masks
      // *should* prevent them, but we don't error if they slip
      // through).
      const targetIndex = this.bodyToIndex.get(otherBody);
      if (targetIndex === undefined) continue;
      // Defensive: if the registered body somehow lost its character
      // label (should never happen — the label is set at construction
      // and Matter doesn't mutate it), treat the pair as suspect and
      // skip rather than apply damage to the wrong body.
      if (otherBody.label !== CHARACTER_LABEL) continue;

      // Read the hitbox plugin payload. Type-narrow via the known
      // `ownerId` field — `HitboxPlugin` is the only plugin shape
      // that has it on a hitbox-labelled body.
      const plugin = (hitboxBody.plugin ?? null) as HitboxPlugin | null;
      if (!plugin || typeof plugin.ownerId !== 'string') continue;

      // Self-hit suppression — a fighter cannot damage themselves.
      // Compare the attacker's Matter BODY ID (each body has a unique
      // numeric id) to the target body's id, not the character id,
      // so two players using the same character (Wolf P1 vs Wolf P2)
      // still hit each other. Falls back to character-id equality
      // when `ownerBodyId` is missing (unit tests building synthetic
      // plugins without a body — preserves the legacy behaviour).
      if (typeof plugin.ownerBodyId === 'number') {
        if (plugin.ownerBodyId === otherBody.id) continue;
      } else {
        const targetPlugin = (otherBody.plugin ?? null) as
          | CharacterBodyPlugin
          | null;
        if (
          targetPlugin &&
          typeof targetPlugin.characterId === 'string' &&
          targetPlugin.characterId === plugin.ownerId
        ) {
          continue;
        }
      }

      // Per-event dedup. Use object-identity for the hitbox body so
      // multiple character bodies (a future "compound hurtbox" model)
      // hit by the same swing each take damage — but the same single
      // hurtbox body never takes damage twice from one swing in one
      // event.
      const dedupKey = makeDedupKey(hitboxBody, targetIndex);
      if (fired.has(dedupKey)) continue;
      fired.add(dedupKey);

      // AC 60103 Sub-AC 3 — per-lifetime hit confirmation. If THIS
      // hitbox body has already connected with this target during its
      // active phase, drop the pair. Together with the per-event
      // dedup above this enforces "one hit per move per target per
      // swing", regardless of whether duplicate Matter events would
      // otherwise re-trigger the same connect.
      let confirmed = this.confirmedHits.get(hitboxBody);
      if (confirmed && confirmed.has(targetIndex)) continue;

      // Sub-AC 2 of AC 10002 — consult the per-target hurtbox set
      // BEFORE dispatching. The lookup is optional (null → unmodified
      // dispatch, matches the pre-Sub-AC-2 contract); when present,
      // it lets the move data's `hurtboxModifiers` declarations
      // affect the live hit:
      //
      //   • Every active hurtbox intangible → drop the hit silently
      //     and DO NOT mark the pair as confirmed. The intangible
      //     window (dodge i-frames, super-armour, ledge i-frames
      //     declared as a per-move modifier) protects against this
      //     swing's contact this frame; the next event after the
      //     window closes is free to land normally.
      //
      //   • Tangible set with a damageMultiplier > 1 → scale
      //     `hit.damage` by the resolved multiplier (max across the
      //     tangible set). Knockback is left unscaled — the
      //     `combat.computeKnockback` percent-scaling owns that math
      //     and is fed the post-multiplier damage value transitively
      //     via `Character.applyHit`'s "add damage first, scale
      //     knockback against new percent" sequence.
      //
      // A target slot with no registered lookup (or one returning
      // null / empty) keeps the legacy unmodified dispatch path so
      // every existing test fixture still works.
      let damage = plugin.damage;
      if (this.hurtboxLookup !== null) {
        const set = this.hurtboxLookup(targetIndex);
        if (set !== null && set.length > 0) {
          if (isAllHurtboxesIntangible(set)) {
            // Drop the hit. Confirmation is NOT registered — the same
            // swing remains free to connect with this target after the
            // intangible window closes (the canonical "dodge through
            // a multi-active-frame swing then get caught on the
            // recovery overlap" outcome).
            continue;
          }
          const mult = resolveHurtboxDamageMultiplier(set);
          if (mult !== 1) {
            damage = damage * mult;
          }
        }
      }

      // Build the canonical HitInfo from the hitbox's plugin payload
      // and dispatch. The plugin already carries everything `applyHit`
      // needs.
      const hit: HitInfo = {
        damage,
        knockback: plugin.knockback,
        facing: plugin.facing,
        ...(plugin.unblockable ? { unblockable: true } : {}),
      };
      const context: HitContext = {
        attackerOwnerId: plugin.ownerId,
        moveId: plugin.moveId,
        kind: plugin.kind === 'grab' ? 'grab' : 'attack',
      };
      // Friendly-fire gate (post-M6.7) — when wired, drop hits
      // where the attacker and target share an owner relation
      // (e.g. summoner → their own creature). Skips both the
      // damage callback AND the confirmation-registry update so
      // the swing can still connect with a different target later
      // in the same active phase.
      if (
        this.friendlyFirePredicate !== null &&
        !this.friendlyFirePredicate(plugin.ownerId, targetIndex)
      ) {
        continue;
      }
      this.callback(targetIndex, hit, context);

      // Mark the connect as confirmed AFTER the callback — so a
      // throwing callback doesn't poison the registry with a
      // half-applied hit (the next event would still get the
      // chance to fire). On a re-entrant callback that re-enters
      // `handleCollisionStart`, the confirmation is already in the
      // map by the time the inner call's read happens, because the
      // OUTER read happened before the callback.
      if (!confirmed) {
        confirmed = new Set<number>();
        this.confirmedHits.set(hitboxBody, confirmed);
      }
      confirmed.add(targetIndex);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stable per-event dedup key. We can't use the body object itself as
 * a Map key (Set lookup is O(1) on string keys but on object keys
 * requires a Map — fine, but stringifying is more debug-friendly when
 * inspecting fired sets). The `WeakMap` trick of mapping bodies to
 * stable string ids would help if dedup were across events, but
 * since dedup is per-event we just use a counter local to the event
 * via an ad-hoc object→id Map.
 *
 * Implementation: leverage a per-call WeakMap-less identity by using
 * a synthetic id derived from a Map populated per call. Simpler:
 * stringify the hitbox body's identity by appending the targetIndex
 * — body objects in Matter all have a numeric `id` field. If absent
 * (test fixtures), we fall back to object reference comparison which
 * the dedup `Set` of objects could handle via a parallel `Map<object,
 * Set<number>>`. We implement the Map approach inline in the loop
 * to avoid an extra closure allocation.
 *
 * For simplicity we accept that test fixtures construct bodies as
 * plain objects without an `id`; the per-event dedup uses object
 * identity via a plain `Set` of `(body, index)` 2-tuples represented
 * as strings.
 */
function makeDedupKey(
  hitboxBody: HitboxOrCharacterBody,
  targetIndex: number,
): string {
  const id = (hitboxBody as { id?: number }).id;
  if (typeof id === 'number') {
    return `${id}#${targetIndex}`;
  }
  // Fallback: assign an ephemeral id keyed on the object reference.
  // We use a WeakMap so the assigned ids don't outlive the bodies.
  let ephemeral = ephemeralIds.get(hitboxBody);
  if (ephemeral === undefined) {
    ephemeral = nextEphemeralId++;
    ephemeralIds.set(hitboxBody, ephemeral);
  }
  return `e${ephemeral}#${targetIndex}`;
}

const ephemeralIds = new WeakMap<HitboxOrCharacterBody, number>();
let nextEphemeralId = 1;
