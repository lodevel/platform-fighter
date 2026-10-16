/** Independent source-contract checks; production match/visual acceptance is separate. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DONKEYKONG_TILT, DONKEYKONG_UTILT, DONKEYKONG_DTILT, DONKEYKONG_SMASH,
  DONKEYKONG_USMASH, DONKEYKONG_DSMASH, DONKEYKONG_UAIR,
  DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_SIDE_SPECIAL, DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL, DONKEYKONG_GRAB,
  DONKEYKONG_GETUP_ATTACK, DONKEYKONG_GETUP_ATTACK_FACE_DOWN, DONKEYKONG_TRIP_ATTACK,
} from './DonkeyKong';
import type { AttackMove } from './attacks';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';

const sourceDir = 'docs/review/2026-10-06/dk-all-attack-values/sources';
function script(motion: string): string {
  return readFileSync(`${sourceDir}/${motion}.txt`, 'utf8').split('unsafe extern "C" fn effect')[0]!;
}

/** Parse explicit HIT_NODE/reset clocks independently from the DK helper. */
function sourceProtection(motion: string) {
  const text = script(motion);
  let clock = 0, start = -1, end = -1;
  const regions: string[] = [];
  for (const line of text.split('\n')) {
    const frame = /frame\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    const wait = /wait\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    if (frame) clock = Number(frame[1]);
    if (wait) clock += Number(wait[1]);
    const bone = /HIT_NODE\(agent, Hash40::new\("(\w+)"\), \*HIT_STATUS_XLU/.exec(line);
    if (bone) { if (start === -1) start = clock - 1; regions.push(bone[1]!); }
    if (line.includes('set_status_all') && line.includes('HIT_STATUS_NORMAL')) end = clock - 1;
  }
  return [{ startFrame: start, endFrame: end, regions }];
}

const protectedMoves: readonly [string, AttackMove][] = [
  ['AttackS3', DONKEYKONG_TILT], ['AttackS3Hi', DONKEYKONG_TILT.angledVariants!.up!],
  ['AttackS3Lw', DONKEYKONG_TILT.angledVariants!.down!], ['AttackHi3', DONKEYKONG_UTILT],
  ['AttackLw3', DONKEYKONG_DTILT], ['AttackS4', DONKEYKONG_SMASH],
  ['AttackHi4', DONKEYKONG_USMASH], ['AttackLw4', DONKEYKONG_DSMASH],
  ['AttackAirHi', DONKEYKONG_UAIR], ['SpecialHi', DONKEYKONG_UP_SPECIAL.groundedVariant!],
];

describe('DK source mechanics contracts', () => {
  it.each(protectedMoves)('%s retains exactly the primary protected regions and raw ordinary boundary', (motion, move) => {
    expect(move.protectionWindows).toEqual(sourceProtection(motion));
  });

  it('selects published Punch protection through contact, with no inherited Max limb protection', () => {
    for (const move of [DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_NEUTRAL_SPECIAL.airborneVariant!]) {
      expect(move.protectionWindows).toEqual([{ startFrame: 3, endFrame: 20, regions: ['arml'] }]);
      expect(move.fullChargeVariant!.protectionWindows).toBeUndefined();
    }
    expect(script('SpecialNMax')).not.toContain('HIT_NODE');
    expect(script('SpecialAirNMax')).not.toContain('HIT_NODE');
  });

  it('retains the separately selected UFD aerial-spin protection rather than claiming a raw-clock identity', () => {
    const rows = JSON.parse(readFileSync(`${sourceDir}/ufd-moves.json`, 'utf8'));
    expect(JSON.stringify(rows.find((row: { movename: string }) => row.movename === 'Spinning Kong, Air')))
      .toMatch(/10-38/);
    expect(DONKEYKONG_UP_SPECIAL.protectionWindows).toEqual([{ startFrame: 9, endFrame: 38, regions: ['armr', 'arml'] }]);
    expect(sourceProtection('SpecialAirHi')).not.toEqual(DONKEYKONG_UP_SPECIAL.protectionWindows);
  });

  it('preserves each source Headbutt bury/normal region instead of tagging the whole move', () => {
    for (const [motion, move] of [['SpecialS', DONKEYKONG_SIDE_SPECIAL],
      ['SpecialAirS', DONKEYKONG_SIDE_SPECIAL.airborneVariant!]] as const) {
      const attacks = script(motion).split('\n').filter(line => line.includes('macros::ATTACK(agent,'));
      for (const line of attacks) {
        const id = Number(/ATTACK\(agent, (\d+)/.exec(line)![1]);
        const hit = move.collisionHits!.find(region => region.id === id)!;
        expect(hit.statusEffect, `${motion}/${id}`).toBe(line.includes('collision_attr_bury') ? 'bury' : undefined);
      }
    }
  });

  it('retains THRU no-rebound versus OFF transcendent interaction', () => {
    for (const [motion, move] of [['AttackS4', DONKEYKONG_SMASH], ['AttackHi4', DONKEYKONG_USMASH],
      ['AttackLw4', DONKEYKONG_DSMASH], ['SpecialN', DONKEYKONG_NEUTRAL_SPECIAL],
      ['SpecialAirLw', DONKEYKONG_DOWN_SPECIAL.shockwave.aerialVariant!],
      ['SpecialLwLoop', DONKEYKONG_DOWN_SPECIAL], ['DownAttackU', DONKEYKONG_GETUP_ATTACK],
      ['DownAttackD', DONKEYKONG_GETUP_ATTACK_FACE_DOWN], ['SlipAttack', DONKEYKONG_TRIP_ATTACK]] as const) {
      const raw = script(motion), expected = raw.includes('ATTACK_SETOFF_KIND_THRU') ? 'through' : 'off';
      const hits = move.collisionHits ?? move.hitWindows!.flatMap(window => window.collisionHits!);
      expect(hits.every(hit => hit.setoff === expected)).toBe(true);
    }
  });

  it('retains native trip inputs on down tilt and aerial Hand Slap', () => {
    expect(script('AttackLw3')).toContain('false, 0, 0.4, 0,');
    expect(DONKEYKONG_DTILT.collisionHits!.every(hit => hit.tripChance === 0.4)).toBe(true);
    expect(script('SpecialAirLw')).toContain('false, 0, 0.2, 0,');
    expect(DONKEYKONG_DOWN_SPECIAL.shockwave.aerialVariant!.hitWindows!
      .flatMap(window => window.collisionHits!).every(hit => hit.tripChance === 0.2)).toBe(true);
    expect(script('AttackS3Lw')).toContain('false, 0, 0.15, 0,');
    expect(DONKEYKONG_TILT.angledVariants!.down!.collisionHits!.every(hit => hit.tripChance === .15)).toBe(true);
  });

  it('uses exact primary motion-list protection boundaries for grounded recovery attacks', () => {
    const motions = readFileSync(`${sourceDir}/motion-list.yml`, 'utf8');
    for (const [native, move] of [['down_attack_u', DONKEYKONG_GETUP_ATTACK],
      ['down_attack_d', DONKEYKONG_GETUP_ATTACK_FACE_DOWN], ['slip_attack', DONKEYKONG_TRIP_ATTACK]] as const) {
      const block = new RegExp(`^  ${native}:\\n([\\s\\S]*?)(?=^  \\w+:)`, 'm').exec(motions)![1]!;
      const end = Number(/xlu_end: (\d+)/.exec(block)![1]) - 1;
      expect(move.protectionWindows).toEqual([{ startFrame: 0, endFrame: end, regions: ['*'] }]);
    }
  });

  it('opts normal capture into sourced shared rules and carries native cargo-entry invincibility', () => {
    expect(DONKEYKONG_GRAB.ultimateCapture).toBe(true);
    expect(script('ThrowF')).toContain('WHOLE_HIT(agent, *HIT_STATUS_INVINCIBLE)');
    // SmashWiki Forward_throw Carry "Invincibility 1-15" (the native WHOLE_HIT ran through 16).
    expect(DONKEYKONG_GRAB.throws.forward.invincibilityFrames).toBe(15);
    expect(DONKEYKONG_GRAB.throws.forward.damage).toBe(0);
  });

  it.each([
    ['ThrowB', 'normal', 'back'], ['ThrowHi', 'normal', 'up'], ['ThrowLw', 'normal', 'down'],
    ['ThrowFF', 'cargo', 'forward'], ['ThrowFB', 'cargo', 'back'], ['ThrowFHi', 'cargo', 'up'],
    ['ThrowFLw', 'cargo', 'down'],
  ] as const)('%s preserves native absolute release damage/launch/hitlag in both legal cargo situations', (motion, group, direction) => {
    const raw = script(motion);
    const values = /ATTACK_ABS\(agent, \*FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, 0, ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)/.exec(raw)!;
    const sets = group === 'cargo' ? [DONKEYKONG_GRAB.cargo!.throws, DONKEYKONG_GRAB.cargo!.airThrows!] : [DONKEYKONG_GRAB.throws];
    for (const set of sets) {
      const move = set[direction];
      expect(move.damage).toBe(Number(values[1]));
      expect(move.knockback.reference).toEqual({ angle: Number(values[2]), growth: Number(values[3]), base: Number(values[5]) });
      expect(move.hitlagMultiplier).toBe(Number(values[6]));
      expect(move.reverseFacingAtRelease ?? false).toBe(raw.includes('macros::REVERSE_LR(agent)'));
    }
  });

  it('carries source carry-escape damage and the aerial down-throw release boost without fabricating a distinct air script', () => {
    const damage = /ABSOLUTE_KIND_CATCH, 0, ([\d.]+)/.exec(script('ThrowF'))!;
    expect(DONKEYKONG_GRAB.cargo!.breakDamage).toBe(Number(damage[1]));
    const boost = /SET_SPEED_EX\(agent, ([\d.]+), ([\d.]+)/.exec(script('ThrowFLw'))!;
    expect(DONKEYKONG_GRAB.cargo!.airThrows!.down.releaseVelocity)
      .toEqual({ x: Number(boost[1]) * 5, y: -Number(boost[2]) * 5, situation: 'air' });
    expect(DONKEYKONG_GRAB.cargo!.throws.down.releaseVelocity).toBeUndefined();
  });

  it('preserves both native Hand Slap shield-setoff commands as defender push fields', () => {
    const commands = [...script('SpecialLwLoop').matchAll(/ATK_SET_SHIELD_SETOFF_MUL_arg5\(agent, [\d, ]+, ([\d.]+)\)/g)];
    expect(commands).toHaveLength(2);
    for (const hit of DONKEYKONG_DOWN_SPECIAL.hitWindows!.flatMap(window => window.collisionHits!)) {
      expect(hit.shieldSetoffMultiplier).toBe(Number(commands[0]![1]));
    }
  });

  it('retains every new nested source region, motion and throw field through saved fighter reconstruction', () => {
    const original = getAuthorableCharacterSpec('donkeykong');
    const restored = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(original))));
    expect(original.moves?.grab).toBeDefined();
    expect(original.moves?.grab).toEqual(DONKEYKONG_GRAB);
    expect(restored.moves).toEqual(original.moves);
    expect(restored.moves?.grab).toEqual(original.moves?.grab);
    expect(restored.movement).toEqual(original.movement);
  });
});
