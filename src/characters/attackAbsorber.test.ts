/** Prepared for the single final verification. Supplied geometry/effect
 * fixtures do not assert a default-roster producer or native common parity. */
import {describe, expect, it} from 'vitest';
import {absorbedHealingAmount, activeAbsorber, parseAttackAbsorbWindow, sweepAttackAbsorber} from './attackAbsorber';

function fixture() {
  return {startFrame: 3, endFrame: 9, coordinateOrigin: 'actorSourceRoot',
    body: {offsetX: 4, offsetY: -20, width: 4, height: 4}, healingMultiplier: 1.6,
    sourceReceipt: 'explicit-absorber-source-fixture'};
}
const sweep = {origin: {x: 0, y: 0}, facing: 1 as const, from: {x: -10, y: -20}, to: {x: 10, y: -20},
  absorbable: true, projectile: {kind: 'circle' as const, radius: 1}};
describe('supplied attack energy absorber', () => {
  it('requires a real producer receipt, origin, finite geometry and explicit effect coefficient', () => {
    expect(parseAttackAbsorbWindow(fixture()).coordinateOrigin).toBe('actorSourceRoot');
    for (const bad of [{...fixture(), sourceReceipt: ''}, {...fixture(), coordinateOrigin: 'guess'},
      {...fixture(), healingMultiplier: NaN}, {...fixture(), healingMultiplier: -1},
      {...fixture(), body: undefined}, {...fixture(), body: {...fixture().body, width: 0}},
      {...fixture(), minimumHealing: 10, maximumHealing: 3}]) expect(() => parseAttackAbsorbWindow(bad)).toThrow();
  });
  it('uses the supplied half-open elapsed window even when it starts during startup', () => {
    const absorber = parseAttackAbsorbWindow(fixture());
    expect(activeAbsorber(null)).toBeNull();
    expect(activeAbsorber({move: {}, phase: 'active', framesElapsed: 5})).toBeNull();
    for (const framesElapsed of [3, 8]) expect(activeAbsorber({move: {absorber}, phase: 'startup', framesElapsed})).toBe(absorber);
    for (const framesElapsed of [2, 9, NaN]) expect(activeAbsorber({move: {absorber}, phase: 'active', framesElapsed})).toBeNull();
  });
  it('rejects nonabsorbable packets and selects actual posed fields rather than the receiving body', () => {
    const window = parseAttackAbsorbWindow(fixture());
    expect(sweepAttackAbsorber({...sweep, window, absorbable: false})).toBeNull();
    expect(sweepAttackAbsorber({...sweep, window})).toEqual({fraction: 0.55, region: 'body', index: 0});
    expect(sweepAttackAbsorber({...sweep, window, from: {x: -10, y: -10}, to: {x: 10, y: -10}})).toBeNull();
  });
  it('mirrors the local source field once and adds the provided root once', () => {
    const window = parseAttackAbsorbWindow(fixture());
    expect(sweepAttackAbsorber({...sweep, window, facing: -1})).toEqual({fraction: 0.15, region: 'body', index: 0});
    expect(sweepAttackAbsorber({...sweep, window, origin: {x: 100, y: 30},
      from: {x: 90, y: 10}, to: {x: 110, y: 10}})?.fraction).toBeCloseTo(0.55, 12);
  });
  it('sweeps full horizontal Beam capsules, including initial trailing overlap', () => {
    const window = parseAttackAbsorbWindow(fixture());
    const projectile = {kind: 'horizontal-capsule' as const, start: {x: -2, y: 0}, end: {x: 2, y: 0}, radius: 1};
    expect(sweepAttackAbsorber({...sweep, window, projectile})?.fraction).toBeCloseTo(0.45, 12);
    expect(sweepAttackAbsorber({...sweep, window, projectile, from: {x: 8, y: -20}, to: {x: 20, y: -20}})?.fraction).toBe(0);
    expect(() => sweepAttackAbsorber({...sweep, window, projectile: {...projectile, end: {x: 2, y: 1}}})).toThrow();
  });
  it('uses exact capsule fields and earliest union contact without broadphase-only corner hits', () => {
    const window = parseAttackAbsorbWindow({...fixture(), capsules: [
      {start: {x: -2, y: -22}, end: {x: -2, y: -18}, radius: 1}]});
    const contact = sweepAttackAbsorber({...sweep, window});
    expect(contact?.region).toBe('capsule');
    expect(contact?.fraction).toBeCloseTo(0.3, 12);
    const bodyOnly = parseAttackAbsorbWindow(fixture());
    expect(sweepAttackAbsorber({...sweep, window: bodyOnly,
      from: {x: 1.1, y: -22.9}, to: {x: 1.1, y: -22.9}})).toBeNull();
  });
  it('retains genuinely rectangular projectile geometry for an explicitly absorbable item packet', () => {
    const window = parseAttackAbsorbWindow({...fixture(), body: undefined,
      capsules: [{start: {x: 4, y: -20}, end: {x: 4, y: -20}, radius: 1}]});
    expect(sweepAttackAbsorber({...sweep, window, projectile: {kind: 'rectangle', width: 4, height: 2}})?.fraction)
      .toBeCloseTo(0.55, 12);
  });
  it('uses unstaled source power and only explicitly supplied healing bounds', () => {
    const window = parseAttackAbsorbWindow(fixture());
    expect(absorbedHealingAmount(window, 10)).toBe(16);
    expect(absorbedHealingAmount(parseAttackAbsorbWindow({...fixture(), maximumHealing: 12}), 10)).toBe(12);
    expect(absorbedHealingAmount(parseAttackAbsorbWindow({...fixture(), minimumHealing: 5}), 1)).toBe(5);
    expect(() => absorbedHealingAmount(window, Infinity)).toThrow();
    expect(() => absorbedHealingAmount({...window, maximumHealing: NaN}, 10)).toThrow();
  });
});
