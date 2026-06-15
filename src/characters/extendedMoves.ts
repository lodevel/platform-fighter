/**
 * Extended-slot move authoring for Cat / Owl / Bear (post-M2 — 14-slot kit).
 *
 * Wolf's extended-slot moves live alongside its other moves in
 * `Wolf.ts`. The remaining three characters get their five new
 * extended slots (sideLight + upLight + downLight + uair + dair)
 * authored here, in one file, so the per-character files don't
 * balloon any further while the directional kit lands.
 *
 * # Per-archetype tuning shape
 *
 *   • Cat (ninja)    — fast / light / low damage / high scaling.
 *   • Owl (mage)     — mid speed / mid damage / floaty arcs.
 *   • Bear (grappler)— slow / heavy / big hitboxes / high damage.
 *
 * Numbers are first-draft Smash-flavored defaults — a balance pass /
 * tuning sub-task can refine them once the runtime consumes
 * extended slots through `extendedSlotResolver`. The schema +
 * routing are both in place; this file is purely the data layer.
 *
 * Determinism: every value is a frozen finite literal.
 */

import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';

// ---------------------------------------------------------------------------
// Cat — ninja archetype
// ---------------------------------------------------------------------------

export const CAT_SIDE_LIGHT: AttackMoveWithAnimation = {
  id: 'cat.sideLight',
  type: 'tilt',
  damage: 5,
  knockback: { x: 1.5, y: -0.5, scaling: 0.12 },
  hitbox: { offsetX: 24, offsetY: -3, width: 33, height: 16 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

export const CAT_UP_LIGHT: AttackMoveWithAnimation = {
  id: 'cat.upLight',
  type: 'tilt',
  damage: 5,
  knockback: { x: 0.2, y: -1.8, scaling: 0.14 },
  hitbox: { offsetX: 8, offsetY: -16, width: 56, height: 42 },
  startupFrames: 4,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 10,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

export const CAT_DOWN_LIGHT: AttackMoveWithAnimation = {
  id: 'cat.downLight',
  type: 'tilt',
  damage: 4,
  knockback: { x: 1.2, y: -0.8, scaling: 0.10 },
  hitbox: { offsetX: 22, offsetY: 26, width: 26, height: 12 },
  startupFrames: 4,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 9,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 2 },
};

export const CAT_UAIR: AerialMove = {
  id: 'cat.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 7,
  knockback: { x: 0.3, y: -2.8, scaling: 0.18 },
  hitbox: { offsetX: 0, offsetY: -28, width: 30, height: 22 },
  startupFrames: 5,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 8,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

export const CAT_DAIR: AerialMove = {
  id: 'cat.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 8,
  knockback: { x: 0.4, y: 3.0, scaling: 0.22 },
  hitbox: { offsetX: 0, offsetY: 22, width: 26, height: 22 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

// ---------------------------------------------------------------------------
// Owl — mage archetype
// ---------------------------------------------------------------------------

export const OWL_SIDE_LIGHT: AttackMoveWithAnimation = {
  id: 'owl.sideLight',
  type: 'tilt',
  damage: 7,
  knockback: { x: 1.7, y: -0.5, scaling: 0.11 },
  hitbox: { offsetX: 28, offsetY: -3, width: 38, height: 18 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 13,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

export const OWL_UP_LIGHT: AttackMoveWithAnimation = {
  id: 'owl.upLight',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.4, y: -2.4, scaling: 0.14 },
  hitbox: { offsetX: 8, offsetY: -20, width: 58, height: 50 },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

export const OWL_DOWN_LIGHT: AttackMoveWithAnimation = {
  id: 'owl.downLight',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.3, y: -0.6, scaling: 0.10 },
  hitbox: { offsetX: 26, offsetY: 33, width: 34, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

export const OWL_UAIR: AerialMove = {
  id: 'owl.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 8,
  knockback: { x: 0.3, y: -3.0, scaling: 0.18 },
  hitbox: { offsetX: 0, offsetY: -32, width: 38, height: 28 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 9,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

export const OWL_DAIR: AerialMove = {
  id: 'owl.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 9,
  knockback: { x: 0.4, y: 3.2, scaling: 0.22 },
  hitbox: { offsetX: 0, offsetY: 28, width: 32, height: 26 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

// ---------------------------------------------------------------------------
// Bear — grappler archetype
// ---------------------------------------------------------------------------

export const BEAR_SIDE_LIGHT: AttackMoveWithAnimation = {
  id: 'bear.sideLight',
  type: 'tilt',
  damage: 10,
  knockback: { x: 2.4, y: -0.7, scaling: 0.14 },
  hitbox: { offsetX: 32, offsetY: -3, width: 42, height: 22 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 16,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

export const BEAR_UP_LIGHT: AttackMoveWithAnimation = {
  id: 'bear.upLight',
  type: 'tilt',
  damage: 9,
  knockback: { x: 0.5, y: -2.6, scaling: 0.16 },
  hitbox: { offsetX: 11, offsetY: -24, width: 71, height: 58 },
  startupFrames: 8,
  activeFrames: 3,
  recoveryFrames: 14,
  cooldownFrames: 15,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

export const BEAR_DOWN_LIGHT: AttackMoveWithAnimation = {
  id: 'bear.downLight',
  type: 'tilt',
  damage: 8,
  knockback: { x: 1.8, y: -1.0, scaling: 0.12 },
  hitbox: { offsetX: 28, offsetY: 29, width: 40, height: 18 },
  startupFrames: 7,
  activeFrames: 3,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

export const BEAR_UAIR: AerialMove = {
  id: 'bear.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 11,
  knockback: { x: 0.4, y: -3.4, scaling: 0.22 },
  hitbox: { offsetX: 0, offsetY: -36, width: 42, height: 34 },
  startupFrames: 8,
  activeFrames: 5,
  recoveryFrames: 16,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

export const BEAR_DAIR: AerialMove = {
  id: 'bear.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 13,
  knockback: { x: 0.4, y: 4.0, scaling: 0.28 },
  hitbox: { offsetX: 0, offsetY: 32, width: 38, height: 32 },
  startupFrames: 11,
  activeFrames: 5,
  recoveryFrames: 22,
  cooldownFrames: 12,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 22,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};
