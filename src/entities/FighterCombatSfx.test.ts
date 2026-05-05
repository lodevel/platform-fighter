import { describe, it, expect } from 'vitest';
import { Fighter, type FighterOptions } from './Fighter';
import { ASSET_KEYS } from '../assets/manifest';
import type { CombatSfxSink } from '../audio/combatAudio';

/**
 * Fighter × combat-audio integration tests — AC 10302 Sub-AC 2.
 *
 * The Fighter layer owns two distinct audio responsibilities:
 *
 *   1. **Forwarding the sink to the wrapped Character.** Attack /
 *      shield / dodge SFX fire from inside the per-frame physics tick
 *      (Character's job); Fighter's constructor / `setSfxSink` simply
 *      need to make sure the Character receives the same single sink
 *      instance it does — otherwise audio events would split across
 *      two backends.
 *
 *   2. **Voicing the per-stock KO event.** {@link Fighter.loseStock}
 *      is the single entry point both blast-zone watchers (collision
 *      and position) flow through; the canonical "ka-ching" must fire
 *      there, exactly once per real stock loss, never on a
 *      fighter-already-eliminated no-op.
 *
 * Mock-scene + recorder-sink pattern mirrors the Character integration
 * suite so the wiring story is identical at both layers.
 */

// ---------------------------------------------------------------------------
// Mock scene (mirrors Fighter.test.ts)
// ---------------------------------------------------------------------------

interface MockBody {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  label: string | undefined;
  options: Record<string, unknown>;
  removed: boolean;
}

interface CollisionListener {
  event: 'collisionstart' | 'collisionend';
  fn: (e: { pairs: unknown[] }) => void;
}

interface MockScene {
  bodies: MockBody[];
  removed: MockBody[];
  listeners: CollisionListener[];
  scene: any;
}

function createMockScene(): MockScene {
  const bodies: MockBody[] = [];
  const removed: MockBody[] = [];
  const listeners: CollisionListener[] = [];

  const matter = {
    add: {
      rectangle(
        x: number,
        y: number,
        w: number,
        h: number,
        options: Record<string, unknown>,
      ): MockBody {
        const body: MockBody = {
          position: { x, y },
          velocity: { x: 0, y: 0 },
          label: options['label'] as string | undefined,
          options: { ...options, _w: w, _h: h },
          removed: false,
        };
        bodies.push(body);
        return body;
      },
    },
    body: {
      setVelocity(body: MockBody, vec: { x: number; y: number }): void {
        body.velocity = { x: vec.x, y: vec.y };
      },
      setPosition(body: MockBody, vec: { x: number; y: number }): void {
        body.position = { x: vec.x, y: vec.y };
      },
      setInertia(_body: MockBody, _inertia: number): void {
        // No-op
      },
    },
    world: {
      on(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        listeners.push({ event, fn });
      },
      off(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        const idx = listeners.findIndex((l) => l.event === event && l.fn === fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      remove(body: MockBody): void {
        body.removed = true;
        removed.push(body);
      },
    },
  };

  return {
    bodies,
    removed,
    listeners,
    scene: { matter },
  };
}

class RecorderSink implements CombatSfxSink {
  readonly calls: string[] = [];
  playSfx(key: string): unknown {
    this.calls.push(key);
    return undefined;
  }
}

function baseOptions(overrides: Partial<FighterOptions> = {}): FighterOptions {
  return {
    playerIndex: 1,
    characterId: 'wolf',
    paletteIndex: 0,
    spawnX: 100,
    spawnY: 200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// KO SFX firing
// ---------------------------------------------------------------------------

describe('Fighter — KO SFX firing (AC 10302 Sub-AC 2)', () => {
  it('fires sfx.ko on every real stock loss', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const f = new Fighter(
      m.scene,
      baseOptions({ stockCount: 3, sfxSink: sink }),
    );

    // First two stocks lost — non-final KOs each fire the cue.
    expect(f.loseStock()).toBe(false);
    expect(sink.calls).toEqual([ASSET_KEYS.sfxKo]);
    expect(f.loseStock()).toBe(false);
    expect(sink.calls).toEqual([ASSET_KEYS.sfxKo, ASSET_KEYS.sfxKo]);

    // Final stock — the cue fires here too. The Smash-style "ka-
    // ching" is the universal "someone got KO'd" feedback regardless
    // of whether it depletes the final stock.
    expect(f.loseStock()).toBe(true);
    expect(sink.calls).toEqual([
      ASSET_KEYS.sfxKo,
      ASSET_KEYS.sfxKo,
      ASSET_KEYS.sfxKo,
    ]);
  });

  it('does NOT fire on a no-op loseStock against an already-eliminated fighter', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const f = new Fighter(
      m.scene,
      baseOptions({ stockCount: 1, sfxSink: sink }),
    );
    // Single stock — first loseStock call eliminates and fires the cue.
    f.loseStock();
    expect(sink.calls).toEqual([ASSET_KEYS.sfxKo]);
    // Subsequent calls (e.g. duplicate blast-zone collision events on a
    // body lingering past the boundary) MUST NOT re-voice the KO — the
    // entity layer's idempotency guard is what protects the audio
    // from spamming on a corpse-lingering body.
    f.loseStock();
    f.loseStock();
    expect(sink.calls).toEqual([ASSET_KEYS.sfxKo]);
  });

  it('does not fire any cue when the sink is not wired', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: 2 }));
    // No throw, no crash — silent operation when no sink is configured.
    expect(() => {
      f.loseStock();
      f.loseStock();
    }).not.toThrow();
  });

  it('survives a sink that throws — loseStock still drains the counter', () => {
    const m = createMockScene();
    const throwingSink: CombatSfxSink = {
      playSfx() {
        throw new Error('audio backend exploded');
      },
    };
    const f = new Fighter(
      m.scene,
      baseOptions({ stockCount: 2, sfxSink: throwingSink }),
    );
    expect(() => f.loseStock()).not.toThrow();
    expect(f.getStocks()).toBe(1);
    expect(() => f.loseStock()).not.toThrow();
    expect(f.isEliminated()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sink forwarding to wrapped Character
// ---------------------------------------------------------------------------

describe('Fighter — sink forwarding to Character (AC 10302 Sub-AC 2)', () => {
  it('forwards the constructor sink onto the wrapped Character', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const f = new Fighter(m.scene, baseOptions({ sfxSink: sink }));
    // Both layers should report the same instance.
    expect(f.getSfxSink()).toBe(sink);
    expect(f.getCharacter().getSfxSink()).toBe(sink);
  });

  it('setSfxSink updates BOTH the Fighter and the wrapped Character', () => {
    const m = createMockScene();
    const sinkA = new RecorderSink();
    const sinkB = new RecorderSink();
    const f = new Fighter(m.scene, baseOptions({ sfxSink: sinkA }));
    f.setSfxSink(sinkB);
    expect(f.getSfxSink()).toBe(sinkB);
    expect(f.getCharacter().getSfxSink()).toBe(sinkB);
  });

  it('passing null detaches both layers', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const f = new Fighter(m.scene, baseOptions({ sfxSink: sink }));
    f.setSfxSink(null);
    expect(f.getSfxSink()).toBe(null);
    expect(f.getCharacter().getSfxSink()).toBe(null);
    // KO event must now be silent.
    f.loseStock();
    expect(sink.calls).toEqual([]);
  });

  it('omitting the sink at construction leaves both layers detached', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.getSfxSink()).toBe(null);
    expect(f.getCharacter().getSfxSink()).toBe(null);
  });
});
