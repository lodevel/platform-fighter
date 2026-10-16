import { describe, expect, it } from 'vitest';
import { HitboxDamageHandler, type HitboxOrCharacterBody } from './HitboxDamageHandler';
import { HITBOX_LABEL, type HitboxPlugin } from '../characters/attacks';
import { CHARACTER_LABEL } from '../characters/Character';
import { LINK_TILT, LINK_UAIR } from '../characters/Link';
import { computeKnockback, computeRageMultiplier, computeStaleMultiplier, scaleKnockbackSpec,
  type HitInfo } from '../characters/combat';

function deliver(targetX: number, facing: 1 | -1, positional: boolean, sweetSpot = false,
  spotKnockback?: HitInfo['knockback'], groundedKnockback?: HitInfo['knockback']) {
  const hits: HitInfo[] = [];
  const handler = new HitboxDamageHandler((_index, hit) => { hits.push(hit); });
  handler.setGroundedLookup(() => groundedKnockback !== undefined);
  const hitbox = { offsetX: 10, offsetY: 0, width: 100, height: 100 };
  const plugin: HitboxPlugin = { ownerId: 'link', ownerBodyId: 1, moveId: LINK_UAIR.id,
    damage: 15, knockback: LINK_UAIR.knockback, facing, hitbox, launchAwayFromSource: positional,
    ...(groundedKnockback ? { groundedKnockback } : {}),
    ...(sweetSpot ? { sweetSpot: { hitbox, damageMultiplier: 1.5, knockbackMultiplier: 2,
      ...(spotKnockback ? { knockback: spotKnockback } : {}) } } : {}) };
  const sensor: HitboxOrCharacterBody = { id: 2, label: HITBOX_LABEL, plugin,
    position: { x: 100 + 10 * facing, y: 0 },
    bounds: { min: { x: 50, y: -50 }, max: { x: 150, y: 50 } } };
  const target: HitboxOrCharacterBody = { id: 3, label: CHARACTER_LABEL, plugin: { characterId: 'link' },
    position: { x: targetX, y: 0 }, bounds: { min: { x: targetX - 5, y: -5 }, max: { x: targetX + 5, y: 5 } } };
  handler.registerPlayer(0, target);
  handler.handleCollisionStart({ pairs: [{ bodyA: sensor, bodyB: target }] });
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

describe('reference launch delivery', () => {
  it.each([
    { x: 80, facing: 1 as const, expected: -1 },
    { x: 120, facing: -1 as const, expected: 1 },
    { x: 100, facing: -1 as const, expected: -1 },
  ])('up air resolves position relative to the source ($x, facing $facing)', ({ x, facing, expected }) => {
    const hit = deliver(x, facing, true);
    expect(hit.facing).toBe(expected);
    expect(Math.sign(computeKnockback(hit, 115, 12, { referenceWeight: 104 }).vector.x)).toBe(expected);
  });

  it('ordinary attacks retain facing-based launch', () => {
    expect(deliver(80, 1, false).facing).toBe(1);
  });

  it('sweet-spot damage and launch modifiers reach the reference calculation', () => {
    const hit = deliver(120, 1, true, true);
    expect(hit.damage).toBe(22.5);
    const actual = computeKnockback(hit, 122.5, 12, { referenceWeight: 104 });
    const unscaled = computeKnockback({ ...hit, knockback: LINK_UAIR.knockback }, 122.5, 12, { referenceWeight: 104 });
    expect(actual.referenceKnockback).toBeCloseTo(unscaled.referenceKnockback! * 2, 10);
  });

  it.each([false, true])('selects a distinct tip launch before scaling, including grounded=%s', grounded => {
    const tip = { x: 4, y: -1.4, scaling: 0.4, reference: { base: 30, growth: 100, angle: 361 } };
    const hit = deliver(120, -1, false, true, tip, grounded ? LINK_TILT.knockback : undefined);
    expect(hit).toMatchObject({ damage: 22.5, facing: -1, sweetSpot: true,
      knockback: { reference: { base: 60, growth: 200, angle: 361 } } });
    expect(tip.reference).toEqual({ base: 30, growth: 100, angle: 361 });
  });

  it('a parent-only contact keeps its ordinary launch and damage', () => {
    const tip = { x: 4, y: -1.4, scaling: 0.4, reference: { base: 30, growth: 100, angle: 361 } };
    const hit = deliver(54, 1, false, true, tip);
    expect(hit.damage).toBe(15);
    expect(hit.knockback).toEqual(LINK_UAIR.knockback);
    expect(hit.sweetSpot).toBeUndefined();
  });

  it.each([0, 1, 9])('preserves project rage/stale policy for reference attacks (stale %i)', occurrences => {
    const stale = computeStaleMultiplier(occurrences);
    const factor = computeRageMultiplier(150) * stale;
    const hit: HitInfo = { damage: LINK_TILT.damage * stale, knockback: LINK_TILT.knockback, facing: 1 };
    const normal = computeKnockback(hit, 100 + hit.damage, 12, { referenceWeight: 104 });
    const modified = computeKnockback({ ...hit, knockback: scaleKnockbackSpec(hit.knockback, factor) },
      100 + hit.damage, 12, { referenceWeight: 104 });
    expect(modified.referenceKnockback).toBeCloseTo(normal.referenceKnockback! * factor, 10);
    expect(modified.hitstunFrames).toBe(Math.floor(modified.referenceKnockback! * 0.4) - 1);
  });
});
