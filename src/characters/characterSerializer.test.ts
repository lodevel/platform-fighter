import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CharacterDataFile,
  type CharacterDataSpec,
  parseCharacterDataFile,
  serializeCharacterDataSpec,
} from './characterSerializer';
import {
  BEAR_MOVEMENT_PROFILE,
  CAT_MOVEMENT_PROFILE,
  OWL_MOVEMENT_PROFILE,
  WOLF_MOVEMENT_PROFILE,
} from './fighterMovementProfiles';
import {
  WOLF_DOWN_SPECIAL,
  WOLF_JAB,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_SMASH,
  WOLF_TILT,
  WOLF_UP_SPECIAL,
} from './Wolf';
import type { CharacterId } from '../types';

const DATA_DIR = resolve(__dirname, '../../data/characters');

const loadDataFile = (id: CharacterId): CharacterDataSpec => {
  const raw = JSON.parse(
    readFileSync(resolve(DATA_DIR, `${id}.json`), 'utf-8'),
  );
  return parseCharacterDataFile(raw, `data/characters/${id}.json`);
};

const validFixture = (): CharacterDataFile => ({
  id: 'wolf',
  displayName: 'Wolf',
  role: 'bruiser',
  body: { width: 45, height: 66, chamfer: 8 },
  movement: {
    maxRunSpeed: 7.5,
    groundAccel: 0.65,
    airAccel: 0.3,
    groundDamping: 0.78,
    airDamping: 0.95,
    jumpImpulse: 12.5,
    maxJumps: 2,
    mass: 16,
    fallAccel: 0.3,
    maxFallSpeed: 11.0,
    fastFallSpeed: 17.5,
    jumpCutFactor: 0.4,
  },
});

/**
 * Pre-Smash-feel-pack movement block — no fall-shaping fields. Files
 * authored before the pack landed look like this; the parser must
 * accept them and default the missing fields from the fighter's
 * registered movement profile.
 */
const legacyMovementFixture = (): CharacterDataFile => ({
  id: 'wolf',
  displayName: 'Wolf',
  role: 'bruiser',
  body: { width: 45, height: 66, chamfer: 8 },
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
  it('parses every shipped data file', () => {
    const ids: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
    for (const id of ids) {
      const spec = loadDataFile(id);
      expect(spec.id).toBe(id);
      expect(spec.displayName.length).toBeGreaterThan(0);
      expect(spec.role.length).toBeGreaterThan(0);
    }
  });

  it('returns a frozen spec', () => {
    const spec = parseCharacterDataFile(validFixture());
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.body)).toBe(true);
    expect(Object.isFrozen(spec.movement)).toBe(true);
  });

  it('defaults missing fall-shaping fields from the registered movement profile (legacy files)', () => {
    const spec = parseCharacterDataFile(legacyMovementFixture());
    // Wolf's registered profile supplies the pack values when the
    // file omits them — old saves keep parsing AND gain the new
    // mechanics at canonical tuning.
    expect(spec.movement.fallAccel).toBe(0.3);
    expect(spec.movement.maxFallSpeed).toBe(11.0);
    expect(spec.movement.fastFallSpeed).toBe(17.5);
    expect(spec.movement.jumpCutFactor).toBe(0.4);
  });

  it('materializes parse-time-defaulted fall-shaping fields on re-serialization', () => {
    // Deliberate (documented) asymmetry: a legacy file with no
    // fall-shaping fields does NOT re-serialize byte-identically —
    // the validated spec always carries the full movement profile, so
    // saving a legacy file upgrades it in place at canonical profile
    // values.
    const spec = parseCharacterDataFile(legacyMovementFixture());
    const out = serializeCharacterDataSpec(spec);
    expect(out.movement.fallAccel).toBe(0.3);
    expect(out.movement.maxFallSpeed).toBe(11.0);
    expect(out.movement.fastFallSpeed).toBe(17.5);
    expect(out.movement.jumpCutFactor).toBe(0.4);
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
      parseCharacterDataFile({ ...validFixture(), id: 'dragon' }, 'wolf.json'),
    ).toThrow(/wolf\.json/);
  });
});

describe('parseCharacterDataFile — moves block', () => {
  it('parses a file without a moves block (moves remains undefined)', () => {
    const fixture: CharacterDataFile = {
      id: 'cat',
      displayName: 'Cat',
      role: 'ninja',
      body: { width: 36, height: 56, chamfer: 6 },
      movement: CAT_MOVEMENT_PROFILE,
    };
    const spec = parseCharacterDataFile(fixture);
    expect(spec.moves).toBeUndefined();
  });

  it('parses Wolf with a populated moves block', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves).toBeDefined();
    expect(spec.moves?.jab).toBeDefined();
    expect(spec.moves?.tilt).toBeDefined();
    expect(spec.moves?.smash).toBeDefined();
    expect(spec.moves?.grab).toBeDefined();
  });

  it('Wolf jab JSON matches WOLF_JAB constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.jab).toEqual(WOLF_JAB);
  });

  it('Wolf tilt JSON matches WOLF_TILT constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.tilt).toEqual(WOLF_TILT);
  });

  it('Wolf smash JSON matches WOLF_SMASH constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.smash).toEqual(WOLF_SMASH);
  });

  it('Wolf neutral special JSON matches WOLF_NEUTRAL_SPECIAL constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.neutralSpecial).toEqual(WOLF_NEUTRAL_SPECIAL);
  });

  it('Wolf side special JSON matches WOLF_SIDE_SPECIAL constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.sideSpecial).toEqual(WOLF_SIDE_SPECIAL);
  });

  it('Wolf up special JSON matches WOLF_UP_SPECIAL constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.upSpecial).toEqual(WOLF_UP_SPECIAL);
  });

  it('Wolf down special JSON matches WOLF_DOWN_SPECIAL constant', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.downSpecial).toEqual(WOLF_DOWN_SPECIAL);
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
          id: 'wolf.summon_pup',
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
            creatureId: 'wolfPup',
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
    ).toBe('wolfPup');
  });

  it("rejects 'summon' kind with empty creatureId", () => {
    const fixture = {
      ...validFixture(),
      moves: {
        neutralSpecial: {
          id: 'wolf.bad_summon',
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

  it('Wolf grab is fully populated and validates', () => {
    const spec = loadDataFile('wolf');
    const grab = spec.moves?.grab;
    expect(grab).toBeDefined();
    expect(grab!.id).toBe('wolf.grab');
    expect(grab!.throws.forward.animationFrames).toBeGreaterThan(0);
    expect(grab!.throws.back.animationFrames).toBeGreaterThan(0);
    expect(grab!.throws.up.animationFrames).toBeGreaterThan(0);
    expect(grab!.throws.down.animationFrames).toBeGreaterThan(0);
  });

  it('rejects a malformed jab record', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        jab: { id: 'wolf.jab' /* missing every other field */ },
      },
    };
    expect(() => parseCharacterDataFile(fixture)).toThrow();
  });

  it('rejects a malformed grab record (missing throw direction)', () => {
    const fixture = {
      ...validFixture(),
      moves: {
        grab: {
          id: 'wolf.grab',
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
          id: 'wolf.nair',
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
          id: 'wolf.fair',
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

  it('Wolf fair JSON includes aerialDirection: "forward"', () => {
    const spec = loadDataFile('wolf');
    expect(spec.moves?.fair?.aerialDirection).toBe('forward');
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
          id: 'wolf.jab',
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
    const original = loadDataFile('wolf');
    const json = JSON.stringify(serializeCharacterDataSpec(original));
    const reparsed = parseCharacterDataFile(JSON.parse(json));
    expect(reparsed.moves?.jab).toEqual(original.moves?.jab);
    expect(reparsed.moves?.grab).toEqual(original.moves?.grab);
  });
});

describe('data files — kept honest against fighterMovementProfiles.ts', () => {
  // The on-disk JSON is intended to BE the source of truth in the
  // future. Until we wire the spec compile step to replace
  // fighterMovementProfiles.ts, we lock down that the two stay in
  // sync — a TS-side balance change without touching the JSON
  // (or vice versa) fails this test and forces the author to
  // reconcile.
  it.each([
    ['wolf', WOLF_MOVEMENT_PROFILE],
    ['cat', CAT_MOVEMENT_PROFILE],
    ['owl', OWL_MOVEMENT_PROFILE],
    ['bear', BEAR_MOVEMENT_PROFILE],
  ] as const)(
    '%s data file matches the in-code movement profile constant',
    (id, profile) => {
      const spec = loadDataFile(id);
      expect(spec.movement).toEqual(profile);
    },
  );
});
