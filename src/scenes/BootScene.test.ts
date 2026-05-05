import { describe, it, expect } from 'vitest';
// Import from the Phaser-free contract module so this test runs under
// plain Node (no jsdom, no Phaser globals).
import { BOOT_REGISTRY_KEYS } from './bootKeys';

/**
 * BootScene wires Phaser, so we can't unit-test the full scene without
 * spinning up a Game in jsdom. What we *can* lock down is the registry
 * key contract — every downstream scene relies on these exact strings,
 * and silently renaming one would desync replays and AI seeding.
 */
describe('BootScene registry contract', () => {
  it('exposes every key downstream scenes depend on', () => {
    // Required keys that other scenes (PreloadScene, MainMenuScene,
    // MatchScene, ReplayScene) read from the registry.
    const required = [
      'booted',
      'startedAt',
      'engineConfig',
      'rng',
      'rngSeed',
      'matchRng',
      'matchRngSeed',
      'features',
      'whitePixelKey',
      'loaderDotKey',
      'inputBindingsStore',
    ] as const;

    for (const key of required) {
      expect(BOOT_REGISTRY_KEYS[key]).toBeTypeOf('string');
      expect(BOOT_REGISTRY_KEYS[key].length).toBeGreaterThan(0);
    }
  });

  it('uses unique string values per registry slot (no collisions)', () => {
    const values = Object.values(BOOT_REGISTRY_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('texture keys are namespaced under tex.boot.* to avoid asset-pack collisions', () => {
    expect(BOOT_REGISTRY_KEYS.whitePixelKey.startsWith('tex.boot.')).toBe(true);
    expect(BOOT_REGISTRY_KEYS.loaderDotKey.startsWith('tex.boot.')).toBe(true);
  });
});
