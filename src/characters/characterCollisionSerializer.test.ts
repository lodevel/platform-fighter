import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { resolveAttackHitWindow } from './attackHitWindows';
import { scaleAttackCollisionHitDamage } from './attacks';
import { LINK_FAIR, LINK_JAB, LINK_UP_SPECIAL } from './Link';
import { CHARGED_BOW_NEUTRAL_SPECIAL } from './chargedBowFixture';

const jabHits = (move: { hitWindows?: ReadonlyArray<{ collisionHits?: unknown }> } = LINK_JAB): any[] => move.hitWindows![0]!.collisionHits as any[];

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const fresh = (): any => JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('link'))));
const reload = (spec: CharacterDataSpec) => parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
function construct(spec: CharacterDataSpec) {
  const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
    world: { on() {}, off() {}, remove() {} } } } as any, 'link', { ...spec.body, ...spec.movement, spawnX: 0, spawnY: 0 });
  applyCharacterMoveOverrides(fighter, spec);
  return fighter;
}

describe('collision records and combat modifiers through authoring', () => {
  it('roundtrips exact capsules, region priority, situation records and per-hit modifiers through factory', () => {
    const saved = reload(getAuthorableCharacterSpec('link'));
    expect(saved.moves!.jab).toEqual(LINK_JAB);
    expect(saved.moves!.fair).toEqual(LINK_FAIR);
    const fighter = construct(saved);
    try {
      expect(jabHits(fighter.getAttack('link.jab')!)).toEqual(jabHits());
      const fair = fighter.getAttack('link.fair')!;
      expect(resolveAttackHitWindow(fair, fair, fair.hitWindows![0]!).collisionHits).toHaveLength(6);
      expect(resolveAttackHitWindow(fair, fair, fair.hitWindows![0]!).hitlagMultiplier).toBe(0.8);
      // Window 2 authors no override: it inherits the move's multiplier.
      expect(resolveAttackHitWindow(fair, fair, fair.hitWindows![1]!).hitlagMultiplier).toBe(0.8);
    } finally { fighter.destroy(); }
  });
  it('edits an actual capsule radius and hitlag multiplier and preserves inactive legacy geometry', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'jab');
    const radius = fields.find(field => field.id === 'hitWindows.0.collisionHits.0.capsule.radius')!;
    expect(radius).toMatchObject({ value: 9, min: 0.5, step: 0.5 });
    expect(radius.id).toBe('hitWindows.0.collisionHits.0.capsule.radius');
    expect(fields.find(field => field.id === 'hitWindows.0.collisionHits.0.capsule.start.y')!.min).toBe(-1000);
    expect(fields.find(field => field.id === 'hitWindows.0.collisionHits.0.id')!.integer).toBe(true);
    expect(fields.some(field => field.id.startsWith('hitbox.'))).toBe(false);
    expect(buildCharacterEditorFields(state.getSpec(), 'move', 'fair')
      .some(field => field.id.startsWith('hitbox.'))).toBe(false);
    state.setMoveNumericField('jab', radius.path, stepCharacterEditorField(radius, 1));
    state.setMoveNumericField('jab', ['hitlagMultiplier'], 1.65);
    const saved = reload(state.getSpec());
    expect(jabHits(saved.moves!.jab!)[0].capsule.radius).toBe(9.5);
    expect(saved.moves!.jab!.hitlagMultiplier).toBe(1.65);
    expect(saved.moves!.jab!.hitbox).toEqual(LINK_JAB.hitbox);
    expect(jabHits()[0].capsule.radius).toBe(9);
  });
  it.each([
    ['id', -1], ['id', 0.5], ['hitlagMultiplier', -0.1], ['sdiMultiplier', Infinity],
    ['situation', 'swimming'], ['targetCategory', 'items'], ['part', 1],
  ])('rejects malformed collision field %s=%s', (key, value) => {
    const file = fresh(); file.moves.jab.hitWindows[0].collisionHits[0][key] = value;
    expect(() => parseCharacterDataFile(file)).toThrow();
  });
  it('rejects duplicate IDs, empty records and nonpositive/nonfinite capsule geometry', () => {
    for (const mutate of [
      (r: any) => { r[1].id = r[0].id; },
      (r: any) => { r.length = 0; },
      (r: any) => { r[0].capsule.radius = 0; },
      (r: any) => { r[0].capsule.start.x = NaN; },
    ]) {
      const file = fresh(); mutate(file.moves.jab.hitWindows[0].collisionHits);
      expect(() => parseCharacterDataFile(file)).toThrow();
    }
  });
  it('preserves zero hitlag/SDI factors and window overrides', () => {
    const file = fresh(); file.moves.fair.hitlagMultiplier = 0;
    file.moves.fair.hitWindows[0].sdiMultiplier = 0;
    const move = parseCharacterDataFile(file).moves!.fair!;
    expect(move.hitlagMultiplier).toBe(0);
    expect(resolveAttackHitWindow(move, move, move.hitWindows![0]!).sdiMultiplier).toBe(0);
  });
  it('charges explicit collision damage exactly once while retaining its source launch and modifiers', () => {
    const record = { ...jabHits()[2], damage: 7, hitlagMultiplier: 0.8 };
    const move = { ...LINK_JAB, damage: 10, collisionHits: [record] };
    const charged = { ...move, damage: 14, collisionHits: scaleAttackCollisionHitDamage(move.collisionHits, 1.4) };
    expect(charged.collisionHits![0]!).toMatchObject({ knockback: record.knockback, hitlagMultiplier: 0.8 });
    expect(charged.collisionHits![0]!.damage).toBeCloseTo(9.8, 12);
    const inherited = resolveAttackHitWindow(move, charged, { startFrame: 6, endFrame: 8, group: 'same' });
    // Reused geometry never establishes native metadata for a new strike (resolveAttackHitWindow).
    const { nativeCollisionAttribute: _native, ...plain } = charged.collisionHits![0]!;
    expect(record.nativeCollisionAttribute).toBeDefined();
    expect(inherited.collisionHits).toEqual([plain]);
    const replaced = resolveAttackHitWindow(move, charged, { startFrame: 6, endFrame: 8, group: 'new', collisionHits: [{ ...record, damage: 5 }] });
    expect(replaced.collisionHits![0]!).toMatchObject({ damage: 7, knockback: record.knockback, hitlagMultiplier: 0.8 });
    expect(record.damage).toBe(7);
  });
  it('roundtrips the confirmed special per-phase and per-hit records', () => {
    const saved = reload(getAuthorableCharacterSpec('link'));
    const bow = saved.moves!.neutralSpecial!;
    // The shipped bow is an uncharged article; it keeps its reference launch.
    expect(bow).toMatchObject({ knockback: { reference: { base: 10, growth: 71, angle: 361 } } });
    expect((bow as { chargedProjectile?: unknown }).chargedProjectile).toBeUndefined();
    expect(saved.moves!.sideSpecial).toMatchObject({ boomerang: {
      lateOutbound: { startFrame: 10, damage: 6, knockback: { reference: { base: 60, growth: 40, angle: 65 } } },
      returnKnockback: { reference: { base: 50, growth: 40, angle: 70 } },
    } });
    expect(saved.moves!.upSpecial).toEqual(LINK_UP_SPECIAL);
    expect(saved.moves!.downSpecial).toMatchObject({ trap: {
      hitlagMultiplier: 0.8, sdiMultiplier: 1, trapKnockback: { reference: { base: 60, growth: 115, angle: 52 } } } });
  });
  it('rejects incomplete per-hit arrays and a charged reference projectile without explicit damage-only mode', () => {
    for (const key of ['knockbackPerHit', 'hitlagMultiplierPerHit', 'sdiMultiplierPerHit', 'activeFramesPerHit']) {
      const file = fresh(); file.moves.upSpecial.multiHitRising[key] = [];
      expect(() => parseCharacterDataFile(file)).toThrow(/hitCount/);
    }
    const file = fresh(); file.moves.neutralSpecial = JSON.parse(JSON.stringify(CHARGED_BOW_NEUTRAL_SPECIAL));
    expect(() => parseCharacterDataFile(file)).not.toThrow();
    delete file.moves.neutralSpecial.chargedProjectile.charge.knockbackMode;
    expect(() => parseCharacterDataFile(file)).toThrow(/charged/);
    const missing = fresh(); missing.moves.neutralSpecial = JSON.parse(JSON.stringify(CHARGED_BOW_NEUTRAL_SPECIAL));
    delete missing.moves.neutralSpecial.knockback.reference;
    expect(() => parseCharacterDataFile(missing)).toThrow(/requires.*reference/);
  });
});

describe('saved dodge timing profile', () => {
  it('inherits absent Link timing', () => {
    const file = fresh(); delete file.movement.dodge;
    expect(parseCharacterDataFile(file).movement.dodge).toEqual(getAuthorableCharacterSpec('link').movement.dodge);
  });
  it('edits nested whole-frame fields and constructs the same effective defense timing', () => {
    const state = new CharacterEditState(reload(getAuthorableCharacterSpec('link')));
    const field = buildCharacterEditorFields(state.getSpec(), 'movement')
      .find(field => field.id === 'movement.dodge.directionalAirUpRecoveryFrames')!;
    expect(field).toMatchObject({ value: 87, step: 1, integer: true });
    state.setMovementNumericField(field.path, stepCharacterEditorField(field, 1));
    const saved = reload(state.getSpec());
    expect(saved.movement.dodge!.directionalAirUpRecoveryFrames).toBe(88);
    const fighter = construct(saved);
    try { expect(fighter.getTuning().dodge.directionalAirUpRecoveryFrames).toBe(88); }
    finally { fighter.destroy(); }
  });
  it('validates directional partials against the effective authored directional window', () => {
    // Every roster profile authors its own directional window, so a partial is
    // validated against DK's directional iframes rather than the neutral-air ones.
    const inherited = getAuthorableCharacterSpec('donkeykong').movement.dodge!.directionalAir!;
    const { iframeStartFrame, iframeFrames } = inherited;
    if (iframeStartFrame === undefined || iframeFrames === undefined) throw new Error('DK authors its directional iframe window');
    const dk = JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'))));
    dk.movement.dodge = { directionalAir: { activeFrames: iframeStartFrame + iframeFrames - 1 } };
    expect(() => parseCharacterDataFile(dk)).toThrow(/entire iframe window/);
    dk.movement.dodge.directionalAir.iframeFrames = iframeFrames - 1;
    expect(parseCharacterDataFile(dk).movement.dodge).toEqual(dk.movement.dodge);
  });
  it('preserves backward-roll timing and a facing reversal during forward-roll recovery', () => {
    const saved = reload(getAuthorableCharacterSpec('link'));
    expect(saved.movement.dodge).toMatchObject({ backwardRoll: { activeFrames: 16, iframeStartFrame: 4,
      iframeFrames: 12, recoveryFrames: 19 }, roll: { activeFrames: 15, reverseFacingFrame: 19 } });
    const fields = buildCharacterEditorFields(saved, 'movement');
    expect(fields.find(f => f.id === 'movement.dodge.roll.reverseFacingFrame')).toMatchObject({ integer: true, value: 19 });
    expect(fields.find(f => f.id === 'movement.dodge.backwardRoll.recoveryFrames')).toMatchObject({ integer: true, value: 19 });
  });
  it.each([
    { air: { iframeStartFrame: 2.5 } }, { air: { activeFrames: 0 } },
    { air: { iframeStartFrame: 3, iframeFrames: 28 } },
    { directionalAirUpRecoveryFrames: -1 }, { directionalAir: { iframeFrames: Infinity } },
    { stickThreshold: 1.1 }, { backwardRoll: { iframeStartFrame: 10 } }, { roll: { reverseFacingFrame: 1.5 } },
  ])('rejects malformed nested dodge tuning %j', dodge => {
    const file = fresh(); file.movement.dodge = dodge;
    expect(() => parseCharacterDataFile(file)).toThrow();
  });
});
