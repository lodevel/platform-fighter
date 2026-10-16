/**
 * Simulation-owned compatibility facade for the installed gameplay pose data.
 * Inputs are plain semantic state and source action ages, never a renderer's
 * selected frame or visual profile. This identity is pinned independently of
 * appearance registration. Physical drawing-linked metadata remains an explicit
 * legacy dependency until portable geometry tracks replace it.
 */
import type { CharacterId } from '../../types';
import { resolveSimulationAction, type SimulationAnimationSnapshot } from '../../characters/simulationSpriteAnimation';
import * as packed from '../../characters/packedBodyPresentation';
import { getPikachuReviewedStateClock } from '../../characters/pikachuPresentation';
import { sampleHeldItemSocket, type ItemSocketAxis } from './heldItemPoseData';
import { sampleFinalBodyPose } from './finalPoseData';

export const LEGACY_GAMEPLAY_POSE_PROFILE = Object.freeze({ id: 'installed-gameplay-pose', revision: '1' });

export function resolveGameplayAction(state: SimulationAnimationSnapshot) {
  return resolveSimulationAction(state);
}

/** Capture calibration still identifies legacy source drawings internally. */
export function selectCapturePoseSource(state: SimulationAnimationSnapshot) {
  const action = resolveGameplayAction(state);
  let art = action.directArtFrame, native: number | null = null;
  let clip: ReturnType<typeof packed.selectPackedDrawing> = null;
  if (packed.packedBodyProfile(state.characterId) && action.frame !== undefined && action.sheets[0]) {
    clip = packed.selectPackedDrawing(state.characterId, action.sheets[0], action.frame);
    if (clip) { art = clip.artFrameIndex; native = clip.nativeSample; }
  } else if (state.characterId === 'pikachu' && action.reviewedSheet) {
    art = getPikachuReviewedStateClock(action.reviewedSheet, action.frame ?? 0)?.artFrameIndex;
  }
  return { action, clip, art, native };
}

export function selectHeldItemSocket(state: SimulationAnimationSnapshot, axis: ItemSocketAxis = 'y') {
  return sampleHeldItemSocket(state, axis);
}

/** `action` is the legacy authored motion identity, not a display-selected page. */
export function getPackedBodyRootDelta(characterId: CharacterId, action: string, age: number) {
  return packed.getPackedBodyRootDelta(characterId, action, age);
}
export function getPackedAttackCollisionPose(state: SimulationAnimationSnapshot) {
  return packed.getPackedAttackCollisionPose(state);
}
export function getPackedCatchCollisionPose(state: SimulationAnimationSnapshot) {
  return packed.getPackedCatchCollisionPose(state);
}
export function selectPackedHeadContact(state: SimulationAnimationSnapshot) {
  return packed.selectPackedHeadContact(state);
}
export function selectPackedBodyReceiving(state: SimulationAnimationSnapshot) {
  return packed.selectPackedBodyReceiving(state);
}
export function finalBodyPose(characterId: string, action: string, age: number, packetRole?: string) {
  return sampleFinalBodyPose(characterId, action, age, packetRole);
}
