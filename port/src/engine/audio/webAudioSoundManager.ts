import { findAssetEntry } from '../../../../src/assets/manifest';
import type { SoundLike, SoundManagerLike } from '../../../../src/audio/AudioManager';

/** The slice of the Web Audio API this backend uses (a fake in tests). */
export interface AudioContextLike {
  readonly state: string;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

/**
 * The game's `SoundManagerLike` on Web Audio, so the game's own
 * `AudioManager` (cues, buses, voice limits, cooldowns) and
 * `StageMusicController` run unchanged without Phaser. Clips are the
 * manifest's audio entries, fetched and decoded once per key.
 */
export class WebAudioSoundManager implements SoundManagerLike {
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly decoded = new Map<string, AudioBuffer | null>();

  constructor(
    readonly context: AudioContextLike,
    private readonly fetchBytes: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url).then((r) => r.arrayBuffer()),
  ) {}

  /** Start loading clips ahead of their first play. */
  preload(keys: ReadonlyArray<string>): Promise<unknown> {
    return Promise.all(keys.map((k) => this.load(k)));
  }

  /**
   * Browsers start audio suspended until a user gesture: resume on the
   * first key, click or touch. (Gamepad presses do not count as gestures.)
   */
  unlockOnGesture(target: EventTarget = window): void {
    const unlock = () => {
      if (this.context.state === 'suspended') void this.context.resume();
      for (const e of ['keydown', 'pointerdown', 'touchstart']) target.removeEventListener(e, unlock);
    };
    for (const e of ['keydown', 'pointerdown', 'touchstart']) target.addEventListener(e, unlock);
  }

  add(key: string): SoundLike {
    void this.load(key);
    return new WebAudioSound(this, key);
  }

  /** The decoded clip, or undefined while it is still loading (null if it failed). */
  buffer(key: string): AudioBuffer | null | undefined {
    return this.decoded.get(key);
  }

  load(key: string): Promise<AudioBuffer | null> {
    let job = this.buffers.get(key);
    if (!job) {
      const entry = findAssetEntry(key);
      const url = entry && (entry.kind === 'audio' || entry.kind === 'music') ? entry.urls[0] : undefined;
      job = url
        ? this.fetchBytes(url).then((bytes) => this.context.decodeAudioData(bytes)).catch(() => null)
        : Promise.resolve(null);
      job = job.then((b) => { this.decoded.set(key, b); return b; });
      this.buffers.set(key, job);
    }
    return job;
  }
}

/**
 * One playable instance, like a Phaser `BaseSound`: its own gain node, a
 * fresh buffer source per `play`, `complete` when a one-shot ends. A clip
 * still loading starts as soon as it is decoded if it loops (music) and is
 * dropped otherwise (a late hit sound would be wrong).
 */
class WebAudioSound implements SoundLike {
  private source: AudioBufferSourceNode | null = null;
  private readonly gain: GainNode;
  private volume = 1;
  private muted = false;
  private playing = false;
  private readonly listeners = new Map<string, Array<() => void>>();
  private destroyed = false;

  constructor(private readonly manager: WebAudioSoundManager, private readonly key: string) {
    this.gain = manager.context.createGain();
    this.gain.connect(manager.context.destination);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(config: { volume?: number; loop?: boolean } = {}): boolean {
    if (this.destroyed) return false;
    this.stopSource();
    if (config.volume !== undefined) this.setVolume(config.volume);
    const loop = config.loop ?? false;
    const buffer = this.manager.buffer(this.key);
    if (buffer === null) return false;
    if (buffer === undefined) {
      if (!loop) return false;
      this.playing = true;
      void this.manager.load(this.key).then((b) => { if (b && this.playing && !this.source) this.start(b, loop); });
      return true;
    }
    this.playing = true;
    this.start(buffer, loop);
    return true;
  }

  private start(buffer: AudioBuffer, loop: boolean): void {
    const source = this.manager.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.emit('complete');
    };
    this.source = source;
    source.start();
  }

  stop(): void {
    this.playing = false;
    this.stopSource();
  }

  private stopSource(): void {
    const source = this.source;
    this.source = null;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
  }

  setVolume(value: number): void {
    this.volume = value;
    this.applyGain();
  }

  setMute(value: boolean): void {
    this.muted = value;
    this.applyGain();
  }

  private applyGain(): void {
    this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  once(event: string, listener: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  private emit(event: string): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    list.forEach((fn) => fn());
  }

  destroy(): void {
    this.stop();
    this.gain.disconnect();
    this.listeners.clear();
    this.destroyed = true;
  }
}
