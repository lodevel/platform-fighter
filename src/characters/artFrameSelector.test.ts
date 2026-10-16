import { describe, expect, it, vi } from 'vitest';
import { DONKEYKONG_GRAB, DONKEYKONG_JAB, DONKEYKONG_SMASH } from './DonkeyKong';
import { createDodgeState } from './dodgeState';
import { createGrabState } from './grabState';
import { createLedgeHangState } from './ledgeHangState';
import type { AttackMoveWithAnimation } from './moveSchema';
import { PIKACHU_JAB } from './pikachuSourceMoves';
import { createShieldState } from './shieldState';
import { createSimulationSpriteAnimationDriver, type SimulationAnimationSnapshot } from './simulationSpriteAnimation';
import { type ArtCatalog, MANIFEST_ART_CATALOG, createArtFrameSelector } from './artFrameSelector';
import { finalBodyPose } from '../finalSmash/finalBodyPose';
import { characterAnimationSheets } from './spriteAnimationDriver';
import linkFrames from '../../assets/characters/link/frames.json';

type Id = 'donkeykong' | 'pikachu' | 'link';

/** Frame counts the game would register: every frame of each animation's texture (manifest). */
function counts(id: Id): Map<string, number> {
  return new Map(characterAnimationSheets(id).map((a) => [a.animKey, MANIFEST_ART_CATALOG.frameCount(a.animKey)]));
}

function snapshot(id: Id, patch: Partial<SimulationAnimationSnapshot> = {}): SimulationAnimationSnapshot {
  return {
    characterId: id, facing: 1, destroyed: false, activeAttack: null, pikachuSpecial: null,
    packedBody: { clock: null, committed: null, crouchPhase: null, turnBrake: null, itemCue: null, airDodgeDirection: { x: 0, y: 0 }, fastFall: false }, buriedPresentation: null,
    hitstunRemaining: 0, hitlagRemaining: 0, shield: createShieldState(),
    dodge: createDodgeState(), ledgeHang: createLedgeHangState(),
    chargingMove: null, chargeHeldFrames: 0, landingRecoveryRemaining: 0,
    frame: 0, frozen: false, grounded: true, velocityX: 0, velocityY: 0,
    crouching: false, jumpsquatRemaining: 0, grabbed: false,
    grab: createGrabState(), grabSpec: DONKEYKONG_GRAB,
    locomotion: { name: 'standing', facing: 1, framesElapsed: 0, dashFacing: 1 },
    jumpPresentation: null, throwPresentation: null, landingPresentation: null, grabPresentation: null, ordinaryPresentation: null, clankPresentation: null,
    turnBrakePresentation: null, groundRecoveryPresentation: null, auxiliaryAirPresentation: null, footstoolRecipientPresentation: null, respawnPresentation: null, itemPresentation: null, itemShooting: null, ledgeJumpPresentation: null, surfaceTechPresentation: null, grabReleasePresentation: null, crouchPresentation: null, reactionPresentation: null, shieldPresentation: null, capturePresentation: null, tauntPresentation: null, jumpsUsed: 0, helpless: false,
    shieldReleaseRemaining: 0, shieldStunRemaining: 0, shieldParrying: false, ledgeCatchFrames: 0, ledgeCatchMotionRates: [], ...patch,
  } as SimulationAnimationSnapshot;
}

const attack = (move: AttackMoveWithAnimation, framesElapsed: number) =>
  ({ move, framesElapsed, facing: 1, phase: 'startup', hitboxBody: null, chargeHeldFrames: 0 }) as SimulationAnimationSnapshot['activeAttack'];

/** A scripted life: idle, run, jump and fall, an attack with hitlag, a freeze, a rewind, hurt. */
function script(id: Id, jab: AttackMoveWithAnimation): SimulationAnimationSnapshot[] {
  const out: SimulationAnimationSnapshot[] = [];
  for (let f = 0; f < 140; f++) {
    let p: Partial<SimulationAnimationSnapshot> = { frame: f };
    if (f >= 20 && f < 40) p = { ...p, locomotion: { name: 'run', facing: 1, framesElapsed: f - 20, dashFacing: 1 }, velocityX: 6 };
    if (f >= 40 && f < 60) p = { ...p, grounded: false, velocityY: f < 50 ? -6 : 4, jumpsUsed: 1 };
    if (f >= 60 && f < 90) p = { ...p, activeAttack: attack(jab, f - 60), hitlagRemaining: f >= 70 && f < 74 ? 4 : 0 };
    if (f >= 90 && f < 96) p = { ...p, frozen: true };
    if (f >= 100 && f < 120) p = { ...p, hitstunRemaining: 20 - (f - 100) };
    out.push(snapshot(id, p));
  }
  // A rewind: back to frame 10 and forward again.
  for (let f = 10; f < 30; f++) out.push(snapshot(id, { frame: f }));
  return out;
}

/** The game's Phaser driver over a fake sprite and an animation manager with the same frame counts. */
function phaserDriver(catalog: Map<string, number>, feed: () => SimulationAnimationSnapshot) {
  const anims = { currentAnim: null as { key: string } | null, currentFrame: null as unknown, pause: vi.fn(), setCurrentFrame: vi.fn() };
  const sprite = { anims, play: vi.fn((key: string) => { anims.currentAnim = { key }; }) };
  const manager = {
    exists: (k: string) => (catalog.get(k) ?? 0) > 0,
    get: (k: string) => ({ key: k, frames: Array.from({ length: catalog.get(k) ?? 0 }, (_, index) => ({ index })) }),
  };
  return createSimulationSpriteAnimationDriver(feed, sprite as unknown as SimulationSpriteSurface, manager as unknown as SimulationAnimationCatalog);
}

describe('createArtFrameSelector', () => {
  it.each([
    ['donkeykong', DONKEYKONG_JAB],
    ['donkeykong', DONKEYKONG_SMASH],
    ['pikachu', PIKACHU_JAB],
  ] as const)('picks exactly the Phaser driver\'s drawing for %s', (id, move) => {
    const catalog = counts(id);
    const art: ArtCatalog = { frameCount: (k) => catalog.get(k) ?? 0 };
    const selector = createArtFrameSelector(art);
    let current = snapshot(id);
    const driver = phaserDriver(catalog, () => current);
    const states = new Set<string>();
    for (const s of script(id, move)) {
      current = s;
      const expected = driver.tick(), got = selector.select(s);
      expect(got).toEqual(expected);
      if (got) states.add(got.state);
    }
    // The script really crosses several actions, running included.
    expect(states.size).toBeGreaterThanOrEqual(4);
    expect([...states].some((st) => /run/.test(st)), [...states].join(', ')).toBe(true);
  });

  it('lists the animations the game registers, with real sheets for the kept fighters', () => {
    for (const id of ['donkeykong', 'pikachu'] as const) {
      const sheets = characterAnimationSheets(id);
      expect(sheets.find((a) => a.sheet === 'idle')?.animKey).toBe(`${id}.idle.anim`);
      expect([...counts(id).values()].filter((n) => n > 0).length).toBeGreaterThan(5);
    }
  });
});

import type {SimulationSpriteSurface,SimulationAnimationCatalog} from './simulationSpriteAnimation';

// Regression for the actual browser defect: owner profiles existed and made
// contact, but the fixed Pikachu animation registry kept rendering idle.
describe('installed Final owner art through the production manifest catalog', () => {
  for (const sheet of ['final', 'final_air', 'final_dash', 'final_dash_end', 'final_air_dash_end', 'final2', 'final_air2']) {
    it(`selects the actual Pikachu ${sheet} native body drawing`, () => {
      const drawing = finalBodyPose('pikachu', sheet, 3)!;
      expect(drawing).not.toBeNull();
      const selector = createArtFrameSelector(MANIFEST_ART_CATALOG);
      const state = snapshot('pikachu', { finalSmash: { runId: 1, role: 'owner', phase: 'startup', sheet, age: 3, facing: -1, intangible: true, noDead: true, terrainBypass: false, jostle: false, gravityDisabled: true, velocity: { x: 0, y: 0 } } });
      expect(selector.select(state)).toMatchObject({ key: `pikachu.${sheet}.anim`, frameIndex: drawing.index, facing: -1 });
    });
  }
});


describe('Link Final same native motion presentation', () => {
  for (const sheet of ['final', 'final_air'] as const) for (const nativeFrame of [58, 59]) {
    it(`selects retained ${sheet} sample at raw native sample ${nativeFrame} without inventing paired geometry`, () => {
      expect(finalBodyPose('link', sheet, nativeFrame)).toBeNull();
      const selector = createArtFrameSelector(MANIFEST_ART_CATALOG);
      const state = snapshot('link', { finalSmash: { runId: 1, role: 'owner', phase: 'ancient-bow', sheet, age: nativeFrame, facing: -1, intangible: true, noDead: false, terrainBypass: false, jostle: false, gravityDisabled: false, velocity: { x: 0, y: 0 } } });
      const nativeSheet = sheet === 'final' ? 'd04final' : 'd04finalair';
      const selected = selector.select(state)!;
      expect(selected).toMatchObject({ key: `link.${nativeSheet}.anim`, facing: -1 });
      expect(linkFrames.animations[nativeSheet].nativeSampleIndices[selected.frameIndex]).toBe(nativeFrame + 1);
    });
  }
});
