import Phaser from 'phaser';
import {
  BindingsPersistenceController,
  BindingsPersistenceLifecycle,
  InputBindingsStore,
} from '../input';
import { RebindingScreen } from '../ui/RebindingScreen';
import { isCaptureCancelKey } from '../ui/bindingCapture';
import {
  clearGamepadCaptureLatches,
  createGamepadCaptureLatches,
  pollGamepadCaptureEvents,
  refreshGamepadCaptureLatches,
  type GamepadCaptureLatches,
  type GamepadSnapshot,
} from '../ui/bindingCapturePolling';
import { KEY_CODE } from '../input/keyCodes';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import { BOOT_REGISTRY_KEYS } from './bootKeys';

/**
 * RebindingScene — AC 40101 Sub-AC 1 + AC 40102 Sub-AC 2.
 *
 * Phaser scene host for the M5 input-rebinding screen. Owns:
 *
 *   • Construction / teardown of the {@link RebindingScreen} component
 *     that draws the four-player panel layout.
 *   • An `InputBindingsStore` instance (created locally on first entry,
 *     cached on the Phaser registry on subsequent entries) so the
 *     screen has a real, validated bindings source to read from. The
 *     full settings persistence (localStorage round-trip) lands in a
 *     later sub-AC; the scene already routes through a single store so
 *     wiring it up is a one-liner when that lands.
 *   • An ESC handler that returns the player to the main menu — *unless*
 *     a capture session is active, in which case ESC cancels the
 *     capture (the screen owns the cancel; this scene just stops the
 *     transition).
 *   • The keyboard / gamepad bridges that turn raw browser input into
 *     `RebindingScreen.submit*Capture(...)` calls when a capture session
 *     is open. Idle (no capture in progress) the bridges are no-ops, so
 *     the scene's per-frame cost is a single `getActiveCapture()` check
 *     plus, while a capture is open, one `navigator.getGamepads()`
 *     snapshot per frame.
 *
 * Why a tiny scene file
 * ---------------------
 *
 * Per the project's `code_architecture` evaluation principle, scenes
 * stay thin: lifecycle wiring + scene transitions only. The renderer,
 * the formatters, and the click-to-cycle interactions live in
 * `src/ui/RebindingScreen.ts` and `src/ui/rebindingScreenFormat.ts`,
 * where they can be unit-tested without booting a full Phaser game.
 * The capture bridges in this file are also intentionally thin — every
 * branch is a one-call forward into the screen's pure-helper-backed
 * `submit*Capture` API.
 */
export class RebindingScene extends Phaser.Scene {
  private screen: RebindingScreen | null = null;
  /**
   * Persistence wrapper around the shared bindings store. Built lazily
   * on first `create()` so a unit test that exercises the scene doesn't
   * have to stub out `localStorage` — the controller defers to the
   * ambient `localStorage` only when a save / reset is actually
   * requested. The same instance survives scene re-entry by virtue of
   * the underlying store living on the Phaser registry.
   */
  private persistence: BindingsPersistenceController | null = null;

  /**
   * AC 50104 Sub-AC 4 — unsubscribe handles for the per-panel
   * confirm/reset listeners the scene registers on the screen. Called
   * from {@link tearDown} so listener closures don't outlive the scene
   * instance across re-entries.
   */
  private unsubscribeConfirm: (() => void) | null = null;
  private unsubscribeReset: (() => void) | null = null;

  /**
   * Per-pad rising-edge state owned by the Phaser-free
   * {@link pollGamepadCaptureEvents} helper. The scene hands this struct
   * to the poller every frame; the poller mutates it in place so the
   * next poll sees the just-finished frame's held-set as last frame's
   * latched state.
   *
   * Why a single delegated struct rather than two ad-hoc maps in the
   * scene: extracting the rising-edge logic into a Phaser-free module
   * lets it be unit-tested under plain Node + vitest (see
   * `src/ui/bindingCapturePolling.test.ts`) instead of being smeared
   * across an `update()` body that needs jsdom + Phaser to exercise.
   */
  private gamepadLatches: GamepadCaptureLatches = createGamepadCaptureLatches();

  /**
   * Scene key the ESC / cancel transition routes back to. Captured from
   * `init(data)` so a scene that launched the rebinding menu (e.g.
   * `CharacterSelectScene`) gets the player back where they came from
   * instead of dumping them at the main menu. Defaults to
   * `MainMenuScene` when launched without explicit return data so the
   * existing main-menu entry point behaves unchanged.
   */
  private returnTo: string = 'MainMenuScene';

  /**
   * Opaque payload forwarded to the return scene's `init(data)` on
   * cancel — lets a caller round-trip its pending state (e.g.
   * char-select's `pendingMatchConfig` + `lobby`) without losing it
   * to the rebinding detour.
   */
  private returnData: object | undefined = undefined;

  constructor() {
    super({ key: 'RebindingScene' });
  }

  init(data?: { readonly returnTo?: string; readonly returnData?: object }): void {
    this.returnTo = data?.returnTo ?? 'MainMenuScene';
    this.returnData = data?.returnData;
  }

  create(): void {
    // Diagnostic + safety: explicitly (re)enable the scene's input
    // plugin and refocus the canvas so clicks reach this scene. The
    // previous scene (CharacterSelect or MainMenu) may have taken
    // focus during its keydown handlers; without re-focus, the
    // canvas's DOM-level pointer listeners can stay dormant until
    // the user manually clicks the page.
    // eslint-disable-next-line no-console
    console.log('[RebindingScene] create()');
    if (this.input) {
      this.input.enabled = true;
      this.input.setTopOnly(false); // let underlying objects receive clicks too
    }
    // Force canvas focus so DOM pointer events route to it.
    const canvas = this.game.canvas;
    if (canvas) {
      // tabIndex makes the canvas focusable; set the focus explicitly.
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      // Suppress the browser's focus-ring outline — players reported a
      // big rectangle appearing on selection. The canvas is focusable
      // for keyboard input, but the focus ring is visual noise that
      // overlaps the game content.
      canvas.style.outline = 'none';
      canvas.focus();
      // DOM-level click router. Phaser's per-scene InputPlugin in
      // this scene doesn't dispatch pointerdown to interactive
      // GameObjects (observed when arriving via scene.start from
      // another scene with input enabled). Workaround: listen for
      // mousedown on the canvas directly, run a geometric hit test
      // through `screen.hitTestClick(x, y)`, and call beginCapture
      // for the matched row. Cleaner than fighting Phaser's input
      // plugin routing.
      const domHandler = (e: MouseEvent) => {
        // Account for canvas CSS scaling: convert client coords to
        // canvas-space coords using bounding rect + scale ratio.
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top) * scaleY;
        if (this.screen === null) return;
        const hit = this.screen.hitTestClick(cx, cy);
        if (!hit) return;
        // eslint-disable-next-line no-console
        console.log(`[RebindingScene] click → ${hit.kind} slot ${hit.slot}`);
        switch (hit.kind) {
          case 'binding':
            this.screen.beginCapture(hit.slot, hit.action);
            break;
          case 'device':
            this.screen.cyclePlayerDevice(hit.slot);
            break;
          case 'reset':
            this.screen.resetPlayerBindings(hit.slot);
            this.persistResetSlot(hit.slot);
            break;
          case 'confirm':
            this.screen.confirmPlayerBindings(hit.slot);
            this.persistConfirmedSlot(hit.slot);
            break;
        }
      };
      canvas.addEventListener('mousedown', domHandler);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        canvas.removeEventListener('mousedown', domHandler);
      });
    }
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // eslint-disable-next-line no-console
      console.log(`[RebindingScene] pointerdown @ (${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)})`);
    });
    const store = this.acquireBindingsStore();
    // Wrap the shared store in the persistence controller so every
    // committed capture is autosaved and "Reset All" wipes the
    // localStorage blob alongside the in-memory state. The controller
    // is *not* re-cached on the registry — the store is the long-lived
    // value; the controller is a thin façade we rebuild on each entry.
    this.persistence = new BindingsPersistenceController({ store });
    this.screen = new RebindingScreen(this, store);

    // AC 50104 Sub-AC 4 — subscribe to the per-panel Confirm / Reset
    // events emitted by the screen and forward them to the persistence
    // controller. The screen mutates the in-memory store directly, but
    // it deliberately does not know about localStorage; the scene is
    // the only layer that owns the IO controller, so it is the natural
    // place to wire "click → persist" without making the screen aware
    // of storage. Both handlers are intra-player operations: confirm
    // locks in just the slot the player operated, reset restores just
    // that slot's per-device defaults — neither touches the other
    // three slots, matching the per-player rebinding boundary in the
    // M5 milestone brief.
    this.unsubscribeConfirm = this.screen.onConfirm((slot) =>
      this.persistConfirmedSlot(slot),
    );
    this.unsubscribeReset = this.screen.onReset((slot) =>
      this.persistResetSlot(slot),
    );

    // Keyboard bridge — a single 'keydown' handler handles every key,
    // forwarding to the screen's capture API while a capture is active.
    // ESC outside a capture returns to the menu; ESC inside a capture
    // cancels the capture (handled inside `submitKeyboardCapture`).
    // BACKSPACE (outside a capture) resets every slot to defaults and
    // clears the persisted blob — picked instead of F1 because F1 is
    // browser-reserved as the Help shortcut and never reaches us.
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      this.handleKeyDown(event);
    });

    // Phaser's SHUTDOWN runs when the scene is replaced via
    // `scene.start('OtherScene')`. Tear down the screen so its
    // text / rectangle objects are released cleanly.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.tearDown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.tearDown());
  }

  /**
   * Per-frame Phaser callback. While a capture is active we poll the
   * Gamepad API for the first new button press / axis deflection that
   * matches the capture's rules and forward it to the screen. Idle the
   * loop short-circuits on the `getActiveCapture()` null check.
   *
   * The rising-edge detection itself lives in
   * {@link pollGamepadCaptureEvents} / {@link refreshGamepadCaptureLatches}
   * — the scene only handles the snapshot read, the screen-forward
   * loop, and the early-return on a successful commit (so a single
   * press never rebinds two slots in a row).
   */
  override update(): void {
    if (this.screen === null) return;
    const active = this.screen.getActiveCapture();
    const snapshot = this.getGamepadsSnapshot();
    if (active === null) {
      // Nothing to capture — keep the latch maps in sync with the
      // current state so the next capture's rising-edge detection
      // doesn't fire on a button that's already held.
      refreshGamepadCaptureLatches(snapshot, this.gamepadLatches);
      return;
    }
    this.dispatchGamepadCaptureEvents(snapshot);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.screen === null) return;
    const active = this.screen.getActiveCapture();
    if (active === null) {
      // No capture in progress.
      //   ESC      → return to main menu
      //   F1       → reset every slot to defaults + clear localStorage
      if (isCaptureCancelKey(event.keyCode)) {
        // Route back to whichever scene launched us — char-select,
        // main menu, or anywhere else that passed `returnTo` in
        // `init(data)`. Forward `returnData` so the caller can
        // re-hydrate its pending state (lobby payload, etc.).
        this.scene.start(this.returnTo, this.returnData);
        return;
      }
      // BACKSPACE — reset every slot to defaults. F1 was the legacy
      // hint but the browser reserves F1 for its Help dialog and the
      // event never reaches Phaser.
      if (event.keyCode === KEY_CODE.BACKSPACE) {
        this.resetAllAndPersist();
        return;
      }
      return;
    }
    // Capture in progress: forward every keydown to the screen. ESC is
    // turned into a cancel by `submitKeyboardCapture` itself.
    const result = this.screen.submitKeyboardCapture(event.keyCode);
    if (result.accepted) {
      // Persist the just-committed binding so a tab close / refresh
      // before the player navigates back to the main menu does not
      // lose the rebind.
      this.persistAfterCommit();
    }
  }

  // -------------------------------------------------------------------------
  // Gamepad capture polling
  // -------------------------------------------------------------------------

  /**
   * Read the live `navigator.getGamepads()` snapshot. Wrapped so tests
   * can override it without tampering with the global `navigator`.
   */
  protected getGamepadsSnapshot(): GamepadSnapshot {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    const pads = navigator.getGamepads();
    if (!pads) return [];
    // `navigator.getGamepads()` returns a (Gamepad | null)[] live view;
    // copy to a plain array so callers don't see it shrink mid-iteration.
    return Array.from(pads);
  }

  /**
   * Forward every rising-edge gamepad event from the latest poll to the
   * screen, stopping on the first accepted commit or cancel. Centralised
   * here so the scene's `update()` loop is a single early-return after
   * this call rather than hand-rolling the iteration.
   */
  private dispatchGamepadCaptureEvents(snapshot: GamepadSnapshot): void {
    if (this.screen === null) return;
    const events = pollGamepadCaptureEvents(snapshot, this.gamepadLatches);
    for (const event of events) {
      const result =
        event.kind === 'button'
          ? this.screen.submitGamepadButtonCapture(event.gamepadIndex, event.buttonIndex)
          : this.screen.submitGamepadAxisCapture(
              event.gamepadIndex,
              event.axisIndex,
              event.axisValue,
            );
      if (result.accepted) {
        this.persistAfterCommit();
        return;
      }
      if (!result.accepted && result.reason === 'cancelled') {
        return;
      }
      // `invalid_input` / `no_active_capture` — keep iterating; the
      // capture is either still open (and waiting for a valid press)
      // or already closed by an earlier event in this same frame.
    }
  }

  /**
   * Find or build the shared {@link InputBindingsStore}. Cached on the
   * Phaser registry by `BootScene.initialiseEngineSystems` so the very
   * first scene to ask already sees the player's last-saved layout. We
   * still defensively create a defaults-only store if the registry slot
   * is empty (e.g. a unit test that boots straight into this scene).
   *
   * AC 40301 Sub-AC 1 — when a {@link BindingsPersistenceLifecycle} is
   * present in the registry (the BootScene path), this method also
   * borrows the lifecycle's underlying store so auto-save subscribers
   * fire alongside the rebinding scene's own `saveAll()` calls.
   */
  private acquireBindingsStore(): InputBindingsStore {
    const lifecycle = this.registry.get(BOOT_REGISTRY_KEYS.bindingsLifecycle) as
      | BindingsPersistenceLifecycle
      | undefined;
    if (lifecycle instanceof BindingsPersistenceLifecycle) {
      const store = lifecycle.getStore();
      // Mirror the inner store on the legacy registry slot so any other
      // scene that still reads `inputBindingsStore` directly sees the
      // same instance the lifecycle owns.
      this.registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, store);
      return store;
    }
    const existing = this.registry.get(BOOT_REGISTRY_KEYS.inputBindingsStore) as
      | InputBindingsStore
      | undefined;
    if (existing instanceof InputBindingsStore) {
      return existing;
    }
    const store = new InputBindingsStore();
    this.registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, store);
    return store;
  }

  /**
   * Persist the entire snapshot after a capture commit. The screen's
   * commit path has already mutated the store; we just forward the
   * fresh snapshot to localStorage. Fails silently in test
   * environments where there is no `localStorage` — the controller
   * returns `unavailable` which we deliberately don't surface.
   *
   * AC 40103 Sub-AC 3 — refuses to persist while the screen reports
   * an intra-player conflict (`screen.canSave() === false`). Saving a
   * conflicted profile would round-trip back into the store on next
   * boot, leaving the player permanently in a state where one of two
   * conflicting actions silently never fires. The screen's banner
   * already explains the block and points at the per-panel Reset to
   * Default control; the in-memory store still carries the just-
   * captured value so the player can keep iterating without losing
   * their work.
   */
  private persistAfterCommit(): void {
    if (this.persistence === null || this.screen === null) return;
    if (!this.screen.canSave()) return;
    this.persistence.saveAll();
  }

  /**
   * Reset every slot to defaults *and* clear the persisted blob, then
   * repaint the screen so the new (default) bindings show up
   * immediately. The screen's `refreshBindings` re-runs conflict
   * detection, so any conflict warnings inherited from the player's
   * old layout drop off the banner the same frame.
   */
  private resetAllAndPersist(): void {
    if (this.persistence === null || this.screen === null) return;
    this.persistence.resetAll();
    this.screen.refreshBindings();
  }

  /**
   * AC 50104 Sub-AC 4 — persist a single slot after the player clicked
   * the panel's Confirm button.
   *
   * Implementation notes:
   *
   *   • Writes BOTH the per-player envelope (via `saveSlot`) AND the
   *     full snapshot (via `saveAll`). The boot loader's hydrate path
   *     prefers the snapshot key; the per-player key is an optional
   *     override layer kept in lockstep with the snapshot so a future
   *     loader that consults the per-player key first still sees the
   *     just-confirmed bindings.
   *   • Honours the screen's `canSavePlayer(slot)` save-guard: a
   *     conflicted profile (intra-player conflict on this slot) is
   *     deliberately *not* persisted — the player still sees the
   *     conflict banner pointing at the per-panel Reset to Default
   *     control, and the in-memory store keeps the just-captured value
   *     so the player can keep iterating. The same "block save under
   *     intra-player conflict" rule that {@link persistAfterCommit}
   *     applies for live captures applies here for explicit confirms.
   *   • Failures (quota / private mode) are surfaced through the
   *     persistence controller's optional `errorListener` (none wired
   *     today). The method itself never throws — `saveSlot` / `saveAll`
   *     return a `DetailedStorageResult` we deliberately ignore so a
   *     failed write doesn't tear down the scene.
   */
  private persistConfirmedSlot(slot: PlayerBindingsIndex): void {
    if (this.persistence === null || this.screen === null) return;
    if (!this.screen.canSavePlayer(slot)) return;
    this.persistence.saveSlot(slot);
    this.persistence.saveAll();
  }

  /**
   * AC 50104 Sub-AC 4 — persist a single slot after the player clicked
   * the panel's "Reset to Default" button.
   *
   * The screen has already mutated the in-memory store back to the
   * canonical per-slot default profile (P1=keyboard WASD, P2=keyboard
   * arrows, P3=gamepad 0, P4=gamepad 1). This helper writes the new
   * (default) state to localStorage so a refresh after a click on
   * Reset doesn't silently restore the player's previous customised
   * bindings via the still-stale snapshot blob.
   *
   * `canSavePlayer` is checked even though a fresh reset cannot
   * produce intra-player conflicts — the guard is symmetrical with
   * {@link persistConfirmedSlot} for code-review parity, and it is
   * a no-cost call on the typical default-profile path.
   */
  private persistResetSlot(slot: PlayerBindingsIndex): void {
    if (this.persistence === null || this.screen === null) return;
    if (!this.screen.canSavePlayer(slot)) return;
    this.persistence.saveSlot(slot);
    this.persistence.saveAll();
  }

  private tearDown(): void {
    if (this.unsubscribeConfirm) {
      this.unsubscribeConfirm();
      this.unsubscribeConfirm = null;
    }
    if (this.unsubscribeReset) {
      this.unsubscribeReset();
      this.unsubscribeReset = null;
    }
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    this.persistence = null;
    clearGamepadCaptureLatches(this.gamepadLatches);
  }
}
