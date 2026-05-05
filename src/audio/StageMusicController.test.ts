import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_STAGE_MUSIC_KEY,
  StageMusicController,
  type StageMusicAudio,
} from './StageMusicController';
import { ASSET_KEYS } from '../assets/manifest';
import {
  AudioManager,
  type SoundLike,
  type SoundManagerLike,
} from './AudioManager';

/**
 * StageMusicController contract tests — AC 10303 Sub-AC 3.
 *
 * The four guarantees this suite locks in:
 *
 *   1. **Start on scene begin.** A fresh controller's `start()` calls
 *      `playMusic` with the M1 stage music key (or an explicit key
 *      when supplied) and reports `isStarted() === true`.
 *
 *   2. **Idempotent start.** Repeat `start()` calls don't double-spawn
 *      the underlying voice — the AudioManager's "same track already
 *      playing" branch keeps the live track.
 *
 *   3. **Stop + destroy on scene shutdown.** `destroy()` halts the
 *      music and, when the controller owns its AudioManager, tears
 *      down every voice. A second `destroy()` call is a no-op.
 *
 *   4. **Defensive failure.** A `start()` that fails inside the
 *      AudioManager (asset missing from cache, audio context refused
 *      the gesture) returns `false` without crashing the caller; a
 *      `start()` after `destroy()` returns `false` instead of
 *      reanimating a torn-down manager.
 */

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

/**
 * Recorder fake of {@link StageMusicAudio}. Captures the call sequence
 * so the lifecycle tests can assert "start, stop, destroy were called
 * in this order" without spinning up an AudioManager.
 *
 * The optional `playMusicResult` lets a test simulate a failing audio
 * backend (e.g. autoplay refused) to drive the `start()` returns
 * `false` branch.
 */
class RecorderAudio implements StageMusicAudio {
  /** Every method invocation, in call order. Tests assert against this. */
  readonly calls: Array<{ readonly method: string; readonly arg?: string }> = [];
  private currentKey: string | null = null;
  private destroyed = false;
  /** Override the return value of `playMusic` — used by the failure test. */
  playMusicResult = true;

  playMusic(key: string): boolean {
    this.calls.push({ method: 'playMusic', arg: key });
    if (!this.playMusicResult) return false;
    if (this.destroyed) return false;
    this.currentKey = key;
    return true;
  }

  stopMusic(): void {
    this.calls.push({ method: 'stopMusic' });
    this.currentKey = null;
  }

  getCurrentMusicKey(): string | null {
    return this.currentKey;
  }

  destroy(): void {
    this.calls.push({ method: 'destroy' });
    this.destroyed = true;
    this.currentKey = null;
  }
}

/**
 * Hand-rolled minimal {@link SoundLike} for the `fromSoundManager`
 * integration test — same shape as the AudioManager's own test fake,
 * lifted here so we're testing the production wiring end-to-end.
 */
class FakeSound implements SoundLike {
  isPlaying = false;
  destroyed = false;
  stopped = 0;
  lastVolume: number | null = null;
  private completeListeners: Array<() => void> = [];
  constructor(readonly key: string) {}

  play(): unknown {
    this.isPlaying = true;
    return this;
  }
  stop(): unknown {
    this.isPlaying = false;
    this.stopped += 1;
    return this;
  }
  setVolume(value: number): unknown {
    this.lastVolume = value;
    return this;
  }
  setMute(): unknown {
    return this;
  }
  once(event: string, listener: () => void): unknown {
    if (event === 'complete') this.completeListeners.push(listener);
    return this;
  }
  destroy(): void {
    this.destroyed = true;
    this.isPlaying = false;
  }
}

class FakeSoundManager implements SoundManagerLike {
  readonly added: FakeSound[] = [];
  add(key: string): SoundLike {
    const s = new FakeSound(key);
    this.added.push(s);
    return s;
  }
  forKey(key: string): FakeSound[] {
    return this.added.filter((s) => s.key === key);
  }
}

// ---------------------------------------------------------------------------
// Sub-AC 3: scene-create starts the music
// ---------------------------------------------------------------------------

describe('StageMusicController — scene-create lifecycle', () => {
  let audio: RecorderAudio;
  let ctl: StageMusicController;

  beforeEach(() => {
    audio = new RecorderAudio();
    ctl = new StageMusicController({ audio });
  });

  it('start() plays the M1 stage music key by default', () => {
    expect(ctl.start()).toBe(true);
    expect(audio.calls).toEqual([
      { method: 'playMusic', arg: DEFAULT_STAGE_MUSIC_KEY },
    ]);
    expect(DEFAULT_STAGE_MUSIC_KEY).toBe(ASSET_KEYS.musicStageDefault);
  });

  it('start() forwards an explicit key when supplied', () => {
    expect(ctl.start('music.stage.lava')).toBe(true);
    expect(audio.calls[0]).toEqual({ method: 'playMusic', arg: 'music.stage.lava' });
    expect(ctl.getRequestedKey()).toBe('music.stage.lava');
  });

  it('reports isStarted() once the audio surface holds the track', () => {
    expect(ctl.isStarted()).toBe(false);
    ctl.start();
    expect(ctl.isStarted()).toBe(true);
  });

  it('start() returning false when the audio backend rejects the cue does not throw', () => {
    audio.playMusicResult = false;
    expect(() => ctl.start()).not.toThrow();
    expect(ctl.start()).toBe(false);
    // The reject didn't latch — a follow-up retry once audio is healthy
    // re-enters the play path.
    audio.playMusicResult = true;
    expect(ctl.start()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3: idempotent start (no double-playback)
// ---------------------------------------------------------------------------

describe('StageMusicController — idempotent start', () => {
  it('repeat start() with the same key does not crash', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio });
    ctl.start();
    expect(() => ctl.start()).not.toThrow();
    // Two playMusic calls hit the AudioManager — but the AudioManager's
    // own "same track already playing" branch keeps the live voice.
    // The controller delegates that guarantee rather than duplicating
    // it; the integration test below proves the no-double-spawn end-
    // to-end through a real AudioManager.
    expect(audio.calls).toHaveLength(2);
  });

  it('switching keys mid-flight stops the previous track via the audio surface', () => {
    // The AudioManager stops the previous track first when a new key
    // is supplied — mirror that behaviour through the recorder fake by
    // updating the current key on each playMusic call.
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio });
    ctl.start();
    expect(audio.getCurrentMusicKey()).toBe(DEFAULT_STAGE_MUSIC_KEY);
    ctl.start('music.alt');
    // The recorder swaps the key on each `playMusic` call (matching
    // the AudioManager's behaviour); the controller delegates the
    // "stop previous" logic to the audio surface.
    expect(audio.getCurrentMusicKey()).toBe('music.alt');
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3: shutdown stops + cleans up
// ---------------------------------------------------------------------------

describe('StageMusicController — scene-shutdown lifecycle', () => {
  it('stop() halts the music without destroying the controller', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio });
    ctl.start();
    ctl.stop();
    expect(audio.calls.map((c) => c.method)).toEqual(['playMusic', 'stopMusic']);
    expect(ctl.isStarted()).toBe(false);
    expect(ctl.isDestroyed()).toBe(false);
    // Re-start works after a stop — the controller is reusable.
    ctl.start();
    expect(audio.calls.map((c) => c.method)).toEqual([
      'playMusic',
      'stopMusic',
      'playMusic',
    ]);
  });

  it('destroy() stops the music and tears down the audio when owned', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio, ownsAudio: true });
    ctl.start();
    ctl.destroy();
    // SHUTDOWN order: stop the music first (so a final `complete` event
    // can't reach a half-disposed manager), THEN destroy the manager.
    expect(audio.calls.map((c) => c.method)).toEqual([
      'playMusic',
      'stopMusic',
      'destroy',
    ]);
    expect(ctl.isDestroyed()).toBe(true);
  });

  it('destroy() does NOT tear down the audio when externally owned', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio /* ownsAudio defaults false */ });
    ctl.start();
    ctl.destroy();
    expect(audio.calls.map((c) => c.method)).toEqual([
      'playMusic',
      'stopMusic',
    ]);
    expect(ctl.isDestroyed()).toBe(true);
  });

  it('destroy() is idempotent — a second SHUTDOWN call does not crash', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio, ownsAudio: true });
    ctl.start();
    ctl.destroy();
    expect(() => ctl.destroy()).not.toThrow();
    // Second destroy is a no-op — call log unchanged.
    expect(audio.calls.map((c) => c.method)).toEqual([
      'playMusic',
      'stopMusic',
      'destroy',
    ]);
  });

  it('start() after destroy() returns false (no resurrection)', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio, ownsAudio: true });
    ctl.start();
    ctl.destroy();
    expect(ctl.start()).toBe(false);
    // No additional playMusic call hit the audio after destroy.
    expect(audio.calls.filter((c) => c.method === 'playMusic')).toHaveLength(1);
  });

  it('stop() after destroy() is a no-op', () => {
    const audio = new RecorderAudio();
    const ctl = new StageMusicController({ audio, ownsAudio: true });
    ctl.start();
    ctl.destroy();
    const before = audio.calls.length;
    ctl.stop();
    expect(audio.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// fromSoundManager — production construction path through the real AudioManager
// ---------------------------------------------------------------------------

describe('StageMusicController — fromSoundManager (production path)', () => {
  it('mints a real AudioManager and starts the M1 music in seamless loop', () => {
    const sm = new FakeSoundManager();
    const ctl = StageMusicController.fromSoundManager(sm);

    expect(ctl.start()).toBe(true);
    const minted = sm.forKey(ASSET_KEYS.musicStageDefault);
    expect(minted).toHaveLength(1);
    // Each minted music sound is started — proving the AudioManager
    // routed through the music bus and the controller fired the play.
    expect(minted[0]?.isPlaying).toBe(true);
    expect(ctl.isStarted()).toBe(true);
  });

  it('repeat start() does NOT double-spawn the underlying voice', () => {
    const sm = new FakeSoundManager();
    const ctl = StageMusicController.fromSoundManager(sm);
    ctl.start();
    ctl.start();
    // The AudioManager's "same track already playing" branch holds the
    // line: only one underlying voice was minted across both calls.
    expect(sm.forKey(ASSET_KEYS.musicStageDefault)).toHaveLength(1);
  });

  it('destroy() stops the underlying voice and blocks future starts', () => {
    const sm = new FakeSoundManager();
    const ctl = StageMusicController.fromSoundManager(sm);
    ctl.start();
    const sound = sm.forKey(ASSET_KEYS.musicStageDefault)[0];
    expect(sound).toBeDefined();

    ctl.destroy();

    expect(sound!.stopped).toBeGreaterThanOrEqual(1);
    expect(ctl.isDestroyed()).toBe(true);
    // Owned-audio destroy: a follow-up start() is rejected — the
    // AudioManager returned by fromSoundManager has been torn down.
    expect(ctl.start()).toBe(false);
  });

  it('does not leak a second voice when the same scene is re-entered (start/destroy/start)', () => {
    // Mimics the M1 scene-restart path:
    //   create() → start() → SHUTDOWN → destroy()
    //   (re-enter)
    //   create() → fresh controller → start()
    const sm = new FakeSoundManager();
    const ctl1 = StageMusicController.fromSoundManager(sm);
    ctl1.start();
    const firstSound = sm.forKey(ASSET_KEYS.musicStageDefault)[0];
    expect(firstSound).toBeDefined();

    ctl1.destroy();
    expect(firstSound!.stopped).toBeGreaterThanOrEqual(1);

    // Fresh controller for the re-entered scene.
    const ctl2 = StageMusicController.fromSoundManager(sm);
    ctl2.start();
    const minted = sm.forKey(ASSET_KEYS.musicStageDefault);
    // First (now stopped) voice + second freshly minted voice — total
    // two MintEd sounds, but only ONE is currently playing. The
    // contract is "no double-playback after a SHUTDOWN", which is
    // exactly that.
    expect(minted).toHaveLength(2);
    const playing = minted.filter((s) => s.isPlaying);
    expect(playing).toHaveLength(1);
  });

  it('delegates through the AudioManager (real instance) for the music bus', () => {
    // Sanity check: the controller's audio surface is an AudioManager,
    // not a side channel — the M5 audio panel can read the music bus
    // mix through the same manager.
    const sm = new FakeSoundManager();
    const audio = new AudioManager({ soundManager: sm });
    const ctl = new StageMusicController({ audio, ownsAudio: false });
    ctl.start();
    expect(audio.getCurrentMusicKey()).toBe(ASSET_KEYS.musicStageDefault);
    expect(audio.isMusicPlaying()).toBe(true);

    // Externally-owned: destroy stops the music but leaves the manager
    // alive so a sibling SFX caller can keep playing into it.
    ctl.destroy();
    expect(audio.getCurrentMusicKey()).toBeNull();
    // Manager itself is still alive — a fresh playMusic returns true.
    expect(audio.playMusic(ASSET_KEYS.musicStageDefault)).toBe(true);
  });
});
