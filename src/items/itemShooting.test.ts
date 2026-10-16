import { describe, expect, it } from 'vitest';
import { startShooting, stepShooting, shootingMotion, scopeStageFor, type ShootingSpec, type ShootingState } from './itemShooting';
import { RAY_GUN_DEFINITION, RAY_GUN_SHOOTING } from './RayGun';
import { SUPER_SCOPE_DEFINITION, SUPER_SCOPE_SHOOTING } from './SuperScope';
import { FIRE_FLOWER_DEFINITION, FIRE_FLOWER_SHOOTING } from './FireFlower';

/** Drive a session: `held(age)` = attack button; returns the shots per age and the age it ended on. */
function run(spec: ShootingSpec, held: (age: number) => boolean, ammo = 1000, limit = 2000) {
  let state: ShootingState | null = startShooting(spec, 1), left = ammo;
  const shots: { age: number; id: string }[] = [];
  const spend = (cost: number) => (left >= cost ? (left -= cost, true) : false);
  let age = 0;
  for (; state && age < limit; age++) {
    const step = stepShooting(spec, state, held(age), spend, left);
    for (const s of step.shots) shots.push({ age, id: s.id });
    state = step.state;
  }
  return { shots, end: age - 1, ammoLeft: left };
}

describe('shooting sessions (itemShooting.ts)', () => {
  it('Ray Gun: one shot on frame 9, next shot allowed on frame 25 (SmashWiki every 25 frames)', () => {
    const r = run(RAY_GUN_SHOOTING, age => age === 0);
    expect(r.shots).toEqual([{ age: 8, id: 'item.rayGun.shot' }]);
    expect(r.end).toBe(24);   // the step the session ends: the 25th frame is free
    expect(r.ammoLeft).toBe(999);
  });

  it('Super Scope tap: released during the raise = 5 rapid 1% shots, 1 ammo each', () => {
    const r = run(SUPER_SCOPE_SHOOTING, age => age < 3);
    expect(r.shots.map(s => s.id)).toEqual(Array(5).fill('item.superScope.rapid'));
    expect(r.ammoLeft).toBe(995);
    expect(r.shots.map(s => s.age)).toEqual([15, 23, 31, 39, 47]);
  });

  it('Super Scope hold: charges in the wait loop; release fires one stage shot paid by its cost', () => {
    const full = run(SUPER_SCOPE_SHOOTING, age => age < 14 + 1 + 100);
    expect(full.shots.map(s => s.id)).toEqual(['item.superScope.charge10']);
    expect(full.ammoLeft).toBe(1000 - 16);
    const quick = run(SUPER_SCOPE_SHOOTING, age => age < 16);
    expect(quick.shots.map(s => s.id)).toEqual(['item.superScope.charge1']);
    expect(quick.ammoLeft).toBe(999);
  });

  it('Super Scope stages: 1/4/6/8/10/12/14/16 ammo for 1/7/10/13/16/20/24/28% (SmashWiki); charge selects them evenly', () => {
    expect(SUPER_SCOPE_SHOOTING.stages.map(s => [s.stage, s.cost, s.shot.damage])).toEqual([[1, 1, 1], [4, 4, 7], [5, 6, 10],
      [6, 8, 13], [7, 10, 16], [8, 12, 20], [9, 14, 24], [10, 16, 28]]);
    expect([0, 14, 15, 50, 99, 100].map(c => scopeStageFor(SUPER_SCOPE_SHOOTING, c, null)!.stage)).toEqual([1, 1, 4, 6, 9, 10]);
    // Not enough ammo: the strongest affordable stage.
    expect(scopeStageFor(SUPER_SCOPE_SHOOTING, 100, 9)!.stage).toBe(6);
    expect(scopeStageFor(SUPER_SCOPE_SHOOTING, 100, 0)).toBeNull();
  });

  it('Super Scope burst stops when the ammo runs out', () => {
    const r = run(SUPER_SCOPE_SHOOTING, age => age < 3, 3);
    expect(r.shots).toHaveLength(3);
    expect(r.ammoLeft).toBe(0);
  });

  it('Fire Flower: a flame every 12 frames from frame 8 while held, fuel spent every streaming frame', () => {
    const r = run(FIRE_FLOWER_SHOOTING, age => age < 60);
    expect(r.shots.map(s => s.age)).toEqual([7, 19, 31, 43, 55]);
    expect(r.ammoLeft).toBe(1000 - (r.end - 7));
  });

  it('Fire Flower: at least 3 flames per press; 7 s of fuel = 35 flames held to empty', () => {
    expect(run(FIRE_FLOWER_SHOOTING, age => age === 0).shots).toHaveLength(3);
    const empty = run(FIRE_FLOWER_SHOOTING, () => true, FIRE_FLOWER_DEFINITION.ammo!);
    expect(empty.ammoLeft).toBe(0);
    expect(empty.shots).toHaveLength(35);
  });

  it('names the native motion of each phase (full body / upper layer / air)', () => {
    let state: ShootingState = startShooting(SUPER_SCOPE_SHOOTING, -1);
    state = stepShooting(SUPER_SCOPE_SHOOTING, state, true, () => true, 72).state!;
    expect(shootingMotion(SUPER_SCOPE_SHOOTING, state)).toEqual({ clips: SUPER_SCOPE_SHOOTING.start.clips, age: 0 });
    expect(SUPER_SCOPE_SHOOTING.wait.clips).toEqual({ ground: 'item_scope_wait', upper: 'item_scope_wait_upper', air: 'item_scope_fall' });
    expect(RAY_GUN_SHOOTING.clips).toEqual({ ground: 'item_lgun_shoot', upper: 'item_lgun_shoot_upper', air: 'item_lgun_shoot_air' });
  });

  it('the three items are light shooting items with SmashWiki ammo, drawn along their native aiming axis', () => {
    expect([RAY_GUN_DEFINITION, SUPER_SCOPE_DEFINITION, FIRE_FLOWER_DEFINITION].map(d => [d.type, d.itemClass, d.ammo, d.visual?.socketAxis]))
      .toEqual([['rayGun', 'shooting', 16, 'z'], ['superScope', 'shooting', 72, 'y'], ['fireFlower', 'shooting', 420, 'z']]);
  });
});

describe('empty shooting items (SmashWiki Item#Item_drop_chance, Smash 4 and Ultimate)', () => {
  it('are dropped on hit with chance base damage / 2 (normal items ceil(base damage) / 70)', async () => {
    const { heldItemDropChance } = await import('./heldItemDrop');
    expect(heldItemDropChance(1, true)).toBe(0.5);
    expect(heldItemDropChance(3, true)).toBe(1);
    expect(heldItemDropChance(3)).toBeCloseTo(3 / 70, 10);
  });

  it('an empty gun cannot fire (it is thrown) and reports itself empty', async () => {
    const { ItemEntity } = await import('./ItemEntity');
    const gun = new ItemEntity(1, RAY_GUN_DEFINITION, 0, { x: 0, y: 0 });
    gun.markGrounded(0, { x: 0, y: 0 });
    gun.markHeld(0, 0, { x: 0, y: 0 });
    for (let i = 0; i < 16; i++) expect(gun.spendShot()).toBe(true);
    expect(gun.spendShot()).toBe(false);
    expect(gun.canUse()).toBe(false);
    expect(gun.isEmptyShooter()).toBe(true);
    const scope = new ItemEntity(2, SUPER_SCOPE_DEFINITION, 0, { x: 0, y: 0 });
    scope.markGrounded(0, { x: 0, y: 0 });
    scope.markHeld(0, 0, { x: 0, y: 0 });
    expect(scope.spendShot(16)).toBe(true);
    expect(scope.getAmmo()).toBe(56);
    expect(scope.spendShot(60)).toBe(false);
    expect(scope.getAmmo()).toBe(56);
  });
});
