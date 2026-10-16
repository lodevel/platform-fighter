/** Analytical strategy fixtures prepared for final-stage execution only. */
import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../characters/Character';
import { smashBallSurfaceCpuInput as decide, smashBallCpuJumpProofLanding as landing,
  smashBallCpuSurfaceGeometryIdentity as surfaceIdentity,
  type SmashBallSurfaceCpuContext, type SmashBallCpuJumpProof } from './smashBallSurfaceCpuPolicy';
const base: CharacterInput = { moveX: -1, moveY: -1, jump: true, special: true };
function context(): SmashBallSurfaceCpuContext {
  return { frame: 10, actor: { playerIndex: 0, generation: 3, position: { x: 0, y: -20 }, sourceRoot: { x: 0, y: 0 },
    feetY: 0, halfWidth: 10, velocity: { x: 0, y: 0 }, facing: 1, grounded: true, mayJump: true, mayAttack: true },
    surfaces: [{ id: 1, minX: -50, maxX: 50, topY: 0 }], supportBodyId: 1,
    ball: { position: { x: 100, y: -32 }, radius: 10, variant: 'ordinary', active: true },
    eligible: true, availableResource: null, activeFinal: false, previousAttackHeld: false,
    attackContactRange: { minX: 0, maxX: 15, minY: -30, maxY: 0 } };
}
function liveContext(): SmashBallSurfaceCpuContext {
  const c = context(); return { ...c, actor: { ...c.actor, currentNeutralAttackIdentity: 'fixture-neutral-v1', hasHeldItem: false,
    currentKineticIdentity: { selectedKineticConsumer: 'analytical-fixture-not-gameplay-parity', tuningIdentity: 'analytical-case' } },
    attackContactProvenance: { moveIdentity: 'fixture-neutral-v1', generation: 3, frame: 10,
      actorPosition: c.actor.position, sourceRoot: c.actor.sourceRoot, facing: 1,
      intent: 'neutral-ground-light', heldItemRoute: 'unarmed', previewKind: 'first-active' } };
}
function movedContext(c: SmashBallSurfaceCpuContext, x: number): SmashBallSurfaceCpuContext {
  const actor = { ...c.actor, position: { x, y: -20 }, sourceRoot: { x, y: 0 } };
  const dx = x - c.actor.position.x;
  return { ...c, actor, attackContactRange: c.attackContactRange ? { ...c.attackContactRange,
    minX: c.attackContactRange.minX + dx, maxX: c.attackContactRange.maxX + dx } : null,
    attackContactProvenance: { ...c.attackContactProvenance!, actorPosition: actor.position, sourceRoot: actor.sourceRoot } };
}
function proof(surfaces = [...liveContext().surfaces, { id: 2, minX: 60, maxX: 140, topY: 0 }]): SmashBallCpuJumpProof {
  return { actorGeneration: 3, fromSurfaceId: 1, toSurfaceId: 2,
    selectedKineticConsumer: 'analytical-fixture-not-gameplay-parity', tuningIdentity: 'analytical-case',
    halfWidth: 10, surfaceGeometryIdentity: surfaceIdentity(surfaces)!,
    origin: { x: 0, feetY: 0 }, moveX: 1, completeTerrainSweep: true,
    samples: [
      { frame: 0, x: 0, feetY: 0, velocityX: 0, velocityY: 0 },
      { frame: 1, x: 25, feetY: -40, velocityX: 25, velocityY: -40 },
      { frame: 2, x: 50, feetY: -60, velocityX: 25, velocityY: -20 },
      { frame: 3, x: 75, feetY: -40, velocityX: 25, velocityY: 20 },
      { frame: 4, x: 100, feetY: 0, velocityX: 25, velocityY: 40 },
    ] };
}
describe('safe current-surface SmashBall strategy preparation', () => {
  it('preserves base airborne recovery and absent real support', () => {
    const c = liveContext();
    expect(decide(base, { ...c, actor: { ...c.actor, grounded: false } }).input).toBe(base);
    expect(decide(base, { ...c, supportBodyId: null }).input).toBe(base);
  });
  it('defers to acquired resource/active Final and missing actual paired attack range', () => {
    const c = liveContext();
    expect(decide(base, { ...c, availableResource: 'meter' }).input).toBe(base);
    expect(decide(base, { ...c, activeFinal: true }).input).toBe(base);
    expect(decide(base, { ...c, attackContactRange: null }).input).toBe(base);
  });
  it('never chases an off-surface Ball by jumping without an executable proof', () => {
    const c = liveContext();
    expect(decide(base, c)).toMatchObject({ strategy: 'pursue-current-surface', surfaceId: 1,
      input: { moveX: 1, jump: false, special: false, dropThrough: false } });
    expect(decide(base, movedContext(c, 40)))
      .toMatchObject({ strategy: 'wait-at-safe-edge', input: { moveX: 0, jump: false } });
  });
  it('reverses actual outward momentum using a supplied stopping preview', () => {
    const c = movedContext(liveContext(), 30);
    expect(decide(base, { ...c, actor: { ...c.actor, velocity: { x: 4, y: 0 }, stoppingDistanceWorld: 12 } }))
      .toMatchObject({ strategy: 'brake-safe-surface', input: { moveX: -1, jump: false } });
  });
  it('uses actual registered contact bounds and fresh attack edges', () => {
    const c = liveContext(); const ball = { ...c.ball!, position: { x: 20, y: -20 } };
    expect(decide(base, { ...c, ball })).toMatchObject({ strategy: 'attack-ball', input: { attack: true, moveX: 0 } });
    expect(decide(base, { ...c, ball, previousAttackHeld: true }))
      .toMatchObject({ strategy: 'release-attack', input: { attack: false } });
    expect(decide(base, { ...c, ball: { ...ball, position: { x: 20, y: -60 } } }).strategy).not.toBe('attack-ball');
  });
  it('requires actual generation/origin and first safe descending support landing', () => {
    const c = liveContext(), target = { id: 2, minX: 60, maxX: 140, topY: 0 }, surfaces = [...c.surfaces, target];
    expect(landing(proof(), c.actor, surfaces, 1)).toEqual({ surfaceId: 2, x: 100 });
    expect(landing({ ...proof(), actorGeneration: 2 }, c.actor, surfaces, 1)).toBeNull();
    expect(landing({ ...proof(), origin: { x: 1, feetY: 0 } }, c.actor, surfaces, 1)).toBeNull();
    const earlier = [...surfaces, { id: 3, minX: 40, maxX: 70, topY: -50 }];
    expect(landing(proof(earlier), c.actor, earlier, 1)).toBeNull();
    const narrow = [c.surfaces[0]!, { ...target, minX: 98, maxX: 102 }];
    expect(landing(proof(narrow), c.actor, narrow, 1)).toBeNull();
  });
  it('starts a proved improving adjacent jump only when a real executor exists', () => {
    const c = liveContext(); const supplied = { ...c, surfaces: [...c.surfaces, { id: 2, minX: 60, maxX: 140, topY: 0 }], jumpProofs: [proof()] };
    expect(decide(base, supplied).strategy).not.toBe('jump-proved-surface');
    expect(decide(base, { ...supplied, canExecuteJumpProof: true }))
      .toMatchObject({ strategy: 'jump-proved-surface', surfaceId: 2, input: { jump: true, moveX: 1 } });
  });
  it('rejects cached proofs after real tuning, initial velocity, hull or surface changes', () => {
    const c = liveContext(), p = proof(), surfaces = [...c.surfaces, { id: 2, minX: 60, maxX: 140, topY: 0 }];
    expect(landing(p, { ...c.actor, currentKineticIdentity: { ...c.actor.currentKineticIdentity!, tuningIdentity: 'edited' } }, surfaces, 1)).toBeNull();
    expect(landing(p, { ...c.actor, currentKineticIdentity: undefined }, surfaces, 1)).toBeNull();
    expect(landing(p, { ...c.actor, velocity: { x: 1, y: 0 } }, surfaces, 1)).toBeNull();
    expect(landing(p, { ...c.actor, velocity: { x: 0, y: -1 } }, surfaces, 1)).toBeNull();
    expect(landing(p, { ...c.actor, halfWidth: 11 }, surfaces, 1)).toBeNull();
    expect(landing(p, c.actor, [surfaces[0]!, { ...surfaces[1]!, topY: 1 }], 1)).toBeNull();
  });
  it('rejects stale/other-intent preview receipts and held-item attack routing', () => {
    const c = liveContext(), ball = { ...c.ball!, position: { x: 20, y: -20 } };
    expect(decide(base, { ...c, ball, attackContactProvenance: null }).input).toBe(base);
    for (const change of [{ frame: 9 }, { facing: -1 as const }, { moveIdentity: 'other-move' },
      { actorPosition: { x: 1, y: -20 } }, { sourceRoot: { x: 0, y: 1 } }])
      expect(decide(base, { ...c, ball, attackContactProvenance: { ...c.attackContactProvenance!, ...change } }).input).toBe(base);
    expect(decide(base, { ...c, ball, actor: { ...c.actor, hasHeldItem: true } }).input).toBe(base);
  });
  it('pursues an actual ahead-only envelope goal rather than waiting in its empty near-body gap', () => {
    const c = { ...liveContext(), ball: { position: { x: 0, y: -20 }, radius: 10,
      variant: 'ordinary' as const, active: true }, attackContactRange: { minX: 24, maxX: 40, minY: -30, maxY: 0 } };
    expect(decide(base, c)).toMatchObject({ strategy: 'pursue-current-surface', input: { moveX: -1, attack: false } });
    // This pure preview explicitly retains RIGHT-facing geometry at relocation.
    // Real input turning/preview refresh is a separate final Scene case.
    expect(decide(base, movedContext(c, -32))).toMatchObject({ strategy: 'attack-ball', input: { attack: true } });
  });
  it('clamps an unreachable contact-envelope goal to the full-hull edge without jumping off', () => {
    const c = { ...liveContext(), ball: { position: { x: -80, y: -20 }, radius: 10,
      variant: 'ordinary' as const, active: true }, attackContactRange: { minX: 24, maxX: 40, minY: -30, maxY: 0 } };
    expect(decide(base, c)).toMatchObject({ strategy: 'pursue-current-surface', input: { moveX: -1, jump: false } });
    expect(decide(base, movedContext(c, -40))).toMatchObject({ strategy: 'wait-at-safe-edge', input: { moveX: 0, attack: false, jump: false } });
  });
});
