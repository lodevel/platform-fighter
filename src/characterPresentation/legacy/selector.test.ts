import { describe, expect, it } from 'vitest';
import { createArtFrameSelector, MANIFEST_ART_CATALOG } from '../../characters/artFrameSelector';
import type { SimulationAnimationSnapshot } from '../../characters/simulationSpriteAnimation';
import { animationSnapshot as snapshot } from '../../characters/testing/animationSnapshot';
import type { FighterView } from '../../sim/view';
import { createLegacyArtSelector } from './selector';
import {
  createLegacyAppearanceBridge, createLegacyFlightAppearanceRequest, createLegacyPreviewAppearanceRequest,
  createLegacySnapshotAppearanceRequest, readLegacyAnimation, readLegacyFlight,
} from './bridge';
import { createLegacyPresentationRegistry, legacyPresentationProfile } from './profiles';

function fighter(animation: SimulationAnimationSnapshot): FighterView {
  return { playerIndex: 0, characterId: animation.characterId, paletteIndex: 2, position: { x: 100, y: 220 },
    facing: animation.facing, animation, invincible: false, eliminated: false, body: { width: 40, height: 80 }, chargeProgress: null, shield: null };
}

describe('legacy appearance bridge', () => {
  it.each(['donkeykong', 'pikachu', 'link'] as const)('preserves the production selector for %s through ticks, freeze, hitlag and rewind', id => {
    const original = createArtFrameSelector(MANIFEST_ART_CATALOG), wrapped = createLegacyArtSelector();
    const states: SimulationAnimationSnapshot[] = [];
    for (let tick = 0; tick < 90; tick++) {
      const state = snapshot(id, { frame: tick, facing: tick > 40 ? -1 : 1,
        frozen: tick >= 20 && tick < 25, hitlagRemaining: tick >= 40 && tick < 44 ? 3 : 0,
        locomotion: { name: tick >= 50 ? 'run' : 'standing', facing: 1, framesElapsed: Math.max(0, tick - 50), dashFacing: 1 }, velocityX: tick >= 50 ? 5 : 0 });
      states.push(state, state); // repeated render of one authoritative tick
    }
    states.push(snapshot(id, { frame: 0 }), snapshot(id, { frame: 10 }));
    for (const state of states) {
      const request = createLegacySnapshotAppearanceRequest(state, { position: { x: 10, y: 20 }, actorId: 'test' });
      expect(wrapped.select(request)).toEqual(original.select(state));
      expect(readLegacyAnimation(request)).toBe(state);
    }
  });

  it('keeps native Final age and private legacy context without serializing the snapshot', () => {
    const state = snapshot('link', { frame: 1000, finalSmash: { runId: 3, role: 'owner', phase: 'ancient-bow', sheet: 'final',
      age: 58, facing: -1, intangible: true, noDead: false, terrainBypass: false, jostle: false, gravityDisabled: false, velocity: { x: 0, y: 0 } } });
    const request = createLegacySnapshotAppearanceRequest(state, { actorId: 'link-1', position: { x: 30, y: 60 } });
    expect(request.action).toMatchObject({ id: 'final', phase: 'ancient-bow', clock: { tick: 1000, age: 58, domain: 'action-age' } });
    expect(JSON.stringify(request)).not.toMatch(/packedBody|finalSmash|frameIndex|sheet/);
    expect(createLegacyArtSelector().select(request)).toEqual(createArtFrameSelector(MANIFEST_ART_CATALOG).select(state));
  });

  it('tracks an action instance across hitlag and creates another on semantic changes and restore', () => {
    const bridge = createLegacyAppearanceBridge();
    const first = bridge.match(fighter(snapshot('pikachu')));
    const held = bridge.match(fighter(snapshot('pikachu', { frame: 5, hitlagRemaining: 2 })));
    expect(held.action.instanceId).toBe(first.action.instanceId);
    const running = bridge.match(fighter(snapshot('pikachu', { frame: 6, velocityX: 5,
      locomotion: { name: 'run', facing: 1, framesElapsed: 0, dashFacing: 1 } })));
    expect(running.action.instanceId).not.toBe(first.action.instanceId);
    const restored = bridge.match(fighter(snapshot('pikachu')), { restoreGeneration: 1 });
    expect(restored.action.instanceId).not.toBe(first.action.instanceId);
  });

  it('carries authoritative roots and sockets while retaining private snapshot identity', () => {
    const state = snapshot('pikachu', { frame: 20, facing: -1 });
    const sourceRoot = { x: 100, y: 260 }, socket = { x: 83, y: 210 };
    const actor: FighterView = { ...fighter(state), sourceRoot,
      poseAttachments: [{ id: 'hand', space: 'world', position: socket, rotation: .5 }], equipment: ['starRod'] };
    const request = createLegacyAppearanceBridge().match(actor);
    expect(request.transform).toMatchObject({ position: actor.position, root: sourceRoot, facing: -1 });
    expect(request.attachments).toEqual(actor.poseAttachments);
    expect(request.equipment).toEqual(['starRod']);
    expect(readLegacyAnimation(request)).toBe(state);
    expect(JSON.stringify(request)).not.toMatch(/packedBody|finalSmash|frameIndex|sheet/);
    expect(createLegacyArtSelector().select(request)).toEqual(createArtFrameSelector(MANIFEST_ART_CATALOG).select(state));
    // The neutral request is a value snapshot, not a new reference into mutable actors.
    sourceRoot.y = 999; socket.x = 999;
    expect(request.transform.root).toEqual({ x: 100, y: 260 });
    expect(request.attachments[0]!.position).toEqual({ x: 83, y: 210 });
  });

  it('uses explicit production profiles and leaves preview/flight metadata behind the legacy boundary', () => {
    const request = createLegacyPreviewAppearanceRequest({ characterId: 'link', action: 'tumble', age: 18,
      position: { x: 20, y: 30 }, facing: -1, zoom: .4, paletteIndex: 2 });
    expect(request.profile).toEqual({ id: legacyPresentationProfile('link').id, revision: legacyPresentationProfile('link').revision });
    expect(createLegacyPresentationRegistry().resolve(request)[0]).toMatchObject({ capability: 'legacy-sprite', resources: ['fighter:link'] });
    expect(readLegacyAnimation(request)).toBeUndefined();
    const flight = { playerIndex: 0, characterId: 'link' as const, paletteIndex: 2, sourceRoot: { x: 20, y: 30 }, facing: -1 as const,
      age: 18, duration: 100, scale: .4, rotation: 1.5, alpha: .8 };
    const flightRequest = createLegacyFlightAppearanceRequest(flight);
    expect(readLegacyFlight(flightRequest)).toBe(flight);
    expect(flightRequest.transform).toMatchObject({ root: flight.sourceRoot, rotation: 1.5, scale: { x: .4, y: .4 } });
    expect(flightRequest.order).toBe(15);
    expect(() => createLegacyPreviewAppearanceRequest({ characterId: 'unregistered', position: { x: 0, y: 0 } })).toThrow('No legacy presentation profile');
  });

  it('resets only its instance state and disposes idempotently', () => {
    const selector = createLegacyArtSelector(), state = snapshot('pikachu', { frame: 20 });
    const request = createLegacySnapshotAppearanceRequest(state, { position: { x: 0, y: 0 } });
    selector.select(request);
    selector.reset();
    expect(selector.current()).toBeNull();
    expect(selector.select(request)).toEqual(createArtFrameSelector(MANIFEST_ART_CATALOG).select(state));
    selector.dispose(); selector.dispose();
    expect(selector.current()).toBeNull();
    expect(() => selector.select(request)).toThrow('disposed');
  });
});
