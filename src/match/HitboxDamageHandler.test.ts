import { describe, it, expect } from 'vitest';
import {
  HitboxDamageHandler,
  type HitboxCollisionEvent,
  type HitboxOrCharacterBody,
  type HitContext,
} from './HitboxDamageHandler';
import { HITBOX_LABEL } from '../characters/attacks';
import { CHARACTER_LABEL } from '../characters/Character';
import type { HitInfo } from '../characters/combat';
import type { HitboxPlugin } from '../characters/attacks';
import type { Hurtbox } from '../characters/moveSchema';
import { PLATFORM_LABELS } from '../stages/StageRenderer';

/**
 * Sub-AC 2 of AC 60002: damage tracking that applies incoming damage
 * and updates the fighter's percentage state.
 *
 * `Character.applyHit` already implements the pure mutation
 * ("accumulate damage, override velocity, lock hitstun"). What was
 * missing — and what this handler supplies — is the connector
 * between the world's `collisionstart` stream and the right
 * `applyHit` call.
 *
 * These tests lock down:
 *
 *   1. Detection — fires the callback for `(hitbox, character)`
 *      pairs in either pair-order; ignores everything else
 *      (platforms, hitbox-vs-blast-zone, character-vs-character).
 *   2. Self-hit suppression — a hitbox owned by character X never
 *      damages a registered body whose `plugin.characterId === X`.
 *   3. HitInfo construction — the dispatched `HitInfo` is built
 *      from the hitbox plugin payload exactly (damage / knockback /
 *      facing).
 *   4. Per-event de-duplication — even if Matter delivers the same
 *      `(hitbox, character)` overlap twice in one event, the
 *      callback fires once.
 *   5. Multi-target — one hitbox hitting two characters in the same
 *      event fires twice (one per character).
 *   6. Lifecycle — `unregisterPlayer` stops emissions for that slot;
 *      `reset` clears the whole registry.
 *   7. Defensive — null bodies, empty events, malformed plugins are
 *      silently ignored.
 */

// ---------------------------------------------------------------------------
// Helpers — minimal Matter-pair fixtures, no Phaser, no real bodies.
// ---------------------------------------------------------------------------

function makeCharacterBody(characterId: string, id?: number): HitboxOrCharacterBody {
  return {
    label: CHARACTER_LABEL,
    plugin: { characterId },
    ...(id !== undefined ? { id } : {}),
  } as HitboxOrCharacterBody;
}

function makeHitboxBody(
  ownerId: string,
  options: Partial<HitboxPlugin> = {},
  id?: number,
): HitboxOrCharacterBody {
  const plugin: HitboxPlugin = {
    ownerId,
    moveId: options.moveId ?? 'test.jab',
    damage: options.damage ?? 8,
    knockback: options.knockback ?? { x: 1.5, y: -0.5, scaling: 0.05 },
    facing: options.facing ?? 1,
  };
  return {
    label: HITBOX_LABEL,
    plugin,
    ...(id !== undefined ? { id } : {}),
  } as HitboxOrCharacterBody;
}

function makePlatform(passThrough = false): HitboxOrCharacterBody {
  return {
    label: passThrough ? PLATFORM_LABELS.passThrough : PLATFORM_LABELS.solid,
  };
}

function makeEvent(
  ...pairs: Array<{
    bodyA: HitboxOrCharacterBody | null;
    bodyB: HitboxOrCharacterBody | null;
  }>
): HitboxCollisionEvent {
  return { pairs };
}

interface CallbackLog {
  targetIndex: number;
  hit: HitInfo;
  context: HitContext;
}

function makeLogger(): {
  log: CallbackLog[];
  cb: (i: number, h: HitInfo, c: HitContext) => void;
} {
  const log: CallbackLog[] = [];
  return {
    log,
    cb: (i, h, c) => log.push({ targetIndex: i, hit: h, context: c }),
  };
}

// ---------------------------------------------------------------------------
// Construction & registration
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — registration', () => {
  it('rejects a negative or non-integer playerIndex', () => {
    const h = new HitboxDamageHandler(() => {});
    expect(() => h.registerPlayer(-1, makeCharacterBody('wolf'))).toThrow();
    expect(() => h.registerPlayer(1.5, makeCharacterBody('cat'))).toThrow();
  });

  it('isRegistered reflects the registry state', () => {
    const h = new HitboxDamageHandler(() => {});
    expect(h.isRegistered(0)).toBe(false);
    h.registerPlayer(0, makeCharacterBody('wolf'));
    expect(h.isRegistered(0)).toBe(true);
  });

  it('re-registering the same playerIndex replaces the body', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const oldBody = makeCharacterBody('wolf');
    const newBody = makeCharacterBody('wolf');
    h.registerPlayer(0, oldBody);
    h.registerPlayer(0, newBody);
    // Old body no longer fires.
    h.handleCollisionStart(
      makeEvent({ bodyA: oldBody, bodyB: makeHitboxBody('cat') }),
    );
    expect(log.length).toBe(0);
    // New body does.
    h.handleCollisionStart(
      makeEvent({ bodyA: newBody, bodyB: makeHitboxBody('cat') }),
    );
    expect(log.length).toBe(1);
  });

  it('unregisterPlayer stops further emissions for that slot', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const body = makeCharacterBody('wolf');
    h.registerPlayer(0, body);
    h.unregisterPlayer(0);
    h.handleCollisionStart(
      makeEvent({ bodyA: body, bodyB: makeHitboxBody('cat') }),
    );
    expect(log).toEqual([]);
    expect(h.isRegistered(0)).toBe(false);
  });

  it('unregistering a non-existent slot is a silent no-op', () => {
    const h = new HitboxDamageHandler(() => {});
    expect(() => h.unregisterPlayer(0)).not.toThrow();
    expect(() => h.unregisterPlayer(99)).not.toThrow();
  });

  it('reset clears the entire registry', () => {
    const h = new HitboxDamageHandler(() => {});
    h.registerPlayer(0, makeCharacterBody('wolf'));
    h.registerPlayer(1, makeCharacterBody('cat'));
    h.reset();
    expect(h.isRegistered(0)).toBe(false);
    expect(h.isRegistered(1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — detection', () => {
  it('fires for hitbox→character pair order (A,B)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    const hitbox = makeHitboxBody('cat', { damage: 12, moveId: 'cat.smash' });
    h.handleCollisionStart(makeEvent({ bodyA: hitbox, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.targetIndex).toBe(0);
    expect(log[0]!.hit.damage).toBe(12);
    expect(log[0]!.context.attackerOwnerId).toBe('cat');
    expect(log[0]!.context.moveId).toBe('cat.smash');
  });

  it('fires for character→hitbox in reverse pair order (B,A)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const cat = makeCharacterBody('cat');
    h.registerPlayer(1, cat);
    const hitbox = makeHitboxBody('wolf');
    h.handleCollisionStart(makeEvent({ bodyA: cat, bodyB: hitbox }));
    expect(log.length).toBe(1);
    expect(log[0]!.targetIndex).toBe(1);
  });

  it('multiplexes correctly across multiple registered players', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    const cat = makeCharacterBody('cat', 2);
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    // Two different hitboxes hitting two different targets in one event.
    const hb1 = makeHitboxBody('cat', { damage: 5 }, 100);
    const hb2 = makeHitboxBody('wolf', { damage: 7 }, 101);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: hb1, bodyB: wolf },
        { bodyA: hb2, bodyB: cat },
      ),
    );
    expect(log.length).toBe(2);
    const wolfHit = log.find((e) => e.targetIndex === 0)!;
    const catHit = log.find((e) => e.targetIndex === 1)!;
    expect(wolfHit.hit.damage).toBe(5);
    expect(catHit.hit.damage).toBe(7);
  });

  it('one hitbox can hit multiple characters in the same event (AoE)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    const cat = makeCharacterBody('cat');
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    // Single hitbox owned by 'owl' hits both in one event.
    const owlSwing = makeHitboxBody('owl', { damage: 9 }, 200);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: owlSwing, bodyB: wolf },
        { bodyA: owlSwing, bodyB: cat },
      ),
    );
    expect(log.length).toBe(2);
    expect(log.map((e) => e.targetIndex).sort()).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// HitInfo construction — verifies the plugin payload flows verbatim
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — HitInfo construction', () => {
  it('builds HitInfo with damage / knockback / facing from the plugin', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const target = makeCharacterBody('wolf');
    h.registerPlayer(0, target);
    const knockback = { x: 4.2, y: -1.7, scaling: 0.18 };
    const hitbox = makeHitboxBody('cat', {
      damage: 14,
      knockback,
      facing: -1,
      moveId: 'cat.smash.up',
    });
    h.handleCollisionStart(makeEvent({ bodyA: hitbox, bodyB: target }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(14);
    expect(log[0]!.hit.knockback).toEqual(knockback);
    expect(log[0]!.hit.facing).toBe(-1);
    expect(log[0]!.context.moveId).toBe('cat.smash.up');
    expect(log[0]!.context.attackerOwnerId).toBe('cat');
  });

  it('passes through fractional damage values without rounding', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const target = makeCharacterBody('wolf');
    h.registerPlayer(0, target);
    const hitbox = makeHitboxBody('cat', { damage: 3.75 });
    h.handleCollisionStart(makeEvent({ bodyA: hitbox, bodyB: target }));
    expect(log[0]!.hit.damage).toBeCloseTo(3.75);
  });
});

// ---------------------------------------------------------------------------
// Self-hit suppression
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — self-hit suppression', () => {
  it('suppresses a hit where attacker ownerId === target characterId', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    // Wolf's own hitbox should not damage Wolf (impossible in real
    // gameplay because the body is set isSensor + collision masks
    // exclude self, but this is a defence-in-depth test).
    const wolfSwing = makeHitboxBody('wolf');
    h.handleCollisionStart(makeEvent({ bodyA: wolfSwing, bodyB: wolf }));
    expect(log).toEqual([]);
  });

  it('still fires when ownerId differs from target characterId', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    const catSwing = makeHitboxBody('cat');
    h.handleCollisionStart(makeEvent({ bodyA: catSwing, bodyB: wolf }));
    expect(log.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Friendly-fire predicate (post-M6.7 — creature subsystem)
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — friendly-fire predicate', () => {
  it('default: no predicate set, every cross-character hit fires', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    h.handleCollisionStart(
      makeEvent({ bodyA: makeHitboxBody('cat'), bodyB: wolf }),
    );
    expect(log.length).toBe(1);
  });

  it('predicate returning false drops the hit silently', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    h.setFriendlyFirePredicate(() => false);
    h.handleCollisionStart(
      makeEvent({ bodyA: makeHitboxBody('cat'), bodyB: wolf }),
    );
    expect(log).toEqual([]);
  });

  it('predicate returning true fires the hit normally', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    h.setFriendlyFirePredicate(() => true);
    h.handleCollisionStart(
      makeEvent({ bodyA: makeHitboxBody('cat'), bodyB: wolf }),
    );
    expect(log.length).toBe(1);
  });

  it('predicate receives the attacker ownerId + targetIndex', () => {
    const calls: Array<{ ownerId: string; targetIndex: number }> = [];
    const { cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    const cat = makeCharacterBody('cat');
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    h.setFriendlyFirePredicate((ownerId, targetIndex) => {
      calls.push({ ownerId, targetIndex });
      return true;
    });
    h.handleCollisionStart(
      makeEvent({ bodyA: makeHitboxBody('cat'), bodyB: wolf }),
    );
    expect(calls).toEqual([{ ownerId: 'cat', targetIndex: 0 }]);
  });

  it('a dropped hit can re-fire later (no confirmation registry update)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    let allow = false;
    h.setFriendlyFirePredicate(() => allow);
    // Same hitbox body re-used so the confirmation registry is the
    // same key — the per-lifetime dedup would normally suppress a
    // repeat hit on the same target.
    const swing = makeHitboxBody('cat');
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log).toEqual([]); // dropped by predicate
    allow = true;
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1); // now fires — predicate was the only block
  });

  it('clearing the predicate (null) restores default behaviour', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    h.setFriendlyFirePredicate(() => false);
    h.handleCollisionStart(
      makeEvent({ bodyA: makeHitboxBody('cat'), bodyB: wolf }),
    );
    expect(log).toEqual([]);
    h.setFriendlyFirePredicate(null);
    h.handleCollisionStart(
      makeEvent({ bodyA: makeHitboxBody('cat'), bodyB: wolf }),
    );
    expect(log.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filtering — non-hit collisions must be silently ignored
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — filtering', () => {
  it('ignores character-vs-platform collisions', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: wolf, bodyB: makePlatform() },
        { bodyA: wolf, bodyB: makePlatform(true) },
      ),
    );
    expect(log).toEqual([]);
  });

  it('ignores character-vs-character collisions (no hitbox involved)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    const cat = makeCharacterBody('cat');
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    h.handleCollisionStart(makeEvent({ bodyA: wolf, bodyB: cat }));
    expect(log).toEqual([]);
  });

  it('ignores hitbox-vs-platform collisions', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat');
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: makePlatform() }));
    expect(log).toEqual([]);
  });

  it('ignores hitbox-vs-blast-zone collisions', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const swing = makeHitboxBody('wolf');
    const blastZone: HitboxOrCharacterBody = { label: 'blastZone.left' };
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: blastZone }));
    expect(log).toEqual([]);
  });

  it('ignores hitbox-vs-unregistered-character collisions', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    // No characters registered.
    const stranger = makeCharacterBody('owl');
    const swing = makeHitboxBody('cat');
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: stranger }));
    expect(log).toEqual([]);
  });

  it('ignores empty events and missing bodies', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    h.handleCollisionStart({ pairs: [] });
    h.handleCollisionStart(makeEvent({ bodyA: null, bodyB: null }));
    h.handleCollisionStart(
      makeEvent({ bodyA: null, bodyB: makeHitboxBody('cat') }),
    );
    expect(log).toEqual([]);
  });

  it('ignores hitbox-vs-hitbox pairs (both labelled hitbox)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    h.handleCollisionStart(
      makeEvent({
        bodyA: makeHitboxBody('wolf'),
        bodyB: makeHitboxBody('cat'),
      }),
    );
    expect(log).toEqual([]);
  });

  it('ignores hitbox bodies whose plugin is missing or malformed', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf');
    h.registerPlayer(0, wolf);
    const malformed: HitboxOrCharacterBody = { label: HITBOX_LABEL };
    const malformed2: HitboxOrCharacterBody = {
      label: HITBOX_LABEL,
      plugin: { foo: 'bar' } as Record<string, unknown>,
    };
    h.handleCollisionStart(
      makeEvent(
        { bodyA: malformed, bodyB: wolf },
        { bodyA: malformed2, bodyB: wolf },
      ),
    );
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-event de-duplication
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — de-duplication', () => {
  it('fires at most once per (hitboxBody, target) within one event', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat', { damage: 6 }, 50);
    // Same hitbox-target overlap reported twice in one event (e.g.
    // compound body with two parts touching the same hurtbox).
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swing, bodyB: wolf },
        { bodyA: swing, bodyB: wolf },
      ),
    );
    expect(log.length).toBe(1);
  });

  it('also dedups when the duplicate pair has reversed order', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat', {}, 50);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swing, bodyB: wolf },
        { bodyA: wolf, bodyB: swing },
      ),
    );
    expect(log.length).toBe(1);
  });

  // AC 60103 Sub-AC 3 — within the lifetime of a single hitbox body,
  // the same target can only be hit once. The previous "per-event
  // only" semantics let a re-overlap re-fire damage on the same
  // swing; the canonical Smash rule is "one hit per move per target",
  // so a duplicate event on the same `(hitboxBody, target)` pair must
  // be dropped. The escape hatch for tests / replay-resync that need
  // to simulate a second swing is a fresh hitbox body (next test) or
  // an explicit `forgetHitbox(body)` call (test below).
  it('does NOT re-fire when the same hitbox+target appear in a new event', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat', {}, 50);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
  });

  it('fires again for a *different* hitbox body hitting the same target', () => {
    // A new swing always allocates a fresh hitbox body via
    // `spawnHitbox`, so per-lifetime dedup does not bleed across
    // attacks — successive jabs / smashes on the same target each
    // land their own hit.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing1 = makeHitboxBody('cat', { damage: 4 }, 50);
    const swing2 = makeHitboxBody('cat', { damage: 6 }, 51);
    h.handleCollisionStart(makeEvent({ bodyA: swing1, bodyB: wolf }));
    h.handleCollisionStart(makeEvent({ bodyA: swing2, bodyB: wolf }));
    expect(log.length).toBe(2);
    expect(log.map((e) => e.hit.damage)).toEqual([4, 6]);
  });

  it('different hitboxes hitting the same character in one event both fire', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swingA = makeHitboxBody('cat', { damage: 4 }, 50);
    const swingB = makeHitboxBody('owl', { damage: 9 }, 51);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swingA, bodyB: wolf },
        { bodyA: swingB, bodyB: wolf },
      ),
    );
    expect(log.length).toBe(2);
    expect(log.map((e) => e.hit.damage).sort()).toEqual([4, 9]);
  });

  it('uses object identity (not numeric id) when bodies have no id field', () => {
    // Test fixtures often skip the id field. The handler should still
    // dedup correctly using object reference equality.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf'); // no id
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat'); // no id
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swing, bodyB: wolf },
        { bodyA: swing, bodyB: wolf },
      ),
    );
    expect(log.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC 60103 Sub-AC 3 — hit confirmation + cleanup
//
// Locks down the per-hitbox-lifetime "one hit per move per target per
// swing" rule. The damage / knockback / hitstun math itself lives in
// `combat.ts` and is tested there; this block focuses on the handler's
// confirmation registry and cleanup semantics.
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — hit confirmation (AC 60103 Sub-AC 3)', () => {
  it('a single hitbox body can hit each registered target at most once', () => {
    // AoE swing connects with two targets in event 1 (two hits), then
    // re-overlaps both in event 2 (zero hits) — the per-lifetime
    // confirmation set already records both targets.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    const cat = makeCharacterBody('cat', 2);
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    const swing = makeHitboxBody('owl', { damage: 9 }, 200);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swing, bodyB: wolf },
        { bodyA: swing, bodyB: cat },
      ),
    );
    expect(log.length).toBe(2);
    // Re-overlap: identical pair stream in a new event.
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swing, bodyB: wolf },
        { bodyA: swing, bodyB: cat },
      ),
    );
    expect(log.length).toBe(2);
  });

  it('an AoE hitbox can still connect with a NEW target after a prior confirm', () => {
    // The confirmation set is per (hitboxBody, targetIndex), not per
    // hitbox alone — registering a third fighter mid-swing must allow
    // that fresh target to take a hit even though the swing already
    // confirmed against earlier targets.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat', { damage: 7 }, 300);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    // Bring slot 1 into the registry and overlap the same swing.
    const owl = makeCharacterBody('owl', 2);
    h.registerPlayer(1, owl);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: owl }));
    expect(log.length).toBe(2);
    expect(log[1]!.targetIndex).toBe(1);
    // ...but slot 0 still cannot be re-hit by the same swing.
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(2);
  });

  it('forgetHitbox cleanup lets the same body fire again', () => {
    // The attacker's `tickAttack` (or the test) calls `forgetHitbox`
    // when the hitbox is despawned at active → recovery. The next
    // event reusing the same body reference (canonically rare in
    // production — `spawnHitbox` allocates fresh bodies — but
    // exercised here for the explicit-cleanup contract) starts from
    // an empty confirmation set.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat', { damage: 5 }, 400);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    // Without `forgetHitbox`: a re-overlap is silently dropped.
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    // After `forgetHitbox`: the same body re-fires.
    h.forgetHitbox(swing);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(2);
  });

  it('forgetHitbox is idempotent and tolerates unknown / null bodies', () => {
    const h = new HitboxDamageHandler(() => {});
    expect(() => h.forgetHitbox(null)).not.toThrow();
    expect(() => h.forgetHitbox(undefined)).not.toThrow();
    // A body the handler never observed — silent no-op.
    expect(() =>
      h.forgetHitbox(makeHitboxBody('cat', {}, 999)),
    ).not.toThrow();
    // Calling twice on the same body — silent no-op.
    const s = makeHitboxBody('cat', {}, 1000);
    expect(() => {
      h.forgetHitbox(s);
      h.forgetHitbox(s);
    }).not.toThrow();
  });

  it('reset clears the confirmation registry (next event re-fires)', () => {
    // Replay rewind / scene shutdown drops every player slot and
    // every per-swing confirmation so the next match starts fresh.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    const swing = makeHitboxBody('cat', { damage: 3 }, 500);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    // After reset, even the same body+target fires again — but the
    // registry is also empty, so the caller must re-register the
    // player before the next event lands.
    h.reset();
    h.registerPlayer(0, wolf);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(2);
  });

  it('damage / knockback / facing flow verbatim from the move table on each confirmed hit', () => {
    // The headline of Sub-AC 3: when a hit confirms, the damage,
    // knockback vector, and attacker facing read on the callback
    // are exactly the values the move table stamped into the
    // hitbox plugin (no clamping, no rounding, no mutation).
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const target = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, target);
    const moveTable = {
      damage: 11.25,
      knockback: { x: 3.7, y: -2.4, scaling: 0.22 },
      facing: -1 as const,
      moveId: 'cat.smash.down',
    };
    const swing = makeHitboxBody('cat', moveTable, 600);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: target }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(11.25);
    expect(log[0]!.hit.knockback).toEqual(moveTable.knockback);
    expect(log[0]!.hit.facing).toBe(-1);
    expect(log[0]!.context.moveId).toBe('cat.smash.down');
    expect(log[0]!.context.attackerOwnerId).toBe('cat');
  });
});

// ---------------------------------------------------------------------------
// Re-entrancy
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — re-entrancy', () => {
  it('callback that unregisters another slot mid-dispatch is safe', () => {
    const { log, cb } = makeLogger();
    let handlerRef: HitboxDamageHandler;
    const callback = (i: number, hit: HitInfo, ctx: HitContext) => {
      cb(i, hit, ctx);
      // Hit on slot 0 KOs and unregisters slot 1.
      if (i === 0 && handlerRef && handlerRef.isRegistered(1)) {
        handlerRef.unregisterPlayer(1);
      }
    };
    const h = new HitboxDamageHandler(callback);
    handlerRef = h;
    const wolf = makeCharacterBody('wolf', 1);
    const cat = makeCharacterBody('cat', 2);
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    // Both characters hit in the same event; the first hit
    // unregisters slot 1, so the second pair (still in this event)
    // should be safely ignored.
    expect(() =>
      h.handleCollisionStart(
        makeEvent(
          { bodyA: makeHitboxBody('cat', { damage: 5 }, 10), bodyB: wolf },
          { bodyA: makeHitboxBody('wolf', { damage: 5 }, 11), bodyB: cat },
        ),
      ),
    ).not.toThrow();
    // Slot 0 was hit; slot 1 was unregistered before its pair was
    // processed and should NOT have fired.
    expect(log.length).toBe(1);
    expect(log[0]!.targetIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 2 of AC 10002 — per-target hurtbox lookup integration
//
// Locks down the contract:
//   • All-intangible hurtbox set drops the hit AND does NOT confirm it
//     (so the next event after the i-frame closes can still land).
//   • Tangible set with damageMultiplier > 1 scales the dispatched
//     `hit.damage` by the resolved multiplier.
//   • Tangible set with damageMultiplier ≤ 1 leaves the hit unchanged.
//   • Lookup returning null / empty preserves the unmodified-dispatch
//     contract (legacy / unwired-target case).
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — hurtbox lookup (AC 10002 Sub-AC 2)', () => {
  const tangibleBody: Hurtbox = {
    id: 'body',
    offsetX: 0,
    offsetY: 0,
    width: 90,
    height: 130,
  };
  const intangible: Hurtbox = {
    id: 'm.dodge',
    offsetX: 0,
    offsetY: 0,
    width: 90,
    height: 130,
    intangible: true,
  };
  const weakpoint: Hurtbox = {
    id: 'm.weakpoint',
    offsetX: 0,
    offsetY: 0,
    width: 30,
    height: 30,
    damageMultiplier: 1.5,
  };

  it('drops the hit when every active hurtbox is intangible', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    // Lookup: target is mid-dodge — single intangible hurtbox.
    h.setHurtboxLookup(() => [intangible]);
    const swing = makeHitboxBody('cat', { damage: 10 }, 100);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log).toEqual([]);
  });

  it('an intangible window does NOT confirm the swing — it can still land after', () => {
    // Mid-dodge: first event dropped. Lookup flips back to the tangible
    // body before the second event; the SAME swing body now lands a
    // hit, because per-lifetime confirmation was skipped on the
    // intangible drop.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    let intangibleNow = true;
    h.setHurtboxLookup(() => (intangibleNow ? [intangible] : [tangibleBody]));
    const swing = makeHitboxBody('cat', { damage: 8 }, 200);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(0);
    // I-frame window closes mid-active-window — second event lands.
    intangibleNow = false;
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(8);
  });

  it('scales hit damage by the max damageMultiplier across the tangible set', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    h.setHurtboxLookup(() => [tangibleBody, weakpoint]);
    const swing = makeHitboxBody('cat', { damage: 10 }, 300);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    // 10 base × 1.5 weakpoint multiplier = 15
    expect(log[0]!.hit.damage).toBe(15);
    // Knockback / facing flow through unchanged — only damage is scaled.
    expect(log[0]!.hit.knockback).toEqual({ x: 1.5, y: -0.5, scaling: 0.05 });
    expect(log[0]!.hit.facing).toBe(1);
  });

  it('leaves damage unchanged when no hurtbox in the set declares a multiplier', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    h.setHurtboxLookup(() => [tangibleBody]);
    const swing = makeHitboxBody('cat', { damage: 7 }, 400);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(7);
  });

  it('null lookup preserves the unmodified dispatch path (legacy contract)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    // Default state — no lookup registered.
    const swing = makeHitboxBody('cat', { damage: 9 }, 500);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(9);
  });

  it('lookup returning null treats the target as unmodified (defensive)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    // Lookup says "I don't know about this slot" — handler falls
    // back to the unmodified dispatch path so an unwired slot can
    // never drop hits silently.
    h.setHurtboxLookup(() => null);
    const swing = makeHitboxBody('cat', { damage: 6 }, 600);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(6);
  });

  it('lookup returning [] treats the target as unmodified (defensive)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    h.setHurtboxLookup(() => []);
    const swing = makeHitboxBody('cat', { damage: 5 }, 700);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(5);
  });

  it('setHurtboxLookup(null) reverts to unmodified dispatch', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    h.setHurtboxLookup(() => [intangible]);
    h.setHurtboxLookup(null);
    const swing = makeHitboxBody('cat', { damage: 4 }, 800);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    expect(log[0]!.hit.damage).toBe(4);
  });

  it('only the intended target index sees its lookup result (multi-target isolation)', () => {
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    const cat = makeCharacterBody('cat', 2);
    h.registerPlayer(0, wolf);
    h.registerPlayer(1, cat);
    // Wolf is dodging (intangible); Cat is wide open (tangible).
    h.setHurtboxLookup((idx) => (idx === 0 ? [intangible] : [tangibleBody]));
    const swing = makeHitboxBody('owl', { damage: 12 }, 900);
    h.handleCollisionStart(
      makeEvent(
        { bodyA: swing, bodyB: wolf },
        { bodyA: swing, bodyB: cat },
      ),
    );
    // Wolf drops (intangible), Cat takes the unscaled 12 damage.
    expect(log.length).toBe(1);
    expect(log[0]!.targetIndex).toBe(1);
    expect(log[0]!.hit.damage).toBe(12);
  });

  it('hurtbox lookup is invoked AFTER per-lifetime confirmation check', () => {
    // The lookup is consulted only for candidate hits that survive the
    // confirmation registry — a second event with the same swing+target
    // pair is dropped without re-querying the lookup. Verify by counting
    // lookup invocations.
    const { log, cb } = makeLogger();
    const h = new HitboxDamageHandler(cb);
    const wolf = makeCharacterBody('wolf', 1);
    h.registerPlayer(0, wolf);
    let lookupCalls = 0;
    h.setHurtboxLookup(() => {
      lookupCalls += 1;
      return [tangibleBody];
    });
    const swing = makeHitboxBody('cat', { damage: 6 }, 1000);
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    h.handleCollisionStart(makeEvent({ bodyA: swing, bodyB: wolf }));
    expect(log.length).toBe(1);
    // Second event was dropped by per-lifetime confirmation BEFORE the
    // lookup ran — exactly one lookup call total.
    expect(lookupCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same pair stream → same callback log every run
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — determinism', () => {
  it('produces identical callback sequences across repeated runs', () => {
    const run = (): CallbackLog[] => {
      const { log, cb } = makeLogger();
      const h = new HitboxDamageHandler(cb);
      const wolf = makeCharacterBody('wolf', 1);
      const cat = makeCharacterBody('cat', 2);
      h.registerPlayer(0, wolf);
      h.registerPlayer(1, cat);
      const swing1 = makeHitboxBody('cat', { damage: 8 }, 100);
      const swing2 = makeHitboxBody('wolf', { damage: 12 }, 101);
      h.handleCollisionStart(
        makeEvent(
          { bodyA: swing1, bodyB: wolf },
          { bodyA: swing2, bodyB: cat },
        ),
      );
      h.handleCollisionStart(makeEvent({ bodyA: swing1, bodyB: wolf }));
      return log;
    };
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
// Integration with Character.applyHit — end-to-end damage tracking
// ---------------------------------------------------------------------------

describe('HitboxDamageHandler — integration with Character.applyHit', () => {
  it('an end-to-end pair stream produces matching damage on the target', async () => {
    // This is the headline AC: "damage tracking that applies incoming
    // damage and updates fighter percentage state." Wire the handler
    // to a real Character mock-scene fighter and verify the percent
    // meter ticks up when a hitbox fires.
    const { Character } = await import('../characters/Character');

    // Reuse the same minimal mock-scene shape from Character.test.ts.
    interface MockBody {
      position: { x: number; y: number };
      velocity: { x: number; y: number };
      label: string | undefined;
      options: Record<string, unknown>;
      removed: boolean;
    }
    interface MockScene {
      bodies: MockBody[];
      listeners: Array<{ event: string; fn: (e: { pairs: unknown[] }) => void }>;
      scene: any;
    }
    const createMockScene = (): MockScene => {
      const bodies: MockBody[] = [];
      const listeners: Array<{
        event: string;
        fn: (e: { pairs: unknown[] }) => void;
      }> = [];
      const matter = {
        add: {
          rectangle(
            x: number,
            y: number,
            w: number,
            h: number,
            options: Record<string, unknown>,
          ): MockBody {
            const body: MockBody = {
              position: { x, y },
              velocity: { x: 0, y: 0 },
              label: options['label'] as string | undefined,
              options: { ...options, _w: w, _h: h, plugin: options['plugin'] },
              removed: false,
            };
            bodies.push(body);
            return body;
          },
        },
        body: {
          setVelocity(b: MockBody, v: { x: number; y: number }): void {
            b.velocity = { ...v };
          },
          setPosition(b: MockBody, v: { x: number; y: number }): void {
            b.position = { ...v };
          },
          setInertia(_b: MockBody, _i: number): void {},
        },
        world: {
          on(e: string, fn: (e: { pairs: unknown[] }) => void): void {
            listeners.push({ event: e, fn });
          },
          off(e: string, fn: (e: { pairs: unknown[] }) => void): void {
            const idx = listeners.findIndex(
              (l) => l.event === e && l.fn === fn,
            );
            if (idx >= 0) listeners.splice(idx, 1);
          },
          remove(b: MockBody): void {
            b.removed = true;
          },
        },
      };
      return { bodies, listeners, scene: { matter } };
    };

    const scene = createMockScene();
    const wolf = new Character(scene.scene, {
      id: 'wolf',
      spawnX: 0,
      spawnY: 0,
    });
    // Adapt the Character body to the handler's `HitboxOrCharacterBody`
    // shape — the mock body already has `label` and `plugin` on its
    // `options`. We project a minimal facade.
    const wolfBody = scene.bodies[0]!;
    const wolfBodyFacade: HitboxOrCharacterBody = {
      label: wolfBody.label as string,
      plugin: wolfBody.options['plugin'] as { characterId: string },
    };

    const handler = new HitboxDamageHandler((targetIndex, hit) => {
      // The MatchScene wires this lookup; the test mirrors it.
      if (targetIndex === 0) wolf.applyHit(hit);
    });
    handler.registerPlayer(0, wolfBodyFacade);

    // Build a Cat-owned hitbox payload and fire a synthetic
    // `collisionstart` event. Each "swing" is a fresh body, mirroring
    // the way `spawnHitbox` allocates a new sensor every time the
    // attacker's `tickAttack` enters the active phase.
    const catHit = makeHitboxBody('cat', {
      damage: 7,
      knockback: { x: 1.5, y: -0.5, scaling: 0.05 },
      facing: 1,
      moveId: 'cat.jab',
    });
    expect(wolf.getDamagePercent()).toBe(0);
    handler.handleCollisionStart(makeEvent({ bodyA: catHit, bodyB: wolfBodyFacade }));
    expect(wolf.getDamagePercent()).toBe(7);
    // Subsequent hit accumulates — represented as a NEW swing body
    // because per-lifetime hit confirmation prevents the same body
    // from re-hitting the same target.
    const catHit2 = makeHitboxBody('cat', {
      damage: 7,
      knockback: { x: 1.5, y: -0.5, scaling: 0.05 },
      facing: 1,
      moveId: 'cat.jab',
    });
    handler.handleCollisionStart(makeEvent({ bodyA: catHit2, bodyB: wolfBodyFacade }));
    expect(wolf.getDamagePercent()).toBe(14);
    // Post-M2 hit-feel pass: knockback velocity + hitstun are queued
    // behind the hitlag freeze. Drive applyInput through the freeze
    // before checking the post-hit state.
    while (wolf.getHitlagRemaining() > 0) {
      wolf.applyInput({ moveX: 0, jump: false });
    }
    // Hitstun was applied — the fighter is locked out of player input.
    expect(wolf.isInHitstun()).toBe(true);
    // Velocity was perturbed by the knockback.
    expect(wolf.getVelocity().x).toBeGreaterThan(0);
  });
});
