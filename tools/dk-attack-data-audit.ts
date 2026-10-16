import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as dk from '../src/characters/DonkeyKong';
import { getAuthorableCharacterSpec } from '../src/characters/authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from '../src/characters/characterSerializer';
import { resolveAttackHitWindow } from '../src/characters/attackHitWindows';
import type { AttackMove, AttackCollisionHit } from '../src/characters/attacks';

const base = 'docs/review/2026-10-06/dk-all-attack-values';
const comparisons: unknown[] = [];
/** Independent parser of the verified raw scripts, including ATTACK_ABS's shorter signature. */
export function sourceHits(motion: string) {
  const raw = readFileSync(`${base}/sources/${motion}.txt`, 'utf8');
  const game = raw.slice(raw.indexOf('unsafe extern "C" fn game_')).split('unsafe extern "C" fn')[1]!;
  const rows: { frame: number; id: number; damage: number; angle: number; growth: number; fixed: number; base: number; setWeight: boolean; hitlag: number; sdi: number; shieldDamage: number; situation: string; targetCategory: string; launchDirection: string; radius: number }[] = [];
  let frame = 0;
  for (const line of game.split('\n')) {
    const timing = /(?:frame|wait)\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    if (timing) frame = line.includes('wait(') ? frame + Number(timing[1]) : Number(timing[1]);
    const hit = /macros::ATTACK\(agent, (.*)\);/.exec(line);
    if (!hit) continue;
    const args = hit[1]!.split(', ').map(s => s.trim());
    const id = Number(args[0]);
    if (rows.some(row => row.frame === frame && row.id === id)) continue; // Kirby-only copy branch.
    rows.push({ frame, id, damage: Number(args[3]), angle: Number(args[4]), growth: Number(args[5]),
      fixed: Number(args[6]), base: Number(args[7]), setWeight: args[19] === 'true',
      hitlag: Number(args[15]), sdi: Number(args[16]), shieldDamage: Number(args[20]), radius: Number(args[8])*5,
      situation: args[28] === '*COLLISION_SITUATION_MASK_G' ? 'ground' : args[28] === '*COLLISION_SITUATION_MASK_A' ? 'air' : 'both',
      targetCategory: args[29] === '*COLLISION_CATEGORY_MASK_FIGHTER' ? 'fighter' : 'all',
      launchDirection: args[18] === '*ATTACK_LR_CHECK_POS' ? 'position' : args[18] === '*ATTACK_LR_CHECK_B' && motion !== 'AttackAirB' ? 'back' : 'forward' });
  }
  return { rows, sha256: createHash('sha256').update(raw).digest('hex') };
}
const motions: Record<string, AttackMove> = {
  Attack11: dk.DONKEYKONG_JAB, Attack12: dk.DONKEYKONG_JAB2,
  AttackS3: dk.DONKEYKONG_TILT, AttackS3Hi: dk.DONKEYKONG_TILT.angledVariants!.up, AttackS3Lw: dk.DONKEYKONG_TILT.angledVariants!.down,
  AttackHi3: dk.DONKEYKONG_UTILT, AttackLw3: dk.DONKEYKONG_DTILT, AttackDash: dk.DONKEYKONG_DASHATTACK,
  AttackS4: dk.DONKEYKONG_SMASH, AttackHi4: dk.DONKEYKONG_USMASH, AttackLw4: dk.DONKEYKONG_DSMASH,
  AttackAirN: dk.DONKEYKONG_NAIR, AttackAirF: dk.DONKEYKONG_FAIR, AttackAirB: dk.DONKEYKONG_BAIR, AttackAirHi: dk.DONKEYKONG_UAIR, AttackAirLw: dk.DONKEYKONG_DAIR,
  SpecialN: dk.DONKEYKONG_NEUTRAL_SPECIAL, SpecialAirN: dk.DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!,
  SpecialNMax: dk.DONKEYKONG_NEUTRAL_SPECIAL.fullChargeVariant!, SpecialAirNMax: dk.DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!.fullChargeVariant!,
  SpecialS: dk.DONKEYKONG_SIDE_SPECIAL, SpecialAirS: dk.DONKEYKONG_SIDE_SPECIAL.airborneVariant!,
  SpecialHi: dk.DONKEYKONG_UP_SPECIAL.groundedVariant!, SpecialLwLoop: dk.DONKEYKONG_DOWN_SPECIAL,
  SpecialAirLw: dk.DONKEYKONG_DOWN_SPECIAL.shockwave.aerialVariant!,
  DownAttackU: dk.DONKEYKONG_GETUP_ATTACK, DownAttackD: dk.DONKEYKONG_GETUP_ATTACK_FACE_DOWN,
  SlipAttack: dk.DONKEYKONG_TRIP_ATTACK, CliffAttack: dk.DONKEYKONG_LEDGE_ATTACK,
};
/** Native rows where SmashWiki disagrees and wins (user rule 2026-10-11). Up_special
 * Grounded "Hit 1" ids 0–5 read "bk=0 ks=30 fkv=90"; the raw script reads kbg 90 / fkb 30. */
const SMASHWIKI_OVERRIDES: Record<string, Partial<ReturnType<typeof sourceHits>['rows'][number]>> = {
  'SpecialHi:19': { growth: 30, fixed: 90 },
};
function checkRegion(motion: string, native: ReturnType<typeof sourceHits>['rows'][number], hit: AttackCollisionHit, move: AttackMove) {
  const override = SMASHWIKI_OVERRIDES[`${motion}:${native.frame}`];
  const row = override ? { ...native, ...override } : native;
  const ref = (hit.knockback ?? move.knockback).reference!;
  const actual = { frame: row.frame, id: hit.id, damage: hit.damage ?? move.damage,
    angle: ref.angle, growth: ref.growth, fixed: ref.fixed ?? 0, base: ref.base, setWeight: ref.setWeight ?? false,
    hitlag: hit.hitlagMultiplier ?? move.hitlagMultiplier ?? 1, sdi: hit.sdiMultiplier ?? move.sdiMultiplier ?? 1,
    shieldDamage: hit.shieldDamage ?? move.shieldDamage ?? 0, radius: hit.capsule.radius, situation: hit.situation ?? 'both',
    targetCategory: hit.targetCategory ?? 'all', launchDirection: hit.launchDirection ?? 'forward' };
  assert.deepEqual(actual, row, `${motion} frame ${row.frame} id ${row.id}`);
  comparisons.push({ motion, source: row, runtime: actual, matched: true, ...(override ? { native, smashWikiOverride: override } : {}) });
}
export function auditDkAttackData() {
  comparisons.length = 0;
  for (const [motion, move] of Object.entries(motions)) {
    for (const row of sourceHits(motion).rows) {
      const elapsed = row.frame - 1 + (motion === 'SpecialLwLoop' ? 7 : 0);
      const window = move.hitWindows?.find(w => elapsed >= w.startFrame && elapsed < w.endFrame);
      const resolved = window ? resolveAttackHitWindow(move, move, window) : move;
      const hit = resolved.collisionHits?.find(h => h.id === row.id);
      assert.ok(hit, `Missing runtime region ${motion} frame ${row.frame} id ${row.id}`);
      checkRegion(motion, row, hit, resolved);
    }
  }
  const spin = dk.DONKEYKONG_UP_SPECIAL;
  for (const row of sourceHits('SpecialAirHi').rows) {
    const idx = row.frame === 4 ? 0 : row.frame === 60 ? 13 : 1;
    checkRegion('SpecialAirHi', row, spin.multiHitRising.collisionHitsPerHit![idx]!.find(h => h.id === row.id)!, spin);
  }
  const p = dk.DONKEYKONG_GRAB.pummel!;
  checkRegion('CatchAttack', sourceHits('CatchAttack').rows[0]!, { id: 0, damage: p.damage, knockback: p.knockback,
    hitlagMultiplier: p.hitlagMultiplier, sdiMultiplier: p.sdiMultiplier,
    capsule: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 30 } }, dk.DONKEYKONG_JAB);
  for (const [motion, dir, cargo, total] of [
    ['ThrowB','back',false,39],['ThrowHi','up',false,43],['ThrowLw','down',false,54],
    ['ThrowFF','forward',true,45],['ThrowFB','back',true,42],['ThrowFHi','up',true,29],['ThrowFLw','down',true,44],
  ] as const) {
    const game = readFileSync(`${base}/sources/${motion}.txt`, 'utf8').split('unsafe extern "C" fn')[1]!;
    const args = /ATTACK_ABS\(agent, \*FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, (.*)\);/.exec(game)![1]!.split(', ');
    const t = (cargo ? dk.DONKEYKONG_GRAB.cargo!.throws : dk.DONKEYKONG_GRAB.throws)[dir];
    const r = t.knockback.reference!;
    const actual = [t.damage, r.angle, r.growth, r.fixed ?? 0, r.base];
    const source = args.slice(1,6).map(Number);
    assert.deepEqual(actual, source, motion);
    const frames = [...game.slice(0,game.indexOf('macros::ATK_HIT_ABS')).matchAll(/frame\(agent.lua_state_agent, ([\d.]+)\)/g)];
    assert.equal(t.animationFrames, Number(frames[frames.length-1]![1]), motion);
    assert.equal(t.animationFrames + t.recoveryFrames!, total, motion);
    comparisons.push({ motion, source, runtime: actual, release: t.animationFrames, total, matched: true });
  }
  assert.equal(dk.DONKEYKONG_GRAB.cargo!.startupFrames, 16);
  assert.equal(dk.DONKEYKONG_GRAB.throws.forward.damage, 0);
  for (const [motion, variant] of [
    ['Catch', dk.DONKEYKONG_GRAB], ['CatchDash', dk.DONKEYKONG_GRAB.dashGrab!], ['CatchTurn', dk.DONKEYKONG_GRAB.pivotGrab!],
  ] as const) {
    const raw = readFileSync(`${base}/sources/${motion}.txt`, 'utf8').split('unsafe extern "C" fn')[1]!;
    const firstFrame = [...raw.matchAll(/frame\(agent.lua_state_agent, ([\d.]+)\)/g)][1]!;
    assert.equal(variant.startupFrames, Number(firstFrame[1]) - 1);
    assert.equal(variant.activeFrames, 3);
    for (const match of raw.matchAll(/macros::CATCH\(agent, (.*)\);/g)) {
      const a = match[1]!.split(', '), id = Number(a[0]);
      const hit = variant.collisionHits!.find(h => h.id === id)!;
      const zSign = motion === 'CatchTurn' ? -1 : 1; // Runtime turns before the pivot's sensor spawns.
      const source = { id, radius: Number(a[2])*5, y: 42-Number(a[4])*5,
        start: Number(a[5])*5*zSign, end: Number(/Some\((.*)\)/.exec(a[8]!)![1])*5*zSign,
        situation: a[10] === '*COLLISION_SITUATION_MASK_G' ? 'ground' : 'air' };
      const actual = { id: hit.id, radius: hit.capsule.radius, y: hit.capsule.start.y,
        start: hit.capsule.start.x, end: hit.capsule.end.x, situation: hit.situation };
      assert.deepEqual(actual, source, `${motion} region ${id}`);
      comparisons.push({ motion, source, runtime: actual, matched: true });
    }
  }
  const ufd = JSON.parse(readFileSync(`${base}/sources/ufd-moves.json`, 'utf8')) as {movename: string; startup: string; totalframes: string; endlag?: string; landinglag: string}[];
  const names: Record<string, string> = {
    Attack11: 'Jab 1', Attack12: 'Jab 2', AttackS3: 'Forward Tilt', AttackS3Hi: 'Forward Tilt', AttackS3Lw: 'Forward Tilt',
    AttackHi3: 'Up Tilt', AttackLw3: 'Down Tilt', AttackDash: 'Dash Attack', AttackS4: 'Forward Smash', AttackHi4: 'Up Smash', AttackLw4: 'Down Smash',
    AttackAirN: 'Neutral Air', AttackAirF: 'Forward Air', AttackAirB: 'Back Air', AttackAirHi: 'Up Air', AttackAirLw: 'Down Air',
    SpecialN: 'Neutral B (Giant Punch)', SpecialAirN: 'Neutral B (Giant Punch)', SpecialNMax: 'Giant Punch, Full Charge', SpecialAirNMax: 'Giant Punch, Full Charge',
    SpecialS: 'Side B (Headbutt)', SpecialAirS: 'Side B (Headbutt)', SpecialHi: 'Up B (Spinning Kong)', SpecialLwLoop: 'Down B (Hand Slap)', SpecialAirLw: 'Hand Slap, Air',
  };
  // SmashWiki wins where it disagrees with UFD (user rule 2026-10-11): angled forward tilt
  // "FAF 35 → 36" (total 35, endlag 26); uncharged Giant Punch "Interruptible (from release)
  // 70 (63)" (total 69 including the 7-frame entry, endlag 42).
  const smashWikiTiming: Record<string, { totalframes: string; endlag: string }> = {
    AttackS3Hi: { totalframes: '35', endlag: '26' }, AttackS3Lw: { totalframes: '35', endlag: '26' },
    SpecialN: { totalframes: '69', endlag: '42' }, SpecialAirN: { totalframes: '69', endlag: '42' },
  };
  const timingComparisons = [];
  for (const [motion, name] of Object.entries(names)) {
    const move = motions[motion]!, ufdRow = ufd.find(r => r.movename === name)!;
    const row = smashWikiTiming[motion] ? { ...ufdRow, ...smashWikiTiming[motion] } : ufdRow;
    const entry = motion === 'SpecialN' || motion === 'SpecialAirN' ? dk.DONKEYKONG_NEUTRAL_SPECIAL.charge.entryFrames! : 0;
    const actual = { startup: move.startupFrames + 1, total: move.startupFrames + move.activeFrames + move.recoveryFrames + entry,
      recovery: move.recoveryFrames, landing: (move as AttackMove & {landingLagFrames?: number}).landingLagFrames ?? move.specialLandingLagFrames };
    assert.equal(actual.startup, parseInt(row.startup,10), `${motion} UFD startup`);
    assert.equal(actual.total, Number(row.totalframes), `${motion} UFD total`);
    assert.equal(actual.recovery, Number(row.endlag), `${motion} UFD recovery`);
    if (row.landinglag !== '--') assert.equal(actual.landing, Number(row.landinglag), `${motion} landing lag`);
    timingComparisons.push({motion, ufd: ufdRow, runtime: actual, matched:true, ...(smashWikiTiming[motion] ? { smashWiki: smashWikiTiming[motion] } : {})});
  }
  const nativeMotions = readFileSync(`${base}/sources/motion-list.yml`, 'utf8');
  for (const [motion, move] of [['down_attack_u', dk.DONKEYKONG_GETUP_ATTACK], ['down_attack_d', dk.DONKEYKONG_GETUP_ATTACK_FACE_DOWN],
    ['slip_attack', dk.DONKEYKONG_TRIP_ATTACK], ['cliff_attack_quick', dk.DONKEYKONG_LEDGE_ATTACK]] as const) {
    const block = new RegExp(`^  ${motion}:\\n([\\s\\S]*?)(?=^  \\w+:)`,'m').exec(nativeMotions)![1]!;
    const cancel = Number(/cancel_frame: (\d+)/.exec(block)![1]);
    assert.equal(move.startupFrames + move.activeFrames + move.recoveryFrames, cancel - 1, `${motion} first actionable frame`);
    timingComparisons.push({motion, nativeCancelFrame:cancel, total:cancel-1, matched:true});
  }
  const spec = getAuthorableCharacterSpec('donkeykong');
  const restored = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))), 'DK audit round trip');
  assert.deepEqual(restored.moves, spec.moves, 'All variants and per-region data survive saved fighter serialization');
  return { motions: Object.keys(motions).length + 13, comparisons: comparisons.length, timingComparisons, mismatches: 0, savedRoundTrip: true, rows: [...comparisons] };
}
if (process.argv[1]?.endsWith('dk-attack-data-audit.ts')) {
  const report = auditDkAttackData();
  writeFileSync(`${base}/comparison.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify({ ...report, rows: undefined, timingComparisons: report.timingComparisons.length }));
}
