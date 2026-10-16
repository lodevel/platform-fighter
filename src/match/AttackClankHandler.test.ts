import { describe, expect, it } from 'vitest';
import { AttackClankHandler, referenceClankResult } from './AttackClankHandler';
import { HITBOX_LABEL, type HitboxPlugin } from '../characters/attacks';
import type { HitboxOrCharacterBody } from './HitboxDamageHandler';
function sensor(owner: number, damage: number, setoff?: 'on' | 'off' | 'through', aerial = false): HitboxOrCharacterBody {
  const plugin: HitboxPlugin = { ownerId: 'pikachu', ownerBodyId: owner, moveId: 'pikachu.clank-source-probe',
    damage, knockback: { x: 0, y: 0, scaling: 0 }, facing: 1, setoff,
    attackKind: aerial ? 'aerial' : 'ground', hitbox: { offsetX: 0, offsetY: 0, width: 20, height: 20 },
    collisionHits: [{ id: 0, damage, setoff, capsule: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 10 } }] };
  return { id: owner + 1000, label: HITBOX_LABEL, position: { x: 0, y: 0 },
    bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 } }, plugin };
}
function fixture() {
  let frame = 10;
  const rebounds: Array<{ owner: number; freeze: number; total: number }> = [];
  const handler = new AttackClankHandler({ frame: () => frame, players: () => 2,
    damage: (plugin, row) => row?.damage ?? plugin.damage,
    rebound: (owner, freeze, total) => rebounds.push({ owner, freeze, total }) });
  return { handler, rebounds, nextFrame: () => { frame++; } };
}
describe('Ultimate direct-melee priority', () => {
  it('rebounds both at the9damage boundary, and caps stronger-hit rebound at58', () => {
    expect(referenceClankResult(6, 15)).toEqual({ cancelA: true, cancelB: true, reboundFrames: 35 });
    expect(referenceClankResult(6, 15.01)).toEqual({ cancelA: true, cancelB: false, reboundFrames: 35 });
    expect(referenceClankResult(80, 1).reboundFrames).toBe(58);
  });
  it('winner is blocked from the clanking opponent only on the contact frame', () => {
    const f = fixture(), a = sensor(1, 20, 'on'), b = sensor(2, 6, 'on');
    f.handler.sampleBodies([b, a]);
    expect(f.rebounds.map(r => r.owner)).toEqual([2]);
    expect(f.handler.canHit(a, 2)).toBe(false);
    expect(f.handler.canHit(a, 3)).toBe(true);
    expect(f.handler.canHit(b, 1)).toBe(false);
    f.nextFrame();
    expect(f.handler.canHit(a, 2)).toBe(true);
    expect(f.handler.canHit(b, 1)).toBe(false);
    f.handler.sampleBodies([a, b]); expect(f.rebounds).toHaveLength(1);
  });
  it('through never rebounds and blocks only the current strike against its clanking opponent', () => {
    const f = fixture(), a = sensor(1, 12, 'through'), b = sensor(2, 8, 'on');
    f.handler.sampleBodies([a, b]);
    expect(f.rebounds.map(r => r.owner)).toEqual([2]);
    f.nextFrame();
    expect(f.handler.canHit(a, 2)).toBe(false);
    expect(f.handler.canHit(a, 3)).toBe(true);
    expect(f.handler.canHit(sensor(1, 12, 'through'), 2)).toBe(true);
  });
  it('OFF, aerial/direct and legacy-only contacts retain normal damage paths', () => {
    for (const [a, b] of [[sensor(1, 6, 'off'), sensor(2, 6, 'on')],
      [sensor(1, 6, 'on', true), sensor(2, 6, 'on')], [sensor(1, 6), sensor(2, 6)]]) {
      const f = fixture(); f.handler.sampleBodies([a!, b!]);
      expect(f.rebounds).toHaveLength(0); expect(f.handler.canHit(a!, 2)).toBe(true);
    }
  });
  it('source per-row flag overrides a move summary, and electric rebound freeze uses each own attribute', () => {
    const f = fixture(), a = sensor(1, 10, 'on'), b = sensor(2, 10, 'on');
    (a.plugin as any).setoff = 'off';
    (a.plugin as any).collisionHits[0].electricCollision = true;
    f.handler.sampleBodies([a, b]);
    expect(f.rebounds).toHaveLength(2);
    expect(f.rebounds[0]!.total).toBe(f.rebounds[1]!.total);
    expect(f.rebounds[0]!.freeze).toBeGreaterThan(f.rebounds[1]!.freeze);
  });
});
