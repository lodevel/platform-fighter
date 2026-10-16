import { describe, expect, it } from 'vitest';
import type { FighterView, SimView, ExplosionView } from '../../../../src/sim/view';
import { linkFinalCharge, LinkFinalPresentation } from './linkFinal';

const fighter = (age: number, facing: 1 | -1 = 1, air = false, runId = 4) => ({
  playerIndex: 0, characterId: 'link', eliminated: false, position: { x: 500, y: 400 }, facing,
  animation: { finalSmash: { runId, role: 'owner', sheet: air ? 'final_air' : 'final', age, facing } },
}) as FighterView;
const arrow = (x: number, phase: ExplosionView['phase'] = 'fly'): ExplosionView => ({
  id: 100004, x, y: 388, radius: 25, progress: 0, visualRecipe: 'ancient-arrow', phase, facing: 1,
});
const view = (frame: number, explosions: ExplosionView[], runId = 4) => ({
  frame, fighters: [fighter(60, 1, false, runId)], explosions,
}) as unknown as SimView;

describe('Link Final presentation independently of gameplay tracks', () => {
  it.each([false, true])('keeps the held arrow visible through59, releases at60 and removes the flare at63 (air=%s)', air => {
    for (const age of [0, 24, 34, 35, 55, 59]) expect(linkFinalCharge(fighter(age, 1, air))?.sprite?.key).toBe('char.link.fx__link_ancientbowarrow');
    expect(linkFinalCharge(fighter(60, 1, air))).toMatchObject({ release: true, sprite: null });
    expect(linkFinalCharge(fighter(62, 1, air))?.strength).toBeCloseTo(1 / 3);
    expect(linkFinalCharge(fighter(63, 1, air))).toBeNull();
  });

  it.each([0, 16, 24, 35, 55, 59, 60])('mirrors both projected anchors and the arrow around the actor at age%s', age => {
    const right = linkFinalCharge(fighter(age))!, left = linkFinalCharge(fighter(age, -1))!;
    for (const point of ['nock', 'bow', 'tip'] as const) {
      expect(left[point].x).toBeCloseTo(1000 - right[point].x);
      expect(left[point].y).toBeCloseTo(right[point].y);
    }
    if (right.sprite && left.sprite) {
      expect(left.sprite.x).toBeCloseTo(1000 - right.sprite.x);
      expect(left.sprite.rotation).toBeCloseTo(-right.sprite.rotation!);
      expect(left.sprite.flipX).toBe(true);
    }
  });

  it('uses actual article travel, including the clamped collision endpoint, without replaying on redraw', () => {
    const effect = new LinkFinalPresentation();
    expect(effect.update(view(60, [arrow(594)]))).toEqual([]);
    const travel = effect.update(view(61, [arrow(894)]));
    expect(travel).toEqual([{ id: 100004, from: { x: 594, y: 388 }, to: { x: 894, y: 388 } }]);
    expect(effect.update(view(61, [arrow(894)]))).toBe(travel);
    expect(effect.update(view(62, [arrow(980, 'fighter-blast')]))).toEqual([{ id: 100004, from: { x: 894, y: 388 }, to: { x: 980, y: 388 } }]);
    expect(effect.update(view(63, [arrow(980, 'fighter-blast')]))).toEqual([]);
  });

  it('clears trails on rewind, replacement owner/run and article absence', () => {
    const effect = new LinkFinalPresentation(); effect.update(view(60, [arrow(594)]));
    expect(effect.update(view(61, [arrow(894)], 5))).toEqual([]);
    expect(effect.update(view(59, [arrow(394)], 5))).toEqual([]);
    effect.update(view(60, []));
    expect(effect.update(view(61, [arrow(894)]))).toEqual([]);
  });

  it('does not create a charge cue for captured, eliminated or other fighters and leaves input snapshots untouched', () => {
    const original = fighter(35), before = JSON.stringify(original); linkFinalCharge(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(linkFinalCharge({ ...original, eliminated: true })).toBeNull();
    expect(linkFinalCharge({ ...original, characterId: 'pikachu' })).toBeNull();
    expect(linkFinalCharge({ ...original, animation: { ...original.animation, finalSmash: { ...original.animation.finalSmash!, role: 'captured' } } })).toBeNull();
  });
});
