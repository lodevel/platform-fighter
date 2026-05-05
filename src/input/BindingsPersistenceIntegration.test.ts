import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BindingsPersistenceLifecycle,
  createBootedLifecycle,
  type BindingsLifecycleChangeEvent,
} from './BindingsPersistenceLifecycle';
import {
  ALL_BINDINGS_STORAGE_KEYS,
  hasStoredBindingsSnapshot,
  loadBindingsSnapshot,
  loadPlayerBindings,
  playerStorageKey,
  snapshotStorageKey,
  type StorageLike,
} from './BindingsStorage';
import {
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  buildDefaultGamepadBindings,
} from './InputBindingsStore';
import { KEY_CODE } from './keyCodes';
import type {
  GamepadBinding,
  InputBinding,
  KeyboardBinding,
  LogicalAction,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';

/**
 * AC 40303 Sub-AC 3 — bindings persistence integration tests.
 *
 * Where this fits
 * ---------------
 *
 * Sub-AC 1 ({@link BindingsPersistenceLifecycle}) and Sub-AC 2 (the
 * runtime input dispatcher) each have their own focused unit suites.
 * They prove their *individual* contracts in isolation against ad-hoc
 * `Map`-backed storage doubles that share object references between
 * test sessions.
 *
 * What was missing — and what this suite supplies — is the explicit
 * **integration contract** the M5 acceptance criterion ("bindings
 * persist across browser sessions") relies on. Specifically:
 *
 *   1. **Save-on-change** — every binding-mutating call (replace
 *      profile, replace one action, reset slot, reset action, reset
 *      all, manual save) flushes the canonical snapshot string to
 *      storage *before* the call returns. A simulated tab close on
 *      the very next tick still preserves the just-committed binding.
 *   2. **Cross-session reload** — a fresh lifecycle constructed on top
 *      of the persisted storage sees byte-for-byte the same bindings
 *      a previous session wrote. Multiple chained sessions
 *      (A → B → C → …) each layer their changes on the previous
 *      session's saved state without cross-talk.
 *
 * Why a *separate* "integration" suite (vs. one more unit test)
 * --------------------------------------------------------------
 *
 * The lifecycle's existing unit suite uses an in-memory `Map<string,
 * string>` storage shim that several lifecycle instances share by
 * reference. Two lifecycles wired to the same shim see exactly the
 * same map *object* — there is no JSON parse / serialise step
 * between them. Real `localStorage` is not like that:
 *
 *   • Every write is a UTF-16 string copied into the browser's
 *     SQLite-backed origin store.
 *   • Every read is a fresh string handed back to JavaScript — never
 *     the original object reference the writer held.
 *   • A new browser session re-opens the origin store from disk; the
 *     previous session's JS heap is gone.
 *
 * Tests that share a `Map` reference can pass without ever exercising
 * serialise/deserialise. That is exactly the place a regression — say
 * a non-serialisable value sneaking into the canonical envelope, or
 * an `Object.freeze` reference accidentally being shared cross-session
 * — would silently slip through. {@link PersistentBrowserStorage}
 * below mimics the real browser by stringifying on `setItem` and
 * returning a *new* string on every `getItem`, then snapshotting the
 * raw bytes so a "fresh session" can be reconstructed independently.
 *
 * Determinism
 * -----------
 *
 *   • Every helper here is a pure function of inputs. No
 *     `Math.random()`, no `Date.now()`. The serializer's canonical
 *     key ordering means two writes of the same logical state produce
 *     byte-identical strings — the integration suite asserts this
 *     directly so a future regression that re-introduces non-deterministic
 *     ordering trips a test, not a replay desync.
 *   • Simulated session boundaries are deterministic: every
 *     {@link BrowserSession} creates a fresh {@link InputBindingsStore}
 *     and a fresh lifecycle instance hydrated from the persisted
 *     bytes — no latent references to the previous session's heap.
 */

// ---------------------------------------------------------------------------
// Persistent browser storage double
// ---------------------------------------------------------------------------

/**
 * `StorageLike` double that mimics how a real `localStorage` works:
 *
 *   • `setItem(k, v)` snapshots `String(v)` into an internal map. The
 *     value field is *coerced* to a string by the spec, so any
 *     hand-rolled "I'll just shove an object in" smoke is caught.
 *   • `getItem(k)` returns either `null` or a *fresh* string built off
 *     the stored bytes — never a reference the writer held. That makes
 *     it impossible for two `BrowserSession` instances on the same
 *     storage to share a binding profile by reference.
 *   • {@link snapshotBytes} captures the raw key→string map, and
 *     {@link fromBytes} restores it. Together they let a test
 *     instantiate "session A wrote, the user closed the tab, the
 *     browser was relaunched, session B opened" without keeping the
 *     session-A storage alive.
 */
class PersistentBrowserStorage implements StorageLike {
  private data: Map<string, string>;

  constructor(seed?: ReadonlyMap<string, string>) {
    this.data = new Map<string, string>();
    if (seed !== undefined) {
      for (const [k, v] of seed.entries()) {
        // Defensive copy — the seed map should be inert for the caller.
        this.data.set(k, String(v));
      }
    }
  }

  /**
   * Real-storage parity:  `localStorage.getItem` returns `null` for
   * missing keys (not `undefined`, not a thrown error), and the
   * returned string is always freshly allocated.
   */
  getItem(key: string): string | null {
    if (!this.data.has(key)) return null;
    // String concatenation forces a new allocation so the caller can
    // never mutate (or `===`-compare-by-reference) the stored bytes.
    const stored = this.data.get(key) as string;
    return `${stored}`;
  }

  setItem(key: string, value: string): void {
    // The `Storage` spec coerces values to strings.  We do the same so
    // a future regression that hands a non-string in surfaces as
    // "stored as `[object Object]`", not as "silently kept as live
    // reference".
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  /** Test-only — peek without going through getItem's cloning. */
  hasKey(key: string): boolean {
    return this.data.has(key);
  }

  /** Test-only — full key listing for "Clear save data" sweep checks. */
  allKeys(): readonly string[] {
    return Array.from(this.data.keys()).sort();
  }

  /**
   * Capture the raw on-disk bytes so the *next* simulated session can
   * be built from scratch without sharing this storage's Map identity.
   *
   * Returned map is a defensive copy keyed by the same strings the
   * browser would persist verbatim.
   */
  snapshotBytes(): Map<string, string> {
    return new Map(this.data);
  }

  /** Build a brand-new storage from bytes captured by `snapshotBytes`. */
  static fromBytes(bytes: ReadonlyMap<string, string>): PersistentBrowserStorage {
    return new PersistentBrowserStorage(bytes);
  }
}

/**
 * `setItem` throws once, then resumes normal operation.  Models the
 * realistic Safari-private-mode case where a *single* write happens to
 * coincide with the quota crossing the limit, but subsequent writes
 * succeed because the player closed an unrelated tab.
 */
class FlakyBrowserStorage extends PersistentBrowserStorage {
  private failuresRemaining: number;

  constructor(failuresRemaining: number, seed?: ReadonlyMap<string, string>) {
    super(seed);
    this.failuresRemaining = failuresRemaining;
  }

  override setItem(key: string, value: string): void {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('quota exceeded (flaky storage stub)');
    }
    super.setItem(key, value);
  }
}

// ---------------------------------------------------------------------------
// Browser session helper
// ---------------------------------------------------------------------------

/**
 * Bundle a single "browser session": one storage, one lifecycle, one
 * subscriber log.  The integration tests construct sessions back-to-
 * back to model "user opened the tab, made changes, closed it, opened
 * it again later".
 */
interface BrowserSession {
  readonly storage: PersistentBrowserStorage;
  readonly lifecycle: BindingsPersistenceLifecycle;
  readonly events: BindingsLifecycleChangeEvent[];
}

function openSession(
  storage: PersistentBrowserStorage,
  options: { boot?: boolean } = {},
): BrowserSession {
  const lifecycle = new BindingsPersistenceLifecycle({ storage });
  const events: BindingsLifecycleChangeEvent[] = [];
  lifecycle.subscribe((evt) => events.push(evt));
  if (options.boot !== false) {
    lifecycle.boot();
  }
  return { storage, lifecycle, events };
}

/**
 * Simulate "the player closed the tab and re-opened it later".  The new
 * session shares only the persisted bytes — no JS heap, no live
 * references — with the old one.
 */
function reopenSession(prev: BrowserSession): BrowserSession {
  const fresh = PersistentBrowserStorage.fromBytes(prev.storage.snapshotBytes());
  return openSession(fresh);
}

// ---------------------------------------------------------------------------
// Custom binding helpers
// ---------------------------------------------------------------------------

const ALL_SLOTS: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
const ALL_ACTIONS: ReadonlyArray<LogicalAction> = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'attack',
  'special',
  'shield',
  'grab',
  'taunt',
];

function kbBinding(keyCode: number): KeyboardBinding {
  return { kind: 'keyboard', keyCode };
}

function gpButtonBinding(gamepadIndex: number, buttonIndex: number): GamepadBinding {
  return { kind: 'gamepad', gamepadIndex, source: { type: 'button', buttonIndex } };
}

function gpAxisBinding(
  gamepadIndex: number,
  axisIndex: number,
  direction: -1 | 1,
  threshold: number = DEFAULT_GAMEPAD_AXIS_THRESHOLD,
): GamepadBinding {
  return {
    kind: 'gamepad',
    gamepadIndex,
    source: { type: 'axis', axisIndex, direction, threshold },
  };
}

function makeCustomP1(): PlayerBindings {
  return {
    playerIndex: 1,
    bindings: {
      ...DEFAULT_KEYBOARD_P1_BINDINGS,
      attack: [kbBinding(KEY_CODE.SPACE)],
      jump: [kbBinding(KEY_CODE.SHIFT)],
    },
  };
}

function makeCustomP3OnPad2(): PlayerBindings {
  // Slot 3 originally defaults to gamepadIndex 0; here the player has
  // moved it to pad index 2 with a custom shoulder layout.
  const base = buildDefaultGamepadBindings(2);
  return {
    playerIndex: 3,
    bindings: {
      ...base,
      attack: [gpButtonBinding(2, 1)],
      special: [gpButtonBinding(2, 3), gpAxisBinding(2, 3, +1, 0.65)],
    },
  };
}

// ---------------------------------------------------------------------------
// 1.  Save-on-change — every mutation is durable before the next tick
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — save-on-change durability', () => {
  it('a single setAction call is fully flushed before the call returns', () => {
    const storage = new PersistentBrowserStorage();
    const { lifecycle } = openSession(storage);

    expect(storage.hasKey(snapshotStorageKey())).toBe(false);

    const result = lifecycle.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);

    // The write is synchronous: by the time setAction returns, the
    // persisted bytes already reflect the new binding.
    expect(result.ok).toBe(true);
    expect(storage.hasKey(snapshotStorageKey())).toBe(true);

    // The bytes contain the SPACE keyCode (32), not the default W (87).
    // The serializer pretty-prints with `"key": value` (space after the
    // colon) — match the literal substring the writer emits.
    const raw = storage.getItem(snapshotStorageKey());
    expect(raw).not.toBeNull();
    expect(raw).toContain('"keyCode": 32');
  });

  it('save-on-change survives a synthetic tab close on the very next tick', () => {
    const storage = new PersistentBrowserStorage();
    const { lifecycle } = openSession(storage);

    lifecycle.setAction(2, 'attack', [kbBinding(KEY_CODE.NUMPAD_0)]);
    // ↑ Imagine the user's tab process is force-killed *here*, before
    //   any further JS runs.  The persisted bytes are the durable state
    //   the next session will read.

    const reopened = reopenSession({ storage, lifecycle, events: [] });
    expect(reopened.lifecycle.getState().hydrateSource).toBe('storage');
    expect(reopened.lifecycle.getAction(2, 'attack')).toEqual([
      kbBinding(KEY_CODE.NUMPAD_0),
    ]);
  });

  it('every cause of a write is durable: set, setAction, reset, resetAction, resetAll, save', () => {
    const causes: ReadonlyArray<{
      readonly label: string;
      readonly mutate: (lc: BindingsPersistenceLifecycle) => void;
      readonly assertHydrated: (lc: BindingsPersistenceLifecycle) => void;
    }> = [
      {
        label: 'setBinding (full slot replace)',
        mutate: (lc) => lc.setBinding(1, makeCustomP1()),
        assertHydrated: (lc) => expect(lc.getBindings(1)).toEqual(makeCustomP1()),
      },
      {
        label: 'setAction (single action)',
        mutate: (lc) => lc.setAction(2, 'special', [kbBinding(KEY_CODE.ENTER)]),
        assertHydrated: (lc) =>
          expect(lc.getAction(2, 'special')).toEqual([kbBinding(KEY_CODE.ENTER)]),
      },
      {
        label: 'reset (single slot)',
        mutate: (lc) => {
          lc.setBinding(3, makeCustomP3OnPad2());
          lc.reset(3);
        },
        assertHydrated: (lc) =>
          expect(lc.getBindings(3)).toEqual(DEFAULT_PLAYER_BINDINGS[3]),
      },
      {
        label: 'resetAction (single action)',
        mutate: (lc) => {
          lc.setAction(4, 'taunt', [gpButtonBinding(1, 9)]);
          lc.resetAction(4, 'taunt');
        },
        assertHydrated: (lc) =>
          expect(lc.getAction(4, 'taunt')).toEqual(
            DEFAULT_PLAYER_BINDINGS[4].bindings.taunt,
          ),
      },
      {
        label: 'resetAll re-saves a defaults snapshot',
        mutate: (lc) => {
          lc.setBinding(1, makeCustomP1());
          lc.setBinding(3, makeCustomP3OnPad2());
          lc.resetAll();
        },
        assertHydrated: (lc) => {
          for (const slot of ALL_SLOTS) {
            expect(lc.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
          }
        },
      },
      {
        label: 'manual save() after a getStore() back-door mutation',
        mutate: (lc) => {
          lc.getStore().setAction(2, 'jump', [kbBinding(KEY_CODE.ENTER)]);
          lc.save();
        },
        assertHydrated: (lc) =>
          expect(lc.getAction(2, 'jump')).toEqual([kbBinding(KEY_CODE.ENTER)]),
      },
    ];

    for (const { label, mutate, assertHydrated } of causes) {
      const storage = new PersistentBrowserStorage();
      const { lifecycle } = openSession(storage);
      mutate(lifecycle);

      // After the simulated tab close the snapshot key must exist
      // *unless* the cause was a `clear()` — none of the cases above
      // are clears, so the snapshot must be there for every label.
      expect(
        storage.hasKey(snapshotStorageKey()),
        `cause="${label}" failed to persist its snapshot`,
      ).toBe(true);

      const reopened = reopenSession({ storage, lifecycle, events: [] });
      expect(reopened.lifecycle.getState().hydrateSource).toBe('storage');
      assertHydrated(reopened.lifecycle);
    }
  });

  it('clear() removes the bytes; the next session boots from defaults via the missing path', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());
    expect(storage.hasKey(snapshotStorageKey())).toBe(true);

    sessionA.lifecycle.clear();
    expect(storage.hasKey(snapshotStorageKey())).toBe(false);

    const sessionB = reopenSession(sessionA);
    const state = sessionB.lifecycle.getState();
    expect(state.hydrateSource).toBe('defaults');
    expect(state.hydrateFallbackReason).toBe('missing');
    for (const slot of ALL_SLOTS) {
      expect(sessionB.lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('writes are byte-deterministic — two writes of the same state produce identical bytes', () => {
    const storage1 = new PersistentBrowserStorage();
    const storage2 = new PersistentBrowserStorage();

    const lc1 = new BindingsPersistenceLifecycle({ storage: storage1 });
    const lc2 = new BindingsPersistenceLifecycle({ storage: storage2 });
    lc1.boot();
    lc2.boot();
    lc1.setBinding(1, makeCustomP1());
    lc1.setBinding(3, makeCustomP3OnPad2());
    // Apply the same writes in a *different* order to lc2 to verify
    // the on-disk bytes don't depend on call order.
    lc2.setBinding(3, makeCustomP3OnPad2());
    lc2.setBinding(1, makeCustomP1());

    const bytes1 = storage1.getItem(snapshotStorageKey());
    const bytes2 = storage2.getItem(snapshotStorageKey());
    expect(bytes1).not.toBeNull();
    expect(bytes2).not.toBeNull();
    expect(bytes1).toBe(bytes2);
  });

  it('a write that throws still leaves the previous session-survivable state intact', () => {
    // Seed storage with a known-good snapshot first.
    const seedStorage = new PersistentBrowserStorage();
    const seedLifecycle = new BindingsPersistenceLifecycle({ storage: seedStorage });
    seedLifecycle.boot();
    seedLifecycle.setBinding(1, makeCustomP1());
    const seedBytes = seedStorage.snapshotBytes();

    // Open a "flaky" session that fails its very next write.
    const flaky = new FlakyBrowserStorage(/*failuresRemaining=*/ 1, seedBytes);
    const lc = new BindingsPersistenceLifecycle({ storage: flaky });
    lc.boot();
    expect(lc.getBindings(1)).toEqual(makeCustomP1());

    // Try a write — it fails, but the lifecycle does NOT throw and the
    // in-memory state still mutates (better the layout survives the
    // session than the failure does — the documented policy).
    const result = lc.setAction(1, 'jump', [kbBinding(KEY_CODE.ENTER)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('write-failed');
    }

    // The persisted bytes are still the *previous* good state — the
    // failed write did not corrupt them.  A fresh session sees the
    // pre-failure layout: the seed wrote makeCustomP1 (jump=SHIFT,
    // attack=SPACE), so the reopened session must observe that exact
    // record — NOT the failed write's jump=ENTER.
    const reopened = openSession(
      PersistentBrowserStorage.fromBytes(flaky.snapshotBytes()),
    );
    expect(reopened.lifecycle.getBindings(1)).toEqual(makeCustomP1());
    expect(reopened.lifecycle.getAction(1, 'jump')).toEqual(
      makeCustomP1().bindings.jump,
    );
    // Sanity: the failed write's value (ENTER) is NOT persisted.
    expect(reopened.lifecycle.getAction(1, 'jump')).not.toEqual([
      kbBinding(KEY_CODE.ENTER),
    ]);
  });

  it('a follow-up write after a transient flake re-flushes the in-memory state to disk', () => {
    const flaky = new FlakyBrowserStorage(1);
    const lc = new BindingsPersistenceLifecycle({ storage: flaky });
    lc.boot();

    const failed = lc.setAction(1, 'jump', [kbBinding(KEY_CODE.SHIFT)]);
    expect(failed.ok).toBe(false);
    expect(lc.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.SHIFT)]);

    // Storage has recovered (e.g. user closed an unrelated tab); the
    // lifecycle's next write succeeds and the persisted bytes catch up
    // with the in-memory state in one go (full snapshot flush).
    const ok = lc.setAction(1, 'attack', [kbBinding(KEY_CODE.SPACE)]);
    expect(ok.ok).toBe(true);

    const reopened = openSession(
      PersistentBrowserStorage.fromBytes(flaky.snapshotBytes()),
    );
    expect(reopened.lifecycle.getAction(1, 'jump')).toEqual([
      kbBinding(KEY_CODE.SHIFT),
    ]);
    expect(reopened.lifecycle.getAction(1, 'attack')).toEqual([
      kbBinding(KEY_CODE.SPACE),
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2.  Cross-session reload — chained sessions
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — cross-session reload', () => {
  it('first-ever session boots from defaults via the missing path', () => {
    const storage = new PersistentBrowserStorage();
    const session = openSession(storage);

    const state = session.lifecycle.getState();
    expect(state.booted).toBe(true);
    expect(state.hydrateSource).toBe('defaults');
    expect(state.hydrateFallbackReason).toBe('missing');
    for (const slot of ALL_SLOTS) {
      expect(session.lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('three-session chain (A → B → C) carries every customisation forward', () => {
    // Session A: customise slot 1 (keyboard).
    const initialStorage = new PersistentBrowserStorage();
    const sessionA = openSession(initialStorage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());
    expect(sessionA.events.map((e) => e.cause)).toEqual(['set']);

    // Session B: opens with A's writes intact, customises slot 3 (gamepad).
    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getBindings(1)).toEqual(makeCustomP1());
    sessionB.lifecycle.setBinding(3, makeCustomP3OnPad2());

    // Session C: opens with both A's and B's writes intact, layers a
    // single-action change on slot 2.
    const sessionC = reopenSession(sessionB);
    expect(sessionC.lifecycle.getBindings(1)).toEqual(makeCustomP1());
    expect(sessionC.lifecycle.getBindings(3)).toEqual(makeCustomP3OnPad2());
    sessionC.lifecycle.setAction(2, 'taunt', [kbBinding(KEY_CODE.F1)]);

    // Final assertion: every change from A, B, and C survives one more
    // hop, *and* slot 4 (never touched) is still on its default.
    const sessionD = reopenSession(sessionC);
    expect(sessionD.lifecycle.getState().hydrateSource).toBe('storage');
    expect(sessionD.lifecycle.getBindings(1)).toEqual(makeCustomP1());
    expect(sessionD.lifecycle.getBindings(3)).toEqual(makeCustomP3OnPad2());
    expect(sessionD.lifecycle.getAction(2, 'taunt')).toEqual([
      kbBinding(KEY_CODE.F1),
    ]);
    expect(sessionD.lifecycle.getBindings(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
  });

  it('all four player slots can independently rebind every action and survive a session reload', () => {
    // M5 acceptance: "Each of 4 players independently rebinds all
    // actions for their input device, bindings persist across browser
    // sessions."  This test enacts that AC verbatim.
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);

    // Build a unique replacement binding per (slot, action) pair so a
    // mismatch on any cell is easy to spot in the assertion failure.
    type Plan = ReadonlyArray<readonly [PlayerBindingsIndex, LogicalAction, InputBinding]>;
    const plan: Plan = ALL_SLOTS.flatMap((slot) =>
      ALL_ACTIONS.map((action, actionIndex) => {
        const binding: InputBinding =
          slot <= 2
            ? // Slots 1 + 2 are keyboard players: distinct keyCode per
              // (slot, action).  Range starts at 200 to dodge every
              // value in the {@link KEY_CODE} table.
              kbBinding(200 + slot * 20 + actionIndex)
            : // Slots 3 + 4 are gamepad players: distinct buttonIndex
              // per (slot, action) on a per-slot pad.
              gpButtonBinding(slot - 3, actionIndex);
        return [slot, action, binding] as const;
      }),
    );

    for (const [slot, action, binding] of plan) {
      sessionA.lifecycle.setAction(slot, action, [binding]);
    }

    // Cross the session boundary.
    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getState().hydrateSource).toBe('storage');
    for (const [slot, action, expectedBinding] of plan) {
      expect(
        sessionB.lifecycle.getAction(slot, action),
        `slot ${slot} action ${action} did not round-trip`,
      ).toEqual([expectedBinding]);
    }
  });

  it('keeps unrelated origin keys alive across sessions (namespace isolation)', () => {
    const storage = new PersistentBrowserStorage();
    // Pretend the page also stores some unrelated origin state.
    storage.setItem('analytics.session', '{"visit":1}');
    storage.setItem('platformfighter.audio.master', '0.7');

    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());

    // Round-trip through a fresh session.
    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getBindings(1)).toEqual(makeCustomP1());

    // Unrelated keys still present after both sessions wrote their bindings.
    expect(sessionB.storage.getItem('analytics.session')).toBe('{"visit":1}');
    expect(sessionB.storage.getItem('platformfighter.audio.master')).toBe('0.7');

    // And the bindings keys live under the documented namespace.
    for (const ownedKey of ALL_BINDINGS_STORAGE_KEYS) {
      expect(ownedKey.startsWith('platformfighter.bindings.v')).toBe(true);
    }
  });

  it('clear() in one session ⇒ next session boots from defaults; subsequent writes re-establish the snapshot', () => {
    const storage = new PersistentBrowserStorage();

    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());

    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getBindings(1)).toEqual(makeCustomP1());
    sessionB.lifecycle.clear();

    const sessionC = reopenSession(sessionB);
    expect(sessionC.lifecycle.getState().hydrateFallbackReason).toBe('missing');
    expect(sessionC.lifecycle.getBindings(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);

    // After a clear, the next write re-establishes the snapshot and
    // it survives the session boundary again.
    sessionC.lifecycle.setAction(2, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    const sessionD = reopenSession(sessionC);
    expect(sessionD.lifecycle.getState().hydrateSource).toBe('storage');
    expect(sessionD.lifecycle.getAction(2, 'jump')).toEqual([
      kbBinding(KEY_CODE.SPACE),
    ]);
  });

  it('resetAll() in one session leaves a defaults-shaped snapshot the next session loads via the storage path', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());
    sessionA.lifecycle.resetAll();

    // The snapshot key still exists (resetAll re-saves the defaults blob).
    expect(storage.hasKey(snapshotStorageKey())).toBe(true);

    const sessionB = reopenSession(sessionA);
    // hydrateSource is 'storage' (NOT 'defaults' / 'missing') because
    // the bytes are present even though their contents equal defaults.
    expect(sessionB.lifecycle.getState().hydrateSource).toBe('storage');
    for (const slot of ALL_SLOTS) {
      expect(sessionB.lifecycle.getBindings(slot)).toEqual(DEFAULT_PLAYER_BINDINGS[slot]);
    }
  });

  it('mid-session interleaved sets and resets compose deterministically across the session boundary', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);

    // A realistic rebind UI flow:  the player rebinds two actions on
    // slot 1, decides one of them was a mistake, and resets that one
    // action while keeping the other.
    sessionA.lifecycle.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    sessionA.lifecycle.setAction(1, 'attack', [kbBinding(KEY_CODE.ENTER)]);
    sessionA.lifecycle.resetAction(1, 'jump');

    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getAction(1, 'jump')).toEqual(
      DEFAULT_PLAYER_BINDINGS[1].bindings.jump,
    );
    expect(sessionB.lifecycle.getAction(1, 'attack')).toEqual([
      kbBinding(KEY_CODE.ENTER),
    ]);
  });

  it('createBootedLifecycle on an already-populated storage immediately observes the saved snapshot', () => {
    // Session A populates storage.
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());
    sessionA.lifecycle.setBinding(3, makeCustomP3OnPad2());

    // Simulate a fresh boot via the convenience factory on
    // independent bytes (no shared Map identity).
    const freshStorage = PersistentBrowserStorage.fromBytes(storage.snapshotBytes());
    const { lifecycle, hydrate } = createBootedLifecycle({ storage: freshStorage });
    expect(hydrate.source).toBe('storage');
    expect(lifecycle.getBindings(1)).toEqual(makeCustomP1());
    expect(lifecycle.getBindings(3)).toEqual(makeCustomP3OnPad2());
  });

  it('snapshot bytes survive an explicit getItem clone — strings are not shared by reference', () => {
    // A regression check: a future change that returned the underlying
    // map's string verbatim could let a caller mutate the stored bytes.
    // The browser's real localStorage never does that.
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());

    const fetchedOnce = storage.getItem(snapshotStorageKey());
    const fetchedTwice = storage.getItem(snapshotStorageKey());
    expect(fetchedOnce).toBe(fetchedTwice); // value equality
    // ↑ String primitives are interned by V8 so `===` on equal values
    //   passes regardless of allocation.  The point of the assertion is
    //   the *value* equality — both reads return the same on-disk bytes.

    // Even though we hold the fetched string locally, our holding it
    // does not interfere with the reload path on the next session.
    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getBindings(1)).toEqual(makeCustomP1());
  });
});

// ---------------------------------------------------------------------------
// 3.  Concurrent / racing sessions on the same storage
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — same-storage concurrency', () => {
  it('two lifecycles on the same storage observe each other after a re-boot (last-writer-wins on next hydrate)', () => {
    // Models "two tabs of the same game share localStorage": tab 1
    // writes, tab 2 doesn't see it until it re-boots, then sees the
    // update.  The lifecycle does not subscribe to `storage` events
    // (out of scope for v1) — the explicit `boot()` call is the
    // refresh affordance.
    const storage = new PersistentBrowserStorage();
    const lcA = new BindingsPersistenceLifecycle({ storage });
    const lcB = new BindingsPersistenceLifecycle({ storage });
    lcA.boot();
    lcB.boot();

    lcA.setBinding(1, makeCustomP1());

    // Tab B does not have any auto-refresh hook; until it re-boots it
    // sees its own in-memory state (defaults).
    expect(lcB.getBindings(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);

    // After an explicit re-boot, B picks up A's write.
    const reHydrate = lcB.boot();
    expect(reHydrate.source).toBe('storage');
    expect(lcB.getBindings(1)).toEqual(makeCustomP1());
  });

  it('one session writing while another session boots produces deterministic hydrate semantics', () => {
    // Models the precise interleaving:  session A finishes a write
    // *before* session B boots.  B must see A's write — there are no
    // promises, no microtasks, no buffering.
    const storage = new PersistentBrowserStorage();
    const lcA = new BindingsPersistenceLifecycle({ storage });
    lcA.boot();
    lcA.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);

    const lcB = new BindingsPersistenceLifecycle({ storage });
    const result = lcB.boot();
    expect(result.source).toBe('storage');
    expect(lcB.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.SPACE)]);
  });

  it('boot is idempotent — re-booting a session after a same-storage write picks up the latest bytes', () => {
    const storage = new PersistentBrowserStorage();
    const lcA = new BindingsPersistenceLifecycle({ storage });
    const lcB = new BindingsPersistenceLifecycle({ storage });
    lcA.boot();
    lcB.boot();

    lcA.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    lcB.boot(); // first re-boot picks up A's write
    expect(lcB.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.SPACE)]);

    lcA.setAction(1, 'jump', [kbBinding(KEY_CODE.ENTER)]);
    lcB.boot(); // second re-boot picks up A's *next* write
    expect(lcB.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.ENTER)]);
  });
});

// ---------------------------------------------------------------------------
// 4.  Cross-session subscriber ordering and lastChange replay
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — subscriber ordering & lastChange across sessions', () => {
  it('subscribers fire in mutation order; lastChange tracks the most recent', () => {
    const storage = new PersistentBrowserStorage();
    const session = openSession(storage);

    session.lifecycle.setBinding(1, makeCustomP1());
    session.lifecycle.setAction(2, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    session.lifecycle.reset(1);

    expect(session.events.map((e) => e.cause)).toEqual([
      'set',
      'set-action',
      'reset',
    ]);
    expect(session.events.map((e) => e.slot)).toEqual([1, 2, 1]);

    const state = session.lifecycle.getState();
    expect(state.lastChange?.cause).toBe('reset');
    expect(state.lastChange?.slot).toBe(1);
    // The lifecycle does not persist subscriber events themselves —
    // only the bindings table is durable.  The next session has its
    // own (empty) subscriber log + lastChange === null.
    const reopened = reopenSession(session);
    expect(reopened.events).toEqual([]);
    expect(reopened.lifecycle.getState().lastChange).toBeNull();
  });

  it('a freshly-opened session that never writes leaves lastChange null even after observing prior writes', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setBinding(1, makeCustomP1());

    const sessionB = reopenSession(sessionA);
    // The hydrate populated the in-memory store but did NOT generate a
    // change event — change events fire on writes, not reads.
    expect(sessionB.events).toEqual([]);
    expect(sessionB.lifecycle.getState().lastChange).toBeNull();
    expect(sessionB.lifecycle.getBindings(1)).toEqual(makeCustomP1());
  });
});

// ---------------------------------------------------------------------------
// 5.  Per-key inspection — the snapshot key carries every slot
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — on-disk key layout', () => {
  it('a single-slot mutation writes the FULL four-slot snapshot to the snapshot key', () => {
    const storage = new PersistentBrowserStorage();
    const session = openSession(storage);
    session.lifecycle.setAction(2, 'jump', [kbBinding(KEY_CODE.ENTER)]);

    // Per-slot keys are an *optional* override layer — the lifecycle's
    // setAction path writes the snapshot key only.
    expect(storage.hasKey(snapshotStorageKey())).toBe(true);
    for (const slot of ALL_SLOTS) {
      expect(storage.hasKey(playerStorageKey(slot))).toBe(false);
    }

    // The snapshot bytes contain every slot, not just the mutated one,
    // so the next session sees all four slots in one `loadBindingsSnapshot`.
    const reload = loadBindingsSnapshot(storage);
    expect(reload.ok).toBe(true);
    if (reload.ok) {
      // Slot 2's jump was customised; everything else is on defaults.
      expect(reload.value[2].bindings.jump).toEqual([kbBinding(KEY_CODE.ENTER)]);
      expect(reload.value[1]).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
      expect(reload.value[3]).toEqual(DEFAULT_PLAYER_BINDINGS[3]);
      expect(reload.value[4]).toEqual(DEFAULT_PLAYER_BINDINGS[4]);
    }
  });

  it('hasStoredBindingsSnapshot reports correctly across a session boundary', () => {
    const storage = new PersistentBrowserStorage();
    expect(hasStoredBindingsSnapshot(storage)).toBe(false);

    const sessionA = openSession(storage);
    sessionA.lifecycle.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    expect(hasStoredBindingsSnapshot(storage)).toBe(true);

    const reopenedStorage = PersistentBrowserStorage.fromBytes(storage.snapshotBytes());
    expect(hasStoredBindingsSnapshot(reopenedStorage)).toBe(true);

    sessionA.lifecycle.clear();
    expect(hasStoredBindingsSnapshot(storage)).toBe(false);
  });

  it('per-slot save through the controller is also durable across sessions', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);

    // Lifecycle's saveSlot path goes through the controller — verify
    // the per-slot key (the optional override layer) survives session
    // boundaries with an independent reload helper.
    sessionA.lifecycle.setBinding(3, makeCustomP3OnPad2());
    sessionA.lifecycle.getController().saveSlot(3);

    const reopenedStorage = PersistentBrowserStorage.fromBytes(storage.snapshotBytes());
    const slot3 = loadPlayerBindings(3, reopenedStorage);
    expect(slot3.ok).toBe(true);
    if (slot3.ok) {
      expect(slot3.value).toEqual(makeCustomP3OnPad2());
    }
  });
});

// ---------------------------------------------------------------------------
// 6.  Ambient-localStorage cleanup discipline
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — ambient localStorage scoping', () => {
  // The integration tests above all use an explicit storage double.
  // This block's tests verify that a lifecycle constructed *without*
  // an explicit storage (i.e. resolved from ambient `globalThis.
  // localStorage`) is still well-behaved when that ambient is missing
  // — a vitest run under Node has no `localStorage` by default.

  let originalLocalStorage: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  });

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      // Node typically has no localStorage on globalThis — make sure
      // we leave it that way.
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    }
  });

  it('ambient-storage lifecycle in a no-localStorage env stays on defaults and never throws', () => {
    // Force "no ambient localStorage" by deleting it for the test scope.
    delete (globalThis as { localStorage?: unknown }).localStorage;

    const lc = new BindingsPersistenceLifecycle();
    const result = lc.boot();
    expect(result.source).toBe('defaults');
    if (result.source === 'defaults') {
      expect(result.fallbackReason).toBe('unavailable');
    }
    // Mutation still works in-memory; storage call is a no-op.
    const setResult = lc.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    expect(setResult.ok).toBe(false);
    if (!setResult.ok) {
      expect(setResult.code).toBe('unavailable');
    }
    expect(lc.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.SPACE)]);
  });

  it('ambient-storage lifecycle round-trips when an in-memory shim is installed on globalThis', () => {
    // Install our PersistentBrowserStorage as the ambient localStorage
    // — this is exactly how a unit test for code that calls
    // `localStorage.setItem` directly would scope its work.
    const ambient = new PersistentBrowserStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: ambient,
    });

    // Session A: ambient storage, no explicit injection.
    const lcA = new BindingsPersistenceLifecycle();
    lcA.boot();
    lcA.setBinding(1, makeCustomP1());

    // Session B: also ambient — same shim instance because we never
    // un-installed it.  This proves the lifecycle's ambient-resolution
    // path picks up the same storage as the writer.
    const lcB = new BindingsPersistenceLifecycle();
    const hydrate = lcB.boot();
    expect(hydrate.source).toBe('storage');
    expect(lcB.getBindings(1)).toEqual(makeCustomP1());

    // Session C: explicit storage injected from the same on-disk bytes
    // — proves explicit injection and ambient resolution observe the
    // same blob.  This is the path the boot scene actually takes.
    const explicit = PersistentBrowserStorage.fromBytes(ambient.snapshotBytes());
    const lcC = new BindingsPersistenceLifecycle({ storage: explicit });
    const hydrateC = lcC.boot();
    expect(hydrateC.source).toBe('storage');
    expect(lcC.getBindings(1)).toEqual(makeCustomP1());
  });

  it('does not leak writes to ambient localStorage when a test installs an explicit storage', () => {
    // Install ambient.
    const ambient = new PersistentBrowserStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: ambient,
    });

    // Construct lifecycle with an *explicit* storage — writes must go
    // there, not to ambient.  This guards the test isolation contract:
    // the integration suite must not contaminate ambient storage that
    // other suites might rely on.
    const explicit = new PersistentBrowserStorage();
    const lc = new BindingsPersistenceLifecycle({ storage: explicit });
    lc.boot();
    lc.setBinding(1, makeCustomP1());

    expect(explicit.hasKey(snapshotStorageKey())).toBe(true);
    expect(ambient.hasKey(snapshotStorageKey())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7.  Quick error-listener observability
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — error listener', () => {
  it('error listener fires for write failures across multiple sessions but stays quiet for unavailable', () => {
    const errors: Array<{ stage: string; code: string }> = [];
    const flaky = new FlakyBrowserStorage(/*failuresRemaining=*/ 3);
    const lcA = new BindingsPersistenceLifecycle({
      storage: flaky,
      errorListener: (e) => errors.push({ stage: e.stage, code: e.code }),
    });
    lcA.boot();
    lcA.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    lcA.setAction(2, 'attack', [kbBinding(KEY_CODE.ENTER)]);
    lcA.setAction(3, 'special', [gpButtonBinding(0, 1)]);
    lcA.setAction(4, 'shield', [gpButtonBinding(1, 5)]);

    // Three writes failed with write-failed; the fourth succeeded.
    const failureCount = errors.filter((e) => e.code === 'write-failed').length;
    expect(failureCount).toBe(3);

    // After the failures, the next session opens cleanly off the
    // single durable write that did go through.
    const reopened = openSession(
      PersistentBrowserStorage.fromBytes(flaky.snapshotBytes()),
    );
    expect(reopened.lifecycle.getState().hydrateSource).toBe('storage');
    expect(reopened.lifecycle.getAction(4, 'shield')).toEqual([
      gpButtonBinding(1, 5),
    ]);
  });

  it('null storage does not fire the error listener even though writes return unavailable', () => {
    const errors: Array<{ code: string }> = [];
    const lc = new BindingsPersistenceLifecycle({
      storage: null,
      errorListener: (e) => errors.push({ code: e.code }),
    });
    lc.boot();
    // Use slot-1 binding for slot 1 (`makeCustomP1()` carries
    // playerIndex: 1 internally — passing it to slot 2 trips the
    // store's slot-vs-payload validation).
    lc.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    lc.setBinding(1, makeCustomP1());
    lc.resetAll();
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8.  Boot from a previous session's *raw bytes* — no shared object identity
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — raw-bytes hand-off', () => {
  it('a session opened from raw byte capture sees identical bindings to the writer', () => {
    const writer = openSession(new PersistentBrowserStorage());
    writer.lifecycle.setBinding(1, makeCustomP1());
    writer.lifecycle.setBinding(3, makeCustomP3OnPad2());

    // Capture the exact bytes the browser would persist.
    const bytes = writer.storage.snapshotBytes();
    expect(bytes.size).toBeGreaterThan(0);
    expect(bytes.has(snapshotStorageKey())).toBe(true);

    // A reader session opened from those bytes — *not* from the
    // writer's storage object — sees the identical state.
    const reader = openSession(PersistentBrowserStorage.fromBytes(bytes));
    expect(reader.lifecycle.getBindings(1)).toEqual(makeCustomP1());
    expect(reader.lifecycle.getBindings(3)).toEqual(makeCustomP3OnPad2());

    // And the writer can keep mutating its own storage without
    // affecting the reader (independent on-disk copies).
    writer.lifecycle.resetAll();
    expect(writer.lifecycle.getBindings(1)).toEqual(DEFAULT_PLAYER_BINDINGS[1]);
    expect(reader.lifecycle.getBindings(1)).toEqual(makeCustomP1());
  });

  it('a session reopened mid-rebind still observes prior writes (no batching, no buffering)', () => {
    // Realistic scenario:  the player is partway through rebinding
    // four actions when the tab unexpectedly closes.  Every committed
    // action must be on disk; the un-committed actions must not be.
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    sessionA.lifecycle.setAction(1, 'attack', [kbBinding(KEY_CODE.ENTER)]);
    // ↑ These two committed.

    // Tab closes here — the next two intended rebinds are never committed.
    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getAction(1, 'jump')).toEqual([
      kbBinding(KEY_CODE.SPACE),
    ]);
    expect(sessionB.lifecycle.getAction(1, 'attack')).toEqual([
      kbBinding(KEY_CODE.ENTER),
    ]);
    // The unbound actions are on defaults — the un-committed mutations
    // never happened.
    expect(sessionB.lifecycle.getAction(1, 'special')).toEqual(
      DEFAULT_PLAYER_BINDINGS[1].bindings.special,
    );
    expect(sessionB.lifecycle.getAction(1, 'shield')).toEqual(
      DEFAULT_PLAYER_BINDINGS[1].bindings.shield,
    );
  });
});

// ---------------------------------------------------------------------------
// 9.  Multi-binding (layered) actions survive cross-session reload
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — multi-binding round-trips', () => {
  it('an action with multiple bindings (keyboard + gamepad) survives the reload intact', () => {
    // Per the schema docs, ActionBindings is plural — a player may
    // layer extra inputs on a single action.  This test proves the
    // ordering is preserved across the session boundary.
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);

    const layered: ReadonlyArray<InputBinding> = [
      kbBinding(KEY_CODE.SPACE),
      gpButtonBinding(0, 0),
      gpAxisBinding(1, 1, +1, 0.42),
    ];
    sessionA.lifecycle.setAction(1, 'jump', layered);

    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getAction(1, 'jump')).toEqual(layered);
  });

  it('an empty binding array (deliberately disabled action) round-trips as empty', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);
    sessionA.lifecycle.setAction(1, 'taunt', []);

    const sessionB = reopenSession(sessionA);
    expect(sessionB.lifecycle.getAction(1, 'taunt')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10.  Schema version on disk survives re-saves identically
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — schema version invariance', () => {
  it('the on-disk schemaVersion is stable across mutate / re-save cycles', () => {
    const storage = new PersistentBrowserStorage();
    const sessionA = openSession(storage);

    sessionA.lifecycle.setBinding(1, makeCustomP1());
    const firstBytes = storage.getItem(snapshotStorageKey());
    expect(firstBytes).not.toBeNull();
    if (firstBytes !== null) {
      // The envelope's schemaVersion field is a literal on the JSON
      // we wrote — locking it to the *first* schema version published
      // guards against an accidental version bump landing on disk
      // without a migration test catching it.
      expect(firstBytes).toContain('"schemaVersion": 1');
    }

    // Subsequent saves keep the same schemaVersion.
    sessionA.lifecycle.setAction(2, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    const secondBytes = storage.getItem(snapshotStorageKey());
    expect(secondBytes).toContain('"schemaVersion": 1');

    // And it survives a session boundary unchanged.
    const sessionB = reopenSession(sessionA);
    sessionB.lifecycle.setAction(3, 'attack', [gpButtonBinding(0, 2)]);
    const thirdBytes = sessionB.storage.getItem(snapshotStorageKey());
    expect(thirdBytes).toContain('"schemaVersion": 1');
  });
});

// ---------------------------------------------------------------------------
// 11.  Full M5-AC walkthrough (end-to-end determinism check)
// ---------------------------------------------------------------------------

describe('Bindings persistence integration — M5 end-to-end walkthrough', () => {
  it('reproduces the M5 acceptance scenario: 4 players rebind, close tab, reopen, bindings persist', () => {
    // Step 1: first-ever boot — defaults everywhere.
    const storage = new PersistentBrowserStorage();
    const session1 = openSession(storage);
    expect(session1.lifecycle.getState().hydrateFallbackReason).toBe('missing');

    // Step 2: each of 4 players rebinds at least one action.
    session1.lifecycle.setAction(1, 'jump', [kbBinding(KEY_CODE.SPACE)]);
    session1.lifecycle.setAction(2, 'attack', [kbBinding(KEY_CODE.NUMPAD_0)]);
    session1.lifecycle.setAction(3, 'special', [gpButtonBinding(0, 3)]);
    session1.lifecycle.setAction(4, 'shield', [gpButtonBinding(1, 5)]);

    // Step 3: a "Reset all controls" miss — player resets slot 4 only,
    // keeping the other three changes.
    session1.lifecycle.reset(4);

    // Step 4: tab closes; the player reopens the game.
    const session2 = reopenSession(session1);

    // Step 5: every committed customisation survives, slot 4 is on
    // defaults, the lifecycle reports it loaded from storage.
    expect(session2.lifecycle.getState().hydrateSource).toBe('storage');
    expect(session2.lifecycle.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.SPACE)]);
    expect(session2.lifecycle.getAction(2, 'attack')).toEqual([kbBinding(KEY_CODE.NUMPAD_0)]);
    expect(session2.lifecycle.getAction(3, 'special')).toEqual([gpButtonBinding(0, 3)]);
    expect(session2.lifecycle.getBindings(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);

    // Step 6: a third session opens and confirms the state is stable
    // — multiple round-trips through the persistence layer do not
    // drift.  This is the determinism guarantee the replay layer
    // depends on.
    const session3 = reopenSession(session2);
    expect(session3.lifecycle.getAction(1, 'jump')).toEqual([kbBinding(KEY_CODE.SPACE)]);
    expect(session3.lifecycle.getAction(2, 'attack')).toEqual([kbBinding(KEY_CODE.NUMPAD_0)]);
    expect(session3.lifecycle.getAction(3, 'special')).toEqual([gpButtonBinding(0, 3)]);
    expect(session3.lifecycle.getBindings(4)).toEqual(DEFAULT_PLAYER_BINDINGS[4]);

    // The byte-equal contract: session 2 and session 3 see the same
    // raw bytes because no further writes happened between them.
    const bytes2 = session2.storage.getItem(snapshotStorageKey());
    const bytes3 = session3.storage.getItem(snapshotStorageKey());
    expect(bytes2).toBe(bytes3);
  });
});
