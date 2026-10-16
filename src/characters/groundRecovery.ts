/** Committed ground-recovery rows (stand, trip stand, techs, getup rolls).
 * Native motion_list rows, identical for Donkey Kong, Link and Pikachu
 * (docs/review/2026-10-12/link-character/rework/sources/native/{,donkey/,pikachu/}motion_list.yml):
 * a row locks `duration` = cancel_frame - 1 steps and is intangible on frames 1..xlu_end - 1. */
import type { CharacterId } from '../types';

export interface GroundRecoveryRow { readonly duration: number; readonly intangibleFrames: number }
export const GROUND_RECOVERY_ROWS = Object.freeze({
  stand: Object.freeze({ duration: 29, intangibleFrames: 22 }),       // down_stand_u/d: xlu 1..23, cancel 30
  tripStand: Object.freeze({ duration: 21, intangibleFrames: 16 }),   // slip_stand: xlu 1..17, cancel 22
  techInPlace: Object.freeze({ duration: 26, intangibleFrames: 20 }), // passive: xlu 1..21, cancel 27
  techRoll: Object.freeze({ duration: 40, intangibleFrames: 20 }),    // passive_stand_f/b: xlu 1..21, cancel 41
});
/** down_{forward,back}_{u,d} cancel 36 for every fighter; intangibility differs per fighter. */
const GETUP_ROLL_DURATION = 35;
const GETUP_ROLL_INTANGIBLE_FRAMES: Readonly<Partial<Record<CharacterId, {
  readonly forwardFaceUp: number; readonly backFaceUp: number; readonly forwardFaceDown: number; readonly backFaceDown: number }>>> = {
  donkeykong: { forwardFaceUp: 19, backFaceUp: 24, forwardFaceDown: 14, backFaceDown: 24 }, // xlu 1..20 / 1..25 / 1..15 / 1..25
  link: { forwardFaceUp: 24, backFaceUp: 31, forwardFaceDown: 19, backFaceDown: 25 },       // xlu 1..25 / 1..32 / 1..20 / 1..26
};
export function getupRollRow(fighter: CharacterId, forward: boolean, faceDown: boolean): GroundRecoveryRow {
  const row = GETUP_ROLL_INTANGIBLE_FRAMES[fighter];
  if (!row) throw new Error(`No sourced getup-roll intangibility for ${fighter}`);
  return { duration: GETUP_ROLL_DURATION, intangibleFrames: faceDown
    ? forward ? row.forwardFaceDown : row.backFaceDown : forward ? row.forwardFaceUp : row.backFaceUp };
}
