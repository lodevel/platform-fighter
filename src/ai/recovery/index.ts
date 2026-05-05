/**
 * Recovery module — public re-exports.
 *
 * Hard-tier off-stage recovery behavior-tree branches authored in
 * AC 18 Sub-AC 4. Composes leaves (first-jump, double-jump,
 * up-special recovery move, ledge return) into a single Selector
 * that prioritises the cheapest jump resource first and escalates
 * to the up-special only when conservation policy says it's worth
 * burning. The companion {@link clearRecoveryState} helper resets
 * the recovery partition from the controller's onLand /
 * onLedgeGrab callbacks.
 */

// Core types
export type {
  LedgeMixupGetUpOption,
  RecoveryAction,
  RecoveryActionKind,
  RecoveryActionWriter,
  RecoveryBlackboardSchema,
  RecoveryContext,
  RecoveryLedge,
  RecoveryPhase,
  RecoverySelfSnapshot,
  RecoveryStageGeometry,
} from './types';
export {
  DEFAULT_RECOVERY_BLACKBOARD,
  isApproachingBlastZone,
  isOffStage,
  ledgeXOffset,
  ledgeYOffset,
} from './types';

// Leaf nodes
export { JumpRecoveryLeaf } from './JumpRecoveryLeaf';
export type { JumpRecoveryOptions } from './JumpRecoveryLeaf';

export { DoubleJumpRecoveryLeaf } from './DoubleJumpRecoveryLeaf';
export type { DoubleJumpRecoveryOptions } from './DoubleJumpRecoveryLeaf';

export {
  RecoveryMoveLeaf,
  clearRecoveryState,
} from './RecoveryMoveLeaf';
export type { RecoveryMoveOptions } from './RecoveryMoveLeaf';

export { LedgeReturnLeaf } from './LedgeReturnLeaf';
export type { LedgeReturnOptions } from './LedgeReturnLeaf';

// Tree factory
export {
  buildHardRecoveryTree,
  resolveHardRecoveryTreeOptions,
} from './HardRecoveryTree';
export type {
  HardRecoveryTreeOptions,
  ResolvedHardRecoveryTreeOptions,
} from './HardRecoveryTree';
