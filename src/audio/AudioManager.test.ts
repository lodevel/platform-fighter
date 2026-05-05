import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioManager,
  DEFAULT_AUDIO_CUES,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  type AudioClock,
  type SoundLike,
  type SoundManagerLike,
} from './AudioManager';
import { ASSET_KEYS } from '../assets/manifest';

/**
 * AudioManager contract tests — AC 10301 Sub-AC 1.
 *
 * The four guarantees this suite locks in:
 *
 *   1. **Loads SFX + music registration.** Construction with the
 *      default cue table registers every audio key in the manifest;
 *      `preloadAudio` queues the same keys onto a Phaser-shaped loader.
 *
 *   2. **`playSfx` / `playMusic` API.** Both call into the underlying
 *      sound manager, route to the right bus, and music replaces the
 *      previous track instead of stacking.
 *
 *   3. **Per-bus mixing.** `master × bus × cue` multiplication is
 *      applied to the sound at play time and re-applied to active
 *      voices when a slider moves.
 *
 *   4. **Anti-overlap.** Cooldowns drop within-window calls; voice
 *      limits stop the oldest instance before adding a new one.
 */

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

/**
 * Hand-rolled fake of {@link SoundLike}. Records every call so
 * assertions can inspect e.g. `sound.volumeHistory` without poking
 * private fields.
 */
class FakeSound implements SoundLike {
  isPlaying = false;
  destroyed = false;
  muted = false;
  lastVolume: number | null = null;
  lastPlayConfig: { volume?: number; loop?: boolean } | null = null;
  stopped = 0;
  private completeListeners: Array<() => void> = [];
  readonly volumeHistory: number[] = [];

  constructor(readonly key: string) {}

  play(config?: { volume?: number; loop?: boolean }): unknown {
    this.isPlaying = true;
    this.lastPlayConfig = config ?? null;
    return this;
  }

  stop(): unknown {
    this.isPlaying = false;
    this.stopped += 1;
    return this;
  }

  setVolume(value: number): unknown {
    this.lastVolume = value;
    this.volumeHistory.push(value);
    return this;
  }

  setMute(value: boolean): unknown {
    this.muted = value;
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

  /** Test helper — fire the `complete` event once (mirrors `once` semantics). */
  fireComplete(): void {
    const listeners = this.completeListeners;
    this.completeListeners = [];
    for (const l of listeners) l();
  }
}

/**
 * Fake {@link SoundManagerLike} that mints {@link FakeSound}s and
 * records every key it was asked to add.
 */
class FakeSoundManager implements SoundManagerLike {
  readonly added: FakeSound[] = [];

  add(key: string): SoundLike {
    const s = new FakeSound(key);
    this.added.push(s);
    return s;
  }

  /** Filter `added` to just those minted for a given key. */
  forKey(key: string): FakeSound[] {
    return this.added.filter((s) => s.key === key);
  }
}

/** Manually-advanceable test clock (ms). */
class FakeClock implements AudioClock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

// ---------------------------------------------------------------------------
// Construction defaults
// ---------------------------------------------------------------------------

describe('AudioManager — construction & registration', () => {
  let mgr: AudioManager;
  let sm: FakeSoundManager;
  let clock: FakeClock;

  beforeEach(() => {
    sm = new FakeSoundManager();
    clock = new FakeClock();
    mgr = new AudioManager({ soundManager: sm, clock });
  });

  it('registers every audio + music key from the default cue table', () => {
    const registered = new Set(mgr.getRegisteredCueKeys());
    for (const key of Object.keys(DEFAULT_AUDIO_CUES)) {
      expect(registered.has(key)).toBe(true);
    }
  });

  it('routes SFX cues to the sfx bus and music cues to the music bus', () => {
    expect(mgr.getCueConfig(ASSET_KEYS.sfxJab)?.bus).toBe('sfx');
    expect(mgr.getCueConfig(ASSET_KEYS.musicStageDefault)?.bus).toBe('music');
  });

  it('applies sensible per-cue defaults (loop on music, voiceLimit on sfx)', () => {
    const music = mgr.getCueConfig(ASSET_KEYS.musicStageDefault);
    expect(music?.loop).toBe(true);
    // Music defaults to a single-voice channel — `playMusic` enforces
    // single-track continuity by stopping the previous track.
    expect(music?.voiceLimit).toBe(1);

    const jab = mgr.getCueConfig(ASSET_KEYS.sfxJab);
    expect(jab?.loop).toBe(false);
    expect(jab?.voiceLimit).toBeGreaterThanOrEqual(2);
  });

  it('seeds bus volumes to the documented defaults', () => {
    expect(mgr.getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
    expect(mgr.getSfxVolume()).toBe(DEFAULT_SFX_VOLUME);
    expect(mgr.getMusicVolume()).toBe(DEFAULT_MUSIC_VOLUME);
    expect(mgr.isMuted()).toBe(false);
  });

  it('accepts a custom cue table that overrides the defaults', () => {
    const custom = new AudioManager({
      soundManager: sm,
      clock,
      cues: {
        'sfx.test': { bus: 'sfx', cooldownMs: 500, voiceLimit: 1 },
      },
    });
    expect(custom.getRegisteredCueKeys()).toEqual(['sfx.test']);
    expect(custom.getCueConfig(ASSET_KEYS.sfxJab)).toBeNull();
  });

  it('exposes a static preloadAudio helper that queues every audio key onto a loader fake', () => {
    const queued: string[] = [];
    AudioManager.preloadAudio({
      audio: (key) => {
        queued.push(key);
      },
    });
    // Every audio + music key from the manifest should be queued.
    for (const key of Object.keys(DEFAULT_AUDIO_CUES)) {
      expect(queued).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// playSfx — happy path & dispatch
// ---------------------------------------------------------------------------

describe('AudioManager — playSfx', () => {
  let mgr: AudioManager;
  let sm: FakeSoundManager;
  let clock: FakeClock;

  beforeEach(() => {
    sm = new FakeSoundManager();
    clock = new FakeClock();
    mgr = new AudioManager({ soundManager: sm, clock });
  });

  it('starts a sound for a registered SFX key', () => {
    expect(mgr.playSfx(ASSET_KEYS.sfxJab)).toBe(true);
    const minted = sm.forKey(ASSET_KEYS.sfxJab);
    expect(minted).toHaveLength(1);
    expect(minted[0]?.isPlaying).toBe(true);
    expect(minted[0]?.lastPlayConfig?.loop).toBe(false);
  });

  it('returns false for an unregistered key', () => {
    expect(mgr.playSfx('sfx.does.not.exist')).toBe(false);
    expect(sm.added).toHaveLength(0);
  });

  it('refuses to play a music-bus cue through the SFX path', () => {
    expect(mgr.playSfx(ASSET_KEYS.musicStageDefault)).toBe(false);
    expect(sm.added).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// playMusic — single-track continuity
// ---------------------------------------------------------------------------

describe('AudioManager — playMusic', () => {
  let mgr: AudioManager;
  let sm: FakeSoundManager;
  let clock: FakeClock;

  beforeEach(() => {
    sm = new FakeSoundManager();
    clock = new FakeClock();
    mgr = new AudioManager({ soundManager: sm, clock });
  });

  it('plays a music-bus cue and tracks it as the current music', () => {
    expect(mgr.playMusic(ASSET_KEYS.musicStageDefault)).toBe(true);
    expect(mgr.getCurrentMusicKey()).toBe(ASSET_KEYS.musicStageDefault);
    const minted = sm.forKey(ASSET_KEYS.musicStageDefault);
    expect(minted).toHaveLength(1);
    expect(minted[0]?.lastPlayConfig?.loop).toBe(true);
    expect(mgr.isMusicPlaying()).toBe(true);
  });

  it('refuses to play a SFX-bus cue through the music path', () => {
    expect(mgr.playMusic(ASSET_KEYS.sfxJab)).toBe(false);
  });

  it('replaying the same music key is a no-op (no double-spawn)', () => {
    mgr.playMusic(ASSET_KEYS.musicStageDefault);
    mgr.playMusic(ASSET_KEYS.musicStageDefault);
    expect(sm.forKey(ASSET_KEYS.musicStageDefault)).toHaveLength(1);
  });

  it('switching music stops the previous track first', () => {
    // Register a second music-bus cue so we can test a swap.
    mgr.registerCue('music.alt', { bus: 'music', loop: true });
    mgr.playMusic(ASSET_KEYS.musicStageDefault);
    const first = sm.forKey(ASSET_KEYS.musicStageDefault)[0];
    expect(first).toBeDefined();

    mgr.playMusic('music.alt');
    expect(first?.stopped).toBeGreaterThanOrEqual(1);
    expect(mgr.getCurrentMusicKey()).toBe('music.alt');
  });

  it('stopMusic halts the current track and clears the slot', () => {
    mgr.playMusic(ASSET_KEYS.musicStageDefault);
    mgr.stopMusic();
    expect(mgr.getCurrentMusicKey()).toBeNull();
    expect(mgr.isMusicPlaying()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Volume buses
// ---------------------------------------------------------------------------

describe('AudioManager — volume mixing', () => {
  let mgr: AudioManager;
  let sm: FakeSoundManager;
  let clock: FakeClock;

  beforeEach(() => {
    sm = new FakeSoundManager();
    clock = new FakeClock();
    mgr = new AudioManager({
      soundManager: sm,
      clock,
      masterVolume: 1,
      sfxVolume: 0.5,
      musicVolume: 0.25,
    });
  });

  it('multiplies master × bus × cue when a sound is played', () => {
    // Default jab cue volume is 1; bus mix is master(1) × sfx(0.5) × cue(1) = 0.5
    mgr.playSfx(ASSET_KEYS.sfxJab);
    const sound = sm.forKey(ASSET_KEYS.sfxJab)[0];
    expect(sound?.lastVolume).toBeCloseTo(0.5, 5);
  });

  it('re-applies effective volume to active voices when a slider moves', () => {
    mgr.playSfx(ASSET_KEYS.sfxJab);
    const sound = sm.forKey(ASSET_KEYS.sfxJab)[0];
    expect(sound).toBeDefined();
    const before = sound!.lastVolume;
    mgr.setSfxVolume(0.1);
    expect(sound!.lastVolume).not.toBe(before);
    expect(sound!.lastVolume).toBeCloseTo(1 * 0.1 * 1, 5);
  });

  it('clamps out-of-range slider values into [0, 1]', () => {
    mgr.setMasterVolume(2);
    expect(mgr.getMasterVolume()).toBe(1);
    mgr.setMasterVolume(-1);
    expect(mgr.getMasterVolume()).toBe(0);
    mgr.setMasterVolume(Number.NaN);
    expect(mgr.getMasterVolume()).toBe(0);
  });

  it('mute drives effective volume to 0 without losing the slider state', () => {
    mgr.setMuted(true);
    expect(mgr.computeEffectiveVolume(ASSET_KEYS.sfxJab)).toBe(0);
    mgr.setMuted(false);
    expect(mgr.computeEffectiveVolume(ASSET_KEYS.sfxJab)).toBeGreaterThan(0);
  });

  it('mute applies setMute(true) to every active voice', () => {
    mgr.playSfx(ASSET_KEYS.sfxJab);
    const sound = sm.forKey(ASSET_KEYS.sfxJab)[0];
    expect(sound?.muted).toBe(false);
    mgr.setMuted(true);
    expect(sound?.muted).toBe(true);
  });

  it('routes music through the music bus, not the sfx bus', () => {
    mgr.playMusic(ASSET_KEYS.musicStageDefault);
    const sound = sm.forKey(ASSET_KEYS.musicStageDefault)[0];
    // master(1) × music(0.25) × cue(1) = 0.25
    expect(sound?.lastVolume).toBeCloseTo(0.25, 5);
  });
});

// ---------------------------------------------------------------------------
// Anti-overlap: cooldowns
// ---------------------------------------------------------------------------

describe('AudioManager — cooldowns', () => {
  let mgr: AudioManager;
  let sm: FakeSoundManager;
  let clock: FakeClock;

  beforeEach(() => {
    sm = new FakeSoundManager();
    clock = new FakeClock();
    mgr = new AudioManager({
      soundManager: sm,
      clock,
      cues: {
        'sfx.test': { bus: 'sfx', cooldownMs: 100, voiceLimit: 8 },
      },
    });
  });

  it('drops a within-window play and returns false', () => {
    expect(mgr.playSfx('sfx.test')).toBe(true);
    // Same instant — should be blocked by the cooldown.
    expect(mgr.playSfx('sfx.test')).toBe(false);
    expect(sm.forKey('sfx.test')).toHaveLength(1);
  });

  it('admits a play once the cooldown elapses', () => {
    mgr.playSfx('sfx.test');
    clock.advance(50);
    expect(mgr.playSfx('sfx.test')).toBe(false);
    clock.advance(60); // total = 110ms, > cooldownMs
    expect(mgr.playSfx('sfx.test')).toBe(true);
    expect(sm.forKey('sfx.test')).toHaveLength(2);
  });

  it('cooldowns are independent per key', () => {
    mgr.registerCue('sfx.other', { bus: 'sfx', cooldownMs: 100 });
    mgr.playSfx('sfx.test');
    expect(mgr.playSfx('sfx.other')).toBe(true);
    expect(mgr.playSfx('sfx.test')).toBe(false);
  });

  it('a cue with cooldownMs=0 admits back-to-back plays', () => {
    mgr.registerCue('sfx.fast', { bus: 'sfx', cooldownMs: 0, voiceLimit: 8 });
    expect(mgr.playSfx('sfx.fast')).toBe(true);
    expect(mgr.playSfx('sfx.fast')).toBe(true);
    expect(mgr.playSfx('sfx.fast')).toBe(true);
    expect(sm.forKey('sfx.fast')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Anti-overlap: voice limits / voice stealing
// ---------------------------------------------------------------------------

describe('AudioManager — voice limits', () => {
  let mgr: AudioManager;
  let sm: FakeSoundManager;
  let clock: FakeClock;

  beforeEach(() => {
    sm = new FakeSoundManager();
    clock = new FakeClock();
    mgr = new AudioManager({
      soundManager: sm,
      clock,
      cues: {
        'sfx.cap': { bus: 'sfx', cooldownMs: 0, voiceLimit: 2 },
      },
    });
  });

  it('caps simultaneous voices and steals the oldest when the cap is hit', () => {
    mgr.playSfx('sfx.cap');
    mgr.playSfx('sfx.cap');
    expect(mgr.getActiveVoiceCount('sfx.cap')).toBe(2);

    const minted = sm.forKey('sfx.cap');
    const oldest = minted[0];
    expect(oldest?.isPlaying).toBe(true);

    // Third play forces eviction of the oldest (FIFO).
    mgr.playSfx('sfx.cap');
    expect(mgr.getActiveVoiceCount('sfx.cap')).toBe(2);
    expect(oldest?.stopped).toBeGreaterThanOrEqual(1);
    expect(oldest?.destroyed).toBe(true);
  });

  it('completion of a sound frees its voice slot', () => {
    mgr.playSfx('sfx.cap');
    mgr.playSfx('sfx.cap');
    const [a, b] = sm.forKey('sfx.cap');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    a!.fireComplete();
    expect(mgr.getActiveVoiceCount('sfx.cap')).toBe(1);

    // A fresh play now slots in without stealing.
    mgr.playSfx('sfx.cap');
    expect(mgr.getActiveVoiceCount('sfx.cap')).toBe(2);
    // `b` (the previously-second voice) should still be playing — no eviction.
    expect(b!.stopped).toBe(0);
  });

  it('voice limits do not bleed across keys', () => {
    mgr.registerCue('sfx.other', { bus: 'sfx', cooldownMs: 0, voiceLimit: 1 });
    mgr.playSfx('sfx.cap');
    mgr.playSfx('sfx.cap');
    mgr.playSfx('sfx.other');
    expect(mgr.getActiveVoiceCount('sfx.cap')).toBe(2);
    expect(mgr.getActiveVoiceCount('sfx.other')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('AudioManager — lifecycle', () => {
  it('destroy stops every active voice + the music track and blocks future plays', () => {
    const sm = new FakeSoundManager();
    const clock = new FakeClock();
    const mgr = new AudioManager({ soundManager: sm, clock });

    mgr.playSfx(ASSET_KEYS.sfxJab);
    mgr.playMusic(ASSET_KEYS.musicStageDefault);
    const jab = sm.forKey(ASSET_KEYS.sfxJab)[0];
    const music = sm.forKey(ASSET_KEYS.musicStageDefault)[0];

    mgr.destroy();
    expect(jab?.stopped).toBeGreaterThanOrEqual(1);
    expect(jab?.destroyed).toBe(true);
    expect(music?.stopped).toBeGreaterThanOrEqual(1);

    expect(mgr.playSfx(ASSET_KEYS.sfxJab)).toBe(false);
    expect(mgr.playMusic(ASSET_KEYS.musicStageDefault)).toBe(false);
  });

  it('destroy is idempotent', () => {
    const sm = new FakeSoundManager();
    const mgr = new AudioManager({ soundManager: sm });
    mgr.destroy();
    expect(() => mgr.destroy()).not.toThrow();
  });
});
