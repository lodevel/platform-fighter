/** Source recovery attack records. Technical clocks are pinned in
 * integration/source-pages. Reviewed receiving poses share the exact body-art
 * windows; source protection is split independently of sparse drawing changes.
 */
import type { AttackMoveWithAnimation, Hurtbox } from './moveSchema';
import { pikachuSourceHits } from './pikachuSourceMoves';
import pikachuGameplay from '../../assets/characters/pikachu/gameplay.json';
import { PIKACHU_STATE_AUTHORED_HURTBOX_POSES } from './pikachuStateHurtboxes';
import { PIKACHU_LEDGE_ATTACK_ROOT_MOTION } from './pikachuLedgeRootMotion';

interface RecoveryPose {
  readonly sheet: string; readonly startElapsed: number;
  readonly endElapsed: number | null; readonly artFrameIndex: number;
  readonly hurtboxes: readonly Hurtbox[];
}

function recovery(motion: 'pikachu/DownAttackU' | 'pikachu/DownAttackD' | 'pikachu/SlipAttack' | 'pikachu/CliffAttack',
  suffix: string, total: number, protectionEnd: number): AttackMoveWithAnimation {
  const contacts = motion === 'pikachu/CliffAttack' ? [[23, 25]]
    : motion === 'pikachu/SlipAttack' ? [[18, 19], [22, 23]] : [[16, 17], [21, 22]];
  const windows = contacts.map(([first, last]) => {
    const hits = pikachuSourceHits(motion, first!);
    const xs = hits.flatMap(h => [h.capsule.start.x - h.capsule.radius, h.capsule.end.x - h.capsule.radius,
      h.capsule.start.x + h.capsule.radius, h.capsule.end.x + h.capsule.radius]);
    const ys = hits.flatMap(h => [h.capsule.start.y - h.capsule.radius, h.capsule.end.y - h.capsule.radius,
      h.capsule.start.y + h.capsule.radius, h.capsule.end.y + h.capsule.radius]);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    return { startFrame: first! - 1, endFrame: last!, group: suffix,
      collisionHits: hits, hitbox: { offsetX: (left + right) / 2, offsetY: (top + bottom) / 2,
        width: right - left, height: bottom - top } };
  });
  const first = windows[0]!, hit = first.collisionHits[0]!;
  const last = windows.at(-1)!.endFrame;
  const sheet = suffix === 'ledgeAttack' ? 'ledge_attack' : suffix === 'tripAttack' ? 'trip_attack'
    : suffix === 'getupAttackFaceDown' ? 'getup_attack_face_down' : 'getup_attack';
  const clip = pikachuGameplay.animations[sheet];
  const poses = (PIKACHU_STATE_AUTHORED_HURTBOX_POSES as readonly RecoveryPose[]).filter(p => p.sheet === sheet);
  if (!poses.length || poses[0]!.startElapsed !== 0 || poses.at(-1)!.endElapsed !== total)
    throw new Error(`Pikachu ${sheet} lacks accepted receiving covering its action`);
  const hurtboxModifiers = poses.flatMap(p => {
    const end = p.endElapsed!;
    const bounds = [p.startElapsed, ...(p.startElapsed < protectionEnd && protectionEnd < end ? [protectionEnd] : []), end];
    return bounds.slice(0, -1).flatMap((start, i) => p.hurtboxes.map((h, index) => ({
      frameWindow: { startFrame: start, endFrame: bounds[i + 1]! }, replaceBody: index === 0,
      hurtbox: { ...h, ...(start < protectionEnd ? { intangible: true } : {}) },
    })));
  });
  const startupDrawings = poses.filter(p => p.startElapsed < first.startFrame).length;
  const activeDrawings = poses.filter(p => p.startElapsed >= first.startFrame && p.startElapsed < last).length;
  return { id: `pikachu.${suffix}`, type: 'tilt', damage: hit.damage!, knockback: hit.knockback!,
    hitbox: first.hitbox, collisionHits: first.collisionHits, hitWindows: windows,
    startupFrames: first.startFrame, activeFrames: last - first.startFrame,
    recoveryFrames: total - last, cooldownFrames: 0,
    hitlagMultiplier: hit.hitlagMultiplier, sdiMultiplier: hit.sdiMultiplier,
    tripChance: hit.tripChance, setoff: hit.setoff,
    hurtboxModifiers,
    ...(suffix === 'ledgeAttack' ? { ledgeRootMotion: PIKACHU_LEDGE_ATTACK_ROOT_MOTION } : {}),
    animation: { startupFrames: startupDrawings, activeFrames: activeDrawings,
      recoveryFrames: clip.frameCount - startupDrawings - activeDrawings,
      frameWindows: poses.map(p => ({ startFrame: p.startElapsed, endFrame: p.endElapsed!, artFrameIndex: p.artFrameIndex })) },
  };
}
export const PIKACHU_GETUP_ATTACK = recovery('pikachu/DownAttackU', 'getupAttack', 45, 22);
export const PIKACHU_GETUP_ATTACK_FACE_DOWN = recovery('pikachu/DownAttackD', 'getupAttackFaceDown', 45, 22);
export const PIKACHU_TRIP_ATTACK = recovery('pikachu/SlipAttack', 'tripAttack', 49, 7);
/** First-grab interval. Character caps this sourced25-frame capsule against
 * the latched published25/20/12/0 subsequent-grab lifecycle budget. */
export const PIKACHU_LEDGE_ATTACK = recovery('pikachu/CliffAttack', 'ledgeAttack', 55, 25);
