import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { DONKEYKONG_UP_SPECIAL } from './DonkeyKong';
import { getMoveBusyFrames } from './moveSchema';
import { isMultiHitRisingUpSpecial, type MultiHitRisingUpSpecialMove, validateUpSpecialMove } from './upSpecialSchema';

const require = createRequire(import.meta.url);
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const FLIGHT = { gravityFrames: 43, gravity: 0.02975, airAcceleration: 0.25, maxAirSpeed: 8.5 };
const dkFile = () => serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'));
const moveWithFlight = (sustainedRise: unknown) => ({
  ...DONKEYKONG_UP_SPECIAL,
  multiHitRising: { ...DONKEYKONG_UP_SPECIAL.multiHitRising, sustainedRise },
});
const parseFlight = (sustainedRise: unknown) => parseCharacterDataFile({
  ...dkFile(), moves: { upSpecial: moveWithFlight(sustainedRise) },
});

/** Factory bridge uses real Matter bodies; this suite does not simulate flight. */
function scene() {
  return { matter: { body: Body, add: { rectangle: Bodies.rectangle },
    world: { on() {}, off() {}, remove() {} },
  } } as any;
}

describe('up-special sustained-rise authoring and save/load', () => {
  it('round-trips the compiled DK flight block, hit ladder and grounded variant through JSON', () => {
    expect(DONKEYKONG_UP_SPECIAL.multiHitRising.sustainedRise).toEqual(FLIGHT);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(dkFile())));
    const move = loaded.moves?.upSpecial;
    expect(move).toEqual(DONKEYKONG_UP_SPECIAL);
    if (!move || !isMultiHitRisingUpSpecial(move)) throw new Error('DK must retain its rising move');
    expect(move.groundedVariant).toEqual(DONKEYKONG_UP_SPECIAL.groundedVariant);
  });

  it('preserves an independently tuned flight block into the factory and dispatched attack', () => {
    const tuned = { gravityFrames: 35, gravity: 0.06, airAcceleration: 0.4, maxAirSpeed: 7.75 };
    const edited = parseFlight(tuned);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(edited))));
    const ch = createCharacterById(scene(), loaded.id, {
      spawnX: 0, spawnY: -500, ...loaded.body, ...loaded.movement,
    });
    applyCharacterMoveOverrides(ch, loaded);
    const registered = ch.getAttack(DONKEYKONG_UP_SPECIAL.id);
    expect(registered).toEqual(moveWithFlight(tuned));
    expect(ch.attemptUpSpecial()).toBe(true);
    const active = ch.getActiveAttack()?.move;
    expect(active && isMultiHitRisingUpSpecial(active)).toBe(true);
    if (!active || !isMultiHitRisingUpSpecial(active)) throw new Error('DK flight was not dispatched');
    expect(active.multiHitRising.sustainedRise).toEqual(tuned);
    expect(active.multiHitRising.hitFrames).toEqual(DONKEYKONG_UP_SPECIAL.multiHitRising.hitFrames);
    expect(ch.getAttack('donkeykong.jab')).toBeDefined();
  });

  it('keeps omitted flight metadata absent after round-trip and factory construction', () => {
    const { sustainedRise: _flight, ...withoutFlight } = DONKEYKONG_UP_SPECIAL.multiHitRising;
    const legacy = { ...DONKEYKONG_UP_SPECIAL, multiHitRising: withoutFlight };
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(
      parseCharacterDataFile({ ...dkFile(), moves: { upSpecial: legacy } }),
    ))));
    const move = loaded.moves!.upSpecial!;
    expect(move).toEqual(legacy);
    if (!isMultiHitRisingUpSpecial(move)) throw new Error('the saved move must stay a rising move');
    expect(Object.hasOwn(move.multiHitRising, 'sustainedRise')).toBe(false);
    const ch = createCharacterById(scene(), loaded.id, { spawnX: 0, spawnY: -500, ...loaded.body, ...loaded.movement });
    applyCharacterMoveOverrides(ch, loaded);
    expect(ch.attemptUpSpecial()).toBe(true);
    expect(ch.getVelocity().y).toBe(legacy.multiHitRising.riseImpulse);
    expect(ch.getActiveAttack()?.move).toEqual(legacy);
  });

  it('allows zero air acceleration and a gravity window ending exactly at move completion', () => {
    const flight = { ...FLIGHT, gravityFrames: getMoveBusyFrames(DONKEYKONG_UP_SPECIAL), airAcceleration: 0 };
    const move = moveWithFlight(flight) as MultiHitRisingUpSpecialMove;
    expect(validateUpSpecialMove(move)).toBe(move);
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(parseFlight(flight)))));
    expect(loaded.moves?.upSpecial).toEqual(move);
  });

  it.each(['gravityFrames', 'gravity', 'airAcceleration', 'maxAirSpeed'] as const)(
    'rejects invalid %s in imported and compiled flight blocks', key => {
      const values: unknown[] = [-1, null, Infinity, NaN, '3', undefined, [], true];
      if (key !== 'airAcceleration') values.push(0);
      if (key === 'gravityFrames') values.push(1.5, getMoveBusyFrames(DONKEYKONG_UP_SPECIAL) + 1);
      for (const value of values) {
        const flight = { ...FLIGHT, [key]: value };
        expect(() => parseFlight(flight)).toThrow(`sustainedRise.${key}`);
        expect(() => validateUpSpecialMove(moveWithFlight(flight) as unknown as MultiHitRisingUpSpecialMove))
          .toThrow(`sustainedRise.${key}`);
      }
    },
  );

  it('rejects malformed flight blocks rather than silently dropping them', () => {
    for (const flight of [null, [], 'float', 0, true, {}]) {
      expect(() => parseFlight(flight)).toThrow('sustainedRise');
      expect(() => validateUpSpecialMove(moveWithFlight(flight) as unknown as MultiHitRisingUpSpecialMove))
        .toThrow('sustainedRise');
    }
  });
});
