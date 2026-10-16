import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PIKACHU_CATCH_REGIONS, PIKACHU_CATCH_TIMELINES, PIKACHU_PUMMEL, PIKACHU_THROWS,
  PIKACHU_THROW_SOURCES, buildPikachuGrab, pikachuCatchHits, type PikachuCatchMotion } from './pikachuGrab';
import { selectAttackCollisionHit } from './attackCollisionShapes';
import { computeKnockback } from './combat';
import { validateThrowSet } from './throwSchema';
import { PIKACHU_BACK_THROW_ROOT_MOTION_X, PIKACHU_BACK_THROW_ROOT_MOTION_PROVENANCE } from './pikachuBackThrowRootMotion';

const sources = JSON.parse(readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/native-grab-records.json', import.meta.url), 'utf8'));
const ufd = JSON.parse(readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/ufd-moves.json', import.meta.url), 'utf8'));
// Explicit fixture policy, never advertised as acquired native parameters.
const policy = { holdFramesMax: 90, escapeRecoveryFrames: 20, dashMomentumRetain: 0.5 };

describe('Pikachu grab preparation provenance and source boundaries', () => {
  it('binds the49-step beta backthrow transport to exact native samples without sparse interpolation', () => {
    const bytes = readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/full-body-native-review/capture/back-throw-exact-root-trajectory.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PIKACHU_BACK_THROW_ROOT_MOTION_PROVENANCE.sha256);
    const retained = JSON.parse(bytes.toString('utf8')).rows;
    expect(retained).toHaveLength(66);
    expect(retained.map((row: { nativeFrame: number }) => row.nativeFrame)).toEqual(Array.from({ length: 66 }, (_, i) => i));
    expect(PIKACHU_BACK_THROW_ROOT_MOTION_X).toHaveLength(PIKACHU_THROWS.back.animationFrames + PIKACHU_THROWS.back.recoveryFrames!);
    expect(PIKACHU_BACK_THROW_ROOT_MOTION_X).toEqual(retained.slice(0, 49).map((row: { worldDisplacementInEntryFacingBasis: { x: number; y: number } }) =>
      row.worldDisplacementInEntryFacingBasis.x - retained[0].worldDisplacementInEntryFacingBasis.x));
    expect(retained.every((row: { worldDisplacementInEntryFacingBasis: { y: number } }) => row.worldDisplacementInEntryFacingBasis.y === 0)).toBe(true);
    expect(PIKACHU_BACK_THROW_ROOT_MOTION_X[0]).toBe(0);
    expect(buildPikachuGrab(policy).throws!.back.rootMotionX).toEqual(PIKACHU_BACK_THROW_ROOT_MOTION_X);
    for (const direction of ['forward', 'up', 'down'] as const)
      expect(PIKACHU_THROWS[direction].rootMotionX).toBeUndefined();
  });
  it.each(['Catch', 'CatchDash', 'CatchTurn'] as const)('preserves all %s native CATCH geometry and source intervals', motion => {
    const capture = sources.catches[motion].catches;
    for (const [index, row] of PIKACHU_CATCH_REGIONS[motion].entries()) {
      const { situation, ...geometry } = row;
      expect(capture[index]).toMatchObject(geometry);
      expect(capture[index].situation).toBe(situation === 'ground' ? 'COLLISION_SITUATION_MASK_G' : 'COLLISION_SITUATION_MASK_A');
      expect(capture[index].status).toBe('FIGHTER_STATUS_KIND_CAPTURE_PULLED');
      expect(capture[index].frame).toBe(PIKACHU_CATCH_TIMELINES[motion].firstGameFrame);
      expect(capture[index].end_frame - 1).toBe(PIKACHU_CATCH_TIMELINES[motion].lastGameFrame);
    }
  });

  it('uses separate UFD standing/dash/pivot commitment with explicit shared-engine policy', () => {
    const grab = buildPikachuGrab(policy);
    for (const [name, spec] of [['Grab', grab], ['Dash Grab', grab.dashGrab!], ['Pivot Grab', grab.pivotGrab!]] as const) {
      const row = ufd.moves.find((move: any) => move.movename === name);
      expect(spec.startupFrames).toBe(Number(row.startup) - 1);
      expect(spec.activeFrames).toBe(2);
      expect(spec.startupFrames! + spec.activeFrames! + spec.whiffRecoveryFrames!).toBe(Number(row.totalframes));
    }
    expect(grab.holdFramesMax).toBe(policy.holdFramesMax);
    expect(grab.throwRecoveryFrames).toBe(policy.escapeRecoveryFrames);
    expect(grab.dashGrab!.momentumRetain).toBe(policy.dashMomentumRetain);
    expect(() => buildPikachuGrab({ ...policy, holdFramesMax: 0 })).toThrow('authored hold cap');
    expect(() => buildPikachuGrab({ ...policy, escapeRecoveryFrames: -1 })).toThrow('authored escape recovery');
    expect(() => buildPikachuGrab({ ...policy, dashMomentumRetain: NaN })).toThrow('authored momentum');
  });

  it.each([1, -1] as const)('preserves ground/air grab masks and exact far-edge misses, facing %s', facing => {
    const origin = { x: 0, y: 0 };
    const bounds = (x: number, y: number) => ({ min: { x: x * facing - 0.1, y: y - 0.1 }, max: { x: x * facing + 0.1, y: y + 0.1 } });
    const standing = pikachuCatchHits('Catch');
    expect(selectAttackCollisionHit(standing, origin, facing, [bounds(35, 10)], true)?.id).toBe(0);
    expect(selectAttackCollisionHit(standing, origin, facing, [bounds(35, 10)], false)).toBeUndefined();
    expect(selectAttackCollisionHit(standing, origin, facing, [bounds(35, -4.5)], false)?.id).toBe(1);
    const edges: [PikachuCatchMotion, number, number][] = [['Catch', 59.5, -4.5], ['CatchDash', 57.5, 0], ['CatchTurn', 79, 0]];
    for (const [motion, edge, y] of edges) {
      const hits = pikachuCatchHits(motion);
      expect(selectAttackCollisionHit(hits, origin, facing, [bounds(edge - 0.2, y)], true)).toBeDefined();
      expect(selectAttackCollisionHit(hits, origin, facing, [bounds(edge + 0.2, y)], true)).toBeUndefined();
    }
  });

  it('retains pummel1 damage and UFD16 total including11 hitlag without inventing posed geometry', () => {
    const row = ufd.moves.find((move: any) => move.movename === 'Pummel');
    const native = sources.catches.CatchAttack.attacks[0];
    expect(PIKACHU_PUMMEL).toMatchObject({ damage: Number(row.basedamage), cooldownFrames: Number(row.totalframes),
      hitlagFrames: 11, hitlagMultiplier: native.hitlag, sdiMultiplier: native.sdi, startupFrames: native.frame - 1 });
    expect(row.notes).toContain('11 frames of hitlag');
    expect(native.bone).toBe('trans');
    expect(sources.catches.CatchAttack.events.some((event: any) => event.raw.includes('set_catch_only_all'))).toBe(true);
  });

  it.each(['forward', 'back', 'up', 'down'] as const)('preserves %s ABS launch damage, distinct catch ABS and explicit selected release clock', direction => {
    const source = PIKACHU_THROW_SOURCES[direction];
    const capture = sources.catches[source.motion];
    const absolute = capture.absolutes.find((row: any) => row.kind === 'FIGHTER_ATTACK_ABSOLUTE_KIND_THROW');
    expect(absolute).toMatchObject({ damage: source.damage, angle: source.angle, kbg: source.kbg, fkb: source.fkb, bkb: source.bkb });
    expect(capture.absolutes).toHaveLength(2);
    expect(capture.events.find((event: any) => event.type === 'apply_absolute').frame).toBe(source.releaseMotionFrame);
    const prepared = PIKACHU_THROWS[direction];
    expect(prepared.damage).toBe(source.damage);
    expect(prepared.hitlagMultiplier).toBe(absolute.hitlag);
    expect(source.releaseHitlag).toBe(absolute.hitlag);
    expect(prepared.electricCollision).toBe(false);
    expect(prepared.invincibilityFrames).toBe(direction === 'down' ? undefined : source.releaseMotionFrame);
    expect(prepared.animationFrames).toBe(source.selectedGameReleaseFrame - 1);
    expect(prepared.animationFrames + prepared.recoveryFrames!).toBe(source.totalFrames);
  });

  it('adds only proved catch-only pre-release damage, without conflating damage-kind ABS rows', () => {
    expect(validateThrowSet(PIKACHU_THROWS, 'pikachu')).toBe(PIKACHU_THROWS);
    const nativeForward = sources.catches.ThrowF.attacks;
    expect(PIKACHU_THROWS.forward.heldTargetHits).toEqual(nativeForward.map((row: any) => ({ frame: row.frame - 1, damage: row.damage,
      hitlagMultiplier: row.hitlag, electricCollision: row.attribute === 'collision_attr_elec' })));
    const nativeUp = sources.catches.ThrowHi.attacks[0];
    expect(PIKACHU_THROWS.up.heldTargetHits).toEqual([{ frame: nativeUp.frame - 1, damage: nativeUp.damage, hitlagMultiplier: nativeUp.hitlag }]);
    expect(PIKACHU_THROWS.back.heldTargetHits).toBeUndefined();
    expect(PIKACHU_THROWS.down.heldTargetHits).toBeUndefined();
    const zeroDuration = sources.catches.ThrowLw.attacks[0];
    expect(zeroDuration.frame).toBe(zeroDuration.end_frame);
    expect(PIKACHU_THROWS.forward.damage + PIKACHU_THROWS.forward.heldTargetHits!.reduce((sum, hit) => sum + hit.damage, 0)).toBe(10);
    expect(PIKACHU_THROWS.up.damage + PIKACHU_THROWS.up.heldTargetHits![0]!.damage).toBe(8);
  });

  it.each([1, -1] as const)('expresses native back-throw135 correctly in runtime reversed-facing basis, facing %s', facing => {
    const prepared = PIKACHU_THROWS.back;
    const runtime = computeKnockback({ damage: 9, knockback: prepared.knockback, facing: facing === 1 ? -1 : 1 }, 75, 1);
    const native = computeKnockback({ damage: 9, knockback: { x: -1, y: -1, scaling: 0,
      reference: { angle: 135, base: 85, growth: 50 } }, facing }, 75, 1);
    expect(runtime.vector.x).toBeCloseTo(native.vector.x);
    expect(runtime.vector.y).toBeCloseTo(native.vector.y);
    expect(runtime.vector.x * facing).toBeLessThan(0);
  });
});
