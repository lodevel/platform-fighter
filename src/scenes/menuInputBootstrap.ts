/**
 * Phaser-side bootstrap that wires a {@link MenuInputAdapter} on top of
 * the shared {@link InputBindingsStore} for any scene that wants menu
 * navigation routed through the central input pipeline.
 *
 * AC 50203 Sub-AC 3 — every menu / pause / character-select scene
 * reads navigate / confirm / cancel through this adapter so the
 * "physical key/button → menu action" mapping flows through each
 * player's live binding profile (with a rebind taking effect on the
 * very next per-frame `update`). The `MainMenuScene`, the pause
 * overlay in `MatchScene`, and `CharacterSelectScene` all delegate
 * the wiring step here so they don't each hand-roll a dispatcher +
 * resolver + adapter triple.
 *
 * Lifecycle:
 *
 *     // In `Scene.create()`:
 *     const menuInput = createMenuInputForScene(this, [1, 2, 3, 4]);
 *
 *     // Per render frame (Phaser's `update()` works fine — menus are
 *     // rendered, not simulated, so the resolver runs at ~60 Hz wall):
 *     menuInput.update();
 *     if (menuInput.adapter.wasTriggeredByAnyPlayer('confirm')) {
 *       this.scene.start('LobbyScene');
 *     }
 *
 *     // The wiring auto-cleans on `Phaser.Scenes.Events.SHUTDOWN`.
 *
 * The bootstrap also exposes a `dispose()` method for unit tests that
 * never fire a SHUTDOWN, so the dispatcher / resolver / adapter
 * triple can be torn down deterministically.
 *
 * Determinism: the adapter and the resolver underneath it are pure
 * read surfaces — they only mutate inside `update()`. The bootstrap
 * makes no other state visible to gameplay; menu rendering branches
 * on the per-frame action edges, never on raw key codes.
 */

import Phaser from 'phaser';
import {
  BindingsPersistenceLifecycle,
  DeviceInputDispatcher,
  InputBindingsStore,
  InputResolver,
  MenuInputAdapter,
  createBrowserGamepadSource,
  type GamepadSource,
  type KeyboardSource,
} from '../input';
import { createPhaserKeyboardSource } from '../input/LocalInputHandler';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import { BOOT_REGISTRY_KEYS } from './bootKeys';

/**
 * Phaser-bound bundle returned by {@link createMenuInputForScene}.
 *
 * Holds the dispatcher / resolver / adapter triple for one scene and
 * exposes a single `update()` entry point that drives them all. The
 * scene calls `update()` from its render-loop hook and reads
 * navigation state via `adapter.wasTriggered(slot, action)` /
 * `adapter.wasTriggeredByAnyPlayer(action)`.
 */
export interface MenuInputBundle {
  /** The {@link DeviceInputDispatcher} bridging keyboard + gamepad state. */
  readonly dispatcher: DeviceInputDispatcher;
  /** The central {@link InputResolver} the adapter reads through. */
  readonly resolver: InputResolver;
  /** The {@link MenuInputAdapter} every menu navigation read flows through. */
  readonly adapter: MenuInputAdapter;
  /** Drive one frame of input sampling — call once per render frame. */
  update(frame?: number): void;
  /** Tear down state. Called automatically on `Phaser.Scenes.Events.SHUTDOWN`. */
  dispose(): void;
}

/**
 * Acquire (or lazily construct) the shared {@link InputBindingsStore}
 * that lives on the Phaser registry. Mirrors the helper inside
 * `MatchScene.acquireBindingsStore` and `RebindingScene.acquireBindingsStore`
 * so menu scenes see the exact same store the gameplay path reads from
 * — a rebind committed in the rebinding screen is visible to the menu
 * input adapter on the very next `update()` without any reload step.
 */
function acquireBindingsStoreFromRegistry(
  registry: Phaser.Data.DataManager,
): InputBindingsStore {
  const lifecycle = registry.get(BOOT_REGISTRY_KEYS.bindingsLifecycle) as
    | BindingsPersistenceLifecycle
    | undefined;
  if (lifecycle instanceof BindingsPersistenceLifecycle) {
    const store = lifecycle.getStore();
    registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, store);
    return store;
  }
  const existing = registry.get(BOOT_REGISTRY_KEYS.inputBindingsStore) as
    | InputBindingsStore
    | undefined;
  if (existing instanceof InputBindingsStore) {
    return existing;
  }
  const store = new InputBindingsStore();
  registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, store);
  return store;
}

/**
 * Construct the dispatcher / resolver / adapter triple for the
 * supplied scene and wire automatic teardown on
 * `Phaser.Scenes.Events.SHUTDOWN`.
 *
 * `slots` defaults to all four canonical player slots so menus that
 * accept any-player input ("any joined player can press confirm") get
 * the natural fold without per-call configuration. Restrict to a
 * subset for menus that should only listen on specific slots (e.g.
 * a single-player options screen).
 */
export function createMenuInputForScene(
  scene: Phaser.Scene,
  slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4],
): MenuInputBundle {
  const bindings = acquireBindingsStoreFromRegistry(scene.registry);
  const keyboard: KeyboardSource = createPhaserKeyboardSource(scene);
  const gamepad: GamepadSource = createBrowserGamepadSource();
  const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings });
  const resolver = new InputResolver({ dispatcher, slots });
  const adapter = new MenuInputAdapter({ resolver });

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    resolver.reset();
  };

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, dispose);

  let frameCounter = -1;

  const update = (frame?: number): void => {
    if (disposed) return;
    if (frame !== undefined) {
      frameCounter = frame;
    } else {
      frameCounter += 1;
    }
    resolver.update(frameCounter);
  };

  return {
    dispatcher,
    resolver,
    adapter,
    update,
    dispose,
  };
}
