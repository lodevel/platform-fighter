/**
 * Simple stub AI for AI-tier slots in MatchScene.
 *
 * The full Easy/Medium/Hard tier AIs in `src/ai/{Easy,Medium,Hard}TierAI.ts`
 * exist and pass their unit tests, but they require a per-frame
 * `WorldSnapshot` perception push, a behavior-tree blackboard, an RNG
 * handle, and a reaction-system delay buffer. Wiring all of that into
 * MatchScene's per-frame input loop is its own focused effort.
 *
 * This file ships a much simpler stub that demonstrates AI control
 * works end-to-end:
 *   • Walk toward the nearest opponent.
 *   • Jump occasionally to traverse platforms.
 *   • Press attack when within striking distance.
 *
 * The output shape is a plain `CharacterInput`, so the per-frame
 * loop can drop this in beside `buildCharacterInputFromResolver`
 * for AI slots without touching any other plumbing.
 */

import type { CharacterInput } from '../characters/Character';
import type { ItemCategory } from '../items/ItemDefinition';

/**
 * Tier multiplies the simple bot's attack frequency + reaction speed.
 * `'easy'` is the slowest / weakest, `'hard'` is the most aggressive.
 */
export type SimpleBotTier = 'easy' | 'medium' | 'hard';

interface BotState {
  attackCooldownFrames: number;
  jumpCooldownFrames: number;
  // T3 (AC 18) — bot's per-press cooldowns for the held-item action
  // budget so the bot doesn't mash and exhaust durability in one tick.
  itemUseCooldownFrames: number;
  throwCooldownFrames: number;
}

const STATE_BY_SLOT = new WeakMap<object, BotState>();

interface FighterSnapshot {
  readonly playerIndex: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly grounded: boolean;
}

/**
 * T3 (AC 18) — minimal item snapshot the bot reads. Indexed by the
 * Phaser-side AI integration via `ItemRegistry.getActive()` mapped
 * through `def.category`.
 */
export interface ItemSnapshot {
  readonly position: { readonly x: number; readonly y: number };
  readonly category: ItemCategory;
  readonly pickable: boolean;
}

/**
 * T3 (AC 18) — held-item snapshot. The bot reads this to switch
 * behaviour from "walk to opponent and jab" → "use item or throw at
 * opponent." The category drives ranged-vs-melee decisions: a held
 * `'ranged-weapon'` is the highest-priority press because it hits at
 * range without committing to a melee approach.
 */
export interface HeldItemSnapshot {
  readonly category: ItemCategory;
  /**
   * Slots the held item replaces. Tells the bot which press button
   * fires the item — `['jab', 'tilt', 'smash']` for a bat, just
   * `['neutralSpecial']` for ray gun / bomb.
   */
  readonly slotOverrides: ReadonlyArray<string>;
}

const TIER_PARAMS: Record<SimpleBotTier, {
  attackRange: number;
  attackCooldown: number;
  jumpCooldown: number;
  moveAggression: number;
}> = {
  easy: { attackRange: 70, attackCooldown: 90, jumpCooldown: 240, moveAggression: 0.6 },
  medium: { attackRange: 80, attackCooldown: 60, jumpCooldown: 180, moveAggression: 0.85 },
  hard: { attackRange: 90, attackCooldown: 35, jumpCooldown: 120, moveAggression: 1.0 },
};

/**
 * Compute the bot's CharacterInput for this frame. Walks toward the
 * nearest opponent, jumps periodically to clear platforms, and presses
 * attack when within range. Deterministic per-frame: same inputs → same
 * output, so replay determinism holds.
 */
export function simpleBotInput(
  selfKey: object,
  self: FighterSnapshot,
  others: ReadonlyArray<FighterSnapshot>,
  tier: SimpleBotTier,
  items: ReadonlyArray<ItemSnapshot> = [],
  heldItem: HeldItemSnapshot | null = null,
): CharacterInput {
  const params = TIER_PARAMS[tier];
  let state = STATE_BY_SLOT.get(selfKey);
  if (!state) {
    state = {
      attackCooldownFrames: 0,
      jumpCooldownFrames: 0,
      itemUseCooldownFrames: 0,
      throwCooldownFrames: 0,
    };
    STATE_BY_SLOT.set(selfKey, state);
  }
  if (state.attackCooldownFrames > 0) state.attackCooldownFrames -= 1;
  if (state.jumpCooldownFrames > 0) state.jumpCooldownFrames -= 1;
  if (state.itemUseCooldownFrames > 0) state.itemUseCooldownFrames -= 1;
  if (state.throwCooldownFrames > 0) state.throwCooldownFrames -= 1;

  // Find nearest opponent.
  let nearest: FighterSnapshot | null = null;
  let nearestDist = Infinity;
  for (const o of others) {
    if (o.playerIndex === self.playerIndex) continue;
    const dx = o.position.x - self.position.x;
    const dy = o.position.y - self.position.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = o;
    }
  }

  if (!nearest) {
    return Object.freeze({
      moveX: 0,
      jump: false,
      attack: false,
      special: false,
      grab: false,
      shield: false,
      dodge: false,
      dropThrough: false,
    });
  }

  const dx = nearest.position.x - self.position.x;
  const dy = nearest.position.y - self.position.y;
  const horizDist = Math.abs(dx);

  // T3 (AC 18) — item-aware decision tree.
  //
  // Behaviour layering (highest priority first):
  //
  //   1. **Hold a ranged weapon** → keep distance, fire neutralSpecial
  //      whenever the opponent is in line of sight. Ranged weapons
  //      (ray gun) take precedence because they hit at distance
  //      without committing the bot to a melee approach.
  //
  //   2. **Hold a throwable** → throw at the nearest opponent if they
  //      are within mid-range; the throw key (`grab`) routes through
  //      the inventory's throw controller.
  //
  //   3. **Hold a melee weapon** → close to attackRange + 20 px and
  //      press jab to swing the bat (the held-bat slot override
  //      replaces the native jab so the swing becomes the bat).
  //
  //   4. **Empty hand, pickable item nearby** → pathfind toward the
  //      nearest pickable item (within `pickupTargetRangePx`) and press
  //      `attack` on arrival to pick it up.
  //
  //   5. **Default** — walk to opponent + jab in range (legacy behavior).
  //
  // Determinism: every decision is a pure function of the snapshot
  // tuple. No `Math.random()`, no wall-clock reads.
  const PICKUP_RADIUS = 60;
  const PICKUP_TARGET_RANGE = 600;
  const RANGED_FIRE_RANGE = 360;
  const THROWABLE_FIRE_RANGE = 280;

  // Held-item branches override the default walk-to-opponent
  // computation. We start by emitting a neutral input and selectively
  // populate fields based on the priority above.
  let moveX = horizDist > 8 ? Math.sign(dx) * params.moveAggression : 0;
  let attack = false;
  let special = false;
  let grab = false;
  let jump = false;

  // ---- Branch 1: held ranged weapon ----------------------------------
  if (heldItem && heldItem.category === 'ranged-weapon') {
    if (horizDist <= RANGED_FIRE_RANGE && Math.abs(dy) < 120) {
      // In range — fire (special slot is the ray-gun trigger; the
      // neutralSpecial override consumes the press).
      if (state.itemUseCooldownFrames === 0) {
        special = true;
        state.itemUseCooldownFrames = Math.max(15, params.attackCooldown / 2);
      }
      // Stand still while firing — the canonical "ranged stance".
      moveX = 0;
    }
  }
  // ---- Branch 2: held throwable --------------------------------------
  else if (heldItem && heldItem.category === 'throwable') {
    if (horizDist <= THROWABLE_FIRE_RANGE && state.throwCooldownFrames === 0) {
      // Throw at the opponent — `grab` is the dedicated throw key.
      grab = true;
      state.throwCooldownFrames = 60;
    }
  }
  // ---- Branch 3: held melee weapon -----------------------------------
  else if (heldItem && heldItem.category === 'melee-weapon') {
    if (
      horizDist <= params.attackRange + 20 &&
      Math.abs(dy) < 80 &&
      state.attackCooldownFrames === 0
    ) {
      // Press jab — the held-bat override consumes the press and
      // swings the bat hitbox.
      attack = true;
      state.attackCooldownFrames = Math.max(20, params.attackCooldown - 10);
    }
  }
  // ---- Branch 4: empty hand, pickable item nearby --------------------
  else if (!heldItem && items.length > 0) {
    let nearestItem: ItemSnapshot | null = null;
    let nearestItemDist = Infinity;
    for (const it of items) {
      if (!it.pickable) continue;
      const idx = it.position.x - self.position.x;
      const idy = it.position.y - self.position.y;
      const d = Math.sqrt(idx * idx + idy * idy);
      if (d < nearestItemDist && d <= PICKUP_TARGET_RANGE) {
        nearestItem = it;
        nearestItemDist = d;
      }
    }
    if (nearestItem !== null) {
      // Walk toward the item; the jab press triggers pickup when in
      // range (PickupController reads the rising-edge attack press).
      const idx = nearestItem.position.x - self.position.x;
      moveX = Math.abs(idx) > 8 ? Math.sign(idx) * params.moveAggression : 0;
      if (nearestItemDist <= PICKUP_RADIUS && state.attackCooldownFrames === 0) {
        attack = true;
        state.attackCooldownFrames = 30;
      }
    } else if (
      // Fall through to default behaviour — no item in pathfind range.
      horizDist <= params.attackRange &&
      Math.abs(dy) < 80 &&
      state.attackCooldownFrames === 0
    ) {
      attack = true;
      state.attackCooldownFrames = params.attackCooldown;
    }
  }
  // ---- Branch 5: default walk-to-opponent + jab ----------------------
  else {
    if (
      horizDist <= params.attackRange &&
      Math.abs(dy) < 80 &&
      state.attackCooldownFrames === 0
    ) {
      attack = true;
      state.attackCooldownFrames = params.attackCooldown;
    }
  }

  // Jump logic preserved across all branches.
  if (state.jumpCooldownFrames === 0 && self.grounded) {
    if (dy < -50 || horizDist > 250) {
      jump = true;
      state.jumpCooldownFrames = params.jumpCooldown;
    }
  }

  return Object.freeze({
    moveX,
    jump,
    attack,
    special,
    grab,
    shield: false,
    dodge: false,
    dropThrough: false,
  });
}

/**
 * Reset state for a slot — call on rematch / scene shutdown so the
 * bot's cooldown counters don't leak across matches.
 */
export function resetSimpleBotState(selfKey: object): void {
  STATE_BY_SLOT.delete(selfKey);
}
