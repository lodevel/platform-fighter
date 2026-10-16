/** Extended raw ATTACK signature coverage beyond the old 138-record audit.
 * This qualifies declarations; actual contacts/rehit/protection still need
 * the coordinator's immutable-match acceptance. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as dk from './DonkeyKong';
import type { AttackCollisionHit, AttackMove } from './attacks';
import { auditDkAttackData } from '../../tools/dk-attack-data-audit';

const directory = 'docs/review/2026-10-06/dk-all-attack-values/sources';
const motions: Record<string, AttackMove> = {
  Attack11: dk.DONKEYKONG_JAB, Attack12: dk.DONKEYKONG_JAB2,
  AttackS3: dk.DONKEYKONG_TILT, AttackS3Hi: dk.DONKEYKONG_TILT.angledVariants!.up!,
  AttackS3Lw: dk.DONKEYKONG_TILT.angledVariants!.down!, AttackHi3: dk.DONKEYKONG_UTILT,
  AttackLw3: dk.DONKEYKONG_DTILT, AttackDash: dk.DONKEYKONG_DASHATTACK,
  AttackS4: dk.DONKEYKONG_SMASH, AttackHi4: dk.DONKEYKONG_USMASH, AttackLw4: dk.DONKEYKONG_DSMASH,
  AttackAirN: dk.DONKEYKONG_NAIR, AttackAirF: dk.DONKEYKONG_FAIR, AttackAirB: dk.DONKEYKONG_BAIR,
  AttackAirHi: dk.DONKEYKONG_UAIR, AttackAirLw: dk.DONKEYKONG_DAIR,
  SpecialN: dk.DONKEYKONG_NEUTRAL_SPECIAL, SpecialAirN: dk.DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!,
  SpecialNMax: dk.DONKEYKONG_NEUTRAL_SPECIAL.fullChargeVariant!,
  SpecialAirNMax: dk.DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!.fullChargeVariant!,
  SpecialS: dk.DONKEYKONG_SIDE_SPECIAL, SpecialAirS: dk.DONKEYKONG_SIDE_SPECIAL.airborneVariant!,
  SpecialHi: dk.DONKEYKONG_UP_SPECIAL.groundedVariant!, SpecialAirHi: dk.DONKEYKONG_UP_SPECIAL,
  SpecialLwLoop: dk.DONKEYKONG_DOWN_SPECIAL,
  SpecialAirLw: dk.DONKEYKONG_DOWN_SPECIAL.shockwave.aerialVariant!,
  DownAttackU: dk.DONKEYKONG_GETUP_ATTACK, DownAttackD: dk.DONKEYKONG_GETUP_ATTACK_FACE_DOWN,
  SlipAttack: dk.DONKEYKONG_TRIP_ATTACK, CliffAttack: dk.DONKEYKONG_LEDGE_ATTACK,
};

function gameScript(motion: string) {
  const raw = readFileSync(`${directory}/${motion}.txt`, 'utf8');
  return raw.slice(raw.indexOf('unsafe extern "C" fn game_')).split('unsafe extern "C" fn')[1]!;
}

function signatureRows(motion: string) {
  const game = gameScript(motion);
  let frame = 0;
  const rows: { frame: number; id: number; args: string[] }[] = [];
  for (const line of game.split('\n')) {
    const clock = /(?:frame|wait)\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    if (clock) frame = line.includes('wait(') ? frame + Number(clock[1]) : Number(clock[1]);
    const attack = /macros::ATTACK\(agent, (.*)\);/.exec(line);
    if (!attack) continue;
    const args = attack[1]!.split(', ').map(arg => arg.trim()), id = Number(args[0]);
    // Later duplicate rows are Kirby-only copy branches, not extra DK regions.
    if (!rows.some(row => row.frame === frame && row.id === id)) rows.push({ frame, id, args });
  }
  return rows;
}

function hitboxEvents(motion: string) {
  let frame = 0;
  const events: { frame: number; kind: 'attack' | 'clear' | 'clear-all'; id?: number }[] = [];
  for (const line of gameScript(motion).split('\n')) {
    const clock = /(?:frame|wait)\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    if (clock) frame = line.includes('wait(') ? frame + Number(clock[1]) : Number(clock[1]);
    const attack = /macros::ATTACK\(agent, (\d+),/.exec(line);
    const clear = /AttackModule::clear\(agent.module_accessor, (\d+),/.exec(line);
    if (attack) events.push({ frame, kind: 'attack', id: Number(attack[1]) });
    if (clear) events.push({ frame, kind: 'clear', id: Number(clear[1]) });
    if (line.includes('AttackModule::clear_all(')) events.push({ frame, kind: 'clear-all' });
  }
  return events;
}

function regionAt(motion: string, move: AttackMove, frame: number, id: number): AttackCollisionHit {
  if (motion === 'SpecialAirHi') {
    const index = frame === 4 ? 0 : frame === 60 ? 13 : 1;
    return dk.DONKEYKONG_UP_SPECIAL.multiHitRising.collisionHitsPerHit![index]!.find(hit => hit.id === id)!;
  }
  const age = frame - 1 + (motion === 'SpecialLwLoop' ? 7 : 0);
  const window = move.hitWindows?.find(row => age >= row.startFrame && age < row.endFrame);
  return (window?.collisionHits ?? move.collisionHits)!.find(hit => hit.id === id)!;
}

describe('exhaustive DK raw interaction signature audit', () => {
  it('retains the existing independent 138 records, 42 motion and 29 selected timing comparisons', () => {
    const audit = auditDkAttackData();
    expect(audit.comparisons).toBe(138);
    expect(audit.motions).toBe(42);
    expect(audit.timingComparisons).toHaveLength(29);
    expect(audit.mismatches).toBe(0);
    expect(audit.savedRoundTrip).toBe(true);
  });
  it('binds every raw command capture to its retained primary source hash', () => {
    const pins = JSON.parse(readFileSync(`${directory}/verified.json`, 'utf8')) as {
      motion: string; url: string; sha256: string;
    }[];
    expect(pins).toHaveLength(42);
    for (const pin of pins) {
      expect(createHash('sha256').update(readFileSync(`${directory}/${pin.motion}.txt`)).digest('hex'), pin.motion).toBe(pin.sha256);
      expect(pin.url).toContain('/59004685238a3f6f93bae905d3a4e079701c40b4/');
    }
  });
  it('compares all represented native setoff, rehit, trip, status and electric flags against actual canonical regions', () => {
    let compared = 0;
    const setoff: Record<string, string> = { '*ATTACK_SETOFF_KIND_ON': 'on',
      '*ATTACK_SETOFF_KIND_OFF': 'off', '*ATTACK_SETOFF_KIND_THRU': 'through' };
    for (const [motion, move] of Object.entries(motions)) {
      for (const { frame, id, args } of signatureRows(motion)) {
        const region = regionAt(motion, move, frame, id), label = `${motion}@${frame}/${id}`;
        expect(region, label).toBeDefined();
        expect(region.setoff ?? move.setoff ?? 'on', `${label} setoff`).toBe(setoff[args[17]!]);
        expect(region.rehitFrames ?? 0, `${label} rehit`).toBe(Number(args[22]));
        expect(region.tripChance ?? move.tripChance ?? 0, `${label} trip`).toBe(Number(args[21]));
        expect(region.statusEffect, `${label} collision attribute`).toBe(args[32]!.includes('collision_attr_bury') ? 'bury' : undefined);
        expect(region.electricCollision ?? move.electricCollision ?? false, `${label} electric`).toBe(args[32]!.includes('collision_attr_elec'));
        expect(region.direct ?? move.direct ?? true, `${label} direct`).toBe(args[27] === 'true');
        // Defaults are valid only while these raw native invariants stay true.
        expect(args[1], `${label} part`).toBe('0');
        expect(args[19], `${label} set weight`).toBe('false');
        expect(args.slice(23, 27), `${label} reflect/absorb/flinchless/disable-hitlag`).toEqual(['false', 'false', 'false', 'false']);
        expect(args[30], `${label} collision part mask`).toBe('*COLLISION_PART_MASK_ALL');
        compared += 1;
      }
    }
    // Old audit's 125 includes the one catch-only pummel region, separately
    // represented as a direct held-victim event rather than a clankable sensor.
    expect(compared).toBe(124);
  });
  it('keeps source Hand Slap indirect classification and rush flavor separate from projectile ownership', () => {
    let indirect = 0;
    for (const motion of Object.keys(motions)) {
      for (const { args } of signatureRows(motion)) {
        if (args[27] === 'false') { expect(motion).toBe('SpecialLwLoop'); indirect += 1; }
        else expect(args[27]).toBe('true');
        expect(args[32]).toMatch(/collision_attr_(normal|rush|bury)/);
      }
    }
    expect(indirect).toBe(8);
  });
  it('compares every active ID and empty gap against independent birth/clear commands for rate-one scripts', () => {
    let comparedMotions = 0;
    let comparedFrames = 0;
    for (const [motion, move] of Object.entries(motions)) {
      // Rate-changing scripts need the native motion/status clock adapter;
      // comparing their animation frame directly to a gameplay age is invalid.
      if (gameScript(motion).includes('macros::FT_MOTION_RATE(')) continue;
      const events = hitboxEvents(motion), sourceIds = new Set<number>();
      const total = move.startupFrames + move.activeFrames + move.recoveryFrames;
      for (let age = 0; age < total; age++) {
        for (const event of events.filter(row => row.frame === age + 1)) {
          if (event.kind === 'attack') sourceIds.add(event.id!);
          else if (event.kind === 'clear') sourceIds.delete(event.id!);
          else sourceIds.clear();
        }
        const window = move.hitWindows?.find(row => age >= row.startFrame && age < row.endFrame);
        const active = move.hitWindows ? Boolean(window)
          : age >= move.startupFrames && age < move.startupFrames + move.activeFrames;
        const actualIds = active ? (window?.collisionHits ?? move.collisionHits)!.map(hit => hit.id) : [];
        expect(actualIds.sort((a, b) => a - b), `${motion} gameplay age ${age}`).toEqual([...sourceIds].sort((a, b) => a - b));
        comparedFrames += 1;
      }
      comparedMotions += 1;
    }
    expect(comparedMotions).toBe(25);
    expect(comparedFrames).toBeGreaterThan(1000);
  });
  it('makes every primary rate exception explicit rather than qualifying a false animation/gameplay clock equivalence', () => {
    const exceptions = Object.keys(motions).filter(motion => gameScript(motion).includes('macros::FT_MOTION_RATE('));
    expect(exceptions).toEqual(['AttackS3', 'AttackS3Hi', 'AttackS3Lw', 'SpecialAirHi', 'SpecialLwLoop']);
    for (const [motion, rate] of [['AttackS3', '0.9'], ['AttackS3Hi', '0.91'], ['AttackS3Lw', '0.91'],
      ['SpecialAirHi', '0.6'], ['SpecialLwLoop', '0.75']]) {
      expect(gameScript(motion!), motion).toContain(`macros::FT_MOTION_RATE(agent, ${rate});`);
      expect(gameScript(motion!), motion).toContain('macros::FT_MOTION_RATE(agent, 1.0);');
    }
  });
});
