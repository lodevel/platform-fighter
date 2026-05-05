/**
 * Item lifecycle states + transitions — T3 items framework, AC 16
 * Sub-AC 1 ("broken-item state transition that drops the item inert
 * with a broken visual/sprite swap and disables pickup interactions").
 *
 * Headline contract
 * =================
 *
 * Every spawnable item the framework manages has exactly one runtime
 * state at a time, drawn from {@link ItemLifecycleState}. The state
 * is the single source of truth for three orthogonal concerns:
 *
 *   1. Pickup eligibility — can a fighter currently grab this item?
 *      ({@link canBePickedUp})
 *   2. Carrier presence — is the item currently attached to a holder,
 *      or is it a free body in the world? ({@link isHeld})
 *   3. Visual presentation — what sprite/atlas key should the renderer
 *      use, and at what alpha? ({@link computeItemVisualHints})
 *
 * Sub-AC 1's specific job is the **broken** transition: a held or
 * grounded item whose durability hits zero must:
 *
 *   • detach from its holder (if held) and drop inert at the holder's
 *     last known position,
 *   • flip to a broken sprite variant so players can read at-a-glance
 *     that the weapon is spent,
 *   • reject any subsequent pickup attempt — the item is debris until
 *     a later sub-AC's despawn timer reclaims it.
 *
 * Open-closed extensibility (Seed exit condition `extensibility_invariant`)
 * --------------------------------------------------------------------
 *
 * This module is intentionally Phaser-free, item-type-agnostic, and
 * holds no per-item-category branching. A future Bat / RayGun / Bomb
 * subclass file calls {@link transitionToBroken} with its own runtime
 * state record; the lifecycle module does not need to know the
 * category. Adding a hypothetical 4th item type therefore requires
 * zero edits to this file — satisfying the Seed's
 * "framework_extensibility" evaluation principle.
 *
 * Determinism (Seed exit condition `determinism_intact`)
 * ------------------------------------------------------
 *
 * Every transition function is a pure function of its inputs. No
 * `Math.random()`, no wall-clock reads, no Phaser side-effects. Two
 * simulations driven through identical fixed-step inputs produce
 * identical lifecycle states tick-for-tick — a hard requirement for
 * the M4 hybrid replay system.
 *
 * Why a pure module (rather than a method on an `Item` class)
 * ----------------------------------------------------------
 *
 *   • Tests can pin every (current state, transition) → next state
 *     triplet without instantiating Phaser, Matter, or even an item
 *     instance.
 *   • The replay scrubber and the AI debug overlay can compute a
 *     hypothetical "what would this item look like after the next
 *     hit?" without mutating live state.
 *   • Future TTL-despawn (Sub-AC 2 of AC 16) layers on top of this
 *     module by reading {@link ItemLifecycleSnapshot.brokenAtFrame}
 *     and comparing against the current frame — no entity-class
 *     coupling.
 */

// ---------------------------------------------------------------------------
// Lifecycle state enum
// ---------------------------------------------------------------------------

/**
 * The five canonical runtime states a framework-managed item can be in.
 *
 * Allowed transitions (the only ones any caller may legally request):
 *
 *   `falling`   →   `grounded` | `despawned`
 *   `grounded`  →   `held`     | `broken`   | `despawned`
 *   `held`      →   `grounded` | `broken`   | `despawned`
 *   `broken`    →                              `despawned`
 *   `despawned` →   (terminal)
 *
 *   • `falling`   — item just spawned, falling from the drop-in point
 *                   toward its anchor. Not pickable yet (a player who
 *                   could grab a still-falling item would shortcut the
 *                   "watch it fall" beat the spawn manager pays for —
 *                   see ITEM_SPAWN_DROP_HEIGHT_PX rationale).
 *   • `grounded`  — settled on a platform, free to be picked up. The
 *                   default state for a freshly-spawned item once the
 *                   drop animation finishes, and the state items return
 *                   to when dropped (intact) by a holder.
 *   • `held`      — currently attached to a fighter's inventory slot.
 *                   Not pickable (single-slot inventory invariant);
 *                   the holder's jab routes to the item's slot override.
 *   • `broken`    — durability spent. Detached from any holder, dropped
 *                   inert at last known position, **rejecting all
 *                   pickup interactions** (Sub-AC 1's headline rule),
 *                   and rendered with the broken sprite variant. A
 *                   later sub-AC's despawn timer reclaims the entity
 *                   after a short on-screen window so the breakage
 *                   reads.
 *   • `despawned` — terminal state. Entity has been fully reclaimed
 *                   (TTL elapsed, broken-debris timer elapsed, or the
 *                   match ended). Renderer should not draw it; the
 *                   spawn manager's active-item count drops by one.
 *                   Once a state hits `despawned` no further transition
 *                   is legal — callers must instantiate a fresh item.
 */
export type ItemLifecycleState =
  | 'falling'
  | 'grounded'
  | 'held'
  | 'broken'
  | 'despawned';

/**
 * The full set of states, exported as a frozen tuple so menu UI,
 * tests, and a future debug HUD can iterate the canonical list
 * without hard-coding string literals at every call site.
 */
export const ITEM_LIFECYCLE_STATES: ReadonlyArray<ItemLifecycleState> =
  Object.freeze(['falling', 'grounded', 'held', 'broken', 'despawned']);

// ---------------------------------------------------------------------------
// Snapshot type — minimal lifecycle-relevant state for an item
// ---------------------------------------------------------------------------

/**
 * The lifecycle-relevant slice of an item's runtime state. Per-item-
 * category data (durability counter for the Bat, ammo for the Ray Gun,
 * fuse timer for the Bomb) lives on the concrete item subclass — this
 * snapshot is intentionally just the minimum the framework needs to
 * compute pickup eligibility, attachment, visuals, and despawn timers.
 *
 * Plain JSON-safe data so the M4 hybrid replay snapshot system can
 * persist it verbatim alongside the rest of the per-item state.
 */
export interface ItemLifecycleSnapshot {
  /** Current lifecycle state. */
  readonly state: ItemLifecycleState;
  /**
   * Index (in the {@link MatchConfig.players} array) of the fighter
   * currently holding this item, or `null` for any non-`held` state.
   * The lifecycle module does NOT validate that a `null` holder
   * always means "not held" — callers are expected to honour the
   * invariant; the module enforces it on outgoing snapshots only.
   */
  readonly holderPlayerIndex: number | null;
  /**
   * The world-space position the item currently lives at. For `held`
   * items this is the holder's hand position; for any other state it
   * is the item's free-body position. Stored here (rather than only on
   * the Matter body) so replay scrubbing and AI debug overlays can
   * read item positions without booting Matter.
   */
  readonly position: { readonly x: number; readonly y: number };
  /**
   * Frame the item entered its **current** state, captured by the
   * lifecycle-transition helpers. Drives despawn-timer comparisons
   * (Sub-AC 2 of AC 16 reads `brokenAtFrame = stateEnteredFrame` for
   * the broken-debris reclaim window; the `falling` → `grounded`
   * settle test reads it identically). `null` only at construction
   * time before the first `step()` has run; the public transition
   * helpers always populate it.
   */
  readonly stateEnteredFrame: number | null;
}

// ---------------------------------------------------------------------------
// Visual hints — how the renderer should present each state
// ---------------------------------------------------------------------------

/**
 * Visual presentation contract emitted by
 * {@link computeItemVisualHints}. The Phaser-side item renderer reads
 * these fields and applies them to its sprite GameObject — keeping
 * the lifecycle → visual mapping in a pure function lets tests pin
 * every state's appearance without booting Phaser.
 *
 *   - `visible`     : whether the GameObject should render at all.
 *                     False only for `despawned`.
 *   - `alpha`       : opacity in [0, 1]. Reduced on `broken` so the
 *                     debris reads as "spent" without going
 *                     fully transparent (the player still needs to
 *                     see the silhouette to step around it).
 *   - `useBrokenSprite`
 *                   : true iff the renderer should swap to the item
 *                     subclass's broken sprite variant. Sub-AC 1's
 *                     headline visual signal — flips on the moment
 *                     {@link transitionToBroken} runs and stays on
 *                     until the entity despawns. Item subclasses
 *                     declare a broken-sprite atlas key alongside
 *                     their normal sprite key; the renderer picks
 *                     between them based on this flag, keeping the
 *                     framework category-agnostic.
 *   - `pickupHighlight`
 *                   : true iff the item is currently pickable AND a
 *                     fighter is within pickup range. The lifecycle
 *                     layer only contributes the "currently pickable"
 *                     half (see {@link canBePickedUp}); the spatial
 *                     "within range" half is the pickup module's job.
 *                     Exposed as a hint so the visual layer can
 *                     telegraph "press jab to grab" without re-querying
 *                     the lifecycle state.
 */
export interface ItemVisualHints {
  readonly visible: boolean;
  readonly alpha: number;
  readonly useBrokenSprite: boolean;
  readonly pickupEligible: boolean;
}

/**
 * Default alpha applied to a `broken` item before it despawns. Tuned
 * so the debris reads as visibly spent (player can scan the stage and
 * tell "that's broken, don't bother") without going so faint that a
 * fighter trips over it.
 *
 * Exposed so tests, the debug HUD, and a future "broken item flicker"
 * polish pass can reference the same value rather than hard-coding
 * the magic number.
 */
export const ITEM_BROKEN_ALPHA = 0.55 as const;

// ---------------------------------------------------------------------------
// Eligibility predicates
// ---------------------------------------------------------------------------

/**
 * `true` iff a fighter passing within pickup range may currently grab
 * this item. Headline rule for AC 11 (pickup) and Sub-AC 1 of AC 16
 * (broken items reject pickup):
 *
 *   • `grounded` is the only pickable state. `falling` items are
 *     mid-drop animation (the player should see them land first);
 *     `held` items are already in someone's inventory; `broken` items
 *     are debris (Sub-AC 1's headline rule); `despawned` items are
 *     gone.
 */
export function canBePickedUp(snapshot: ItemLifecycleSnapshot): boolean {
  return snapshot.state === 'grounded';
}

/**
 * `true` iff the item is currently attached to a fighter's inventory
 * slot. Exported so the pickup module can reject a "pick up" request
 * for an item already held without reaching into the snapshot's
 * `state` discriminator directly.
 */
export function isHeld(snapshot: ItemLifecycleSnapshot): boolean {
  return snapshot.state === 'held';
}

/**
 * `true` iff the item has reached its terminal `broken` state. Useful
 * for the AI bot's item-selection logic ("ignore broken items on the
 * stage") and for the despawn timer (Sub-AC 2) which only counts down
 * for items in this state.
 */
export function isBroken(snapshot: ItemLifecycleSnapshot): boolean {
  return snapshot.state === 'broken';
}

/**
 * `true` iff the item has fully despawned and should no longer be
 * tracked. The spawn manager subtracts these from its active-item
 * count so the next `step()` is free to spawn a fresh item.
 */
export function isDespawned(snapshot: ItemLifecycleSnapshot): boolean {
  return snapshot.state === 'despawned';
}

// ---------------------------------------------------------------------------
// Visual hints — pure function from lifecycle → render hints
// ---------------------------------------------------------------------------

/**
 * Compute the visual presentation hints for an item at its current
 * lifecycle state. Pure function — every output is derived from the
 * snapshot fields, no global lookups, no `Math.random()`.
 *
 * Behaviour by state:
 *
 *   • `falling`   : visible, full alpha, normal sprite, NOT eligible
 *                   for pickup highlight (the falling-drop window is
 *                   intentionally pickup-locked so the player reads
 *                   the spawn animation first).
 *   • `grounded`  : visible, full alpha, normal sprite, pickup-eligible
 *                   highlight on (a fighter in range can grab it).
 *   • `held`      : visible, full alpha, normal sprite, pickup-locked
 *                   (the carrier already owns it; nobody else can).
 *   • `broken`    : visible, reduced alpha ({@link ITEM_BROKEN_ALPHA}),
 *                   **broken sprite variant**, pickup-locked. The
 *                   sprite swap is Sub-AC 1's headline visual signal —
 *                   flips on the same tick the lifecycle entered
 *                   `broken` and stays on until despawn.
 *   • `despawned` : invisible. Renderer should not draw at all (and
 *                   the spawn manager's active-item count should
 *                   already have decremented).
 */
export function computeItemVisualHints(
  snapshot: ItemLifecycleSnapshot,
): ItemVisualHints {
  switch (snapshot.state) {
    case 'falling':
      return {
        visible: true,
        alpha: 1,
        useBrokenSprite: false,
        pickupEligible: false,
      };
    case 'grounded':
      return {
        visible: true,
        alpha: 1,
        useBrokenSprite: false,
        pickupEligible: true,
      };
    case 'held':
      return {
        visible: true,
        alpha: 1,
        useBrokenSprite: false,
        pickupEligible: false,
      };
    case 'broken':
      return {
        visible: true,
        alpha: ITEM_BROKEN_ALPHA,
        useBrokenSprite: true,
        pickupEligible: false,
      };
    case 'despawned':
      return {
        visible: false,
        alpha: 0,
        useBrokenSprite: false,
        pickupEligible: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Transition helpers
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link transitionToBroken}. Plain data — the helper is
 * pure and item-category-agnostic so a future Bat / RayGun / Bomb
 * subclass file can call it without this module knowing about per-
 * category state.
 */
export interface TransitionToBrokenInput {
  /** The item's current lifecycle snapshot. */
  readonly snapshot: ItemLifecycleSnapshot;
  /**
   * The fixed-step frame the break is taking effect on. Stamped into
   * {@link ItemLifecycleSnapshot.stateEnteredFrame} so the despawn
   * timer (Sub-AC 2 of AC 16) can compare against it for the broken-
   * debris reclaim window. Must be a non-negative finite integer;
   * non-finite / negative / fractional values throw.
   */
  readonly currentFrame: number;
  /**
   * The world-space position the inert debris should drop at. For an
   * item being broken **while held** this is the holder's hand
   * position (so the debris falls from where the swing connected); for
   * an item being broken **while grounded** (e.g. a hypothetical
   * environmental break) this is just the item's current position.
   *
   * The lifecycle module does NOT compute this for the caller — the
   * holder/handle position is the carrier framework's responsibility.
   * Required so the snapshot's `position` field is unambiguous after
   * the transition (no implicit "use last known" coupling).
   */
  readonly dropPosition: { readonly x: number; readonly y: number };
}

/**
 * Result of {@link transitionToBroken}. Discriminated by
 * {@link TransitionResult.ok} so the caller distinguishes a successful
 * transition (returns the new snapshot) from a rejected one (the item
 * was already broken/despawned, or in some other illegal source state).
 *
 * A rejected transition is *not* an exception because the caller may
 * legitimately race two break paths (e.g. the durability counter hits
 * zero on the same tick a TTL despawn fires) and the lifecycle module
 * is the arbiter of which one wins. Returning a structured rejection
 * lets the caller log the loser without unwinding through a try/catch.
 */
export type TransitionResult<TSnapshot> =
  | { readonly ok: true; readonly next: TSnapshot }
  | { readonly ok: false; readonly reason: string };

/**
 * Drive the **broken** state transition (T3 items framework, AC 16
 * Sub-AC 1). The headline operation of this entire module.
 *
 * What it does
 * ------------
 *
 *   1. **Validates the source state**. Only `grounded` and `held`
 *      items may break:
 *        • `falling` → reject (an item cannot break in mid-air; it
 *          hasn't been used yet).
 *        • `grounded` → accept (e.g. a hypothetical environmental
 *          hazard breaks an unattended item).
 *        • `held` → accept (the headline path: carrier swings the
 *          last hit, durability hits zero, item shatters mid-swing).
 *        • `broken` → reject as a no-op (already broken; idempotency
 *          guard for a double-fire on the same frame).
 *        • `despawned` → reject (terminal state; no further
 *          transitions legal).
 *
 *   2. **Drops the item inert**. Detaches from any holder
 *      (`holderPlayerIndex = null`) and pins the position to the
 *      caller-supplied `dropPosition`. The item is now a free body
 *      in the world that the renderer will draw with the broken
 *      sprite swap.
 *
 *   3. **Stamps the break frame**. Writes `currentFrame` into
 *      `stateEnteredFrame` so the despawn timer (Sub-AC 2 of AC 16)
 *      can compare against it for the broken-debris reclaim window.
 *      Throws if `currentFrame` is not a non-negative finite integer
 *      — a corrupt frame counter must surface here, not silently
 *      mis-time the despawn.
 *
 *   4. **Disables pickup interactions** (the headline contract of
 *      Sub-AC 1). The returned snapshot has `state = 'broken'`, which
 *      {@link canBePickedUp} flips to `false` — the pickup module
 *      reads this and refuses to grab the item. The visual layer's
 *      `pickupEligible` hint flips off in lockstep so a player can't
 *      see a pickup highlight on a broken item.
 *
 * What it does NOT do
 * -------------------
 *
 *   • It does not schedule the despawn. Sub-AC 2 of AC 16 will add a
 *     timer that polls `stateEnteredFrame` and transitions the item
 *     to `despawned` after a short window. Splitting the timer from
 *     the break transition keeps each helper a pure function of its
 *     inputs and lets the timer be tested in isolation.
 *   • It does not detach the item from the holder's inventory slot.
 *     The holder's inventory module (a later sub-AC) is responsible
 *     for clearing its slot — the lifecycle module only writes the
 *     `holderPlayerIndex = null` marker so the snapshot is internally
 *     consistent. This split keeps the lifecycle module
 *     category-agnostic; the inventory module knows about
 *     {@link inventorySlot} and the lifecycle does not.
 *   • It does not emit any audio / particle / replay event. Side-
 *     effecting hooks live on the calling layer; the lifecycle
 *     module is pure data-in / data-out.
 *
 * Determinism
 * -----------
 *
 * Pure function — the same `(snapshot, currentFrame, dropPosition)`
 * triple always produces the same result. No `Math.random()`, no
 * wall-clock reads.
 */
export function transitionToBroken(
  input: TransitionToBrokenInput,
): TransitionResult<ItemLifecycleSnapshot> {
  // (1) Frame validation — a corrupt frame counter must surface here,
  //     not silently mis-time the despawn timer that reads this value
  //     in Sub-AC 2.
  const { currentFrame } = input;
  if (
    !Number.isFinite(currentFrame) ||
    currentFrame < 0 ||
    !Number.isInteger(currentFrame)
  ) {
    throw new Error(
      `transitionToBroken: currentFrame must be a non-negative integer, got ${currentFrame}`,
    );
  }

  // (2) Drop position validation — must be a finite (x, y). A NaN
  //     position would silently render the broken sprite at the
  //     world origin (or off-screen, depending on the renderer);
  //     surface the bug here.
  const { dropPosition } = input;
  if (
    !Number.isFinite(dropPosition.x) ||
    !Number.isFinite(dropPosition.y)
  ) {
    throw new Error(
      `transitionToBroken: dropPosition must have finite x/y, got (${dropPosition.x}, ${dropPosition.y})`,
    );
  }

  // (3) Source-state gate — only `grounded` and `held` items may
  //     break. Everything else is a structured rejection so the
  //     caller can race two break paths without try/catch.
  const sourceState = input.snapshot.state;
  switch (sourceState) {
    case 'falling':
      return {
        ok: false,
        reason: `cannot break a 'falling' item — the drop animation must complete first`,
      };
    case 'broken':
      return {
        ok: false,
        reason: `item is already broken (idempotency guard against double-fire)`,
      };
    case 'despawned':
      return {
        ok: false,
        reason: `cannot transition out of terminal 'despawned' state`,
      };
    case 'grounded':
    case 'held':
      // Fall through to the accept path below.
      break;
  }

  // (4) Build the new snapshot. Detached holder, pinned position,
  //     stamped frame, broken state. Frozen so accidental mutation
  //     by an over-eager item subclass surfaces immediately.
  const next: ItemLifecycleSnapshot = Object.freeze({
    state: 'broken' as const,
    holderPlayerIndex: null,
    position: Object.freeze({ x: dropPosition.x, y: dropPosition.y }),
    stateEnteredFrame: currentFrame,
  });

  return { ok: true, next };
}
