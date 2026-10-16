/** Link's getup (face up / face down), trip and ledge attacks from data:
 * SmashWiki windows and packets (linkAttackData.json) with native capsules
 * (linkAttackGeometry.json), plus SmashWiki intangibility. */
import type { AttackMoveWithAnimation } from './moveSchema';
import { LINK_LEDGE_ATTACK_ROOT_MOTION } from './linkLedgeRootMotion';
import { LINK_ATTACK_DATA, linkMoveBounds, linkPacketKnockback, linkStrikeWindows, type LinkRecoveryData, type LinkRecoveryPhaseData } from './linkAttackData';

export type LinkRecoveryAttackId = 'link.getupAttack' | 'link.getupAttackFaceDown' | 'link.tripAttack' | 'link.ledgeAttack';
export const LINK_RECOVERY_ATTACK_IDS: readonly LinkRecoveryAttackId[] =
  Object.freeze(['link.getupAttack', 'link.getupAttackFaceDown', 'link.tripAttack', 'link.ledgeAttack']);

export function linkRecoveryAttackSource(id: LinkRecoveryAttackId): LinkRecoveryData {
  const row = LINK_ATTACK_DATA.recovery[id];
  if (!row) throw new Error(`Missing Link recovery attack ${id}`);
  return row;
}

export function linkRecoveryAttackPhase(id: LinkRecoveryAttackId, gameplayAge: number): LinkRecoveryPhaseData | null {
  return linkRecoveryAttackSource(id).phases.find(p => gameplayAge >= p.first - 1 && gameplayAge < p.last) ?? null;
}

/** Body-art clock: contact N samples native frame N; the startup before the
 * first contact is stretched linearly from native frame 0. */
export function linkRecoveryAttackNativeFrame(id: LinkRecoveryAttackId, gameplayAge: number): number {
  const first = linkRecoveryAttackSource(id).phases[0]!.first;
  return gameplayAge >= first - 1 ? gameplayAge + 1 : gameplayAge * first / Math.max(1, first - 1);
}

export function buildFreshLinkRecoveryAttack(id: LinkRecoveryAttackId): AttackMoveWithAnimation {
  const row = linkRecoveryAttackSource(id), first = row.phases[0]!, last = row.phases.at(-1)!, packet = first.packets[0]!;
  const hitWindows = row.phases.flatMap(p => linkStrikeWindows(id, p.first - 1, p.last - 1, p.role, p.role, p.packets));
  return Object.freeze({ id, sourcePoseId: id, type: 'tilt', damage: packet.damage,
    knockback: linkPacketKnockback(packet), hitbox: linkMoveBounds(hitWindows),
    startupFrames: first.first - 1, activeFrames: last.last - first.first + 1,
    recoveryFrames: Math.max(0, row.firstActionable - last.last - 1), cooldownFrames: 0,
    hitlagMultiplier: packet.hitlag, sdiMultiplier: packet.sdi, hitWindows,
    // SmashWiki intangibility (first ledge grab for the ledge attack; the actor
    // shortens it on regrabs). Replaces the generic getup startup+active immunity.
    protectionWindows: [{ startFrame: 0, endFrame: row.intangibleUntilByGrab[0]! - 1, regions: ['*'] }],
    // The ledge attack climbs onto the stage along the native root (the shared attachment in
    // Character.applyLedgeReleasePhysics); without it Link stays at the hang and falls.
    ...(id === 'link.ledgeAttack' ? { ledgeRootMotion: LINK_LEDGE_ATTACK_ROOT_MOTION } : {}),
    animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 1 },
  });
}
