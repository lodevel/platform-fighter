/**
 * MenuInputAdapter — AC 50203 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * Sub-AC 3 of AC 50203 calls for menu / HUD navigation input — the main
 * menu's "Press ENTER to play", the pause overlay's "Press ESC to quit",
 * the character-select's confirm / cancel / cursor-cycle — to *flow
 * through the central {@link InputResolver}* using each player's
 * canonical action bindings rather than the legacy raw-keycode listeners
 * (Phaser ENTER / ESC keydown handlers) scattered across `MainMenuScene`,
 * the pause overlay in `MatchScene`, and `CharacterSelectScene`.
 *
 * Earlier sub-ACs landed the resolver itself (the per-player
 * action-state surface that wraps the device dispatcher + bindings
 * store) and the {@link buildCharacterInputFromResolver} translator
 * that gameplay reads through. The match scene and fighter
 * controllers no longer reference raw key codes — every gameplay-side
 * input decision flows through the resolver.
 *
 * What was missing was a *menu-flavoured* read surface on top of the
 * same resolver:
 *
 *   • Menus speak in `navigate{Left,Right,Up,Down} / confirm / cancel`,
 *     not in `move{Left,Right,Up,Down} / attack / shield`. The resolver
 *     exposes the latter; menu code that read the former would have to
 *     re-implement the mapping each time.
 *   • Menus want *rising-edge* semantics ("pressed Enter once") rather
 *     than the held-bit a fighter's per-step controller cares about.
 *     The resolver already caches per-slot prev/curr snapshots so the
 *     edge bit is "free" — but a caller that pulls the snapshot every
 *     frame still has to remember to use `justPressed` not `held`.
 *   • Menus often want **any-player** semantics — "any joined player
 *     can confirm" — *or* per-player ("only the slot that owns this
 *     panel can ready up"). The resolver's per-slot read is the
 *     building block; the any-player fold is a one-liner each menu
 *     code path otherwise has to repeat.
 *
 * `MenuInputAdapter` provides exactly that: a thin Phaser-free, pure
 * read surface that exposes the menu-action vocabulary
 * (`navigateLeft / navigateRight / navigateUp / navigateDown / confirm
 * / cancel`) against a wrapped {@link InputResolver}. Every menu /
 * pause / character-select consumer reads through this adapter so the
 * mapping from "physical key/button held by the player" to "menu
 * action triggered" stays in *one* place — and so a rebind of `attack`
 * → `K` automatically rebinds the menu's `confirm` to `K` too.
 *
 * Action mapping
 * --------------
 *
 * The adapter wires the menu vocabulary onto the resolver's canonical
 * action vocabulary as follows:
 *
 *   menu action         resolver action(s)
 *   ------------        --------------------
 *   navigateLeft        moveLeft
 *   navigateRight       moveRight
 *   navigateUp          moveUp
 *   navigateDown        moveDown
 *   confirm             attack OR jump
 *   cancel              shield OR special
 *
 * `confirm` and `cancel` accept either of two resolver actions because
 * Smash-Bros conventions (and every shipped controller layout) bind
 * "the A button" to either jump or attack depending on player taste —
 * a binding profile that puts jump on the South face button shouldn't
 * lose menu-confirm. Same for cancel: the canonical "B button" maps
 * to either shield (defensive) or special (offensive) on shipped
 * profiles, and the menu cancel should fire for either.
 *
 * The mapping is a frozen constant ({@link MENU_ACTION_TO_RESOLVER}) so
 * a future extension (e.g. routing `cancel` through `dodge` instead) is
 * a one-line change with full type-safety from the {@link MenuAction}
 * union.
 *
 * Determinism
 * -----------
 *
 *   • The adapter is a pure read surface over the underlying resolver.
 *     There is no internal state — every query forwards to the
 *     resolver's `wasJustPressed` (rising-edge) accessors. Two queries
 *     between resolver `update()` calls return identical results.
 *   • No `Math.random()`, no wall-clock reads, no Phaser. The adapter
 *     never calls `update()` itself — the owning scene is expected to
 *     drive the resolver per fixed step, exactly as the gameplay path
 *     does today.
 *   • The any-player fold iterates the resolver's tracked slots in the
 *     order configured at resolver construction, so a unit test that
 *     records "which slot triggered confirm first" gets the same
 *     answer on every machine.
 *
 * Why a separate module instead of folding into `InputResolver`
 * -------------------------------------------------------------
 *
 *   1. **Vocabulary boundary.** The resolver speaks the gameplay
 *      vocabulary (`move{Left,Right,Up,Down} / jump / attack / ...`).
 *      Menu code speaks `navigate / confirm / cancel`. Folding the
 *      menu vocabulary into the resolver would either pollute the
 *      gameplay-only API surface or make the menu vocabulary feel like
 *      "another action category" callers must remember to skip.
 *   2. **Reusability.** The same adapter wraps any resolver instance —
 *      the match scene's per-frame resolver (so a paused-mid-match
 *      pause overlay reads through the same adapter), a menu-only
 *      resolver constructed in {@link MainMenuScene}, or a stub
 *      resolver in unit tests. The adapter has no construction
 *      requirements beyond "a resolver".
 *   3. **Single mapping authority.** The mapping table
 *      ({@link MENU_ACTION_TO_RESOLVER}) lives in one module so a
 *      future migration (e.g. adding a dedicated menu binding profile)
 *      is mechanical: change the mapping, every call site picks it up.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The
 * {@link MenuAction} union and the readonly mapping table give callers
 * an exhaustive list of menu actions; an exhaustive switch over a
 * future menu action will fail compilation if the mapping isn't
 * extended.
 */

import type {
  ActionName,
  InputResolver,
  PlayerIndex,
} from './InputResolver';

// ---------------------------------------------------------------------------
// Public action vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical menu-action vocabulary the adapter exposes.
 *
 * Ordered: directional first (`navigateLeft / navigateRight /
 * navigateUp / navigateDown`), then commit (`confirm`), then back
 * (`cancel`). The order is the canonical iteration order for
 * `MENU_ACTIONS` and for any debug overlay that wants a wholesale
 * dump of the per-player menu state.
 */
export type MenuAction =
  | 'navigateLeft'
  | 'navigateRight'
  | 'navigateUp'
  | 'navigateDown'
  | 'confirm'
  | 'cancel';

/** All menu actions in canonical iteration order. */
export const MENU_ACTIONS: ReadonlyArray<MenuAction> = Object.freeze([
  'navigateLeft',
  'navigateRight',
  'navigateUp',
  'navigateDown',
  'confirm',
  'cancel',
] as const);

/**
 * Mapping from each menu action to the canonical resolver action(s)
 * that can trigger it. A menu action fires when ANY of its mapped
 * resolver actions has a rising edge for the queried player slot.
 *
 * Frozen at module evaluation so callers can't mutate the table at
 * runtime; the resulting tuples are also frozen so a future
 * `MENU_ACTION_TO_RESOLVER.confirm.push('grab')` mistake fails fast.
 *
 * The double-mapping for `confirm` (`attack` OR `jump`) and `cancel`
 * (`shield` OR `special`) is intentional — see the module header for
 * the design rationale. Single-action menu actions still use a 1-tuple
 * for shape consistency (every value is a `ReadonlyArray<ActionName>`).
 */
export const MENU_ACTION_TO_RESOLVER: Readonly<
  Record<MenuAction, ReadonlyArray<ActionName>>
> = Object.freeze({
  navigateLeft: Object.freeze(['moveLeft' as ActionName]),
  navigateRight: Object.freeze(['moveRight' as ActionName]),
  navigateUp: Object.freeze(['moveUp' as ActionName]),
  navigateDown: Object.freeze(['moveDown' as ActionName]),
  // Confirm: either of the two canonical "A button" mappings used by
  // Smash-Bros profiles. A rebind that swaps attack ↔ jump still keeps
  // menu-confirm working.
  confirm: Object.freeze(['attack' as ActionName, 'jump' as ActionName]),
  // Cancel: either of the two canonical "B button" mappings. shield is
  // the keyboard default; special covers profiles that swap special
  // onto the shoulder.
  cancel: Object.freeze(['shield' as ActionName, 'special' as ActionName]),
});

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link MenuInputAdapter}.
 */
export interface MenuInputAdapterOptions {
  /**
   * The {@link InputResolver} the adapter reads through. Required.
   * The adapter never calls `update()` on the resolver — the owning
   * scene drives the resolver per fixed step, exactly as the gameplay
   * path does today.
   */
  readonly resolver: InputResolver;

  /**
   * Player slots the adapter considers for any-player queries.
   * Defaults to the resolver's tracked slots
   * (`resolver.getTrackedSlots()`).
   *
   * Restrict for menus that should only listen to a subset (e.g. a
   * lobby's "Press start to join" panel that only listens on slot 1
   * before any other slot has been claimed).
   */
  readonly slots?: ReadonlyArray<PlayerIndex>;
}

/**
 * Phaser-free menu input adapter.
 *
 * Wraps an {@link InputResolver} and exposes the menu vocabulary
 * (`navigateLeft / navigateRight / navigateUp / navigateDown / confirm
 * / cancel`) with rising-edge semantics ("just pressed this frame").
 *
 * Usage:
 *
 *     // Once per fixed step, the owning scene already calls:
 *     resolver.update(currentFrame);
 *
 *     // Then either ask "did THIS player trigger this menu action?"
 *     if (menuInput.wasTriggered(1, 'confirm')) startMatch();
 *
 *     // Or "did ANY tracked player trigger this menu action?"
 *     if (menuInput.wasTriggeredByAnyPlayer('cancel')) returnToMenu();
 *
 *     // Or read the analog menu vector (folded from navigate{Left,Right,Up,Down})
 *     const v = menuInput.getNavigateVector(1);
 *     // v.x ∈ {-1, 0, 1}, v.y ∈ {-1, 0, 1} — digital edges only.
 *
 * The adapter is the canonical menu-side read surface that AC 50203
 * Sub-AC 3 calls for: every menu / pause / character-select
 * navigation read flows through this object so the mapping from
 * "binding profile + raw device state" to "menu action" stays in one
 * place.
 */
export class MenuInputAdapter {
  private readonly resolver: InputResolver;
  private readonly slots: ReadonlyArray<PlayerIndex>;

  constructor(options: MenuInputAdapterOptions) {
    if (options.resolver === null || options.resolver === undefined) {
      throw new Error(
        'MenuInputAdapter: options.resolver is required — the adapter cannot read inputs without an InputResolver.',
      );
    }
    this.resolver = options.resolver;
    const slots =
      options.slots !== undefined
        ? Object.freeze([...options.slots])
        : Object.freeze([...options.resolver.getTrackedSlots()]);
    this.slots = slots;
  }

  // -------------------------------------------------------------------------
  // Per-player queries
  // -------------------------------------------------------------------------

  /**
   * **The AC-named entry point.** Did the supplied player slot trigger
   * the supplied menu action this frame?
   *
   * Returns `true` iff *any* of the resolver actions mapped to
   * `menuAction` (see {@link MENU_ACTION_TO_RESOLVER}) has a rising
   * edge for `playerIndex` between the previous and current resolver
   * `update()` calls. Each call is a pure read of the resolver's
   * cached prev/curr snapshot — two calls between updates return
   * identical results.
   *
   * Reading a slot the resolver is not tracking returns `false` (the
   * resolver itself returns the neutral state for an untracked slot,
   * and the rising-edge accessor short-circuits on that).
   */
  wasTriggered(playerIndex: PlayerIndex, menuAction: MenuAction): boolean {
    const resolverActions = MENU_ACTION_TO_RESOLVER[menuAction];
    for (const action of resolverActions) {
      if (this.resolver.wasJustPressed(playerIndex, action)) return true;
    }
    return false;
  }

  /**
   * Convenience held-bit accessor — `true` iff any of the resolver
   * actions mapped to `menuAction` is currently held for
   * `playerIndex`. Used by menus that auto-repeat navigation while
   * a direction is held (e.g. a long roster scroll).
   */
  isHeld(playerIndex: PlayerIndex, menuAction: MenuAction): boolean {
    const resolverActions = MENU_ACTION_TO_RESOLVER[menuAction];
    for (const action of resolverActions) {
      if (this.resolver.isActionHeld(playerIndex, action)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Any-player fold
  // -------------------------------------------------------------------------

  /**
   * Did *any* of the adapter's tracked slots trigger the supplied menu
   * action this frame? Returns `true` on the first slot that fires,
   * iterated in the resolver's tracked-slot order.
   *
   * The natural read for a global menu surface ("any joined player can
   * press Enter to start the match", "any player can press Esc to back
   * out"). Per-player attribution uses {@link wasTriggered} instead.
   */
  wasTriggeredByAnyPlayer(menuAction: MenuAction): boolean {
    for (const slot of this.slots) {
      if (this.wasTriggered(slot, menuAction)) return true;
    }
    return false;
  }

  /**
   * Returns the slot index that triggered the supplied menu action
   * this frame, or `null` if no tracked slot triggered it. Iterates
   * the resolver's tracked-slot order so the result is deterministic
   * (the lowest-numbered tracked slot wins on simultaneous presses).
   *
   * Useful for menus that want to attribute a global action to whoever
   * triggered it ("P3 confirmed — start the match").
   */
  firstSlotThatTriggered(menuAction: MenuAction): PlayerIndex | null {
    for (const slot of this.slots) {
      if (this.wasTriggered(slot, menuAction)) return slot;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Navigation vector
  // -------------------------------------------------------------------------

  /**
   * Per-frame digital navigation vector for the supplied player slot.
   *
   * Returns `{ x, y }` where `x` is `-1` if `navigateLeft` fired this
   * frame, `+1` if `navigateRight` fired, `0` otherwise. Same for `y`
   * with `navigateUp` (`-1`) / `navigateDown` (`+1`).
   *
   * Edge-only — a held direction does NOT keep the vector pegged.
   * Menus that want auto-repeat layer their own timer on top of
   * {@link isHeld}; this method is the rising-edge fold most menus
   * actually want (one cursor step per press).
   *
   * If the slot fires both directions on the same axis in one frame
   * (impossible under the dispatcher but plausible under a synthesised
   * test scenario), the negative direction wins for `x` and the
   * negative direction wins for `y` so the vector stays well-defined.
   */
  getNavigateVector(playerIndex: PlayerIndex): { readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 } {
    let x: -1 | 0 | 1 = 0;
    let y: -1 | 0 | 1 = 0;
    if (this.wasTriggered(playerIndex, 'navigateLeft')) x = -1;
    else if (this.wasTriggered(playerIndex, 'navigateRight')) x = 1;
    if (this.wasTriggered(playerIndex, 'navigateUp')) y = -1;
    else if (this.wasTriggered(playerIndex, 'navigateDown')) y = 1;
    return Object.freeze({ x, y });
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /**
   * The resolver this adapter reads through. Exposed so production
   * wiring can share one resolver across the adapter and the gameplay
   * path — a single device poll per fixed step feeds both.
   */
  getResolver(): InputResolver {
    return this.resolver;
  }

  /**
   * The frozen list of slots this adapter considers for any-player
   * queries. A menu that wants to render "every active player's
   * cursor" can iterate this without defaulting to all four.
   */
  getTrackedSlots(): ReadonlyArray<PlayerIndex> {
    return this.slots;
  }
}
