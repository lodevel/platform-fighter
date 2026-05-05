import { describe, it, expect } from 'vitest';
import { Character, type CharacterInput } from './Character';
// Sub-AC 3 of the T2 refactor — installs the legacy
// `Character.prototype.registerAttack` shim before the tests call it on
// a base `Character` instance. See `attackRegistration.ts` for the
// extraction story.
import './attackRegistration';
import type { AttackMove } from './attacks';
import { PLATFORM_LABELS } from '../stages/StageRenderer';
import { ASSET_KEYS } from '../assets/manifest';
import type { CombatSfxSink } from '../audio/combatAudio';

/**
 * Character × combat-audio integration tests — AC 10302 Sub-AC 2.
 *
 * Sub-AC 1 of AC 10302 stood up the {@link AudioManager}; Sub-AC 2
 * (this suite) verifies that the per-frame physics tick fires the
 * right SFX at the right combat events:
 *
 *   • `'sfx.jab'` on the startup→active transition of a `'jab'`-typed
 *     move.
 *   • `'sfx.tilt'` / `'sfx.smash'` / `'sfx.aerial'` on the same
 *     transition for their respective move types.
 *   • `'sfx.shield'` on the rising edge of the shield-raise.
 *   • `'sfx.dodge'` on the dodge state-machine non-`'active'` →
 *     `'active'` transition.
 *
 * Why a recorder fake (and not the full {@link AudioManager}):
 *
 *   These tests are about the **wiring** — the call site, the cadence,
 *   the move-type → cue-key resolution. They are NOT about voice
 *   limits, cooldowns, or bus mixing (those are AudioManager.test.ts's
 *   job). A two-line recorder sink is enough to lock down "the right
 *   key was pushed on the right frame" without dragging the audio
 *   subsystem into combat-test setup.
 *
 * Mock-scene pattern mirrors `Character.test.ts` exactly — same
 * `MockScene` / `MockBody` shapes, same `ground()` helper for dropping
 * a fighter onto a platform.
 */

// ---------------------------------------------------------------------------
// Mock scene (mirrors Character.test.ts to avoid import coupling)
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
  listeners: CollisionListener[];
  emit(event: 'collisionstart' | 'collisionend', pairs: unknown[]): void;
  scene: any;
}

function createMockScene(): MockScene {
  const bodies: MockBody[] = [];
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
        // No-op for these tests — Character locks rotation on
        // construction; we don't assert on the call here.
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
      },
    },
  };

  return {
    bodies,
    listeners,
    scene: { matter },
    emit(event, pairs) {
      for (const l of listeners.slice()) {
        if (l.event === event) l.fn({ pairs });
      }
    },
  };
}

function makePlatform(x: number, y: number) {
  return { label: PLATFORM_LABELS.solid, position: { x, y } };
}

function ground(ch: Character, m: MockScene): void {
  const plat = makePlatform(ch.getPosition().x, ch.getPosition().y + 100);
  m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
}

// ---------------------------------------------------------------------------
// Recorder sink — Combat-audio fake that captures the call sequence
// ---------------------------------------------------------------------------

class RecorderSink implements CombatSfxSink {
  readonly calls: string[] = [];
  playSfx(key: string): unknown {
    this.calls.push(key);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Move fixtures — minimal `AttackMove`s for each of the four canonical types
// ---------------------------------------------------------------------------

const JAB: AttackMove = {
  id: 'test.jab',
  type: 'jab',
  damage: 3,
  knockback: { x: 1, y: 0, scaling: 0 },
  hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
  startupFrames: 2,
  activeFrames: 1,
  recoveryFrames: 1,
  cooldownFrames: 1,
};

const TILT: AttackMove = {
  id: 'test.tilt',
  type: 'tilt',
  damage: 5,
  knockback: { x: 1.5, y: 0, scaling: 0 },
  hitbox: { offsetX: 35, offsetY: 0, width: 40, height: 30 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 2,
  cooldownFrames: 1,
};

const SMASH: AttackMove = {
  id: 'test.smash',
  type: 'smash',
  damage: 12,
  knockback: { x: 4, y: -1, scaling: 0.4 },
  hitbox: { offsetX: 50, offsetY: 0, width: 60, height: 40 },
  startupFrames: 5,
  activeFrames: 2,
  recoveryFrames: 4,
  cooldownFrames: 2,
};

const NAIR: AttackMove = {
  id: 'test.nair',
  type: 'aerial',
  damage: 6,
  knockback: { x: 1, y: -1, scaling: 0.1 },
  hitbox: { offsetX: 0, offsetY: 0, width: 80, height: 80 },
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 2,
  cooldownFrames: 1,
};

const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

// ---------------------------------------------------------------------------
// Attack SFX (jab / tilt / smash / aerial)
// ---------------------------------------------------------------------------

describe('Character — attack SFX firing (AC 10302 Sub-AC 2)', () => {
  it('fires sfx.jab on the startup → active transition of a jab move', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.registerAttack(JAB);
    ch.attemptAttack(JAB.id);

    // Startup phase contract (`Character.phaseFor`):
    //   `framesElapsed < startupFrames` ⇒ startup.
    // `applyInput` increments framesElapsed BEFORE the phase
    // recompute, so for `startupFrames: 2`:
    //   • call #1: prev=startup(fE=0), fE=1, new=startup(1<2) — silent
    //   • call #2: prev=startup(fE=1), fE=2, new=active (2<2+1) — FIRE
    expect(sink.calls).toEqual([]); // press alone is silent
    ch.applyInput(NEUTRAL); // call #1 — startup → startup, silent
    expect(sink.calls).toEqual([]);
    ch.applyInput(NEUTRAL); // call #2 — startup → active — FIRE
    expect(sink.calls).toEqual([ASSET_KEYS.sfxJab]);
  });

  it('fires sfx.tilt on the startup → active transition of a tilt move', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.registerAttack(TILT);
    ch.attemptAttack(TILT.id);
    // startupFrames=3 → cue fires on the 3rd applyInput call.
    ch.applyInput(NEUTRAL); // #1
    ch.applyInput(NEUTRAL); // #2
    expect(sink.calls).toEqual([]);
    ch.applyInput(NEUTRAL); // #3 — startup → active
    expect(sink.calls).toEqual([ASSET_KEYS.sfxTilt]);
  });

  it('fires sfx.smash on the startup → active transition of a smash move', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.registerAttack(SMASH);
    ch.attemptAttack(SMASH.id);
    // startupFrames=5 → cue fires on the 5th applyInput call.
    for (let i = 0; i < 4; i += 1) ch.applyInput(NEUTRAL);
    expect(sink.calls).toEqual([]);
    ch.applyInput(NEUTRAL); // #5 — startup → active
    expect(sink.calls).toEqual([ASSET_KEYS.sfxSmash]);
  });

  it('fires sfx.aerial on the startup → active transition of an aerial move', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    // Aerial — no need to ground; the move is airborne-friendly.
    ch.registerAttack(NAIR);
    ch.attemptAttack(NAIR.id);
    // startupFrames=3 → cue fires on the 3rd applyInput call.
    ch.applyInput(NEUTRAL); // #1
    ch.applyInput(NEUTRAL); // #2
    expect(sink.calls).toEqual([]);
    ch.applyInput(NEUTRAL); // #3 — startup → active
    expect(sink.calls).toEqual([ASSET_KEYS.sfxAerial]);
  });

  it('does NOT fire on the active → recovery transition (only on startup → active)', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.registerAttack(JAB);
    ch.attemptAttack(JAB.id);
    // Drive the attack through every phase. The cue must fire exactly
    // once — at the moment the hitbox spawns — not again on recovery
    // entry, not on attack-end, not on the next press cooldown.
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    expect(sink.calls).toEqual([ASSET_KEYS.sfxJab]);
  });

  it('does not fire any cue when the sink is not wired', () => {
    const m = createMockScene();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    ch.registerAttack(JAB);
    ch.attemptAttack(JAB.id);
    // No throw, no crash — silent operation when no sink is configured.
    expect(() => {
      for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    }).not.toThrow();
  });

  it('emits one cue per attack — multiple consecutive attacks each fire one cue', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.registerAttack(JAB);

    // First attack
    ch.attemptAttack(JAB.id);
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    expect(sink.calls.length).toBe(1);

    // Second attack — fresh press, fresh hitbox spawn, fresh cue.
    ch.attemptAttack(JAB.id);
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    expect(sink.calls).toEqual([ASSET_KEYS.sfxJab, ASSET_KEYS.sfxJab]);
  });

  it('survives a sink that throws — the gameplay tick keeps advancing', () => {
    const m = createMockScene();
    const throwingSink: CombatSfxSink = {
      playSfx() {
        throw new Error('audio backend exploded');
      },
    };
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: throwingSink,
    });
    ground(ch, m);
    ch.registerAttack(JAB);
    ch.attemptAttack(JAB.id);
    expect(() => {
      for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Shield SFX
// ---------------------------------------------------------------------------

describe('Character — shield SFX firing (AC 10302 Sub-AC 2)', () => {
  it('fires sfx.shield on the rising edge of a shield raise', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(sink.calls).toEqual([ASSET_KEYS.sfxShield]);
  });

  it('does not fire while the shield is held across consecutive frames', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    for (let i = 0; i < 5; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, shield: true });
    }
    // Single rising edge ⇒ single cue.
    expect(sink.calls).toEqual([ASSET_KEYS.sfxShield]);
  });

  it('fires again when the player releases and re-raises', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    // Release for a frame. The runtime needs the held=false transition
    // so the next press is a fresh rising edge.
    ch.applyInput({ moveX: 0, jump: false, shield: false });
    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(sink.calls).toEqual([ASSET_KEYS.sfxShield, ASSET_KEYS.sfxShield]);
  });

  it('does not fire a shield cue when the input never asks for shield', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    expect(sink.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dodge SFX
// ---------------------------------------------------------------------------

describe('Character — dodge SFX firing (AC 10302 Sub-AC 2)', () => {
  it('fires sfx.dodge on the rising edge of a spot-dodge press', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 0, jump: false, dodge: true });
    expect(sink.calls).toEqual([ASSET_KEYS.sfxDodge]);
  });

  it('fires sfx.dodge on a roll press (stick deflected at press time)', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.applyInput({ moveX: 1, jump: false, dodge: true });
    expect(sink.calls).toEqual([ASSET_KEYS.sfxDodge]);
  });

  it('does not double-fire when dodge key is held across active frames', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    for (let i = 0; i < 6; i += 1) {
      ch.applyInput({ moveX: 0, jump: false, dodge: true });
    }
    // The state machine collapses repeated held-presses to one
    // active-state entry. The cue must mirror that — exactly one
    // emit for the single rising-edge press.
    expect(sink.calls).toEqual([ASSET_KEYS.sfxDodge]);
  });

  it('does not fire a dodge cue when no dodge press happens', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    for (let i = 0; i < 10; i += 1) ch.applyInput(NEUTRAL);
    expect(sink.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setSfxSink — wire / unwire a sink post-construction
// ---------------------------------------------------------------------------

describe('Character — setSfxSink (AC 10302 Sub-AC 2)', () => {
  it('attaches a sink post-construction so subsequent events fire', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, { id: 'wolf', spawnX: 0, spawnY: 0 });
    ground(ch, m);
    expect(ch.getSfxSink()).toBe(null);

    ch.setSfxSink(sink);
    expect(ch.getSfxSink()).toBe(sink);

    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(sink.calls).toEqual([ASSET_KEYS.sfxShield]);
  });

  it('detaches a sink (passing null) so subsequent events become silent', () => {
    const m = createMockScene();
    const sink = new RecorderSink();
    const ch = new Character(m.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
      sfxSink: sink,
    });
    ground(ch, m);
    ch.setSfxSink(null);
    expect(ch.getSfxSink()).toBe(null);

    ch.applyInput({ moveX: 0, jump: false, shield: true });
    expect(sink.calls).toEqual([]);
  });
});
