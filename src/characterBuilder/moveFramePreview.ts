import type { AttackCollisionHit, AttackMove } from '../characters/attacks';
import { attackHitWindowIndex, resolveAttackHitWindow } from '../characters/attackHitWindows';
import {
  computeAttackPhase,
  getMoveBusyFrames,
  type AttackMoveWithAnimation,
} from '../characters/moveSchema';

export type MoveFramePhase = 'startup' | 'active' | 'gap' | 'recovery';

/** One uncharged authored move frame. Coordinates stay local to the fighter. */
export interface MoveFramePreview {
  /** Zero-based simulation frame, clamped to the move's busy duration. */
  readonly elapsed: number;
  /** One-based frame label, matching frame-data references. */
  readonly frame: number;
  readonly totalFrames: number;
  readonly phase: MoveFramePhase;
  /** -1 when there is no live authored window (including legacy moves). */
  readonly windowIndex: number;
  /** Attack-latched axis multiplied by the live window's relative facing. */
  readonly facing: 1 | -1;
  readonly group?: string;
  readonly damage?: number;
  readonly hitbox?: AttackMove['hitbox'];
  /** Empty when inactive or when the move uses rectangular collision. */
  readonly collisionHits: readonly AttackCollisionHit[];
  readonly resolvedMove?: AttackMove;
}

/**
 * Inspect the same active windows and overrides as combat, without advancing
 * gameplay or altering authored data. An active envelope's empty frames are
 * explicit gaps: the editor must never draw a damaging box on those frames.
 * `facing` is the attack axis (already reversed for a back aerial).
 */
export function inspectMoveFrame(
  move: AttackMoveWithAnimation,
  elapsed: number,
  facing: 1 | -1 = 1,
): MoveFramePreview {
  const totalFrames = Math.max(1, getMoveBusyFrames(move));
  const clamped = Math.max(0, Math.min(totalFrames - 1, Math.floor(Number.isNaN(elapsed) ? 0 : elapsed)));
  const envelopePhase = computeAttackPhase(clamped, move);
  const windowIndex = envelopePhase === 'active' ? attackHitWindowIndex(move, clamped) : -1;
  const window = move.hitWindows?.[windowIndex];
  const phase: MoveFramePhase = envelopePhase === 'active' && move.hitWindows?.length && !window
    ? 'gap'
    : envelopePhase === 'done' ? 'recovery' : envelopePhase;
  const resolvedMove = phase === 'active'
    ? window ? resolveAttackHitWindow(move, move, window) : move
    : undefined;

  return {
    elapsed: clamped,
    frame: clamped + 1,
    totalFrames,
    phase,
    windowIndex,
    facing: (facing * (window?.facing ?? 1)) as 1 | -1,
    group: window?.group,
    damage: resolvedMove?.damage,
    hitbox: resolvedMove?.hitbox,
    collisionHits: resolvedMove?.collisionHits ?? [],
    resolvedMove,
  };
}
