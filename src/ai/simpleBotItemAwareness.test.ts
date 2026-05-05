/**
 * AI item-awareness tests — T3 items framework, AC 18.
 *
 * Drives the simpleBot's item-aware decision tree with synthetic
 * snapshots so the four behaviour branches (ranged hold, throwable
 * hold, melee hold, pathfind-to-item) are pinned without booting
 * Phaser / Matter.
 */

import { describe, it, expect } from 'vitest';
import {
  simpleBotInput,
  resetSimpleBotState,
  type ItemSnapshot,
  type HeldItemSnapshot,
} from './simpleBot';

const SELF = {
  playerIndex: 4,
  position: { x: 100, y: 200 },
  grounded: true,
};

const FAR_OPP = [
  {
    playerIndex: 1,
    position: { x: 800, y: 200 },
    grounded: true,
  },
];

describe('AC 18 — item-aware AI bot', () => {
  it('pathfinds toward a pickable item when empty-handed', () => {
    const key = {};
    resetSimpleBotState(key);
    const items: ItemSnapshot[] = [
      { position: { x: 300, y: 200 }, category: 'melee-weapon', pickable: true },
    ];
    const input = simpleBotInput(key, SELF, FAR_OPP, 'medium', items, null);
    // moveX should be positive (item is to the right).
    expect(input.moveX).toBeGreaterThan(0);
  });

  it('presses attack to pick up when within pickup radius', () => {
    const key = {};
    resetSimpleBotState(key);
    const items: ItemSnapshot[] = [
      { position: { x: 130, y: 200 }, category: 'melee-weapon', pickable: true },
    ];
    const input = simpleBotInput(key, SELF, FAR_OPP, 'medium', items, null);
    expect(input.attack).toBe(true);
  });

  it('prioritises ranged-weapon fire when held — presses special, stops moving', () => {
    const key = {};
    resetSimpleBotState(key);
    const held: HeldItemSnapshot = {
      category: 'ranged-weapon',
      slotOverrides: ['neutralSpecial'],
    };
    const opp = [
      {
        playerIndex: 1,
        position: { x: 350, y: 200 },
        grounded: true,
      },
    ];
    const input = simpleBotInput(key, SELF, opp, 'medium', [], held);
    expect(input.special).toBe(true);
    expect(input.moveX).toBe(0);
  });

  it('throws at opponent when holding a throwable in range', () => {
    const key = {};
    resetSimpleBotState(key);
    const held: HeldItemSnapshot = {
      category: 'throwable',
      slotOverrides: ['neutralSpecial'],
    };
    const opp = [
      {
        playerIndex: 1,
        position: { x: 250, y: 200 },
        grounded: true,
      },
    ];
    const input = simpleBotInput(key, SELF, opp, 'medium', [], held);
    expect(input.grab).toBe(true);
  });

  it('attacks with melee weapon when in range', () => {
    const key = {};
    resetSimpleBotState(key);
    const held: HeldItemSnapshot = {
      category: 'melee-weapon',
      slotOverrides: ['jab', 'tilt', 'smash'],
    };
    const opp = [
      {
        playerIndex: 1,
        position: { x: 170, y: 200 }, // within attackRange + 20
        grounded: true,
      },
    ];
    const input = simpleBotInput(key, SELF, opp, 'medium', [], held);
    expect(input.attack).toBe(true);
  });

  it('does not throw a throwable at out-of-range opponents', () => {
    const key = {};
    resetSimpleBotState(key);
    const held: HeldItemSnapshot = {
      category: 'throwable',
      slotOverrides: ['neutralSpecial'],
    };
    const opp = [
      {
        playerIndex: 1,
        position: { x: 1000, y: 200 }, // way out of range
        grounded: true,
      },
    ];
    const input = simpleBotInput(key, SELF, opp, 'medium', [], held);
    expect(input.grab).toBe(false);
  });

  it('falls back to default attack when held item is null and no items nearby', () => {
    const key = {};
    resetSimpleBotState(key);
    const opp = [
      {
        playerIndex: 1,
        position: { x: 170, y: 200 },
        grounded: true,
      },
    ];
    const input = simpleBotInput(key, SELF, opp, 'medium', [], null);
    expect(input.attack).toBe(true);
  });
});
