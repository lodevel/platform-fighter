import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PIKACHU_NORMAL_SPECS, buildPikachuForwardTilt, buildPikachuNormalMove,
  pikachuNormalFrame, pikachuNormalNativeRegions, pikachuNormalSpec, type PikachuNormalId } from './pikachuNormalMoves';
import { type PikachuPoseProjector } from './pikachuSourceMoves';
import { attackHitWindowIndex, resolveAttackHitWindow } from './attackHitWindows';
import { getMoveBusyFrames } from './moveSchema';
import { getLandingLagFrames, validateAerialMove, type AerialMove } from './aerialSchema';
import { computeChargedDamageFromSpec } from './chargeSchema';

/** Deliberately synthetic offsets exercise the requirement/dispatch only.
 * These are not Pikachu poses and are never used outside this test. */
const syntheticPose: PikachuPoseProjector = (row, frame) => ({
  start: { x: frame + row.id, y: row.id }, end: { x: frame + row.id + 1, y: row.id },
});

const ufd = JSON.parse(readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/ufd-moves.json', import.meta.url), 'utf8'));
const ufdNames: Record<PikachuNormalId, string> = {
  'forward-tilt': 'Forward Tilt', 'forward-tilt-up': 'Forward Tilt', 'forward-tilt-down': 'Forward Tilt',
  'up-tilt': 'Up Tilt', 'down-tilt': 'Down Tilt', 'dash-attack': 'Dash Attack', 'forward-smash': 'Forward Smash',
  'up-smash': 'Up Smash', 'down-smash': 'Down Smash', 'neutral-air': 'Neutral Air', 'forward-air': 'Forward Air',
  'back-air': 'Back Air', 'up-air': 'Up Air', 'down-air': 'Down Air',
  'back-air-landing': 'Back Air', 'down-air-landing': 'Down Air',
};

describe('Pikachu normal preparation source boundaries', () => {
  it.each(PIKACHU_NORMAL_SPECS)('keeps $id total and landing commitment tied to captured UFD', spec => {
    const row = ufd.moves.find((move: any) => move.movename === ufdNames[spec.id]);
    expect(spec.totalFrames).toBe(Number(spec.entry === 'landing' ? row.landinglag : row.totalframes));
    const typed = pikachuNormalSpec(spec.id);
    if (typed.entry === 'air') expect(typed.landingLagFrames).toBe(Number(row.landinglag));
  });

  it('requires posed transforms for every non-root normal and aerial', () => {
    for (const id of ['forward-tilt', 'forward-tilt-up', 'forward-tilt-down', 'up-tilt', 'dash-attack', 'up-smash', 'back-air', 'up-air', 'down-air'] as const) {
      expect(() => buildPikachuNormalMove(id)).toThrow('Missing posed Pikachu bone');
    }
    const tilted = buildPikachuForwardTilt(syntheticPose);
    expect(tilted.angledVariants?.up.collisionHits?.map(h => h.damage)).toEqual([10, 10, 10]);
    expect(tilted.angledVariants?.down.collisionHits?.map(h => h.damage)).toEqual([8, 8, 8]);
    expect(tilted.collisionHits?.map(h => h.damage)).toEqual([9, 9, 9]);
  });

  it('preserves frame-specific pose projection without inventing new strike identity', () => {
    const move = buildPikachuNormalMove('up-air', syntheticPose);
    const clean = move.hitWindows!.find(w => w.startFrame === 3)!;
    const late = move.hitWindows!.find(w => w.startFrame === 6)!;
    expect(clean.collisionHits?.map(h => h.damage)).toEqual([6, 6, 5]);
    expect(late.collisionHits?.map(h => h.damage)).toEqual([4, 4, 4]);
    expect(clean.collisionHits![0]!.capsule.start.x).toBe(4);
    expect(late.collisionHits![0]!.capsule.start.x).toBe(7);
    expect(clean.group).toBe(late.group);
  });

  it('transports electric hitlag only on native electric collision rows', () => {
    expect(pikachuNormalFrame('neutral-air', 2).collisionHits.every(hit => hit.electricCollision === true)).toBe(true);
    expect(pikachuNormalFrame('forward-smash', 14).collisionHits.every(hit => hit.electricCollision === true)).toBe(true);
    expect(pikachuNormalFrame('forward-tilt', 5, syntheticPose).collisionHits.every(hit => hit.electricCollision === true)).toBe(true);
    expect(pikachuNormalFrame('up-air', 3, syntheticPose).collisionHits.every(hit => hit.electricCollision !== true)).toBe(true);
  });

  it('retains native trip bonuses and frame-specific setoff replacements', () => {
    const dtilt = buildPikachuNormalMove('down-tilt');
    expect(dtilt.collisionHits?.every(hit => hit.tripChance === 0.3 && hit.setoff === 'on')).toBe(true);
    const dsmash = pikachuNormalSpec('down-smash');
    const linker = pikachuNormalFrame('down-smash', dsmash.contacts[0]!.first - 1);
    const finisher = pikachuNormalFrame('down-smash', 22);
    expect(linker.collisionHits.every(hit => hit.tripChance === 0 && hit.setoff === 'off')).toBe(true);
    expect(finisher.collisionHits.every(hit => hit.tripChance === 0.3 && hit.setoff === 'off')).toBe(true);
    // Frame20's THRU replacement must override the owning move's initial OFF.
    const fsmash = buildPikachuNormalMove('forward-smash');
    expect(fsmash.setoff).toBe('off');
    const lateWindow = fsmash.hitWindows![attackHitWindowIndex(fsmash, 19)]!;
    expect(resolveAttackHitWindow(fsmash, fsmash, lateWindow).collisionHits?.[0]?.setoff).toBe('through');
  });

  it('keeps all fsmash geometry replacements in one strike until frame30 clear', () => {
    const move = buildPikachuNormalMove('forward-smash');
    const actual = [14, 15, 16, 17, 19, 23].map(elapsed => {
      const window = move.hitWindows![attackHitWindowIndex(move, elapsed)]!;
      const resolved = resolveAttackHitWindow(move, move, window);
      return [window.group, resolved.collisionHits![0]!.damage, resolved.collisionHits![0]!.capsule.start.x];
    });
    expect(actual).toEqual([['fsmash', 15, 46], ['fsmash', 15, 56], ['fsmash', 18, 73],
      ['fsmash', 18, 93], ['fsmash', 12, 115], ['fsmash', 12, 125]]);
    expect(attackHitWindowIndex(move, 13)).toBe(-1);
    expect(attackHitWindowIndex(move, 29)).toBe(-1);
    expect(getMoveBusyFrames(move)).toBe(53);
  });

  it('keeps the down-smash gaps and distinct sixth strike instead of one broad envelope', () => {
    const move = buildPikachuNormalMove('down-smash');
    for (const elapsed of [9, 12, 15, 18, 21, 23]) expect(attackHitWindowIndex(move, elapsed)).toBe(-1);
    const finisher = move.hitWindows![attackHitWindowIndex(move, 22)]!;
    expect(finisher.collisionHits).toMatchObject([{ id: 0, damage: 3, capsule: { radius: 50 } }]);
    expect(new Set(move.hitWindows!.map(w => w.group)).size).toBe(6);
    expect(getMoveBusyFrames(move)).toBe(65);
  });

  it('applies explicit UFD damage precedence while leaving native captures unchanged', () => {
    expect(pikachuNormalFrame('neutral-air', 2).collisionHits[0]!.damage).toBe(1.7);
    expect(pikachuNormalFrame('forward-air', 10).collisionHits.map(h => h.damage)).toEqual([1.3, 1.3, 1.3, 1.3]);
    expect(pikachuNormalFrame('back-air', 23, syntheticPose).collisionHits[0]!.damage).toBe(3.5);
    expect(pikachuNormalNativeRegions('neutral-air')[0]!.damage).toBe(1.8);
    expect(pikachuNormalNativeRegions('forward-air')[0]!.damage).toBe(1.4);
    expect(pikachuNormalNativeRegions('back-air').at(-1)!.damage).toBe(3.6);
  });

  it('refuses fair once-per-group substitution for native per-target rehit3', () => {
    expect(() => buildPikachuNormalMove('forward-air')).toThrow('per-target rehit');
    expect(pikachuNormalFrame('forward-air', 11)).toMatchObject({ strike: 'fair:link', perTargetRehitFrames: 3 });
    expect(pikachuNormalFrame('forward-air', 13)).toMatchObject({ strike: 'fair:link', perTargetRehitFrames: 3 });
    expect(pikachuNormalFrame('forward-air', 25).collisionHits).toEqual([]);
    expect(pikachuNormalFrame('forward-air', 26)).toMatchObject({ strike: 'fair:finish', collisionHits: [{ damage: 4.8 }] });
    expect(pikachuNormalFrame('forward-air', 26).perTargetRehitFrames).toBeUndefined();
  });

  it('requires explicit authored fair clock opt-in while preserving continuous native linker/gap/finisher identity', () => {
    const move = buildPikachuNormalMove('forward-air', undefined, { rehitClockPolicy: 'authored-attack-elapsed' }) as AerialMove;
    expect(move.rehitClockPolicy).toBe('authored-attack-elapsed');
    expect(validateAerialMove(move)).toBe(move);
    for (let elapsed = 10; elapsed < 25; elapsed++) {
      const window = move.hitWindows![attackHitWindowIndex(move, elapsed)]!;
      expect(window.group).toBe('fair:link');
      expect(window.collisionHits?.map(hit => [hit.damage, hit.rehitFrames])).toEqual([[1.3, 3], [1.3, 3], [1.3, 3], [1.3, 3]]);
    }
    expect(attackHitWindowIndex(move, 25)).toBe(-1);
    expect(move.hitWindows![attackHitWindowIndex(move, 26)]).toMatchObject({ group: 'fair:finish', collisionHits: [{ damage: 4.8, rehitFrames: 0 }] });
    expect(attackHitWindowIndex(move, 27)).toBe(-1);
    expect(() => buildPikachuNormalMove('up-air', undefined, { rehitClockPolicy: 'authored-attack-elapsed' })).toThrow('Missing posed Pikachu bone');
  });

  it.each(['neutral-air', 'back-air', 'up-air', 'down-air'] as const)('preserves %s autocancel boundaries', id => {
    const move = buildPikachuNormalMove(id, syntheticPose) as AerialMove;
    expect(validateAerialMove(move)).toBe(move);
    for (const window of move.autoCancelWindows!) {
      expect(getLandingLagFrames(move, window.startFrame)).toBe(0);
      if (window.startFrame > 0) expect(getLandingLagFrames(move, window.startFrame - 1)).toBe(move.landingLagFrames);
    }
  });

  it('attaches the separate sourced landing contacts to the automatic aerial route', () => {
    for (const id of ['back-air-landing', 'down-air-landing'] as const) {
      const move = buildPikachuNormalMove(id);
      expect(move.startupFrames).toBe(0);
      expect(move.hitWindows).toHaveLength(2);
      expect(pikachuNormalFrame(id, 0).collisionHits[0]!.damage).toBe(4);
      expect(pikachuNormalFrame(id, 2).collisionHits).toEqual([]);
      const aerialId = id === 'back-air-landing' ? 'back-air' : 'down-air';
      expect((buildPikachuNormalMove(aerialId, syntheticPose) as AerialMove).landingAttack).toEqual(move);
    }
  });

  it.each(['forward-smash', 'up-smash', 'down-smash'] as const)('uses captured %s charge cap/hold and preserves regional launch', id => {
    const native = JSON.parse(readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/native-fighter-pikachu.json', import.meta.url), 'utf8')).parameters;
    const prefix = { 'forward-smash': 'attack_s4', 'up-smash': 'attack_hi4', 'down-smash': 'attack_lw4' }[id];
    const spec = pikachuNormalSpec(id);
    expect(spec.charge).toMatchObject({ damageCapFrames: native[`${prefix}_hold_frame`],
      keepFrames: native[`${prefix}_hold_keep_frame`], maximumMultiplier: native[`${prefix}_smash_hold_attack_up`] });
    const move = buildPikachuNormalMove(id, syntheticPose);
    const elapsed = spec.contacts[0]!.first - 1;
    const base = pikachuNormalFrame(id, elapsed, syntheticPose);
    const full = pikachuNormalFrame(id, elapsed, syntheticPose, 60);
    const overheld = pikachuNormalFrame(id, elapsed, syntheticPose, 120);
    expect(computeChargedDamageFromSpec(move.charge!, 60)).toBeCloseTo(base.collisionHits[0]!.damage! * 1.4);
    expect(full.collisionHits).toEqual(overheld.collisionHits);
    for (let i = 0; i < full.collisionHits.length; i++) {
      expect(full.collisionHits[i]!.damage).toBeCloseTo(base.collisionHits[i]!.damage! * 1.4);
      expect(full.collisionHits[i]!.knockback).toEqual(base.collisionHits[i]!.knockback);
    }
  });
});
