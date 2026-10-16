import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { classifyDonkeyKongReferenceCarryDamage, DONKEYKONG_HEAVY_ARMOR_REACTION_THRESHOLD,
  DONKEYKONG_HEAVY_ARMOR_SUPPORTED_ATTRIBUTES } from './donkeykongHeavyArmor';
import { computeReferenceKnockback } from './referenceKnockback';
import { computeKnockback, type HitInfo } from './combat';
import { applyCombatModifiers } from './referenceCombatModifiers';

const evidence = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics';
const normal = { sourceCarryActive: true, nativeCollisionAttribute: 'collision_attr_normal', nativeForceReaction: false };
const classify = (referenceKnockback: number) =>
  classifyDonkeyKongReferenceCarryDamage({ ...normal, referenceKnockback });

describe('DK heavy armor bounded reference proxy; native conversion remains unrecovered', () => {
  it('independently pins the native strict comparison, sleep hashes, workbook32 and normal attribute', () => {
    const contract = JSON.parse(readFileSync(`${evidence}/heavy-armor-helper-source-contract.json`, 'utf8'));
    for (const pin of contract.source_records as { path: string; sha256: string }[])
      expect(createHash('sha256').update(readFileSync(pin.path)).digest('hex')).toBe(pin.sha256);
    const native = readFileSync(`${evidence}/sources/heavy-status/SuperLiftWait/check_dmg.c`, 'utf8');
    expect(native).toContain('DamageTransactorImpl::calc_reaction_frame');
    expect(native).toContain('lib::L2CValue::operator<(aLStack80,aLStack64)');
    expect(native).toContain('0xdfa0c3d9a');
    expect(native).toContain('0x149cdc52bb');
    expect(native).toContain('0x1710166637');
    const workbook = JSON.parse(readFileSync(`${evidence}/common-item-workbook-extraction.json`, 'utf8'));
    const row = workbook.reaction_thresholds.find((r: { value_cell: string }) => r.value_cell === 'B25');
    expect(row).toMatchObject({ sheet: 'battle_object', value: 32, name_crc_matches_hash: true });
    expect(DONKEYKONG_HEAVY_ARMOR_REACTION_THRESHOLD).toBe(row.value);
    const jab = readFileSync('docs/review/2026-10-06/dk-all-attack-values/sources/Attack11.txt', 'utf8');
    expect(jab).toContain('Hash40::new("collision_attr_normal")');
    expect(DONKEYKONG_HEAVY_ARMOR_SUPPORTED_ATTRIBUTES).toEqual([
      'collision_attr_normal', 'collision_attr_elec', 'collision_attr_rush', 'collision_attr_bury']);
  });

  it('resists below80KB and launches at exact80 instead of accepting virtual hitstun31', () => {
    expect(classify(79.999).kind).toBe('resist');
    expect(classify(80)).toEqual({ kind: 'launch', referenceReactionProxy: 32, reason: 'threshold' });
    expect(classify(80.001).kind).toBe('launch');
    const boundary = computeReferenceKnockback({ base: 80, growth: 0, angle: 45 }, 0, 1);
    expect(boundary.hitstunFrames).toBe(31);
    expect(classify(boundary.referenceKnockback).kind).toBe('launch');
    // Feeding the playable clock would incorrectly classify this same hit.
    expect(classify(boundary.hitstunFrames).kind).toBe('resist');
  });

  it('keeps extra and authored minimum hitstun out of the reference threshold', () => {
    const hit: HitInfo = { damage: 1, facing: 1, minHitstunFrames: 100,
      knockback: { x: 1, y: -1, scaling: 0,
        reference: { base: 70, growth: 0, angle: 45, additionalHitstunFrames: 20 } } };
    const result = computeKnockback(hit, 1, 1);
    expect(result.referenceKnockback).toBe(70);
    expect(result.hitstunFrames).toBe(100);
    expect(classifyDonkeyKongReferenceCarryDamage({ ...normal, referenceKnockback: result.referenceKnockback }).kind)
      .toBe('resist');
  });

  it('consumes modified reference KB once, including rage, stale snapshot and item multiplier', () => {
    const hit: HitInfo = { damage: 10, facing: 1,
      knockback: { x: 1, y: -1, scaling: 0, reference: { base: 74, growth: 0, angle: 45 } } };
    const effective = applyCombatModifiers(hit, 150, .5);
    const enraged = computeKnockback(effective, effective.damage, 1);
    expect(effective.damage).toBe(5);
    expect(enraged.referenceKnockback).toBeCloseTo(81.4, 10);
    expect(classifyDonkeyKongReferenceCarryDamage({ ...normal, referenceKnockback: enraged.referenceKnockback }).kind)
      .toBe('launch');
    const item = computeKnockback(effective, effective.damage, 1, { multiplier: .8 });
    expect(item.referenceKnockback).toBeCloseTo(65.12, 10);
    expect(classifyDonkeyKongReferenceCarryDamage({ ...normal, referenceKnockback: item.referenceKnockback }).kind)
      .toBe('resist');
    const fixed = applyCombatModifiers({ ...hit,
      knockback: { ...hit.knockback, reference: { ...hit.knockback.reference!, fixed: 30 } } }, 150, .5);
    expect(computeKnockback(fixed, fixed.damage, 1).referenceKnockback).toBe(74);
  });

  it('makes both native sleep exceptions launch even below the reference boundary', () => {
    for (const nativeCollisionAttribute of ['collision_attr_sleep', 'collision_attr_sleep_ex'])
      expect(classifyDonkeyKongReferenceCarryDamage({ sourceCarryActive: true,
        referenceKnockback: 1, nativeCollisionAttribute })).toEqual({
        kind: 'launch', referenceReactionProxy: .4, reason: 'sleep' });
  });

  it('does not silently classify unknown attributes or invent KB for legacy hits', () => {
    for (const nativeCollisionAttribute of [undefined, 'normal', 'collision_attr_fire', 'collision_attr_ice'])
      expect(classifyDonkeyKongReferenceCarryDamage({ sourceCarryActive: true,
        referenceKnockback: 1, nativeCollisionAttribute, nativeForceReaction: false })).toEqual({
        kind: 'unsupported', reason: 'unknown-native-attribute' });
    expect(classifyDonkeyKongReferenceCarryDamage(normal)).toEqual({
      kind: 'unsupported', reason: 'missing-reference-knockback' });
    for (const referenceKnockback of [NaN, Infinity, -Infinity, -1])
      expect(classify(referenceKnockback)).toEqual({ kind: 'unsupported', reason: 'invalid-reference-knockback' });
  });

  it('leaves inactive pickup, throw and other fighter policies entirely caller-owned', () => {
    expect(classifyDonkeyKongReferenceCarryDamage({ sourceCarryActive: false })).toEqual({ kind: 'inactive' });
    expect(classifyDonkeyKongReferenceCarryDamage({ sourceCarryActive: false,
      referenceKnockback: 1, nativeCollisionAttribute: 'collision_attr_sleep' })).toEqual({ kind: 'inactive' });
    expect(classify(0)).toEqual({ kind: 'resist', referenceReactionProxy: 0 });
  });
  it('requires explicit native force-reaction metadata across all supported non-sleep attributes', () => {
    for (const nativeCollisionAttribute of DONKEYKONG_HEAVY_ARMOR_SUPPORTED_ATTRIBUTES) {
      const input = { sourceCarryActive: true, referenceKnockback: 1, nativeCollisionAttribute };
      expect(classifyDonkeyKongReferenceCarryDamage(input)).toEqual({
        kind: 'unsupported', reason: 'unknown-force-reaction' });
      expect(classifyDonkeyKongReferenceCarryDamage({ ...input, nativeForceReaction: false }).kind).toBe('resist');
      expect(classifyDonkeyKongReferenceCarryDamage({ ...input, nativeForceReaction: true })).toEqual({
        kind: 'launch', referenceReactionProxy: .4, reason: 'forced-reaction' });
      expect(classifyDonkeyKongReferenceCarryDamage({ ...input, referenceKnockback: 80,
        nativeForceReaction: false }).kind).toBe('launch');
    }
    // Both native sleep exceptions already require launch, even if force metadata is unknown.
    expect(classifyDonkeyKongReferenceCarryDamage({ sourceCarryActive: true, referenceKnockback: 1,
      nativeCollisionAttribute: 'collision_attr_sleep' }).kind).toBe('launch');
  });

  it('classifies a retained ordinary weak Pikachu electric packet separately from forced Final2 electric', () => {
    const ordinary = readFileSync('docs/review/2026-10-06/pikachu-character/sources/scripts/pikachu/AttackAirN.txt', 'utf8');
    const match = /macros::ATTACK\(agent, 0, 0, Hash40::new\("top"\), ([\d.]+), (\d+), (\d+), (\d+), (\d+)/.exec(ordinary);
    if (!match) throw new Error('Missing retained PK nair opening ATTACK');
    const [, damage, angle, growth, fixed, base] = match;
    expect(ordinary).toContain('*ATTACK_LR_CHECK_POS, true');
    expect(ordinary).toContain('Hash40::new("collision_attr_elec")');
    expect(ordinary).not.toContain('set_force_reaction');
    const result = computeReferenceKnockback({ base: Number(base), growth: Number(growth),
      fixed: Number(fixed), angle: Number(angle), setWeight: true }, Number(damage), Number(damage), 126);
    expect(result.referenceKnockback).toBeCloseTo(55.72, 10);
    expect(classifyDonkeyKongReferenceCarryDamage({ sourceCarryActive: true,
      referenceKnockback: result.referenceKnockback, nativeCollisionAttribute: 'collision_attr_elec',
      nativeForceReaction: false }).kind).toBe('resist');
    const final = readFileSync('docs/review/2026-10-06/pikachu-character/sources/scripts/pikachu/Final2.txt', 'utf8');
    expect(final).toContain('set_force_reaction(agent.module_accessor, 1, true, false)');
    expect(final).toContain('Hash40::new("collision_attr_elec")');
  });

  it('uses published weight100 for the native bury reaction query at a carry threshold crossing', () => {
    const source = readFileSync('docs/review/2026-10-06/dk-all-attack-values/sources/SpecialS.txt', 'utf8');
    const match = /macros::ATTACK\(agent, 0, 0, Hash40::new\("top"\), ([\d.]+), (\d+), (\d+), (\d+), (\d+)/.exec(source);
    if (!match) throw new Error('Missing retained DK ground Headbutt ATTACK');
    const [, damage, angle, growth, fixed, base] = match;
    const spec = { base: Number(base), growth: Number(growth), fixed: Number(fixed), angle: Number(angle) };
    expect(source).toContain('Hash40::new("collision_attr_bury")');
    const special = computeReferenceKnockback(spec, 100, Number(damage), 100);
    const ordinary = computeReferenceKnockback(spec, 100, Number(damage), 126);
    expect(special.referenceKnockback).toBeCloseTo(80.8, 10);
    expect(ordinary.referenceKnockback).toBeCloseTo(76.93451327433628, 10);
    const input = { sourceCarryActive: true, nativeCollisionAttribute: 'collision_attr_bury', nativeForceReaction: false };
    expect(classifyDonkeyKongReferenceCarryDamage({ ...input, referenceKnockback: special.referenceKnockback }).kind)
      .toBe('launch');
    expect(classifyDonkeyKongReferenceCarryDamage({ ...input, referenceKnockback: ordinary.referenceKnockback }).kind)
      .toBe('resist');
    const research = readFileSync(`${evidence}/sources/heavy-armor-attribute-research.web.json`, 'utf8');
    expect(research).toContain('weight100');
    expect(research).toContain('Armor prevents bury');
  });

});
