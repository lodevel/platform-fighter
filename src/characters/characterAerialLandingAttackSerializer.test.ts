import { describe, expect, it } from 'vitest';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields } from '../characterBuilder/characterEditorFields';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { buildPikachuNormalMove } from './pikachuNormalMoves';
import { validateAerialMove, type AerialMove } from './aerialSchema';
import { LEGACY_NAIR } from './legacyMoveFixtures';

const syntheticPose = () => ({ start: { x: 10, y: -10 }, end: { x: 12, y: -10 } });
const source = (id: 'back-air' | 'down-air') => buildPikachuNormalMove(id, syntheticPose) as AerialMove;
const file = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'));
// JSON has no signed-zero representation; launch/reference semantics are equal.
const jsonCompatible = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('saved automatic aerial landing attacks', () => {
  it.each([['bair', 'back-air'], ['dair', 'down-air']] as const)('restores all %s native landing contacts and commitment without fabricating animation', (slot, id) => {
    const prepared = source(id);
    expect(validateAerialMove(prepared)).toBe(prepared);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify({ ...file(), moves: { [slot]: prepared } })));
    const restored = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(loaded))));
    expect(restored.moves?.[slot]).toEqual(jsonCompatible(prepared));
    expect(Object.hasOwn(restored.moves![slot]!.landingAttack!, 'animation')).toBe(false);
    expect(restored.moves![slot]!.landingAttack!.hitWindows).toHaveLength(2);
    expect(restored.moves![slot]!.landingAttack!.startupFrames).toBe(0);
    expect(restored.moves![slot]!.landingAttack!.activeFrames).toBe(2);
  });

  it('retains nested animation, regional replacement windows and active/recovery hurtbox poses', () => {
    const prepared = source('down-air');
    const landingAttack = { ...prepared.landingAttack!, animation: { startupFrames: 0, activeFrames: 2, recoveryFrames: 4 },
      hurtboxModifiers: [{ phase: ['active', 'recovery'] as const, replaceBody: true,
        hurtbox: { id: 'authored.landing-pose', offsetX: 6, offsetY: 8, width: 24, height: 16,
          intangible: false, damageMultiplier: 0.75 } }],
    };
    const move = { ...prepared, landingAttack };
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify({ ...file(), moves: { dair: move } })));
    expect(parseCharacterDataFile(serializeCharacterDataSpec(loaded)).moves!.dair).toEqual(jsonCompatible(move));
  });

  it('exposes nested landing controls in Lab and retains edits through save/load', () => {
    const state = new CharacterEditState(parseCharacterDataFile({ ...file(), moves: { bair: source('back-air') } }));
    const fields = buildCharacterEditorFields(state.getSpec(), 'move', 'bair');
    expect(fields.find(field => field.id === 'landingAttack.hitWindows.0.collisionHits.0.damage')).toMatchObject({ value: 4 });
    expect(fields.find(field => field.id === 'landingAttack.recoveryFrames')).toMatchObject({ value: 16, step: 1, integer: true });
    state.setMoveNumericField('bair', ['landingAttack', 'hitWindows', '0', 'collisionHits', '0', 'damage'], 6);
    state.setMoveNumericField('bair', ['landingLagFrames'], 19);
    state.setMoveNumericField('bair', ['landingAttack', 'recoveryFrames'], 17);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
    expect(loaded.moves!.bair!.landingAttack!.hitWindows![0]!.collisionHits![0]!.damage).toBe(6);
    expect(loaded.moves!.bair).toMatchObject({ landingLagFrames: 19, landingAttack: { recoveryFrames: 17 } });
  });

  it('rejects a landing record with a different commitment, extra cooldown or conditional input route', () => {
    const prepared = source('back-air');
    const invalid = [null, [], { ...prepared.landingAttack!, type: 'aerial' },
      { ...prepared.landingAttack!, recoveryFrames: 17 }, { ...prepared.landingAttack!, cooldownFrames: 1 },
      { ...prepared.landingAttack!, activeFrames: 0 },
      { ...prepared.landingAttack!, followUp: { nextId: 'later', windowStart: 1, windowEnd: 2 } },
      { ...prepared.landingAttack!, jabChain: { nextId: 'later' } },
    ];
    for (const landingAttack of invalid) {
      const move = { ...prepared, landingAttack } as AerialMove;
      expect(() => validateAerialMove(move)).toThrow('landingAttack');
      expect(() => parseCharacterDataFile({ ...file(), moves: { bair: move } })).toThrow('landingAttack');
    }
  });

  it('rejects malformed nested geometry, pose and timing while keeping older omitted routes absent', () => {
    const prepared = source('down-air');
    const invalid = [
      { ...prepared.landingAttack!, hitWindows: [{ startFrame: 0, endFrame: 3 }] },
      { ...prepared.landingAttack!, collisionHits: [{ id: 0, capsule: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 } }] },
      { ...prepared.landingAttack!, hurtboxModifiers: [{ phase: 'done', hurtbox: { id: 'bad', offsetX: 0, offsetY: 0, width: 1, height: 1 } }] },
      { ...prepared.landingAttack!, hurtboxModifiers: [{ hurtbox: { id: 'bad', offsetX: 0, offsetY: 0, width: 0, height: 1 } }] },
    ];
    for (const landingAttack of invalid)
      expect(() => parseCharacterDataFile({ ...file(), moves: { dair: { ...prepared, landingAttack } } })).toThrow('landingAttack');
    const legacy = parseCharacterDataFile({ ...file(), moves: { nair: LEGACY_NAIR } });
    expect(Object.hasOwn(parseCharacterDataFile(serializeCharacterDataSpec(legacy)).moves!.nair!, 'landingAttack')).toBe(false);
    expect(() => parseCharacterDataFile({ ...file(), moves: { nair: { ...LEGACY_NAIR, landingAttack: prepared.landingAttack } } })).toThrow();
  });

  it('round-trips explicit regional rehitFrames and exposes only an integral authored timer', () => {
    const prepared = source('back-air');
    const landing = prepared.landingAttack!;
    const move = { ...prepared, landingAttack: { ...landing,
      collisionHits: landing.collisionHits!.map(hit => ({ ...hit, rehitFrames: 0 })),
      hitWindows: landing.hitWindows!.map(window => ({ ...window,
        collisionHits: window.collisionHits!.map(hit => ({ ...hit, rehitFrames: 3 })) })),
    } };
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify({ ...file(), moves: { bair: move } })));
    expect(parseCharacterDataFile(serializeCharacterDataSpec(loaded)).moves!.bair).toEqual(jsonCompatible(move));
    const fields = buildCharacterEditorFields(loaded, 'move', 'bair');
    expect(fields.find(field => field.id === 'landingAttack.hitWindows.0.collisionHits.0.rehitFrames')).toMatchObject({ value: 3, step: 1, integer: true, min: 0 });
    for (const rehitFrames of [-1, 1.5, null, '3', Infinity, NaN]) {
      const collisionHits = landing.collisionHits!.map(hit => ({ ...hit, rehitFrames }));
      expect(() => parseCharacterDataFile({ ...file(), moves: { bair: { ...prepared, landingAttack: { ...landing, collisionHits } } } })).toThrow('rehitFrames');
    }
  });

  it('preserves fair authored clock opt-in through saved fighter transport and rejects unknown clocks', () => {
    const fair = buildPikachuNormalMove('forward-air', undefined, { rehitClockPolicy: 'authored-attack-elapsed' }) as AerialMove;
    const loaded = parseCharacterDataFile(jsonCompatible({ ...file(), moves: { fair } }));
    expect(parseCharacterDataFile(serializeCharacterDataSpec(loaded)).moves!.fair).toEqual(jsonCompatible(fair));
    for (const rehitClockPolicy of [null, '', 'native-clock', 'simulation-step', 3]) {
      expect(() => parseCharacterDataFile({ ...file(), moves: { fair: { ...fair, rehitClockPolicy } } })).toThrow('rehitClockPolicy');
      expect(() => validateAerialMove({ ...fair, rehitClockPolicy } as AerialMove)).toThrow('rehitClockPolicy');
    }
  });
});
