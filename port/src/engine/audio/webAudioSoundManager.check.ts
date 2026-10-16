import { describe, expect, it } from 'vitest';
import { ASSET_KEYS } from '../../../../src/assets/manifest';
import { AudioManager } from '../../../../src/audio/AudioManager';
import { type AudioContextLike, WebAudioSoundManager } from './webAudioSoundManager';

/** Records what the backend asks of Web Audio; sources end when told to. */
function fakeContext() {
  const sources: Array<{ loop: boolean; started: boolean; stopped: boolean; end(): void; onended: (() => void) | null }> = [];
  const gains: Array<{ gain: { value: number } }> = [];
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    state: 'running', destination: node(),
    resume: async () => {},
    createGain: () => { const g = { ...node(), gain: { value: 1 } }; gains.push(g); return g; },
    createBufferSource: () => {
      const s = { ...node(), buffer: null, loop: false, started: false, stopped: false, onended: null as (() => void) | null,
        start() { s.started = true; }, stop() { s.stopped = true; }, end() { s.onended?.(); } };
      sources.push(s);
      return s;
    },
    decodeAudioData: async () => ({ duration: 0.2 }),
  } as unknown as AudioContextLike;
  return { context, sources, gains };
}

async function ready(keys: string[]) {
  const fake = fakeContext();
  const manager = new WebAudioSoundManager(fake.context, async () => new ArrayBuffer(8));
  await manager.preload(keys);
  return { ...fake, manager };
}

describe('WebAudioSoundManager', () => {
  it('plays a cue through the game AudioManager at its bus-mixed volume', async () => {
    const { manager, sources, gains } = await ready([ASSET_KEYS.sfxJab]);
    const audio = new AudioManager({ soundManager: manager });
    expect(audio.playSfx(ASSET_KEYS.sfxJab)).toBe(true);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.started).toBe(true);
    expect(gains.at(-1)!.gain.value).toBeCloseTo(0.85); // master 1 x sfx 0.85 x cue 1
  });

  it("frees the voice on 'complete', so the voice limit only counts sounds still playing", async () => {
    const { manager, sources } = await ready([ASSET_KEYS.sfxSmash]);
    let now = 0;
    const audio = new AudioManager({ soundManager: manager, clock: { now: () => now } });
    for (let i = 0; i < 2; i++) { audio.playSfx(ASSET_KEYS.sfxSmash); now += 500; } // limit 2
    sources.forEach((s) => s.end());
    now += 500;
    expect(audio.playSfx(ASSET_KEYS.sfxSmash)).toBe(true);
    expect(sources.filter((s) => s.started && !s.stopped)).toHaveLength(3);
  });

  it('loops music, waiting for a clip still decoding, and stops it', async () => {
    const fake = fakeContext();
    const manager = new WebAudioSoundManager(fake.context, async () => new ArrayBuffer(8));
    const audio = new AudioManager({ soundManager: manager });
    expect(audio.playMusic(ASSET_KEYS.musicStageDefault)).toBe(true); // not decoded yet
    await manager.load(ASSET_KEYS.musicStageDefault);
    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]!.loop).toBe(true);
    audio.stopMusic();
    expect(fake.sources[0]!.stopped).toBe(true);
    expect(audio.isMusicPlaying()).toBe(false);
  });

  it('drops a one-shot whose clip is not decoded yet, and mutes through the gain', async () => {
    const fake = fakeContext();
    const manager = new WebAudioSoundManager(fake.context, async () => new ArrayBuffer(8));
    const sound = manager.add(ASSET_KEYS.sfxKo);
    expect(sound.play()).toBe(false);
    await manager.load(ASSET_KEYS.sfxKo);
    sound.play({ volume: 0.5 });
    sound.setMute(true);
    expect(fake.gains.at(-1)!.gain.value).toBe(0);
    sound.setMute(false);
    expect(fake.gains.at(-1)!.gain.value).toBe(0.5);
  });
});
