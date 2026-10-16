import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Pikachu, PIKACHU_MOVES } from './Pikachu';
import { createCharacterById, applyCharacterMoveOverrides } from './characterFactory';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import type { CharacterInput } from './Character';
import type { AttackMoveWithAnimation, Hurtbox } from './moveSchema';
import { selectPikachuStateHurtboxes } from './pikachuStateHurtboxes';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
function fixture(saved = false) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, opts: object) {
    const b = Bodies.rectangle(x, y, w, h, opts); Composite.add(engine.world, b); return b;
  } }, world: { on(n: string, f: any) { Events.on(engine, names[n] ?? n, f); },
    off(n: string, f: any) { Events.off(engine, names[n] ?? n, f); }, remove(b: any) { Composite.remove(engine.world, b); } } } };
  const actor = createCharacterById(scene, 'pikachu', { spawnX: 0, spawnY: 0 });
  if (saved) applyCharacterMoveOverrides(actor, parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu'))))));
  Composite.add(engine.world, Bodies.rectangle(0, 35, 20000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const step = (input: Partial<CharacterInput> = {}) => { actor.applyInput({ ...neutral, ...input });
    Engine.update(engine, 1000 / 60); actor.applyPostPhysicsVelocityConstraints(); };
  for (let i = 0; i < 12; i++) step();
  return { actor, step };
}
describe('Dedicated Pikachu compiled and saved fighter', () => {
  it.each([false, true])('retains distinct directional taunts and source cancel49 through factory/save, saved %s', saved => {
    for (const [kind, moveY] of [['up', -1], ['side', 0], ['down', 1]] as const) {
      const { actor, step } = fixture(saved);
      step({ appeal: true, moveY });
      expect(actor.getTauntPresentationState()).toMatchObject({ kind, framesElapsed: 0, cancellable: false });
      for (let age = 1; age <= 48; age++) step();
      expect(actor.getTauntPresentationState()?.framesElapsed).toBe(48);
      step({ attack: true });
      expect(actor.getTauntPresentationState()).toBeNull();
      expect(actor.getActiveAttack()?.move.id).toBe('pikachu.jab');
    }
  });
  it.each([false, true])('keeps all four recovery bodies paired with reviewed capsules through protection and recovery, saved %s', saved => {
    for (const [id, sheet, total, protection] of [
      ['getupAttack', 'getup_attack', 45, 22], ['getupAttackFaceDown', 'getup_attack_face_down', 45, 22],
      ['tripAttack', 'trip_attack', 49, 7], ['ledgeAttack', 'ledge_attack', 55, 25],
    ] as const) {
      const { actor, step } = fixture(saved);
      expect(actor.attemptAttack(`pikachu.${id}`)).toBe(true);
      for (let age = 0; age < total; age++) {
        expect(actor.getActiveAttack()?.framesElapsed).toBe(age);
        const expected = selectPikachuStateHurtboxes(sheet, age) as unknown as readonly Hurtbox[];
        expect(expected).toHaveLength(12);
        expect(actor.getActiveHurtboxes()).toEqual(expected.map(h => age < protection ? { ...h, intangible: true } : h));
        step();
      }
      expect(actor.getActiveAttack()).toBeNull();
    }
  });
  it.each([false, true])('keeps observed tumble receiving above the simultaneous ordinary fall candidate, saved %s', saved => {
    const { actor, step } = fixture(saved);
    actor.applyHit({ damage: 1, knockback: { x: 3, y: -12, scaling: 0 }, facing: 1, hitlagMultiplier: 1 });
    let observedOverlap = false;
    for (let i = 0; i < 120; i++) {
      step();
      if (actor.getReactionPresentationState()?.kind === 'tumble' && actor.getOrdinaryPresentationState()?.sheet === 'fall') {
        observedOverlap = true;
        const receiving = actor.getActiveHurtboxes();
        expect(receiving).toHaveLength(12);
        expect(receiving.every(h => h.id.startsWith('pikachu.tumble.'))).toBe(true);
      }
    }
    expect(observedOverlap).toBe(true);
  });
  it.each([false, true])('factory uses dedicated identity and complete authored slots, saved %s', saved => {
    const { actor } = fixture(saved);
    expect(actor).toBeInstanceOf(Pikachu); expect(actor.id).toBe('pikachu');
    expect(actor.getLightAttackId()).toBe('pikachu.jab');
    expect(actor.getTiltAttackId()).toBe('pikachu.forward-tilt');
    expect(actor.getHeavyAttackId()).toBe('pikachu.forward-smash');
    expect(actor.getGrabSpec()?.id).toBe('pikachu.grab');
    expect(actor.getGrabSpec()?.ultimateCapture).toBe(true);
    expect(actor.getTuning().referenceWeight).toBe(79);
    const spec = getAuthorableCharacterSpec('pikachu');
    expect(Object.keys(spec.moves ?? {})).toHaveLength(PIKACHU_MOVES.length + 2);
    expect(spec.moves?.tilt?.angledVariants?.up?.damage).toBe(10);
    expect(spec.moves?.tilt?.angledVariants?.down?.damage).toBe(8);
    expect(spec.moves?.bair?.landingAttack?.damage).toBe(4);
    expect(spec.moves?.dair?.landingAttack?.damage).toBe(4);
    expect(spec.moves?.smash?.charge?.maxChargeFrames).toBe(60);
    expect(spec.moves?.smash?.charge?.maxHoldFrames).toBe(180);
  });
  it.each([false, true])('normal ground input chooses all directions, saved %s', saved => {
    const cases: [Partial<CharacterInput>, string][] = [
      [{ attack: true }, 'pikachu.jab'], [{ attack: true, moveX: 0.5 }, 'pikachu.forward-tilt'],
      [{ attack: true, moveY: -1 }, 'pikachu.up-tilt'], [{ attack: true, moveY: 1 }, 'pikachu.down-tilt'],
      [{ attackHeavy: true }, 'pikachu.forward-smash'], [{ attackHeavy: true, moveY: -1 }, 'pikachu.up-smash'],
      [{ attackHeavy: true, moveY: 1 }, 'pikachu.down-smash'] ];
    for (const [input, id] of cases) {
      const { actor, step } = fixture(saved);
      // A fresh directional flick+light intentionally selects a smash. Hold the
      // direction first when testing cardinal light/tilt routing.
      if (input.attack && Math.abs(input.moveY ?? 0) > 0) step({ moveY: input.moveY });
      step(input); expect(actor.getActiveAttack()?.move.id ?? actor.getAnimationActionState().chargingMove?.id).toBe(id);
    }
  });
  it.each([false, true])('selects reviewed angled strips and receiving through diagonal inputs, saved %s', saved => {
    for (const facing of [-1, 1] as const) for (const [moveY, angle] of [[-0.5, 'up'], [0.5, 'down']] as const) {
      const { actor, step } = fixture(saved);
      step({ moveX: facing * 0.5, moveY });
      step({ moveX: facing * 0.5, moveY, attack: true });
      const active = actor.getActiveAttack()!;
      expect(active.move.id).toBe(`pikachu.forward-tilt-${angle}`);
      expect(active.facing).toBe(facing);
      expect((active.move as AttackMoveWithAnimation).animation?.frameWindows).toHaveLength(8);
      expect(actor.getActiveHurtboxes()).toHaveLength(12);
      expect(actor.getActiveHurtboxes().every(row => row.id.includes(`forward-tilt-${angle}`))).toBe(true);
    }
  });
  it('keeps full-power smash held beyond60 with the matching final receiving pose and freezes its clock', () => {
    const { actor, step } = fixture();
    for (let i = 0; i < 80; i++) step({ attackHeavy: true });
    const held = actor.getAnimationActionState();
    expect(held.chargingMove?.id).toBe('pikachu.forward-smash');
    expect(held.chargeHeldFrames).toBeGreaterThan(60);
    expect(actor.getActiveAttack()).toBeNull();
    const receiving = actor.getActiveHurtboxes();
    expect(receiving).toHaveLength(12);
    expect(receiving.every(h => h.id.startsWith('pikachu.forward-smash-charge.'))).toBe(true);
    actor.armAttackerHitlag(3);
    for (let i = 0; i < 3; i++) step({ attackHeavy: true });
    expect(actor.getAnimationActionState().chargeHeldFrames).toBe(held.chargeHeldFrames);
    expect(actor.getActiveHurtboxes()).toEqual(receiving);
    step();
    expect(actor.getActiveAttack()?.move.id).toBe('pikachu.forward-smash');
    expect(actor.getActiveHurtboxes().some(h => h.id.includes('-charge.'))).toBe(false);
  });
  it.each([-1, 1] as const)('retains source initial dash13 frames and run in facing%s', facing => {
    const { actor, step } = fixture(); const start = actor.getPosition().x;
    for (let i = 0; i < 13; i++) { step({ moveX: facing }); expect(actor.getLocomotionStateName()).toBe('initialDash');
      expect(actor.getVelocity().x).toBeCloseTo(facing * 9.9, 2); }
    expect(actor.getPosition().x - start).toBeCloseTo(facing * 13 * 9.9, 1);
    for (let i = 0; i < 15; i++) step({ moveX: facing });
    expect(actor.getLocomotionStateName()).toBe('run'); expect(actor.getVelocity().x).toBeCloseTo(facing * 10.195, 2);
  });
  it.each([['full', 177.5], ['short', 85.6]] as const)('calibrates %s hop against retained source height', (kind, height) => {
    const { actor, step } = fixture(); const origin = actor.getPosition().y;
    let min = origin, airborne = false, duration = 0;
    for (let frame = 0; frame < 100; frame++) {
      step({ jump: kind === 'full' || frame === 0 }); min = Math.min(min, actor.getPosition().y);
      if (!actor.isGrounded()) { airborne = true; duration++; }
      else if (airborne) break;
    }
    expect(origin - min).toBeCloseTo(height, 1);
    expect(duration).toBeGreaterThan(30); expect(duration).toBeLessThan(60);
  });
});
