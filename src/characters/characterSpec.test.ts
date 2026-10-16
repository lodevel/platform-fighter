import { describe, expect, it } from 'vitest';

import {
  CHARACTER_ROSTER,
  CHARACTER_SPECS_IN_ROSTER_ORDER,
  PLAYABLE_CHARACTER_SPECS,
  LINK_SPEC,
  DONKEYKONG_SPEC,
  PIKACHU_SPEC,
  LINK_MOVES,
  DONKEYKONG_MOVES,
  getCharacterSpec,
  findMoveByType,
} from './roster';
import {
  getCharacterSpritesheetKey,
  getSpriteAnimationKey,
  SPRITE_ANIM_SPECS,
} from './spriteAnimationDriver';
import {
  DONKEYKONG_JAB,
  DONKEYKONG_TILT,
  DONKEYKONG_SMASH,
  DONKEYKONG_NAIR,
  DONKEYKONG_FAIR,
  DONKEYKONG_BAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL,
} from './DonkeyKong';
import { PIKACHU_MOVES, PIKACHU_NEUTRAL_SPECIAL } from './Pikachu';
import type { AttackMove } from './attacks';
import { packedBodyProfile } from './packedBodyPresentation';
import { CHARACTER_IDS, type MoveType } from '../types';

/**
 * Verifies that the character roster module defines one data record per
 * fighter (stats, sprite placeholder, move-set) for the shipped roster
 * (Link, Donkey Kong, Pikachu). The Fighter entity reads from this roster
 * to expose `getSpec()` / `getDisplayName()` / `getTuning()` /
 * `getMoves()` / `getPlaceholder()` (covered separately in
 * `Fighter.test.ts`).
 *
 * Locked down here:
 *
 *   1. The roster is exhaustive over the `CharacterId` union.
 *   2. Every spec is playable with distinct movesets and placeholder colours.
 *   3. Each placeholder visual carries the fields a scene needs to
 *      render a stand-in and points at the fighter's loaded idle sheet.
 *   4. Each spec's `moves` array is the exported move table.
 *   5. Roster-wide move-table and grounded-triplet contracts.
 */

// ---------------------------------------------------------------------------
// Roster shape
// ---------------------------------------------------------------------------

describe('Character roster — shape', () => {
  it('contains a spec for every CharacterId in the union', () => {
    for (const id of CHARACTER_IDS) {
      const spec = CHARACTER_ROSTER[id];
      expect(spec).toBeDefined();
      expect(spec.id).toBe(id);
    }
  });

  it('exposes the same set of specs through the ordered list', () => {
    expect(CHARACTER_SPECS_IN_ROSTER_ORDER.map((s) => s.id)).toEqual([
      'link',
      'donkeykong',
      'pikachu',
    ]);
  });

  it('is frozen — keys cannot be reassigned', () => {
    expect(Object.isFrozen(CHARACTER_ROSTER)).toBe(true);
    expect(Object.isFrozen(LINK_SPEC)).toBe(true);
    expect(Object.isFrozen(DONKEYKONG_SPEC)).toBe(true);
    expect(Object.isFrozen(PIKACHU_SPEC)).toBe(true);
  });

  it('getCharacterSpec returns the matching spec for each id', () => {
    expect(getCharacterSpec('link')).toBe(LINK_SPEC);
    expect(getCharacterSpec('donkeykong')).toBe(DONKEYKONG_SPEC);
    expect(getCharacterSpec('pikachu')).toBe(PIKACHU_SPEC);
  });
});

// ---------------------------------------------------------------------------
// Playable characters
// ---------------------------------------------------------------------------

describe('Character roster — playable characters', () => {
  it('publishes every roster slot as a playable spec in roster order', () => {
    expect(PLAYABLE_CHARACTER_SPECS.map((s) => s.id)).toEqual([
      'link',
      'donkeykong',
      'pikachu',
    ]);
  });

  it('each playable spec carries stats, moves, and a sprite placeholder', () => {
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      // Stats
      expect(spec.tuning).toBeDefined();
      expect(spec.tuning.maxRunSpeed).toBeGreaterThan(0);
      expect(spec.tuning.mass).toBeGreaterThan(0);
      // Moves
      expect(spec.moves.length).toBeGreaterThanOrEqual(3);
      expect(spec.moves.every((m) => typeof m.id === 'string')).toBe(true);
      // Placeholder
      expect(spec.placeholder.primaryColor).toBeGreaterThanOrEqual(0);
      expect(spec.placeholder.accentColor).toBeGreaterThanOrEqual(0);
      expect(spec.placeholder.width).toBeGreaterThan(0);
      expect(spec.placeholder.height).toBeGreaterThan(0);
      // Every shipped fighter renders from its own sprite pack.
      const spriteKey = spec.placeholder.spriteKey;
      expect(typeof spriteKey, `${spec.id} spriteKey`).toBe('string');
      expect((spriteKey as string).length).toBeGreaterThan(0);
      // Display
      expect(spec.displayName.length).toBeGreaterThan(0);
      expect(spec.role.length).toBeGreaterThan(0);
    }
  });

  it('Donkey Kong and Pikachu have distinct stats (heavyweight vs lightweight)', () => {
    // Mass — DK is heavier so the same hit knocks Pikachu further.
    expect(DONKEYKONG_SPEC.tuning.mass).toBeGreaterThan(PIKACHU_SPEC.tuning.mass);
    // Top run speed — Pikachu is faster.
    expect(PIKACHU_SPEC.tuning.maxRunSpeed).toBeGreaterThan(DONKEYKONG_SPEC.tuning.maxRunSpeed);
    // Body footprint — DK is the bigger silhouette.
    expect(DONKEYKONG_SPEC.tuning.width).toBeGreaterThan(PIKACHU_SPEC.tuning.width);
    expect(DONKEYKONG_SPEC.tuning.height).toBeGreaterThan(PIKACHU_SPEC.tuning.height);
  });

  it('roster movesets are distinct (no shared move ids across fighters)', () => {
    const owners = new Map<string, string>();
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      for (const move of spec.moves) {
        expect(owners.get(move.id), `${move.id} shared by ${spec.id}`).toBeUndefined();
        owners.set(move.id, spec.id);
      }
      // Each kit covers a jab + smash + aerial.
      const types = spec.moves.map((m) => m.type);
      expect(types).toContain('jab');
      expect(types).toContain('smash');
      expect(types).toContain('aerial');
    }
  });

  it('Donkey Kong moveset matches the class registration order', () => {
    expect(DONKEYKONG_MOVES).toEqual([
      DONKEYKONG_JAB,
      DONKEYKONG_TILT,
      DONKEYKONG_SMASH,
      DONKEYKONG_NAIR,
      DONKEYKONG_FAIR,
      DONKEYKONG_BAIR,
      DONKEYKONG_NEUTRAL_SPECIAL,
      DONKEYKONG_SIDE_SPECIAL,
      DONKEYKONG_UP_SPECIAL,
      DONKEYKONG_DOWN_SPECIAL,
    ]);
  });

  it('each spec publishes its fighter module move table', () => {
    expect(LINK_SPEC.moves).toBe(LINK_MOVES);
    expect(DONKEYKONG_SPEC.moves).toBe(DONKEYKONG_MOVES);
    expect(PIKACHU_SPEC.moves).toBe(PIKACHU_MOVES);
  });

  it('roster placeholders have distinct primary and accent colours', () => {
    const primaries = PLAYABLE_CHARACTER_SPECS.map((s) => s.placeholder.primaryColor);
    const accents = PLAYABLE_CHARACTER_SPECS.map((s) => s.placeholder.accentColor);
    expect(new Set(primaries).size).toBe(primaries.length);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it('placeholder dimensions mirror the underlying tuning', () => {
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      expect(spec.placeholder.width, `${spec.id} width`).toBe(spec.tuning.width);
      expect(spec.placeholder.height, `${spec.id} height`).toBe(spec.tuning.height);
    }
  });

  it('display names are human-readable (not just the id)', () => {
    expect(LINK_SPEC.displayName).toBe('Link (Zelda)');
    expect(DONKEYKONG_SPEC.displayName).toBe('Donkey Kong');
    expect(PIKACHU_SPEC.displayName).toBe('Pikachu');
  });
});

// ---------------------------------------------------------------------------
// Sprite-key + Phaser animation wiring. Every roster fighter's placeholder
// points at its loaded idle spritesheet and all four canonical animation
// slots (idle / run / jump / attack) resolve to a Phaser animation key.
// ---------------------------------------------------------------------------

describe('Roster sprite-key + animation wiring', () => {
  it('each placeholder spriteKey points at the loaded idle spritesheet', () => {
    // MatchScene's `add.sprite(.., key, 0)` primes the visible frame to
    // the rest pose, so the key must be the canonical idle texture.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      expect(spec.placeholder.spriteKey, spec.id).toBe(getCharacterSpritesheetKey(spec.id, 'idle'));
    }
  });

  // A fighter whose missing packed pose is invisible (Link) draws only its packed clips, never these generic slots.
  const GENERIC_SLOT_SPECS = PLAYABLE_CHARACTER_SPECS.filter(spec => packedBodyProfile(spec.id)?.missingSheet !== 'invisible');
  it('each fighter ships a loaded spritesheet for every canonical animation slot', () => {
    for (const spec of GENERIC_SLOT_SPECS) {
      for (const sheet of ['idle', 'run', 'jump', 'attack'] as const) {
        const key = getCharacterSpritesheetKey(spec.id, sheet);
        expect(key, `${spec.id} ${sheet}`).not.toBeNull();
        expect(typeof key).toBe('string');
        expect((key as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('each fighter resolves a non-null Phaser animation key for every sprite state', () => {
    // `fall` and `hurt` collapse onto the jump and idle sheets (see
    // `collapseStateToSheet`), so a non-null lookup confirms the collapse
    // rule fires too.
    for (const spec of GENERIC_SLOT_SPECS) {
      const pattern = new RegExp(`^${spec.id}\\.(idle|run|jump|attack)\\.anim$`);
      for (const state of ['idle', 'run', 'jump', 'fall', 'attack', 'hurt'] as const) {
        const animKey = getSpriteAnimationKey(spec.id, state);
        expect(animKey, `${spec.id} ${state}`).not.toBeNull();
        expect(animKey).toMatch(pattern);
      }
    }
  });

  it('SPRITE_ANIM_SPECS covers all four canonical animation slots', () => {
    const sheets = SPRITE_ANIM_SPECS.map((s) => s.sheet);
    expect(sheets).toContain('idle');
    expect(sheets).toContain('run');
    expect(sheets).toContain('jump');
    expect(sheets).toContain('attack');
    // Cadence — `idle` and `run` loop forever, `jump` and `attack` play
    // once and hold the last frame so the fighter doesn't snap back to
    // frame 0 between phase transitions.
    const idleSpec = SPRITE_ANIM_SPECS.find((s) => s.sheet === 'idle')!;
    const runSpec = SPRITE_ANIM_SPECS.find((s) => s.sheet === 'run')!;
    const jumpSpec = SPRITE_ANIM_SPECS.find((s) => s.sheet === 'jump')!;
    const attackSpec = SPRITE_ANIM_SPECS.find((s) => s.sheet === 'attack')!;
    expect(idleSpec.repeat).toBe(-1);
    expect(runSpec.repeat).toBe(-1);
    expect(jumpSpec.repeat).toBe(0);
    expect(jumpSpec.hold).toBe(true);
    expect(attackSpec.repeat).toBe(0);
    expect(attackSpec.hold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Move lookup
// ---------------------------------------------------------------------------

describe('Character roster — findMoveByType', () => {
  it('returns the first move of the requested type for each character', () => {
    const types: MoveType[] = ['jab', 'smash', 'aerial'];
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      for (const type of types) {
        const move = findMoveByType(spec, type);
        expect(move, `${spec.id} ${type}`).toBeDefined();
        expect(move!.type).toBe(type);
      }
    }
  });

  it('returns undefined for move types no character ships in its move table', () => {
    // 'shield' and 'taunt' are never move-table entries; the lookup
    // should reject them for any spec.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      expect(findMoveByType(spec, 'shield')).toBeUndefined();
      expect(findMoveByType(spec, 'taunt')).toBeUndefined();
    }
  });

  it('returns the neutral special for each character', () => {
    expect(findMoveByType(DONKEYKONG_SPEC, 'special')).toBe(DONKEYKONG_NEUTRAL_SPECIAL);
    expect(findMoveByType(PIKACHU_SPEC, 'special')).toBe(PIKACHU_NEUTRAL_SPECIAL);
  });

  it('returns Donkey Kong jab/tilt/smash/aerial in registration order', () => {
    // The first 'aerial' entry in registration order is DONKEYKONG_NAIR.
    expect(findMoveByType(DONKEYKONG_SPEC, 'jab')).toBe(DONKEYKONG_JAB);
    expect(findMoveByType(DONKEYKONG_SPEC, 'tilt')).toBe(DONKEYKONG_TILT);
    expect(findMoveByType(DONKEYKONG_SPEC, 'smash')).toBe(DONKEYKONG_SMASH);
    expect(findMoveByType(DONKEYKONG_SPEC, 'aerial')).toBe(DONKEYKONG_NAIR);
  });
});

// ---------------------------------------------------------------------------
// Roster-wide full move-table contract.
// ---------------------------------------------------------------------------

/**
 * Per-type move counts each fighter ships. DK keeps the classic one-move-per
 * slot table; Pikachu and Link ship their expanded source tables (angled /
 * dash / recovery tilts, up/down smashes, up/down aerials, and Link's
 * three-hit jab and two-part forward smash).
 */
const EXPECTED_MOVE_TYPE_COUNTS: Readonly<Record<string, Readonly<Partial<Record<MoveType, number>>>>> = {
  link: { jab: 3, tilt: 8, smash: 4, aerial: 5, special: 1, sideSpecial: 1, upSpecial: 1, downSpecial: 1 },
  donkeykong: { jab: 1, tilt: 1, smash: 1, aerial: 3, special: 1, sideSpecial: 1, upSpecial: 1, downSpecial: 1 },
  pikachu: { jab: 1, tilt: 8, smash: 3, aerial: 5, special: 1, sideSpecial: 1, upSpecial: 1, downSpecial: 1 },
};

describe('Roster-wide full move-table contract', () => {
  it('every playable spec ships its expected move table size', () => {
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      const expected = Object.values(EXPECTED_MOVE_TYPE_COUNTS[spec.id]!).reduce((a, b) => a + b, 0);
      expect(spec.moves.length, `${spec.id} move count`).toBe(expected);
    }
  });

  it('every playable spec ships jab + tilt + smash + aerials + 4 specials', () => {
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      const types = spec.moves.map((m) => m.type);
      for (const [type, count] of Object.entries(EXPECTED_MOVE_TYPE_COUNTS[spec.id]!)) {
        expect(types.filter((t) => t === type).length, `${spec.id} ${type}`).toBe(count);
      }
    }
  });

  it('every move on every playable spec carries hitbox + knockback + frame data', () => {
    // Schema-conformance sweep. A move that ships without one of the
    // required AttackMove fields breaks here regardless of which
    // character authored it — surfacing a broken-schema regression to
    // the suite, not to runtime.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      for (const move of spec.moves) {
        expect(typeof move.id, `${spec.id} move id`).toBe('string');
        expect(move.id.length).toBeGreaterThan(0);
        // Hitbox geometry.
        expect(move.hitbox.width, `${move.id} hitbox width`).toBeGreaterThan(0);
        expect(move.hitbox.height, `${move.id} hitbox height`).toBeGreaterThan(0);
        // Knockback vector.
        expect(Number.isFinite(move.knockback.x), `${move.id} knockback x`).toBe(true);
        expect(Number.isFinite(move.knockback.y), `${move.id} knockback y`).toBe(true);
        expect(move.knockback.scaling, `${move.id} knockback scaling`).toBeGreaterThanOrEqual(0);
        // Frame timings — startup/active/recovery all positive.
        expect(move.startupFrames, `${move.id} startup`).toBeGreaterThan(0);
        expect(move.activeFrames, `${move.id} active`).toBeGreaterThan(0);
        expect(move.recoveryFrames, `${move.id} recovery`).toBeGreaterThan(0);
        expect(move.cooldownFrames, `${move.id} cooldown`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Every roster slot ships the grounded triplet, so the whole cast satisfies
// the foundation contract together.
// ---------------------------------------------------------------------------

/** Strongest damage any region of the move deals (sweet spot or collision hit). */
function peakDamage(move: AttackMove): number {
  const hits = [
    ...(move.collisionHits ?? []),
    ...(move.hitWindows ?? []).flatMap((w) => w.collisionHits ?? []),
  ];
  return Math.max(
    move.damage * Math.max(1, move.sweetSpot?.damageMultiplier ?? 1),
    ...hits.map((h) => h.damage ?? move.damage),
  );
}

describe('Roster-wide grounded triplet contract', () => {
  it('every playable spec ships a jab, a tilt, and a smash', () => {
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      expect(findMoveByType(spec, 'jab'), `${spec.id} jab`).toBeDefined();
      expect(findMoveByType(spec, 'tilt'), `${spec.id} tilt`).toBeDefined();
      expect(findMoveByType(spec, 'smash'), `${spec.id} smash`).toBeDefined();
    }
  });

  it('every grounded move uses the shared `AttackMoveWithAnimation` shape (animation block declared)', () => {
    // The renderer drives the art through the same state machine the
    // gameplay loop uses, so every grounded move authors an animation
    // block.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      for (const moveType of ['jab', 'tilt', 'smash'] as const) {
        const move = findMoveByType(spec, moveType);
        expect(move, `${spec.id} ${moveType}`).toBeDefined();
        const animated = move as { animation?: unknown };
        expect(animated.animation, `${spec.id} ${moveType} animation`).toBeDefined();
      }
    }
  });

  it('jab, tilt and smash offer increasing startup and peak hit strength', () => {
    // A sourspot can be weaker than a tilt (Link forward smash). Compare
    // the move's strongest region rather than imposing flat damage.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      const jab = findMoveByType(spec, 'jab')!;
      const tilt = findMoveByType(spec, 'tilt')!;
      const smash = findMoveByType(spec, 'smash')!;
      expect(jab.damage, `${spec.id} jab damage`).toBeLessThan(tilt.damage);
      expect(tilt.damage, `${spec.id} tilt damage`).toBeLessThan(peakDamage(smash));
      expect(jab.startupFrames, `${spec.id} jab startup`).toBeLessThan(tilt.startupFrames);
      expect(tilt.startupFrames, `${spec.id} tilt startup`).toBeLessThan(smash.startupFrames);
    }
  });
});
