/**
 * Phaser-free helpers for the pre-match Lobby screen.
 *
 * AC 2 Sub-AC 5 — "Implement lobby flow with Press Start to join for
 * up to 4 players, slot assignment, and transition into character
 * select."
 *
 * The lobby is the very first interactive surface after the player
 * leaves the main menu. Its job is narrow:
 *
 *   1. Let up to 4 players "Press Start" to claim a player slot.
 *   2. Track which input device each joined player is using
 *      (keyboard P1, keyboard P2, gamepad N, or AI bot) so the
 *      downstream `CharacterSelectScene` knows what to wire when the
 *      player picks a fighter.
 *   3. Enforce the Seed constraint that there can be at most two
 *      keyboard players (P1 = WASD-side, P2 = Arrow-side); gamepad
 *      players are unbounded.
 *   4. Allow joined players to LEAVE so a misjoin doesn't strand the
 *      session.
 *   5. Hand the captured slot lineup off to `CharacterSelectScene` so
 *      the character/palette/ready-up flow doesn't have to re-claim
 *      slots from scratch.
 *
 * Why Phaser-free
 * ---------------
 *
 * Per the project's `code_architecture` evaluation principle, scene
 * files stay thin — lifecycle wiring + draw calls. All the lobby's
 * state transitions (`joinSlot`, `leaveSlot`, "is this gamepad already
 * claimed?", "next free slot for an incoming gamepad") live in this
 * module so they:
 *
 *   • Unit-test under plain Node (Phaser pulls in browser globals at
 *     module-eval time and can't be loaded by a vitest worker).
 *   • Reuse cleanly from headless replay tooling, smoke-test
 *     harnesses, and a future "console join" admin tool without
 *     dragging Phaser into those paths.
 *   • Mirror the existing `modeSelect.ts ↔ ModeSelectScene.ts` and
 *     `characterSelect.ts ↔ CharacterSelectScene.ts` splits so future
 *     maintainers find one consistent pattern.
 *
 * Determinism contract
 * --------------------
 *
 * Every transition is a deterministic pure function — no
 * `Math.random()`, no wall-clock reads, no Phaser globals. Two
 * lobbies that joined in the same order produce byte-identical
 * `LobbyState` snapshots, which keeps the downstream `MatchConfig` /
 * replay header stable.
 *
 * Note on overlap with `characterSelect.ts`
 * -----------------------------------------
 *
 * `CharacterSelectScene` already supports "Press Start to Join" inside
 * itself (with the [1..4] number-row keys mapping to slot joins).
 * That code path stays intact for backward compatibility with smoke
 * tests / direct-launch flows that bypass the lobby. The lobby is the
 * *canonical* entry point: when the player walks into character
 * select via the lobby, the downstream scene pre-populates its
 * `joined`/`inputType` slot fields from the lobby payload so the
 * player only has to commit to a fighter, not re-claim their slot.
 */

import type { AiDifficulty, InputType, PlayerSlot } from '../types';

// ---------------------------------------------------------------------------
// Public option ladders
// ---------------------------------------------------------------------------

/**
 * Maximum local players in a single match (Seed: "local multiplayer
 * for up to 4 players"). Mirrors the same constant in
 * `characterSelect.ts` — kept duplicated here so importing the lobby
 * helper doesn't transitively pull in the character-select state model.
 */
export const MAX_LOBBY_SLOTS = 4;

/**
 * The canonical default character id for a freshly joined slot. Slot 1
 * lands on Wolf, slot 2 on Cat, etc. — same defaults the downstream
 * `CharacterSelectScene` uses, so handing off pre-populated joined
 * slots to character select doesn't surprise the player with a
 * different fighter than the lobby preview implied.
 *
 * The lobby itself doesn't paint a fighter preview — it only renders
 * "P1 — KEYBOARD" / "P2 — JOINED" tiles — but the projection helper
 * `buildPlayerSlotsFromLobby` needs a sensible default when the lobby
 * is the only configurator (e.g. a smoke-test path that skips the
 * character select and feeds the lobby directly into `MatchScene`).
 */
const DEFAULT_CHARACTER_IDS: ReadonlyArray<PlayerSlot['characterId']> =
  Object.freeze(['wolf', 'cat', 'owl', 'bear']);

/**
 * The canonical default `InputType` per slot index. Mirrors
 * `characterSelect.ts.defaultInputTypeForSlot` so a slot that's never
 * been touched in the lobby still produces the same `PlayerSlot`
 * shape the M1/M2 dev-mode flows expect.
 *
 *   • Slot 1 → keyboard_p1 (WASD-side keyboard).
 *   • Slot 2 → keyboard_p2 (arrow-side keyboard).
 *   • Slot 3..4 → ai (medium difficulty bot until a gamepad joins).
 */
function defaultInputTypeForSlot(slotIndex: 1 | 2 | 3 | 4): InputType {
  if (slotIndex === 1) return 'keyboard_p1';
  if (slotIndex === 2) return 'keyboard_p2';
  return 'ai';
}

/**
 * Default AI difficulty applied to bot-filled slots. Medium matches
 * the existing `characterSelect.ts` default so the lobby and the
 * downstream character-select scene agree on the stock bot tier.
 */
const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'medium';

/**
 * Canonical cycle order for AI difficulty selection, used by
 * {@link cycleSlotAiDifficulty}. Walks the three tiers in ascending
 * skill order so a player tapping the cycle key climbs the ladder
 * rather than zig-zagging. Wraps `hard → easy` so the cycle is closed.
 *
 * AC 10205 Sub-AC 5: per-slot AI difficulty must be selectable on
 * every AI slot. The cycle order is fixed (not user-configurable) so
 * the ladder is deterministic — two lobbies that pressed the same key
 * sequence land on the same difficulty for the same slot.
 */
export const AI_DIFFICULTY_CYCLE_ORDER: ReadonlyArray<AiDifficulty> =
  Object.freeze(['easy', 'medium', 'hard']);

// ---------------------------------------------------------------------------
// Lobby state model
// ---------------------------------------------------------------------------

/**
 * One slot's worth of lobby state. Pure data — every transition
 * produces a brand-new object so consumers can compare snapshots with
 * `===` and skip re-painting.
 *
 *   • `index`         — slot number (1..4). Mirrors `PlayerSlot.index`.
 *   • `joined`        — false until the player Pressed Start. The
 *                       lobby UI greys out un-joined slots and
 *                       `buildPlayerSlotsFromLobby` drops them from
 *                       the resulting lineup.
 *   • `ready`         — AC 10402 Sub-AC 2 — false until the player
 *                       presses their per-slot READY key. Gates the
 *                       lobby-confirm path via {@link canConfirmLobby}
 *                       so a player can't sleepwalk past slot setup.
 *                       Invariant: `ready ⇒ joined`. An un-joined slot
 *                       can never be ready (un-joined spectators have
 *                       nothing to be ready for). Leaving a slot or
 *                       cycling its input type drops `ready` back to
 *                       false so the player has to re-confirm any
 *                       device changes deliberately.
 *   • `inputType`     — null when un-joined; one of `'keyboard_p1'`,
 *                       `'keyboard_p2'`, `'gamepad'`, `'ai'` once a
 *                       player has claimed the slot. Determines what
 *                       feeds inputs at match time.
 *   • `gamepadIndex`  — only set when `inputType === 'gamepad'`. The
 *                       browser Gamepad API index of the device that
 *                       claimed this slot. Used to keep two slots
 *                       from claiming the same physical pad.
 *   • `aiDifficulty`  — only set when `inputType === 'ai'`. Optional
 *                       on the slot so non-AI slots don't carry a
 *                       phantom field through the replay JSON.
 */
export interface LobbySlotState {
  readonly index: 1 | 2 | 3 | 4;
  readonly joined: boolean;
  readonly ready: boolean;
  readonly inputType: InputType | null;
  readonly gamepadIndex?: number;
  readonly aiDifficulty?: AiDifficulty;
}

/**
 * The full lobby screen state — one entry per possible slot, in slot
 * order. Always {@link MAX_LOBBY_SLOTS} entries long so consumers can
 * index by slot number minus one without bounds-checking.
 */
export interface LobbyState {
  readonly slots: ReadonlyArray<LobbySlotState>;
}

/**
 * Initial state opened by `LobbyScene` on first entry. Every slot
 * starts un-joined — the player has to Press Start on at least one
 * device before the lobby can advance.
 *
 * Even slot 1 starts un-joined, departing from the
 * `DEFAULT_CHARACTER_SELECT_STATE` convention (which auto-joined slot
 * 1 so the menu always had at least one active body). The lobby is
 * the *first* scene a player consciously interacts with, so requiring
 * a deliberate Press Start before advancing is the more honest UX —
 * the player has confirmed they want to play.
 */
export const DEFAULT_LOBBY_STATE: LobbyState = Object.freeze({
  slots: Object.freeze(
    ([1, 2, 3, 4] as const).map((index) =>
      Object.freeze({
        index,
        joined: false,
        ready: false,
        inputType: null,
      } satisfies LobbySlotState),
    ),
  ),
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Optional join parameters — used when claiming a slot for a gamepad
 * (where the caller knows the Gamepad API index) or when overriding
 * the default AI difficulty on a bot slot.
 */
export interface JoinSlotOptions {
  readonly gamepadIndex?: number;
  readonly aiDifficulty?: AiDifficulty;
}

/**
 * Mark a slot as having Pressed Start to Join with the given input
 * type. Idempotent — a second call on an already-joined slot returns
 * the same state reference iff the input type / gamepad index match;
 * otherwise the slot is re-claimed for the new device.
 *
 * Invariants enforced here:
 *
 *   • Slot index must be 1..4 (throws on out-of-range).
 *   • The same `inputType` value cannot be claimed by two slots when
 *     it's a keyboard device — `'keyboard_p1'` is exclusive to slot
 *     1, `'keyboard_p2'` is exclusive to slot 2 (not by hard-coding
 *     the slot — the caller chooses — but by single-claim semantics:
 *     if any other slot already has `'keyboard_p1'` joined, the join
 *     attempt is silently rejected so the lobby never has two slots
 *     fighting over the same physical keyboard half).
 *   • When `inputType === 'gamepad'`, the same `gamepadIndex` cannot
 *     be claimed by two slots — same exclusivity rule, applied to the
 *     physical pad rather than the type alone.
 *
 * AI slots don't carry an exclusivity rule — every AI slot is
 * independent. The `aiDifficulty` defaults to medium when the join
 * call doesn't specify one.
 */
export function joinSlot(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
  inputType: InputType,
  opts?: JoinSlotOptions,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `joinSlot: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }

  // Reject duplicate keyboard-half claims. If another slot already
  // has the same exclusive keyboard input type, the join is a no-op.
  if (
    (inputType === 'keyboard_p1' || inputType === 'keyboard_p2') &&
    isInputTypeClaimedByOther(state, slotIndex, inputType)
  ) {
    return state;
  }

  // Reject duplicate gamepad claims by index.
  const gamepadIndex = opts?.gamepadIndex;
  if (
    inputType === 'gamepad' &&
    typeof gamepadIndex === 'number' &&
    isGamepadClaimedByOther(state, slotIndex, gamepadIndex)
  ) {
    return state;
  }

  const aiDifficulty =
    inputType === 'ai' ? opts?.aiDifficulty ?? DEFAULT_AI_DIFFICULTY : undefined;

  // Idempotent shortcut: if every observable field matches, skip the
  // allocation so consumers comparing with `===` short-circuit. The
  // `ready` field deliberately participates in the comparison so a
  // re-join call on a ready slot keeps the ready flag (idempotent).
  if (
    target.joined &&
    target.inputType === inputType &&
    target.gamepadIndex === (inputType === 'gamepad' ? gamepadIndex : undefined) &&
    target.aiDifficulty === aiDifficulty
  ) {
    return state;
  }

  // AC 10402 Sub-AC 2 — joining (or re-claiming a slot for a different
  // device) drops `ready` back to false. The ready flag asserts "I've
  // confirmed THIS slot configuration"; any device change invalidates
  // the assertion and forces a fresh confirm. Newly joined slots
  // (was un-joined) likewise start un-ready so even the very first
  // join requires a deliberate ready-up press.
  const nextSlot: LobbySlotState = Object.freeze({
    index: target.index,
    joined: true,
    ready: false,
    inputType,
    ...(inputType === 'gamepad' && typeof gamepadIndex === 'number'
      ? { gamepadIndex }
      : {}),
    ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
  });

  const nextSlots = state.slots.map((s, i) => (i === targetIdx ? nextSlot : s));
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * Inverse of {@link joinSlot} — drop a slot back to un-joined. Wired
 * to a per-slot leave key so a player who joined by mistake can back
 * out without ESC-ing the whole scene (which would also drag the
 * other 3 players back to the main menu).
 *
 * Idempotent — calling on an already-un-joined slot returns the same
 * state reference. Throws on out-of-range slot index.
 */
export function leaveSlot(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `leaveSlot: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  if (!target.joined && !target.ready) return state;

  // AC 10402 Sub-AC 2 — leaving the slot also drops `ready`. The
  // invariant `ready ⇒ joined` is enforced here so an un-joined slot
  // can never carry a stale ready flag.
  const nextSlot: LobbySlotState = Object.freeze({
    index: target.index,
    joined: false,
    ready: false,
    inputType: null,
  });

  const nextSlots = state.slots.map((s, i) => (i === targetIdx ? nextSlot : s));
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

// ---------------------------------------------------------------------------
// Press-Start detection — AC 10401 Sub-AC 1
// ---------------------------------------------------------------------------

/**
 * Gamepad button indices that trigger a "Press Start to Join" event.
 * Mirrors the Standard Gamepad mapping
 * (https://w3c.github.io/gamepad/#dfn-standard-gamepad):
 *
 *   • 0 — A / Cross / "bottom face" — the canonical "confirm" button
 *         every pad has and every player intuitively reaches for first.
 *   • 1 — B / Circle / "right face" — accepted so a leftie or someone
 *         using a non-standard pad layout still has a join path.
 *   • 2 — X / Square / "left face".
 *   • 3 — Y / Triangle / "top face".
 *   • 9 — Start / Options / "+" — the literal "Press Start" button on
 *         every modern pad. Putting Start in the list makes the
 *         in-game prompt ("Press Start to Join") behave exactly as a
 *         player who reads it would expect.
 *
 * The list is intentionally inclusive: a fresh-pad player should never
 * have to guess which button counts, and the lobby is the only place
 * in the game where this many buttons collapse to the same action, so
 * the broad accept-set has no collateral effect on later screens.
 *
 * Determinism note: the list is frozen at module-load time and the
 * detection helper iterates it in declaration order, so two lobbies
 * with the same pad-button history produce byte-identical join
 * sequences.
 */
export const PRESS_START_BUTTON_INDICES: ReadonlyArray<number> = Object.freeze(
  [0, 1, 2, 3, 9],
);

/**
 * Per-frame snapshot of one gamepad's buttons — the minimal subset of
 * the browser `Gamepad` interface this module needs. Keeps the helper
 * Phaser-free and lets tests pass plain object literals.
 */
export interface PressStartGamepadSnapshot {
  /** Gamepad API index — used as the persistent slot-claim key. */
  readonly index: number;
  /**
   * Per-button pressed flags. Sparse arrays are tolerated — missing
   * entries are treated as not-pressed.
   */
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean } | null | undefined>;
}

/**
 * Tracks per-pad button-held state across frames so the helper can
 * fire on rising edges (button transitions from up→down) rather than
 * every frame the button stays held. The map is keyed by gamepad
 * index; the value is a per-button-index boolean.
 *
 * Mutable on purpose — the helper updates the same map the caller
 * passed in so the Phaser scene can keep a single instance across
 * frames without re-allocating.
 */
export type GamepadHeldButtonState = Map<number, Map<number, boolean>>;

/**
 * Result of one `detectGamepadPressStartEdges` call — the gamepad
 * indices that just experienced a rising edge on any of the
 * accepted Press-Start buttons this frame, in ascending pad-index
 * order. Empty array when no edges fired.
 */
export interface GamepadPressStartEdge {
  readonly gamepadIndex: number;
  /** Which button caused the rising edge — useful for telemetry/tests. */
  readonly buttonIndex: number;
}

/**
 * Pure detector for gamepad Press-Start rising edges.
 *
 *   • Walks `pads` in input order.
 *   • For each pad, scans `acceptedButtons` (default
 *     {@link PRESS_START_BUTTON_INDICES}) for a button whose pressed
 *     flag is `true` AND whose previous-frame state in `held` was
 *     `false` (or absent).
 *   • Mutates `held` in place to record the new held state for every
 *     scanned button so the next frame can fire on the next rising
 *     edge.
 *
 * Returns at most one edge per pad per frame — the first accepted
 * button to fire wins. This avoids double-claiming a pad when the
 * player mashes A and Start simultaneously.
 *
 * The detector is deliberately stateless re: the lobby — a separate
 * call site ({@link applyGamepadPressStartEdges}) feeds the edges
 * into {@link joinNextFreeSlotForGamepad} so this helper can be
 * reused by smoke-test harnesses, replay capture, or a future
 * "controller test" diagnostic screen without dragging the lobby
 * state model in.
 */
export function detectGamepadPressStartEdges(
  pads: ReadonlyArray<PressStartGamepadSnapshot | null | undefined>,
  held: GamepadHeldButtonState,
  acceptedButtons: ReadonlyArray<number> = PRESS_START_BUTTON_INDICES,
): ReadonlyArray<GamepadPressStartEdge> {
  const edges: GamepadPressStartEdge[] = [];
  for (const pad of pads) {
    if (!pad) continue;
    if (!Number.isFinite(pad.index) || pad.index < 0) continue;
    const padIdx = Math.trunc(pad.index);
    let perPad = held.get(padIdx);
    if (!perPad) {
      perPad = new Map<number, boolean>();
      held.set(padIdx, perPad);
    }

    let firedFor: number | null = null;
    for (const buttonIndex of acceptedButtons) {
      const btn = pad.buttons?.[buttonIndex];
      const pressed = !!btn?.pressed;
      const wasHeld = perPad.get(buttonIndex) ?? false;
      perPad.set(buttonIndex, pressed);
      if (firedFor === null && pressed && !wasHeld) {
        firedFor = buttonIndex;
        // Don't `break` — we still need to update `held` for the
        // remaining buttons so a button that's already held doesn't
        // re-fire on a later frame just because we skipped it now.
      }
    }
    if (firedFor !== null) {
      edges.push(
        Object.freeze({ gamepadIndex: padIdx, buttonIndex: firedFor }),
      );
    }
  }
  return Object.freeze(edges);
}

/**
 * Result of `applyGamepadPressStartEdges` — the new lobby state plus
 * a record of which edges were honoured. The `claims` array is empty
 * iff no slots changed (e.g. every edge came from a pad that already
 * claimed a slot, or the lobby was full).
 */
export interface GamepadPressStartApplication {
  readonly state: LobbyState;
  /**
   * Pad indices that successfully claimed a slot this batch, in
   * apply order. Used by the Phaser scene to fire a join-confirmation
   * sound / haptic per claim and by tests to assert exactly which
   * pads landed.
   */
  readonly claims: ReadonlyArray<number>;
}

/**
 * Apply a batch of gamepad Press-Start edges to a lobby state, in the
 * order produced by {@link detectGamepadPressStartEdges}. Each edge
 * routes through {@link joinNextFreeSlotForGamepad} so:
 *
 *   • A pad that already claimed a slot is silently ignored.
 *   • A pad with no free slot is silently ignored (lobby full).
 *   • All other pads land in the next free slot in ascending order.
 *
 * Returns a {@link GamepadPressStartApplication} so the caller can
 * tell whether anything actually changed without comparing the
 * before/after state with `===` — the `claims` array is the
 * authoritative record.
 *
 * Pure function — no `Math.random()`, no wall-clock, no Phaser
 * globals. Two lobbies that received the same edge sequence produce
 * identical `state` and `claims` outputs.
 */
export function applyGamepadPressStartEdges(
  state: LobbyState,
  edges: ReadonlyArray<GamepadPressStartEdge>,
): GamepadPressStartApplication {
  let cur = state;
  const claims: number[] = [];
  for (const edge of edges) {
    const next = joinNextFreeSlotForGamepad(cur, edge.gamepadIndex);
    if (next !== cur) {
      claims.push(edge.gamepadIndex);
      cur = next;
    }
  }
  return Object.freeze({ state: cur, claims: Object.freeze(claims) });
}

/**
 * Convenience composition for a Phaser scene's per-frame poll: take a
 * snapshot of the live gamepads, the persistent held-button cache,
 * and the current lobby state, and return the next lobby state plus
 * the claim record.
 *
 * Intended call site: `LobbyScene.update()`. Pulled out of the scene
 * so the integration is unit-testable without instantiating Phaser.
 */
export function pollGamepadPressStartJoins(
  state: LobbyState,
  pads: ReadonlyArray<PressStartGamepadSnapshot | null | undefined>,
  held: GamepadHeldButtonState,
  acceptedButtons?: ReadonlyArray<number>,
): GamepadPressStartApplication {
  const edges = detectGamepadPressStartEdges(pads, held, acceptedButtons);
  return applyGamepadPressStartEdges(state, edges);
}

// ---------------------------------------------------------------------------
// Keyboard press-start dispatch
// ---------------------------------------------------------------------------

/**
 * AC 10401 Sub-AC 1 — keyboard side of the Press-Start-to-Join
 * contract. The lobby's per-slot number-row keys (1, 2, 3, 4) are
 * "Press Start to claim slot N" presses. This helper takes a slot
 * index and the current lobby state and returns the next state with
 * the slot's default `InputType` claimed.
 *
 *   • Slot 1 → keyboard_p1 (WASD-side keyboard).
 *   • Slot 2 → keyboard_p2 (Arrow-side keyboard).
 *   • Slot 3..4 → ai (medium difficulty bot).
 *
 * If the slot is already joined, this is a silent no-op (the scene
 * uses the toggle handler to LEAVE in that case — a "press start
 * again" is the player saying "I'm out", not a re-claim). If the
 * default type is exclusively claimed by another slot (e.g. someone
 * else already grabbed `keyboard_p1`), the underlying `joinSlot` call
 * silently rejects the claim and returns the same state reference.
 *
 * Returning the same state reference on no-op (rather than throwing)
 * keeps the keyboard handler safe to bind on every slot regardless
 * of the slot's current state — the scene's render pass short-
 * circuits via `===` and skips the re-paint.
 */
export function pressStartJoinFromKeyboard(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `pressStartJoinFromKeyboard: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  if (target.joined) return state;
  const inputType: InputType =
    slotIndex === 1
      ? 'keyboard_p1'
      : slotIndex === 2
        ? 'keyboard_p2'
        : 'ai';
  return joinSlot(state, slotIndex, inputType);
}

/**
 * Auto-claim the next free slot for an incoming gamepad. Walks slots
 * in ascending index order and assigns the first one whose `joined`
 * is false, claiming it as `inputType: 'gamepad'` with the supplied
 * `gamepadIndex`.
 *
 * If the gamepad index has already claimed a slot (the player tapped
 * the join button twice), the existing claim is preserved and the
 * call is a no-op (`===` reference returned).
 *
 * If every slot is already joined, the call is also a no-op — the
 * lobby is full. The caller (the Phaser scene) is responsible for
 * surfacing a "lobby full" hint when this happens.
 */
export function joinNextFreeSlotForGamepad(
  state: LobbyState,
  gamepadIndex: number,
): LobbyState {
  if (!Number.isFinite(gamepadIndex) || gamepadIndex < 0) return state;
  const padIndex = Math.trunc(gamepadIndex);

  // If this gamepad has already claimed a slot, no-op.
  for (const slot of state.slots) {
    if (
      slot.joined &&
      slot.inputType === 'gamepad' &&
      slot.gamepadIndex === padIndex
    ) {
      return state;
    }
  }

  // Find the first free slot.
  for (const slot of state.slots) {
    if (!slot.joined) {
      return joinSlot(state, slot.index, 'gamepad', { gamepadIndex: padIndex });
    }
  }

  // Lobby full.
  return state;
}

/**
 * Cycle a slot's input type through the available options. Lets the
 * player toggle a joined slot between "human" and "AI bot" without
 * having to leave + rejoin. The cycle order is:
 *
 *   ai → keyboard_p1 → keyboard_p2 → gamepad → ai
 *
 * Cycles that would land on an already-claimed exclusive input type
 * (e.g. another slot already has `'keyboard_p1'`) skip past it so the
 * player never lands on a "blocked" choice.
 *
 * The slot must already be joined — calling this on an un-joined slot
 * returns the same state reference (silent no-op).
 *
 * AC 2 Sub-AC 5: this lets a single-keyboard four-player session set
 * slots 3-4 to AI when no gamepads are connected, without forcing
 * them to scroll through unreachable keyboard options.
 */
export function cycleSlotInputType(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `cycleSlotInputType: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  if (!target.joined || target.inputType === null) return state;

  // Cycle order — keep AI as the wrap-around so a slot that loses its
  // gamepad can always fall back to a bot.
  const order: ReadonlyArray<InputType> = [
    'ai',
    'keyboard_p1',
    'keyboard_p2',
    'gamepad',
  ];

  const startIdx = order.indexOf(target.inputType);
  // Defensive: if the slot's current type isn't in the order list
  // (shouldn't happen since `InputType` enumerates all four), restart
  // the cycle from the head.
  const baseIdx = startIdx >= 0 ? startIdx : -1;

  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(baseIdx + step) % order.length];
    if (!candidate) continue;
    if (candidate === target.inputType) continue;
    // Skip exclusive types that would collide with another slot.
    if (
      (candidate === 'keyboard_p1' || candidate === 'keyboard_p2') &&
      isInputTypeClaimedByOther(state, slotIndex, candidate)
    ) {
      continue;
    }
    if (candidate === 'gamepad') {
      // Gamepad cycling without a known gamepadIndex is a no-op
      // because we'd have no way to identify the device. The lobby
      // scene wires gamepad joins via {@link joinNextFreeSlotForGamepad}
      // when a button press fires; the cycle key only swaps between
      // human keyboard / AI for slots already claimed.
      continue;
    }
    return joinSlot(state, slotIndex, candidate);
  }
  return state;
}

/**
 * AC 10205 Sub-AC 5 — cycle a slot's AI difficulty through
 * {@link AI_DIFFICULTY_CYCLE_ORDER} (`easy → medium → hard → easy`).
 * Lets a player on a single keyboard pick per-AI-slot difficulty
 * without having to leave + rejoin or open a separate menu.
 *
 * Contract:
 *
 *   • The slot must already be joined AND have `inputType === 'ai'`.
 *     Calling on a human slot or an un-joined slot is a silent no-op
 *     (returns the same state reference) so the lobby UI can wire one
 *     key per slot without per-state branching.
 *
 *   • The cycle is the closed loop `easy → medium → hard → easy`. If a
 *     slot's `aiDifficulty` is missing (which can happen on a slot that
 *     somehow joined as AI without the difficulty field being set),
 *     the cycle starts at `easy` so the next press lands on `medium`.
 *
 *   • Idempotent shape: returns a brand-new state with one slot's
 *     `aiDifficulty` updated. Other fields are preserved untouched
 *     (character/palette/joined/inputType/gamepadIndex) so cycling
 *     difficulty doesn't churn unrelated slot state.
 *
 *   • Throws on out-of-range slot index (1..4), matching the failure
 *     contract of {@link joinSlot} and {@link cycleSlotInputType}.
 *
 * Determinism: pure function — no `Math.random()`, no wall-clock. Two
 * lobbies that pressed the cycle key the same number of times land on
 * the same difficulty for the same slot, which keeps replay headers
 * reproducible across a re-record.
 */
export function cycleSlotAiDifficulty(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `cycleSlotAiDifficulty: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  // Silent no-op on un-joined or non-AI slots — the lobby's
  // contract is "every key is safe to bind on every slot."
  if (!target.joined || target.inputType !== 'ai') return state;

  const currentIdx = AI_DIFFICULTY_CYCLE_ORDER.indexOf(
    target.aiDifficulty ?? DEFAULT_AI_DIFFICULTY,
  );
  // Defensive: if the slot's stored difficulty isn't in the cycle
  // (shouldn't happen since `AiDifficulty` enumerates exactly the
  // three tiers), restart the cycle at index -1 so the next step
  // lands on the head (`easy`).
  const baseIdx = currentIdx >= 0 ? currentIdx : -1;
  const nextIdx = (baseIdx + 1) % AI_DIFFICULTY_CYCLE_ORDER.length;
  const nextDifficulty = AI_DIFFICULTY_CYCLE_ORDER[nextIdx];
  if (!nextDifficulty || nextDifficulty === target.aiDifficulty) return state;

  // AC 10402 Sub-AC 2 — cycling difficulty preserves `ready`, mirroring
  // characterSelect.cycleSlotAiDifficulty. The player has already
  // committed to the slot configuration by readying up; changing the
  // bot's tier is a knob-turn, not a re-pick.
  const nextSlot: LobbySlotState = Object.freeze({
    index: target.index,
    joined: true,
    ready: target.ready,
    inputType: 'ai',
    aiDifficulty: nextDifficulty,
    ...(typeof target.gamepadIndex === 'number'
      ? { gamepadIndex: target.gamepadIndex }
      : {}),
  });

  const nextSlots = state.slots.map((s, i) => (i === targetIdx ? nextSlot : s));
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10205 Sub-AC 5 — explicit setter complement to
 * {@link cycleSlotAiDifficulty}. Used by paths that know the exact
 * tier they want (e.g. a Hard-AI dev-mode harness, a future drop-down
 * UI, or a replay header restoring a recorded slot). Same no-op
 * semantics as the cycle: human/un-joined slots are silently
 * untouched.
 */
export function setSlotAiDifficulty(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
  nextDifficulty: AiDifficulty,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotAiDifficulty: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  if (!target.joined || target.inputType !== 'ai') return state;
  if (target.aiDifficulty === nextDifficulty) return state;

  // AC 10402 Sub-AC 2 — preserve `ready` through the difficulty change
  // (same rationale as cycleSlotAiDifficulty above).
  const nextSlot: LobbySlotState = Object.freeze({
    index: target.index,
    joined: true,
    ready: target.ready,
    inputType: 'ai',
    aiDifficulty: nextDifficulty,
    ...(typeof target.gamepadIndex === 'number'
      ? { gamepadIndex: target.gamepadIndex }
      : {}),
  });

  const nextSlots = state.slots.map((s, i) => (i === targetIdx ? nextSlot : s));
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

// ---------------------------------------------------------------------------
// AC 10402 Sub-AC 2 — ready state + human/AI toggle
// ---------------------------------------------------------------------------

/**
 * AC 10402 Sub-AC 2 — set a slot's `ready` flag explicitly. Used by
 * paths that know the exact value (e.g. a replay header restoring a
 * recorded lobby snapshot). The toggle helper {@link toggleSlotReady}
 * is sugar over this for the common scene wiring.
 *
 * Contract:
 *
 *   • Throws on out-of-range slot index (1..4).
 *   • Invariant `ready ⇒ joined`: an un-joined slot can never be
 *     ready, so calling with `nextReady === true` on an un-joined slot
 *     is a silent no-op (returns the same state reference).
 *   • Idempotent: if the slot's `ready` already matches, returns the
 *     same state reference.
 *
 * Determinism: pure function, no `Math.random()`, no wall-clock.
 */
export function setSlotReady(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
  nextReady: boolean,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotReady: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  // Invariant: ready ⇒ joined. An un-joined slot can never be ready.
  if (nextReady && !target.joined) return state;
  if (target.ready === nextReady) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx ? Object.freeze({ ...s, ready: nextReady }) : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10402 Sub-AC 2 — toggle the ready flag on a slot. Sugar over
 * {@link setSlotReady} for the scene handler that wires the per-slot
 * READY key as a press-to-toggle. Calling on an un-joined slot is a
 * silent no-op (the toggle to `true` would violate `ready ⇒ joined`).
 */
export function toggleSlotReady(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `toggleSlotReady: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  return setSlotReady(state, slotIndex, !target.ready);
}

/**
 * AC 10402 Sub-AC 2 — explicit binary "is this slot a human or an AI
 * bot?" toggle. Distinct from {@link cycleSlotInputType}, which walks
 * a 4-state device cycle (`ai → keyboard_p1 → keyboard_p2 → gamepad`).
 *
 * Contract:
 *
 *   • The slot must already be joined. Calling on an un-joined slot
 *     is a silent no-op (returns the same state reference).
 *   • If the slot is currently AI, flips to a human input. The chosen
 *     human type defaults to the slot's "natural" device half: slot
 *     1 → `keyboard_p1`, slot 2 → `keyboard_p2`. If that half is
 *     already claimed by another slot (exclusivity rule), the toggle
 *     looks for the first un-claimed keyboard half, then falls back
 *     to retaining the existing AI claim. For slots 3..4 the natural
 *     device is `keyboard_p1` since they otherwise have no keyboard
 *     half — but the same exclusivity rule applies.
 *   • If the slot is currently human (any keyboard half OR gamepad),
 *     flips to AI with default medium difficulty. The previous device
 *     fields are dropped so a slot that swapped human → AI doesn't
 *     carry a phantom `gamepadIndex`.
 *   • Toggling drops `ready` back to false (mirrors the device-cycle
 *     contract: the player has to deliberately re-confirm any device
 *     change).
 *
 * Determinism: pure function — no `Math.random()`, no wall-clock.
 * Two lobbies that toggled the same slot the same number of times
 * produce identical states.
 */
export function toggleSlotHumanAi(
  state: LobbyState,
  slotIndex: 1 | 2 | 3 | 4,
): LobbyState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `toggleSlotHumanAi: slotIndex ${slotIndex} is out of range (1..${MAX_LOBBY_SLOTS})`,
    );
  }
  if (!target.joined || target.inputType === null) return state;

  if (target.inputType === 'ai') {
    // AI → human. Pick the first available keyboard half so the player
    // can immediately drive the slot from a keyboard. Gamepad is not
    // selected here because it requires an explicit pad index that
    // only becomes known when a real pad button fires; the player can
    // press their pad's join button to re-claim the slot as gamepad
    // afterward.
    const candidates: ReadonlyArray<InputType> =
      slotIndex === 2
        ? ['keyboard_p2', 'keyboard_p1']
        : ['keyboard_p1', 'keyboard_p2'];
    for (const candidate of candidates) {
      if (!isInputTypeClaimedByOther(state, slotIndex, candidate)) {
        return joinSlot(state, slotIndex, candidate);
      }
    }
    // Both keyboard halves are claimed by other slots → can't promote
    // to human without violating exclusivity. Silent no-op so the
    // scene's render pass short-circuits.
    return state;
  }

  // Human (keyboard or gamepad) → AI bot with default difficulty.
  return joinSlot(state, slotIndex, 'ai');
}

// ---------------------------------------------------------------------------
// Predicates / queries
// ---------------------------------------------------------------------------

/**
 * Number of slots whose `joined === true`. Used by the confirm-path
 * gating ({@link canStartLobby}) and the lobby header to report
 * "2 of 4 joined".
 */
export function getJoinedSlotCount(state: LobbyState): number {
  let n = 0;
  for (const slot of state.slots) {
    if (slot.joined) n += 1;
  }
  return n;
}

/**
 * `true` iff the lobby is ready to advance to character select. The
 * gate is "at least one player joined" — a 1-player practice match
 * is a supported configuration (the player can fight an AI bot they
 * spawn through the character-select scene).
 */
export function canStartLobby(state: LobbyState): boolean {
  return getJoinedSlotCount(state) > 0;
}

/**
 * AC 10402 Sub-AC 2 — number of slots whose `ready === true`. The
 * lobby header surfaces this as "X of Y joined — Z ready" so the
 * player can see at a glance whether the room is fully confirmed.
 */
export function getReadySlotCount(state: LobbyState): number {
  let n = 0;
  for (const slot of state.slots) {
    if (slot.ready) n += 1;
  }
  return n;
}

/**
 * AC 10402 Sub-AC 2 — strict confirmation gate: `true` iff at least
 * one player has joined AND every joined slot has readied up. The
 * lobby's ENTER handler MAY use this as an additional gate before
 * advancing; the looser {@link canStartLobby} is kept for paths that
 * intentionally skip the ready confirm (e.g. a smoke-test harness).
 *
 * The predicate quietly tolerates the impossible-but-theoretically-
 * representable state of an un-joined slot carrying `ready: true` —
 * such a slot would never have been written by these helpers, but
 * since the predicate returns `false` for "ready but not joined" the
 * gate stays robust under hostile JSON loads.
 */
export function canConfirmLobby(state: LobbyState): boolean {
  let joined = 0;
  for (const slot of state.slots) {
    if (!slot.joined) continue;
    joined += 1;
    if (!slot.ready) return false;
  }
  return joined > 0;
}

/**
 * `true` iff the given exclusive input type is already claimed by any
 * slot OTHER than `excludeSlotIndex`. Used by {@link joinSlot} and
 * {@link cycleSlotInputType} to enforce keyboard exclusivity without
 * blocking a self-replay (where a slot is "re-claiming" its own
 * device).
 */
export function isInputTypeClaimedByOther(
  state: LobbyState,
  excludeSlotIndex: 1 | 2 | 3 | 4,
  inputType: InputType,
): boolean {
  for (const slot of state.slots) {
    if (slot.index === excludeSlotIndex) continue;
    if (!slot.joined) continue;
    if (slot.inputType === inputType) return true;
  }
  return false;
}

/**
 * `true` iff the given gamepad index is already claimed by any slot
 * OTHER than `excludeSlotIndex`. Same exclusivity rule as
 * {@link isInputTypeClaimedByOther} but keyed on the physical pad.
 */
export function isGamepadClaimedByOther(
  state: LobbyState,
  excludeSlotIndex: 1 | 2 | 3 | 4,
  gamepadIndex: number,
): boolean {
  for (const slot of state.slots) {
    if (slot.index === excludeSlotIndex) continue;
    if (!slot.joined) continue;
    if (slot.inputType !== 'gamepad') continue;
    if (slot.gamepadIndex === gamepadIndex) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

/**
 * Project the live lobby state onto a `PlayerSlot[]` for
 * `MatchConfig.players`. Only **joined** slots are included — slots
 * that never Pressed Start are dropped so a 2-player match doesn't
 * spawn ghosts in slots 3 and 4.
 *
 * Each joined slot is filled out with a sensible default character +
 * palette ladder (slot index → DEFAULT_CHARACTER_IDS[index-1], palette
 * index → slot index - 1). This keeps the projection self-contained
 * for paths that bypass character select (smoke tests, headless
 * match harnesses); the canonical flow runs the lobby payload
 * through `CharacterSelectScene` which then OVERRIDES character +
 * palette per player before launching the match.
 *
 * The returned array is frozen and each entry is frozen, mirroring
 * the shape `MatchConfig.players` consumers expect.
 */
export function buildPlayerSlotsFromLobby(
  state: LobbyState,
): ReadonlyArray<PlayerSlot> {
  const out: PlayerSlot[] = [];
  for (const slot of state.slots) {
    if (!slot.joined) continue;
    const inputType: InputType =
      slot.inputType ?? defaultInputTypeForSlot(slot.index);
    const characterId =
      DEFAULT_CHARACTER_IDS[(slot.index - 1) % DEFAULT_CHARACTER_IDS.length] ??
      'wolf';
    const paletteIndex = (slot.index - 1) % 8;
    const aiDifficulty: AiDifficulty | undefined =
      inputType === 'ai'
        ? slot.aiDifficulty ?? DEFAULT_AI_DIFFICULTY
        : undefined;

    out.push(
      Object.freeze({
        index: slot.index,
        characterId,
        paletteIndex,
        inputType,
        ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * AC 10402 Sub-AC 2 — short ready-state badge string. Used by the
 * lobby tile's badge row so the player can see at a glance which
 * slots have confirmed.
 *
 *   • Un-joined slot       → "" (no badge — the press-start prompt
 *                            already conveys the state)
 *   • Joined, not ready    → "NOT READY"
 *   • Joined and ready     → "READY ✓"
 *
 * Plain ASCII + check mark — keeps the badge readable in a monospace
 * font without pulling in a sprite atlas.
 */
export function formatLobbyReadyBadge(slot: LobbySlotState): string {
  if (!slot.joined) return '';
  return slot.ready ? 'READY ✓' : 'NOT READY';
}

/**
 * AC 10402 Sub-AC 2 — short human/AI badge string. The lobby tile
 * paints this above the device label so the player sees the binary
 * "is this a person or a bot?" classification independent of the
 * specific device choice.
 */
export function formatLobbyHumanAiBadge(slot: LobbySlotState): string {
  if (!slot.joined || slot.inputType === null) return '';
  return slot.inputType === 'ai' ? 'AI' : 'HUMAN';
}

/**
 * Display label for a slot's input type — used by the lobby tile to
 * paint "P1 — KEYBOARD (WASD)" / "P3 — GAMEPAD #0" / "P4 — AI BOT".
 *
 * Pure projection so the lobby scene's render pass never has to
 * encode label strings inline.
 */
export function formatLobbySlotLabel(slot: LobbySlotState): string {
  if (!slot.joined || slot.inputType === null) return 'PRESS START TO JOIN';
  switch (slot.inputType) {
    case 'keyboard_p1':
      return 'KEYBOARD (WASD)';
    case 'keyboard_p2':
      return 'KEYBOARD (ARROWS)';
    case 'gamepad':
      return typeof slot.gamepadIndex === 'number'
        ? `GAMEPAD #${slot.gamepadIndex}`
        : 'GAMEPAD';
    case 'ai': {
      const diff = (slot.aiDifficulty ?? DEFAULT_AI_DIFFICULTY).toUpperCase();
      return `AI BOT (${diff})`;
    }
    default: {
      // Exhaustiveness guard — TypeScript's union types should make
      // this branch unreachable, but `noUncheckedIndexedAccess` +
      // strict mode want a fallback string.
      const _exhaustive: never = slot.inputType;
      void _exhaustive;
      return '—';
    }
  }
}

/**
 * One slot's rendering projection — the data the Phaser scene's
 * paint pass consumes per tile. Pure function of the underlying
 * slot state; same inputs always produce the same record so the
 * scene can compare snapshots with `===` and skip re-paints.
 */
export interface LobbySlotPreview {
  readonly slotIndex: 1 | 2 | 3 | 4;
  readonly joined: boolean;
  /** AC 10402 Sub-AC 2 — true iff the slot has readied up. */
  readonly ready: boolean;
  readonly headerLabel: string; // "P1", "P2", …
  readonly statusLabel: string; // formatLobbySlotLabel(slot)
  readonly hintLabel: string; // contextual key hint
  /** AC 10402 Sub-AC 2 — short "READY ✓" / "NOT READY" badge. */
  readonly readyBadge: string;
  /** AC 10402 Sub-AC 2 — short "HUMAN" / "AI" classification badge. */
  readonly humanAiBadge: string;
}

/**
 * Optional key labels for the per-slot preview's hint row. Each entry
 * is the printable label for the keyboard key bound to a particular
 * action on that slot ("R", "TAB", "1", etc.). The {@link buildLobbySlotPreview}
 * helper folds present labels into a contextual hint string.
 *
 * Older callers that don't carry every key wiring can omit any field
 * and the hint collapses to the smallest hint that still describes
 * the key actions the caller actually owns.
 */
export interface LobbySlotKeyLabels {
  readonly joinKey: string;
  readonly cycleKey: string;
  readonly diffKey?: string;
  /** AC 10402 Sub-AC 2 — printable label for the per-slot READY key. */
  readonly readyKey?: string;
  /** AC 10402 Sub-AC 2 — printable label for the per-slot human/AI toggle. */
  readonly humanAiKey?: string;
}

/**
 * Build a {@link LobbySlotPreview} for one slot. The hint label is
 * contextual:
 *
 *   • Un-joined            → "Press [N] to JOIN"
 *   • Joined, not ready    → "[R] READY UP — [N] LEAVE — [H] HUMAN/AI — [TAB] cycle — [Q] difficulty"
 *   • Joined, ready        → "[R] UN-READY — [N] LEAVE — [H] HUMAN/AI — [TAB] cycle — [Q] difficulty"
 *
 * Each segment is only emitted when the corresponding key label is
 * supplied — so a caller that hasn't wired the human/AI key gets a
 * shorter hint without that segment, matching the legacy contract.
 *
 * The function supports two call forms for backward compatibility:
 *
 *   1. Positional (legacy):
 *        `buildLobbySlotPreview(slot, '1', 'TAB', 'Q')`
 *      Older tests / callers that pre-date the ready/human-AI work.
 *
 *   2. Object form:
 *        `buildLobbySlotPreview(slot, { joinKey: '1', cycleKey: 'TAB',
 *                                       diffKey: 'Q', readyKey: 'R',
 *                                       humanAiKey: 'H' })`
 *      The canonical form used by AC 10402 Sub-AC 2 wiring.
 */
export function buildLobbySlotPreview(
  slot: LobbySlotState,
  joinKeyLabelOrLabels: string | LobbySlotKeyLabels,
  cycleKeyLabel?: string,
  diffKeyLabel?: string,
): LobbySlotPreview {
  // Normalise both call forms onto a single shape so the formatting
  // logic doesn't have to fork.
  const labels: LobbySlotKeyLabels =
    typeof joinKeyLabelOrLabels === 'string'
      ? {
          joinKey: joinKeyLabelOrLabels,
          cycleKey: cycleKeyLabel ?? 'TAB',
          ...(diffKeyLabel !== undefined ? { diffKey: diffKeyLabel } : {}),
        }
      : joinKeyLabelOrLabels;

  const headerLabel = `P${slot.index}`;
  const statusLabel = formatLobbySlotLabel(slot);
  const readyBadge = formatLobbyReadyBadge(slot);
  const humanAiBadge = formatLobbyHumanAiBadge(slot);

  let hintLabel: string;
  if (!slot.joined) {
    hintLabel = `Press [${labels.joinKey}] to JOIN`;
  } else {
    const segments: string[] = [];
    if (labels.readyKey) {
      segments.push(
        slot.ready
          ? `[${labels.readyKey}] UN-READY`
          : `[${labels.readyKey}] READY UP`,
      );
    }
    segments.push(`[${labels.joinKey}] LEAVE`);
    if (labels.humanAiKey) {
      segments.push(`[${labels.humanAiKey}] HUMAN/AI`);
    }
    segments.push(`[${labels.cycleKey}] cycle device`);
    if (slot.inputType === 'ai' && labels.diffKey) {
      segments.push(`[${labels.diffKey}] cycle difficulty`);
    }
    hintLabel = segments.join(' — ');
  }
  return Object.freeze({
    slotIndex: slot.index,
    joined: slot.joined,
    ready: slot.ready,
    headerLabel,
    statusLabel,
    hintLabel,
    readyBadge,
    humanAiBadge,
  });
}

/**
 * Build the full 4-tile preview projection. One entry per slot in
 * slot order. Used by the Phaser scene's per-frame re-paint and by
 * tests that want to assert the whole render surface in one
 * snapshot.
 *
 * `joinKeyLabels`, `cycleKeyLabels`, and `diffKeyLabels` are arrays
 * of length 4 (one per slot) so each tile can paint its own slot-
 * specific hint. `diffKeyLabels`, `readyKeyLabels`, and
 * `humanAiKeyLabels` are optional for backward compatibility — when
 * omitted, the corresponding hint segment is dropped.
 */
export function buildLobbyPreviews(
  state: LobbyState,
  joinKeyLabels: ReadonlyArray<string>,
  cycleKeyLabels: ReadonlyArray<string>,
  diffKeyLabels?: ReadonlyArray<string>,
  readyKeyLabels?: ReadonlyArray<string>,
  humanAiKeyLabels?: ReadonlyArray<string>,
): ReadonlyArray<LobbySlotPreview> {
  return Object.freeze(
    state.slots.map((slot, i) =>
      buildLobbySlotPreview(slot, {
        joinKey: joinKeyLabels[i] ?? `${i + 1}`,
        cycleKey: cycleKeyLabels[i] ?? 'TAB',
        ...(diffKeyLabels?.[i] !== undefined
          ? { diffKey: diffKeyLabels[i] }
          : {}),
        ...(readyKeyLabels?.[i] !== undefined
          ? { readyKey: readyKeyLabels[i] }
          : {}),
        ...(humanAiKeyLabels?.[i] !== undefined
          ? { humanAiKey: humanAiKeyLabels[i] }
          : {}),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Hand-off payload (Phaser-free, JSON-friendly)
// ---------------------------------------------------------------------------

/**
 * Compact, JSON-friendly payload the Phaser scene forwards to
 * `CharacterSelectScene` (and through `ModeSelectScene` /
 * `StageSelectScene` along the way). Strips the Phaser-specific
 * concerns so the scene-data is replay-header-safe.
 *
 *   • `slots` is the same `LobbySlotState[]` projection without the
 *     readonly wrapper guarantees being lost (Phaser scene-data is
 *     deeply structural-cloned, so we ship plain frozen objects).
 *   • Empty arrays are valid — a lobby that produced zero joined
 *     slots would have refused to advance via `canStartLobby`, so
 *     this case is for defence-in-depth only.
 */
export interface LobbyHandoffPayload {
  readonly slots: ReadonlyArray<LobbySlotState>;
}

/**
 * Build the hand-off payload from the live lobby state. Filters out
 * un-joined slots so the downstream scene only has to think about
 * the slots a player actually claimed.
 */
export function buildLobbyHandoffPayload(state: LobbyState): LobbyHandoffPayload {
  const joinedSlots = state.slots.filter((s) => s.joined);
  return Object.freeze({ slots: Object.freeze(joinedSlots) });
}
