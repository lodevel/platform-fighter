/**
 * Phaser-free module that owns the registry-key contract written by
 * BootScene and read by every downstream scene.
 *
 * Kept separate from `BootScene.ts` so the contract can be unit-tested
 * under plain Node (no jsdom, no Phaser globals) and so engine-core
 * modules (replay, AI, headless tooling) can read these key names
 * without pulling Phaser into their dependency graph.
 */

export const BOOT_REGISTRY_KEYS = {
  /** True once BootScene has finished its create() pass. */
  booted: 'booted',
  /** performance.now() captured at the moment of boot. */
  startedAt: 'startedAt',
  /** Frozen GameConstants snapshot used by every gameplay system. */
  engineConfig: 'engineConfig',
  /** Shared deterministic RNG instance (seeded from defaultRngSeed). */
  rng: 'rng',
  /** Seed actually used to construct the registry RNG. */
  rngSeed: 'rngSeed',
  /**
   * `MatchRng` instance for the *currently running* match — written by
   * MatchScene during its `create()` pass. The value is replaced at the
   * start of every match so every gameplay subsystem (AI, hazards,
   * particles, visuals) can pull a deterministic stream from the same
   * source without re-seeding mid-match.
   *
   * AC 30001 Sub-AC 1: this is the "single deterministic source
   * captured at match start" the replay system reads back.
   */
  matchRng: 'matchRng',
  /**
   * The seed used to construct the active match's `MatchRng`. Captured
   * separately so the replay header writer / debug HUD can read it
   * without holding a reference to the live RNG.
   */
  matchRngSeed: 'matchRngSeed',
  /** Browser feature-detection results captured at boot. */
  features: 'features',
  /** Texture key for the 1x1 white pixel generated during preload. */
  whitePixelKey: 'tex.boot.pixel',
  /** Texture key for the simple animated loader dot used by PreloadScene. */
  loaderDotKey: 'tex.boot.loader-dot',
  /**
   * AC 5 Sub-AC 4 — shared `InputBindingsStore` for the four-slot
   * rebinding system. Boot hydrates this from `localStorage` (falling
   * back to defaults on a missing / corrupted blob) so the very first
   * scene that asks for bindings already sees the player's last-saved
   * layout. Both `MatchScene.acquireBindingsStore` and
   * `RebindingScene.acquireBindingsStore` look here first; if they find
   * an instance they reuse it, otherwise they create a defaults-only
   * store (the M1 dev path).
   */
  inputBindingsStore: 'inputBindingsStore',
  /**
   * AC 40301 Sub-AC 1 — shared {@link BindingsPersistenceLifecycle} that
   * pairs the `InputBindingsStore` with the auto-save lifecycle:
   * hydrate-on-boot (with schema migration for legacy blobs), auto-save
   * on every binding mutation routed through the lifecycle, and
   * subscriber notifications for the rebinding UI's repaint hooks. The
   * underlying inner store is *also* registered under
   * {@link inputBindingsStore} so scenes that hold the older API surface
   * (the device dispatcher, the M1 keyboard handler) keep working
   * unchanged. New code that wants auto-save should prefer the
   * lifecycle entry.
   */
  bindingsLifecycle: 'bindingsLifecycle',
  /**
   * Last-resolved {@link MatchConfig} stamped by `MatchScene` at the
   * end of its `create()` pass. The Results scene's "REMATCH"
   * button reads this and forwards the config back into MatchScene
   * so a rematch preserves the player's chosen characters AND
   * paletteIndex per slot. Without this hop the rematch path
   * would re-launch with default palettes and a player would see
   * their character's colour suddenly change.
   */
  lastMatchConfig: 'lastMatchConfig',
  /**
   * Last-saved `HandCursorState` from `CharacterSelectScene`. Persisted
   * on every state change and rehydrated in `init()` so a player who
   * came back from a match (or the rebinding menu) walks back into the
   * lobby with their previous picks, palettes, and slot modes intact —
   * no more re-clicking 4 portraits to set up a rematch.
   */
  lastCharacterSelectState: 'lastCharacterSelectState',
  /**
   * `true` when the player has muted stage music via the in-match
   * speaker toggle (upper-right of the HUD). Persists across scene
   * transitions so a player who muted at the start of one match
   * isn't blasted with audio at the start of the next.
   */
  musicMuted: 'musicMuted',
} as const;

/**
 * Browser capability flags captured once at boot so gameplay code never
 * has to re-detect mid-match (which can stutter on some laptops).
 */
export interface BootFeatureFlags {
  readonly webgl: boolean;
  readonly gamepadApi: boolean;
  readonly webAudio: boolean;
  readonly highResTimer: boolean;
}
