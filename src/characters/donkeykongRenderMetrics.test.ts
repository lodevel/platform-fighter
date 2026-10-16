import { describe, expect, it, vi } from 'vitest';
import { createShieldState } from './shieldState';
import { createDodgeState } from './dodgeState';
import { createLedgeHangState } from './ledgeHangState';
import { createGrabState } from './grabState';
import { DONKEYKONG_DASHATTACK, DONKEYKONG_DOWN_SPECIAL, DONKEYKONG_DSMASH, DONKEYKONG_GRAB, DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_SIDE_SPECIAL, DONKEYKONG_SMASH, DONKEYKONG_TILT, DONKEYKONG_UP_SPECIAL, DONKEYKONG_USMASH, DONKEYKONG_UTILT } from './DonkeyKong';
import type { AttackMove } from './attacks';
import { getPikachuSheetRenderMetrics } from './pikachuPresentation';
import { createSimulationSpriteAnimationDriver, resolveSimulationAction, type SimulationAnimationSnapshot } from './simulationSpriteAnimation';
import { packedAnimationEnd, packedBodyCandidate, getPackedBodyRenderMetrics, getPackedNativeTimedClip, installedPackedSheet, selectPackedNativeSampleFrame } from './packedBodyPresentation';
import { getMoveAnimKey } from './spriteAnimationDriver';
import originalFrames from '../../assets/characters/donkeykong/frames.json';

/** Stand-ins for freshly packed rework clips (tools/fighter-pack.py fragments). The real
 * frames.json is merged in, so the 256 px clips (`run`, `jump`, ...) stay the old art. */
const PENDING_SHEETS = vi.hoisted(() => ['fall_special', 'fall_b', 'fall_aerial', 'fall_aerial_f', 'fall_aerial_b', 'jump_b', 'jump_short_b', 'airjump_b']);
vi.mock('../../assets/characters/donkeykong/frames.json', async importOriginal => {
  const original = await importOriginal<{ default: { animations: Record<string, unknown> } }>();
  const packed = {
    frameWidth: 504, frameHeight: 288, root: [127, 279], scaleToWorld: 0.4666667, bodyCentreFromRootY: -42,
  };
  // Pending keys are removed so fallback assertions hold whether or not their art is installed;
  // fall_b and jump_b stand in for installed ones.
  const animations = Object.fromEntries(Object.entries(original.default.animations)
    .filter(([sheet]) => !PENDING_SHEETS.includes(sheet)));
  return { default: { ...original.default, animations: { ...animations,
    fall_b: { ...packed, strip: 'animations/fall_b.png', frameCount: 3, nativeSampleIndices: [1, 9, 16], loopDuration: 16 },
    jump_b: { ...packed, strip: 'animations/jump_b.png', frameCount: 2, nativeSampleIndices: [1, 30] },
    // Loop: 141 native frames, last sample 140 -> loopDuration 140.
    idle: { ...packed, strip: 'animations/idle.png', frameCount: 4, nativeSampleIndices: [1, 18, 70, 140], loopDuration: 140 },
    walk: { ...packed, strip: 'animations/walk.png', frameCount: 3, nativeSampleIndices: [1, 15, 30], loopDuration: 30 },
    // One-shot: the last drawing is held after the actionable sample.
    dash: { ...packed, strip: 'animations/dash.png', frameCount: 4, nativeSampleIndices: [1, 7, 14, 20] },
    crouch_end: { ...packed, strip: 'animations/crouch_end.png', frameCount: 2, nativeSampleIndices: [1, 7] },
    // Stand-in for the queued ledge-recovery family clip (native 39 frames, loop 38).
    fall_special: { ...packed, strip: 'animations/fall_special.png', frameCount: 6, nativeSampleIndices: [1, 8, 16, 23, 31, 38], loopDuration: 38 },
    // Root without nativeSampleIndices: scaled, but still on the classifier path.
    crouch: { ...packed, strip: 'animations/crouch.png', frameCount: 1 },
  } } };
});

const SCALAR_SNAPSHOT: Partial<SimulationAnimationSnapshot> = {
  packedBody: { clock: null, committed: null, crouchPhase: null, turnBrake: null, itemCue: null,
    airDodgeDirection: { x: 0, y: 0 }, fastFall: false },
};

function snapshot(patch: Partial<SimulationAnimationSnapshot> = {}): SimulationAnimationSnapshot {
  return {
    characterId: 'donkeykong', facing: 1, destroyed: false, activeAttack: null, pikachuSpecial: null,
    buriedPresentation: null, hitstunRemaining: 0, hitlagRemaining: 0, shield: createShieldState(),
    dodge: createDodgeState(), ledgeHang: createLedgeHangState(), chargingMove: null, chargeHeldFrames: 0,
    landingRecoveryRemaining: 0, frame: 0, frozen: false, grounded: true, velocityX: 0, velocityY: 0,
    crouching: false, jumpsquatRemaining: 0, grabbed: false, grab: createGrabState(), grabSpec: DONKEYKONG_GRAB,
    locomotion: { name: 'standing', facing: 1, framesElapsed: 0, dashFacing: 1 },
    jumpPresentation: null, throwPresentation: null, landingPresentation: null, grabPresentation: null,
    ordinaryPresentation: null, clankPresentation: null, turnBrakePresentation: null,
    groundRecoveryPresentation: null, auxiliaryAirPresentation: null, footstoolRecipientPresentation: null,
    respawnPresentation: null, itemPresentation: null, ledgeJumpPresentation: null, surfaceTechPresentation: null,
    grabReleasePresentation: null, crouchPresentation: null, reactionPresentation: null, shieldPresentation: null,
    capturePresentation: null, tauntPresentation: null, jumpsUsed: 0, helpless: false, shieldReleaseRemaining: 0,
    shieldStunRemaining: 0, shieldParrying: false, ledgeCatchFrames: 0, ledgeCatchMotionRates: [],
    ...SCALAR_SNAPSHOT, ...patch,
  } as SimulationAnimationSnapshot;
}
const standing = (age: number) => snapshot({ ordinaryPresentation: { sheet: 'idle', framesElapsed: age, facing: 1 } });

describe('DK render metrics (per-clip root/scale vs legacy visualScale)', () => {
  it('a packed clip with root + scaleToWorld gets per-clip metrics', () => {
    expect(getPackedBodyRenderMetrics('donkeykong','walk')).toEqual({
      originX: 127 / 504, originY: 279 / 288, scaleToWorld: 0.4666667, bodyCentreFromRootY: -42 });
  });
  it('a 256 px clip without root keeps the global visualScale path (null metrics)', () => {
    expect(getPackedBodyRenderMetrics('donkeykong','attack')).toBeNull();
    expect(getPackedBodyRenderMetrics('donkeykong','up_special')).toBeNull();
    expect(getPackedBodyRenderMetrics('donkeykong','no_such_clip')).toBeNull();
  });
  it('the body centre sits half the 84 px physics body above the root (feet on the floor)', () => {
    expect(getPackedBodyRenderMetrics('donkeykong','dash')!.bodyCentreFromRootY).toBe(-42);
  });
});

describe('DK nativeSampleIndices timing', () => {
  it('holds each drawing until the next sample native frame (age 0 = native frame 1)', () => {
    const at = (age: number) => selectPackedNativeSampleFrame('donkeykong','dash', age);
    expect([0, 5, 6, 12, 13, 18, 19, 200].map(at)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it('wraps loop clips on loopDuration', () => {
    const at = (age: number) => selectPackedNativeSampleFrame('donkeykong','idle', age);
    // Native 140 is the loop's last frame, one step before the cycle repeats native 1: its drawing
    // would flash for a single step every cycle, so drawing 2 holds through the wrap.
    expect([0, 16, 17, 68, 69, 138, 139, 140, 156, 157].map(at)).toEqual([0, 0, 1, 1, 2, 2, 2, 0, 0, 1]);
  });
  it('a loop never shows a drawing for a single step (charge contact samples, seam)', () => {
    // smash_charge samples [1,8,15,22,23,30,38,45,53,60], loop 60: native 22 and 60 last one step.
    const at = (age: number) => selectPackedNativeSampleFrame('donkeykong','smash_charge', age);
    expect([20, 21, 22, 51, 52, 58, 59, 60].map(at)).toEqual([2, 2, 4, 7, 8, 8, 8, 0]);
    expect([13, 14, 15].map(age => selectPackedNativeSampleFrame('donkeykong','neutral_special_charge', age))).toEqual([1, 1, 0]);
    // One-shot clips keep their single-step contact drawings.
    expect([10, 11, 12].map(age => selectPackedNativeSampleFrame('donkeykong','down_special', age))).toEqual([0, 1, 2]);
  });
  it('only clips with nativeSampleIndices and no frameWindows are native-timed', () => {
    expect(getPackedNativeTimedClip('donkeykong','walk')).not.toBeNull();
    expect(getPackedNativeTimedClip('donkeykong','run')).not.toBeNull();
    expect(getPackedNativeTimedClip('donkeykong','jab')).toBeNull();
    expect(() => selectPackedNativeSampleFrame('donkeykong','jab', 0)).toThrow(/no native sample timing/);
    expect(() => selectPackedNativeSampleFrame('donkeykong','dash', -1)).toThrow(/Invalid/);
  });
  it('every packed clip has exactly one native sample per drawing', () => {
    for (const [sheet, clip] of Object.entries(originalFrames.animations as Record<string, { frameCount: number; nativeSampleIndices?: number[]; actionFrameStarts?: number[] }>)) {
      if (clip.nativeSampleIndices) expect(clip.nativeSampleIndices.length, sheet).toBe(clip.frameCount);
      if (clip.actionFrameStarts) expect(clip.actionFrameStarts.length, sheet).toBe(clip.frameCount);
    }
  });
});

describe('DK locomotion routing to native-timed sheets', () => {
  it('selects idle / walk / dash by the DK body candidate and its action age', () => {
    expect(resolveSimulationAction(standing(0))).toMatchObject({ nativeTimedSheet: 'idle', frame: 0, sheets: ['idle'] });
    expect(resolveSimulationAction(snapshot({ locomotion: { name: 'walk', facing: 1, framesElapsed: 9, dashFacing: 1 },
      ordinaryPresentation: { sheet: 'walk', framesElapsed: 9, facing: 1 } })))
      .toMatchObject({ nativeTimedSheet: 'walk', frame: 9 });
    expect(resolveSimulationAction(snapshot({ locomotion: { name: 'initialDash', facing: 1, framesElapsed: 4, dashFacing: 1 } })))
      .toMatchObject({ nativeTimedSheet: 'dash', frame: 4 });
  });
  it('falls back to the DK body clock when the candidate carries no age', () => {
    const end = (clock: SimulationAnimationSnapshot['packedBody']['clock']) => snapshot({
      packedBody: { ...SCALAR_SNAPSHOT.packedBody!, crouchPhase: 'end', clock } });
    expect(resolveSimulationAction(end({ sheet: 'crouch_end', framesElapsed: 6, facing: 1 })))
      .toMatchObject({ nativeTimedSheet: 'crouch_end', frame: 6 });
    // A clock still belonging to another sheet restarts the new one.
    expect(resolveSimulationAction(end({ sheet: 'crouch', framesElapsed: 40, facing: 1 })).frame).toBe(0);
  });
  it('the installed run clip is native-timed; a root without nativeSampleIndices stays on the classifier', () => {
    const run = resolveSimulationAction(snapshot({ velocityX: 4, locomotion: { name: 'run', facing: 1, framesElapsed: 3, dashFacing: 1 } }));
    expect(run.nativeTimedSheet).toBe('run');
    // The mocked crouch clip above has a root but no nativeSampleIndices.
    const crouch = resolveSimulationAction(snapshot({ crouching: true }));
    expect(crouch.nativeTimedSheet).toBeUndefined();
    expect(crouch.state).toBe('crouch');
  });
  it('never routes another fighter through the DK timing path', () => {
    const pika = resolveSimulationAction({ ...standing(5), characterId: 'pikachu' });
    expect(pika.nativeTimedSheet).toBeUndefined();
    expect(pika).toMatchObject({ reviewedSheet: 'idle', frame: 5 });
  });
});

describe('DK air routing: Ultimate-style fall and backward jump variants', () => {
  type Jump = NonNullable<SimulationAnimationSnapshot['jumpPresentation']>;
  const air = (patch: Partial<SimulationAnimationSnapshot>, stickX = 0, fastFall = false) => packedBodyCandidate(snapshot({
    grounded: false, velocityY: 3, locomotion: { name: 'standing', facing: 1, framesElapsed: 0, dashFacing: 1 },
    packedBody: { ...SCALAR_SNAPSHOT.packedBody!, stickX, fastFall }, ...patch }))!;
  const jump = (patch: Partial<Jump>): Jump => ({ kind: 'ground', facing: 1, moveX: 0, velocityX: 0, shortHop: false, framesElapsed: 4, ...patch });

  it('falls by stick relative to facing: fall / fall_f (air_drift) / fall_b', () => {
    for (const facing of [1, -1] as const) {
      const fall = (stickX: number) => air({ facing }, stickX);
      expect(fall(0).sheet).toBe('fall');
      expect(fall(.2 * facing).sheet).toBe('fall');
      expect(fall(facing).sheet).toBe('air_drift');
      expect(fall(-facing).sheet).toBe('fall_b');
      expect(fall(-facing).facing).toBe(facing);
    }
    // A rising body without a jump presentation also takes the fall family (old rule never fired).
    expect(air({ velocityY: -2 }, 1).sheet).toBe('air_drift');
    expect(air({}, -1, true).sheet).toBe('fall_fast');
  });
  it('uses the fall_aerial family after an aerial jump, falling back to installed equivalents', () => {
    const after = (stickX: number) => air({ jumpPresentation: jump({ kind: 'air', framesElapsed: 40 }) }, stickX).sheet;
    expect([0, 1, -1].map(after)).toEqual(['fall', 'air_drift', 'fall_b']);
    expect(air({ jumpPresentation: jump({ kind: 'ground' }) }, -1).sheet).toBe('fall_b');
  });
  it('selects backward jumps from the entry stick while rising; facing is kept', () => {
    const rising = (patch: Partial<Jump>) => air({ velocityY: -5, jumpPresentation: jump(patch) });
    expect(rising({ moveX: -1 })).toMatchObject({ sheet: 'jump_b', age: 4, facing: 1 });
    expect(rising({ facing: -1, moveX: 1 })).toMatchObject({ sheet: 'jump_b', facing: -1 });
    expect(rising({ moveX: 1 }).sheet).toBe('jump');
    expect(rising({ moveX: -.2 }).sheet).toBe('jump');
    // Pending art: jump_short_b -> jump_short, airjump_b -> airjump.
    expect(rising({ moveX: -1, shortHop: true }).sheet).toBe('jump_short');
    expect(rising({ kind: 'air', moveX: -1 }).sheet).toBe('airjump');
    expect(rising({ kind: 'ledge', moveX: -1 }).sheet).toBe('ledge_jump');
  });
  it('every pending key resolves to an installed clip; installed and unrelated keys are unchanged', () => {
    for (const sheet of PENDING_SHEETS)
      expect(originalFrames.animations, sheet).toHaveProperty(installedPackedSheet('donkeykong',sheet));
    expect(installedPackedSheet('donkeykong','fall_aerial_b')).toBe('fall_b');
    expect(installedPackedSheet('donkeykong','fall_aerial_f')).toBe('air_drift');
    expect(installedPackedSheet('donkeykong','jump_short_b')).toBe('jump_short');
    expect(installedPackedSheet('donkeykong','jump_b')).toBe('jump_b');
    expect(installedPackedSheet('donkeykong','idle')).toBe('idle');
    expect(installedPackedSheet('donkeykong','no_such_clip')).toBe('no_such_clip');
  });
  it('Pikachu airborne routing is unaffected', () => {
    const pika = (patch: Partial<SimulationAnimationSnapshot>) => resolveSimulationAction(snapshot({ characterId: 'pikachu',
      grounded: false, packedBody: { ...SCALAR_SNAPSHOT.packedBody!, stickX: -1 }, ...patch }));
    expect(pika({ velocityY: 3 })).toMatchObject({ reviewedSheet: 'fall' });
    expect(pika({ velocityY: -5, jumpPresentation: jump({ moveX: -1 }) }).nativeTimedSheet).toBeUndefined();
  });
});

describe('DK native-timed driver playback', () => {
  function harness(clips: Record<string, number>) {
    let state = snapshot();
    const animations = new Map(Object.entries(clips).map(([sheet, count]) => {
      const key = `donkeykong.${sheet}.anim`;
      return [key, { key, frames: Array.from({ length: count }, (_, index) => ({ index, textureFrame: index })) }];
    }));
    const anims = { currentAnim: null as { key: string } | null, currentFrame: null as unknown,
      pause: vi.fn(), setCurrentFrame: vi.fn((frame: unknown) => { anims.currentFrame = frame; }) };
    const sprite = { anims, play: vi.fn((key: string) => { anims.currentAnim = { key }; }) };
    const catalog = { exists: (key: string) => animations.has(key), get: (key: string) => animations.get(key) };
    const driver = createSimulationSpriteAnimationDriver(() => state, sprite as unknown as SimulationSpriteSurface,
      catalog as unknown as SimulationAnimationCatalog);
    return { tick(patch: Partial<SimulationAnimationSnapshot>) { state = { ...state, ...patch }; return driver.tick(); } };
  }
  it('plays the dash strip on the simulation clock, not the fixed 6 fps', () => {
    const h = harness({ dash: 4, idle: 4, run: 6 });
    const frames = [0, 5, 6, 13, 19, 40].map(age =>
      h.tick({ frame: age, locomotion: { name: 'initialDash', facing: 1, framesElapsed: age, dashFacing: 1 } })!.frameIndex);
    expect(frames).toEqual([0, 0, 1, 2, 3, 3]);
  });
  it('resolves the new sheet keys through getMoveAnimKey without extra registration', () => {
    expect(getMoveAnimKey('donkeykong', 'walk')).toBe('donkeykong.walk.anim');
    expect(getMoveAnimKey('pikachu', 'walk')).toBe('pikachu.walk.anim');
  });
});

describe('DK ground attacks (installed rework clips) on the attack-age clock', () => {
  const attacking = (move: AttackMove, age: number, facing: 1 | -1 = 1) =>
    resolveSimulationAction(snapshot({ facing, activeAttack: { move, framesElapsed: age, facing } as SimulationAnimationSnapshot['activeAttack'] }));
  it('angled forward tilts select their own drawings; the neutral tilt keeps tilt', () => {
    expect(attacking(DONKEYKONG_TILT, 6)).toMatchObject({ nativeTimedSheet: 'tilt', frame: 6 });
    expect(attacking(DONKEYKONG_TILT.angledVariants!.up, 6)).toMatchObject({ nativeTimedSheet: 'tilt_up', frame: 6 });
    expect(attacking(DONKEYKONG_TILT.angledVariants!.down, 6, -1)).toMatchObject({ nativeTimedSheet: 'tilt_down', facing: -1 });
  });
  it('utilt / dash attack / smashes are native-timed and show the contact drawing on the first active age', () => {
    const contact = (move: AttackMove, sheet: string) => {
      const action = attacking(move, move.startupFrames);
      expect(action.nativeTimedSheet).toBe(sheet);
      return getPackedNativeTimedClip('donkeykong',sheet)!.nativeSampleIndices![selectPackedNativeSampleFrame('donkeykong',sheet, action.frame!)];
    };
    expect(contact(DONKEYKONG_UTILT, 'utilt')).toBe(5);
    expect(contact(DONKEYKONG_DASHATTACK, 'dash_attack')).toBe(9);
    expect(contact(DONKEYKONG_SMASH, 'smash')).toBe(22);
    expect(contact(DONKEYKONG_USMASH, 'usmash')).toBe(14);
    expect(contact(DONKEYKONG_DSMASH, 'dsmash')).toBe(11);
  });
  it('a smash shows its startup until the charge hold frame, then loops its charge clip', () => {
    const charging = (move: AttackMove, startup: number, held: number) => resolveSimulationAction(snapshot({
      chargingMove: move, chargeStartupElapsed: startup, chargeHeldFrames: held }));
    expect(charging(DONKEYKONG_SMASH, 5, 0)).toMatchObject({ nativeTimedSheet: 'smash', frame: 5 });
    for (const [move, sheet] of [[DONKEYKONG_SMASH, 'smash_charge'], [DONKEYKONG_USMASH, 'usmash_charge'], [DONKEYKONG_DSMASH, 'dsmash_charge']] as const) {
      const hold = (move as { chargeStartFrame: number }).chargeStartFrame;
      expect(charging(move, hold, 70)).toMatchObject({ nativeTimedSheet: sheet, frame: 70 });
      expect(selectPackedNativeSampleFrame('donkeykong',sheet, 70)).toBe(selectPackedNativeSampleFrame('donkeykong',sheet, 10));
    }
  });
});

describe('DK specials (installed rework clips) on their action clocks', () => {
  type Active = SimulationAnimationSnapshot['activeAttack'];
  const attacking = (move: AttackMove, age: number, patch: Partial<NonNullable<Active>> = {}, grounded = true) =>
    resolveSimulationAction(snapshot({ grounded, activeAttack: { move, framesElapsed: age, facing: 1, ...patch } as Active }));
  const sample = (action: ReturnType<typeof resolveSimulationAction>) =>
    getPackedNativeTimedClip('donkeykong',action.nativeTimedSheet!)!.nativeSampleIndices![selectPackedNativeSampleFrame('donkeykong',action.nativeTimedSheet!, action.frame!)];
  const air = <T extends AttackMove>(move: T): AttackMove => ({ ...move, sheetVariant: 'air' });
  const up = DONKEYKONG_UP_SPECIAL, slap = DONKEYKONG_DOWN_SPECIAL;

  it('each special shows its contact drawing on its first active age', () => {
    const contact = (move: AttackMove, age: number, sheet: string, patch?: Partial<NonNullable<Active>>) => {
      const action = attacking(move, age, patch);
      expect(action.nativeTimedSheet).toBe(sheet);
      return sample(action);
    };
    expect(contact(DONKEYKONG_NEUTRAL_SPECIAL, 18, 'neutral_special', { chargeHeldFrames: 40 })).toBe(19);
    expect(contact(air(DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!), 18, 'neutral_special_air', { chargeHeldFrames: 40 })).toBe(19);
    // Full charge selects the Max motion, which shares the partial punch drawings.
    expect(contact({ ...DONKEYKONG_NEUTRAL_SPECIAL.fullChargeVariant!, sheetVariant: 'ground' }, 18, 'neutral_special', { chargeHeldFrames: 111 })).toBe(19);
    expect(contact({ ...DONKEYKONG_NEUTRAL_SPECIAL.fullChargeVariant!, sheetVariant: 'air' }, 18, 'neutral_special_air', { chargeHeldFrames: 111 })).toBe(19);
    expect(contact(DONKEYKONG_SIDE_SPECIAL, 19, 'side_special')).toBe(20);
    expect(contact(air(DONKEYKONG_SIDE_SPECIAL.airborneVariant!), 19, 'side_special_air')).toBe(20);
    expect(contact({ ...up.groundedVariant!, id: up.id, type: 'upSpecial', sheetVariant: 'ground' }, 18, 'up_special_ground')).toBe(19);
    expect(contact({ ...slap.shockwave.aerialVariant!, id: slap.id, type: 'downSpecial', sheetVariant: 'air' }, 18, 'down_special_air')).toBe(19);
  });
  it('aerial Spinning Kong maps the 0.6 motion rate onto its hits (first 4, rungs from 12, finisher 60)', () => {
    const at = (age: number) => sample(attacking(up, age, {}, false));
    expect(attacking(up, 0, {}, false).nativeTimedSheet).toBe('up_special_air');
    expect([3, 9, 38, 62].map(at)).toEqual([4, 12, 60, 86]);
  });
  it('the ground Hand Slap holds its first drawing through the 7-frame entry, then slaps on the hit ages', () => {
    const at = (age: number) => sample(attacking(slap, age));
    expect([0, 6, 11, 12, 22, 23, 45].map(at)).toEqual([1, 1, 5, 6, 16, 17, 27]);
  });
  it('Giant Punch phases select the charge loop and cancel drawings; undrawn phases hold them', () => {
    const punch = (phase: 'start' | 'loop' | 'cancel' | 'end', grounded: boolean, age: number, jumpCancel = false) => resolveSimulationAction(snapshot({ grounded,
      packedBody: { ...SCALAR_SNAPSHOT.packedBody!, punch: { phase, age, grounded, facing: 1, jumpCancel } } }));
    expect(punch('loop', true, 30)).toMatchObject({ nativeTimedSheet: 'neutral_special_charge', frame: 30 });
    expect(selectPackedNativeSampleFrame('donkeykong','neutral_special_charge', 30)).toBe(selectPackedNativeSampleFrame('donkeykong','neutral_special_charge', 0));
    expect(punch('loop', false, 3).nativeTimedSheet).toBe('neutral_special_air_charge');
    expect(punch('cancel', true, 0).nativeTimedSheet).toBe('neutral_special_cancel');
    expect(punch('cancel', false, 2, true).nativeTimedSheet).toBe('neutral_special_air_cancel');
    expect(punch('start', true, 4).nativeTimedSheet).toBe('neutral_special_charge');
    expect(punch('end', false, 1).nativeTimedSheet).toBe('neutral_special_air_charge');
  });
  it('special landings select the Spinning Kong / Hand Slap landing drawings', () => {
    const land = (moveId?: string) => resolveSimulationAction(snapshot({
      landingPresentation: { kind: 'special', totalFrames: 10, framesElapsed: 2, remainingFrames: 8, ...(moveId ? { moveId } : {}) } }));
    expect(land('donkeykong.down_special')).toMatchObject({ nativeTimedSheet: 'down_special_air_land', frame: 2 });
    expect(land('donkeykong.up_special').nativeTimedSheet).toBe('up_special_air_land');
    expect(land().nativeTimedSheet).toBe('up_special_air_land');
  });
  it('the special-fall touchdown step shows the landing\'s first drawing, not idle', () => {
    expect(resolveSimulationAction(snapshot({ helpless: true, grounded: true })))
      .toMatchObject({ nativeTimedSheet: 'up_special_air_land', frame: 0 });
    // Still airborne: helpless fall, unchanged.
    expect(packedBodyCandidate(snapshot({ helpless: true, grounded: false }))?.sheet).not.toBe('up_special_air_land');
  });
  it('a landed spin continues on the grounded clip\'s tail (SpecialHi frame 63 onward)', () => {
    const tail = (age: number) => sample(attacking({ ...up.groundedVariant!, id: up.id, type: 'upSpecial', sheetVariant: 'ground' }, age));
    expect([up.groundedLandingFrame!, 74, 75, 103].map(tail)).toEqual([62, 75, 75, 102]);
  });
  it('a repeated ground Hand Slap continues in the loop drawings (rewind lands on the loop start)', () => {
    const rule = slap.shockwave.repeat!;
    const at = (age: number) => sample(attacking(slap, age));
    // Loop start (native loop frame 1) and the loop's last drawn age before the rewind.
    expect([rule.entryFrame, rule.loopFrame - 1].map(at)).toEqual([1, 22]);
  });
});

describe('DK animation tails and pending clips', () => {
  it('a tail continues the finished action\'s clip on its age over the rest it left DK in', () => {
    const tail = (sheet: string, framesElapsed: number, rest = 'ground') => resolveSimulationAction(snapshot({
      packedBody: { ...SCALAR_SNAPSHOT.packedBody!, tail: { sheet, framesElapsed, facing: -1, end: packedAnimationEnd('donkeykong',sheet), rest } } }));
    expect(tail('smash', 57)).toMatchObject({ nativeTimedSheet: 'smash', frame: 57, facing: -1 });
    expect(tail('dash_attack', 40)).toMatchObject({ nativeTimedSheet: 'dash_attack', frame: 40 });
    expect(tail('bthrow', 50)).toMatchObject({ nativeTimedSheet: 'bthrow', frame: 50 });
    // A tail left over another rest (airborne) never shows over standing idle.
    expect(tail('smash', 57, 'air:0')).toMatchObject({ nativeTimedSheet: 'idle' });
  });
  it('the tail ends on the clip\'s last native sample; paired and loop clips have none', () => {
    expect(packedAnimationEnd('donkeykong','smash')).toBe(60);
    expect(packedAnimationEnd('donkeykong','dash_attack')).toBe(60);
    expect(packedAnimationEnd('donkeykong','tilt')).toBe(41);
    expect(packedAnimationEnd('donkeykong','bthrow')).toBe(66);
    expect(packedAnimationEnd('donkeykong','jab')).toBe(0);
    expect(packedAnimationEnd('donkeykong','grab_hold')).toBe(0);
    expect(packedAnimationEnd('donkeykong','cargo_hold')).toBe(0);
  });
  it('helpless fall selects fall_special once that clip is installed', () => {
    expect(resolveSimulationAction(snapshot({ helpless: true, grounded: false,
      ordinaryPresentation: { sheet: 'fall_special', framesElapsed: 9, facing: 1 } })))
      .toMatchObject({ nativeTimedSheet: 'fall_special', frame: 9 });
    expect(getMoveAnimKey('donkeykong', 'fall_special')).toBe('donkeykong.fall_special.anim');
  });
});

// SmashWiki Buried (https://www.ssbwiki.com/Buried): "Fighters are normally buried upright"; "a character's bury time ending
// causes them to automatically jump". DK's motion list has no bury motion, so the standing wait drawing shows (sunk by the
// renderer, buriedPresentation.ts) and the escape is the ordinary jump on the escape clock.
describe('DK bury and respawn presentation', () => {
  it('buried shows the upright standing drawing; the escape shows the jump from its first drawing', () => {
    expect(packedBodyCandidate(snapshot({ buriedPresentation: { phase: 'buried', framesElapsed: 30, facing: -1 } })))
      .toMatchObject({ sheet: 'idle', age: 30, facing: -1 });
    expect(packedBodyCandidate(snapshot({ buriedPresentation: { phase: 'escaping', framesElapsed: 0, facing: 1 } })))
      .toMatchObject({ sheet: 'jump', age: 0, facing: 1 });
  });
  it('a respawn presentation never selects the Entry clip (Entry is the pre-match intro)', () => {
    expect(packedBodyCandidate(snapshot({ respawnPresentation: { framesElapsed: 10, facing: 1 } }))?.sheet).toBe('idle');
  });
});

describe('Pikachu render metrics are untouched', () => {
  it('reviewed Pikachu strips keep their root/scale contract', () => {
    expect(getPikachuSheetRenderMetrics('idle')).toMatchObject({ scaleToWorld: expect.any(Number), bodyCentreFromRootY: -25 });
    expect(getPikachuSheetRenderMetrics('walk').bodyCentreFromRootY).toBe(-25);
  });
});

describe('DK as the recipient of another DK\'s Cargo Throw (extras2 clips)', () => {
  const body = (cargoRecipient: NonNullable<SimulationAnimationSnapshot['packedBody']>['cargoRecipient']) => ({ ...SCALAR_SNAPSHOT.packedBody!, cargoRecipient });
  const captured = (cargoRecipient: NonNullable<SimulationAnimationSnapshot['packedBody']>['cargoRecipient'], framesElapsed = 0) => snapshot({
    grabbed: true, capturePresentation: { active: true, framesElapsed, facing: -1, event: { kind: 'entry', framesElapsed } } as SimulationAnimationSnapshot['capturePresentation'],
    packedBody: body(cargoRecipient) });
  it('carried: the loop clip on the captor cargo age; no cargo state keeps the held drawing', () => {
    expect(packedBodyCandidate(captured({ throw: null, age: 20 }))).toMatchObject({ sheet: 'cargo_recipient_carried', age: 20, facing: -1, rest: 'cargo-recipient' });
    expect(packedBodyCandidate(captured(null))).toMatchObject({ sheet: 'captured' });
  });
  it.each([['forward', 'cargo_recipient_fthrow'], ['back', 'cargo_recipient_bthrow'], ['up', 'cargo_recipient_uthrow'], ['down', 'cargo_recipient_dthrow']] as const)(
    '%s throw: %s on the captor\'s throw age, one drawing at the native sample', (direction, sheet) => {
      expect(packedBodyCandidate(captured({ throw: { direction, age: 8 }, age: 8 }))).toMatchObject({ sheet, age: 8, action: true });
      const clip = getPackedNativeTimedClip('donkeykong',sheet)!;
      expect(clip.nativeSampleIndices![0]).toBe(1);
      expect(selectPackedNativeSampleFrame('donkeykong',sheet, 8)).toBe(2);
    });
});

import type {SimulationSpriteSurface,SimulationAnimationCatalog} from './simulationSpriteAnimation';
