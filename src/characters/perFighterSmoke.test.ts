/**
 * Sub-AC 2.3 of the T2 per-fighter refactor track — smoke tests.
 *
 * Goal: verify that all 4 per-fighter subclasses (Wolf, Cat, Owl, Bear)
 * compile and behave identically against the shared {@link Character}
 * base after Sub-AC 2.1's per-slot `executeXxx()` extraction and Sub-AC
 * 2.2's per-fighter movement-profile extraction.
 *
 * The base class now exposes only the *shared base contract* — lifecycle
 * (constructor / destroy / setPosition), state machines (damage,
 * knockback, hitstun, shield, dodge, ledge), and the *uniform 10-slot
 * interface hooks* (registerAttack, attemptAttack, attemptUpSpecial,
 * the protected executeXxx defaults, and the slot setter / getter
 * pairs). Per-fighter subclasses *override* the executeXxx hooks with
 * direct `attemptAttack(<X>_SLOT.id)` calls so each fighter owns the
 * "fire WHICH move" decision for every slot in its 10-slot
 * {@link FighterMoveset}.
 *
 * What this smoke test pins down (per the sub-AC scope):
 *
 *   1. Each per-fighter subclass instantiates without throwing under
 *      the shared MockScene harness — so the constructor's
 *      `registerAttack` chain compiles and runs end-to-end with the
 *      shared base.
 *   2. Each fighter exposes the canonical 10-slot moveset surface
 *      (`fighter.moveset[slot]` resolves to a non-null record for every
 *      `MOVESET_SLOT_NAMES` entry).
 *   3. The 8 attack-slot `executeXxx()` overrides each light up the
 *      base class's `activeAttack` slot with the correct authored move
 *      id — proving that "press attack → run the correct move" works
 *      identically across the cast, with zero per-fighter knowledge in
 *      the base class.
 *   4. Per-fighter movement profile is honoured: a horizontal-stick
 *      input accelerates the body in the direction of the stick, and
 *      a jump press leaves the ground (consumes a jump). These are
 *      the two minimal "fighter is alive in the world" properties that
 *      every per-fighter movement profile must guarantee.
 *   5. The two defensive slot stubs (`executeShield` / `executeDodge`)
 *      exist as per-fighter methods (no-op for now per Sub-AC 2.1's
 *      explicit out-of-scope note), so the input layer can call them
 *      uniformly without per-fighter case branching.
 *
 * Same MockScene pattern as the rest of `src/characters/*.test.ts` —
 * Phaser-free under plain Node.
 */

import { describe, it, expect } from 'vitest';

import { Character } from './Character';
import { Wolf, WOLF_FIGHTER_CONTRACT } from './Wolf';
import { Cat, CAT_FIGHTER_CONTRACT } from './Cat';
import { Owl, OWL_FIGHTER_CONTRACT } from './Owl';
import { Bear, BEAR_FIGHTER_CONTRACT } from './Bear';
import {
  ATTACK_MOVESET_SLOT_NAMES,
  MOVESET_SLOT_NAMES,
  type AttackMovesetSlotName,
  type FighterContract,
} from './movesetContract';
import type { CharacterId } from '../types';

// ---------------------------------------------------------------------------
// MockScene — same Phaser-free shape used by characterFactory.test.ts /
// fighterRegistry.test.ts so the smoke test stays consistent with the rest
// of the per-character suite.
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

function createMockScene(): {
  scene: any;
  bodies: MockBody[];
  fireGroundContact: (charBody: MockBody, platformY?: number) => void;
} {
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
      setVelocity(b: MockBody, v: { x: number; y: number }): void {
        b.velocity = { x: v.x, y: v.y };
      },
      setPosition(b: MockBody, v: { x: number; y: number }): void {
        b.position = { x: v.x, y: v.y };
      },
      setInertia(_b: MockBody, _i: number): void {
        /* no-op for smoke tests */
      },
    },
    world: {
      on(
        event: 'collisionstart' | 'collisionend',
        fn: CollisionListener['fn'],
      ): void {
        listeners.push({ event, fn });
      },
      off(
        event: 'collisionstart' | 'collisionend',
        fn: CollisionListener['fn'],
      ): void {
        const idx = listeners.findIndex(
          (l) => l.event === event && l.fn === fn,
        );
        if (idx >= 0) listeners.splice(idx, 1);
      },
      remove(b: MockBody): void {
        b.removed = true;
      },
    },
  };

  // Synthesise a `collisionstart` pair where a platform body sits below
  // the character body — the same shape Character.ts's groundContact
  // detection reads. Used by the jump / movement smoke checks so the
  // fighter is grounded for one tick (mirrors the real Matter event the
  // PhysicsEngine fires once the body lands on a platform).
  function fireGroundContact(charBody: MockBody, platformY?: number): void {
    const platform: SupportPair['bodyB'] = {
      label: 'platform.solid',
      position: { x: charBody.position.x, y: (platformY ?? charBody.position.y + 80) },
    };
    const pair: SupportPair = {
      bodyA: {
        label: charBody.label,
        position: { x: charBody.position.x, y: charBody.position.y },
      },
      bodyB: platform,
    };
    for (const l of listeners) {
      if (l.event === 'collisionstart') l.fn({ pairs: [pair] });
    }
  }

  return {
    scene: { matter },
    bodies,
    fireGroundContact,
  };
}

interface SupportPair {
  readonly bodyA: { label?: string | null; position: { x: number; y: number } };
  readonly bodyB: { label?: string | null; position: { x: number; y: number } };
}

// ---------------------------------------------------------------------------
// Per-fighter table — the cast under test. Each entry pairs the
// constructor with the frozen FighterContract so the smoke checks can
// resolve the authored move id for every slot.
// ---------------------------------------------------------------------------

interface FighterUnderTest {
  readonly id: CharacterId;
  readonly displayName: string;
  readonly Ctor: new (
    scene: any,
    options: { spawnX: number; spawnY: number },
  ) => Character;
  readonly contract: FighterContract;
}

const FIGHTERS: ReadonlyArray<FighterUnderTest> = [
  { id: 'wolf', displayName: 'Wolf', Ctor: Wolf, contract: WOLF_FIGHTER_CONTRACT },
  { id: 'cat', displayName: 'Cat', Ctor: Cat, contract: CAT_FIGHTER_CONTRACT },
  { id: 'owl', displayName: 'Owl', Ctor: Owl, contract: OWL_FIGHTER_CONTRACT },
  { id: 'bear', displayName: 'Bear', Ctor: Bear, contract: BEAR_FIGHTER_CONTRACT },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sub-AC 2.3 smoke — per-fighter compiles + behaves identically against shared base', () => {
  describe.each(FIGHTERS)(
    '$displayName',
    ({ id, Ctor, contract }) => {
      it('constructs without throwing under the shared MockScene', () => {
        const m = createMockScene();
        const ch = new Ctor(m.scene, { spawnX: 100, spawnY: 200 });
        expect(ch).toBeInstanceOf(Character);
        expect(ch.id).toBe(id);
        expect(ch.getPosition()).toEqual({ x: 100, y: 200 });
      });

      it('exposes the canonical 10-slot moveset surface', () => {
        const m = createMockScene();
        const ch = new Ctor(m.scene, { spawnX: 0, spawnY: 0 }) as Character & {
          moveset: FighterContract['moveset'];
          movementProfile: FighterContract['movementProfile'];
          contract: FighterContract;
        };
        // Both the per-instance `moveset` and the contract reference the
        // same frozen record — so every slot resolves to a non-null
        // value for every fighter, and the contract's identity is
        // stable across constructions.
        expect(ch.moveset).toBe(contract.moveset);
        expect(ch.movementProfile).toBe(contract.movementProfile);
        expect(ch.contract).toBe(contract);
        for (const slot of MOVESET_SLOT_NAMES) {
          expect(
            ch.moveset[slot],
            `${id}.${slot} must be defined`,
          ).toBeDefined();
        }
      });

      // Every attack slot's per-fighter executeXxx() override must light
      // up `activeAttack` with the move id authored on the contract.
      // This is the per-fighter "fire WHICH move" ownership the T2
      // refactor delivers — Wolf alone decides executeJab fires WOLF_JAB,
      // Cat alone decides executeJab fires CAT_JAB, etc. Driven through
      // the canonical attack-slot list so adding a 9th attack slot in the
      // future surfaces a missing-override regression here.
      it.each(ATTACK_MOVESET_SLOT_NAMES)(
        'execute%s fires the contract-authored move id',
        (slot: AttackMovesetSlotName) => {
          const m = createMockScene();
          const ch = new Ctor(m.scene, { spawnX: 0, spawnY: 0 }) as Character & {
            executeJab: () => boolean;
            executeTilt: () => boolean;
            executeSmash: () => boolean;
            executeFair: () => boolean;
            executeNeutralSpecial: () => boolean;
            executeSideSpecial: () => boolean;
            executeUpSpecial: (stickX?: number, stickY?: number) => boolean;
            executeDownSpecial: () => boolean;
          };
          // Fresh fighter — no in-flight attack on construction.
          expect(ch.getActiveAttack()).toBeNull();

          // Map slot literal → method invocation. The per-slot
          // executeXxx is a public override on every fighter (Wolf.ts /
          // Cat.ts / Owl.ts / Bear.ts) — call through the typed instance.
          let started: boolean;
          switch (slot) {
            case 'jab':
              started = ch.executeJab();
              break;
            case 'tilt':
              started = ch.executeTilt();
              break;
            case 'smash':
              started = ch.executeSmash();
              break;
            case 'fair':
              started = ch.executeFair();
              break;
            case 'neutralSpecial':
              started = ch.executeNeutralSpecial();
              break;
            case 'sideSpecial':
              started = ch.executeSideSpecial();
              break;
            case 'upSpecial':
              started = ch.executeUpSpecial();
              break;
            case 'downSpecial':
              started = ch.executeDownSpecial();
              break;
            default: {
              const _exhaustive: never = slot;
              throw new Error(`unhandled slot ${_exhaustive as string}`);
            }
          }

          expect(started, `${id}.execute${slot} must start the move`).toBe(true);
          const active = ch.getActiveAttack();
          expect(active, `${id}.${slot} must light up activeAttack`).not.toBeNull();
          // The authored move id on the contract must match the move
          // that `attemptAttack` resolved — proves the per-fighter
          // override fires the right move and the base-class slot
          // dispatcher routes through cleanly with no per-fighter
          // knowledge baked in.
          const expectedId = contract.moveset[slot].id;
          expect(active?.move.id).toBe(expectedId);
        },
      );

      // Defensive-slot executeXxx() are explicit no-op stubs per
      // Sub-AC 2.1's scope note (the shield / dodge state-machine
      // entries continue to fire from the per-frame tickShield /
      // tickDodge composition in Character.applyInput). The smoke
      // contract is "the methods exist and don't throw" so the input
      // layer can call them uniformly without per-fighter case
      // branching.
      it('executeShield and executeDodge exist as per-fighter no-op stubs', () => {
        const m = createMockScene();
        const ch = new Ctor(m.scene, { spawnX: 0, spawnY: 0 }) as Character & {
          executeShield: () => void;
          executeDodge: () => void;
        };
        expect(typeof ch.executeShield).toBe('function');
        expect(typeof ch.executeDodge).toBe('function');
        expect(() => ch.executeShield()).not.toThrow();
        expect(() => ch.executeDodge()).not.toThrow();
      });

      // Per-fighter movement profile must move the body — horizontal
      // stick accelerates in the stick's direction, and a fresh
      // grounded jump press leaves the ground (consumes a jump from
      // the budget). These are the two minimal "fighter is alive in
      // the world" properties every movement profile must guarantee.
      it('horizontal stick input accelerates the body in the stick direction', () => {
        const m = createMockScene();
        const ch = new Ctor(m.scene, { spawnX: 0, spawnY: 0 });
        // Drive the fighter right for a handful of fixed steps. The
        // body starts at rest; after acceleration it must read a
        // positive horizontal velocity — the per-fighter movement
        // profile applies the right ground / air accel for the stick
        // direction.
        for (let i = 0; i < 4; i++) {
          ch.applyInput({ moveX: 1, jump: false });
        }
        expect(ch.getVelocity().x).toBeGreaterThan(0);
        expect(ch.getFacing()).toBe(1);

        // Reverse — the same fighter accepts the opposite stick and
        // its velocity flips sign within a few frames. Mirrors the
        // canonical "press right then press left, fighter changes
        // direction" gameplay invariant.
        for (let i = 0; i < 12; i++) {
          ch.applyInput({ moveX: -1, jump: false });
        }
        expect(ch.getVelocity().x).toBeLessThan(0);
        expect(ch.getFacing()).toBe(-1);
      });

      it('jump press from grounded leaves the ground (consumes a jump)', () => {
        const m = createMockScene();
        const ch = new Ctor(m.scene, { spawnX: 0, spawnY: 0 });
        const charBody = m.bodies[m.bodies.length - 1]!;
        // Fresh fighter — no jumps consumed yet.
        expect(ch.getJumpsUsed()).toBe(0);

        // Synthesise a ground contact under the body so the rising-
        // edge jump press fires the impulse. (No platform = airborne =
        // jump still works because the budget allows multi-jump, but
        // we simulate the canonical "grounded → jump" path.)
        m.fireGroundContact(charBody, charBody.position.y + 80);
        // Apply a single jump press (rising edge: prevJumpHeld was
        // false on construction). Velocity must read negative-y (up)
        // afterwards — the body just got an upward impulse.
        ch.applyInput({ moveX: 0, jump: true });
        expect(ch.getVelocity().y).toBeLessThan(0);
        // The jump consumed a slot from the budget — proves the
        // per-fighter movement profile's `maxJumps` parameter is wired
        // into the lifecycle.
        expect(ch.getJumpsUsed()).toBeGreaterThan(0);
      });
    },
  );
});

describe('Sub-AC 2.3 smoke — base class is the same shared contract for every fighter', () => {
  it('every fighter is structurally a Character (shared lifecycle / state)', () => {
    for (const f of FIGHTERS) {
      const m = createMockScene();
      const ch = new f.Ctor(m.scene, { spawnX: 0, spawnY: 0 });
      // Lifecycle / state surface — these methods come from the shared
      // base, NOT from any per-fighter subclass. If any of them go
      // missing on a fighter the test surfaces immediately.
      expect(typeof ch.applyInput).toBe('function');
      expect(typeof ch.destroy).toBe('function');
      expect(typeof ch.setPosition).toBe('function');
      expect(typeof ch.getPosition).toBe('function');
      expect(typeof ch.getVelocity).toBe('function');
      expect(typeof ch.getTuning).toBe('function');
      expect(typeof ch.getActiveAttack).toBe('function');
      expect(typeof ch.attemptAttack).toBe('function');
      // 10-slot interface hooks come from the shared base too — slot
      // setters / getters must exist on every fighter (the input layer
      // and the T3 item framework will call them uniformly).
      expect(typeof ch.getNeutralSpecialId).toBe('function');
      expect(typeof ch.getUpSpecialId).toBe('function');
      expect(typeof ch.getDownSpecialId).toBe('function');
    }
  });

  it('every fighter constructs and destroys cleanly back-to-back (no leaked state)', () => {
    // Construct every fighter twice in a row on the same scene — the
    // second construction must succeed (no global state leaks between
    // instances) and the first instance's destroy() must not throw.
    for (const f of FIGHTERS) {
      const m = createMockScene();
      const a = new f.Ctor(m.scene, { spawnX: 0, spawnY: 0 });
      const b = new f.Ctor(m.scene, { spawnX: 100, spawnY: 0 });
      expect(a.id).toBe(f.id);
      expect(b.id).toBe(f.id);
      expect(() => a.destroy()).not.toThrow();
      expect(() => b.destroy()).not.toThrow();
    }
  });
});
