import { describe, it, expect } from 'vitest';
import {
  Fighter,
  DEFAULT_FIGHTER_STOCK_COUNT,
  MAX_PALETTE_INDEX,
  defaultCharacterFactory,
  type FighterOptions,
} from './Fighter';
import { CHARACTER_LABEL } from '../characters/Character';
import { Wolf, WOLF_TUNING } from '../characters/Wolf';
import { Cat, CAT_TUNING } from '../characters/Cat';
import { Owl, OWL_TUNING } from '../characters/Owl';
import { Bear, BEAR_TUNING } from '../characters/Bear';
import type { HitInfo } from '../characters/combat';
import {
  CAT_SPEC,
  WOLF_SPEC,
  WOLF_PLACEHOLDER,
  CAT_PLACEHOLDER,
  WOLF_MOVES,
  CAT_MOVES,
} from '../characters/roster';
import { PLATFORM_LABELS } from '../stages/StageRenderer';

/**
 * Sub-AC 3.1 of AC 201: the `Fighter` entity wraps a `Character` with
 * per-player slot identity (playerIndex, characterId, paletteIndex)
 * plus stocks tracking and a knockback application path. The class is
 * Phaser-touching only at construction (it builds a Character via the
 * factory); every subsequent method either delegates to the Character
 * or mutates entity-local state. We exercise it with the same mock
 * scene used by `Character.test.ts` — no jsdom required.
 *
 * What this suite locks down:
 *
 *   1. Slot identity — playerIndex, characterId, paletteIndex are
 *      stored exactly as supplied; out-of-range values throw at
 *      construction.
 *   2. Body construction — the right Character subclass is built for
 *      each characterId (Wolf for 'wolf', Cat for 'cat', baseline
 *      Character placeholders for 'owl' / 'bear' until M2).
 *   3. Damage / health — getDamagePercent, setDamagePercent,
 *      addDamage all delegate correctly and clamp at the engine's
 *      limits.
 *   4. Knockback — applyHit returns the realised KnockbackResult and
 *      mutates the underlying body's velocity through the Character.
 *   5. Stocks — loseStock decrements correctly, reports elimination,
 *      is idempotent when already at 0, and resetStocks restores.
 *   6. KO bookkeeping — recordKo increments, resetKos clears.
 *   7. Respawn — respawnAt teleports, zeroes damage, grants
 *      invincibility.
 *   8. Lifecycle — destroy() tears down the Character once and is
 *      idempotent; methods are no-ops afterwards.
 */

// ---------------------------------------------------------------------------
// Mock scene helpers — mirrors `Character.test.ts`
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
        // no-op for these tests
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

/** Required base options for a fighter. Override per test. */
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
// Slot identity
// ---------------------------------------------------------------------------

describe('Fighter — slot identity', () => {
  it('stores playerIndex, characterId, paletteIndex, initialStocks', () => {
    const m = createMockScene();
    const f = new Fighter(
      m.scene,
      baseOptions({ playerIndex: 2, characterId: 'cat', paletteIndex: 5, stockCount: 4 }),
    );
    expect(f.playerIndex).toBe(2);
    expect(f.characterId).toBe('cat');
    expect(f.paletteIndex).toBe(5);
    expect(f.initialStocks).toBe(4);
    expect(f.getStocks()).toBe(4);
  });

  it('defaults stockCount to DEFAULT_FIGHTER_STOCK_COUNT (3)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.initialStocks).toBe(DEFAULT_FIGHTER_STOCK_COUNT);
    expect(f.getStocks()).toBe(3);
  });

  it('accepts Infinity stockCount (training-mode dummy)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: Infinity }));
    expect(f.getStocks()).toBe(Infinity);
    expect(f.isEliminated()).toBe(false);
  });

  it('throws on out-of-range playerIndex', () => {
    const m = createMockScene();
    expect(
      () => new Fighter(m.scene, baseOptions({ playerIndex: 0 as 1 })),
    ).toThrow(/playerIndex/);
    expect(
      () => new Fighter(m.scene, baseOptions({ playerIndex: 5 as 1 })),
    ).toThrow(/playerIndex/);
  });

  it('throws on out-of-range paletteIndex', () => {
    const m = createMockScene();
    expect(() => new Fighter(m.scene, baseOptions({ paletteIndex: -1 }))).toThrow(
      /paletteIndex/,
    );
    expect(
      () => new Fighter(m.scene, baseOptions({ paletteIndex: MAX_PALETTE_INDEX + 1 })),
    ).toThrow(/paletteIndex/);
    expect(() => new Fighter(m.scene, baseOptions({ paletteIndex: 1.5 }))).toThrow(
      /paletteIndex/,
    );
  });

  it('throws on non-positive stockCount (excluding Infinity)', () => {
    const m = createMockScene();
    expect(() => new Fighter(m.scene, baseOptions({ stockCount: 0 }))).toThrow(
      /stockCount/,
    );
    expect(() => new Fighter(m.scene, baseOptions({ stockCount: -1 }))).toThrow(
      /stockCount/,
    );
  });
});

// ---------------------------------------------------------------------------
// Body construction & character factory
// ---------------------------------------------------------------------------

describe('Fighter — body construction', () => {
  it("creates exactly one Matter body labelled CHARACTER_LABEL", () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(m.bodies.length).toBe(1);
    expect(m.bodies[0]!.label).toBe(CHARACTER_LABEL);
    expect(f.body).toBe(m.bodies[0]!);
  });

  it("uses Wolf subclass for characterId 'wolf'", () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    expect(f.getCharacter()).toBeInstanceOf(Wolf);
    // Wolf-specific tuning is stamped onto the body via the rectangle's
    // dimensions (width / height come from WOLF_TUNING).
    expect(m.bodies[0]!.options['_w']).toBe(WOLF_TUNING.width);
    expect(m.bodies[0]!.options['_h']).toBe(WOLF_TUNING.height);
  });

  it("uses Cat subclass for characterId 'cat'", () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'cat' }));
    expect(f.getCharacter()).toBeInstanceOf(Cat);
    expect(m.bodies[0]!.options['_w']).toBe(CAT_TUNING.width);
    expect(m.bodies[0]!.options['_h']).toBe(CAT_TUNING.height);
  });

  it("uses Owl subclass for characterId 'owl'", () => {
    // AC 60004 Sub-AC 4 promoted Owl from placeholder to a fully-wired
    // mage subclass. The factory builds Owl with the mage tuning so the
    // body geometry on the Matter rectangle matches OWL_TUNING.
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'owl' }));
    expect(f.getCharacter()).toBeInstanceOf(Owl);
    expect(m.bodies[0]!.options['_w']).toBe(OWL_TUNING.width);
    expect(m.bodies[0]!.options['_h']).toBe(OWL_TUNING.height);
  });

  it("uses Bear subclass for characterId 'bear'", () => {
    // AC 60001 Sub-AC 1 promoted Bear from placeholder to a fully-wired
    // grappler subclass alongside the rest of the M2 grounded triplet
    // expansion. The factory builds Bear with the grappler tuning so
    // the body geometry on the Matter rectangle matches BEAR_TUNING.
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'bear' }));
    expect(f.getCharacter()).toBeInstanceOf(Bear);
    expect(m.bodies[0]!.options['_w']).toBe(BEAR_TUNING.width);
    expect(m.bodies[0]!.options['_h']).toBe(BEAR_TUNING.height);
  });

  it('honours a custom characterFactory override (test injection)', () => {
    const m = createMockScene();
    const built: { id: string; x: number; y: number }[] = [];
    const f = new Fighter(
      m.scene,
      baseOptions({
        characterId: 'wolf',
        spawnX: 42,
        spawnY: 99,
        characterFactory: (scene, id, x, y) => {
          built.push({ id, x, y });
          // Use the default factory under the hood to keep the test
          // honest — we just want to observe the wiring.
          return defaultCharacterFactory(scene, id, x, y);
        },
      }),
    );
    expect(built).toEqual([{ id: 'wolf', x: 42, y: 99 }]);
    expect(f.getCharacter()).toBeInstanceOf(Wolf);
  });

  it('exposes the body and getCharacter() consistently', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.body).toBe(f.getCharacter().body);
  });
});

// ---------------------------------------------------------------------------
// Damage state
// ---------------------------------------------------------------------------

describe('Fighter — damage state', () => {
  it('starts at 0 % damage', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.getDamagePercent()).toBe(0);
  });

  it('addDamage accumulates and returns the new value', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.addDamage(10)).toBe(10);
    expect(f.addDamage(15)).toBe(25);
    expect(f.getDamagePercent()).toBe(25);
  });

  it('setDamagePercent replaces the current value', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.addDamage(20);
    f.setDamagePercent(0);
    expect(f.getDamagePercent()).toBe(0);
    f.setDamagePercent(75);
    expect(f.getDamagePercent()).toBe(75);
  });

  it('addDamage with negative delta floors at 0', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.setDamagePercent(10);
    expect(f.addDamage(-50)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Knockback application
// ---------------------------------------------------------------------------

describe('Fighter — knockback / applyHit', () => {
  const HIT: HitInfo = {
    damage: 8,
    knockback: { x: 4, y: -2, scaling: 0.1 },
    facing: 1,
  };

  it('returns a non-zero knockback vector and accumulates damage', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const before = f.getDamagePercent();
    const result = f.applyHit(HIT);
    expect(f.getDamagePercent()).toBe(before + HIT.damage);
    // Knockback should send the target outward (positive x for facing=1).
    expect(result.vector.x).toBeGreaterThan(0);
    expect(result.vector.y).toBeLessThan(0); // upward
    expect(result.magnitude).toBeGreaterThan(0);
    expect(result.hitstunFrames).toBeGreaterThan(0);
  });

  it('mutates the underlying body velocity through the Character (after hitlag drains)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.applyHit(HIT);
    // Post-M2 hit-feel pass: hitlag freeze pins velocity at zero
    // until the freeze drains, then the queued knockback fires.
    while (f.getCharacter().getHitlagRemaining() > 0) {
      f.applyInput({ moveX: 0, jump: false });
    }
    expect(f.body.velocity.x).not.toBe(0);
    expect(f.body.velocity.y).not.toBe(0);
  });

  it('lighter characters take more knockback (Cat vs Wolf)', () => {
    const wolfScene = createMockScene();
    const wolf = new Fighter(
      wolfScene.scene,
      baseOptions({ characterId: 'wolf', playerIndex: 1 }),
    );
    const catScene = createMockScene();
    const cat = new Fighter(
      catScene.scene,
      baseOptions({ characterId: 'cat', playerIndex: 2 }),
    );
    const wolfKb = wolf.applyHit(HIT);
    const catKb = cat.applyHit(HIT);
    // Cat is lighter (mass 8) than Wolf (mass 16) — same hit sends Cat
    // farther.
    expect(catKb.magnitude).toBeGreaterThan(wolfKb.magnitude);
  });

  it('returns a zero result for a destroyed fighter', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.destroy();
    const result = f.applyHit(HIT);
    expect(result.vector).toEqual({ x: 0, y: 0 });
    expect(result.magnitude).toBe(0);
    expect(result.hitstunFrames).toBe(0);
  });

  it('respects respawn invincibility — no damage, no knockback', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.getCharacter().setInvincibility(60);
    const result = f.applyHit(HIT);
    expect(result.magnitude).toBe(0);
    expect(f.getDamagePercent()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC 8 — "Hitstun locks hit player in hurt state briefly"
// ---------------------------------------------------------------------------
//
// The mechanism (frame counter + applyInput lockout) lives on Character
// and is covered by `Character.test.ts`. This block exercises the
// *entity-layer* surface — the methods gameplay code, AI, and the HUD
// actually call — to prove the AC contract end-to-end through the
// Fighter facade:
//
//   1. A landed hit drops the fighter into the hurt state immediately.
//   2. While hurt, `applyInput` is locked out — no walk, jump, or
//      attack press takes effect.
//   3. The hurt state has a finite, brief duration (clamped at
//      MAX_HITSTUN_FRAMES = 120 frames ≈ 2 s at 60 Hz).
//   4. Per-step decrement: `getHitstunRemaining()` drops by exactly 1
//      every applyInput call.
//   5. Once the timer hits 0, the fighter is back in neutral and input
//      drives velocity again.
//   6. The state snapshot's `inHitstun` field tracks the runtime state
//      so the hurt-state classifier reads correctly.

describe('Fighter — AC 8 hitstun lockout (hurt state)', () => {
  // A hit strong enough that hitstun > MIN_HITSTUN_FRAMES so the timer
  // tests have enough frames to observe the decrement clearly.
  const HIT: HitInfo = {
    damage: 8,
    knockback: { x: 4, y: -2, scaling: 0.1 },
    facing: 1,
  };

  it('a landed hit drops the fighter into hurt state once hitlag drains', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    expect(f.isInHitstun()).toBe(false);
    expect(f.getHitstunRemaining()).toBe(0);
    const r = f.applyHit(HIT);
    // Post-M2 hit-feel pass: hitstun is queued behind the hitlag freeze.
    tickPastHitlagFighter(f);
    expect(f.isInHitstun()).toBe(true);
    expect(f.getHitstunRemaining()).toBe(r.hitstunFrames);
    // Snapshot mirrors the runtime state so HUD / classifier reads true.
    expect(f.getState().inHitstun).toBe(true);
  });

  it('the hurt state lockout is brief — bounded by MAX_HITSTUN_FRAMES (120 ≈ 2 s)', () => {
    // Even a 999% target taking the strongest possible hit must not be
    // locked into hurt state for more than the documented upper bound,
    // so the player never feels frozen for an unfair stretch.
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'cat' }));
    f.setDamagePercent(999);
    const massive: HitInfo = {
      damage: 30,
      knockback: { x: 12, y: -10, scaling: 0.5 },
      facing: 1,
    };
    const r = f.applyHit(massive);
    // 120 frames at 60 Hz = 2 s — the AC's "briefly" upper bound.
    expect(r.hitstunFrames).toBeLessThanOrEqual(120);
    expect(f.getHitstunRemaining()).toBeLessThanOrEqual(120);
  });

  it('horizontal stick input is suppressed while in hurt state', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyHit(HIT);
    const vxPostHit = f.body.velocity.x;
    // Player tries to push left mid-hurt — the lockout must prevent the
    // controller from accelerating; knockback velocity is preserved.
    f.applyInput({ moveX: -1, jump: false });
    expect(f.body.velocity.x).toBeCloseTo(vxPostHit);
  });

  it('jump input is suppressed while in hurt state', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyHit(HIT);
    const jumpsBefore = f.getJumpsUsed();
    f.applyInput({ moveX: 0, jump: true });
    // No new jump consumed — the rising-edge press never landed.
    expect(f.getJumpsUsed()).toBe(jumpsBefore);
  });

  it('attack input is suppressed while in hurt state', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyHit(HIT);
    f.applyInput({ moveX: 0, jump: false, attack: true });
    // Wolf's jab can't trigger because we're hurt.
    expect(f.isAttacking()).toBe(false);
  });

  it('hitstun decrements by exactly 1 per applyInput call (post-hitlag)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const r = f.applyHit(HIT);
    tickPastHitlagFighter(f);
    const start = r.hitstunFrames;
    expect(f.getHitstunRemaining()).toBe(start);
    f.applyInput({ moveX: 0, jump: false });
    expect(f.getHitstunRemaining()).toBe(start - 1);
    f.applyInput({ moveX: 0, jump: false });
    expect(f.getHitstunRemaining()).toBe(start - 2);
  });

  it('exits hurt state after exactly hitstunFrames frames pass (post-hitlag)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    const r = f.applyHit(HIT);
    tickPastHitlagFighter(f);
    // Drain the entire hurt window with neutral inputs.
    for (let i = 0; i < r.hitstunFrames; i += 1) {
      f.applyInput({ moveX: 0, jump: false });
    }
    expect(f.isInHitstun()).toBe(false);
    expect(f.getHitstunRemaining()).toBe(0);
    expect(f.getState().inHitstun).toBe(false);
  });

  it('regains player control once the hurt state ends', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    const r = f.applyHit(HIT);
    tickPastHitlagFighter(f);
    // Drain hitstun.
    for (let i = 0; i < r.hitstunFrames; i += 1) {
      f.applyInput({ moveX: 0, jump: false });
    }
    // Now movement input must take effect again (facing + velocity push).
    f.applyInput({ moveX: 1, jump: false });
    expect(f.getFacing()).toBe(1);
    f.applyInput({ moveX: -1, jump: false });
    expect(f.getFacing()).toBe(-1);
  });

  it('a respawn (setPosition) clears the hurt state — fighter is free immediately', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    f.applyHit(HIT);
    tickPastHitlagFighter(f);
    expect(f.isInHitstun()).toBe(true);
    // Respawning the fighter has to drop them back into a neutral state
    // — they shouldn't re-enter the stage already locked out.
    f.respawnAt(500, 250, 0);
    expect(f.isInHitstun()).toBe(false);
    expect(f.getHitstunRemaining()).toBe(0);
  });

  it('determinism — two identical hits on identical fresh fighters produce identical hitstun', () => {
    // Replay byte-equivalence: the AC 8 timer must be a pure function of
    // (damage %, mass, hit). No wall-clock, no random seed.
    const buildAndHit = () => {
      const m = createMockScene();
      const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
      const r = f.applyHit(HIT);
      return { stun: f.getHitstunRemaining(), frames: r.hitstunFrames };
    };
    const a = buildAndHit();
    const b = buildAndHit();
    expect(a.stun).toBe(b.stun);
    expect(a.frames).toBe(b.frames);
  });
});

// ---------------------------------------------------------------------------
// Stocks
// ---------------------------------------------------------------------------

describe('Fighter — stocks', () => {
  it('loseStock decrements and returns false until elimination', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: 3 }));
    expect(f.loseStock()).toBe(false);
    expect(f.getStocks()).toBe(2);
    expect(f.loseStock()).toBe(false);
    expect(f.getStocks()).toBe(1);
    expect(f.loseStock()).toBe(true); // elimination
    expect(f.getStocks()).toBe(0);
    expect(f.isEliminated()).toBe(true);
  });

  it('loseStock is idempotent when already eliminated', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: 1 }));
    expect(f.loseStock()).toBe(true);
    // Subsequent calls do not push stocks negative.
    expect(f.loseStock()).toBe(true);
    expect(f.loseStock()).toBe(true);
    expect(f.getStocks()).toBe(0);
    // stocksLost only counts the *real* loss, not duplicated calls.
    expect(f.getStocksLost()).toBe(1);
  });

  it('tracks cumulative stocksLost separately from stocks remaining', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: 3 }));
    f.loseStock();
    f.loseStock();
    expect(f.getStocks()).toBe(1);
    expect(f.getStocksLost()).toBe(2);
  });

  it('resetStocks restores the initial count and clears stocksLost', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: 3 }));
    f.loseStock();
    f.loseStock();
    f.resetStocks();
    expect(f.getStocks()).toBe(3);
    expect(f.getStocksLost()).toBe(0);
    expect(f.isEliminated()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KO bookkeeping
// ---------------------------------------------------------------------------

describe('Fighter — KO bookkeeping', () => {
  it('starts at 0 KOs', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.getKos()).toBe(0);
  });

  it('recordKo increments; resetKos clears', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.recordKo();
    f.recordKo();
    f.recordKo();
    expect(f.getKos()).toBe(3);
    f.resetKos();
    expect(f.getKos()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Respawn
// ---------------------------------------------------------------------------

describe('Fighter — respawn', () => {
  it('respawnAt teleports, zeroes damage, and grants invincibility', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ spawnX: 0, spawnY: 0 }));
    f.addDamage(50);
    f.respawnAt(500, 300, 90);
    expect(f.getPosition()).toEqual({ x: 500, y: 300 });
    expect(f.getDamagePercent()).toBe(0);
    expect(f.isInvincible()).toBe(true);
    expect(f.getCharacter().getInvincibilityRemaining()).toBe(90);
  });

  it('respawnAt with 0 invincibility opts out of grace', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.respawnAt(100, 100, 0);
    expect(f.isInvincible()).toBe(false);
  });

  it('respawnAt is a no-op for a destroyed fighter', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ spawnX: 10, spawnY: 20 }));
    const startPos = f.getPosition();
    f.destroy();
    f.respawnAt(999, 999, 90);
    // Position should not have been mutated post-destroy.
    expect(f.getPosition()).toEqual(startPos);
  });
});

// ---------------------------------------------------------------------------
// Per-frame input delegation
// ---------------------------------------------------------------------------

describe('Fighter — applyInput delegation', () => {
  it('drives horizontal velocity through the underlying Character', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    // One step of full-right input — body should accelerate from 0.
    f.applyInput({ moveX: 1, jump: false });
    expect(f.body.velocity.x).toBeGreaterThan(0);
    expect(f.getFacing()).toBe(1);
  });

  it('is a no-op after destroy()', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    f.destroy();
    // Should not throw and should not mutate the (already-removed) body.
    expect(() => f.applyInput({ moveX: 1, jump: false })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3.2 — movement / jump mechanics with ground detection
// ---------------------------------------------------------------------------
//
// The underlying Character class owns the physics math; these tests
// lock down that the *Fighter entity surface* (the per-player wrapper
// that AI / scenes / replay all iterate through) routes movement,
// jumping, double-jumping, falling, and ground-contact reads correctly.
// They mirror the Character-level coverage but go through the Fighter
// API exclusively — no direct `getCharacter()` reaches except where we
// must inject collision events the way StageRenderer would in production.

/**
 * Drop a fake platform under the fighter so subsequent applyInput calls
 * see grounded=true. Mirrors the helper in Character.test.ts but goes
 * through the Fighter's body accessor.
 */
function groundFighter(f: Fighter, m: MockScene): void {
  const pos = f.getPosition();
  const platform = {
    label: PLATFORM_LABELS.solid,
    position: { x: pos.x, y: pos.y + 100 },
  };
  for (const l of m.listeners.slice()) {
    if (l.event === 'collisionstart') {
      l.fn({ pairs: [{ bodyA: f.body, bodyB: platform }] });
    }
  }
}

/**
 * Drive `applyInput` until the fighter's hitlag freeze drains. Tests
 * exercising post-hitlag behaviour (knockback velocity, hitstun
 * arming) call this after `applyHit` to advance past the freeze the
 * post-M2 hit-feel pass introduced.
 */
function tickPastHitlagFighter(f: Fighter, maxFrames = 32): void {
  for (
    let i = 0;
    i < maxFrames && f.getCharacter().getHitlagRemaining() > 0;
    i += 1
  ) {
    f.applyInput({ moveX: 0, jump: false });
  }
}

/** Lift the fighter off any current ground contact (simulate walk-off / takeoff). */
function unground(f: Fighter, m: MockScene): void {
  const pos = f.getPosition();
  const platform = {
    label: PLATFORM_LABELS.solid,
    position: { x: pos.x, y: pos.y + 100 },
  };
  for (const l of m.listeners.slice()) {
    if (l.event === 'collisionend') {
      l.fn({ pairs: [{ bodyA: f.body, bodyB: platform }] });
    }
  }
}

describe('Fighter — movement (Sub-AC 3.2)', () => {
  it('walks rightward when moveX = 1 (positive horizontal velocity)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyInput({ moveX: 1, jump: false });
    expect(f.getVelocity().x).toBeGreaterThan(0);
    expect(f.getFacing()).toBe(1);
  });

  it('walks leftward when moveX = -1 (negative horizontal velocity)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyInput({ moveX: -1, jump: false });
    expect(f.getVelocity().x).toBeLessThan(0);
    expect(f.getFacing()).toBe(-1);
  });

  it('runs to the character-tuned top speed under sustained input', () => {
    // "Run" in this game is "hold the stick — there's no separate run
    // button". Verify we converge to maxRunSpeed within a finite number
    // of fixed steps. Wolf is the bruiser tuning so we read its top
    // speed from the published tuning constant.
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    for (let i = 0; i < 60; i += 1) {
      f.applyInput({ moveX: 1, jump: false });
    }
    expect(f.getVelocity().x).toBeCloseTo(WOLF_TUNING.maxRunSpeed!);
  });

  it('decelerates to a stop when the stick is released on the ground', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    // Get up to speed first.
    for (let i = 0; i < 60; i += 1) f.applyInput({ moveX: 1, jump: false });
    // Now release.
    for (let i = 0; i < 60; i += 1) f.applyInput({ moveX: 0, jump: false });
    expect(f.getVelocity().x).toBe(0);
  });

  it('accelerates more slowly in the air than on the ground', () => {
    // Two fresh fighters: one grounded, one airborne. Same one-frame
    // right input. Ground delta should exceed air delta because air
    // accel is tuned lower.
    const groundScene = createMockScene();
    const groundF = new Fighter(groundScene.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(groundF, groundScene);
    groundF.applyInput({ moveX: 1, jump: false });
    const groundDelta = groundF.getVelocity().x;

    const airScene = createMockScene();
    const airF = new Fighter(airScene.scene, baseOptions({ characterId: 'wolf' }));
    // No ground event → airborne from spawn.
    airF.applyInput({ moveX: 1, jump: false });
    const airDelta = airF.getVelocity().x;

    expect(airDelta).toBeGreaterThan(0);
    expect(airDelta).toBeLessThan(groundDelta);
  });

  it('mid-air horizontal control still works (drift while falling)', () => {
    // The "fall" leg of the mechanic — even with no jump pressed, an
    // airborne fighter should respond to stick deflection. (Gravity is
    // Matter's job; the entity contract is that input still routes.)
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    // Spawn airborne — never trigger a ground event.
    expect(f.isGrounded()).toBe(false);
    f.applyInput({ moveX: 1, jump: false });
    expect(f.getVelocity().x).toBeGreaterThan(0);
    f.applyInput({ moveX: -1, jump: false });
    // Velocity may not flip sign in one frame because air accel is
    // small, but it must move toward leftward (delta < previous).
    expect(f.getFacing()).toBe(-1);
  });
});

describe('Fighter — jumping (Sub-AC 3.2)', () => {
  it('applies an upward impulse on the rising edge of jump while grounded', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    expect(f.getJumpsUsed()).toBe(0);
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getVelocity().y).toBeLessThan(0); // upward in screen-space
    expect(f.getJumpsUsed()).toBe(1);
  });

  it('does not double-fire when jump is held across frames', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsUsed()).toBe(1);
    // Held — must NOT consume another jump.
    f.applyInput({ moveX: 0, jump: true });
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsUsed()).toBe(1);
  });

  it('grants a second jump (double-jump) after release-then-press in the air', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    // First jump kicks off the ground.
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsUsed()).toBe(1);
    expect(f.getJumpsRemaining()).toBe(1); // Wolf maxJumps=2 → 1 left
    // Leave the platform behind us.
    unground(f, m);
    // Release the button so the next press is a real rising edge.
    f.applyInput({ moveX: 0, jump: false });
    // Air-jump press.
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsUsed()).toBe(2);
    expect(f.getJumpsRemaining()).toBe(0);
  });

  it('refuses a third jump when the budget is spent', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    // Burn the ground jump.
    f.applyInput({ moveX: 0, jump: true });
    unground(f, m);
    // Burn the air jump.
    f.applyInput({ moveX: 0, jump: false });
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsRemaining()).toBe(0);
    // Third attempt — denied: vy must not refresh upward.
    f.applyInput({ moveX: 0, jump: false });
    const vyBefore = f.getVelocity().y;
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsUsed()).toBe(2);
    expect(f.getVelocity().y).toBe(vyBefore);
  });

  it('refreshes the jump budget on landing', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    // Take off and consume both jumps.
    f.applyInput({ moveX: 0, jump: true });
    unground(f, m);
    f.applyInput({ moveX: 0, jump: false });
    f.applyInput({ moveX: 0, jump: true });
    expect(f.getJumpsUsed()).toBe(2);
    // Land again — simulate gravity-induced fall + ground contact.
    m.scene.matter.body.setVelocity(f.body, { x: 0, y: 1 });
    groundFighter(f, m);
    // First grounded frame with non-rising vy resets the budget.
    f.applyInput({ moveX: 0, jump: false });
    expect(f.getJumpsUsed()).toBe(0);
    expect(f.getJumpsRemaining()).toBe(2);
  });

  it('honours per-character maxJumps (Cat configures the ninja air budget)', () => {
    // Cat is the ninja class — read its tuning to confirm the entity
    // wraps the right physics. We're not asserting Cat==3 here (in case
    // the M2 tuning shifts); we're asserting that whatever the Cat
    // tuning says, the Fighter exposes that exact budget.
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'cat' }));
    expect(f.getJumpsRemaining()).toBe(CAT_TUNING.maxJumps!);
  });
});

describe('Fighter — ground detection (Sub-AC 3.2)', () => {
  it('starts ungrounded before any platform collision fires', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    expect(f.isGrounded()).toBe(false);
  });

  it('becomes grounded when a platform below the centre starts colliding', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    expect(f.isGrounded()).toBe(false);
    groundFighter(f, m);
    expect(f.isGrounded()).toBe(true);
  });

  it('drops back to ungrounded the moment support contact ends (walk-off)', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    expect(f.isGrounded()).toBe(true);
    unground(f, m);
    expect(f.isGrounded()).toBe(false);
  });

  it('ignores ceiling thumps and side-wall bumps for ground state', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf', spawnX: 0, spawnY: 100 }));
    const ceiling = { label: PLATFORM_LABELS.solid, position: { x: 0, y: 50 } };
    const wall = { label: PLATFORM_LABELS.solid, position: { x: 80, y: 100 } };
    for (const l of m.listeners.slice()) {
      if (l.event === 'collisionstart') {
        l.fn({ pairs: [{ bodyA: f.body, bodyB: ceiling }] });
        l.fn({ pairs: [{ bodyA: f.body, bodyB: wall }] });
      }
    }
    expect(f.isGrounded()).toBe(false);
  });

  it('recognises pass-through platforms as support surfaces', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const passPlat = {
      label: PLATFORM_LABELS.passThrough,
      position: { x: f.getPosition().x, y: f.getPosition().y + 100 },
    };
    for (const l of m.listeners.slice()) {
      if (l.event === 'collisionstart') {
        l.fn({ pairs: [{ bodyA: f.body, bodyB: passPlat }] });
      }
    }
    expect(f.isGrounded()).toBe(true);
  });
});

describe('Fighter — getState surfaces movement state (Sub-AC 3.2)', () => {
  it('snapshot includes grounded + jumpsUsed + jumpsRemaining', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    // Fresh, airborne, full jump budget.
    let s = f.getState();
    expect(s.grounded).toBe(false);
    expect(s.jumpsUsed).toBe(0);
    expect(s.jumpsRemaining).toBe(WOLF_TUNING.maxJumps!);
    // Land + consume one jump.
    groundFighter(f, m);
    f.applyInput({ moveX: 0, jump: true });
    s = f.getState();
    // After takeoff the fighter is still in support contact for one
    // frame (we never end the contact); what matters here is jump
    // budget bookkeeping.
    expect(s.jumpsUsed).toBe(1);
    expect(s.jumpsRemaining).toBe(WOLF_TUNING.maxJumps! - 1);
  });

  it('snapshot facing reflects last horizontal input direction', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    groundFighter(f, m);
    f.applyInput({ moveX: -1, jump: false });
    expect(f.getState().facing).toBe(-1);
    f.applyInput({ moveX: 1, jump: false });
    expect(f.getState().facing).toBe(1);
  });

  it('determinism — identical input sequence yields identical movement state', () => {
    // Determinism is the explicit Seed constraint; the entity layer
    // must not introduce any non-determinism on top of the Character.
    const runOnce = () => {
      const m = createMockScene();
      const f = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
      groundFighter(f, m);
      // A fixed input script: walk right 5 frames, jump, drift 3 frames,
      // air-jump, drift 5 frames.
      for (let i = 0; i < 5; i += 1) f.applyInput({ moveX: 1, jump: false });
      f.applyInput({ moveX: 1, jump: true });
      unground(f, m);
      for (let i = 0; i < 3; i += 1) f.applyInput({ moveX: 1, jump: false });
      f.applyInput({ moveX: 1, jump: true });
      for (let i = 0; i < 5; i += 1) f.applyInput({ moveX: 1, jump: false });
      const s = f.getState();
      return {
        x: s.position.x,
        y: s.position.y,
        vx: s.velocity.x,
        vy: s.velocity.y,
        facing: s.facing,
        jumpsUsed: s.jumpsUsed,
        grounded: s.grounded,
      };
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

// ---------------------------------------------------------------------------
// State snapshot
// ---------------------------------------------------------------------------

describe('Fighter — getState snapshot', () => {
  it('returns slot identity + runtime state in one record', () => {
    const m = createMockScene();
    const f = new Fighter(
      m.scene,
      baseOptions({ playerIndex: 3, characterId: 'cat', paletteIndex: 4, stockCount: 2 }),
    );
    f.addDamage(20);
    f.recordKo();
    f.loseStock();
    const s = f.getState();
    expect(s.playerIndex).toBe(3);
    expect(s.characterId).toBe('cat');
    expect(s.paletteIndex).toBe(4);
    expect(s.stocks).toBe(1);
    expect(s.stocksLost).toBe(1);
    expect(s.kos).toBe(1);
    expect(s.damagePercent).toBe(20);
    expect(s.eliminated).toBe(false);
    expect(s.destroyed).toBe(false);
  });

  it('reports eliminated=true once stocks hit 0', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions({ stockCount: 1 }));
    f.loseStock();
    expect(f.getState().eliminated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3.5 — roster spec integration (stats / sprites / movesets)
// ---------------------------------------------------------------------------
//
// Verifies that each Fighter entity surfaces the full `CharacterSpec`
// for its character — stats, moves, sprite placeholder, display name —
// without the caller reaching into the roster module by hand. Two
// distinct fighters (Wolf bruiser, Cat ninja) are constructed and we
// assert that their entity-level accessors return the expected,
// distinct data.

describe('Fighter — character spec integration (Sub-AC 3.5 of AC 205)', () => {
  it('getSpec() returns the matching CharacterSpec for the slot', () => {
    const m = createMockScene();
    const wolf = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const m2 = createMockScene();
    const cat = new Fighter(m2.scene, baseOptions({ characterId: 'cat' }));
    expect(wolf.getSpec()).toBe(WOLF_SPEC);
    expect(cat.getSpec()).toBe(CAT_SPEC);
  });

  it('getDisplayName() reads the human-readable name through the spec', () => {
    const m = createMockScene();
    const wolf = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const m2 = createMockScene();
    const cat = new Fighter(m2.scene, baseOptions({ characterId: 'cat' }));
    expect(wolf.getDisplayName()).toBe('Wolf');
    expect(cat.getDisplayName()).toBe('Cat');
    // Different characters → different display names.
    expect(wolf.getDisplayName()).not.toBe(cat.getDisplayName());
  });

  it('getTuning() returns the live underlying tuning record', () => {
    const m = createMockScene();
    const wolf = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const t = wolf.getTuning();
    expect(t.maxRunSpeed).toBe(WOLF_TUNING.maxRunSpeed);
    expect(t.mass).toBe(WOLF_TUNING.mass);
    expect(t.width).toBe(WOLF_TUNING.width);
    expect(t.height).toBe(WOLF_TUNING.height);
  });

  it('getMoves() returns the moveset wired into the live Character', () => {
    const m = createMockScene();
    const wolf = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const moves = wolf.getMoves();
    // Same array reference as the roster — single source of truth.
    expect(moves).toBe(WOLF_MOVES);
    // And every move id is reachable through the wrapped Character.
    for (const move of moves) {
      expect(wolf.getAttack(move.id)).toBe(move);
    }
  });

  it("Cat's getMoves() returns Cat's moveset, not Wolf's", () => {
    const m = createMockScene();
    const cat = new Fighter(m.scene, baseOptions({ characterId: 'cat' }));
    expect(cat.getMoves()).toBe(CAT_MOVES);
    // Cat must not expose a Wolf move id.
    for (const wolfMove of WOLF_MOVES) {
      expect(cat.getAttack(wolfMove.id)).toBeUndefined();
    }
  });

  it('getPlaceholder() returns the sprite-placeholder visual descriptor', () => {
    const m = createMockScene();
    const wolf = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    const m2 = createMockScene();
    const cat = new Fighter(m2.scene, baseOptions({ characterId: 'cat' }));
    expect(wolf.getPlaceholder()).toBe(WOLF_PLACEHOLDER);
    expect(cat.getPlaceholder()).toBe(CAT_PLACEHOLDER);
    // Placeholder colours are distinct so the on-screen rectangles read
    // as belonging to different fighters at a glance.
    expect(wolf.getPlaceholder().primaryColor).not.toBe(
      cat.getPlaceholder().primaryColor,
    );
  });

  it('placeholder dimensions match the live Matter body footprint', () => {
    // Mirror tuning.width / tuning.height so the rendered rectangle
    // covers the same area the Matter body collides on.
    const m = createMockScene();
    const wolf = new Fighter(m.scene, baseOptions({ characterId: 'wolf' }));
    expect(wolf.getPlaceholder().width).toBe(wolf.getTuning().width);
    expect(wolf.getPlaceholder().height).toBe(wolf.getTuning().height);
    const m2 = createMockScene();
    const cat = new Fighter(m2.scene, baseOptions({ characterId: 'cat' }));
    expect(cat.getPlaceholder().width).toBe(cat.getTuning().width);
    expect(cat.getPlaceholder().height).toBe(cat.getTuning().height);
  });

  it('two distinct fighters produce two distinct integrated specs', () => {
    // The single sub-AC contract: instantiate two playable characters
    // through the Fighter entity and confirm every dimension of the
    // roster spec (stats, moves, placeholder) differs between them.
    const wolfScene = createMockScene();
    const wolf = new Fighter(wolfScene.scene, baseOptions({ characterId: 'wolf' }));
    const catScene = createMockScene();
    const cat = new Fighter(catScene.scene, baseOptions({ characterId: 'cat' }));

    // Stats differ.
    expect(wolf.getTuning().mass).not.toBe(cat.getTuning().mass);
    expect(wolf.getTuning().maxRunSpeed).not.toBe(cat.getTuning().maxRunSpeed);
    // Moves differ — no overlap of move ids.
    const wolfMoveIds = wolf.getMoves().map((m) => m.id);
    const catMoveIds = cat.getMoves().map((m) => m.id);
    expect(wolfMoveIds.some((id) => catMoveIds.includes(id))).toBe(false);
    // Placeholder visuals differ.
    expect(wolf.getPlaceholder().primaryColor).not.toBe(
      cat.getPlaceholder().primaryColor,
    );
    // Display names differ.
    expect(wolf.getDisplayName()).not.toBe(cat.getDisplayName());
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('Fighter — lifecycle', () => {
  it('destroy() removes the underlying body and is idempotent', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(f.isDestroyed()).toBe(false);
    f.destroy();
    expect(f.isDestroyed()).toBe(true);
    expect(m.bodies[0]!.removed).toBe(true);

    // Idempotent — second destroy() must not throw or attempt to
    // re-remove the body.
    f.destroy();
    expect(m.removed.length).toBe(1);
  });

  it('detaches collision listeners on destroy', () => {
    const m = createMockScene();
    const f = new Fighter(m.scene, baseOptions());
    expect(m.listeners.length).toBeGreaterThan(0);
    f.destroy();
    expect(m.listeners.length).toBe(0);
  });
});
