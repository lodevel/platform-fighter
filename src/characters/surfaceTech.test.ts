import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { advanceTechInputWindow, beginSurfaceTech, surfaceTechActionable, surfaceTechEntryVelocity,
  surfaceTechProtected, selectSurfaceTech, tickSurfaceTech, classifySurfaceTechContact,
  surfaceTechCeilingDisplacement, type SurfaceTechProfile } from './surfaceTech';
import { SURFACE_TECH_PROFILES } from './surfaceTechProfiles';

const DK = SURFACE_TECH_PROFILES.donkeykong;
const withWall = (wallDurationFrames: number): SurfaceTechProfile => ({ ...DK, wallDurationFrames });

const contact = { surface: 'wall' as const, airborne: true, tumbling: true,
  hitstunRemaining: 5, bufferRemaining: 1, lockoutRemaining: 0,
  launchSpeedPixels: 29.999, jumpHeld: false };

describe('shared surface tech: DK source declarations and adapters', () => {
  it('derives capabilities and fighter scalars from the pinned native DK entry, independently of the helper', () => {
    const raw = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
    const entry = raw.struct.list.struct.find((row: { hash40: { '@hash': string; '#text': string }[] }) =>
      row.hash40.some(field => field['@hash'] === 'fighter_kind' && field['#text'] === 'fighter_kind_donkey'));
    expect(entry).toBeDefined();
    const scalar = (name: string) => Number(entry.float.find((row: { '@hash': string }) => row['@hash'] === name)['#text']);
    const { passiveWallSpeedX, passiveWallJumpSpeedX, passiveWallJumpSpeedY, passiveCeilingSpeedX } = DK;
    expect({ passiveWallSpeedX, passiveWallJumpSpeedX, passiveWallJumpSpeedY, passiveCeilingSpeedX }).toEqual({ passiveWallSpeedX: scalar('passive_wall_x_speed'),
      passiveWallJumpSpeedX: scalar('passive_wall_jump_x_speed'), passiveWallJumpSpeedY: scalar('passive_wall_jump_y_speed'),
      passiveCeilingSpeedX: scalar('passive_ceil_x_speed') });
    for (const flag of ['squat_walk_type', 'wall_jump_type', 'attach_wall_type']) {
      expect(entry.bool.find((row: { '@hash': string }) => row['@hash'] === flag)['#text'], flag).toBe('False');
    }
  });
  it('binds every protection boundary and ceiling duration to the primary native motion list, keeping cancel0 unknown', () => {
    const raw = readFileSync('docs/review/2026-10-06/dk-all-attack-values/sources/motion-list.yml', 'utf8');
    for (const kind of ['wall', 'wall-jump', 'ceiling'] as const) {
      let state = beginSurfaceTech(kind, 1, -1, withWall(23));
      const motion = kind === 'ceiling' ? 'passive_ceil' : kind === 'wall-jump' ? 'passive_wall_jump' : 'passive_wall';
      const block = new RegExp(`^  ${motion}:\\n([\\s\\S]*?)(?=^  \\w+:)`, 'm').exec(raw)![1]!;
      const start = Number(/xlu_start: (\d+)/.exec(block)![1]);
      const end = Number(/xlu_end: (\d+)/.exec(block)![1]);
      const cancel = Number(/cancel_frame: (\d+)/.exec(block)![1]);
      if (kind === 'ceiling') expect(state.durationFrames).toBe(cancel - 1);
      else expect(cancel).toBe(0); // no status duration inferred from this field
      for (let age = 0; age < state.durationFrames; age++) {
        expect(surfaceTechProtected(state), `${kind} age${age}`)
          .toBe(start > 0 && age + 1 >= start && age + 1 < end);
        if (age + 1 < state.durationFrames) state = tickSurfaceTech(state)!;
      }
      expect(tickSurfaceTech(state)).toBeNull();
    }
    expect(() => beginSurfaceTech('wall', 1, 1, withWall(0))).toThrow();
  });
  it('selects wall-tech jump from held jump without granting ordinary DK wall-jump capability', () => {
    expect(selectSurfaceTech(contact)).toBe('wall');
    expect(selectSurfaceTech({ ...contact, jumpHeld: true })).toBe('wall-jump');
    expect(selectSurfaceTech({ ...contact, surface: 'ceiling', jumpHeld: true })).toBe('ceiling');
    expect(selectSurfaceTech({ ...contact, hitstunRemaining: 0 })).toBeNull();
    expect(selectSurfaceTech({ ...contact, tumbling: false })).toBeNull();
    expect(selectSurfaceTech({ ...contact, airborne: false })).toBeNull();
    expect(selectSurfaceTech({ ...contact, launchSpeedPixels: 30 })).toBeNull();
    expect(selectSurfaceTech({ ...contact, lockoutRemaining: 1 })).toBeNull();
    expect(selectSurfaceTech({ ...contact, bufferRemaining: 0 })).toBeNull();
  });
  it.each([-1, 1] as const)('converts distinct DK scalar impulses for outward%s and keeps jump flight vulnerable/actionable after its entry event', outward => {
    const jump = beginSurfaceTech('wall-jump', 1, outward, DK);
    expect(surfaceTechEntryVelocity(jump, DK)).toEqual({ x: outward * 6.5, y: -13.5 });
    expect(surfaceTechProtected(jump)).toBe(false);
    expect(surfaceTechActionable(jump)).toBe(false);
    expect(surfaceTechActionable(tickSurfaceTech(jump)!)).toBe(true);
    expect(jump.durationFrames).toBe(40); // native drawing extent, not a40-frame lockout
    const wall = beginSurfaceTech('wall', 1, outward, withWall(23));
    expect(surfaceTechEntryVelocity(wall, DK)).toEqual({ x: outward * 2.5, y: 0 });
    expect(surfaceTechActionable(wall)).toBe(false);
  });
  it('freezes the status age and exits on actual landing instead of holding airborne commitment on the floor', () => {
    const state = beginSurfaceTech('ceiling', -1, 1, DK);
    expect(tickSurfaceTech(state, { frozen: true })).toBe(state);
    expect(tickSurfaceTech(state, { grounded: true })).toBeNull();
    expect(surfaceTechEntryVelocity(state, DK, -8)).toEqual({ x: -5, y: 0 });
    expect(surfaceTechEntryVelocity(state, DK, 3)).toEqual({ x: 3, y: 0 });
  });
  it('accepts a fresh hitlag edge and preserves all11 samples without held refresh; missed-window penalty is explicit gameplay policy', () => {
    let state = advanceTechInputWindow({ bufferRemaining: 0, lockoutRemaining: 0 },
      { pressed: true, canTechLaunch: true, frozen: true });
    expect(state.bufferRemaining).toBe(11);
    for (let i = 0; i < 20; i++) {
      state = advanceTechInputWindow(state, { pressed: false, canTechLaunch: true, frozen: true });
      expect(state.bufferRemaining).toBe(11);
    }
    for (let i = 0; i < 10; i++) {
      state = advanceTechInputWindow(state, { pressed: false, canTechLaunch: true });
      expect(state.bufferRemaining).toBe(10 - i);
    }
    state = advanceTechInputWindow(state, { pressed: true, canTechLaunch: true });
    expect(state).toEqual({ bufferRemaining: 0, lockoutRemaining: 40 });
    expect(advanceTechInputWindow(state, { pressed: true, canTechLaunch: true, frozen: true })).toEqual(state);
    expect(advanceTechInputWindow({ bufferRemaining: 0, lockoutRemaining: 0 },
      { pressed: true, canTechLaunch: false }).bufferRemaining).toBe(0);
  });
});

describe('shared surface tech: one path for every fighter', () => {
  it('gives every fighter the wall-jump tech and its own native speeds', () => {
    for (const profile of Object.values(SURFACE_TECH_PROFILES)) {
      const jump = beginSurfaceTech('wall-jump', 1, 1, profile);
      expect(surfaceTechEntryVelocity(jump, profile)).toEqual({ x: profile.passiveWallJumpSpeedX * 5, y: -profile.passiveWallJumpSpeedY * 5 });
    }
    expect(SURFACE_TECH_PROFILES.link.passiveWallJumpSpeedY).toBe(2.6);
  });
  it('follows a ceiling root track only for a fighter that has one', () => {
    const pikachu = SURFACE_TECH_PROFILES.pikachu, a = beginSurfaceTech('ceiling', -1, 1, pikachu), b = tickSurfaceTech(a)!;
    expect(surfaceTechCeilingDisplacement(a, b, pikachu)).toEqual({ x: -(pikachu.ceilingRootDeltas![1]!.x - pikachu.ceilingRootDeltas![0]!.x),
      y: pikachu.ceilingRootDeltas![1]!.y - pikachu.ceilingRootDeltas![0]!.y });
    expect(surfaceTechCeilingDisplacement(a, b, DK)).toBeNull();
  });
  it('classifies only wall and ceiling contacts', () => {
    expect(classifySurfaceTechContact({ x: 0, y: -1 })).toBeNull();
    expect(classifySurfaceTechContact({ x: .7, y: .7 })).toBeNull();
    expect(classifySurfaceTechContact({ x: NaN, y: 1 })).toBeNull();
    expect(classifySurfaceTechContact({ x: 1, y: 0 })).toEqual({ kind: 'wall', outward: 1 });
    expect(classifySurfaceTechContact({ x: -1, y: 0 })).toEqual({ kind: 'wall', outward: -1 });
    expect(classifySurfaceTechContact({ x: 0, y: 1 })?.kind).toBe('ceiling');
  });
});
