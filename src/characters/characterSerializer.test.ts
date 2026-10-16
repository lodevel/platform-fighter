import { describe, expect, it } from 'vitest';

import {
  type CharacterDataFile,
  parseCharacterDataFile,
  serializeCharacterDataSpec,
} from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';
import { PIKACHU_FAIR, PIKACHU_JAB, PIKACHU_NAIR, PIKACHU_TILT } from './Pikachu';
import { LEGACY_NAIR } from './legacyMoveFixtures';

/** Pikachu's shipped spec as a saved file, without its moves block. */
const validFixture = (): CharacterDataFile => {
  const { moves: _moves, ...file } = serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu'));
  return JSON.parse(JSON.stringify(file));
};

describe('optional airborne movement tuning', () => {
  const air = { riseAccel: 0.34, shortHopRiseAccel: 0.2022222222222222,
    shortHopImpulse: 8.25529411764706, maxAirSpeed: 4.62,
    airJumpImpulse: 12.04, airJumpRiseAccel: 0.2022222222222222 };

  it('retains all arc and air-speed values through a JSON round trip', () => {
    const spec = parseCharacterDataFile({ ...validFixture(), movement: { ...validFixture().movement, ...air } });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.movement).toEqual(spec.movement);
    expect(loaded.movement).toMatchObject(air);
  });

  it.each(['riseAccel', 'shortHopRiseAccel', 'shortHopImpulse', 'maxAirSpeed', 'airJumpImpulse', 'airJumpRiseAccel'] as const)('rejects invalid %s instead of dropping the field', (key) => {
    for (const value of [-1, null, Infinity, NaN, '3']) {
      expect(() => parseCharacterDataFile({ ...validFixture(), movement: { ...validFixture().movement, [key]: value } })).toThrow(key);
    }
    if (key === 'shortHopImpulse' || key === 'airJumpImpulse' || key === 'maxAirSpeed') {
      expect(() => parseCharacterDataFile({ ...validFixture(), movement: { ...validFixture().movement, [key]: 0 } })).toThrow(key);
    }
  });
});

describe('ordinary landing tuning in saved characters', () => {
  const landing = { softLandingFrames: 2, hardLandingFrames: 5, hardLandingSpeedFrames: 4 };

  it('preserves edited landing timing across serialization and defaults omitted Link fields', () => {
    const spec = parseCharacterDataFile({ ...validFixture(),
      movement: { ...validFixture().movement, ...landing, hardLandingFrames: 7 } });
    expect(parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec)))).movement)
      .toMatchObject({ ...landing, hardLandingFrames: 7 });
    const link = serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
    const movement: Record<string, unknown> = { ...link.movement };
    for (const key of Object.keys(landing)) delete movement[key];
    expect(parseCharacterDataFile({ ...link, movement }).movement).toMatchObject(landing);
  });

  it.each(Object.keys(landing))('rejects invalid %s to keep simulation steps integral', (key) => {
    for (const value of [-1, 1.5, null, Infinity, NaN, '3']) {
      expect(() => parseCharacterDataFile({ ...validFixture(),
        movement: { ...validFixture().movement, [key]: value } })).toThrow(key);
    }
  });
});

describe('legacy neutral aerial save compatibility', () => {
  it('preserves a pre-AerialMove nair exactly without introducing landing or animation fields', () => {
    const spec = parseCharacterDataFile({ ...validFixture(), moves: { nair: LEGACY_NAIR } });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.moves?.nair).toEqual(LEGACY_NAIR);
    for (const field of ['animation', 'aerialDirection', 'landingLagFrames', 'autoCancelWindows']) {
      expect(Object.hasOwn(loaded.moves!.nair!, field)).toBe(false);
    }
  });

  it('retains the fully authored aerial shape when explicitly supplied', () => {
    const spec = parseCharacterDataFile({ ...validFixture(), moves: { nair: PIKACHU_NAIR } });
    expect(parseCharacterDataFile(serializeCharacterDataSpec(spec)).moves?.nair).toEqual(PIKACHU_NAIR);
  });

  it.each([
    { animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 } },
    { aerialDirection: 'neutral' }, { landingLagFrames: 10 }, { autoCancelWindows: [] },
  ])('rejects a partially authored aerial instead of erasing its metadata: %j', metadata => {
    expect(() => parseCharacterDataFile({ ...validFixture(), moves: { nair: { ...LEGACY_NAIR, ...metadata } } })).toThrow();
  });

  it('limits compatibility to neutral aerials and rejects an incorrect move type', () => {
    expect(() => parseCharacterDataFile({ ...validFixture(), moves: { fair: LEGACY_NAIR } })).toThrow();
    expect(() => parseCharacterDataFile({ ...validFixture(), moves: { nair: { ...LEGACY_NAIR, type: 'light' } } })).toThrow(/must be 'aerial'/);
  });
});

describe('sweet-spot move save compatibility', () => {
  // No roster move ships a sweet spot; Lab saves can still author one.
  const sweetSpot = { hitbox: { offsetX: 38, offsetY: -3, width: 12, height: 14 },
    damageMultiplier: 1.35, knockbackMultiplier: 1.3 };
  const SWEET_JAB = { ...PIKACHU_JAB, sweetSpot };
  const SWEET_FAIR = { ...PIKACHU_FAIR, sweetSpot };
  it.each([{ slot: 'jab', move: SWEET_JAB }, { slot: 'fair', move: SWEET_FAIR }])('preserves $move.id sweet-spot geometry and modifiers', ({ slot, move }) => {
    const spec = parseCharacterDataFile({ ...validFixture(), moves: { [slot]: move } });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.moves?.[slot as 'jab' | 'fair']).toEqual(move);
  });

  it('preserves omitted modifiers and does not add sweet spots to ordinary moves', () => {
    const move = { ...SWEET_JAB, sweetSpot: { hitbox: sweetSpot.hitbox } };
    const loaded = parseCharacterDataFile({ ...validFixture(), moves: { jab: move, tilt: PIKACHU_TILT } });
    expect(loaded.moves?.jab?.sweetSpot).toEqual(move.sweetSpot);
    expect(Object.hasOwn(loaded.moves!.tilt!, 'sweetSpot')).toBe(false);
  });

  it.each([
    null, {}, { hitbox: { ...sweetSpot.hitbox, width: 0 } },
    { hitbox: sweetSpot.hitbox, damageMultiplier: -1 },
    { hitbox: sweetSpot.hitbox, knockbackMultiplier: '1.2' },
    { hitbox: sweetSpot.hitbox, damageMultiplier: Number.POSITIVE_INFINITY },
  ])('rejects malformed sweet-spot metadata: %j', malformed => {
    expect(() => parseCharacterDataFile({ ...validFixture(), moves: { jab: { ...PIKACHU_JAB, sweetSpot: malformed } } })).toThrow(/sweetSpot/);
  });
});

/**
 * Pre-Smash-feel-pack movement block — no fall-shaping fields. Files
 * authored before the pack landed look like this; the parser must
 * accept them and default the missing fields from the fighter's
 * registered movement profile.
 */
const legacyMovementFixture = (): CharacterDataFile => ({
  id: 'pikachu',
  displayName: 'Pikachu',
  role: 'speedster',
  body: { width: 40, height: 50, chamfer: 8 },
  movement: {
    maxRunSpeed: 7.5,
    groundAccel: 0.65,
    airAccel: 0.3,
    groundDamping: 0.78,
    airDamping: 0.95,
    jumpImpulse: 12.5,
    maxJumps: 2,
    mass: 16,
  },
});

describe('parseCharacterDataFile — happy path', () => {
  it('returns a frozen spec', () => {
    const spec = parseCharacterDataFile(validFixture());
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.body)).toBe(true);
    expect(Object.isFrozen(spec.movement)).toBe(true);
  });

  it('defaults missing fall-shaping fields from the registered movement profile (legacy files)', () => {
    const spec = parseCharacterDataFile(legacyMovementFixture());
    // Pikachu's registered profile supplies the pack values when the
    // file omits them — old saves keep parsing AND gain the new
    // mechanics at canonical tuning.
    expect(spec.movement.fallAccel).toBe(PIKACHU_MOVEMENT_PROFILE.fallAccel);
    expect(spec.movement.maxFallSpeed).toBe(PIKACHU_MOVEMENT_PROFILE.maxFallSpeed);
    expect(spec.movement.fastFallSpeed).toBe(PIKACHU_MOVEMENT_PROFILE.fastFallSpeed);
    expect(spec.movement.jumpCutFactor).toBe(PIKACHU_MOVEMENT_PROFILE.jumpCutFactor);
  });

  it('materializes parse-time-defaulted fall-shaping fields on re-serialization', () => {
    // Deliberate (documented) asymmetry: a legacy file with no
    // fall-shaping fields does NOT re-serialize byte-identically —
    // the validated spec always carries the full movement profile, so
    // saving a legacy file upgrades it in place at canonical profile
    // values.
    const spec = parseCharacterDataFile(legacyMovementFixture());
    const out = serializeCharacterDataSpec(spec);
    expect(out.movement.fallAccel).toBe(PIKACHU_MOVEMENT_PROFILE.fallAccel);
    expect(out.movement.maxFallSpeed).toBe(PIKACHU_MOVEMENT_PROFILE.maxFallSpeed);
    expect(out.movement.fastFallSpeed).toBe(PIKACHU_MOVEMENT_PROFILE.fastFallSpeed);
    expect(out.movement.jumpCutFactor).toBe(PIKACHU_MOVEMENT_PROFILE.jumpCutFactor);
  });

  it('honours explicit fall-shaping overrides in the file', () => {
    const fixture: CharacterDataFile = {
      ...legacyMovementFixture(),
      movement: {
        ...legacyMovementFixture().movement,
        fallAccel: 0.5,
        maxFallSpeed: 9,
        fastFallSpeed: 14,
        jumpCutFactor: 0.6,
      },
    };
    const spec = parseCharacterDataFile(fixture);
    expect(spec.movement.fallAccel).toBe(0.5);
    expect(spec.movement.maxFallSpeed).toBe(9);
    expect(spec.movement.fastFallSpeed).toBe(14);
    expect(spec.movement.jumpCutFactor).toBe(0.6);
  });
});

describe('parseCharacterDataFile — round-trip', () => {
  it('round-trips through serializeCharacterDataSpec', () => {
    const original = validFixture();
    const parsed = parseCharacterDataFile(original);
    const reserialized = serializeCharacterDataSpec(parsed);
    expect(reserialized.id).toBe(original.id);
    expect(reserialized.displayName).toBe(original.displayName);
    expect(reserialized.role).toBe(original.role);
    expect(reserialized.body).toEqual(original.body);
    expect(reserialized.movement).toEqual(original.movement);
  });

  it('preserves $schema when supplied', () => {
    const parsed = parseCharacterDataFile(validFixture());
    const out = serializeCharacterDataSpec(parsed, './schema.json');
    expect(out.$schema).toBe('./schema.json');
  });

  it('omits $schema when not supplied', () => {
    const parsed = parseCharacterDataFile(validFixture());
    const out = serializeCharacterDataSpec(parsed);
    expect(out.$schema).toBeUndefined();
  });

  it('JSON.stringify → JSON.parse → parse cycle is byte-stable on the values', () => {
    const original = validFixture();
    const a = parseCharacterDataFile(original);
    const json = JSON.stringify(serializeCharacterDataSpec(a));
    const b = parseCharacterDataFile(JSON.parse(json));
    expect(a).toEqual(b);
  });
});

describe('parseCharacterDataFile — validation', () => {
  it('rejects unknown character ids', () => {
    expect(() =>
      parseCharacterDataFile({ ...validFixture(), id: 'dragon' }),
    ).toThrow(/id/);
  });

  it('rejects empty displayName', () => {
    expect(() =>
      parseCharacterDataFile({ ...validFixture(), displayName: '' }),
    ).toThrow(/displayName/);
  });

  it('rejects negative body.width', () => {
    const bad: CharacterDataFile = {
      ...validFixture(),
      body: { width: -10, height: 66, chamfer: 8 },
    };
    expect(() => parseCharacterDataFile(bad)).toThrow(/body\.width/);
  });

  it('rejects negative body.chamfer', () => {
    const bad: CharacterDataFile = {
      ...validFixture(),
      body: { width: 45, height: 66, chamfer: -1 },
    };
    expect(() => parseCharacterDataFile(bad)).toThrow(/body\.chamfer/);
  });

  it('rejects non-integer maxJumps', () => {
    const bad = {
      ...validFixture(),
      movement: { ...validFixture().movement, maxJumps: 2.5 },
    };
    expect(() => parseCharacterDataFile(bad)).toThrow(/maxJumps/);
  });

  it('rejects zero mass', () => {
    const bad = {
      ...validFixture(),
      movement: { ...validFixture().movement, mass: 0 },
    };
    expect(() => parseCharacterDataFile(bad)).toThrow(/mass/);
  });

  it('rejects NaN in any movement field', () => {
    const bad = {
      ...validFixture(),
      movement: { ...validFixture().movement, airAccel: NaN },
    };
    expect(() => parseCharacterDataFile(bad)).toThrow(/airAccel/);
  });

  it('rejects non-object top level', () => {
    expect(() => parseCharacterDataFile('not an object')).toThrow();
    expect(() => parseCharacterDataFile(null)).toThrow();
    expect(() => parseCharacterDataFile(42)).toThrow();
  });

  it('embeds the contextLabel in error messages', () => {
    expect(() =>
      parseCharacterDataFile({ ...validFixture(), id: 'dragon' }, 'custom.json'),
    ).toThrow(/custom\.json/);
  });
});

describe('parseCharacterDataFile — moves block', () => {
  it('parses a file without a moves block (moves remains undefined)', () => {
    const fixture: CharacterDataFile = {
      id: 'pikachu',
      displayName: 'Pikachu',
      role: 'speedster',
      body: { width: 40, height: 50, chamfer: 8 },
      movement: PIKACHU_MOVEMENT_PROFILE,
    };
    const spec = parseCharacterDataFile(fixture);
    expect(spec.moves).toBeUndefined();
  });

  it('rejects unknown upSpecialKind', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        upSpecial: {
          id: 'test.up',
          type: 'upSpecial',
          upSpecialKind: 'rocketship',
          damage: 5,
          knockback: { x: 0, y: -1, scaling: 0.1 },
          hitbox: { offsetX: 0, offsetY: 0, width: 20, height: 20 },
          startupFrames: 4,
          activeFrames: 4,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/upSpecialKind/);
  });

  it('rejects unknown downSpecialKind', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        downSpecial: {
          id: 'test.down',
          type: 'downSpecial',
          downSpecialKind: 'meteor',
          damage: 5,
          knockback: { x: 0, y: 1, scaling: 0.1 },
          hitbox: { offsetX: 0, offsetY: 0, width: 20, height: 20 },
          startupFrames: 4,
          activeFrames: 4,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/downSpecialKind/);
  });

  it('rejects unknown sideSpecialKind', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        sideSpecial: {
          id: 'test.side',
          type: 'sideSpecial',
          sideSpecialKind: 'mystery',
          damage: 5,
          knockback: { x: 1, y: 0, scaling: 0.1 },
          hitbox: { offsetX: 10, offsetY: 0, width: 20, height: 20 },
          startupFrames: 4,
          activeFrames: 4,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/sideSpecialKind/);
  });

  it('rejects multiHit when damagePerHit length doesn\'t match hitCount', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        sideSpecial: {
          id: 'test.side',
          type: 'sideSpecial',
          sideSpecialKind: 'multiHit',
          damage: 0,
          knockback: { x: 0, y: 0, scaling: 0 },
          hitbox: { offsetX: 10, offsetY: 0, width: 20, height: 20 },
          startupFrames: 4,
          activeFrames: 12,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 1 },
          multiHit: {
            hitCount: 3,
            hitInterval: 3,
            damagePerHit: [2, 2], // length 2 not 3
            knockbackPerHit: [
              { x: 1, y: 0, scaling: 0.05 },
              { x: 1, y: 0, scaling: 0.05 },
              { x: 2, y: -1, scaling: 0.1 },
            ],
            chainWindowFrames: 0,
          },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/damagePerHit/);
  });

  it("parses a 'summon' kind neutral special", () => {
    const fixture = {
      ...validFixture(),
      moves: {
        neutralSpecial: {
          id: 'fixture.summon',
          type: 'special',
          specialKind: 'summon',
          damage: 0,
          knockback: { x: 0, y: 0, scaling: 0 },
          hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
          startupFrames: 8,
          activeFrames: 4,
          recoveryFrames: 16,
          cooldownFrames: 60,
          animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
          summon: {
            creatureId: 'fixtureCreature',
            spawnOffsetX: 30,
            spawnOffsetY: 0,
            maxConcurrent: 1,
            cooldownFrames: 240,
          },
        },
      },
    };
    const spec = parseCharacterDataFile(fixture);
    expect(spec.moves?.neutralSpecial?.specialKind).toBe('summon');
    expect(
      (spec.moves?.neutralSpecial as { summon: { creatureId: string } }).summon
        .creatureId,
    ).toBe('fixtureCreature');
  });

  it("rejects 'summon' kind with empty creatureId", () => {
    const fixture = {
      ...validFixture(),
      moves: {
        neutralSpecial: {
          id: 'fixture.bad_summon',
          type: 'special',
          specialKind: 'summon',
          damage: 0,
          knockback: { x: 0, y: 0, scaling: 0 },
          hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
          startupFrames: 4,
          activeFrames: 4,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
          summon: {
            creatureId: '',
            spawnOffsetX: 30,
            spawnOffsetY: 0,
            maxConcurrent: 1,
            cooldownFrames: 60,
          },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/creatureId/);
  });

  it('rejects an unknown specialKind', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        neutralSpecial: {
          id: 'test.neutral',
          type: 'special',
          specialKind: 'mystery',
          damage: 0,
          knockback: { x: 0, y: 0, scaling: 0 },
          hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
          startupFrames: 4,
          activeFrames: 4,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/specialKind/);
  });

  it('rejects a counter without a counter sub-record', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        neutralSpecial: {
          id: 'test.neutral',
          type: 'special',
          specialKind: 'counter',
          damage: 0,
          knockback: { x: 0, y: 0, scaling: 0 },
          hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
          startupFrames: 4,
          activeFrames: 12,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
          // no counter block
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/counter/);
  });

  it('rejects type !== "special" on neutralSpecial', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        neutralSpecial: {
          id: 'test.neutral',
          type: 'jab',
          specialKind: 'projectile',
          damage: 5,
          knockback: { x: 0, y: 0, scaling: 0 },
          hitbox: { offsetX: 0, offsetY: 0, width: 10, height: 10 },
          startupFrames: 4,
          activeFrames: 4,
          recoveryFrames: 4,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
          projectile: {
            speed: 5,
            lifetimeFrames: 60,
            width: 12,
            height: 12,
            spawnOffsetX: 20,
            spawnOffsetY: 0,
          },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/special/);
  });

  it('rejects a malformed jab record', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        jab: { id: 'fixture.jab' /* missing every other field */ },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow();
  });

  it('rejects a malformed grab record (missing throw direction)', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        grab: {
          id: 'fixture.grab',
          hitbox: { offsetX: 20, offsetY: 0, width: 20, height: 20 },
          startupFrames: 5,
          activeFrames: 2,
          whiffRecoveryFrames: 30,
          holdFramesMax: 60,
          throwRecoveryFrames: 20,
          throws: {
            forward: { damage: 8, knockback: { x: 1, y: 0, scaling: 0.1 }, animationFrames: 12 },
            back: { damage: 8, knockback: { x: 1, y: 0, scaling: 0.1 }, animationFrames: 12 },
            up: { damage: 8, knockback: { x: 1, y: 0, scaling: 0.1 }, animationFrames: 12 },
            // down missing
          },
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/down/);
  });

  it('rejects negative auto-cancel windows on aerials', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        nair: {
          id: 'fixture.nair',
          type: 'aerial',
          aerialDirection: 'neutral',
          damage: 5,
          knockback: { x: 1, y: -1, scaling: 0.05 },
          hitbox: { offsetX: 0, offsetY: 0, width: 50, height: 50 },
          startupFrames: 5,
          activeFrames: 6,
          recoveryFrames: 12,
          cooldownFrames: 8,
          animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 2 },
          landingLagFrames: 6,
          autoCancelWindows: [{ startFrame: 5, endFrame: 5 }],
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/autoCancelWindows/);
  });

  it('rejects an unknown aerialDirection', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        fair: {
          id: 'fixture.fair',
          type: 'aerial',
          aerialDirection: 'sideways',
          damage: 5,
          knockback: { x: 1, y: -1, scaling: 0.05 },
          hitbox: { offsetX: 0, offsetY: 0, width: 50, height: 50 },
          startupFrames: 5,
          activeFrames: 6,
          recoveryFrames: 12,
          cooldownFrames: 8,
          animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 2 },
          landingLagFrames: 6,
          autoCancelWindows: [],
        },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow(/aerialDirection/);
  });
});

describe('parseCharacterDataFile — optional knockback components', () => {
  // Minimal valid jab carrying the supplied knockback record —
  // exercises parseKnockback through the public parse entry point.
  const jabFixtureWithKnockback = (
    knockback: Record<string, unknown>,
  ): CharacterDataFile =>
    ({
      ...validFixture(),
      moves: {
        jab: {
          id: 'fixture.jab',
          type: 'jab',
          damage: 3,
          knockback,
          hitbox: { offsetX: 25, offsetY: 0, width: 50, height: 30 },
          startupFrames: 3,
          activeFrames: 2,
          recoveryFrames: 5,
          cooldownFrames: 4,
          animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
        },
      },
    }) as unknown as CharacterDataFile;

  it('accepts non-negative baseMagnitude / damageGrowth', () => {
    const spec = parseCharacterDataFile(
      jabFixtureWithKnockback({
        x: 4.0,
        y: -1.5,
        scaling: 0.4,
        baseMagnitude: 1.2,
        damageGrowth: 0.5,
      }),
    );
    expect(spec.moves?.jab?.knockback.baseMagnitude).toBe(1.2);
    expect(spec.moves?.jab?.knockback.damageGrowth).toBe(0.5);
  });

  it('accepts zero for both components (the legacy identity)', () => {
    const spec = parseCharacterDataFile(
      jabFixtureWithKnockback({
        x: 1,
        y: 0,
        scaling: 0.05,
        baseMagnitude: 0,
        damageGrowth: 0,
      }),
    );
    expect(spec.moves?.jab?.knockback.baseMagnitude).toBe(0);
    expect(spec.moves?.jab?.knockback.damageGrowth).toBe(0);
  });

  it('rejects negative baseMagnitude', () => {
    expect(() =>
      parseCharacterDataFile(
        jabFixtureWithKnockback({ x: 1, y: 0, scaling: 0.05, baseMagnitude: -0.5 }),
      ),
    ).toThrow(/baseMagnitude.*>= 0/);
  });

  it('rejects negative damageGrowth (would reverse launch direction at high percent)', () => {
    expect(() =>
      parseCharacterDataFile(
        jabFixtureWithKnockback({ x: 1, y: 0, scaling: 0.05, damageGrowth: -0.2 }),
      ),
    ).toThrow(/damageGrowth.*>= 0/);
  });

  it('rejects non-finite baseMagnitude', () => {
    expect(() =>
      parseCharacterDataFile(
        jabFixtureWithKnockback({ x: 1, y: 0, scaling: 0.05, baseMagnitude: NaN }),
      ),
    ).toThrow(/baseMagnitude/);
  });
});

describe('serializeCharacterDataSpec — round-trip with moves', () => {
  it('round-trips a spec with moves through serialize → parse', () => {
    const original = getAuthorableCharacterSpec('pikachu');
    const json = JSON.stringify(serializeCharacterDataSpec(original));
    const reparsed = parseCharacterDataFile(JSON.parse(json));
    expect(reparsed.moves?.jab).toEqual(JSON.parse(JSON.stringify(original.moves?.jab)));
    expect(reparsed.moves?.grab).toEqual(JSON.parse(JSON.stringify(original.moves?.grab)));
  });
});

describe('throw release source hit-stop transport', () => {
  const throwSpec = { damage: 5, animationFrames: 20, recoveryFrames: 2, rootMotionX: Array.from({ length: 22 }, (_, age) => age === 0 ? 0 : -age), hitlagMultiplier: 0, electricCollision: false, invincibilityFrames: 21,
    heldTargetHits: [{ frame: 13, damage: 0, hitlagDamage: 3, hitlagMultiplier: 1.2 }],
    knockback: { x: 1, y: -1, scaling: 0 } };
  const file = () => ({ ...validFixture(), moves: { grab: { id: 'fixture.grab', startupFrames: 1,
    activeFrames: 1, whiffRecoveryFrames: 1, holdFramesMax: 90, throwRecoveryFrames: 24,
    hitbox: { offsetX: 30, offsetY: 0, width: 20, height: 20 },
    throws: { forward: { ...throwSpec }, back: { ...throwSpec }, up: { ...throwSpec }, down: { ...throwSpec } } } } });
  it('preserves explicit zero and false through canonical save/load', () => {
    const spec = parseCharacterDataFile(file());
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(loaded.moves?.grab?.throws.forward.rootMotionX).toEqual(throwSpec.rootMotionX);
    expect(loaded.moves?.grab?.throws.forward).toMatchObject({ hitlagMultiplier: 0, electricCollision: false, invincibilityFrames: 21,
      heldTargetHits: [{ frame: 13, damage: 0, hitlagDamage: 3, hitlagMultiplier: 1.2 }] });
  });
  it.each([-1, NaN, Infinity])('rejects invalid release hit-stop%s', value => {
    const raw = file(); raw.moves.grab.throws.forward.hitlagMultiplier = value;
    expect(() => parseCharacterDataFile(raw)).toThrow(/hitlagMultiplier/);
  });
  it.each([-1, 0.5, 22])('rejects invalid protection budget%s', value => {
    const raw = file(); raw.moves.grab.throws.forward.invincibilityFrames = value;
    expect(() => parseCharacterDataFile(raw)).toThrow(/invincibilityFrames/);
  });
  it('rejects invalid no-damage hit-stop magnitude', () => {
    const raw = file(); raw.moves.grab.throws.forward.heldTargetHits[0]!.hitlagDamage = -1;
    expect(() => parseCharacterDataFile(raw)).toThrow(/hitlagDamage/);
  });
  it('rejects malformed release electric flag', () => {
    const raw = file(); (raw.moves.grab.throws.forward as any).electricCollision = 1;
    expect(() => parseCharacterDataFile(raw)).toThrow(/electricCollision/);
  });
});
