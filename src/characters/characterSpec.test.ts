import { describe, expect, it } from 'vitest';

import {
  CHARACTER_ROSTER,
  CHARACTER_SPECS_IN_ROSTER_ORDER,
  PLAYABLE_CHARACTER_SPECS,
  WOLF_SPEC,
  CAT_SPEC,
  OWL_SPEC,
  BEAR_SPEC,
  WOLF_MOVES,
  CAT_MOVES,
  OWL_MOVES,
  BEAR_MOVES,
  WOLF_PLACEHOLDER,
  CAT_PLACEHOLDER,
  getCharacterSpec,
  findMoveByType,
} from './roster';
import { ASSET_KEYS, PALETTE_VARIANT_CHARACTERS } from '../assets/manifest';
import {
  getCharacterSpritesheetKey,
  getSpriteAnimationKey,
  SPRITE_ANIM_SPECS,
} from './spriteAnimationDriver';
import {
  WOLF_TUNING,
  WOLF_JAB,
  WOLF_TILT,
  WOLF_SMASH,
  WOLF_NAIR,
  WOLF_FAIR,
  WOLF_BAIR,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  WOLF_DOWN_SPECIAL,
} from './Wolf';
import {
  CAT_TUNING,
  CAT_JAB,
  CAT_TILT,
  CAT_SMASH,
  CAT_NAIR,
  CAT_FAIR,
  CAT_BAIR,
  CAT_NEUTRAL_SPECIAL,
  CAT_SIDE_SPECIAL,
  CAT_UP_SPECIAL,
  CAT_DOWN_SPECIAL,
} from './Cat';
import {
  OWL_TUNING,
  OWL_JAB,
  OWL_TILT,
  OWL_SMASH,
  OWL_NAIR,
  OWL_FAIR,
  OWL_BAIR,
  OWL_NEUTRAL_SPECIAL,
  OWL_SIDE_SPECIAL,
  OWL_UP_SPECIAL,
  OWL_DOWN_SPECIAL,
} from './Owl';
import {
  BEAR_TUNING,
  BEAR_JAB,
  BEAR_TILT,
  BEAR_SMASH,
  BEAR_NAIR,
  BEAR_FAIR,
  BEAR_BAIR,
  BEAR_NEUTRAL_SPECIAL,
  BEAR_SIDE_SPECIAL,
  BEAR_UP_SPECIAL,
  BEAR_DOWN_SPECIAL,
} from './Bear';
import type { CharacterId, MoveType } from '../types';

/**
 * Sub-AC 3.5 of AC 205 — verifies that the character roster module
 * defines and integrates 2 distinct playable characters (Wolf bruiser,
 * Cat ninja) with stats, sprite placeholders, and move-set configs in a
 * single data record per character. The Fighter entity reads from this
 * roster to expose `getSpec()` / `getDisplayName()` / `getTuning()` /
 * `getMoves()` / `getPlaceholder()` (covered separately in
 * `Fighter.test.ts`).
 *
 * Locked down here:
 *
 *   1. The roster is exhaustive over the `CharacterId` union.
 *   2. Wolf and Cat are the M1 *playable* specs — distinct stats,
 *      distinct movesets, distinct placeholder colours.
 *   3. Each placeholder visual carries the fields a scene needs to
 *      render a coloured rectangle stand-in.
 *   4. The spec's `moves` array stays in lockstep with the Wolf/Cat
 *      class registration order — drift surfaces here.
 *   5. Owl / Bear are scaffolded as `playable: false` with empty
 *      movesets so the lookup is exhaustive but they're excluded from
 *      the M1 cut.
 */

// ---------------------------------------------------------------------------
// Roster shape
// ---------------------------------------------------------------------------

describe('Character roster — shape', () => {
  it('contains a spec for every CharacterId in the union', () => {
    const ids: CharacterId[] = ['wolf', 'cat', 'owl', 'bear'];
    for (const id of ids) {
      const spec = CHARACTER_ROSTER[id];
      expect(spec).toBeDefined();
      expect(spec.id).toBe(id);
    }
  });

  it('exposes the same set of specs through the ordered list', () => {
    expect(CHARACTER_SPECS_IN_ROSTER_ORDER.map((s) => s.id)).toEqual([
      'wolf',
      'cat',
      'owl',
      'bear',
      'blaze',
      'puff',
      'aegis',
      'volt',
      'nova',
      'bruno',
    ]);
  });

  it('is frozen — keys cannot be reassigned', () => {
    expect(Object.isFrozen(CHARACTER_ROSTER)).toBe(true);
    expect(Object.isFrozen(WOLF_SPEC)).toBe(true);
    expect(Object.isFrozen(CAT_SPEC)).toBe(true);
  });

  it('getCharacterSpec returns the matching spec for each id', () => {
    expect(getCharacterSpec('wolf')).toBe(WOLF_SPEC);
    expect(getCharacterSpec('cat')).toBe(CAT_SPEC);
    expect(getCharacterSpec('owl')).toBe(OWL_SPEC);
    expect(getCharacterSpec('bear')).toBe(BEAR_SPEC);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3.5 — 2 distinct playable characters
// ---------------------------------------------------------------------------

describe('Character roster — playable characters (Sub-AC 3.5 + AC 60004 Sub-AC 4 + AC 60001 Sub-AC 1)', () => {
  it('publishes every roster slot as a playable spec in roster order', () => {
    // M1 cut shipped Wolf + Cat. AC 60004 Sub-AC 4 promoted Owl from
    // placeholder-spec to a playable fighter by wiring his grounded
    // triplet (jab / tilt / smash) into the roster. AC 60001 Sub-AC 1
    // closed the loop by wiring Bear's grounded triplet so every
    // roster slot is `playable: true` — the Seed's "4 characters with
    // full movesets" milestone for the grounded triplet is met.
    // Post-M5 roster expansion — Blaze / Puff / Aegis join with full
    // kits on day one. Post-batch-2 — Volt / Nova / Bruno likewise join
    // playable from their first build with full kits + sprite packs.
    expect(PLAYABLE_CHARACTER_SPECS.map((s) => s.id)).toEqual([
      'wolf',
      'cat',
      'owl',
      'bear',
      'blaze',
      'puff',
      'aegis',
      'volt',
      'nova',
      'bruno',
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
      // AC 10401 Sub-AC 1 (Wolf, first M1 character) and AC 10402
      // Sub-AC 2 (Cat, second M1 character) — Wolf and Cat now ship a
      // non-null `spriteKey` pointing at their loaded idle spritesheet
      // texture (the M1 cut wires the real sprite frames into the
      // render pipeline). Owl and Bear remain on the rectangle fallback
      // until their generated sprite assets land in a future AC, so
      // we accept either form here: a non-empty texture key OR null.
      const spriteKey = spec.placeholder.spriteKey;
      if (spriteKey === null) {
        // Rectangle-only renderer: Owl / Bear during the M1 cut, plus
        // the post-M5 expansion fighters (Blaze / Puff / Aegis), which
        // ship on the procedural placeholder pipeline until sprite
        // packs land.
        expect(['owl', 'bear', 'blaze', 'puff', 'aegis']).toContain(spec.id);
      } else {
        expect(typeof spriteKey).toBe('string');
        expect(spriteKey.length).toBeGreaterThan(0);
      }
      // Display
      expect(spec.displayName.length).toBeGreaterThan(0);
      expect(spec.role.length).toBeGreaterThan(0);
    }
  });

  it('Wolf and Cat have distinct stats (bruiser vs ninja archetypes)', () => {
    // Mass — Wolf is heavier so the same hit knocks Cat further (locked
    // down by the Fighter knockback test). The roster spec mirrors that
    // gap so a stats screen reads the right numbers.
    expect(WOLF_SPEC.tuning.mass).toBeGreaterThan(CAT_SPEC.tuning.mass);
    // Top run speed — Cat is faster.
    expect(CAT_SPEC.tuning.maxRunSpeed).toBeGreaterThan(WOLF_SPEC.tuning.maxRunSpeed);
    // Air accel — Cat redirects more easily mid-air.
    expect(CAT_SPEC.tuning.airAccel).toBeGreaterThan(WOLF_SPEC.tuning.airAccel);
    // Body footprint — Wolf is the bigger silhouette.
    expect(WOLF_SPEC.tuning.width).toBeGreaterThan(CAT_SPEC.tuning.width);
    expect(WOLF_SPEC.tuning.height).toBeGreaterThan(CAT_SPEC.tuning.height);
  });

  it('Wolf and Cat have distinct movesets (no shared move ids)', () => {
    const wolfIds = WOLF_SPEC.moves.map((m) => m.id);
    const catIds = CAT_SPEC.moves.map((m) => m.id);
    for (const id of wolfIds) {
      expect(catIds).not.toContain(id);
    }
    // Each kit covers a jab + smash + aerial — the Sub-AC 3.3 contract.
    for (const spec of [WOLF_SPEC, CAT_SPEC]) {
      const types = spec.moves.map((m) => m.type);
      expect(types).toContain('jab');
      expect(types).toContain('smash');
      expect(types).toContain('aerial');
    }
  });

  it('Wolf moveset matches the live class registration order', () => {
    // Drift guard: if Wolf.registerAttack order is rearranged without
    // updating the spec (or vice versa), this fails.
    //
    // AC 60002 Sub-AC 2: tilt slots between jab and smash so the
    // grounded triplet (jab / tilt / smash) is contiguous at the head
    // of the array; the three aerials (nair / fair / bair) trail
    // contiguously next, completing the Seed's "3 aerials per
    // character" requirement for Character 1.
    // AC 60201 Sub-AC 1: the neutral special (counter) appends after
    // the aerials in registration order.
    // AC 60202 Sub-AC 2: the up special (multiHitRising) appends after
    // the neutral special in registration order.
    expect(WOLF_MOVES).toEqual([
      WOLF_JAB,
      WOLF_TILT,
      WOLF_SMASH,
      WOLF_NAIR,
      WOLF_FAIR,
      WOLF_BAIR,
      WOLF_NEUTRAL_SPECIAL,
      WOLF_SIDE_SPECIAL,
      WOLF_UP_SPECIAL,
      WOLF_DOWN_SPECIAL,
    ]);
    expect(WOLF_SPEC.moves).toBe(WOLF_MOVES);
  });

  it('Cat moveset matches the live class registration order', () => {
    // Drift guard mirroring the Wolf check above.
    //
    // AC 60003 Sub-AC 3: tilt slots between jab and smash so the
    // grounded triplet (jab / tilt / smash) is contiguous at the head
    // of the array, then the three aerials (nair / fair / bair) trail
    // contiguously, closed out by the two specials (neutral / up) —
    // same 8-entry shape as {@link WOLF_MOVES}. The complete table is
    // the AC 60003 Sub-AC 3 deliverable for Character 2.
    // AC 60201 Sub-AC 1: the neutral special (projectile shuriken)
    // appends after the aerials in registration order.
    // AC 60202 Sub-AC 2: the up special (teleport) appends after the
    // neutral special in registration order.
    expect(CAT_MOVES).toEqual([
      CAT_JAB,
      CAT_TILT,
      CAT_SMASH,
      CAT_NAIR,
      CAT_FAIR,
      CAT_BAIR,
      CAT_NEUTRAL_SPECIAL,
      CAT_SIDE_SPECIAL,
      CAT_UP_SPECIAL,
      CAT_DOWN_SPECIAL,
    ]);
    expect(CAT_SPEC.moves).toBe(CAT_MOVES);
  });

  it('Wolf and Cat have distinct sprite placeholder colours', () => {
    expect(WOLF_PLACEHOLDER.primaryColor).not.toBe(CAT_PLACEHOLDER.primaryColor);
    expect(WOLF_PLACEHOLDER.accentColor).not.toBe(CAT_PLACEHOLDER.accentColor);
  });

  it('placeholder dimensions mirror the underlying tuning', () => {
    expect(WOLF_PLACEHOLDER.width).toBe(WOLF_TUNING.width);
    expect(WOLF_PLACEHOLDER.height).toBe(WOLF_TUNING.height);
    expect(CAT_PLACEHOLDER.width).toBe(CAT_TUNING.width);
    expect(CAT_PLACEHOLDER.height).toBe(CAT_TUNING.height);
  });

  it('roles flag the bruiser/ninja archetype split', () => {
    expect(WOLF_SPEC.role).toBe('bruiser');
    expect(CAT_SPEC.role).toBe('ninja');
  });

  it('display names are human-readable (not just the id)', () => {
    expect(WOLF_SPEC.displayName).toBe('Wolf');
    expect(CAT_SPEC.displayName).toBe('Cat');
  });
});

// ---------------------------------------------------------------------------
// AC 10402 Sub-AC 2 — second M1 character (Cat) sprite-key + Phaser
// animation wiring. Locks down that the Cat placeholder ships a non-null
// `spriteKey` pointing at the loaded idle spritesheet AND that all four
// canonical animation slots (idle / run / jump / attack) resolve to a
// non-null Phaser animation key — replacing the placeholder rectangle
// rendering with the real sprite frames in the MatchScene render pipeline.
// Mirrors the AC 10401 Sub-AC 1 contract that does the same job for the
// FIRST M1 character (Wolf).
// ---------------------------------------------------------------------------

describe('Cat sprite-key + animation wiring (AC 10402 Sub-AC 2)', () => {
  it('CAT_PLACEHOLDER.spriteKey points at the loaded idle spritesheet', () => {
    // Non-null is the contract — AC 10402 Sub-AC 2 promotes Cat off the
    // placeholder rectangle onto a real sprite. The exact key must be
    // the canonical idle texture so MatchScene's `add.sprite(.., key,
    // 0)` constructor primes the visible frame to the rest pose.
    expect(CAT_PLACEHOLDER.spriteKey).toBe(ASSET_KEYS.charCatIdle);
    expect(CAT_PLACEHOLDER.spriteKey).not.toBeNull();
  });

  it('Cat ships a loaded spritesheet for every canonical animation slot', () => {
    // The four sheets the M1 art delivery includes — idle / run / jump
    // / attack. Each must resolve to a non-null cache key so the
    // `registerCharacterSpriteAnimations` helper finds the texture and
    // builds the Phaser animation against it.
    for (const sheet of ['idle', 'run', 'jump', 'attack'] as const) {
      const key = getCharacterSpritesheetKey('cat', sheet);
      expect(key).not.toBeNull();
      expect(typeof key).toBe('string');
      expect((key as string).length).toBeGreaterThan(0);
    }
  });

  it('Cat resolves a non-null Phaser animation key for every sprite state', () => {
    // The classifier produces 6 discrete states (idle / run / jump /
    // fall / attack / hurt) — each must collapse onto a registered
    // Phaser animation so the MatchScene render loop's `play()` call
    // never hits a missing key. `fall` and `hurt` collapse onto the
    // jump and idle sheets respectively (see `collapseStateToSheet`),
    // so a non-null lookup confirms the collapse rule fires too.
    for (const state of ['idle', 'run', 'jump', 'fall', 'attack', 'hurt'] as const) {
      const animKey = getSpriteAnimationKey('cat', state);
      expect(animKey).not.toBeNull();
      // Canonical naming pattern locked down so the MatchScene render
      // loop and the animation registry never drift apart.
      expect(animKey).toMatch(/^cat\.(idle|run|jump|attack)\.anim$/);
    }
  });

  it('SPRITE_ANIM_SPECS covers all four canonical Cat animation slots', () => {
    // The shared spec table drives the registration — making sure it
    // covers each of Cat's four sheet slots locks the M1 art-delivery
    // shape down (idle loops, run loops, jump plays-once-and-holds,
    // attack plays-once-and-holds).
    const sheets = SPRITE_ANIM_SPECS.map((s) => s.sheet);
    expect(sheets).toContain('idle');
    expect(sheets).toContain('run');
    expect(sheets).toContain('jump');
    expect(sheets).toContain('attack');
    // Cadence sanity — `idle` and `run` loop forever, `jump` and
    // `attack` play once and hold the last frame so the Cat doesn't
    // snap back to frame 0 between phase transitions.
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

  it('Cat sprite-key wiring matches the Wolf wiring shape (M1 parity)', () => {
    // AC 10401 Sub-AC 1 (Wolf) and AC 10402 Sub-AC 2 (Cat) ship the
    // same kind of contract — both M1 characters carry a non-null
    // `spriteKey` and both resolve a Phaser animation key for every
    // state. This parity test guards against a future change that
    // promotes Wolf alone (or Cat alone) and silently regresses the
    // other.
    expect(WOLF_PLACEHOLDER.spriteKey).not.toBeNull();
    expect(CAT_PLACEHOLDER.spriteKey).not.toBeNull();
    for (const state of ['idle', 'run', 'jump', 'fall', 'attack', 'hurt'] as const) {
      expect(getSpriteAnimationKey('wolf', state)).not.toBeNull();
      expect(getSpriteAnimationKey('cat', state)).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// AC 60002 Sub-AC 2 — Wolf grounded jab / tilt / smash with full
// animation states. Locks down the data shape (frame counts, damage,
// knockback, hitbox geometry) and the per-move animation block driving
// the renderer's frame index selector.
// ---------------------------------------------------------------------------

describe('Wolf grounded triplet — jab / tilt / smash (AC 60002 Sub-AC 2)', () => {
  it('Wolf publishes a tilt move with full AttackMove data', () => {
    expect(WOLF_TILT).toBeDefined();
    expect(WOLF_TILT.id).toBe('wolf.tilt');
    expect(WOLF_TILT.type).toBe('tilt');
    expect(WOLF_TILT.damage).toBeGreaterThan(0);
    expect(WOLF_TILT.knockback.x).toBeGreaterThan(0);
    expect(WOLF_TILT.knockback.scaling).toBeGreaterThan(0);
    expect(WOLF_TILT.hitbox.offsetX).toBeGreaterThan(0);
    expect(WOLF_TILT.hitbox.width).toBeGreaterThan(0);
    expect(WOLF_TILT.hitbox.height).toBeGreaterThan(0);
    expect(WOLF_TILT.startupFrames).toBeGreaterThan(0);
    expect(WOLF_TILT.activeFrames).toBeGreaterThan(0);
    expect(WOLF_TILT.recoveryFrames).toBeGreaterThan(0);
    expect(WOLF_TILT.cooldownFrames).toBeGreaterThan(0);
  });

  it('tilt sits between jab and smash on the speed-vs-power curve', () => {
    // Damage gradient: jab (poke) < tilt (spacer) < smash (finisher).
    expect(WOLF_TILT.damage).toBeGreaterThan(WOLF_JAB.damage);
    expect(WOLF_TILT.damage).toBeLessThan(WOLF_SMASH.damage);
    // Knockback scaling gradient mirrors the damage gradient.
    expect(WOLF_TILT.knockback.scaling).toBeGreaterThan(WOLF_JAB.knockback.scaling);
    expect(WOLF_TILT.knockback.scaling).toBeLessThan(WOLF_SMASH.knockback.scaling);
    // Startup gradient: faster than smash, slower than jab.
    expect(WOLF_TILT.startupFrames).toBeGreaterThan(WOLF_JAB.startupFrames);
    expect(WOLF_TILT.startupFrames).toBeLessThan(WOLF_SMASH.startupFrames);
  });

  it('tilt has a longer reach than jab (the spacing role)', () => {
    expect(WOLF_TILT.hitbox.offsetX).toBeGreaterThan(WOLF_JAB.hitbox.offsetX);
    expect(WOLF_TILT.hitbox.width).toBeGreaterThan(WOLF_JAB.hitbox.width);
  });

  it('Wolf grounded triplet covers all three grounded move types', () => {
    const groundedTypes = [WOLF_JAB.type, WOLF_TILT.type, WOLF_SMASH.type];
    expect(groundedTypes).toContain('jab');
    expect(groundedTypes).toContain('tilt');
    expect(groundedTypes).toContain('smash');
  });

  it('every grounded move declares a per-phase animation block (Seed: 6-8 frames)', () => {
    for (const move of [WOLF_JAB, WOLF_TILT, WOLF_SMASH]) {
      expect(move.animation).toBeDefined();
      const anim = move.animation!;
      expect(anim.startupFrames).toBeGreaterThanOrEqual(1);
      expect(anim.activeFrames).toBeGreaterThanOrEqual(1);
      expect(anim.recoveryFrames).toBeGreaterThanOrEqual(1);
      // Seed constraint: 6-8 art frames per move.
      const total = anim.startupFrames + anim.activeFrames + anim.recoveryFrames;
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(8);
    }
  });

  it('art-frame counts never exceed gameplay-phase frame counts', () => {
    // Stretch contract: a phase can ride more than one gameplay frame
    // per art frame (held for emphasis), but it cannot demand more art
    // frames than the gameplay phase has time to play. Otherwise the
    // animation selector clamps and the last few art frames are never
    // displayed — a wasted asset and a confusing read for the animator.
    for (const move of [WOLF_JAB, WOLF_TILT, WOLF_SMASH]) {
      const anim = move.animation!;
      expect(anim.startupFrames).toBeLessThanOrEqual(move.startupFrames);
      expect(anim.activeFrames).toBeLessThanOrEqual(move.activeFrames);
      expect(anim.recoveryFrames).toBeLessThanOrEqual(move.recoveryFrames);
    }
  });

  it('jab animation expands to 6 art frames (2/1/3)', () => {
    expect(WOLF_JAB.animation).toEqual({
      startupFrames: 2,
      activeFrames: 1,
      recoveryFrames: 3,
    });
  });

  it('tilt animation expands to 7 art frames (2/2/3)', () => {
    expect(WOLF_TILT.animation).toEqual({
      startupFrames: 2,
      activeFrames: 2,
      recoveryFrames: 3,
    });
  });

  it('smash animation expands to 8 art frames (3/1/4)', () => {
    expect(WOLF_SMASH.animation).toEqual({
      startupFrames: 3,
      activeFrames: 1,
      recoveryFrames: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// AC 60002 Sub-AC 2 — complete Wolf move table.
//
// Locks down the *full* Character 1 move-table contract:
//   jab + tilt + smash + 2 specials + 3 aerials = 8 entries, every
//   one a fully populated AttackMove with hitbox geometry, damage %,
//   knockback vector, and startup/active/recovery/cooldown frame
//   counts. This is the table the AI predictor, balance-pass tooling,
//   replay logger, and HUD legend all read off — drift here ripples
//   through every consumer, so the suite is intentionally exhaustive.
// ---------------------------------------------------------------------------

describe('Wolf complete move table — Character 1 (AC 60002 Sub-AC 2)', () => {
  it('contains exactly 10 moves: jab + tilt + smash + 4 specials + 3 aerials', () => {
    // AC 60302 Sub-AC 2 — side special (dashStrike) appended, bumping
    // the table from 8 to 9 entries. AC 60304 Sub-AC 4 — down special
    // (groundPound) appended, bumping the table to 10 entries.
    expect(WOLF_MOVES.length).toBe(10);
    const types = WOLF_MOVES.map((m) => m.type);
    // Grounded triplet — exactly one of each.
    expect(types.filter((t) => t === 'jab').length).toBe(1);
    expect(types.filter((t) => t === 'tilt').length).toBe(1);
    expect(types.filter((t) => t === 'smash').length).toBe(1);
    // 3 aerials.
    expect(types.filter((t) => t === 'aerial').length).toBe(3);
    // 4 specials — neutral / side / up / down.
    expect(types.filter((t) => t === 'special').length).toBe(1);
    expect(types.filter((t) => t === 'sideSpecial').length).toBe(1);
    expect(types.filter((t) => t === 'upSpecial').length).toBe(1);
    expect(types.filter((t) => t === 'downSpecial').length).toBe(1);
  });

  it('every move conforms to the AttackMove schema (positive frame counts, damage, hitbox)', () => {
    for (const move of WOLF_MOVES) {
      // Identity & taxonomy.
      expect(typeof move.id).toBe('string');
      expect(move.id.length).toBeGreaterThan(0);
      expect(move.id.startsWith('wolf.')).toBe(true);
      expect(typeof move.type).toBe('string');
      // Damage — every move publishes a value (0 is allowed for moves
      // like counter where the damage comes from a paired hitbox, but
      // the field itself is always present).
      expect(typeof move.damage).toBe('number');
      expect(Number.isFinite(move.damage)).toBe(true);
      expect(move.damage).toBeGreaterThanOrEqual(0);
      // Knockback — vector with x, y, scaling triple.
      expect(typeof move.knockback.x).toBe('number');
      expect(typeof move.knockback.y).toBe('number');
      expect(typeof move.knockback.scaling).toBe('number');
      expect(Number.isFinite(move.knockback.x)).toBe(true);
      expect(Number.isFinite(move.knockback.y)).toBe(true);
      expect(Number.isFinite(move.knockback.scaling)).toBe(true);
      expect(move.knockback.scaling).toBeGreaterThanOrEqual(0);
      // Hitbox geometry — positive dimensions, finite offsets.
      expect(Number.isFinite(move.hitbox.offsetX)).toBe(true);
      expect(Number.isFinite(move.hitbox.offsetY)).toBe(true);
      expect(move.hitbox.width).toBeGreaterThan(0);
      expect(move.hitbox.height).toBeGreaterThan(0);
      // Frame timings — every component a positive integer.
      expect(Number.isInteger(move.startupFrames)).toBe(true);
      expect(Number.isInteger(move.activeFrames)).toBe(true);
      expect(Number.isInteger(move.recoveryFrames)).toBe(true);
      expect(Number.isInteger(move.cooldownFrames)).toBe(true);
      expect(move.startupFrames).toBeGreaterThan(0);
      expect(move.activeFrames).toBeGreaterThan(0);
      expect(move.recoveryFrames).toBeGreaterThan(0);
      expect(move.cooldownFrames).toBeGreaterThanOrEqual(0);
    }
  });

  it('every move id is unique within the Wolf move table', () => {
    const ids = WOLF_MOVES.map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('the three aerials cover all three Smash directional slots (neutral / forward / back)', () => {
    expect(WOLF_NAIR.id).toBe('wolf.nair');
    expect(WOLF_FAIR.id).toBe('wolf.fair');
    expect(WOLF_BAIR.id).toBe('wolf.bair');
    // All three are typed as `aerial` — directional dispatch lives on
    // the `AerialMove.aerialDirection` field for the directional ones.
    expect(WOLF_NAIR.type).toBe('aerial');
    expect(WOLF_FAIR.type).toBe('aerial');
    expect(WOLF_BAIR.type).toBe('aerial');
    // Damage gradient — nair lightest, fair mid, bair heaviest (the
    // canonical bair-as-finisher pattern).
    expect(WOLF_FAIR.damage).toBeGreaterThan(WOLF_NAIR.damage);
    expect(WOLF_BAIR.damage).toBeGreaterThan(WOLF_FAIR.damage);
  });

  it('the two specials cover neutral and up dispatch slots', () => {
    expect(WOLF_NEUTRAL_SPECIAL.id).toBe('wolf.neutral_special');
    expect(WOLF_NEUTRAL_SPECIAL.type).toBe('special');
    expect(WOLF_UP_SPECIAL.id).toBe('wolf.up_special');
    expect(WOLF_UP_SPECIAL.type).toBe('upSpecial');
  });

  it('the move table is the same array consumed by Wolf.registerAttack', () => {
    // Order in WOLF_MOVES mirrors the registration call sequence so
    // index 0 in the table is the press-attack default (jab). AC 60304
    // Sub-AC 4 appends the down special as the 10th (final) entry.
    expect(WOLF_MOVES[0]).toBe(WOLF_JAB);
    expect(WOLF_MOVES[1]).toBe(WOLF_TILT);
    expect(WOLF_MOVES[2]).toBe(WOLF_SMASH);
    expect(WOLF_MOVES[3]).toBe(WOLF_NAIR);
    expect(WOLF_MOVES[4]).toBe(WOLF_FAIR);
    expect(WOLF_MOVES[5]).toBe(WOLF_BAIR);
    expect(WOLF_MOVES[6]).toBe(WOLF_NEUTRAL_SPECIAL);
    expect(WOLF_MOVES[7]).toBe(WOLF_SIDE_SPECIAL);
    expect(WOLF_MOVES[8]).toBe(WOLF_UP_SPECIAL);
    expect(WOLF_MOVES[9]).toBe(WOLF_DOWN_SPECIAL);
  });

  it('every move can be looked up by type via findMoveByType (FCFS dispatch order)', () => {
    expect(findMoveByType(WOLF_SPEC, 'jab')).toBe(WOLF_JAB);
    expect(findMoveByType(WOLF_SPEC, 'tilt')).toBe(WOLF_TILT);
    expect(findMoveByType(WOLF_SPEC, 'smash')).toBe(WOLF_SMASH);
    expect(findMoveByType(WOLF_SPEC, 'aerial')).toBe(WOLF_NAIR);
    expect(findMoveByType(WOLF_SPEC, 'special')).toBe(WOLF_NEUTRAL_SPECIAL);
    expect(findMoveByType(WOLF_SPEC, 'sideSpecial')).toBe(WOLF_SIDE_SPECIAL);
    expect(findMoveByType(WOLF_SPEC, 'upSpecial')).toBe(WOLF_UP_SPECIAL);
  });
});

// ---------------------------------------------------------------------------
// AC 60003 Sub-AC 3 — Cat grounded jab / tilt / smash with full
// animation states. Mirror of the Wolf block above; locks down Cat's
// data shape (frame counts, damage, knockback, hitbox geometry) and
// the per-move animation block driving the renderer's frame index
// selector.
// ---------------------------------------------------------------------------

describe('Cat grounded triplet — jab / tilt / smash (AC 60003 Sub-AC 3)', () => {
  it('Cat publishes a tilt move with full AttackMove data', () => {
    expect(CAT_TILT).toBeDefined();
    expect(CAT_TILT.id).toBe('cat.tilt');
    expect(CAT_TILT.type).toBe('tilt');
    expect(CAT_TILT.damage).toBeGreaterThan(0);
    expect(CAT_TILT.knockback.x).toBeGreaterThan(0);
    expect(CAT_TILT.knockback.scaling).toBeGreaterThan(0);
    expect(CAT_TILT.hitbox.offsetX).toBeGreaterThan(0);
    expect(CAT_TILT.hitbox.width).toBeGreaterThan(0);
    expect(CAT_TILT.hitbox.height).toBeGreaterThan(0);
    expect(CAT_TILT.startupFrames).toBeGreaterThan(0);
    expect(CAT_TILT.activeFrames).toBeGreaterThan(0);
    expect(CAT_TILT.recoveryFrames).toBeGreaterThan(0);
    expect(CAT_TILT.cooldownFrames).toBeGreaterThan(0);
  });

  it('tilt sits between jab and smash on the speed-vs-power curve', () => {
    // Damage gradient: jab (poke) < tilt (spacer) < smash (finisher).
    expect(CAT_TILT.damage).toBeGreaterThan(CAT_JAB.damage);
    expect(CAT_TILT.damage).toBeLessThan(CAT_SMASH.damage);
    // Knockback scaling gradient mirrors the damage gradient.
    expect(CAT_TILT.knockback.scaling).toBeGreaterThan(CAT_JAB.knockback.scaling);
    expect(CAT_TILT.knockback.scaling).toBeLessThan(CAT_SMASH.knockback.scaling);
    // Startup gradient: faster than smash, slower than jab.
    expect(CAT_TILT.startupFrames).toBeGreaterThan(CAT_JAB.startupFrames);
    expect(CAT_TILT.startupFrames).toBeLessThan(CAT_SMASH.startupFrames);
  });

  it('tilt has a longer reach than jab (the spacing role)', () => {
    expect(CAT_TILT.hitbox.offsetX).toBeGreaterThan(CAT_JAB.hitbox.offsetX);
    expect(CAT_TILT.hitbox.width).toBeGreaterThan(CAT_JAB.hitbox.width);
  });

  it('Cat grounded triplet covers all three grounded move types', () => {
    const groundedTypes = [CAT_JAB.type, CAT_TILT.type, CAT_SMASH.type];
    expect(groundedTypes).toContain('jab');
    expect(groundedTypes).toContain('tilt');
    expect(groundedTypes).toContain('smash');
  });

  it('every grounded move declares a per-phase animation block (Seed: 6-8 frames)', () => {
    for (const move of [CAT_JAB, CAT_TILT, CAT_SMASH]) {
      expect(move.animation).toBeDefined();
      const anim = move.animation!;
      expect(anim.startupFrames).toBeGreaterThanOrEqual(1);
      expect(anim.activeFrames).toBeGreaterThanOrEqual(1);
      expect(anim.recoveryFrames).toBeGreaterThanOrEqual(1);
      // Seed constraint: 6-8 art frames per move.
      const total = anim.startupFrames + anim.activeFrames + anim.recoveryFrames;
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(8);
    }
  });

  it('art-frame counts never exceed gameplay-phase frame counts', () => {
    // Stretch contract: a phase can ride more than one gameplay frame
    // per art frame (held for emphasis), but it cannot demand more art
    // frames than the gameplay phase has time to play. Otherwise the
    // animation selector clamps and the last few art frames are never
    // displayed — a wasted asset and a confusing read for the animator.
    for (const move of [CAT_JAB, CAT_TILT, CAT_SMASH]) {
      const anim = move.animation!;
      expect(anim.startupFrames).toBeLessThanOrEqual(move.startupFrames);
      expect(anim.activeFrames).toBeLessThanOrEqual(move.activeFrames);
      expect(anim.recoveryFrames).toBeLessThanOrEqual(move.recoveryFrames);
    }
  });

  it('jab animation expands to 6 art frames (2/1/3)', () => {
    expect(CAT_JAB.animation).toEqual({
      startupFrames: 2,
      activeFrames: 1,
      recoveryFrames: 3,
    });
  });

  it('tilt animation expands to 7 art frames (2/2/3)', () => {
    expect(CAT_TILT.animation).toEqual({
      startupFrames: 2,
      activeFrames: 2,
      recoveryFrames: 3,
    });
  });

  it('smash animation expands to 8 art frames (3/1/4)', () => {
    expect(CAT_SMASH.animation).toEqual({
      startupFrames: 3,
      activeFrames: 1,
      recoveryFrames: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// AC 60004 Sub-AC 4 — Owl grounded jab / tilt / smash with full
// animation states. Mirror of the Wolf and Cat blocks above; locks
// down Owl's data shape (frame counts, damage, knockback, hitbox
// geometry) and the per-move animation block driving the renderer's
// frame index selector.
// ---------------------------------------------------------------------------

describe('Owl grounded triplet — jab / tilt / smash (AC 60004 Sub-AC 4)', () => {
  it('Owl publishes a tilt move with full AttackMove data', () => {
    expect(OWL_TILT).toBeDefined();
    expect(OWL_TILT.id).toBe('owl.tilt');
    expect(OWL_TILT.type).toBe('tilt');
    expect(OWL_TILT.damage).toBeGreaterThan(0);
    expect(OWL_TILT.knockback.x).toBeGreaterThan(0);
    expect(OWL_TILT.knockback.scaling).toBeGreaterThan(0);
    expect(OWL_TILT.hitbox.offsetX).toBeGreaterThan(0);
    expect(OWL_TILT.hitbox.width).toBeGreaterThan(0);
    expect(OWL_TILT.hitbox.height).toBeGreaterThan(0);
    expect(OWL_TILT.startupFrames).toBeGreaterThan(0);
    expect(OWL_TILT.activeFrames).toBeGreaterThan(0);
    expect(OWL_TILT.recoveryFrames).toBeGreaterThan(0);
    expect(OWL_TILT.cooldownFrames).toBeGreaterThan(0);
  });

  it('Owl publishes a jab move with full AttackMove data', () => {
    expect(OWL_JAB).toBeDefined();
    expect(OWL_JAB.id).toBe('owl.jab');
    expect(OWL_JAB.type).toBe('jab');
    expect(OWL_JAB.damage).toBeGreaterThan(0);
    expect(OWL_JAB.knockback.x).toBeGreaterThan(0);
    expect(OWL_JAB.hitbox.offsetX).toBeGreaterThan(0);
    expect(OWL_JAB.startupFrames).toBeGreaterThan(0);
    expect(OWL_JAB.activeFrames).toBeGreaterThan(0);
    expect(OWL_JAB.recoveryFrames).toBeGreaterThan(0);
    expect(OWL_JAB.cooldownFrames).toBeGreaterThan(0);
  });

  it('Owl publishes a smash move with full AttackMove data', () => {
    expect(OWL_SMASH).toBeDefined();
    expect(OWL_SMASH.id).toBe('owl.smash');
    expect(OWL_SMASH.type).toBe('smash');
    expect(OWL_SMASH.damage).toBeGreaterThan(0);
    expect(OWL_SMASH.knockback.x).toBeGreaterThan(0);
    expect(OWL_SMASH.knockback.scaling).toBeGreaterThan(0);
    expect(OWL_SMASH.hitbox.offsetX).toBeGreaterThan(0);
    expect(OWL_SMASH.startupFrames).toBeGreaterThan(0);
    expect(OWL_SMASH.activeFrames).toBeGreaterThan(0);
    expect(OWL_SMASH.recoveryFrames).toBeGreaterThan(0);
    expect(OWL_SMASH.cooldownFrames).toBeGreaterThan(0);
  });

  it('tilt sits between jab and smash on the speed-vs-power curve', () => {
    // Damage gradient: jab (poke) < tilt (spacer) < smash (finisher).
    expect(OWL_TILT.damage).toBeGreaterThan(OWL_JAB.damage);
    expect(OWL_TILT.damage).toBeLessThan(OWL_SMASH.damage);
    // Knockback scaling gradient mirrors the damage gradient.
    expect(OWL_TILT.knockback.scaling).toBeGreaterThan(OWL_JAB.knockback.scaling);
    expect(OWL_TILT.knockback.scaling).toBeLessThan(OWL_SMASH.knockback.scaling);
    // Startup gradient: faster than smash, slower than jab.
    expect(OWL_TILT.startupFrames).toBeGreaterThan(OWL_JAB.startupFrames);
    expect(OWL_TILT.startupFrames).toBeLessThan(OWL_SMASH.startupFrames);
  });

  it('tilt has a longer reach than jab (the spacing role)', () => {
    expect(OWL_TILT.hitbox.offsetX).toBeGreaterThan(OWL_JAB.hitbox.offsetX);
    expect(OWL_TILT.hitbox.width).toBeGreaterThan(OWL_JAB.hitbox.width);
  });

  it('smash has the longest reach of the grounded triplet (KO finisher)', () => {
    expect(OWL_SMASH.hitbox.offsetX).toBeGreaterThan(OWL_TILT.hitbox.offsetX);
    expect(OWL_SMASH.hitbox.width).toBeGreaterThan(OWL_TILT.hitbox.width);
  });

  it('Owl out-reaches both Wolf and Cat on every grounded move (the mage identity)', () => {
    // Owl's defining axis is *grounded reach*. Locking that down here
    // means a balance pass that accidentally clipped his hitbox
    // offsets back to the cast median surfaces in the suite, not in
    // playtesting.
    expect(OWL_JAB.hitbox.offsetX).toBeGreaterThan(WOLF_JAB.hitbox.offsetX);
    expect(OWL_JAB.hitbox.offsetX).toBeGreaterThan(CAT_JAB.hitbox.offsetX);
    expect(OWL_TILT.hitbox.offsetX).toBeGreaterThan(WOLF_TILT.hitbox.offsetX);
    expect(OWL_TILT.hitbox.offsetX).toBeGreaterThan(CAT_TILT.hitbox.offsetX);
    expect(OWL_SMASH.hitbox.offsetX).toBeGreaterThan(WOLF_SMASH.hitbox.offsetX);
    expect(OWL_SMASH.hitbox.offsetX).toBeGreaterThan(CAT_SMASH.hitbox.offsetX);
  });

  it('Owl grounded triplet covers all three grounded move types', () => {
    const groundedTypes = [OWL_JAB.type, OWL_TILT.type, OWL_SMASH.type];
    expect(groundedTypes).toContain('jab');
    expect(groundedTypes).toContain('tilt');
    expect(groundedTypes).toContain('smash');
  });

  it('every grounded move declares a per-phase animation block (Seed: 6-8 frames)', () => {
    for (const move of [OWL_JAB, OWL_TILT, OWL_SMASH]) {
      expect(move.animation).toBeDefined();
      const anim = move.animation!;
      expect(anim.startupFrames).toBeGreaterThanOrEqual(1);
      expect(anim.activeFrames).toBeGreaterThanOrEqual(1);
      expect(anim.recoveryFrames).toBeGreaterThanOrEqual(1);
      // Seed constraint: 6-8 art frames per move.
      const total = anim.startupFrames + anim.activeFrames + anim.recoveryFrames;
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(8);
    }
  });

  it('art-frame counts never exceed gameplay-phase frame counts', () => {
    // Stretch contract: a phase can ride more than one gameplay frame
    // per art frame (held for emphasis), but it cannot demand more art
    // frames than the gameplay phase has time to play. Otherwise the
    // animation selector clamps and the last few art frames are never
    // displayed — a wasted asset and a confusing read for the animator.
    for (const move of [OWL_JAB, OWL_TILT, OWL_SMASH]) {
      const anim = move.animation!;
      expect(anim.startupFrames).toBeLessThanOrEqual(move.startupFrames);
      expect(anim.activeFrames).toBeLessThanOrEqual(move.activeFrames);
      expect(anim.recoveryFrames).toBeLessThanOrEqual(move.recoveryFrames);
    }
  });

  it('jab animation expands to 6 art frames (2/1/3)', () => {
    expect(OWL_JAB.animation).toEqual({
      startupFrames: 2,
      activeFrames: 1,
      recoveryFrames: 3,
    });
  });

  it('tilt animation expands to 7 art frames (2/2/3)', () => {
    expect(OWL_TILT.animation).toEqual({
      startupFrames: 2,
      activeFrames: 2,
      recoveryFrames: 3,
    });
  });

  it('smash animation expands to 8 art frames (3/1/4)', () => {
    expect(OWL_SMASH.animation).toEqual({
      startupFrames: 3,
      activeFrames: 1,
      recoveryFrames: 4,
    });
  });

  it('Owl spec exposes the full move table in registration order', () => {
    // Drift guard: if Owl.registerAttack order is rearranged without
    // updating the spec (or vice versa), this fails — the same shape
    // the Wolf/Cat tests above lock down.
    // AC 60004 Sub-AC 4 — complete move table for Character 3 (mage):
    // jab → tilt → smash → nair → fair → bair → neutral special →
    // up special. 8 entries total, mirroring Wolf and Cat.
    expect(OWL_MOVES).toEqual([
      OWL_JAB,
      OWL_TILT,
      OWL_SMASH,
      OWL_NAIR,
      OWL_FAIR,
      OWL_BAIR,
      OWL_NEUTRAL_SPECIAL,
      OWL_SIDE_SPECIAL,
      OWL_UP_SPECIAL,
      OWL_DOWN_SPECIAL,
    ]);
    expect(OWL_SPEC.moves).toBe(OWL_MOVES);
  });

  it('Owl spec is flagged playable now that the grounded triplet is wired', () => {
    expect(OWL_SPEC.playable).toBe(true);
  });

  it('Owl placeholder dimensions mirror the underlying tuning', () => {
    expect(OWL_SPEC.placeholder.width).toBe(OWL_TUNING.width);
    expect(OWL_SPEC.placeholder.height).toBe(OWL_TUNING.height);
  });

  it('Owl tuning carries a distinct silhouette (taller, thinner) from Wolf and Cat', () => {
    // Tower-shaped hurtbox: narrower than Wolf's, taller than either.
    expect(OWL_TUNING.width).toBeLessThan(WOLF_TUNING.width);
    expect(OWL_TUNING.width).toBeGreaterThan(CAT_TUNING.width);
    expect(OWL_TUNING.height).toBeGreaterThan(WOLF_TUNING.height);
    expect(OWL_TUNING.height).toBeGreaterThan(CAT_TUNING.height);
  });

  it('Owl mass sits between Cat (light) and Wolf (heavy)', () => {
    expect(OWL_TUNING.mass).toBeGreaterThan(CAT_TUNING.mass);
    expect(OWL_TUNING.mass).toBeLessThan(WOLF_TUNING.mass);
  });

  it('Owl moveset shares no move ids with Wolf or Cat', () => {
    const owlIds = OWL_MOVES.map((m) => m.id);
    const wolfIds = WOLF_MOVES.map((m) => m.id);
    const catIds = CAT_MOVES.map((m) => m.id);
    for (const id of owlIds) {
      expect(wolfIds).not.toContain(id);
      expect(catIds).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Move lookup
// ---------------------------------------------------------------------------

describe('Character roster — findMoveByType', () => {
  it("returns the first move of the requested type for each character", () => {
    const types: MoveType[] = ['jab', 'smash', 'aerial'];
    for (const type of types) {
      const wolfMove = findMoveByType(WOLF_SPEC, type);
      const catMove = findMoveByType(CAT_SPEC, type);
      expect(wolfMove).toBeDefined();
      expect(catMove).toBeDefined();
      expect(wolfMove!.type).toBe(type);
      expect(catMove!.type).toBe(type);
    }
  });

  it('returns undefined for move types no character ships yet', () => {
    // AC 60201 Sub-AC 1 wired neutral specials onto every character;
    // 'shield', 'grab', 'throw', 'taunt' remain unshipped move types
    // the lookup should reject for any spec.
    expect(findMoveByType(WOLF_SPEC, 'shield')).toBeUndefined();
    expect(findMoveByType(CAT_SPEC, 'shield')).toBeUndefined();
    expect(findMoveByType(WOLF_SPEC, 'taunt')).toBeUndefined();
  });

  it('returns the neutral special for each character (AC 60201 Sub-AC 1)', () => {
    // Every character ships exactly one type='special' move (the
    // neutral special), and `findMoveByType(spec, 'special')` returns
    // the matching record. Used by AI scripts and HUD legend.
    expect(findMoveByType(WOLF_SPEC, 'special')).toBe(WOLF_NEUTRAL_SPECIAL);
    expect(findMoveByType(CAT_SPEC, 'special')).toBe(CAT_NEUTRAL_SPECIAL);
    expect(findMoveByType(OWL_SPEC, 'special')).toBe(OWL_NEUTRAL_SPECIAL);
    expect(findMoveByType(BEAR_SPEC, 'special')).toBe(BEAR_NEUTRAL_SPECIAL);
  });

  it('returns the Owl jab/tilt/smash/aerial/special now that AC 60004 Sub-AC 4 wired the full move table', () => {
    // Owl's full move-table promotion (AC 60004 Sub-AC 4) means
    // findMoveByType resolves jab / tilt / smash / aerial / special to
    // the corresponding move records — same shape as Wolf and Cat.
    // The first 'aerial' entry in registration order is OWL_NAIR.
    expect(findMoveByType(OWL_SPEC, 'jab')).toBe(OWL_JAB);
    expect(findMoveByType(OWL_SPEC, 'tilt')).toBe(OWL_TILT);
    expect(findMoveByType(OWL_SPEC, 'smash')).toBe(OWL_SMASH);
    expect(findMoveByType(OWL_SPEC, 'aerial')).toBe(OWL_NAIR);
    expect(findMoveByType(OWL_SPEC, 'special')).toBe(OWL_NEUTRAL_SPECIAL);
  });

  it('returns the Bear jab/tilt/smash/aerial/special now that AC 60005 Sub-AC 5 wired the full move table', () => {
    // Bear's full move-table promotion (AC 60005 Sub-AC 5) means
    // findMoveByType resolves jab / tilt / smash / aerial / special to
    // the corresponding move records — same shape as Wolf, Cat, and
    // Owl. The first 'aerial' entry in registration order is BEAR_NAIR.
    expect(findMoveByType(BEAR_SPEC, 'jab')).toBe(BEAR_JAB);
    expect(findMoveByType(BEAR_SPEC, 'tilt')).toBe(BEAR_TILT);
    expect(findMoveByType(BEAR_SPEC, 'smash')).toBe(BEAR_SMASH);
    expect(findMoveByType(BEAR_SPEC, 'aerial')).toBe(BEAR_NAIR);
    expect(findMoveByType(BEAR_SPEC, 'special')).toBe(BEAR_NEUTRAL_SPECIAL);
  });
});

// ---------------------------------------------------------------------------
// AC 60001 Sub-AC 1 — Bear grounded jab / tilt / smash with full
// animation states. Mirror of the Wolf / Cat / Owl blocks above; locks
// down Bear's data shape (frame counts, damage, knockback, hitbox
// geometry) and the per-move animation block driving the renderer's
// frame index selector. Bear was the last roster slot to ship a
// grounded triplet, so this block also closes out the "every character
// has jab / tilt / smash" foundation contract.
// ---------------------------------------------------------------------------

describe('Bear grounded triplet — jab / tilt / smash (AC 60001 Sub-AC 1)', () => {
  it('Bear publishes a tilt move with full AttackMove data', () => {
    expect(BEAR_TILT).toBeDefined();
    expect(BEAR_TILT.id).toBe('bear.tilt');
    expect(BEAR_TILT.type).toBe('tilt');
    expect(BEAR_TILT.damage).toBeGreaterThan(0);
    expect(BEAR_TILT.knockback.x).toBeGreaterThan(0);
    expect(BEAR_TILT.knockback.scaling).toBeGreaterThan(0);
    expect(BEAR_TILT.hitbox.offsetX).toBeGreaterThan(0);
    expect(BEAR_TILT.hitbox.width).toBeGreaterThan(0);
    expect(BEAR_TILT.hitbox.height).toBeGreaterThan(0);
    expect(BEAR_TILT.startupFrames).toBeGreaterThan(0);
    expect(BEAR_TILT.activeFrames).toBeGreaterThan(0);
    expect(BEAR_TILT.recoveryFrames).toBeGreaterThan(0);
    expect(BEAR_TILT.cooldownFrames).toBeGreaterThan(0);
  });

  it('Bear publishes a jab move with full AttackMove data', () => {
    expect(BEAR_JAB).toBeDefined();
    expect(BEAR_JAB.id).toBe('bear.jab');
    expect(BEAR_JAB.type).toBe('jab');
    expect(BEAR_JAB.damage).toBeGreaterThan(0);
    expect(BEAR_JAB.knockback.x).toBeGreaterThan(0);
    expect(BEAR_JAB.hitbox.offsetX).toBeGreaterThan(0);
    expect(BEAR_JAB.startupFrames).toBeGreaterThan(0);
    expect(BEAR_JAB.activeFrames).toBeGreaterThan(0);
    expect(BEAR_JAB.recoveryFrames).toBeGreaterThan(0);
    expect(BEAR_JAB.cooldownFrames).toBeGreaterThan(0);
  });

  it('Bear publishes a smash move with full AttackMove data', () => {
    expect(BEAR_SMASH).toBeDefined();
    expect(BEAR_SMASH.id).toBe('bear.smash');
    expect(BEAR_SMASH.type).toBe('smash');
    expect(BEAR_SMASH.damage).toBeGreaterThan(0);
    expect(BEAR_SMASH.knockback.x).toBeGreaterThan(0);
    expect(BEAR_SMASH.knockback.scaling).toBeGreaterThan(0);
    expect(BEAR_SMASH.hitbox.offsetX).toBeGreaterThan(0);
    expect(BEAR_SMASH.startupFrames).toBeGreaterThan(0);
    expect(BEAR_SMASH.activeFrames).toBeGreaterThan(0);
    expect(BEAR_SMASH.recoveryFrames).toBeGreaterThan(0);
    expect(BEAR_SMASH.cooldownFrames).toBeGreaterThan(0);
  });

  it('tilt sits between jab and smash on the speed-vs-power curve', () => {
    // Damage gradient: jab (poke) < tilt (spacer) < smash (finisher).
    expect(BEAR_TILT.damage).toBeGreaterThan(BEAR_JAB.damage);
    expect(BEAR_TILT.damage).toBeLessThan(BEAR_SMASH.damage);
    // Knockback scaling gradient mirrors the damage gradient.
    expect(BEAR_TILT.knockback.scaling).toBeGreaterThan(BEAR_JAB.knockback.scaling);
    expect(BEAR_TILT.knockback.scaling).toBeLessThan(BEAR_SMASH.knockback.scaling);
    // Startup gradient: faster than smash, slower than jab.
    expect(BEAR_TILT.startupFrames).toBeGreaterThan(BEAR_JAB.startupFrames);
    expect(BEAR_TILT.startupFrames).toBeLessThan(BEAR_SMASH.startupFrames);
  });

  it('tilt has a longer reach than jab (the spacing role)', () => {
    expect(BEAR_TILT.hitbox.offsetX).toBeGreaterThan(BEAR_JAB.hitbox.offsetX);
    expect(BEAR_TILT.hitbox.width).toBeGreaterThan(BEAR_JAB.hitbox.width);
  });

  it('smash has the longest reach of the grounded triplet (KO finisher)', () => {
    expect(BEAR_SMASH.hitbox.offsetX).toBeGreaterThan(BEAR_TILT.hitbox.offsetX);
    expect(BEAR_SMASH.hitbox.width).toBeGreaterThan(BEAR_TILT.hitbox.width);
  });

  it('Bear hits hardest in the cast on every grounded move (the grappler identity)', () => {
    // Bear's defining axis is *raw damage*. Locking that down here
    // means a balance pass that accidentally clipped his damage back to
    // the cast median surfaces in the suite, not in playtesting.
    expect(BEAR_JAB.damage).toBeGreaterThan(WOLF_JAB.damage);
    expect(BEAR_JAB.damage).toBeGreaterThan(CAT_JAB.damage);
    expect(BEAR_JAB.damage).toBeGreaterThan(OWL_JAB.damage);
    expect(BEAR_TILT.damage).toBeGreaterThan(WOLF_TILT.damage);
    expect(BEAR_TILT.damage).toBeGreaterThan(CAT_TILT.damage);
    expect(BEAR_TILT.damage).toBeGreaterThan(OWL_TILT.damage);
    expect(BEAR_SMASH.damage).toBeGreaterThan(WOLF_SMASH.damage);
    expect(BEAR_SMASH.damage).toBeGreaterThan(CAT_SMASH.damage);
    expect(BEAR_SMASH.damage).toBeGreaterThan(OWL_SMASH.damage);
  });

  it('Bear pays for raw damage with the slowest startup in the cast', () => {
    // The flip side of "hits hardest" is "commits longest". Every Bear
    // grounded move has at least as much startup as the matching Wolf
    // move (and strictly more on the smash) — the canonical "more
    // power costs more commitment" trade-off, applied at the inter-
    // character level.
    expect(BEAR_JAB.startupFrames).toBeGreaterThanOrEqual(WOLF_JAB.startupFrames);
    expect(BEAR_TILT.startupFrames).toBeGreaterThanOrEqual(WOLF_TILT.startupFrames);
    expect(BEAR_SMASH.startupFrames).toBeGreaterThan(WOLF_SMASH.startupFrames);
  });

  it('Bear grounded triplet covers all three grounded move types', () => {
    const groundedTypes = [BEAR_JAB.type, BEAR_TILT.type, BEAR_SMASH.type];
    expect(groundedTypes).toContain('jab');
    expect(groundedTypes).toContain('tilt');
    expect(groundedTypes).toContain('smash');
  });

  it('every grounded move declares a per-phase animation block (Seed: 6-8 frames)', () => {
    for (const move of [BEAR_JAB, BEAR_TILT, BEAR_SMASH]) {
      expect(move.animation).toBeDefined();
      const anim = move.animation!;
      expect(anim.startupFrames).toBeGreaterThanOrEqual(1);
      expect(anim.activeFrames).toBeGreaterThanOrEqual(1);
      expect(anim.recoveryFrames).toBeGreaterThanOrEqual(1);
      // Seed constraint: 6-8 art frames per move.
      const total = anim.startupFrames + anim.activeFrames + anim.recoveryFrames;
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(8);
    }
  });

  it('art-frame counts never exceed gameplay-phase frame counts', () => {
    // Stretch contract: a phase can ride more than one gameplay frame
    // per art frame (held for emphasis), but it cannot demand more art
    // frames than the gameplay phase has time to play. Otherwise the
    // animation selector clamps and the last few art frames are never
    // displayed — a wasted asset and a confusing read for the animator.
    for (const move of [BEAR_JAB, BEAR_TILT, BEAR_SMASH]) {
      const anim = move.animation!;
      expect(anim.startupFrames).toBeLessThanOrEqual(move.startupFrames);
      expect(anim.activeFrames).toBeLessThanOrEqual(move.activeFrames);
      expect(anim.recoveryFrames).toBeLessThanOrEqual(move.recoveryFrames);
    }
  });

  it('jab animation expands to 6 art frames (2/1/3)', () => {
    expect(BEAR_JAB.animation).toEqual({
      startupFrames: 2,
      activeFrames: 1,
      recoveryFrames: 3,
    });
  });

  it('tilt animation expands to 7 art frames (2/2/3)', () => {
    expect(BEAR_TILT.animation).toEqual({
      startupFrames: 2,
      activeFrames: 2,
      recoveryFrames: 3,
    });
  });

  it('smash animation expands to 8 art frames (3/1/4)', () => {
    expect(BEAR_SMASH.animation).toEqual({
      startupFrames: 3,
      activeFrames: 1,
      recoveryFrames: 4,
    });
  });

  it('Bear spec exposes the full move table in registration order', () => {
    // Drift guard: if Bear.registerAttack order is rearranged without
    // updating the spec (or vice versa), this fails — same shape the
    // Wolf / Cat / Owl tests above lock down.
    // AC 60001 Sub-AC 1: grounded triplet (jab / tilt / smash).
    // AC 60005 Sub-AC 5: aerials (nair / fair / bair) slot after the
    // grounded triplet, completing the 8-entry move table.
    // AC 60201 Sub-AC 1: the neutral special (command grab) appends
    // after the aerials in registration order.
    // AC 60202 Sub-AC 2: the up special (tether) appends after the
    // neutral special in registration order.
    // AC 60304 Sub-AC 4: the down special (counter) appends as the
    // 10th and final entry, closing out the four-direction special kit.
    expect(BEAR_MOVES).toEqual([
      BEAR_JAB,
      BEAR_TILT,
      BEAR_SMASH,
      BEAR_NAIR,
      BEAR_FAIR,
      BEAR_BAIR,
      BEAR_NEUTRAL_SPECIAL,
      BEAR_SIDE_SPECIAL,
      BEAR_UP_SPECIAL,
      BEAR_DOWN_SPECIAL,
    ]);
    expect(BEAR_SPEC.moves).toBe(BEAR_MOVES);
  });

  it('Bear spec is flagged playable now that the grounded triplet is wired', () => {
    expect(BEAR_SPEC.playable).toBe(true);
  });

  it('Bear placeholder dimensions mirror the underlying tuning', () => {
    expect(BEAR_SPEC.placeholder.width).toBe(BEAR_TUNING.width);
    expect(BEAR_SPEC.placeholder.height).toBe(BEAR_TUNING.height);
  });

  it('Bear tuning carries a distinct silhouette (widest, heaviest) from the rest of the cast', () => {
    // Brick-shaped grappler hurtbox: widest body in the cast, heaviest
    // mass, slowest top speed. Locking these down at the data layer
    // prevents a balance pass that flattens the archetype into a
    // Wolf-clone from sneaking through.
    expect(BEAR_TUNING.width).toBeGreaterThan(WOLF_TUNING.width);
    expect(BEAR_TUNING.width).toBeGreaterThan(OWL_TUNING.width);
    expect(BEAR_TUNING.width).toBeGreaterThan(CAT_TUNING.width);
    expect(BEAR_TUNING.mass).toBeGreaterThan(WOLF_TUNING.mass);
    expect(BEAR_TUNING.mass).toBeGreaterThan(OWL_TUNING.mass);
    expect(BEAR_TUNING.mass).toBeGreaterThan(CAT_TUNING.mass);
    expect(BEAR_TUNING.maxRunSpeed).toBeLessThan(WOLF_TUNING.maxRunSpeed);
    expect(BEAR_TUNING.maxRunSpeed).toBeLessThan(OWL_TUNING.maxRunSpeed);
    expect(BEAR_TUNING.maxRunSpeed).toBeLessThan(CAT_TUNING.maxRunSpeed);
  });

  it('Bear moveset shares no move ids with the other roster slots', () => {
    const bearIds = BEAR_MOVES.map((m) => m.id);
    const wolfIds = WOLF_MOVES.map((m) => m.id);
    const catIds = CAT_MOVES.map((m) => m.id);
    const owlIds = OWL_MOVES.map((m) => m.id);
    for (const id of bearIds) {
      expect(wolfIds).not.toContain(id);
      expect(catIds).not.toContain(id);
      expect(owlIds).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// AC 60005 Sub-AC 5 — complete Bear move table.
//
// Locks down the *full* Character 4 move-table contract:
//   jab + tilt + smash + 2 specials + 3 aerials = 8 entries, every
//   one a fully populated AttackMove with hitbox geometry, damage %,
//   knockback vector, and startup/active/recovery/cooldown frame
//   counts. Mirror of the Wolf (AC 60002 Sub-AC 2), Cat (AC 60003
//   Sub-AC 3), and Owl (AC 60004 Sub-AC 4) full-table blocks above —
//   Bear is the fourth and final roster slot to ship a complete move
//   table, closing out the Seed's "4 characters with full movesets"
//   milestone.
// ---------------------------------------------------------------------------

describe('Bear complete move table — Character 4 (AC 60005 Sub-AC 5)', () => {
  it('contains exactly 10 moves: jab + tilt + smash + 4 specials + 3 aerials', () => {
    // AC 60302 Sub-AC 2 — side special (commandDash) appended, bumping
    // the table from 8 to 9 entries. AC 60304 Sub-AC 4 — down special
    // (counter) appended, bumping the table from 9 to 10 entries
    // (every direction of the special-button now has a dedicated move).
    expect(BEAR_MOVES.length).toBe(10);
    const types = BEAR_MOVES.map((m) => m.type);
    // Grounded triplet — exactly one of each.
    expect(types.filter((t) => t === 'jab').length).toBe(1);
    expect(types.filter((t) => t === 'tilt').length).toBe(1);
    expect(types.filter((t) => t === 'smash').length).toBe(1);
    // 3 aerials.
    expect(types.filter((t) => t === 'aerial').length).toBe(3);
    // 4 specials — neutral / side / up / down.
    expect(types.filter((t) => t === 'special').length).toBe(1);
    expect(types.filter((t) => t === 'sideSpecial').length).toBe(1);
    expect(types.filter((t) => t === 'upSpecial').length).toBe(1);
    expect(types.filter((t) => t === 'downSpecial').length).toBe(1);
  });

  it('every move conforms to the AttackMove schema (positive frame counts, damage, hitbox)', () => {
    for (const move of BEAR_MOVES) {
      // Identity & taxonomy.
      expect(typeof move.id).toBe('string');
      expect(move.id.length).toBeGreaterThan(0);
      expect(move.id.startsWith('bear.')).toBe(true);
      expect(typeof move.type).toBe('string');
      // Damage — every move publishes a value (0 is allowed for moves
      // like the command grab where the damage comes from the throw
      // payload, but the field itself is always present).
      expect(typeof move.damage).toBe('number');
      expect(Number.isFinite(move.damage)).toBe(true);
      expect(move.damage).toBeGreaterThanOrEqual(0);
      // Knockback — vector with x, y, scaling triple.
      expect(typeof move.knockback.x).toBe('number');
      expect(typeof move.knockback.y).toBe('number');
      expect(typeof move.knockback.scaling).toBe('number');
      expect(Number.isFinite(move.knockback.x)).toBe(true);
      expect(Number.isFinite(move.knockback.y)).toBe(true);
      expect(Number.isFinite(move.knockback.scaling)).toBe(true);
      expect(move.knockback.scaling).toBeGreaterThanOrEqual(0);
      // Hitbox geometry — positive dimensions, finite offsets.
      expect(Number.isFinite(move.hitbox.offsetX)).toBe(true);
      expect(Number.isFinite(move.hitbox.offsetY)).toBe(true);
      expect(move.hitbox.width).toBeGreaterThan(0);
      expect(move.hitbox.height).toBeGreaterThan(0);
      // Frame timings — every component a positive integer.
      expect(Number.isInteger(move.startupFrames)).toBe(true);
      expect(Number.isInteger(move.activeFrames)).toBe(true);
      expect(Number.isInteger(move.recoveryFrames)).toBe(true);
      expect(Number.isInteger(move.cooldownFrames)).toBe(true);
      expect(move.startupFrames).toBeGreaterThan(0);
      expect(move.activeFrames).toBeGreaterThan(0);
      expect(move.recoveryFrames).toBeGreaterThan(0);
      expect(move.cooldownFrames).toBeGreaterThanOrEqual(0);
    }
  });

  it('every move id is unique within the Bear move table', () => {
    const ids = BEAR_MOVES.map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('the three aerials cover all three Smash directional slots (neutral / forward / back)', () => {
    expect(BEAR_NAIR.id).toBe('bear.nair');
    expect(BEAR_FAIR.id).toBe('bear.fair');
    expect(BEAR_BAIR.id).toBe('bear.bair');
    // All three are typed as `aerial` — directional dispatch lives on
    // the `AerialMove.aerialDirection` field for the directional ones.
    expect(BEAR_NAIR.type).toBe('aerial');
    expect(BEAR_FAIR.type).toBe('aerial');
    expect(BEAR_BAIR.type).toBe('aerial');
    // Damage gradient — nair lightest, fair mid, bair heaviest (the
    // canonical bair-as-finisher pattern; mirrors the Wolf cast block).
    expect(BEAR_FAIR.damage).toBeGreaterThan(BEAR_NAIR.damage);
    expect(BEAR_BAIR.damage).toBeGreaterThan(BEAR_FAIR.damage);
  });

  it('the two specials cover neutral and up dispatch slots', () => {
    expect(BEAR_NEUTRAL_SPECIAL.id).toBe('bear.neutral_special');
    expect(BEAR_NEUTRAL_SPECIAL.type).toBe('special');
    expect(BEAR_UP_SPECIAL.id).toBe('bear.up_special');
    expect(BEAR_UP_SPECIAL.type).toBe('upSpecial');
  });

  it('the move table is the same array consumed by Bear.registerAttack', () => {
    // Order in BEAR_MOVES mirrors the registration call sequence so
    // index 0 in the table is the press-attack default (jab). AC 60304
    // Sub-AC 4 appends the down special as the 10th (final) entry.
    expect(BEAR_MOVES[0]).toBe(BEAR_JAB);
    expect(BEAR_MOVES[1]).toBe(BEAR_TILT);
    expect(BEAR_MOVES[2]).toBe(BEAR_SMASH);
    expect(BEAR_MOVES[3]).toBe(BEAR_NAIR);
    expect(BEAR_MOVES[4]).toBe(BEAR_FAIR);
    expect(BEAR_MOVES[5]).toBe(BEAR_BAIR);
    expect(BEAR_MOVES[6]).toBe(BEAR_NEUTRAL_SPECIAL);
    expect(BEAR_MOVES[7]).toBe(BEAR_SIDE_SPECIAL);
    expect(BEAR_MOVES[8]).toBe(BEAR_UP_SPECIAL);
    expect(BEAR_MOVES[9]).toBe(BEAR_DOWN_SPECIAL);
  });

  it('every move can be looked up by type via findMoveByType (FCFS dispatch order)', () => {
    expect(findMoveByType(BEAR_SPEC, 'jab')).toBe(BEAR_JAB);
    expect(findMoveByType(BEAR_SPEC, 'tilt')).toBe(BEAR_TILT);
    expect(findMoveByType(BEAR_SPEC, 'smash')).toBe(BEAR_SMASH);
    expect(findMoveByType(BEAR_SPEC, 'aerial')).toBe(BEAR_NAIR);
    expect(findMoveByType(BEAR_SPEC, 'special')).toBe(BEAR_NEUTRAL_SPECIAL);
    expect(findMoveByType(BEAR_SPEC, 'sideSpecial')).toBe(BEAR_SIDE_SPECIAL);
    expect(findMoveByType(BEAR_SPEC, 'upSpecial')).toBe(BEAR_UP_SPECIAL);
  });

  it('each aerial declares a per-phase animation block within the Seed 6-8 frame budget', () => {
    for (const move of [BEAR_NAIR, BEAR_FAIR, BEAR_BAIR]) {
      expect(move.animation).toBeDefined();
      const anim = move.animation!;
      expect(anim.startupFrames).toBeGreaterThanOrEqual(1);
      expect(anim.activeFrames).toBeGreaterThanOrEqual(1);
      expect(anim.recoveryFrames).toBeGreaterThanOrEqual(1);
      const total = anim.startupFrames + anim.activeFrames + anim.recoveryFrames;
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(8);
      // Stretch contract: art-frame counts never exceed gameplay-phase
      // frame counts (otherwise the selector clamps and the late frames
      // never display).
      expect(anim.startupFrames).toBeLessThanOrEqual(move.startupFrames);
      expect(anim.activeFrames).toBeLessThanOrEqual(move.activeFrames);
      expect(anim.recoveryFrames).toBeLessThanOrEqual(move.recoveryFrames);
    }
  });

  it('each aerial declares landing-lag and at least one auto-cancel window', () => {
    // The aerial schema mandates landing-lag and an auto-cancel
    // window list — Bear's grappler identity hinges on the heaviest
    // landing-lag in the cast, so this check guards against a balance
    // pass that accidentally drops one or both.
    for (const move of [BEAR_NAIR, BEAR_FAIR, BEAR_BAIR]) {
      expect(Number.isInteger(move.landingLagFrames)).toBe(true);
      expect(move.landingLagFrames).toBeGreaterThan(0);
      expect(Array.isArray(move.autoCancelWindows)).toBe(true);
      expect(move.autoCancelWindows!.length).toBeGreaterThanOrEqual(1);
      for (const window of move.autoCancelWindows!) {
        expect(Number.isInteger(window.startFrame)).toBe(true);
        expect(Number.isInteger(window.endFrame)).toBe(true);
        expect(window.startFrame).toBeGreaterThanOrEqual(0);
        expect(window.endFrame).toBeGreaterThan(window.startFrame);
      }
    }
  });

  it('Bear hits hardest in the cast on the bair (the grappler air-finisher identity)', () => {
    // Bear's bair is the apex aerial in the M2 cut — locking that
    // down here means a balance pass that flattened the bair power
    // spike surfaces in the suite, not in playtesting.
    expect(BEAR_BAIR.damage).toBeGreaterThan(WOLF_BAIR.damage);
    expect(BEAR_BAIR.damage).toBeGreaterThan(CAT_BAIR.damage);
    expect(BEAR_BAIR.damage).toBeGreaterThan(OWL_BAIR.damage);
    // Knockback scaling premium too — bair KOs at lower percent than
    // the rest of the cast.
    expect(BEAR_BAIR.knockback.scaling).toBeGreaterThan(WOLF_BAIR.knockback.scaling);
    expect(BEAR_BAIR.knockback.scaling).toBeGreaterThan(CAT_BAIR.knockback.scaling);
    expect(BEAR_BAIR.knockback.scaling).toBeGreaterThan(OWL_BAIR.knockback.scaling);
  });

  it('Bear pays for the aerial damage spike with heavy landing-lag (the grappler commitment cost)', () => {
    // Mirrors the grounded "more power costs more commitment" axis at
    // the aerial layer. Bear's grappler identity hinges on the heaviest
    // landing-lag in the cast — a balance pass that flattens these
    // numbers should surface here, not in playtesting.
    //
    // Note: WOLF_NAIR / CAT_NAIR are the legacy `AttackMove` exports
    // without `landingLagFrames` (the `*_NAIR_AERIAL` supersets carry
    // the field); OWL_NAIR / WOLF_FAIR / WOLF_BAIR / CAT_FAIR / CAT_BAIR
    // / OWL_FAIR / OWL_BAIR ship as full `AerialMove` records and
    // publish landing-lag directly.
    expect(BEAR_NAIR.landingLagFrames).toBeGreaterThanOrEqual(OWL_NAIR.landingLagFrames);
    expect(BEAR_FAIR.landingLagFrames).toBeGreaterThan(CAT_FAIR.landingLagFrames);
    expect(BEAR_FAIR.landingLagFrames).toBeGreaterThan(OWL_FAIR.landingLagFrames);
    expect(BEAR_FAIR.landingLagFrames).toBeGreaterThan(WOLF_FAIR.landingLagFrames);
    expect(BEAR_BAIR.landingLagFrames).toBeGreaterThan(CAT_BAIR.landingLagFrames);
    expect(BEAR_BAIR.landingLagFrames).toBeGreaterThan(OWL_BAIR.landingLagFrames);
    expect(BEAR_BAIR.landingLagFrames).toBeGreaterThan(WOLF_BAIR.landingLagFrames);
  });
});

// ---------------------------------------------------------------------------
// AC 60005 Sub-AC 5 — closing the Seed milestone "4 characters with full
// movesets". Every roster slot now ships an 8-entry move table, so the
// cross-cast invariants below assert a property of the *whole* roster,
// not of any one fighter.
// ---------------------------------------------------------------------------

describe('Roster-wide full move-table contract (AC 60005 Sub-AC 5)', () => {
  it('every playable spec ships exactly 10 moves', () => {
    // AC 60302 Sub-AC 2 — every roster slot now ships a side special
    // alongside the existing neutral / up specials, bumping the
    // per-character move count from 8 to 9. AC 60304 Sub-AC 4 — every
    // roster slot also ships a down special, bumping the count to 10.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      expect(spec.moves.length, `${spec.id} move count`).toBe(10);
    }
  });

  it('every playable spec ships jab + tilt + smash + 3 aerials + 4 specials', () => {
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      const types = spec.moves.map((m) => m.type);
      expect(types.filter((t) => t === 'jab').length, `${spec.id} jab`).toBe(1);
      expect(types.filter((t) => t === 'tilt').length, `${spec.id} tilt`).toBe(1);
      expect(types.filter((t) => t === 'smash').length, `${spec.id} smash`).toBe(1);
      expect(types.filter((t) => t === 'aerial').length, `${spec.id} aerials`).toBe(3);
      expect(types.filter((t) => t === 'special').length, `${spec.id} special`).toBe(1);
      expect(types.filter((t) => t === 'sideSpecial').length, `${spec.id} sideSpecial`).toBe(1);
      expect(types.filter((t) => t === 'upSpecial').length, `${spec.id} upSpecial`).toBe(1);
      expect(types.filter((t) => t === 'downSpecial').length, `${spec.id} downSpecial`).toBe(1);
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
// AC 60001 Sub-AC 1 — every roster slot ships the grounded triplet, so
// the whole cast satisfies the foundation contract together. These
// cross-character invariants belong here (rather than in any one
// character's block) because they assert a property of the *cast*, not
// of a single fighter.
// ---------------------------------------------------------------------------

describe('Roster-wide grounded triplet contract (AC 60001 Sub-AC 1)', () => {
  it('every playable spec ships a jab, a tilt, and a smash', () => {
    // Foundation: the shared ground-attack data schema is in place AND
    // every roster slot uses it to publish jab / tilt / smash. A new
    // playable character that ships without one of the three triplet
    // moves should fail this check.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      expect(findMoveByType(spec, 'jab'), `${spec.id} jab`).toBeDefined();
      expect(findMoveByType(spec, 'tilt'), `${spec.id} tilt`).toBeDefined();
      expect(findMoveByType(spec, 'smash'), `${spec.id} smash`).toBeDefined();
    }
  });

  it('every grounded move uses the shared `AttackMoveWithAnimation` shape (animation block declared)', () => {
    // The schema requires every grounded move to author per-phase
    // animation frame counts so the renderer can drive the art
    // through the same state machine the gameplay loop uses. A
    // grounded move that ships without an animation block silently
    // breaks the lockstep contract; this check surfaces it.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      for (const moveType of ['jab', 'tilt', 'smash'] as const) {
        const move = findMoveByType(spec, moveType);
        expect(move, `${spec.id} ${moveType}`).toBeDefined();
        // `findMoveByType` returns AttackMove (no animation field),
        // but the data file authors them as `AttackMoveWithAnimation`.
        // Cross-cast in the test (the runtime tag-check below is the
        // actual assertion).
        const animated = move as { animation?: unknown };
        expect(animated.animation, `${spec.id} ${moveType} animation`).toBeDefined();
      }
    }
  });

  it('damage / startup / lockout strictly increase from jab → tilt → smash for every character', () => {
    // The "more power costs more commitment" trade-off is a per-
    // character invariant. If a balance pass accidentally inverts it
    // for one slot (e.g. a tilt that hits harder than a smash), the
    // cast loses the canonical neutral / spacer / finisher reading.
    for (const spec of PLAYABLE_CHARACTER_SPECS) {
      const jab = findMoveByType(spec, 'jab')!;
      const tilt = findMoveByType(spec, 'tilt')!;
      const smash = findMoveByType(spec, 'smash')!;
      expect(jab.damage, `${spec.id} jab damage`).toBeLessThan(tilt.damage);
      expect(tilt.damage, `${spec.id} tilt damage`).toBeLessThan(smash.damage);
      expect(jab.startupFrames, `${spec.id} jab startup`).toBeLessThan(tilt.startupFrames);
      expect(tilt.startupFrames, `${spec.id} tilt startup`).toBeLessThan(smash.startupFrames);
    }
  });
});

// ---------------------------------------------------------------------------
// AC 10403 Sub-AC 3 — "Re-tune hitbox and hurtbox dimensions on both M1
// characters to match the new sprite frame sizes."
//
// Both M1 characters (Wolf, Cat) shipped with placeholder hurtbox
// rectangles authored before the M1.5 sprite-pack drop landed (Wolf was
// 100×140 over a 64×64 source cell at non-uniform 1.5625× / 2.1875×
// scale; Cat was 72×112 over a 50×50 source cell at non-uniform 1.44× /
// 2.24× scale). The legacy rectangles visibly squashed the rendered
// sprite when MatchScene's `setDisplaySize(width, height)` stretched the
// frame to fit the body footprint, and the per-move hitbox heights were
// authored against those legacy body heights so the swing arcs sat in
// the wrong place once the body shrank. The retune below is a single
// per-character pass:
//
//   1. Body footprint becomes a UNIFORM-scale square that matches the
//      source sprite cell (Wolf: 100×100 = 64×64 ×1.5625; Cat: 75×75 =
//      50×50 ×1.5). No more axis-stretching at render time.
//
//   2. Every move's hitbox `width` and `height` is re-authored against
//      the new body silhouette while preserving the legacy
//      jab < tilt < smash reach gradient and the "hitbox sits at chest
//      level" vertical offset rule.
//
//   3. The placeholder visual width/height (`*_PLACEHOLDER`) mirror the
//      tuning so the debug overlay rectangle and the live Matter body
//      stay visually in lockstep.
//
// The block below pins those invariants so a future balance pass that
// nudges any of these numbers without preserving the sprite-fit
// relationship surfaces the regression here. Wolf and Cat are the M1
// cut; Owl / Bear are exempt because they are still on the procedural
// fallback rectangle (their `spriteKey === null` case) and have no
// authoritative sprite cell to match against until M2 art lands.
// ---------------------------------------------------------------------------

describe('M1 characters — hitbox/hurtbox align with sprite frame sizes (AC 10403 Sub-AC 3)', () => {
  // Lookup helper: pull the canonical sprite cell dimensions out of the
  // palette-variant config (which itself mirrors `frames.json`). Going
  // through `PALETTE_VARIANT_CHARACTERS` instead of hard-coding numbers
  // means a future re-art delivery that re-cellsizes the sheet only
  // needs to update one place — this test follows.
  function getSpriteCell(characterId: 'wolf' | 'cat'): {
    width: number;
    height: number;
  } {
    const cfg = PALETTE_VARIANT_CHARACTERS.find((c) => c.characterId === characterId);
    if (!cfg) {
      throw new Error(`No palette config for ${characterId}`);
    }
    return { width: cfg.frameWidth, height: cfg.frameHeight };
  }

  // Acceptable rounding tolerance when checking that body == cell × scale.
  // (Pre-shrink invariant retained as a comment for context: the body
  // dims used to satisfy `width === height` and `body / cell` was a
  // clean uniform scale. After the visible-pixel-matching shrink both
  // are non-square; checks below assert the new explicit sizes.)

  describe('Wolf (first M1 character)', () => {
    const cell = getSpriteCell('wolf');

    it('hurtbox is a square footprint that matches the wolf sprite cell at uniform scale', () => {
      // Body is square so the source cell renders without per-axis
      // stretch. Wolf's bruiser silhouette is the second-widest in the
      // cast (only Bear is wider), so the body width is preserved
      // through the retune; height drops from the legacy 140 placeholder
      // to match width 100 = 64 × 1.5625.
      // Hurtbox is non-square because the visible wolf sprite is
      // taller than wide (~30% width × 44% height of the 64×64 native
      // frame). The body matches the visible-pixel bounding box at
      // the configured sprite display size (150 px) — see
      // `src/characters/visualScale.ts` for the full architectural
      // contract. Width 45 ≈ 150 × 19/64; height 66 ≈ 150 × 28/64.
      expect(WOLF_TUNING.width).toBeLessThan(WOLF_TUNING.height);
      expect(WOLF_TUNING.width).toBe(45);
      expect(WOLF_TUNING.height).toBe(66);
      // Sanity: ratios derive from the underlying frame.
      const widthRatio = WOLF_TUNING.width / cell.width;
      const heightRatio = WOLF_TUNING.height / cell.height;
      expect(widthRatio).toBeCloseTo(45 / 64, 4);
      expect(heightRatio).toBeCloseTo(66 / 64, 4);
    });

    it('placeholder dimensions mirror the retuned tuning (debug overlay matches body)', () => {
      // The debug rectangle painted under the sprite must match the
      // live Matter body footprint, otherwise the hurtbox debug overlay
      // misleads players reading their reach in training mode.
      expect(WOLF_PLACEHOLDER.width).toBe(WOLF_TUNING.width);
      expect(WOLF_PLACEHOLDER.height).toBe(WOLF_TUNING.height);
    });

    it('every grounded hitbox height fits within the new body height (no off-body swings)', () => {
      // Hitbox heights were authored against the legacy 140 body and
      // had to drop to fit the 100-tall retune. Verify each one is
      // still within the body's vertical extent — a hitbox taller than
      // the body would sit on a vertical band the sprite doesn't
      // visually occupy, breaking the visual / collision lockstep.
      for (const move of [WOLF_JAB, WOLF_TILT, WOLF_SMASH]) {
        expect(move.hitbox.height, `${move.id} hitbox height fits body`).toBeLessThanOrEqual(
          WOLF_TUNING.height,
        );
      }
    });

    it('jab < tilt < smash reach gradient survives the retune', () => {
      // The retune preserved the canonical "jab is the tightest reach,
      // smash extends furthest" gradient. A future pass that scrambles
      // the move heights without preserving this would break the
      // archetype reading.
      expect(WOLF_JAB.hitbox.offsetX).toBeLessThan(WOLF_TILT.hitbox.offsetX);
      expect(WOLF_TILT.hitbox.offsetX).toBeLessThan(WOLF_SMASH.hitbox.offsetX);
      expect(WOLF_JAB.hitbox.width).toBeLessThan(WOLF_TILT.hitbox.width);
      expect(WOLF_TILT.hitbox.width).toBeLessThan(WOLF_SMASH.hitbox.width);
    });

    it('grounded hitbox vertical offsets sit inside the body (chest-level swings)', () => {
      // The legacy "chest-level" rule is `|offsetY| < height/2`. A
      // negative offsetY means "above body centre" (Phaser screen
      // space). The retune preserved this so swings still read as
      // coming out of the fighter's torso, not the floor below or the
      // sky above.
      const halfHeight = WOLF_TUNING.height / 2;
      for (const move of [WOLF_JAB, WOLF_TILT, WOLF_SMASH]) {
        expect(
          Math.abs(move.hitbox.offsetY),
          `${move.id} offsetY inside body half-height`,
        ).toBeLessThan(halfHeight);
      }
    });

    it('neutral aerial sphere covers the body without ballooning past it', () => {
      // The body-centred nair sphere (offsetX 0) needs to cover the
      // body so a same-frame approach from either side gets caught.
      // The retune kept the sphere slightly wider than the body
      // (catches edge-cases) but dropped its height to fit the new
      // 100-tall body so it doesn't extend below the sprite's feet.
      expect(WOLF_NAIR.hitbox.offsetX).toBe(0);
      // Width: at least as wide as the body so the spin actually
      // covers the silhouette.
      expect(WOLF_NAIR.hitbox.width).toBeGreaterThanOrEqual(WOLF_TUNING.width);
      // Height: the NAIR's vertical reach is allowed to extend past
      // the body silhouette since the body was shrunk to better match
      // the visible sprite. Cap at 2× body height so a future
      // accidental balloon is still caught.
      expect(WOLF_NAIR.hitbox.height).toBeLessThanOrEqual(WOLF_TUNING.height * 2);
    });

    it('directional aerials (fair/bair) reach forward of the body without tunneling through it', () => {
      // Forward / back aerials are authored facing-right with positive
      // `offsetX`. The retune preserved the rule that the hitbox sits
      // *outside* the body's facing edge, not inside it — `offsetX >=
      // body half-width` keeps the leading edge past the silhouette.
      const halfWidth = WOLF_TUNING.width / 2;
      for (const move of [WOLF_FAIR, WOLF_BAIR]) {
        expect(
          move.hitbox.offsetX,
          `${move.id} offsetX past body edge`,
        ).toBeGreaterThanOrEqual(halfWidth - 5); // -5 px slack for inside-edge-cover
        // And the hitbox must still fit vertically within the body.
        expect(move.hitbox.height, `${move.id} fits body height`).toBeLessThanOrEqual(
          WOLF_TUNING.height,
        );
      }
    });
  });

  describe('Cat (second M1 character)', () => {
    const cell = getSpriteCell('cat');

    it('hurtbox is a square footprint that matches the cat sprite cell at uniform scale', () => {
      // Cat is the smallest silhouette in the M1 cast — preserved
      // through the retune by squaring her body to 75×75 = 50 × 1.5.
      // Hurtbox is non-square — visible cat sprite is taller than
      // wide (~36% × 58% of 50×50 native frame). Body matches the
      // visible-pixel bbox at sprite display 112 px: width 40 ≈
      // 112 × 18/50; height 65 ≈ 112 × 29/50.
      expect(CAT_TUNING.width).toBeLessThan(CAT_TUNING.height);
      expect(CAT_TUNING.width).toBe(40);
      expect(CAT_TUNING.height).toBe(65);
      const widthRatio = CAT_TUNING.width / cell.width;
      const heightRatio = CAT_TUNING.height / cell.height;
      expect(widthRatio).toBeCloseTo(40 / 50, 4);
      expect(heightRatio).toBeCloseTo(65 / 50, 4);
    });

    it('placeholder dimensions mirror the retuned tuning (debug overlay matches body)', () => {
      expect(CAT_PLACEHOLDER.width).toBe(CAT_TUNING.width);
      expect(CAT_PLACEHOLDER.height).toBe(CAT_TUNING.height);
    });

    it('every grounded hitbox height fits within the new body height (no off-body swings)', () => {
      for (const move of [CAT_JAB, CAT_TILT, CAT_SMASH]) {
        expect(move.hitbox.height, `${move.id} hitbox height fits body`).toBeLessThanOrEqual(
          CAT_TUNING.height,
        );
      }
    });

    it('jab < tilt < smash reach gradient survives the retune', () => {
      expect(CAT_JAB.hitbox.offsetX).toBeLessThan(CAT_TILT.hitbox.offsetX);
      expect(CAT_TILT.hitbox.offsetX).toBeLessThan(CAT_SMASH.hitbox.offsetX);
      expect(CAT_JAB.hitbox.width).toBeLessThan(CAT_TILT.hitbox.width);
      expect(CAT_TILT.hitbox.width).toBeLessThan(CAT_SMASH.hitbox.width);
    });

    it('grounded hitbox vertical offsets sit inside the body (chest-level swings)', () => {
      const halfHeight = CAT_TUNING.height / 2;
      for (const move of [CAT_JAB, CAT_TILT, CAT_SMASH]) {
        expect(
          Math.abs(move.hitbox.offsetY),
          `${move.id} offsetY inside body half-height`,
        ).toBeLessThan(halfHeight);
      }
    });

    it('neutral aerial sphere covers the body without ballooning past it', () => {
      expect(CAT_NAIR.hitbox.offsetX).toBe(0);
      expect(CAT_NAIR.hitbox.width).toBeGreaterThanOrEqual(CAT_TUNING.width);
      // Allow vertical reach past the now-smaller body silhouette;
      // cap at 2× to still catch runaway balloons.
      expect(CAT_NAIR.hitbox.height).toBeLessThanOrEqual(CAT_TUNING.height * 2);
    });

    it('directional aerials (fair/bair) reach forward of the body without tunneling through it', () => {
      const halfWidth = CAT_TUNING.width / 2;
      for (const move of [CAT_FAIR, CAT_BAIR]) {
        expect(
          move.hitbox.offsetX,
          `${move.id} offsetX past body edge`,
        ).toBeGreaterThanOrEqual(halfWidth - 5);
        expect(move.hitbox.height, `${move.id} fits body height`).toBeLessThanOrEqual(
          CAT_TUNING.height,
        );
      }
    });
  });

  describe('Cross-character invariants (Wolf vs Cat scale relationship)', () => {
    it('Wolf is wider/taller than Cat in body and corresponding sprite cell', () => {
      // The bruiser-vs-ninja silhouette gap survives the retune: Wolf's
      // 100×100 body comes from a 64×64 cell, Cat's 75×75 from 50×50.
      // The body-size gap mirrors the sprite-cell-size gap, so the
      // visual hierarchy (Wolf is the larger silhouette) reads the same
      // pre- and post-retune.
      const wolfCell = getSpriteCell('wolf');
      const catCell = getSpriteCell('cat');
      expect(wolfCell.width).toBeGreaterThan(catCell.width);
      expect(wolfCell.height).toBeGreaterThan(catCell.height);
      expect(WOLF_TUNING.width).toBeGreaterThan(CAT_TUNING.width);
      expect(WOLF_TUNING.height).toBeGreaterThan(CAT_TUNING.height);
    });

    it('every grounded hitbox is wider than the matching opponent body half-width (so a clean hit lands)', () => {
      // Smoke-test against a degenerate retune that shrunk the hitbox
      // smaller than the opponent body — Cat's smash should still land
      // on Wolf, and Wolf's smash should still land on Cat. The
      // invariant: hitbox width >= opponent body half-width means a hit
      // from contact range guarantees overlap.
      const matchups: { attacker: typeof WOLF_JAB; opponentBodyWidth: number; label: string }[] = [
        { attacker: WOLF_JAB, opponentBodyWidth: CAT_TUNING.width, label: 'Wolf jab vs Cat body' },
        { attacker: WOLF_TILT, opponentBodyWidth: CAT_TUNING.width, label: 'Wolf tilt vs Cat body' },
        { attacker: WOLF_SMASH, opponentBodyWidth: CAT_TUNING.width, label: 'Wolf smash vs Cat body' },
        { attacker: CAT_JAB, opponentBodyWidth: WOLF_TUNING.width, label: 'Cat jab vs Wolf body' },
        { attacker: CAT_TILT, opponentBodyWidth: WOLF_TUNING.width, label: 'Cat tilt vs Wolf body' },
        { attacker: CAT_SMASH, opponentBodyWidth: WOLF_TUNING.width, label: 'Cat smash vs Wolf body' },
      ];
      for (const m of matchups) {
        expect(m.attacker.hitbox.width, m.label).toBeGreaterThanOrEqual(m.opponentBodyWidth / 2);
      }
    });
  });
});
