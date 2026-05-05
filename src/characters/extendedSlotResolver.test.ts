import { describe, expect, it } from 'vitest';

import {
  countExtendedSlots,
  hasAnyExtendedSlot,
  resolveAerialLightSlot,
  resolveGroundedLightSlot,
} from './extendedSlotResolver';
import type { FighterMoveset } from './movesetContract';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';

// We construct a minimal FighterMoveset by stamping recognizable
// sentinel `id` values on each slot, then assert which slot the
// resolver picked.

const grounded = (id: string): AttackMoveWithAnimation =>
  ({
    id,
    type: 'tilt',
    damage: 1,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 1,
    cooldownFrames: 1,
    animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
  }) as unknown as AttackMoveWithAnimation;

const aerial = (id: string): AerialMove =>
  ({
    id,
    type: 'aerial',
    damage: 1,
    knockback: { x: 0, y: 0, scaling: 0 },
    hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 1,
    cooldownFrames: 1,
    animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
    aerialDirection: 'forward',
    landingLagFrames: 1,
    autoCancelWindows: [],
  }) as unknown as AerialMove;

const baseCoreMoveset = (): FighterMoveset =>
  ({
    jab: grounded('jab'),
    tilt: grounded('tilt'),
    smash: grounded('smash'),
    fair: aerial('fair'),
    neutralSpecial: null,
    sideSpecial: null,
    upSpecial: null,
    downSpecial: null,
    shield: null,
    dodge: null,
  }) as unknown as FighterMoveset;

describe('resolveGroundedLightSlot — fallback to tilt when extended slots absent', () => {
  it('routes neutral stick to jab', () => {
    const m = baseCoreMoveset();
    expect(resolveGroundedLightSlot(m, 'neutral').id).toBe('jab');
  });

  it('routes side stick to tilt when sideLight is absent', () => {
    const m = baseCoreMoveset();
    expect(resolveGroundedLightSlot(m, 'side').id).toBe('tilt');
  });

  it('routes up stick to tilt when upLight is absent', () => {
    const m = baseCoreMoveset();
    expect(resolveGroundedLightSlot(m, 'up').id).toBe('tilt');
  });

  it('routes down stick to tilt when downLight is absent', () => {
    const m = baseCoreMoveset();
    expect(resolveGroundedLightSlot(m, 'down').id).toBe('tilt');
  });
});

describe('resolveGroundedLightSlot — extended slots take precedence when present', () => {
  it('routes side stick to sideLight when present', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), sideLight: grounded('sideLight') };
    expect(resolveGroundedLightSlot(m, 'side').id).toBe('sideLight');
  });

  it('routes up stick to upLight when present', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), upLight: grounded('upLight') };
    expect(resolveGroundedLightSlot(m, 'up').id).toBe('upLight');
  });

  it('routes down stick to downLight when present', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), downLight: grounded('downLight') };
    expect(resolveGroundedLightSlot(m, 'down').id).toBe('downLight');
  });

  it('does not affect neutral routing — jab is always jab', () => {
    const m: FighterMoveset = {
      ...baseCoreMoveset(),
      sideLight: grounded('sideLight'),
      upLight: grounded('upLight'),
      downLight: grounded('downLight'),
    };
    expect(resolveGroundedLightSlot(m, 'neutral').id).toBe('jab');
  });

  it('partially-migrated moveset uses extended where present, tilt where absent', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), upLight: grounded('upLight') };
    expect(resolveGroundedLightSlot(m, 'up').id).toBe('upLight');
    expect(resolveGroundedLightSlot(m, 'side').id).toBe('tilt');
    expect(resolveGroundedLightSlot(m, 'down').id).toBe('tilt');
  });
});

describe('resolveAerialLightSlot — fallback to fair when extended slots absent', () => {
  it('routes neutral stick to fair when nair is absent', () => {
    const m = baseCoreMoveset();
    expect(resolveAerialLightSlot(m, 'neutral').id).toBe('fair');
  });

  it('routes forward stick to fair', () => {
    const m = baseCoreMoveset();
    expect(resolveAerialLightSlot(m, 'forward').id).toBe('fair');
  });

  it('routes back stick to fair (L/R mirrored — same move authored)', () => {
    const m = baseCoreMoveset();
    expect(resolveAerialLightSlot(m, 'back').id).toBe('fair');
  });

  it('routes up stick to fair when uair is absent', () => {
    const m = baseCoreMoveset();
    expect(resolveAerialLightSlot(m, 'up').id).toBe('fair');
  });

  it('routes down stick to fair when dair is absent', () => {
    const m = baseCoreMoveset();
    expect(resolveAerialLightSlot(m, 'down').id).toBe('fair');
  });
});

describe('resolveAerialLightSlot — extended slots take precedence when present', () => {
  it('routes neutral stick to nair when present', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), nair: aerial('nair') };
    expect(resolveAerialLightSlot(m, 'neutral').id).toBe('nair');
  });

  it('routes up stick to uair when present', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), uair: aerial('uair') };
    expect(resolveAerialLightSlot(m, 'up').id).toBe('uair');
  });

  it('routes down stick to dair when present', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), dair: aerial('dair') };
    expect(resolveAerialLightSlot(m, 'down').id).toBe('dair');
  });

  it('forward and back ALWAYS route to fair — extended slots cannot override (L/R symmetry)', () => {
    const m: FighterMoveset = {
      ...baseCoreMoveset(),
      nair: aerial('nair'),
      uair: aerial('uair'),
      dair: aerial('dair'),
    };
    expect(resolveAerialLightSlot(m, 'forward').id).toBe('fair');
    expect(resolveAerialLightSlot(m, 'back').id).toBe('fair');
  });
});

describe('hasAnyExtendedSlot / countExtendedSlots', () => {
  it('returns false / 0 for a core-only moveset', () => {
    const m = baseCoreMoveset();
    expect(hasAnyExtendedSlot(m)).toBe(false);
    expect(countExtendedSlots(m)).toBe(0);
  });

  it('counts each populated extended slot exactly once', () => {
    const m: FighterMoveset = {
      ...baseCoreMoveset(),
      sideLight: grounded('sideLight'),
      uair: aerial('uair'),
    };
    expect(hasAnyExtendedSlot(m)).toBe(true);
    expect(countExtendedSlots(m)).toBe(2);
  });

  it('a fully-extended moveset reports 6', () => {
    const m: FighterMoveset = {
      ...baseCoreMoveset(),
      sideLight: grounded('sideLight'),
      upLight: grounded('upLight'),
      downLight: grounded('downLight'),
      nair: aerial('nair'),
      uair: aerial('uair'),
      dair: aerial('dair'),
    };
    expect(countExtendedSlots(m)).toBe(6);
  });
});

describe('extendedSlotResolver — determinism', () => {
  it('repeated calls return identical references', () => {
    const m: FighterMoveset = { ...baseCoreMoveset(), upLight: grounded('upLight') };
    const a = resolveGroundedLightSlot(m, 'up');
    const b = resolveGroundedLightSlot(m, 'up');
    expect(a).toBe(b);
  });
});
