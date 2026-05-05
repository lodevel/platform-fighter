/**
 * StageMusicController — AC 10303 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * The M1 stage scene needs a single piece of audio glue: when the
 * scene boots, start the stage music track on a seamless loop; when
 * the scene shuts down (player ESCs to the menu, replay ends, scene
 * is restarted), stop the track and release the underlying voice so
 * a re-entry doesn't double up the soundtrack.
 *
 * Without a dedicated controller, every scene that wants stage music
 * has to:
 *
 *   • Construct an {@link AudioManager} (or reach for a shared one).
 *   • Call `playMusic(key)` after stage-rendering so the cache key is
 *     guaranteed to be loaded.
 *   • Wire `stopMusic()` + `destroy()` into the scene's SHUTDOWN
 *     handler so a re-entry doesn't leak voices or double-play the
 *     same loop on top of itself.
 *
 * Each of those steps is a tiny chunk of logic, but they share two
 * non-obvious invariants:
 *
 *   1. **Idempotence on every entry point.** A SHUTDOWN handler that
 *      fires twice (Phaser sometimes does, depending on how a scene
 *      transition lands) must not crash on the second pass. Equally,
 *      a defensive `start()` call inside scene `create()` that runs
 *      after a partial-construction hot-reload must not spawn a second
 *      voice on top of the first.
 *
 *   2. **Audio is never on the deterministic path.** A failure to
 *      mint the underlying sound (asset missing from cache, audio
 *      context suspended, browser autoplay policy refused the
 *      gesture) MUST NOT take the match down. The controller swallows
 *      such failures and reports them via the boolean return from
 *      {@link StageMusicController.start}.
 *
 * Encoding both invariants once, in a tested module, keeps every
 * future stage scene's audio wiring trivial: construct, `start()` in
 * `create()`, `destroy()` in SHUTDOWN — done.
 *
 * Design
 * ------
 *
 *   • The controller wraps an injected {@link StageMusicAudio} surface
 *     (the four calls it actually uses on the AudioManager). This is
 *     the same "narrow interface + DI" pattern the AudioManager uses
 *     itself for {@link SoundManagerLike}, and it lets the unit tests
 *     verify the lifecycle contract without spinning up Phaser.
 *
 *   • {@link StageMusicController.start} is idempotent — calling it
 *     a second time with the same key returns the AudioManager's
 *     own "same key already playing" no-op result. The controller
 *     does NOT cache that the stop already ran; a double-start that
 *     comes after a stop will re-boot the track cleanly.
 *
 *   • {@link StageMusicController.stop} stops the track without
 *     destroying the underlying AudioManager — useful for a future
 *     "pause music while the menu overlay is up" transition that
 *     wants to resume play without re-allocating the manager.
 *
 *   • {@link StageMusicController.destroy} stops the track AND, when
 *     the controller owns the AudioManager (the default for the
 *     scene-owned construction path), tears it down completely so a
 *     subsequent `start()` returns `false`. This is the SHUTDOWN
 *     contract.
 *
 * Why a separate module (instead of inlining into MatchScene)
 * -----------------------------------------------------------
 *
 *   • MatchScene is already 2.7k lines. Adding scene-lifecycle audio
 *     wiring inline pushes it further into "too big to grok at a
 *     glance" territory. A 100-line controller module is far cheaper
 *     to read and test.
 *
 *   • The same controller is reused by every M2+ stage scene (lava,
 *     wind, custom). Encoding it once means a future per-stage music
 *     track (e.g. when the StageLayout grows a `musicKey?: string`
 *     field) is a one-line change rather than a four-scene refactor.
 *
 *   • Vitest can drive the lifecycle contract end-to-end with a
 *     hand-rolled fake — no Phaser scene boot required. The
 *     accompanying `StageMusicController.test.ts` covers the
 *     idempotence + double-shutdown + start-after-destroy cases.
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`.
 * The {@link StageMusicAudio} interface narrows to exactly the four
 * AudioManager calls the controller invokes; production callers pass
 * the AudioManager (which structurally satisfies the interface).
 * `null` checks gate every access through the controller's owned
 * AudioManager so a post-destroy call can't dereference a stale
 * reference.
 */

import { ASSET_KEYS } from '../assets/manifest';
import { AudioManager, type SoundManagerLike } from './AudioManager';

// ---------------------------------------------------------------------------
// Default music key
// ---------------------------------------------------------------------------

/**
 * The M1 stage music cache key. Pulled out as a named constant so the
 * scene wiring reads as `controller.start(DEFAULT_STAGE_MUSIC_KEY)`
 * rather than threading the raw `'music.stage.default'` string through
 * call sites — keeps the canonical reference local to this module so a
 * future per-stage track (StageLayout-driven) only needs the wiring
 * here to grow a lookup.
 */
export const DEFAULT_STAGE_MUSIC_KEY = ASSET_KEYS.musicStageDefault;

// ---------------------------------------------------------------------------
// Audio surface
// ---------------------------------------------------------------------------

/**
 * Narrow subset of {@link AudioManager} the controller calls into.
 * Production passes the AudioManager itself (it structurally
 * satisfies); tests pass a recorder fake that asserts the lifecycle
 * call order without dragging in the full sound-manager surface.
 *
 * Each method's purpose:
 *
 *   • `playMusic(key)` — start the named music track on the
 *      `AudioManager`'s music bus. Returns `true` when playback
 *      started or the same key was already playing. Looped + bus-
 *      mixed by the AudioManager's per-cue config.
 *
 *   • `stopMusic()`   — halt the current music track. Idempotent on
 *      "no music currently playing".
 *
 *   • `getCurrentMusicKey()` — for the `isStarted()` accessor (so the
 *      controller doesn't have to keep its own duplicate flag). Returns
 *      `null` when no music is playing.
 *
 *   • `destroy()`     — release every active voice + the music
 *      track. Subsequent `playMusic` calls return `false`. Idempotent.
 */
export interface StageMusicAudio {
  playMusic(key: string): boolean;
  stopMusic(): void;
  getCurrentMusicKey(): string | null;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link StageMusicController}.
 *
 * The controller has two construction paths:
 *
 *   1. **Scene-owned (`fromSoundManager`).** Pass a Phaser sound manager
 *       and the controller mints its own AudioManager. The controller
 *       then OWNS the manager and tears it down on `destroy()`. This
 *       is what `MatchScene` uses: one AudioManager per match, dropped
 *       on SHUTDOWN.
 *
 *   2. **Externally-owned (direct constructor).** Pass an `audio`
 *       surface (production: an existing AudioManager you also use for
 *       SFX). The controller does NOT destroy that audio surface on
 *       `destroy()` — only the music track is stopped. Useful for the
 *       (future) "shared AudioManager across scenes" path where SFX
 *       and music live on the same instance.
 *
 * The two paths use the same controller class because the only
 * behavioural difference is `destroy()`'s ownership semantics — keeping
 * them in one type means callers don't pick the wrong constructor.
 */
export interface StageMusicControllerOptions {
  /**
   * The audio surface the controller drives. Required.
   */
  readonly audio: StageMusicAudio;
  /**
   * When `true`, `destroy()` calls `audio.destroy()` after stopping
   * the music. Set automatically by {@link StageMusicController.fromSoundManager}.
   * Defaults to `false` so the externally-owned path doesn't
   * accidentally tear down a shared AudioManager. Hidden behind a
   * named constant rather than a magic boolean so the call sites read
   * intent.
   */
  readonly ownsAudio?: boolean;
}

// ---------------------------------------------------------------------------
// StageMusicController
// ---------------------------------------------------------------------------

/**
 * Lifecycle facade for the stage music track.
 *
 * Typical scene wiring:
 *
 *   ```ts
 *   class MatchScene extends Phaser.Scene {
 *     private stageMusic!: StageMusicController;
 *
 *     create(): void {
 *       this.stageMusic = StageMusicController.fromSoundManager(this.sound);
 *       this.stageMusic.start();
 *
 *       this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
 *         this.stageMusic.destroy();
 *       });
 *     }
 *   }
 *   ```
 *
 * The four guarantees this class locks in:
 *
 *   1. `start()` is idempotent — repeat calls with the same key are
 *      no-ops; the AudioManager's "same track already playing" branch
 *      keeps the existing voice.
 *
 *   2. `start()` returns `false` defensively when the asset is missing
 *      from cache, the audio context is suspended, or the controller
 *      has already been destroyed. Match flow continues regardless.
 *
 *   3. `stop()` halts the track without destroying the underlying
 *      AudioManager so a future "menu pause" overlay can resume music
 *      without re-allocating the audio backend.
 *
 *   4. `destroy()` is idempotent and tears down every voice when the
 *      controller owns its AudioManager. A SHUTDOWN handler that fires
 *      twice does not crash and does not leak.
 */
export class StageMusicController {
  private readonly audio: StageMusicAudio;
  private readonly ownsAudio: boolean;
  /** Set once {@link destroy} has run; subsequent calls are no-ops. */
  private destroyed = false;
  /** Most recent key requested via {@link start}; used by {@link getRequestedKey}. */
  private requestedKey: string | null = null;

  constructor(options: StageMusicControllerOptions) {
    this.audio = options.audio;
    this.ownsAudio = options.ownsAudio ?? false;
  }

  // -------------------------------------------------------------------------
  // Construction helpers
  // -------------------------------------------------------------------------

  /**
   * Mint a controller that owns its own AudioManager, wired to the
   * supplied Phaser sound manager (or any structurally-compatible
   * fake). The controller's `destroy()` will tear the AudioManager
   * down completely — the standard "one manager per match" path.
   *
   * @param soundManager - Phaser scene's `sound` (or test fake).
   */
  static fromSoundManager(soundManager: SoundManagerLike): StageMusicController {
    const audio = new AudioManager({ soundManager });
    return new StageMusicController({ audio, ownsAudio: true });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the stage music track on a seamless loop.
   *
   * The default key is {@link DEFAULT_STAGE_MUSIC_KEY} — the M1 stage
   * music. Future per-stage tracks pass an explicit key.
   *
   * Returns `true` when playback started or the same key was already
   * playing; `false` when:
   *
   *   • The controller has already been destroyed.
   *   • The AudioManager's `playMusic` rejected the call (asset
   *      missing from cache, key isn't on the music bus, audio context
   *      suspended).
   *
   * Idempotent on repeat calls with the same key — the AudioManager's
   * own "same track already playing" guard keeps the live voice.
   * Calling with a *different* key while a track is playing swaps the
   * track (the AudioManager stops the previous one first).
   */
  start(key: string = DEFAULT_STAGE_MUSIC_KEY): boolean {
    if (this.destroyed) return false;
    this.requestedKey = key;
    return this.audio.playMusic(key);
  }

  /**
   * Stop the music track. Does NOT destroy the underlying AudioManager
   * — a subsequent `start()` will boot the track again on the same
   * audio backend. Idempotent on "no music currently playing".
   */
  stop(): void {
    if (this.destroyed) return;
    this.audio.stopMusic();
    this.requestedKey = null;
  }

  /**
   * Tear down the controller. Stops the music track and, when the
   * controller owns its AudioManager (the {@link fromSoundManager}
   * path), destroys the manager too so every voice is released.
   * Subsequent `start()` calls return `false`.
   *
   * Idempotent — a second `destroy()` call (e.g. a SHUTDOWN handler
   * that fires twice during a scene transition) is a no-op.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Always stop the track first so a scene-owned AudioManager that
    // we're about to `destroy()` doesn't fire a final mid-tear-down
    // `complete` event into a half-disposed state.
    try {
      this.audio.stopMusic();
    } catch {
      // The underlying audio backend may already be torn down (Phaser
      // cleans up its sound context when the game shuts down). Swallow
      // — we're tearing it out anyway.
    }
    if (this.ownsAudio) {
      try {
        this.audio.destroy();
      } catch {
        /* swallow — already destroyed */
      }
    }
    this.requestedKey = null;
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /**
   * `true` when the AudioManager reports an active music track. Reads
   * through the AudioManager rather than caching a duplicate flag so
   * a third party that called `audio.stopMusic()` directly (e.g. the
   * future menu overlay's "mute everything" path) is still reflected
   * here.
   */
  isStarted(): boolean {
    if (this.destroyed) return false;
    return this.audio.getCurrentMusicKey() !== null;
  }

  /**
   * The most recent key passed to {@link start}, or `null` when the
   * track has been stopped or never started. Useful for tests + the
   * (later-AC) M5 audio panel which wants to display "currently
   * playing" without poking the AudioManager directly.
   */
  getRequestedKey(): string | null {
    return this.requestedKey;
  }

  /** `true` once {@link destroy} has run. */
  isDestroyed(): boolean {
    return this.destroyed;
  }
}
