/**
 * AudioManager — AC 10301 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The game's combat path raises hundreds of audio events per match
 * (jab on every active hitbox frame, KO bursts when a stock is taken,
 * shield clangs on every blocked hit). Wiring those callers directly
 * to {@link Phaser.Sound.BaseSoundManager#play} gets us three failure
 * modes immediately:
 *
 *   1. **Pathological stacking.** A jab that lands twice in the same
 *      frame fires `play('sfx.jab')` twice; the player hears a
 *      compressed click, not a satisfying snap. Worse — a stuck
 *      animation can call `play()` every frame and dump 60 voices/sec
 *      onto the audio context.
 *
 *   2. **No volume mixing.** Phaser's `SoundManager` only exposes a
 *      single global `volume` setting. The user-facing M5 audio panel
 *      needs separate **master**, **SFX**, and **music** sliders so a
 *      streamer can drop SFX without muting the soundtrack.
 *
 *   3. **No music continuity.** `playMusic('music.stage.default')` on
 *      every scene transition would create overlapping loops; the
 *      stage builder previewing a track would step on the menu music.
 *
 * This module fixes all three with a small, dependency-light layer
 * over the Phaser sound manager:
 *
 *   • {@link AudioManager.playSfx} dispatches a one-shot SFX through a
 *     per-cue **cooldown** (min ms between plays) and **voice limit**
 *     (max simultaneous instances) so a stuck caller can't flood the
 *     mixer.
 *
 *   • {@link AudioManager.playMusic} stops any previously-playing
 *     music track before starting the new one and tags it with the
 *     music bus so the volume sliders mix it independently from SFX.
 *
 *   • Three volume buses (**master**, **sfx**, **music**) are
 *     multiplied to derive each cue's effective playback volume. The
 *     master bus is the global trim; the sfx/music buses are the
 *     per-category sliders. Mute is a separate flag that overrides
 *     volume without wiping the slider state.
 *
 * Why an injectable {@link SoundManagerLike} (not "just take a Phaser
 * Scene")
 * -------------------------------------------------------------------
 *
 *   • The codebase compiles + tests under vitest in Node, where
 *     Phaser's WebAudio backend doesn't exist. Mirroring the
 *     {@link BindingsStorage} pattern of "narrow interface + test
 *     fakes" lets every cooldown / voice-limit assertion run without
 *     touching a real audio context.
 *
 *   • The interface narrows to the four calls the manager actually
 *     uses (`add` to mint a tracked sound, `play`/`stop`/`destroy` on
 *     the sound), so a future swap to a non-Phaser backend (e.g.
 *     Howler.js for a `<canvas>` build target) is a single adapter
 *     module rather than a refactor.
 *
 * Determinism
 * -----------
 *
 *   • Audio is deliberately *not* part of the deterministic
 *     gameplay simulation. Replays do not record sound output —
 *     the sim re-emits combat events and the AudioManager re-derives
 *     SFX from those events on playback. Cooldowns are wall-clock
 *     based ({@link AudioClock}) because audio decisions don't need
 *     to be byte-identical across runs; missing a single jab cue if
 *     the renderer hitches by 50 ms is acceptable.
 *
 *   • The module never reads `Math.random()` and never mutates any
 *     state the gameplay simulation observes — the AudioManager is a
 *     pure side-effect sink.
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`.
 * Every Map lookup that returns `T | undefined` is checked. The
 * {@link SoundLike} interface narrows to the methods needed for
 * voice-limit eviction and the `complete` event hookup that prunes
 * destroyed instances; production callers pass `Phaser.Sound.BaseSound`
 * instances which structurally satisfy the interface.
 */

import { ASSET_KEYS, ASSET_MANIFEST, type AssetManifest } from '../assets/manifest';

// ---------------------------------------------------------------------------
// Bus / cue type model
// ---------------------------------------------------------------------------

/**
 * Two volume buses the manager mixes independently.
 *
 *   - `'sfx'`   : every {@link AudioManager.playSfx} call routes here.
 *                 Subject to per-cue cooldowns + voice limits.
 *   - `'music'` : the single looping track played by
 *                 {@link AudioManager.playMusic}. Cooldowns / voice
 *                 limits do NOT apply — music continuity is enforced
 *                 by stopping the previous track first.
 *
 * A future "ambience" bus (wind howl, lava bubble) would slot in here
 * as a third tag without changing the per-cue API.
 */
export type AudioBus = 'sfx' | 'music';

/**
 * Per-cue configuration registered with the manager. Looked up by
 * cache key on every `play*` call so a stuck caller can't sneak past
 * the cooldown by calling under a different surface.
 *
 * Field semantics:
 *
 *   - `bus`         : routes the cue through the matching volume bus.
 *
 *   - `volume`      : per-cue trim in [0, 1]. Defaults to `1`. The
 *                     final playback volume is
 *                     `master × bus × cue.volume` (then clamped to
 *                     [0, 1]). Useful for SFX that were authored hot
 *                     (e.g. KO bursts) without rebuilding the asset.
 *
 *   - `cooldownMs`  : minimum wall-clock gap between two successful
 *                     `play*` calls for this key. A play within the
 *                     cooldown window returns `false` and is silently
 *                     dropped. Defaults to `0` (no cooldown). Set to
 *                     ~50–120 ms for melee SFX so a multi-hit tilt
 *                     doesn't sound like one elongated click.
 *
 *   - `voiceLimit`  : maximum number of concurrent playing instances
 *                     for this key. Once the limit is reached, the
 *                     **oldest** playing instance is stopped and the
 *                     new one starts (voice-stealing). Defaults to
 *                     `4` for SFX cues — high enough that 4-player
 *                     pile-ons don't drop hits, low enough that a
 *                     stuck caller can't open 60 voices/sec.
 *
 *   - `loop`        : true ⇒ the cue plays in a loop until stopped.
 *                     Music cues default to `true`; SFX cues default
 *                     to `false`.
 *
 * The defaults are conservative — callers can override any field per
 * cue when they {@link AudioManager.registerCue} a new sound.
 */
export interface AudioCueConfig {
  readonly bus: AudioBus;
  readonly volume?: number;
  readonly cooldownMs?: number;
  readonly voiceLimit?: number;
  readonly loop?: boolean;
}

/**
 * Resolved (defaults-applied) cue config the manager actually
 * consults at play time. Exposed as a return shape for the
 * {@link AudioManager.getCueConfig} accessor so the M5 audio panel
 * can render "this cue plays at 80% with a 100ms cooldown" without
 * re-deriving the defaults.
 */
export interface ResolvedAudioCueConfig {
  readonly bus: AudioBus;
  readonly volume: number;
  readonly cooldownMs: number;
  readonly voiceLimit: number;
  readonly loop: boolean;
}

// ---------------------------------------------------------------------------
// Sound / sound-manager / clock abstractions
// ---------------------------------------------------------------------------

/**
 * Minimal subset of {@link Phaser.Sound.BaseSound} the manager pokes.
 *
 * Production: a `Phaser.Sound.BaseSound` instance returned from
 * {@link Phaser.Sound.BaseSoundManager#add} structurally satisfies
 * this interface — no adapter required.
 *
 * Tests: pass a hand-rolled fake (see `AudioManager.test.ts`).
 *
 * Why each method is on the surface:
 *
 *   - `play()`    : starts playback. We pass an inline config so the
 *                   per-cue volume + loop flag are applied at play
 *                   time rather than baked into the sound at `add()`.
 *   - `stop()`    : voice-stealing eviction + `stopMusic`.
 *   - `setVolume`: applies a new bus mix to a sound that's already
 *                  playing (e.g. user dragged the SFX slider while a
 *                  jab was airborne).
 *   - `setMute`  : ditto for the global mute toggle.
 *   - `on/once`  : we wire `'complete'` to prune the active-voices
 *                  list so a long shield SFX doesn't pin a voice
 *                  slot after it naturally ends.
 *   - `destroy`  : called on manager teardown to free the underlying
 *                  buffer source.
 */
export interface SoundLike {
  readonly isPlaying: boolean;
  play(config?: { volume?: number; loop?: boolean }): unknown;
  stop(): unknown;
  setVolume(value: number): unknown;
  setMute(value: boolean): unknown;
  once(event: string, listener: () => void): unknown;
  destroy(): void;
}

/**
 * Minimal subset of {@link Phaser.Sound.BaseSoundManager}.
 *
 * The manager only ever calls `add(key)` to mint a fresh tracked
 * instance — playback / volume control happens on the returned
 * {@link SoundLike}, not on the manager. This keeps the dependency
 * surface tiny and makes it trivial to back the AudioManager with a
 * non-Phaser audio engine in the future.
 */
export interface SoundManagerLike {
  add(key: string): SoundLike;
}

/**
 * Wall-clock source for cooldown bookkeeping. Production passes
 * `() => performance.now()`; tests inject a controllable fake so an
 * assertion like "two plays within 50 ms drops the second" is
 * reproducible without `setTimeout`.
 *
 * Numbers are milliseconds, monotonic. The manager only ever
 * subtracts pairs of returned values, so a clock that starts at any
 * arbitrary epoch (e.g. page load, not unix time) is fine.
 */
export interface AudioClock {
  now(): number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default per-cue voice limit when the registration omits one. */
export const DEFAULT_VOICE_LIMIT = 4;

/** Default per-cue cooldown (ms) when the registration omits one. */
export const DEFAULT_COOLDOWN_MS = 0;

/** Default per-cue volume trim (0..1) when the registration omits one. */
export const DEFAULT_CUE_VOLUME = 1;

/** Default master bus volume. The audio panel slider snaps to this on first run. */
export const DEFAULT_MASTER_VOLUME = 1;

/** Default SFX bus volume. Slightly attenuated from master so SFX sit under music by default. */
export const DEFAULT_SFX_VOLUME = 0.85;

/** Default music bus volume — softer than SFX so combat cues read clearly over the loop. */
export const DEFAULT_MUSIC_VOLUME = 0.6;

/**
 * Built-in cue table covering every audio key the AC's M1 manifest
 * ships. Cooldowns and voice limits are tuned to combat-feel
 * defaults:
 *
 *   • Jab / aerial spam tightly (60–80 ms gap, 4 voices) — they're
 *     the most-fired cues and need to feel responsive in 2v2 brawls.
 *   • Smash / KO are sparse but loud — longer cooldown (120–200 ms)
 *     and a 2-voice cap so two simultaneous KOs don't crush the mix.
 *   • Shield / dodge are defensive cues — single source of truth per
 *     player, 2 voices is plenty for 4-player matches.
 *   • Music is a single looping track — `loop: true`, no cooldown,
 *     voice limit irrelevant ({@link AudioManager.playMusic} already
 *     stops the previous track).
 *
 * Frozen because this table is shared across every AudioManager
 * instance and no caller should mutate the defaults.
 */
export const DEFAULT_AUDIO_CUES: Readonly<Record<string, AudioCueConfig>> =
  Object.freeze({
    [ASSET_KEYS.sfxJab]: { bus: 'sfx', cooldownMs: 60, voiceLimit: 4 },
    [ASSET_KEYS.sfxTilt]: { bus: 'sfx', cooldownMs: 80, voiceLimit: 3 },
    [ASSET_KEYS.sfxSmash]: { bus: 'sfx', cooldownMs: 120, voiceLimit: 2 },
    [ASSET_KEYS.sfxAerial]: { bus: 'sfx', cooldownMs: 80, voiceLimit: 4 },
    [ASSET_KEYS.sfxKo]: { bus: 'sfx', cooldownMs: 200, voiceLimit: 2 },
    [ASSET_KEYS.sfxShield]: { bus: 'sfx', cooldownMs: 100, voiceLimit: 2 },
    [ASSET_KEYS.sfxDodge]: { bus: 'sfx', cooldownMs: 100, voiceLimit: 2 },
    // M1.5 action-audio expansion (AC 10304). Movement cues fire often
    // (jump on every press, land on every touchdown) so they get a tight
    // cooldown + a generous voice budget for 4-player pile-ons. Connect
    // cues mirror the swing cooldowns. Shield-shatter is a sparse, loud
    // event (2-voice cap). The charge cue is the only LOOPING SFX —
    // `loop: true` + a single voice, started / stopped explicitly by the
    // renderer as the wind-up begins / ends (NOT a one-shot), trimmed to
    // 0.6 so a sustained hum sits under the combat mix.
    [ASSET_KEYS.sfxJump]: { bus: 'sfx', cooldownMs: 80, voiceLimit: 4 },
    [ASSET_KEYS.sfxJumpAir]: { bus: 'sfx', cooldownMs: 80, voiceLimit: 4 },
    [ASSET_KEYS.sfxLand]: { bus: 'sfx', cooldownMs: 80, voiceLimit: 4, volume: 0.8 },
    [ASSET_KEYS.sfxHitLight]: { bus: 'sfx', cooldownMs: 60, voiceLimit: 4 },
    [ASSET_KEYS.sfxHitHeavy]: { bus: 'sfx', cooldownMs: 90, voiceLimit: 3 },
    [ASSET_KEYS.sfxClang]: { bus: 'sfx', cooldownMs: 80, voiceLimit: 3 },
    [ASSET_KEYS.sfxShieldBreak]: { bus: 'sfx', cooldownMs: 150, voiceLimit: 2 },
    [ASSET_KEYS.sfxCharge]: { bus: 'sfx', cooldownMs: 0, voiceLimit: 1, loop: true, volume: 0.6 },
    [ASSET_KEYS.musicStageDefault]: { bus: 'music', loop: true, volume: 1 },
  });

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link AudioManager}. Every field is
 * optional except `soundManager` so the boot sequence can spin one
 * up with `new AudioManager({ soundManager: scene.sound })` and let
 * the defaults handle the rest.
 */
export interface AudioManagerOptions {
  /** Phaser sound manager (or test fake). Required. */
  readonly soundManager: SoundManagerLike;
  /**
   * Wall-clock source for cooldown bookkeeping. Defaults to
   * `performance.now()` when available, else `Date.now()` — both are
   * monotonic-enough for cooldown gating.
   */
  readonly clock?: AudioClock;
  /**
   * Per-cue configurations to register at construction. Defaults to
   * {@link DEFAULT_AUDIO_CUES}; pass `{}` to start with an empty
   * table and register cues incrementally via
   * {@link AudioManager.registerCue}.
   */
  readonly cues?: Readonly<Record<string, AudioCueConfig>>;
  /** Initial master bus volume. Defaults to {@link DEFAULT_MASTER_VOLUME}. */
  readonly masterVolume?: number;
  /** Initial SFX bus volume. Defaults to {@link DEFAULT_SFX_VOLUME}. */
  readonly sfxVolume?: number;
  /** Initial music bus volume. Defaults to {@link DEFAULT_MUSIC_VOLUME}. */
  readonly musicVolume?: number;
  /** Initial mute state. Defaults to `false`. */
  readonly muted?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the default {@link AudioClock}. `performance.now()` is the
 * preferred source (monotonic, sub-ms resolution); we fall back to
 * `Date.now()` in environments where `performance` is unavailable
 * (older Node test runners, sandboxed iframes). Both are good enough
 * for the millisecond-grained cooldown gates this module enforces.
 */
function defaultClock(): AudioClock {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (perf && typeof perf.now === 'function') {
    return { now: () => perf.now!() };
  }
  return { now: () => Date.now() };
}

/**
 * Clamp a volume slider value into [0, 1]. Non-finite inputs (NaN
 * from a UI parse, ±Infinity from a corrupted save) collapse to `0`
 * so a single bad slider can never amplify the rest of the mix.
 */
function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Apply defaults to a partial cue config. Centralised so
 * {@link AudioManager.getCueConfig} and the per-play resolution path
 * agree on what "a cue with no explicit cooldown" actually means.
 */
function resolveCueConfig(raw: AudioCueConfig): ResolvedAudioCueConfig {
  const isMusicBus = raw.bus === 'music';
  return {
    bus: raw.bus,
    volume: raw.volume === undefined ? DEFAULT_CUE_VOLUME : clampVolume(raw.volume),
    cooldownMs:
      raw.cooldownMs === undefined || raw.cooldownMs < 0
        ? DEFAULT_COOLDOWN_MS
        : raw.cooldownMs,
    voiceLimit:
      raw.voiceLimit === undefined || raw.voiceLimit < 1
        ? // Music is a single-voice channel by default — `playMusic`
          // stops the previous track first, so `1` is the correct
          // logical limit. SFX defaults to {@link DEFAULT_VOICE_LIMIT}.
          isMusicBus
          ? 1
          : DEFAULT_VOICE_LIMIT
        : Math.floor(raw.voiceLimit),
    loop: raw.loop === undefined ? isMusicBus : raw.loop,
  };
}

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

/**
 * The audio facade. Construct once at boot (in `BootScene` or a
 * dedicated bootstrap module), then call `playSfx` / `playMusic`
 * from gameplay code via a shared reference (or DI from the active
 * scene).
 */
export class AudioManager {
  private readonly soundManager: SoundManagerLike;
  private readonly clock: AudioClock;
  /** Resolved cue table — one entry per registered key. */
  private readonly cues: Map<string, ResolvedAudioCueConfig> = new Map();
  /** Wall-clock timestamp at which each key may next be played. */
  private readonly cooldownExpiry: Map<string, number> = new Map();
  /** Per-key list of currently-active sound instances (FIFO for voice stealing). */
  private readonly activeVoices: Map<string, SoundLike[]> = new Map();
  /** The single currently-playing music track, or `null` when none. */
  private currentMusic: { readonly key: string; readonly sound: SoundLike } | null = null;

  private masterVolume: number;
  private sfxVolume: number;
  private musicVolume: number;
  private muted: boolean;
  /** Set once {@link AudioManager.destroy} has run; subsequent calls are no-ops. */
  private destroyed = false;

  constructor(options: AudioManagerOptions) {
    this.soundManager = options.soundManager;
    this.clock = options.clock ?? defaultClock();
    this.masterVolume = clampVolume(options.masterVolume ?? DEFAULT_MASTER_VOLUME);
    this.sfxVolume = clampVolume(options.sfxVolume ?? DEFAULT_SFX_VOLUME);
    this.musicVolume = clampVolume(options.musicVolume ?? DEFAULT_MUSIC_VOLUME);
    this.muted = options.muted ?? false;

    // Register the supplied (or default) cue table. Each registration
    // funnels through `registerCue` so default-application is in one
    // place and a malformed default would fail loud here at boot.
    const cueTable = options.cues ?? DEFAULT_AUDIO_CUES;
    for (const [key, cfg] of Object.entries(cueTable)) {
      this.registerCue(key, cfg);
    }
  }

  // -------------------------------------------------------------------------
  // Cue registration
  // -------------------------------------------------------------------------

  /**
   * Register or override a cue's configuration. Idempotent — calling
   * twice with different configs replaces the previous entry. Tests
   * use this to inject a per-test cue table without rebuilding the
   * manager.
   */
  registerCue(key: string, config: AudioCueConfig): void {
    this.cues.set(key, resolveCueConfig(config));
  }

  /** Remove a cue registration. Subsequent `play*` calls for the key are no-ops. */
  unregisterCue(key: string): void {
    this.cues.delete(key);
  }

  /** Inspect a cue's resolved config — used by the M5 audio panel UI. */
  getCueConfig(key: string): ResolvedAudioCueConfig | null {
    return this.cues.get(key) ?? null;
  }

  /** Returns every registered cue key. Stable iteration order matches insertion. */
  getRegisteredCueKeys(): readonly string[] {
    return Array.from(this.cues.keys());
  }

  // -------------------------------------------------------------------------
  // Play paths
  // -------------------------------------------------------------------------

  /**
   * Play an SFX cue.
   *
   * Returns `true` when playback started, `false` when the cue was
   * dropped (cooldown not elapsed, manager destroyed, key not
   * registered, or registered cue is on the music bus).
   *
   * The cooldown check uses the injected {@link AudioClock} — two
   * calls within the cue's `cooldownMs` window collapse to one. The
   * voice-limit check evicts the **oldest** still-playing instance
   * (voice stealing) so we never silently drop a fresh hit in favour
   * of a stale one — combat audio prefers "newest hit wins".
   */
  playSfx(key: string): boolean {
    if (this.destroyed) return false;
    const cue = this.cues.get(key);
    if (!cue) return false;
    if (cue.bus !== 'sfx') return false;
    return this.playInternal(key, cue);
  }

  /**
   * Start a **looping** SFX cue idempotently — the charge wind-up hum
   * path (AC 10304).
   *
   * Unlike {@link playSfx} (a one-shot that voice-steals on a re-call),
   * this is safe to call every frame while a sustained loop should be
   * playing: if a voice for `key` is already active it is a no-op and
   * returns `true`, so the renderer can drive "keep the charge hum
   * going" without restarting the sample each tick. Returns `false`
   * when the key isn't a registered SFX-bus cue or the manager is
   * destroyed.
   *
   * The cue should be registered with `loop: true` (the AudioManager
   * does not force it); the {@link DEFAULT_AUDIO_CUES} charge entry
   * already is. Stop the loop with {@link stopSfx}.
   */
  playSfxLoop(key: string): boolean {
    if (this.destroyed) return false;
    const cue = this.cues.get(key);
    if (!cue) return false;
    if (cue.bus !== 'sfx') return false;
    // Already looping — keep the live voice rather than voice-stealing
    // it (which would audibly restart the sample mid-charge).
    if (this.getActiveVoiceCount(key) > 0) return true;
    return this.playInternal(key, cue);
  }

  /**
   * Stop every active voice for an SFX cue — the companion to
   * {@link playSfxLoop} for ending a sustained loop (charge hum stops
   * the frame the wind-up ends). Safe to call when nothing is playing
   * (no-op). Does NOT touch the music bus — use {@link stopMusic} for
   * the soundtrack.
   */
  stopSfx(key: string): void {
    if (this.destroyed) return;
    const voices = this.activeVoices.get(key);
    if (!voices) return;
    // Copy + clear first so the `complete`-event pruning a `stop()` may
    // synchronously fire can't mutate the array we're iterating.
    const toStop = voices.slice();
    this.activeVoices.delete(key);
    for (const sound of toStop) {
      try {
        sound.stop();
        sound.destroy();
      } catch {
        /* swallow — already torn down */
      }
    }
  }

  /**
   * Play a music cue. Replaces any currently-playing music
   * (`stopMusic` is invoked first) so the bed track is always
   * single-source. Returns `true` on success; `false` if the key
   * isn't registered, isn't on the music bus, or the manager is
   * destroyed.
   *
   * Calling with the same key as the currently-playing track is a
   * no-op and returns `true` — useful for scene transitions where
   * the next scene wants the same music to keep going seamlessly.
   */
  playMusic(key: string): boolean {
    if (this.destroyed) return false;
    const cue = this.cues.get(key);
    if (!cue) return false;
    if (cue.bus !== 'music') return false;
    if (this.currentMusic && this.currentMusic.key === key) {
      // Idempotent: same track already playing — keep playing it.
      // Re-applying the volume in case a slider moved between calls.
      this.currentMusic.sound.setVolume(this.effectiveVolume(cue));
      return true;
    }
    this.stopMusic();
    return this.playInternal(key, cue);
  }

  /** Stop the current music track if any. Safe to call when no music is playing. */
  stopMusic(): void {
    if (!this.currentMusic) return;
    try {
      this.currentMusic.sound.stop();
    } catch {
      // The underlying sound may already be destroyed (Phaser cleans
      // up when scenes shut down). Swallow — we're tearing it out
      // anyway.
    }
    // Drop the active-voices entry too so a future `playSfx` for the
    // same key (a hypothetical M2 stinger that doubles as music)
    // starts with a clean voice budget.
    this.activeVoices.delete(this.currentMusic.key);
    this.currentMusic = null;
  }

  /** True when the manager is currently driving a music track. */
  isMusicPlaying(): boolean {
    return this.currentMusic !== null && this.currentMusic.sound.isPlaying;
  }

  /** Cache key of the currently-playing music track, or `null`. */
  getCurrentMusicKey(): string | null {
    return this.currentMusic?.key ?? null;
  }

  // -------------------------------------------------------------------------
  // Volume + mute control
  // -------------------------------------------------------------------------

  /**
   * Set the master bus volume in [0, 1]. Out-of-range values clamp
   * silently; non-finite values (NaN) collapse to 0 — a corrupted
   * settings save can never amplify the mix.
   *
   * Re-applies the new effective volume to every active voice so a
   * slider drag during a long SFX (e.g. a 0.5s shield clang) is
   * heard immediately rather than only on the next play.
   */
  setMasterVolume(value: number): void {
    this.masterVolume = clampVolume(value);
    this.refreshActiveVolumes();
  }

  /** Set the SFX bus volume. Same semantics as {@link setMasterVolume}. */
  setSfxVolume(value: number): void {
    this.sfxVolume = clampVolume(value);
    this.refreshActiveVolumes();
  }

  /** Set the music bus volume. Same semantics as {@link setMasterVolume}. */
  setMusicVolume(value: number): void {
    this.musicVolume = clampVolume(value);
    this.refreshActiveVolumes();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  /**
   * Toggle the global mute. Independent of the volume sliders — un-
   * muting restores the previously-set volumes without a slider
   * round-trip. Applies to every active voice immediately.
   */
  setMuted(value: boolean): void {
    this.muted = value;
    for (const voices of this.activeVoices.values()) {
      for (const sound of voices) {
        sound.setMute(value);
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Stop every active voice + music track and mark the manager
   * destroyed. Subsequent `play*` calls are no-ops returning
   * `false`. Idempotent.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopMusic();
    for (const voices of this.activeVoices.values()) {
      for (const sound of voices) {
        try {
          sound.stop();
          sound.destroy();
        } catch {
          /* swallow — sound may already be torn down */
        }
      }
    }
    this.activeVoices.clear();
    this.cooldownExpiry.clear();
    this.cues.clear();
  }

  // -------------------------------------------------------------------------
  // Diagnostics — used by tests + the M5 audio panel "active voices" readout
  // -------------------------------------------------------------------------

  /** Number of currently-tracked playing instances for a key (0 when none). */
  getActiveVoiceCount(key: string): number {
    return this.activeVoices.get(key)?.length ?? 0;
  }

  /**
   * Effective volume the next play of `key` would use. Exposed for
   * tests (so they can assert the bus mix without mocking
   * `setVolume`) and the audio panel's per-cue "what does this slider
   * combo sound like" preview.
   *
   * Returns `0` when muted or when the key isn't registered.
   */
  computeEffectiveVolume(key: string): number {
    if (this.muted) return 0;
    const cue = this.cues.get(key);
    if (!cue) return 0;
    return this.effectiveVolume(cue);
  }

  // -------------------------------------------------------------------------
  // Asset-loading helper (the AC's "loads SFX and music assets" surface)
  // -------------------------------------------------------------------------

  /**
   * Queue every audio + music entry from the supplied
   * {@link AssetManifest} into a Phaser-loader-shaped target. The
   * normal boot path (PreloadScene) already walks the full manifest,
   * so most callers will never invoke this directly — but exposing
   * the audio-only loader path makes the AudioManager self-contained
   * for tooling that wants to spin up the sound layer without a full
   * preload (e.g. a stage-builder preview that only needs the music
   * bed).
   *
   * The `loader` parameter is kept structural so tests can pass a
   * trivial fake without depending on Phaser's loader plugin.
   */
  static preloadAudio(
    loader: { audio: (key: string, urls: readonly string[] | string[]) => unknown },
    manifest: AssetManifest = ASSET_MANIFEST,
  ): void {
    for (const entry of manifest.audio) {
      loader.audio(entry.key, [...entry.urls]);
    }
    for (const entry of manifest.music) {
      loader.audio(entry.key, [...entry.urls]);
    }
  }

  // -------------------------------------------------------------------------
  // Internal — play dispatch + voice/cooldown enforcement
  // -------------------------------------------------------------------------

  /**
   * Shared play path used by both `playSfx` and `playMusic`. Handles
   * cooldown gate, voice-limit eviction, sound creation, completion
   * tracking, and mute application.
   */
  private playInternal(key: string, cue: ResolvedAudioCueConfig): boolean {
    // ---- Cooldown gate ---------------------------------------------------
    if (cue.cooldownMs > 0) {
      const now = this.clock.now();
      const earliest = this.cooldownExpiry.get(key) ?? 0;
      if (now < earliest) {
        return false;
      }
      this.cooldownExpiry.set(key, now + cue.cooldownMs);
    }

    // ---- Voice-limit eviction -------------------------------------------
    // We trim *before* adding the new voice so the post-add invariant
    // is `voices.length <= cue.voiceLimit`. Stop+destroy the oldest
    // (FIFO) so combat hits feel "newest wins" rather than "first wins".
    let voices = this.activeVoices.get(key);
    if (!voices) {
      voices = [];
      this.activeVoices.set(key, voices);
    }
    while (voices.length >= cue.voiceLimit) {
      const oldest = voices.shift();
      if (oldest) {
        try {
          oldest.stop();
          oldest.destroy();
        } catch {
          /* swallow — already destroyed */
        }
      }
    }

    // ---- Mint + start the sound -----------------------------------------
    let sound: SoundLike;
    try {
      sound = this.soundManager.add(key);
    } catch {
      // Phaser raises if the key isn't in the audio cache — that's a
      // missing-asset bug, but at runtime we'd rather drop the cue
      // than crash a match. The boot-time preload tests catch the
      // real failure.
      return false;
    }
    const volume = this.effectiveVolume(cue);
    sound.setVolume(volume);
    if (this.muted) {
      sound.setMute(true);
    }
    try {
      sound.play({ volume, loop: cue.loop });
    } catch {
      // Same defensive posture as `add` above.
      return false;
    }

    // ---- Track the active instance --------------------------------------
    voices.push(sound);
    // Music keeps a separate hot reference for `stopMusic` /
    // `isMusicPlaying` lookups — it would be ambiguous to scan the
    // active-voices map for the music bus (a future "ambience" cue
    // could legitimately also be on the music bus).
    if (cue.bus === 'music') {
      this.currentMusic = { key, sound };
    }
    // Prune the voice from the active list once playback ends so a
    // long-tail SFX (shield clang, KO crash) doesn't pin the slot
    // until voice-stealing forcibly evicts it. `once` (not `on`) so
    // the listener can't fire twice on a looping sound.
    sound.once('complete', () => {
      this.removeActiveVoice(key, sound);
      if (this.currentMusic && this.currentMusic.sound === sound) {
        this.currentMusic = null;
      }
    });

    return true;
  }

  /** Compute the bus-mixed volume for a cue, honouring mute. */
  private effectiveVolume(cue: ResolvedAudioCueConfig): number {
    if (this.muted) return 0;
    const bus = cue.bus === 'sfx' ? this.sfxVolume : this.musicVolume;
    return clampVolume(this.masterVolume * bus * cue.volume);
  }

  /** Re-apply current bus mix to every active voice. */
  private refreshActiveVolumes(): void {
    for (const [key, voices] of this.activeVoices) {
      const cue = this.cues.get(key);
      if (!cue) continue;
      const volume = this.effectiveVolume(cue);
      for (const sound of voices) {
        sound.setVolume(volume);
      }
    }
  }

  /** Remove a specific sound instance from the active-voices list. */
  private removeActiveVoice(key: string, sound: SoundLike): void {
    const voices = this.activeVoices.get(key);
    if (!voices) return;
    const idx = voices.indexOf(sound);
    if (idx >= 0) voices.splice(idx, 1);
    if (voices.length === 0) this.activeVoices.delete(key);
  }
}
