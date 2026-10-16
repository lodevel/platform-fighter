/** Independent retained-packet comparisons. These check metadata declarations
 * and source producer selection, not carry resistance in a running match. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { donkeyKongAttackReactionMetadata } from './donkeykongAttackReactionMetadata';
import { pikachuAttackForceReaction } from './pikachuAttackForceReaction';
import { DK_NATIVE_ATTACKS } from './donkeykongAttackData';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { dkSourceHits } from './donkeykongSourceMoves';
import { pikachuSourceHits } from './pikachuSourceMoves';
import type { AttackCollisionHit } from './attacks';

const evidence = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics';
interface Pin {
  motion: string; sourceFrame: number; id: number; attribute: string;
  source_path: string; source_sha256: string; selected_force_reaction?: boolean;
}
const ledger = JSON.parse(readFileSync(`${evidence}/heavy-armor-producer-source-ledger.json`, 'utf8')) as {
  dk_regions: Pin[]; pk_existing_data_regions: Pin[]; native_force_default_limit: string;
};

function sourceArguments(command: string): string[] {
  const match = /macros::ATTACK\(agent, (.*)\);/.exec(command);
  if (!match?.[1]) throw new Error('Missing retained complete ATTACK command');
  // Captured ATTACKs are single lines; nested Hash40/Some calls contain no commas.
  return match[1].split(', ').map(value => value.trim());
}

function attribute(args: string[]): string {
  const match = /^Hash40::new\("(collision_attr_[a-z_]+)"\)$/.exec(args[32] ?? '');
  if (!match?.[1]) throw new Error('Missing native attribute in argument32');
  return match[1];
}

function dkGameRows(source: string) {
  const game = source.split('unsafe extern "C" fn')[1];
  if (!game?.trimStart().startsWith('game_')) throw new Error('Missing first native game body');
  let frame = 0;
  const rows: { frame: number; id: number; attribute: string }[] = [];
  for (const line of game.split('\n')) {
    const clock = /\b(frame|wait)\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    if (clock) frame = clock[1] === 'wait' ? frame + Number(clock[2]) : Number(clock[2]);
    if (!line.includes('macros::ATTACK(agent,')) continue;
    const args = sourceArguments(line), id = Number(args[0]);
    // SpecialN copy branches repeat the same keys. Their native default domain
    // is shared, while numeric Kirby adaptation stays outside this declaration.
    if (!rows.some(row => row.frame === frame && row.id === id))
      rows.push({ frame, id, attribute: attribute(args) });
  }
  return rows;
}

describe('native DK/PK per-ID reaction producer contracts', () => {
  it('binds all source packets and keeps ordinary force initialization limits explicit', () => {
    const pins = [...ledger.dk_regions, ...ledger.pk_existing_data_regions];
    expect(ledger.dk_regions).toHaveLength(125);
    expect(ledger.pk_existing_data_regions).toHaveLength(145);
    for (const pin of pins)
      expect(createHash('sha256').update(readFileSync(pin.source_path)).digest('hex')).toBe(pin.source_sha256);
    expect(ledger.native_force_default_limit).toContain('engine ATTACK initialization');
    expect(ledger.native_force_default_limit).toContain('unknown stays absent');
  });

  it('compares every DK key and attribute against primary command clocks, not a runtime-generated fixture', () => {
    const sourcePaths = [...new Set(ledger.dk_regions.map(pin => pin.source_path))];
    expect(sourcePaths).toHaveLength(31);
    let count = 0;
    for (const path of sourcePaths) {
      const source = readFileSync(path, 'utf8');
      const pins = ledger.dk_regions.filter(pin => pin.source_path === path);
      const rows = dkGameRows(source);
      expect(rows).toHaveLength(pins.length);
      for (const pin of pins) {
        expect(rows.find(row => row.frame === pin.sourceFrame && row.id === pin.id))
          .toEqual({ frame: pin.sourceFrame, id: pin.id, attribute: pin.attribute });
        expect(donkeyKongAttackReactionMetadata(pin.motion, pin.sourceFrame, pin.id))
          .toEqual({ nativeCollisionAttribute: pin.attribute, nativeForceReaction: false });
        count++;
      }
      expect(source).not.toContain('set_force_reaction');
    }
    expect(count).toBe(125);
  });

  it('checks all145 PK packet records using retained original source lines and per-ID force state', () => {
    let count = 0;
    const unique = new Set<string>();
    for (const [motion, rows] of Object.entries(PIKACHU_NATIVE_ATTACKS)) {
      for (const row of rows) {
        const pin = ledger.pk_existing_data_regions.find(candidate => candidate.motion === motion
          && candidate.sourceFrame === row.frame && candidate.id === row.id);
        if (!pin) throw new Error(`Missing primary PK metadata pin ${motion}/${row.frame}/${row.id}`);
        const command = readFileSync(pin.source_path, 'utf8').split('\n')[row.source_line - 1];
        if (!command) throw new Error('Missing original PK source line');
        expect(command.trim()).toBe(row.raw);
        const args = sourceArguments(command);
        expect(Number(args[0])).toBe(row.id);
        expect(attribute(args)).toBe(pin.attribute);
        expect(row.attribute).toBe(pin.attribute);
        expect(pikachuAttackForceReaction(motion, row.frame, row.id)).toBe(pin.selected_force_reaction);
        unique.add(`${motion}/${row.frame}/${row.id}`);
        count++;
      }
    }
    expect(count).toBe(145);
    expect(unique.size).toBe(133);
  });

  it('keeps mixed Headbutt ground/air regions and Spin rush/final attributes on the selected source region', () => {
    const ground = dkSourceHits('SpecialS', 20);
    expect(ground.map(hit => [hit.id, hit.nativeCollisionAttribute, hit.nativeForceReaction]))
      .toEqual([[0, 'collision_attr_bury', false], [1, 'collision_attr_bury', false],
        [2, 'collision_attr_normal', false]]);
    const air = dkSourceHits('SpecialAirS', 20);
    expect(air.map(hit => [hit.id, hit.nativeCollisionAttribute, hit.nativeForceReaction]))
      .toEqual([[0, 'collision_attr_bury', false], [2, 'collision_attr_normal', false]]);
    expect(dkSourceHits('SpecialHi', 25).map(hit => hit.nativeCollisionAttribute))
      .toEqual(['collision_attr_rush', 'collision_attr_rush', 'collision_attr_rush']);
    expect(dkSourceHits('SpecialHi', 62)[0]?.nativeCollisionAttribute).toBe('collision_attr_normal');
    // Only geometry is an explicit fixture. Source damage/flags remain selected
    // by the real producer, including replacement of stale authored metadata.
    const geometry: AttackCollisionHit[] = DK_NATIVE_ATTACKS.Attack11.map(row => ({ id: row.id,
      capsule: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, radius: 1 },
      nativeCollisionAttribute: 'collision_attr_sleep', nativeForceReaction: true }));
    for (const hit of dkSourceHits('Attack11', 5, geometry)) {
      expect(hit.nativeCollisionAttribute).toBe('collision_attr_normal');
      expect(hit.nativeForceReaction).toBe(false);
      expect(hit.damage).toBe(4);
    }
  });

  it('transports ordinary PK normal/electric attributes with explicit false and preserves live clear gaps', () => {
    const jab = pikachuSourceHits('pikachu/Attack11', 2);
    expect(jab).toHaveLength(3);
    for (const hit of jab) {
      expect(hit.nativeCollisionAttribute).toBe('collision_attr_normal');
      expect(hit.nativeForceReaction).toBe(false);
    }
    const electric = pikachuSourceHits('pikachu/AttackAirN', 3);
    expect(electric.length).toBeGreaterThan(0);
    for (const hit of electric) {
      expect(hit.nativeCollisionAttribute).toBe('collision_attr_elec');
      expect(hit.nativeForceReaction).toBe(false);
      expect(hit.electricCollision).toBe(true);
    }
    expect(pikachuSourceHits('pikachu/Attack11', 4)).toHaveLength(0);
  });

  it('restricts explicit PK Final forcing to native10 ID1 without inventing other motion keys', () => {
    for (const motion of ['pikachu/Final2', 'pikachu/FinalAir2']) {
      const pin = ledger.pk_existing_data_regions.find(row => row.motion === motion && row.id === 1);
      if (!pin) throw new Error('Missing retained forced PK source region');
      expect(readFileSync(pin.source_path, 'utf8'))
        .toContain('set_force_reaction(agent.module_accessor, 1, true, false)');
      expect(pikachuAttackForceReaction(motion, 10, 1)).toBe(true);
      expect(pikachuAttackForceReaction(motion, 0, 0)).toBe(false);
      expect(pikachuAttackForceReaction(motion, 10, 0)).toBeUndefined();
    }
    expect(pikachuAttackForceReaction('missing', 1, 0)).toBeUndefined();
    expect(donkeyKongAttackReactionMetadata('missing', 1, 0)).toBeUndefined();
    expect(donkeyKongAttackReactionMetadata('Attack11', 5, 999)).toBeUndefined();
  });
});
