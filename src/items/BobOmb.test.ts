/**
 * Bob-omb (Ultimate items phase 5). Sources: docs/review/2026-10-11/ultimate-items/phase-5/sources.json.
 */
import { describe, expect, it } from 'vitest';
import { BOB_OMB_DEFINITION, BOB_OMB_EXPLOSION, BOB_OMB_INITIAL_STATE, BOB_OMB_SPEC, bobOmbFlashing, itemExplosionHit,
  stepBobOmb, type BobOmbSituation, type BobOmbState } from './BobOmb';
import { nativeItemReleaseVelocity, thrownItemHit } from './nativeItemThrow';
import { FIGHTER_ITEM_PROFILES, getItemActionPlan, itemReleaseVelocity } from './itemActions';
import { ItemEntity } from './ItemEntity';

const run = (state: BobOmbState, situation: BobOmbSituation, frames: number, toward: 1 | -1 = 1) => {
  let explode = false;
  for (let n = 0; n < frames && !explode; n++) ({ state, explode } = stepBobOmb(BOB_OMB_SPEC, state, situation, toward));
  return { state, explode };
};

describe('Bob-omb fuse (SmashWiki: stands up after a while, walks, flashes red, explodes; the held fuse)', () => {
  it('a grounded Bob-omb idles, walks toward the nearest fighter, stops flashing and explodes', () => {
    const { idleFrames, walkFrames, flashFrames } = BOB_OMB_SPEC;
    let r = run(BOB_OMB_INITIAL_STATE, 'grounded', idleFrames - 1, -1);
    expect(r.state.phase).toBe('idle');
    r = run(r.state, 'grounded', 1, -1);
    expect(r.state).toMatchObject({ phase: 'walking', direction: -1 });
    r = run(r.state, 'grounded', walkFrames);
    expect(r.state.phase).toBe('flashing');
    expect(bobOmbFlashing(BOB_OMB_SPEC, r.state)).toBe(true);
    r = run(r.state, 'grounded', flashFrames - 1);
    expect(r.explode).toBe(false);
    expect(run(r.state, 'grounded', 1).explode).toBe(true);
  });

  it('in flight nothing advances; held, the fuse flashes then explodes in the hand', () => {
    expect(run(BOB_OMB_INITIAL_STATE, 'airborne', 10_000)).toEqual({ state: BOB_OMB_INITIAL_STATE, explode: false });
    let r = run(BOB_OMB_INITIAL_STATE, 'held', BOB_OMB_SPEC.heldFuseFrames);
    expect(r.explode).toBe(false);
    expect(bobOmbFlashing(BOB_OMB_SPEC, r.state)).toBe(true);
    r = run(r.state, 'held', BOB_OMB_SPEC.flashFrames - 1);
    expect(r.explode).toBe(false);
    expect(run(r.state, 'held', 1).explode).toBe(true);
  });

  it('picking it up stops the walk; dropped again it idles first', () => {
    const walking = run(BOB_OMB_INITIAL_STATE, 'grounded', BOB_OMB_SPEC.idleFrames + 5).state;
    expect(walking.phase).toBe('walking');
    expect(run(walking, 'held', 1).state).toMatchObject({ phase: 'idle', phaseFrames: 0, heldFrames: 1 });
  });

  it('the fuse state lives on the item entity (replays re-derive it)', () => {
    const item = new ItemEntity(0, BOB_OMB_DEFINITION, 0, { x: 0, y: 0 });
    expect(item.getBobOmbState()).toEqual(BOB_OMB_INITIAL_STATE);
    item.setBobOmbState({ ...BOB_OMB_INITIAL_STATE, phase: 'walking' });
    expect(item.getBobOmbState()?.phase).toBe('walking');
    expect(item.definition.ttlFrames).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('Bob-omb explosion and thrown hits', () => {
  it('explosion: 25%, native launch 361 / KBG 90 / BKB 30, 12-unit radius, no 0.8x multiplier', () => {
    expect(BOB_OMB_EXPLOSION).toMatchObject({ damage: 25, radius: 60, hitlagMultiplier: .5,
      knockback: { base: 30, growth: 90, fixed: 0, angle: 361 } });
    const hit = itemExplosionHit(BOB_OMB_EXPLOSION, -1);
    expect(hit).toMatchObject({ damage: 25, facing: -1, direct: false });
    expect(hit.referenceKnockbackMultiplier).toBeUndefined();
  });

  it('thrown damage per throw kind (SmashWiki Ultimate column: 31.6 / 30.6 / 33.5), explosion launch, no 0.8x', () => {
    const v = { vx: 12, vy: -3 };
    const at = (action: Parameters<typeof thrownItemHit>[1]) => thrownItemHit(BOB_OMB_DEFINITION, action, v, 1, 1, true);
    expect(at('throw-ground-forward-ordinary').damage).toBe(31.6);
    expect(at('throw-ground-up-ordinary').damage).toBe(30.6);
    expect(at('dash-throw').damage).toBe(33.5);
    expect(at('throw-ground-forward-strong').damage).toBe(33.5);
    expect(at('throw-air-back-strong').damage).toBe(33.5);
    expect(at('throw-ground-forward-ordinary')).toMatchObject({ referenceKnockbackMultiplier: 1,
      knockback: { reference: { base: 30, growth: 90, angle: 361 } } });
    expect(at('throw-ground-forward-ordinary').slip).toBeUndefined();
  });

  it('thrown downward it meteors (ground and air, tilt and smash); other throws stay diagonal', () => {
    for (const action of ['throw-ground-down-ordinary', 'throw-ground-down-strong', 'throw-air-down-ordinary', 'throw-air-down-strong'] as const)
      expect(thrownItemHit(BOB_OMB_DEFINITION, action, { vx: 0, vy: 10 }, 1, 1, false).knockback.reference?.angle).toBe(270);
    expect(thrownItemHit(BOB_OMB_DEFINITION, 'throw-air-up-ordinary', { vx: 0, vy: -10 }, 1, 1, false).knockback.reference?.angle).toBe(361);
  });

  it('horizontal throw speed capped at 3 units / frame for DK and Pikachu (SmashWiki Item_throw)', () => {
    for (const profile of [FIGHTER_ITEM_PROFILES.donkeykong!, FIGHTER_ITEM_PROFILES.pikachu!]) {
      const strong = nativeItemReleaseVelocity(BOB_OMB_DEFINITION.throwProfile,
        itemReleaseVelocity(getItemActionPlan('throw-ground-forward-strong', profile), 1, profile));
      expect(strong.x).toBeCloseTo(15, 9);
      const dash = nativeItemReleaseVelocity(BOB_OMB_DEFINITION.throwProfile,
        itemReleaseVelocity(getItemActionPlan('dash-throw', profile), -1, profile));
      expect(dash.x).toBeCloseTo(-15, 9);
    }
  });
});

describe('Bob-omb vertical release limit (item_common bombhei outer_limit_speed_y 3)', () => {
  it('an up smash throw leaves at 3 units / frame at most; a Home-Run Bat has no limit', async () => {
    const { HOME_RUN_BAT_DEFINITION } = await import('./HomeRunBat');
    const dk = FIGHTER_ITEM_PROFILES.donkeykong!, plan = getItemActionPlan('throw-ground-up-strong', dk);
    expect(nativeItemReleaseVelocity(BOB_OMB_DEFINITION.throwProfile, itemReleaseVelocity(plan, 1, dk)).y).toBeCloseTo(-15, 9);
    expect(nativeItemReleaseVelocity(HOME_RUN_BAT_DEFINITION.throwProfile, itemReleaseVelocity(plan, 1, dk)).y).toBeLessThan(-15);
  });
});
