/**
 * Super armour (`AttackMove.armorWindows`) — a move can declare zero-based
 * half-open elapsed intervals during which hits still deal damage but cannot
 * launch, stun or interrupt the fighter. Sourced need: Donkey Kong's Headbutt
 * (armour frames 5–14), Spinning Kong (5–17) and full-charge Giant Punch.
 */
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { HitInfo } from './combat';

function createMockScene(): { scene: any } {
  const matter = {
    add: {
      rectangle(x: number, y: number, _w: number, _h: number, options: Record<string, unknown>) {
        return { position: { x, y }, velocity: { x: 0, y: 0 }, label: options['label'], options, removed: false };
      },
    },
    body: {
      setVelocity(b: any, v: { x: number; y: number }): void { b.velocity = { x: v.x, y: v.y }; },
      setPosition(b: any, v: { x: number; y: number }): void { b.position = { x: v.x, y: v.y }; },
      setInertia(): void { /* no-op */ },
    },
    world: { on(): void {}, off(): void {}, remove(b: any): void { b.removed = true; } },
  };
  return { scene: { matter } };
}

const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

/** Armour on elapsed steps [2, 6): source frames 3–6 of a 12-frame move. */
const ARMORED_MOVE: AttackMoveWithAnimation = {
  id: 'test.armored',
  type: 'tilt',
  damage: 5,
  knockback: { x: 2, y: -1, scaling: 0.1 },
  hitbox: { offsetX: 30, offsetY: 0, width: 30, height: 20 },
  startupFrames: 4,
  activeFrames: 2,
  recoveryFrames: 6,
  cooldownFrames: 0,
  armorWindows: [{ startFrame: 2, endFrame: 6 }],
};

const HIT: HitInfo = { damage: 7, knockback: { x: 3, y: -1.5, scaling: 0.2 }, facing: 1 };

function armedFighter(elapsed: number): Character {
  const ch = new Character(createMockScene().scene, { id: 'donkeykong', spawnX: 0, spawnY: 0 });
  ch.addAttack(ARMORED_MOVE);
  expect(ch.attemptAttack(ARMORED_MOVE.id)).toBe(true);
  for (let i = 0; i < elapsed; i += 1) ch.applyInput(NEUTRAL);
  expect(ch.getActiveAttack()?.framesElapsed).toBe(elapsed);
  return ch;
}

describe('AttackMove.armorWindows — super armour', () => {
  it('inside the window: damage lands, no launch, the move keeps running', () => {
    const ch = armedFighter(3);
    const result = ch.applyHitDetailed(HIT);
    expect(result.outcome).toBe('armored');
    expect(result.damageApplied).toBe(7);
    expect(result.knockback.magnitude).toBe(0);
    expect(result.knockback.hitstunFrames).toBe(0);
    expect(ch.getDamagePercent()).toBe(7);
    expect(ch.getActiveAttack()?.move.id).toBe(ARMORED_MOVE.id);
  });

  it('the window is half-open: the first armoured step is 2, step 6 is exposed', () => {
    expect(armedFighter(2).applyHitDetailed(HIT).outcome).toBe('armored');
    expect(armedFighter(5).applyHitDetailed(HIT).outcome).toBe('armored');
    const exposed = armedFighter(6);
    expect(exposed.applyHitDetailed(HIT).outcome).toBe('landed');
    expect(exposed.getActiveAttack()).toBeNull();
  });

  it('before the window the hit interrupts the move as usual', () => {
    const ch = armedFighter(1);
    const result = ch.applyHitDetailed(HIT);
    expect(result.outcome).toBe('landed');
    expect(result.knockback.magnitude).toBeGreaterThan(0);
    expect(ch.getActiveAttack()).toBeNull();
  });

  it('a move without armorWindows is never armoured', () => {
    const ch = new Character(createMockScene().scene, { id: 'donkeykong', spawnX: 0, spawnY: 0 });
    ch.addAttack({ ...ARMORED_MOVE, id: 'test.plain', armorWindows: undefined });
    expect(ch.attemptAttack('test.plain')).toBe(true);
    for (let i = 0; i < 3; i += 1) ch.applyInput(NEUTRAL);
    expect(ch.applyHitDetailed(HIT).outcome).toBe('landed');
  });
});
