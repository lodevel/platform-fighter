import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { CharacterEditState } from '../characterBuilder/characterEditState';
import { buildCharacterEditorFields } from '../characterBuilder/characterEditorFields';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
function fresh(): any {
  const file = JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu'))));
  file.moves.grab.throws.forward = { damage: 2, animationFrames: 29, recoveryFrames: 14,
    knockback: { x: 1, y: -1, scaling: 0, reference: { base: 55, growth: 110, angle: 45 } },
    heldTargetHits: [10, 14, 18, 22].map(frame => ({ frame, damage: 2, hitlagMultiplier: 0 })) };
  return file;
}
function construct(spec: CharacterDataSpec) {
  const fighter = createCharacterById({ matter: { body: Body, add: { rectangle: Bodies.rectangle },
    world: { on() {}, off() {}, remove() {} } } } as any, spec.id,
  { ...spec.body, ...spec.movement, spawnX: 0, spawnY: 0 });
  applyCharacterMoveOverrides(fighter, spec);
  return fighter;
}

describe('throw catch-only timeline through saved authoring and factory', () => {
  it('edits a held hit and preserves its ordered events, zero freeze and separate release', () => {
    const initial = parseCharacterDataFile(fresh());
    const state = new CharacterEditState(initial);
    expect(buildCharacterEditorFields(initial, 'move', 'grab')
      .find(field => field.id === 'throws.forward.heldTargetHits.0.frame')).toMatchObject({ integer: true, value: 10 });
    state.setMoveNumericField('grab', ['throws', 'forward', 'heldTargetHits', '0', 'damage'], 2.5);
    const saved = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
    const fighter = construct(saved);
    try {
      expect(fighter.getGrabSpec()!.throws.forward).toMatchObject({ damage: 2, animationFrames: 29,
        recoveryFrames: 14, heldTargetHits: [{ frame: 10, damage: 2.5, hitlagMultiplier: 0 },
          { frame: 14, damage: 2, hitlagMultiplier: 0 }, { frame: 18, damage: 2, hitlagMultiplier: 0 },
          { frame: 22, damage: 2, hitlagMultiplier: 0 }] });
      expect(initial.moves!.grab!.throws.forward.heldTargetHits![0]!.damage).toBe(2);
    } finally { fighter.destroy(); }
  });

  it('also preserves events on a saved cargo throw without modifying the base fighter', () => {
    const original = getAuthorableCharacterSpec('donkeykong');
    const file: any = JSON.parse(JSON.stringify(serializeCharacterDataSpec(original)));
    file.moves.grab.cargo.throws.forward.heldTargetHits = [{ frame: 1, damage: 2, hitlagMultiplier: 0 }];
    const fighter = construct(parseCharacterDataFile(file));
    try {
      expect(fighter.getGrabSpec()!.cargo!.throws.forward.heldTargetHits).toEqual([{ frame: 1, damage: 2, hitlagMultiplier: 0 }]);
      expect(original.moves!.grab!.cargo!.throws.forward.heldTargetHits).toBeUndefined();
    } finally { fighter.destroy(); }
  });

  it.each([
    ['negative frame', [{ frame: -1, damage: 2 }]],
    ['fractional frame', [{ frame: 1.5, damage: 2 }]],
    ['release frame', [{ frame: 29, damage: 2 }]],
    ['after release', [{ frame: 30, damage: 2 }]],
    ['duplicate frame', [{ frame: 10, damage: 2 }, { frame: 10, damage: 2 }]],
    ['unordered frame', [{ frame: 14, damage: 2 }, { frame: 10, damage: 2 }]],
    ['negative damage', [{ frame: 10, damage: -1 }]],
    ['nonfinite damage', [{ frame: 10, damage: Infinity }]],
    ['negative freeze', [{ frame: 10, damage: 2, hitlagMultiplier: -1 }]],
    ['empty events', []],
    ['nonarray events', {}],
    ['null event', [null]],
  ])('rejects malformed %s instead of dropping the event data', (_name, hits) => {
    const file = fresh(); file.moves.grab.throws.forward.heldTargetHits = hits;
    expect(() => parseCharacterDataFile(file)).toThrow();
  });
});
