/**
 * HardRecoveryTree — composes the recovery leaves into the
 * Hard-tier off-stage recovery sub-tree authored for AC 18 Sub-AC 4.
 *
 * Tree shape
 * ----------
 *
 *   Selector("hardRecovery")
 *     ├── JumpRecoveryLeaf         — first-jump press if grounded jump
 *     │                              still available and bot just slipped
 *     │                              off the edge.
 *     ├── DoubleJumpRecoveryLeaf   — air-jump when conservation policy
 *     │                              says it's worth burning the resource.
 *     ├── RecoveryMoveLeaf         — up-special when air-jumps spent OR
 *     │                              the bot is on a death trajectory.
 *     └── LedgeReturnLeaf          — once airborne and aligned with the
 *                                    stage, push horizontally onto the
 *                                    nearest ledge corner.
 *
 * Why this shape (priority order matters)
 * ---------------------------------------
 *
 *   1. The Selector ticks branches in declaration order and returns
 *      the first non-Failure. The four leaves are *mutually
 *      exclusive guards*: exactly one of them owns the situation on
 *      any given tick.
 *
 *   2. Jump first (cheapest resource), then double-jump (more
 *      valuable), then up-special (most valuable, once-per-air-time).
 *      This matches the canonical Smash recovery hierarchy.
 *
 *   3. Ledge-return sits last because it's the ONLY branch that
 *      runs after the bot has the height — every earlier branch
 *      gates on "still need more height" and falls through once the
 *      bot is at-or-above the ledge.
 *
 *   4. The JumpRecoveryLeaf and DoubleJumpRecoveryLeaf differ only
 *      in their re-press cooldowns and conservation gates; we ship
 *      both rather than collapse them so the tree shape makes the
 *      "use grounded jump THEN air-jump THEN up-special" sequencing
 *      explicit.
 *
 * Reach numbers / tunables
 * ------------------------
 *
 * The default tunables are tuned to the M2 roster's jump heights
 * and up-special hangtimes. Overrides flow through the
 * {@link HardRecoveryTreeOptions} record so a per-character
 * controller can tighten / loosen per-fighter without forking the
 * tree shape.
 *
 * Determinism
 * -----------
 *
 * Every leaf and decorator used here is deterministic on its
 * inputs. The factory itself reads no Rng, no wall-clock —
 * `buildHardRecoveryTree` always returns an isomorphic tree given
 * the same options, so the replay system can rebuild the controller
 * from a snapshot by calling the factory and replaying the recorded
 * inputs.
 */

import { SelectorNode } from '../behaviorTree/composites';
import type { IBehaviorNode } from '../behaviorTree/Node';

import {
  DoubleJumpRecoveryLeaf,
  type DoubleJumpRecoveryOptions,
} from './DoubleJumpRecoveryLeaf';
import {
  JumpRecoveryLeaf,
  type JumpRecoveryOptions,
} from './JumpRecoveryLeaf';
import {
  LedgeReturnLeaf,
  type LedgeReturnOptions,
} from './LedgeReturnLeaf';
import {
  RecoveryMoveLeaf,
  type RecoveryMoveOptions,
} from './RecoveryMoveLeaf';
import type { RecoveryContext } from './types';

/** Construction options for {@link buildHardRecoveryTree}. */
export interface HardRecoveryTreeOptions {
  /** Tunables forwarded to the first-jump leaf. */
  readonly jump?: JumpRecoveryOptions;
  /** Tunables forwarded to the air-jump (double-jump) leaf. */
  readonly doubleJump?: DoubleJumpRecoveryOptions;
  /** Tunables forwarded to the up-special leaf. */
  readonly upSpecial?: RecoveryMoveOptions;
  /** Tunables forwarded to the ledge-return leaf. */
  readonly ledgeReturn?: LedgeReturnOptions;
}

/**
 * Resolved option set with defaults filled in. Useful for tests
 * that want to assert the actual tunables in play and for
 * controller integration code that wants to log the exact
 * configuration.
 */
export interface ResolvedHardRecoveryTreeOptions {
  readonly jump: Required<
    Pick<JumpRecoveryOptions, 'repressCooldownFrames' | 'verticalSlackPx'>
  >;
  readonly doubleJump: Required<
    Pick<
      DoubleJumpRecoveryOptions,
      | 'repressCooldownFrames'
      | 'ledgeBelowThresholdPx'
      | 'blastZoneLookaheadFrames'
      | 'verticalSlackPx'
    >
  >;
  readonly upSpecial: Required<
    Pick<
      RecoveryMoveOptions,
      | 'blastZoneLookaheadFrames'
      | 'verticalSlackPx'
      | 'emitMoveUp'
      | 'emitDirectionalNudge'
    >
  >;
  readonly ledgeReturn: Required<
    Pick<
      LedgeReturnOptions,
      'arrivalToleranceXPx' | 'overshootToleranceYPx'
    >
  >;
}

/**
 * Apply defaults to the user-supplied options. Mirrors
 * `resolveHardOffensiveTreeOptions` so the two factories share the
 * same shape for controller introspection / debug-overlay code.
 */
export function resolveHardRecoveryTreeOptions(
  options: HardRecoveryTreeOptions = {},
): ResolvedHardRecoveryTreeOptions {
  return {
    jump: {
      repressCooldownFrames: options.jump?.repressCooldownFrames ?? 8,
      verticalSlackPx: options.jump?.verticalSlackPx ?? 0,
    },
    doubleJump: {
      repressCooldownFrames:
        options.doubleJump?.repressCooldownFrames ?? 12,
      ledgeBelowThresholdPx:
        options.doubleJump?.ledgeBelowThresholdPx ?? 40,
      blastZoneLookaheadFrames:
        options.doubleJump?.blastZoneLookaheadFrames ?? 30,
      verticalSlackPx: options.doubleJump?.verticalSlackPx ?? 0,
    },
    upSpecial: {
      blastZoneLookaheadFrames:
        options.upSpecial?.blastZoneLookaheadFrames ?? 60,
      verticalSlackPx: options.upSpecial?.verticalSlackPx ?? 0,
      emitMoveUp: options.upSpecial?.emitMoveUp ?? true,
      emitDirectionalNudge:
        options.upSpecial?.emitDirectionalNudge ?? true,
    },
    ledgeReturn: {
      arrivalToleranceXPx:
        options.ledgeReturn?.arrivalToleranceXPx ?? 12,
      overshootToleranceYPx:
        options.ledgeReturn?.overshootToleranceYPx ?? 8,
    },
  };
}

/**
 * Build the Hard-tier recovery sub-tree. Returns the root
 * `IBehaviorNode` so a controller can plug it into a larger tree
 * (e.g. as a child of a top-level Selector that sits alongside
 * the offensive sub-tree).
 *
 * Composition convention: the recovery sub-tree should be ticked
 * *before* the offensive sub-tree in the top-level Selector. The
 * recovery branches all return `Failure` when the bot is on stage
 * (idle/grounded), so they never block offensive play; when the
 * bot is off-stage they take priority and the offensive branches
 * never fire.
 */
export function buildHardRecoveryTree(
  options: HardRecoveryTreeOptions = {},
): IBehaviorNode<RecoveryContext> {
  return new SelectorNode<RecoveryContext>(
    [
      new JumpRecoveryLeaf(options.jump ?? {}, 'recovery.jump'),
      new DoubleJumpRecoveryLeaf(
        options.doubleJump ?? {},
        'recovery.doubleJump',
      ),
      new RecoveryMoveLeaf(
        options.upSpecial ?? {},
        'recovery.upSpecial',
      ),
      new LedgeReturnLeaf(
        options.ledgeReturn ?? {},
        'recovery.ledgeReturn',
      ),
    ],
    'hardRecovery',
  );
}
