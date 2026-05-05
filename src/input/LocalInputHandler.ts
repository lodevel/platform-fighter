/**
 * Local keyboard input handler — AC 203 Sub-AC 3.
 *
 * Maps two keyboard players (P1 = WASD + adjacent keys, P2 = Arrow keys
 * + Numpad cluster) onto the {@link CharacterInput} shape consumed by
 * `Character.applyInput`. The handler is the bridge between raw browser
 * key state and the deterministic per-fixed-step input record the
 * physics / replay layers expect.
 *
 * Architecture
 * ------------
 *
 * The handler is split into three parts so it stays Phaser-decoupled:
 *
 *   1. {@link KeyBindings} — pure-data per-action → keyCode map. The
 *      ontology calls this `key_bindings`. Default tables for P1 and P2
 *      are exported as `DEFAULT_P1_BINDINGS` / `DEFAULT_P2_BINDINGS`;
 *      the M5 rebinding screen will mutate these via `setBindings`.
 *   2. {@link KeyboardSource} — a one-method interface (`isDown(code)`)
 *      that abstracts the keyboard hardware. The unit-test suite passes
 *      a `Map`-backed mock; the running game uses
 *      {@link createPhaserKeyboardSource} which wraps
 *      `scene.input.keyboard.addKey(...)`.
 *   3. {@link LocalInputHandler} — composes the two. Each fixed step,
 *      the gameplay scene calls `sample(playerIndex)` to read out a
 *      `CharacterInput` snapshot for the player, then forwards it to
 *      that player's `Character.applyInput`.
 *
 * Determinism
 * -----------
 *
 *   • `sample()` is a pure function of the keyboard source's current
 *     state plus the active bindings — no `Math.random()`, no wall-clock
 *     reads, no edge-detection state stored inside the handler.
 *     Rising-edge logic (jump press, attack press) lives in `Character`
 *     where it can stay frame-aligned with the physics step. The
 *     handler simply forwards held state.
 *   • The replay system can record either the raw key bitmap or the
 *     resulting `CharacterInput` and replay it deterministically because
 *     both are plain serialisable values.
 *
 * Player-slot constraint
 * ----------------------
 *
 * The Seed limits keyboard players to exactly 2 (P1 + P2 sharing one
 * keyboard). Players 3 and 4 are filled by Gamepad API or AI, both of
 * which produce `CharacterInput` records through their own paths. The
 * type {@link KeyboardPlayerIndex} is therefore `1 | 2` — the compiler
 * refuses any caller that asks the keyboard handler for player 3 or 4.
 */

import type Phaser from 'phaser';
import type { CharacterInput } from '../characters/Character';
import { KEY_CODE } from './keyCodes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Vocabulary of player actions supported by the handler. Covers the
 * full ~10-move kit defined in the project Seed (jab / tilt / smash /
 * aerial / special / grab / shield / dodge / taunt) so the M5 rebinding
 * screen has stable identifiers to work with even though only a subset
 * (`left`, `right`, `jump`, `attack`, `down → dropThrough`) is wired
 * through to gameplay in M1.
 *
 * The `up` and `down` directional actions are kept distinct from
 * `jump` so that:
 *   • a future "tap-up to jump" toggle can map either both or just
 *     `up` to the jump command without touching the directional read;
 *   • `down` can carry the drop-through-platform intent on its own.
 */
export type InputAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'attack'
  | 'special'
  | 'shield'
  | 'grab'
  | 'dodge'
  | 'taunt';

/** Read-only `InputAction` → `KeyboardEvent.keyCode` map. */
export type KeyBindings = Readonly<Record<InputAction, number>>;

/** Keyboard slots the handler exposes — exactly P1 and P2 by Seed constraint. */
export type KeyboardPlayerIndex = 1 | 2;

/**
 * Minimal hardware abstraction. The handler reads the world through
 * exactly this surface so the unit test suite can mock keyboard state
 * without dragging in jsdom or Phaser globals.
 */
export interface KeyboardSource {
  /** True iff the key with the given `KeyboardEvent.keyCode` is held. */
  isDown(keyCode: number): boolean;
}

/** Constructor options. Both binding tables default to the canonical layout. */
export interface LocalInputHandlerOptions {
  readonly p1?: KeyBindings;
  readonly p2?: KeyBindings;
}

// ---------------------------------------------------------------------------
// Default bindings
// ---------------------------------------------------------------------------

/**
 * Player 1 default binding table — WASD movement plus an attack cluster
 * on the right hand of the WASD layout (F G H T R).
 *
 * Why F/G/H/T/R: the attack keys sit immediately to the right of WASD
 * so a single hand can cover both. T (one row up) is grab because a
 * Smash-style grab is a "premeditated" input you wind up for; R is
 * taunt. The layout doesn't collide with browser shortcuts (Ctrl+W
 * closes the tab; Alt+S triggers in-page search on some sites).
 *
 * `up` and `jump` both bind to W so that the standard "press up to
 * jump" feel works out of the box. The two slots are kept separate in
 * the table itself so the M5 rebinding UI can split them later (e.g.
 * for players who prefer space-to-jump).
 */
export const DEFAULT_P1_BINDINGS: KeyBindings = Object.freeze({
  left: KEY_CODE.A,
  right: KEY_CODE.D,
  up: KEY_CODE.W,
  down: KEY_CODE.S,
  jump: KEY_CODE.W,
  attack: KEY_CODE.F,
  special: KEY_CODE.G,
  shield: KEY_CODE.H,
  grab: KEY_CODE.T,
  // AC 60302 Sub-AC 2 — dodge sits on R, mirroring the canonical
  // `DEFAULT_KEYBOARD_P1_BINDINGS` layout in `src/types/bindings.ts`.
  // R is one row above the attack cluster so a panic dodge doesn't
  // accidentally fire an attack.
  dodge: KEY_CODE.R,
  // Taunt remains a reserved slot — bound to a key that does not
  // collide with the dodge key. Keyboard layouts are tight on the M1
  // build so we double up: both `dodge` and `taunt` map to R until M5
  // adds the dedicated rebinding screen and the player can split them.
  taunt: KEY_CODE.R,
});

/**
 * Player 2 default binding table — Arrow keys for movement plus the
 * Numpad cluster for attacks.
 *
 * Why Numpad: a player using arrow keys for movement on a standard
 * laptop keyboard has the right hand sitting near the Numpad cluster
 * (when present); this gives them a self-contained right-hand layout
 * that doesn't clash with P1's WASD-cluster keys. Laptops without a
 * Numpad will fall back to the rebinding screen in M5.
 */
export const DEFAULT_P2_BINDINGS: KeyBindings = Object.freeze({
  left: KEY_CODE.ARROW_LEFT,
  right: KEY_CODE.ARROW_RIGHT,
  up: KEY_CODE.ARROW_UP,
  down: KEY_CODE.ARROW_DOWN,
  jump: KEY_CODE.ARROW_UP,
  attack: KEY_CODE.NUMPAD_1,
  special: KEY_CODE.NUMPAD_2,
  shield: KEY_CODE.NUMPAD_3,
  grab: KEY_CODE.NUMPAD_4,
  // AC 60302 Sub-AC 2 — Numpad-5 is the canonical P2 dodge key
  // (mirrors `DEFAULT_KEYBOARD_P2_BINDINGS`). Taunt doubles up on the
  // same key for M1 since the keyboard slot is shared until M5.
  dodge: KEY_CODE.NUMPAD_5,
  taunt: KEY_CODE.NUMPAD_5,
});

// ---------------------------------------------------------------------------
// LocalInputHandler
// ---------------------------------------------------------------------------

/**
 * Stateless-by-design keyboard handler. Holds bindings + a reference to
 * the keyboard source; everything else is recomputed on each `sample()`
 * call from the live key state.
 *
 * Lifecycle:
 *
 *   const source = createPhaserKeyboardSource(scene);
 *   const input = new LocalInputHandler(source);
 *   // every fixed step, before the character's applyInput call:
 *   const p1Input = input.sample(1);
 *   wolf.applyInput(p1Input);
 *   const p2Input = input.sample(2);
 *   cat.applyInput(p2Input);
 */
export class LocalInputHandler {
  private readonly source: KeyboardSource;
  private readonly bindings: Map<KeyboardPlayerIndex, KeyBindings>;

  constructor(source: KeyboardSource, options: LocalInputHandlerOptions = {}) {
    this.source = source;
    this.bindings = new Map<KeyboardPlayerIndex, KeyBindings>();
    this.bindings.set(1, options.p1 ?? DEFAULT_P1_BINDINGS);
    this.bindings.set(2, options.p2 ?? DEFAULT_P2_BINDINGS);
  }

  /**
   * Replace the binding table for a single keyboard player. The M5
   * rebinding screen calls this; gameplay code should not need to.
   * Throws on any missing action so a partial table can't silently
   * leave the player unable to jump or attack.
   */
  setBindings(player: KeyboardPlayerIndex, bindings: KeyBindings): void {
    assertCompleteBindings(bindings);
    this.bindings.set(player, bindings);
  }

  /** Read-only view of a player's current binding table. */
  getBindings(player: KeyboardPlayerIndex): KeyBindings {
    return this.bindings.get(player)!;
  }

  /** True iff the keyboard reports the key bound to `action` is held. */
  isActionDown(player: KeyboardPlayerIndex, action: InputAction): boolean {
    const code = this.bindings.get(player)![action];
    return this.source.isDown(code);
  }

  /**
   * Build a per-frame {@link CharacterInput} record for the requested
   * keyboard player. Conventions:
   *
   *   • `moveX = -1 | 0 | +1` — left and right cancel out so a player
   *     mashing both produces neutral, the simplest and most
   *     predictable behaviour. Diagonal stick values are a gamepad
   *     concern, not a keyboard one.
   *   • `jump` and `attack` forward the held state of the bound key.
   *     `Character` performs its own rising-edge detection so the
   *     handler stays stateless and the replay system can re-emit
   *     identical held bitmaps without bookkeeping.
   *   • `dropThrough = down && jump`. Standard Smash convention — the
   *     character / platform layer decides whether the fighter is
   *     actually on a pass-through platform and only converts intent
   *     into a phase-shift when both conditions line up. Forwarding
   *     the intent here keeps the handler decoupled from stage state.
   */
  sample(player: KeyboardPlayerIndex): CharacterInput {
    const left = this.isActionDown(player, 'left');
    const right = this.isActionDown(player, 'right');
    const down = this.isActionDown(player, 'down');
    const jump = this.isActionDown(player, 'jump');
    const attack = this.isActionDown(player, 'attack');
    // AC 60301 Sub-AC 1 — held state of the shield key flows directly
    // through to `Character.applyInput`. The runtime decides whether
    // the shield can be raised this frame (cooldowns, stun, broken
    // state) so the handler stays stateless.
    const shield = this.isActionDown(player, 'shield');
    // AC 60302 Sub-AC 2 — held state of the dodge key flows directly
    // through to `Character.applyInput`. The runtime owns the rising-
    // edge gate and the variant classifier (spot vs. roll vs. air) so
    // the handler stays stateless. The keyboard default binds dodge
    // to `R` (P1) / Numpad-`0` (P2) — see `DEFAULT_P1_BINDINGS` /
    // `DEFAULT_P2_BINDINGS` for the layout rationale.
    const dodge = this.isActionDown(player, 'dodge');

    let moveX = 0;
    if (left) moveX -= 1;
    if (right) moveX += 1;

    return {
      moveX,
      jump,
      attack,
      shield,
      dodge,
      dropThrough: down && jump,
    };
  }
}

// ---------------------------------------------------------------------------
// Phaser adapter
// ---------------------------------------------------------------------------

/**
 * Wrap a Phaser scene's keyboard plugin behind the {@link KeyboardSource}
 * contract. `addKey` is lazily called on first read for each keyCode so
 * we don't allocate Phaser `Key` instances for actions a player never
 * presses.
 *
 * Phaser's `addKey` enables capture by default — that means arrow keys
 * won't scroll the page and Tab won't move browser focus during a match.
 * The cache prevents re-registering the same key on every poll (which
 * would still work but allocates a wrapper each time).
 */
export function createPhaserKeyboardSource(scene: Phaser.Scene): KeyboardSource {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    throw new Error(
      'createPhaserKeyboardSource: scene.input.keyboard is unavailable — ' +
        'did the game config disable keyboard input?',
    );
  }
  const cache = new Map<number, Phaser.Input.Keyboard.Key>();
  return {
    isDown(keyCode: number): boolean {
      let key = cache.get(keyCode);
      if (!key) {
        key = keyboard.addKey(keyCode, /* enableCapture */ true);
        cache.set(keyCode, key);
      }
      return key.isDown;
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REQUIRED_ACTIONS: ReadonlyArray<InputAction> = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'attack',
  'special',
  'shield',
  'grab',
  'dodge',
  'taunt',
];

/**
 * Throw if a binding table is missing any action or assigns a
 * non-positive keyCode. We don't deduplicate here — a player who wants
 * `up` and `jump` mapped to the same key (the default!) is doing
 * exactly what the layout intends.
 */
function assertCompleteBindings(bindings: KeyBindings): void {
  for (const action of REQUIRED_ACTIONS) {
    const code = (bindings as Record<string, unknown>)[action];
    if (typeof code !== 'number' || !Number.isFinite(code) || code <= 0) {
      throw new Error(
        `LocalInputHandler.setBindings: action '${action}' is missing or has an invalid keyCode`,
      );
    }
  }
}
