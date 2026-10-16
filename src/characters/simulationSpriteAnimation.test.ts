import { describe, expect, it, vi } from 'vitest';
import { LINK_JAB as LIVE_JAB, LINK_SMASH as LIVE_SMASH, LINK_FAIR, LINK_BAIR, LINK_UAIR, LINK_DAIR, LINK_GRAB } from './Link';
import type { AttackMoveWithAnimation } from './moveSchema';
import { createShieldState } from './shieldState';
import { createDodgeState } from './dodgeState';
import { createLedgeHangState } from './ledgeHangState';
import { createGrabState } from './grabState';
import { getPikachuReviewedStateClock } from './pikachuPresentation';
import {selectPikachuReviewedStateReceiving} from './pikachuStatePresentation';
import { createSimulationSpriteAnimationDriver, resolveSimulationAction, selectSimulationAttackFrame, type SimulationAnimationSnapshot } from './simulationSpriteAnimation';

// These clock tests drive the generic (classifier) sprite path with a fake catalog; Link stands in for a fighter
// without packed art: its packed-body profile is replaced by an empty one that falls through to that path, and the
// harness catalog alone decides which of its sheets are loaded.
vi.mock('./linkPackedBodyProfile', () => ({ LINK_SHEET_ALIASES: {}, LINK_BODY_PROFILE: { id: 'link', label: 'Link',
  clips: {}, sheetAliases: {}, missingSheet: 'generic', bodyCentreFromRootY: -36, specialLandingSheet: () => 'fall_special' } }));
vi.mock('./spriteAnimationDriver', async importOriginal => {
  const real = await importOriginal<typeof import('./spriteAnimationDriver')>();
  return { ...real,
    getMoveAnimKey: (id: string, sheet: string | null) => sheet ? `${id}.${sheet}.anim` : null,
    getSpriteAnimationKey: (id: string, state: Parameters<typeof real.collapseStateToSheet>[0]) => `${id}.${real.collapseStateToSheet(state)}.anim` };
});

// Controlled legacy timelines keep clock tests independent of roster balance.
const LINK_JAB = { ...LIVE_JAB, startupFrames: 4, activeFrames: 3, recoveryFrames: 9,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 }, hitWindows: undefined };
const LINK_SMASH = { ...LIVE_SMASH, startupFrames: 14, activeFrames: 4, recoveryFrames: 19, hitWindows: undefined };
const TWO_SWINGS: AttackMoveWithAnimation = {
  ...LINK_JAB, id: 'link.smash', type: 'smash', startupFrames: 4, activeFrames: 10, recoveryFrames: 6,
  hitWindows: [{ startFrame: 4, endFrame: 6 }, { startFrame: 12, endFrame: 14, facing: -1 }],
};

function snapshot(patch: Partial<SimulationAnimationSnapshot> = {}): SimulationAnimationSnapshot {
  return {
    characterId: 'link', assetCharacterId: 'link', facing: 1, destroyed: false, activeAttack: null, pikachuSpecial: null,
    finalVictimSelection:null,finalVictimPose:null,finalSmash:null,packedBody:{clock:null,committed:null,crouchPhase:null,turnBrake:null,itemCue:null,airDodgeDirection:{x:0,y:0},fastFall:false},buriedPresentation:null,
    hitstunRemaining: 0, hitlagRemaining: 0, shield: createShieldState(),
    dodge: createDodgeState(), ledgeHang: createLedgeHangState(),
    chargingMove: null, chargeHeldFrames: 0, landingRecoveryRemaining: 0,
    frame: 0, frozen: false, grounded: true, velocityX: 0, velocityY: 0,
    crouching: false, jumpsquatRemaining: 0, grabbed: false,
    grab: createGrabState(), grabSpec: LINK_GRAB,
    locomotion: { name: 'standing', facing: 1, framesElapsed: 0, dashFacing: 1 },
    jumpPresentation: null, throwPresentation: null, landingPresentation: null, grabPresentation: null, ordinaryPresentation: null, clankPresentation: null,
    turnBrakePresentation: null, groundRecoveryPresentation: null, auxiliaryAirPresentation: null, footstoolRecipientPresentation: null, respawnPresentation: null, itemPresentation: null, itemShooting: null, ledgeJumpPresentation: null, surfaceTechPresentation: null, grabReleasePresentation: null, crouchPresentation: null, reactionPresentation: null, shieldPresentation: null, capturePresentation: null, tauntPresentation: null, jumpsUsed: 0, helpless: false,
    shieldReleaseRemaining: 0, shieldStunRemaining: 0, shieldParrying: false, ledgeCatchFrames: 0, ledgeCatchMotionRates: [], ...patch,
  };
}

function attack(move: AttackMoveWithAnimation = LINK_JAB, framesElapsed = 0): SimulationAnimationSnapshot['activeAttack'] {
  return { move, framesElapsed, facing: 1, phase: 'startup', hitboxBody: null, chargeHeldFrames: 0 };
}

describe('Pikachu air-dodge landing receiving route', () => {
  it.each(['air-dodge', 'directional-air-dodge'] as const)('retains the accepted final crouch body for %s landing', kind => {
    const state=snapshot({characterId:'pikachu',landingRecoveryRemaining:19,
      landingPresentation:{kind,totalFrames:19,remainingFrames:19,framesElapsed:0}});
    expect(resolveSimulationAction(state)).toMatchObject({reviewedSheet:'crouch',frame:59});
    expect(resolveSimulationAction(state).scaleY).toBeUndefined();
  });
});

describe('Pikachu actual capture context routing', () => {
  it.each(['captor','target'] as const)('uses the real29-step release owner for %s', role => {
    expect(resolveSimulationAction(snapshot({ characterId: 'pikachu', grabReleasePresentation: {
      role, framesElapsed: 18, totalFrames: 29, facing: -1, groundedAtEntry: true } })))
      .toMatchObject({ reviewedSheet: role === 'target' ? 'captured_release' : 'grab_escape', frame: 18, facing: -1 });
  });
  it('damage event uses its own unfrozen20-step age then restores the original hold clock', () => {
    const capture: NonNullable<SimulationAnimationSnapshot['capturePresentation']> = {
      captureId: 1, active: true, framesElapsed: 40, facing: -1, groundedAtEntry: true,
      captor: { characterId: 'donkeykong', bodyId: 8, entryFacing: 1, facing: 1 },
      event: { sequence: 2, kind: 'damage', framesElapsed: 19, damage: 1, damageSource: 'pummel' },
    };
    const state = snapshot({ characterId: 'pikachu', grabbed: true, capturePresentation: capture });
    expect(resolveSimulationAction(state)).toMatchObject({ reviewedSheet: 'captured_hit', frame: 19, facing: -1 });
    expect(resolveSimulationAction({ ...state, capturePresentation: { ...capture, event: { ...capture.event, framesElapsed: 20 } } }))
      .toMatchObject({ reviewedSheet: 'captured', frame: 40, facing: -1 });
  });
});

describe('Pikachu backward ground jump presentation', () => {
  it.each([true, false])('uses measured backward launch clearance without delaying its clock (short=%s)', shortHop => {
    const firstClear = shortHop ? 3 : 1;
    const s = snapshot({ characterId: 'pikachu', grounded: false, facing: -1, velocityY: -5,
      jumpPresentation: { kind: 'ground', facing: -1, moveX: 1, velocityX: 0, shortHop, framesElapsed: firstClear - 1 } });
    expect(resolveSimulationAction(s)).toMatchObject({ reviewedSheet: 'jumpsquat', frame: 2, facing: -1 });
    expect(resolveSimulationAction({ ...s, jumpPresentation: { ...s.jumpPresentation!, framesElapsed: firstClear } }))
      .toMatchObject({ reviewedSheet: 'jump_back', frame: firstClear, facing: -1 });
  });
});

describe('Pikachu contextual airborne jump', () => {
  it.each([1, -1] as const)('selects the accepted backward resource from latched entry input facing%s', facing => {
    const s = snapshot({ characterId: 'pikachu', grounded: false, facing, velocityY: -5,
      jumpPresentation: { kind: 'air', facing, moveX: -facing, velocityX: 0, shortHop: false, framesElapsed: 10 } });
    expect(resolveSimulationAction(s)).toMatchObject({ reviewedSheet: 'airjump_back', frame: 10, facing });
    // Drift and current orientation are separate from the entered jump basis.
    expect(resolveSimulationAction({ ...s, facing: (-facing) as 1 | -1, velocityX: facing * 5 }))
      .toMatchObject({ reviewedSheet: 'airjump_back', frame: 10, facing });
    expect(resolveSimulationAction({ ...s, velocityY: 1 })).toMatchObject({ reviewedSheet: 'fall' });
    expect(resolveSimulationAction({ ...s, activeAttack: attack() }).reviewedSheet).toBeUndefined();
  });
  it.each([0, 1, -1] as const)('neutral and forward entry use the forward resource (input=%s)', moveX => {
    const facing = (moveX || 1) as 1 | -1;
    expect(resolveSimulationAction(snapshot({ characterId: 'pikachu', grounded: false, facing, velocityY: -5,
      jumpPresentation: { kind: 'air', facing, moveX, velocityX: 0, shortHop: false, framesElapsed: 0 } })))
      .toMatchObject({ reviewedSheet: 'airjump', frame: 0, facing });
  });
});

function harness(clips: Record<string, number> = { idle: 4, run: 6, jump: 3, attack: 3, jab: 3, smash: 4, hurt: 3, grab: 3, pummel: 3 }) {
  let state = snapshot();
  const animations = new Map(Object.entries(clips).map(([sheet, count]) => {
    const key = `link.${sheet}.anim`;
    return [key, { key, frames: Array.from({ length: count }, (_, index) => ({ index, textureFrame: index })) }];
  }));
  const anims = {
    currentAnim: null as { key: string } | null, currentFrame: null as unknown,
    pause: vi.fn(), setCurrentFrame: vi.fn((frame: unknown) => { anims.currentFrame = frame; }),
  };
  const sprite = { anims, play: vi.fn((key: string) => { anims.currentAnim = { key }; }) };
  const catalog = { exists: (key: string) => animations.has(key), get: (key: string) => animations.get(key) };
  const driver = createSimulationSpriteAnimationDriver(() => state,
    sprite as unknown as SimulationSpriteSurface,
    catalog as unknown as SimulationAnimationCatalog);
  return { driver, sprite, tick(patch: Partial<SimulationAnimationSnapshot> = {}) { state = { ...state, ...patch }; return driver.tick(); } };
}

describe('simulation sprite attack timing', () => {
  it.each(['face-up', 'face-down'] as const)('binds observed prone origin%s without extending the shared recovery timer', origin => {
    const sheet = origin === 'face-up' ? 'down_wait' : 'down_wait_face_down';
    const state = snapshot({ characterId: 'pikachu', reactionPresentation: {
      kind: 'prone', origin, framesElapsed: 0, facing: -1 } });
    expect(resolveSimulationAction(state)).toMatchObject({ reviewedSheet: sheet, frame: 0, facing: -1 });
    expect(getPikachuReviewedStateClock(sheet, 25)).toMatchObject({ localFrame: 25, artFrameIndex: 1 });
    expect(resolveSimulationAction({ ...state, reactionPresentation: null }))
      .toMatchObject({ state: 'idle', reviewedSheet: 'idle', frame: 0 });
  });
  it('keeps persistent observed tumble on the declared beta final pre-cancel pose', () => {
    expect(getPikachuReviewedStateClock('tumble', 80)).toMatchObject({ localFrame: 26, artFrameIndex: 2 });
    expect(resolveSimulationAction(snapshot({ characterId: 'pikachu', reactionPresentation: {
      kind: 'tumble', origin: null, framesElapsed: 80, facing: 1 } })))
      .toMatchObject({ reviewedSheet: 'tumble', frame: 80 });
    expect(getPikachuReviewedStateClock('trip', 25)).toMatchObject({ localFrame: 25, artFrameIndex: 1 });
  });
  it.each([true, false])('keeps all80 Skull held steps on the accepted six-native-step loop (grounded=%s)', grounded => {
    const special = { kind: 'skullBash' as const, frame: 13, charge: 1, second: false, decision: false,
      branchFrame: null, gravity: 0, velocity: { x: 0, y: 0 }, bornGrounded: grounded, grounded,
      firstBurstEnd: 19, secondBurstStart: 28, secondBurstEnd: 33, bodyRotation: 0,
      holding: true, heldFrames: 1, releaseDelay: 0, normalizedFrame: 12, hit: false, quickEndGrounded: null };
    const state = snapshot({ characterId: 'pikachu', grounded,
      activeAttack: attack({ ...LINK_JAB, id: 'pikachu.side_special', type: 'sideSpecial' }), pikachuSpecial: special });
    for (let heldFrames = 1; heldFrames <= 80; heldFrames++) {
      expect(resolveSimulationAction({ ...state, pikachuSpecial: { ...special,
        frame: 12 + heldFrames, heldFrames, charge: heldFrames } })).toMatchObject({
        sheets: [grounded ? 'side_special_hold' : 'side_special_air_hold'],
        frame: Math.floor(((heldFrames - 1) % 6) / 2), duration: 4,
      });
    }
    expect(resolveSimulationAction({ ...state, pikachuSpecial: { ...special, frame: 33,
      holding: false, charge: 20, heldFrames: 20, releaseDelay: 3, normalizedFrame: 10 } }))
      .toMatchObject({ sheets: [grounded ? 'side_special_ready' : 'side_special_air_ready'], frame: 0 });
  });
  it.each([1, -1] as const)('keeps source pivot-grab drawing basis before the shared entry turn from facing%i', facing => {
    const state = snapshot({ characterId: 'pikachu', facing,
      grab: { name: 'whiffRecovery', cooldownRemaining: 0,
        active: { framesElapsed: 13, pummelCooldownRemaining: 0, throwDirection: null } },
      grabPresentation: { variant: 'pivot', spec: LINK_GRAB, phase: 'whiffRecovery',
        phaseFramesElapsed: 13, framesElapsed: 25, facing } });
    expect(resolveSimulationAction(state)).toMatchObject({ reviewedSheet: 'pivot_grab', frame: 25, facing: -facing });
  });
  it('binds shield outcome clocks and the explicit beta broken recovery phase', () => {
    const state = snapshot({ characterId: 'pikachu', shieldPresentation: {
      kind: 'release', framesElapsed: 7, totalFrames: 11, remainingFrames: 4, facing: -1, phase: 'active' } });
    expect(resolveSimulationAction(state)).toMatchObject({ reviewedSheet: 'shield_end', frame: 7, facing: -1 });
    expect(resolveSimulationAction({ ...state, shieldPresentation: { ...state.shieldPresentation!, kind: 'block', framesElapsed: 0 } }))
      .toMatchObject({ reviewedSheet: 'shield_hit', frame: 0 });
    expect(resolveSimulationAction({ ...state, shieldPresentation: { ...state.shieldPresentation!, kind: 'parry', framesElapsed: 5 } }))
      .toMatchObject({ reviewedSheet: 'parry', frame: 5 });
    for (const age of [0, 145, 146, 179]) {
      const recovering = age >= 146;
      expect(resolveSimulationAction({ ...state, shieldPresentation: { ...state.shieldPresentation!, kind: 'broken', totalFrames: 180, framesElapsed: age } }))
        .toMatchObject({ reviewedSheet: recovering ? 'shield_break_end' : 'shield_break', frame: recovering ? age - 146 : age });
    }
  });
  it('keeps an explicitly indefinite neutral shield window valid at late finite ages', () => {
    expect(getPikachuReviewedStateClock('shield', 9999)).toMatchObject({ localFrame: 9999, artFrameIndex: 0, frameCount: 5 });
    expect(resolveSimulationAction(snapshot({ characterId: 'pikachu', shield: { ...createShieldState(), name: 'active' } })))
      .toMatchObject({ state: 'shield', reviewedSheet: 'shield', frame: 0 });
  });
  it('uses eligible crouch hold age after commitment reentry rather than accumulated locomotion age', () => {
    const state = snapshot({ characterId: 'pikachu', crouching: true,
      locomotion: { name: 'crouch', facing: 1, framesElapsed: 45, dashFacing: 1 },
      crouchPresentation: { phase: 'hold', framesElapsed: 0, facing: -1 } });
    expect(resolveSimulationAction(state)).toMatchObject({ state: 'crouch', reviewedSheet: 'crouch', frame: 0, facing: -1 });
    const clock = getPikachuReviewedStateClock('crouch', 90);
    expect(clock?.localFrame).toBe(59);
    expect(clock?.artFrameIndex).toBe(4);
  });
  it('uses the captured collision pose when a clank cancels an attack before rendering', () => {
    const h = harness({ idle: 1, jab: 3 });
    expect(h.tick({ activeAttack: attack(LINK_JAB, 3) })?.frameIndex).toBe(0);
    const clank = { totalFrames: 18, phase: 'freeze' as const, framesElapsed: 0, facing: 1 as const,
      interruptedAttack: { move: LINK_JAB, framesElapsed: 4, facing: 1 as const, chargeHeldFrames: null } };
    expect(h.tick({ activeAttack: null, clankPresentation: clank, hitlagRemaining: 7 })?.frameIndex).toBe(1);
    expect(h.tick({ clankPresentation: { ...clank, phase: 'rebound', framesElapsed: 10 }, hitlagRemaining: 0 })?.frameIndex).toBe(1);
  });

  it('keeps Pikachu pummel motion at native0 during its separate11 impact freeze steps', () => {
    const spec = { ...LINK_GRAB, pummel: { damage: 1, startupFrames: 0, cooldownFrames: 16, hitlagFrames: 11 } };
    const state = snapshot({ characterId: 'pikachu', grabSpec: spec,
      hitlagRemaining: 11, grab: { name: 'holding', cooldownRemaining: 0,
        active: { framesElapsed: 10, pummelCooldownRemaining: 5, throwDirection: null } } });
    expect(resolveSimulationAction(state)).toMatchObject({ state: 'pummel', frame: 0 });
    expect(resolveSimulationAction({ ...state, hitlagRemaining: 0, grab: { ...state.grab,
      active: { ...state.grab.active!, pummelCooldownRemaining: 1 } } })).toMatchObject({ state: 'pummel' });
  });

  it('uses reviewed Thunder drawing windows on the source call clock and keeps missing branches explicit', () => {
    const special = { kind: 'thunder' as const, frame: 12, charge: 0, second: false, decision: false,
      branchFrame: null, gravity: null, velocity: { x: 0, y: 0 }, bornGrounded: true, grounded: true,
      firstBurstEnd: 19, secondBurstStart: 28, secondBurstEnd: 33, bodyRotation: 0, holding: false, heldFrames: 0, releaseDelay: 0, normalizedFrame: 12, hit: false, quickEndGrounded: null };
    const active = attack({ ...LINK_JAB, id: 'pikachu.down_special', type: 'downSpecial' });
    const call = snapshot({ characterId: 'pikachu', activeAttack: active, pikachuSpecial: special });
    expect(resolveSimulationAction(call)).toMatchObject({ sheets: ['down_special'], frame: 2, duration: 7 });
    expect(resolveSimulationAction({ ...call, pikachuSpecial: { ...special, frame: 46 } })).toMatchObject({ frame: 6 });
    expect(resolveSimulationAction({ ...call, pikachuSpecial: { ...special, grounded: false } }).sheets)
      .not.toContain('down_special');
    expect(resolveSimulationAction({ ...call, pikachuSpecial: { ...special, branchFrame: 12 } }).sheets)
      .not.toContain('down_special');
  });

  it('advances a source-timed charge windup and holds its simulation pause frame', () => {
    const move = { ...LINK_SMASH, animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 1,
      frameWindows: [
        { startFrame: 0, endFrame: 4, artFrameIndex: 0 },
        { startFrame: 4, endFrame: 8, artFrameIndex: 1 },
        { startFrame: 8, endFrame: 14, artFrameIndex: 2 },
        { startFrame: 14, endFrame: 18, artFrameIndex: 3 },
        { startFrame: 18, endFrame: 37, artFrameIndex: 4 },
      ] } };
    const h = harness({ idle: 1, smash: 5 });
    expect(h.tick({ chargingMove: move, chargeStartupElapsed: 0 })?.frameIndex).toBe(0);
    expect(h.tick({ chargeStartupElapsed: 4 })?.frameIndex).toBe(1);
    expect(h.tick({ chargeStartupElapsed: 8 })?.frameIndex).toBe(2);
    expect(h.tick({ chargeHeldFrames: 30, frame: 50 })?.frameIndex).toBe(2);
    expect(h.tick({ hitlagRemaining: 3, chargeStartupElapsed: 8 })?.frameIndex).toBe(2);
    expect(h.tick({ frozen: true, chargeStartupElapsed: 4 })?.frameIndex).toBe(2);
    expect(h.tick({ frozen: false, hitlagRemaining: 0, chargingMove: null, activeAttack: attack(move, 8) })?.frameIndex).toBe(2);
  });
  it('shows release and renewed anticipation between separate live strike windows', () => {
    expect([3, 4, 5, 6, 8, 9, 11, 12, 13, 14, 19].map(frame =>
      selectSimulationAttackFrame(TWO_SWINGS, frame, 3)))
      .toEqual([0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2]);
  });

  it('resolves each strike even when a render skips all intervening frames', () => {
    const h = harness();
    expect(h.tick({ activeAttack: attack(TWO_SWINGS, 4) })?.frameIndex).toBe(2);
    expect(h.tick({ frame: 8, activeAttack: attack(TWO_SWINGS, 12) })?.frameIndex).toBe(2);
    expect(h.tick({ frame: 10, activeAttack: attack(TWO_SWINGS, 14) })?.frameIndex).toBe(3);
  });

  it('does not restart contact art at adjacent early-to-late damage transitions', () => {
    const lingering = { ...LINK_JAB, startupFrames: 6, activeFrames: 25, recoveryFrames: 7,
      hitWindows: [{ startFrame: 6, endFrame: 8, group: 'kick' }, { startFrame: 8, endFrame: 31, group: 'kick' }] };
    expect([6, 7, 8, 20, 30, 31].map(frame => selectSimulationAttackFrame(lingering, frame, 9)))
      .toEqual([3, 3, 3, 4, 5, 6]);
  });

  it('honors the real four-frame smash strip across three nonuniform strikes', () => {
    const triple = { ...LINK_SMASH, startupFrames: 9, activeFrames: 36, recoveryFrames: 32,
      hitWindows: [{ startFrame: 9, endFrame: 15 }, { startFrame: 24, endFrame: 30 }, { startFrame: 40, endFrame: 45 }] };
    expect([8, 9, 14, 15, 20, 23, 24, 29, 30, 35, 39, 40, 44, 45].map(frame =>
      selectSimulationAttackFrame(triple, frame, 4, 'smash')))
      .toEqual([1, 2, 2, 3, 0, 1, 2, 2, 3, 0, 1, 2, 2, 3]);
  });

  it('freezes a gap pose on pause and through hitlag until the action advances', () => {
    const h = harness();
    expect(h.tick({ activeAttack: attack(TWO_SWINGS, 6) })?.frameIndex).toBe(3);
    expect(h.tick({ frozen: true, frame: 50, activeAttack: attack(TWO_SWINGS, 12) })?.frameIndex).toBe(3);
    expect(h.tick({ frozen: false, activeAttack: attack(TWO_SWINGS, 6), hitlagRemaining: 3 })?.frameIndex).toBe(3);
    expect(h.tick({ frame: 51, activeAttack: attack(TWO_SWINGS, 12), hitlagRemaining: 0 })?.frameIndex).toBe(2);
  });

  it('uses each strike direction while preserving the attack-latched facing', () => {
    const h = harness();
    expect(h.tick({ facing: -1, activeAttack: attack(TWO_SWINGS, 4) })?.facing).toBe(1);
    expect(h.tick({ activeAttack: attack(TWO_SWINGS, 6) })?.facing).toBe(1);
    expect(h.tick({ activeAttack: attack(TWO_SWINGS, 9) })?.facing).toBe(-1);
    expect(h.tick({ activeAttack: attack(TWO_SWINGS, 12) })?.facing).toBe(-1);
    expect(h.tick({ activeAttack: attack(TWO_SWINGS, 14) })?.facing).toBe(-1);
    expect(h.tick({ activeAttack: null, facing: 1 })?.facing).toBe(1);
  });

  it('faces Link back-air slash art and generic fallback toward the actual rear sensor', () => {
    const backAir = { ...attack(LINK_BAIR, 5)!, facing: -1 as const };
    expect(harness({ bair: 3 }).tick({ facing: 1, activeAttack: backAir })?.facing).toBe(-1);
    expect(harness({ attack: 3 }).tick({ facing: 1, activeAttack: backAir })?.facing).toBe(-1);
  });

  it('keeps sparse fallback strips valid for every window and gap', () => {
    for (const count of [1, 2, 3, 4, 20]) for (let frame = 0; frame < 25; frame++) {
      const index = selectSimulationAttackFrame(TWO_SWINGS, frame, count);
      expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(count);
    }
  });

  it('shows windup, contact, then recovery on the exact jab phase boundaries', () => {
    expect(Array.from({ length: 16 }, (_, frame) => selectSimulationAttackFrame(LINK_JAB, frame, 3, 'jab')))
      .toEqual([0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it('stretches windup for edited timing without delaying the contact pose', () => {
    const slow = { ...LINK_JAB, startupFrames: 90, activeFrames: 2, recoveryFrames: 120 };
    expect([0, 35, 89, 90, 91, 92, 211].map(f => selectSimulationAttackFrame(slow, f, 3, 'jab'))).toEqual([0, 0, 0, 1, 1, 2, 2]);
  });

  it('uses the existing four-frame smash strip as two windups, contact, recovery', () => {
    expect([0, 7, 13, 14, 17, 18, 36].map(f => selectSimulationAttackFrame(LINK_SMASH, f, 4, 'smash'))).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('honors authored phase counts when they match the loaded strip', () => {
    expect([0, 2, 4, 7, 10, 13].map(f => selectSimulationAttackFrame(LINK_JAB, f, 6))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rewinds consecutive same-family attacks even without an idle render between them', () => {
    const h = harness();
    expect(h.tick({ activeAttack: attack(LINK_JAB, 12) })?.frameIndex).toBe(2);
    expect(h.tick({ frame: 1, activeAttack: attack(LINK_JAB, 0) })?.frameIndex).toBe(0);
    expect(h.sprite.play).toHaveBeenCalledTimes(1);
  });

  it('advances using actual action elapsed even if renders skip whole phases', () => {
    const h = harness();
    h.tick({ activeAttack: attack() });
    expect(h.tick({ frame: 10, activeAttack: attack(LINK_JAB, 10) })?.frameIndex).toBe(2);
  });

  it('handles one-frame and incomplete clips without invalid frame indexes', () => {
    for (const count of [1, 2, 3, 4, 20]) for (const frame of [0, 4, 7, 16, 500]) {
      const index = selectSimulationAttackFrame(LINK_JAB, frame, count);
      expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(count);
    }
  });
});

describe('simulation animation clocks and fallback', () => {
  it('does not advance on extra renders with no simulation step', () => {
    const h = harness(); h.tick({ velocityX: 4 });
    for (let render = 0; render < 100; render++) expect(h.tick()?.frameIndex).toBe(0);
    expect(h.tick({ frame: 5 })?.frameIndex).toBe(1);
  });

  it('freezes a paused pose and resumes without a wall-clock catchup', () => {
    const h = harness(); h.tick({ velocityX: 4 }); h.tick({ frame: 5 });
    expect(h.tick({ frozen: true, frame: 100, activeAttack: attack() })?.state).toBe('run');
    expect(h.tick({ frozen: false, frame: 101, activeAttack: null })?.frameIndex).toBe(1);
  });

  it('holds attack contact during hitlag, while the victim immediately gets a hurt pose', () => {
    const h = harness(); h.tick({ activeAttack: attack(LINK_JAB, 4) });
    for (let frame = 1; frame <= 8; frame++) expect(h.tick({ frame, hitlagRemaining: 9 - frame })?.frameIndex).toBe(1);
    expect(h.tick({ hitstunRemaining: 20 })?.key).toBe('link.hurt.anim');
    expect(h.tick({ hitstunRemaining: 20 })?.frameIndex).toBe(0);
  });

  it('shows the victim hurt from the hit step: hitlag queues the hitstun but is already a damage reaction', () => {
    const h = harness(); h.tick({});
    const hitlag = { reactionPresentation: { kind: 'damage' as const, origin: null, framesElapsed: 0, facing: 1 as const, phase: 'hitlag' as const },
      hitlagRemaining: 8, hitstunRemaining: 0 };
    expect(h.tick({ frame: 1, ...hitlag })?.key).toBe('link.hurt.anim');
    expect(resolveSimulationAction(snapshot(hitlag)).state).toBe('hurt');
  });

  it('excludes hitlag from locomotion animation time', () => {
    const h = harness(); h.tick({ velocityX: 4 }); h.tick({ frame: 5 });
    for (let frame = 6; frame <= 16; frame++) expect(h.tick({ frame, hitlagRemaining: 1 })?.frameIndex).toBe(1);
    expect(h.tick({ frame: 17, hitlagRemaining: 0 })?.frameIndex).toBe(1);
  });

  it('falls back through loaded clips when a dedicated pack is partial', () => {
    const h = harness({ idle: 2, attack: 3 });
    expect(h.tick({ activeAttack: attack(LINK_FAIR, 0) })?.key).toBe('link.attack.anim');
    expect(h.tick({ activeAttack: null, hitstunRemaining: 10 })?.key).toBe('link.idle.anim');
    expect(harness({ idle: 2 }).tick({ activeAttack: attack() })?.key).toBe('link.idle.anim');
    expect(harness({}).tick()).toBeNull();
  });

  it('selects up/down/forward aerial art from direction', () => {
    const h = harness({ uair: 3, dair: 3, fair: 3, idle: 2 });
    expect(h.tick({ activeAttack: attack(LINK_UAIR) })?.key).toBe('link.uair.anim');
    expect(h.tick({ activeAttack: attack(LINK_DAIR) })?.key).toBe('link.dair.anim');
    expect(h.tick({ activeAttack: attack(LINK_FAIR) })?.key).toBe('link.fair.anim');
  });

  it('uses a charge windup only for a live charge and shows landing/jump anticipation', () => {
    const h = harness();
    expect(h.tick({ chargingMove: LINK_SMASH, chargeHeldFrames: 40 })?.frameIndex).toBe(1);
    expect(h.tick({ chargingMove: null })?.key).toBe('link.idle.anim');
    expect(h.tick({ jumpsquatRemaining: 3 })?.scaleY).toBeLessThan(1);
    expect(h.tick({ jumpsquatRemaining: 0, landingRecoveryRemaining: 10 })?.state).toBe('landing');
  });

  it('shows a held grab without phantom pummels; actual pummel and directional throw take over', () => {
    const h = harness({ grab: 3, pummel: 3, bthrow: 3, idle: 2 });
    const active = { framesElapsed: 15, pummelCooldownRemaining: 0, throwDirection: null };
    expect(h.tick({ grab: { name: 'holding', active, cooldownRemaining: 0 } })?.key).toBe('link.grab.anim');
    expect(h.tick({ grab: { name: 'holding', active: { ...active, pummelCooldownRemaining: 3 }, cooldownRemaining: 0 } })?.key).toBe('link.pummel.anim');
    expect(h.tick({ grab: { name: 'throwing', active: { ...active, throwDirection: 'back' }, cooldownRemaining: 0 } })?.key).toBe('link.bthrow.anim');
  });

  it('keeps whiff recovery in the grab clip and gives hurt precedence over other actions', () => {
    const h = harness();
    expect(h.tick({ grab: { name: 'whiffRecovery', active: { framesElapsed: 0, pummelCooldownRemaining: 0, throwDirection: null }, cooldownRemaining: 1 } })?.frameIndex).toBe(2);
    expect(resolveSimulationAction(snapshot({ activeAttack: attack(), grabbed: true })).state).toBe('hurt');
  });

  it('detaches cleanly and never schedules autonomous animation playback', () => {
    const h = harness(); h.tick(); h.driver.detach();
    h.tick({ activeAttack: attack() });
    expect(h.sprite.play).toHaveBeenCalledTimes(1);
    expect(h.sprite.anims.pause).toHaveBeenCalled();
  });

  it('tears down safely when Phaser has already destroyed the sprite animation component', () => {
    const h = harness(); h.tick();
    (h.sprite as unknown as { anims: unknown }).anims = undefined;
    expect(() => h.driver.tick()).not.toThrow();
    expect(() => h.driver.detach()).not.toThrow();
    expect(() => h.driver.detach()).not.toThrow();
  });
});

describe('Pikachu dedicated ground recovery drawings and source receiving',()=>{
 it.each([
  ['getup',29,4,30,23],['getup_face_down',22,3,30,23],
  ['getup_roll',28,3,36,15],['getup_roll_back',30,3,36,20],
  ['getup_roll_face_down',27,3,36,20],['getup_roll_back_face_down',30,3,36,20],
  ['tech',24,3,27,21],['tech_forward',33,3,41,21],['tech_back',32,3,41,21],
 ]as const)('selects accepted %s drawing at native%s without ordinary retiming',(sheet,age,cell,duration,end)=>{
  const s=snapshot({characterId:'pikachu',facing:-1,groundRecoveryPresentation:{sheet,facing:1,framesElapsed:age,duration,protectionEnd:end}});
  const action=resolveSimulationAction(s);expect(action.auxiliarySheet).toBe(sheet);expect(action.directArtFrame).toBe(cell);expect(action.facing).toBe(1);
  const receiving=selectPikachuReviewedStateReceiving(s)!;expect(receiving).toHaveLength(12);expect(receiving.every(h=>h.capsule!==undefined)).toBe(true);expect(receiving.every(h=>h.intangible===true)).toBe(age+1<end);
 });
});

import type {SimulationSpriteSurface,SimulationAnimationCatalog} from './simulationSpriteAnimation';
