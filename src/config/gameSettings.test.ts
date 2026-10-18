import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS, GAME_SETTINGS_STORAGE_KEY, loadGameSettings, saveGameSettings } from './gameSettings';

function memory(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[GAME_SETTINGS_STORAGE_KEY, initial]]);
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('game settings persistence', () => {
  it('defaults to full texture quality and legacy fighter art when nothing is saved or storage is absent', () => {
    expect(DEFAULT_GAME_SETTINGS).toEqual({ textureQuality: 'full', fighterDisplay: 'legacy' });
    expect(loadGameSettings(memory())).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadGameSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('round-trips saved settings under the versioned key', () => {
    const storage = memory();
    saveGameSettings({ textureQuality: 'compressed', fighterDisplay: 'packages' }, storage);
    expect(JSON.parse(storage.values.get('platformfighter.settings.v1')!)).toEqual({ textureQuality: 'compressed', fighterDisplay: 'packages' });
    expect(loadGameSettings(storage)).toEqual({ textureQuality: 'compressed', fighterDisplay: 'packages' });
  });

  it('keeps a save from before the fighter art option', () => {
    expect(loadGameSettings(memory('{"textureQuality":"compressed"}'))).toEqual({ textureQuality: 'compressed', fighterDisplay: 'legacy' });
  });

  it('falls back to defaults for corrupt JSON and invalid or missing fields', () => {
    for (const raw of ['{', 'null', '42', '[]', '{}', '{"textureQuality":"ultra"}', '{"textureQuality":1}', '{"fighterDisplay":"skeleton"}']) {
      expect(loadGameSettings(memory(raw))).toEqual(DEFAULT_GAME_SETTINGS);
    }
  });

  it('never throws when storage access, reads or writes throw', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadGameSettings(broken)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(() => saveGameSettings({ ...DEFAULT_GAME_SETTINGS, textureQuality: 'compressed' }, broken)).not.toThrow();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      expect(loadGameSettings()).toEqual(DEFAULT_GAME_SETTINGS);
      expect(() => saveGameSettings(DEFAULT_GAME_SETTINGS)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('uses the ambient localStorage when no storage is passed', () => {
    const storage = memory();
    vi.stubGlobal('localStorage', storage);
    saveGameSettings({ ...DEFAULT_GAME_SETTINGS, textureQuality: 'compressed' });
    expect(loadGameSettings()).toEqual({ ...DEFAULT_GAME_SETTINGS, textureQuality: 'compressed' });
  });
});
