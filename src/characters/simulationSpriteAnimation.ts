// Internal legacy sampling stays below the public gameplay-pose facade.
import { sampleFinalBodyPose as finalBodyPose } from '../characterPresentation/legacy/finalPoseData';
import { itemChargeClip, itemMotionClip } from '../items/itemMotionClips';
import pikachuChargePoses from '../../assets/characters/pikachu/pose-batches/smash-charges.json';
import pikachuReviewedFrames from '../../assets/characters/pikachu/frames.json';
import pikachuFinalVisual from '../../assets/characters/pikachu/final-visual-frames.json';
import type { Character } from './Character';
import type { CharacterId } from '../types';
import type { ActiveAttack } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import { computeAttackPhase, selectAnimationFrame } from './moveSchema';
import { attackHitWindowIndex } from './attackHitWindows';
import { ledgeHangPresentationClock } from './ledgeHangState';
import { resolvePikachuSpecialBodyClock } from './pikachuSpecialPresentation';
import { getPikachuReviewedStateClock } from './pikachuPresentation';
import { getPikachuGroundJumpLaunchPose } from './pikachuGroundJumpPresentation';
import { DIRECTIONAL_AIR_DODGE_ACTION, directionalDodgeDrawing } from './pikachuDirectionalDodge';
import { pikachuCrouchCrawlDrawing } from './pikachuCrouchCrawl';
import {selectPikachuSurfaceTechBody} from './pikachuSurfaceTech';
import { selectPikachuAuxiliaryBody } from './pikachuAuxiliaryBody';
import { resolvePackedBodyPose,installedPackedSheet,getPackedNativeTimedClip,selectPackedNativeSampleFrame,excludeCompleteStandingGrabFromNonstandingFallback } from './packedBodyPresentation';
import { createArtFrameSelector } from './artFrameSelector';
import type { ActionDisplay } from '../characterPresentation/contracts';
import { attackMoveToSheets, classifySpriteAnimationState } from './spriteAnimationDriver';

/** Read-only presentation data. The simulation remains the only action clock. */
export function captureSimulationAnimation(character: Character, frame: number, frozen: boolean) {
  const velocity = character.getVelocity();
  return {
    ...character.getAnimationSnapshot(),
    ...character.getAnimationActionState(),
    finalVictimSelection:character.getFinalVictimPresentationSelection(),
    finalVictimPose:character.getFinalVictimBodyPose(),
    grabReleasePresentation: character.getGrabReleasePresentationState(),
    frame, frozen,
    // The revival platform (SmashWiki Revival platform) is a floor the revived fighter stands on.
    grounded: character.isGrounded() || character.isOnRevivalPlatform(),
    velocityX: velocity.x, velocityY: velocity.y,
    crouching: character.isCrouching(),
    jumpsquatRemaining: character.getJumpsquatRemaining(),
    grabbed: character.isGrabbed(),
    grab: character.getGrabState(),
    grabSpec: character.getGrabSpec(),
    locomotion: character.getLocomotionState(),
    jumpPresentation: character.getJumpPresentationState(),
    throwPresentation: character.getThrowPresentationState(),
    landingPresentation: character.getLandingPresentationState(),
    grabPresentation: character.getGrabPresentationState(),
    ordinaryPresentation: character.getOrdinaryPresentationState(),
    clankPresentation: character.getAttackClankPresentationState(),
    crouchPresentation: character.getCrouchPresentationState(),
    turnBrakePresentation: character.getPikachuTurnBrakePresentationState(),
    groundRecoveryPresentation: character.getPikachuGroundRecoveryPresentationState(),
    auxiliaryAirPresentation: character.getPikachuAuxiliaryAirPresentationState(),
    footstoolRecipientPresentation: character.getFootstoolRecipientPresentationState(),
    respawnPresentation: character.getPikachuRespawnPresentationState(),
    itemPresentation: character.getPikachuItemPresentationState(),
    itemShooting: character.getItemShootingPresentation(),
    ledgeJumpPresentation: character.getPikachuLedgeJumpPresentationState(),
    surfaceTechPresentation: character.getPikachuSurfaceTechPresentationState(),
    reactionPresentation: character.getReactionPresentationState(),
    shieldPresentation: character.getShieldPresentationState(),
    capturePresentation: character.getCapturePresentationState(),
    tauntPresentation: character.getTauntPresentationState(),
    jumpsUsed: character.getJumpsUsed(),
    helpless: character.isHelpless(),
    shieldReleaseRemaining: character.getShieldReleaseRemaining(),
    shieldStunRemaining: character.getShieldStunRemaining(),
    shieldParrying: character.isShieldParrying(),
    ledgeCatchFrames: character.getTuning().ledge.catchFrames ?? 0,
    ledgeCatchMotionRates: character.getTuning().ledge.catchMotionRatesByGrab ?? [],
    packedBody: character.getPackedBodyState(),
    buriedPresentation:character.getBuriedPresentationState(),
  };
}

export type SimulationAnimationSnapshot = ReturnType<typeof captureSimulationAnimation>;
type Phase = 'startup' | 'active' | 'recovery';
export interface ActionPose {
  readonly state: string;
  /** Ordinary accepted strips use their explicit metadata clock windows. */
  readonly reviewedSheet?: string;
  /** Packed strip drawn from its `nativeSampleIndices` / `actionFrameStarts` on the action age (`frame`). */
  readonly nativeTimedSheet?: string;
  /** The packed-body fighter whose clip `nativeTimedSheet` names (packedBodyPresentation.ts). */
  readonly nativeTimedFighter?: CharacterId;
  /** Nothing is drawn (a packed fighter's state with no installed clip: no fallback pose). */
  readonly invisible?: true;
  /** Already resolved source drawing; bypasses neutral-resource retiming. */
  readonly directArtFrame?: number;
  readonly auxiliarySheet?: string;
  readonly sheets: ReadonlyArray<string>;
  readonly frame?: number;
  readonly duration?: number;
  readonly phase?: Phase;
  readonly move?: AttackMoveWithAnimation;
  readonly hold?: 'first' | 'last';
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly facing?: 1 | -1;
  /** Upper-body layer drawn over this (legs) pose above the fighter's waist line: shooting while walking / jump squat /
   * landing composes the native `_upper` motion over `item_shoot_legs_*` (Ultimate shooting items). */
  readonly overlay?: ActionPose;
  /** The package action and tick shown, when they are not the drawn sheet on this pose's clock (Finals, the directional
   * air dodge, Pikachu's specials and smash charges whose `frame` holds the drawing). */
  readonly display?: Pick<ActionDisplay, 'action' | 'tick' | 'rotation'>;
}

function attackPose(active: Pick<ActiveAttack, 'move' | 'framesElapsed'> & Partial<Pick<ActiveAttack, 'facing'>>): ActionPose {
  return {
    state: active.move.id,
    sheets: [...attackMoveToSheets(active.move), 'attack', 'idle'],
    frame: active.framesElapsed,
    move: active.move,
    ...(active.facing === undefined ? {} : { facing: selectSimulationAttackFacing(active.move, active.framesElapsed, active.facing) }),
  };
}

/** Presentation follows the preceding release or upcoming windup even in a harmless gap. */
export function selectSimulationAttackFacing(move: AttackMoveWithAnimation, elapsed: number, facing: 1 | -1): 1 | -1 {
  const strike = move.hitWindows?.length ? windowAnimationPhase(move, elapsed) : null;
  return (facing * (strike ? move.hitWindows![strike.windowIndex]?.facing ?? 1 : 1)) as 1 | -1;
}

interface ReviewedPikachuStateClip {
  readonly frameCount: number;
  readonly frameWindows?: ReadonlyArray<{ startFrame: number; endFrame: number | null; artFrameIndex: number }>;
  readonly loopDuration?: number | null;
}
const reviewedPikachuClips = pikachuReviewedFrames.animations as Record<string, ReviewedPikachuStateClip>;

/** Unavailable state art never becomes an accepted alias. Its existing fallback
 * remains visible until the independently reviewed strip and receiving arrive. */
function reviewedStatePose(sheet: string, localFrame?: number, facing?: 1 | -1): ActionPose | null {
  const clip = reviewedPikachuClips[sheet];
  return clip?.frameWindows?.length ? { state: sheet, sheets: [sheet], reviewedSheet: sheet,
    ...(localFrame === undefined ? {} : { frame: localFrame }),
    ...(facing === undefined ? {} : { facing }) } : null;
}
function reviewedStateFrame(sheet: string, elapsed: number, count: number): number {
  const clock = getPikachuReviewedStateClock(sheet, elapsed);
  if (!clock || clock.frameCount !== count)
    throw new Error(`Reviewed Pikachu ${sheet} needs a matching strip and fixed-step clock`);
  return clock.artFrameIndex;
}

/** Semantic precedence prevents running/attacking poses during defensive locks. */
export function resolveSimulationAction(s: SimulationAnimationSnapshot): ActionPose {
  if (s.destroyed) return { state: 'idle', sheets: ['idle'], hold: 'first' };
  if(s.finalVictimSelection){const drawing=s.finalVictimPose,selection=s.finalVictimSelection;return drawing?{state:selection.profileKey,sheets:[drawing.sheet],
    frame:selection.authoredAge,facing:selection.facing,directArtFrame:drawing.index,display:{action:selection.profileKey,tick:selection.authoredAge}}:
    {state:'final-victim.missing-authored-profile',sheets:[]};}
  if (s.finalSmash?.sheet) {
    const drawing = finalBodyPose(s.characterId, s.finalSmash.sheet, s.finalSmash.age);
    if (!drawing && s.characterId === 'link') {
      const sheet = installedPackedSheet('link', s.finalSmash.sheet);
      if (getPackedNativeTimedClip('link', sheet)) {
        // Link Final's source status clock starts at raw sample 0 (unlike
        // ordinary one-based callback labels). Packed selection also takes
        // zero-based age, adding 1 only when matching the stored labels.
        const rawAge = s.finalSmash.age;
        return { state: s.finalSmash.sheet, sheets: [sheet], frame: rawAge, facing: s.finalSmash.facing,
          directArtFrame: selectPackedNativeSampleFrame('link', sheet, rawAge) };
      }
    }
    // Pikachu's owner shows its Final display clip of the same name whatever the drawing below (port/src/fighters/finalVisual.ts).
    const visual = s.characterId === 'pikachu' && s.finalSmash.role === 'owner' && Object.hasOwn(pikachuFinalVisual.clips, s.finalSmash.sheet);
    const rotation = drawing && s.finalSmash.rotationDegrees ? s.finalSmash.rotationDegrees * Math.PI / 180 : 0;
    return { state: s.finalSmash.sheet, sheets: [drawing?.sheet??s.finalSmash.sheet], frame: s.finalSmash.age,
      facing: s.finalSmash.facing, ...(drawing ? { directArtFrame: drawing.index } : {}),
      ...(drawing || visual ? { display: { action: s.finalSmash.sheet, tick: s.finalSmash.age, ...(rotation ? { rotation } : {}) } } : {}) };
  } 
  const packed = resolvePackedBodyPose(s);
  if (packed) return packed;
  if (s.characterId === 'pikachu' && s.grabReleasePresentation) {
    const release = s.grabReleasePresentation;
    const pose = reviewedStatePose(release.role === 'target' ? 'captured_release' : 'grab_escape',
      release.framesElapsed, release.facing);
    if (pose) return pose;
  }
  if (s.characterId === 'pikachu' && s.shieldPresentation?.kind === 'broken') {
    const shield = s.shieldPresentation;
    // Existing beta broken lock owns the total. Source recovery cancel34
    // divides its final34 steps; native flight/dizzy/mash algorithms remain
    // separate. No render-time counter or delayed ordinary action is added.
    const recoveryStart = Math.max(0, (shield.totalFrames ?? 180) - 34);
    const recovering = shield.framesElapsed >= recoveryStart;
    const pose = reviewedStatePose(recovering ? 'shield_break_end' : 'shield_break',
      recovering ? shield.framesElapsed - recoveryStart : shield.framesElapsed, shield.facing);
    if (pose) return pose;
  }
  if (s.characterId === 'pikachu' && s.grabbed && s.capturePresentation?.active) {
    // The shared hook observes actual captive entry age; choosing the reviewed
    // high hold resource is an explicit beta default, not a native hi/low
    // selector. Damage/release event history is not an action commitment.
    const capture = s.capturePresentation;
    const damage = capture.event.kind === 'damage' && capture.event.framesElapsed < 20;
    const pose = reviewedStatePose(damage ? 'captured_hit' : 'captured',
      damage ? capture.event.framesElapsed : capture.framesElapsed, capture.facing);
    if (pose) return pose;
  }
  if (s.characterId==='pikachu' && s.surfaceTechPresentation && !s.grabbed) {
    const tech=s.surfaceTechPresentation,pose=selectPikachuSurfaceTechBody(tech);
    if(!pose)throw new Error('Pikachu surface tech lacks source body/receiving');
    return {state:tech.sheet,sheets:[tech.sheet],auxiliarySheet:tech.sheet,directArtFrame:pose.artFrameIndex,
      frame:tech.framesElapsed,facing:tech.facing};
  }
  if (s.characterId === 'pikachu' && s.ledgeJumpPresentation && !s.grabbed) {
    const jump=s.ledgeJumpPresentation,sheet=jump.phase==='start'?'ledge_jump_start':'ledge_jump';
    const pose=selectPikachuAuxiliaryBody(sheet,jump.framesElapsed);
    if(!pose)throw new Error('Pikachu ledge jump lacks its accepted source body');
    return {state:sheet,sheets:[sheet],auxiliarySheet:sheet,directArtFrame:pose.artFrameIndex,frame:jump.framesElapsed,facing:jump.facing};
  }
  if (s.characterId === 'pikachu' && s.respawnPresentation && !s.grabbed) {
    const entry=s.respawnPresentation,pose=selectPikachuAuxiliaryBody('entry',entry.framesElapsed);
    if (!pose) throw new Error('Pikachu respawn cue lacks its accepted Entry body');
    return {state:'respawn.entry-cue',sheets:['entry'],auxiliarySheet:'entry',
      directArtFrame:pose.artFrameIndex,frame:entry.framesElapsed,facing:entry.facing};
  }
  if (s.characterId === 'pikachu' && s.footstoolRecipientPresentation && !s.grabbed) {
    const recovery=s.footstoolRecipientPresentation;
    const sheet=recovery.grounded ? 'footstool_pose'
      : recovery.framesElapsed<8 ? 'footstool_air_pose' : 'footstool_fall';
    const age=recovery.grounded || recovery.framesElapsed<8 ? recovery.framesElapsed : (recovery.framesElapsed-8)%16;
    const pose=selectPikachuAuxiliaryBody(sheet,age);
    if (!pose) throw new Error('Pikachu footstool recipient lacks its accepted source body');
    return {state:sheet,sheets:[sheet],auxiliarySheet:sheet,directArtFrame:pose.artFrameIndex,
      frame:age,facing:recovery.facing};
  }
  if (s.characterId === 'pikachu' && s.auxiliaryAirPresentation && !s.grabbed) {
    const flight=s.auxiliaryAirPresentation, pose=selectPikachuAuxiliaryBody(flight.sheet,flight.framesElapsed);
    if (!pose) throw new Error('Pikachu auxiliary flight lacks its source body');
    return {state:flight.sheet,sheets:[flight.sheet],auxiliarySheet:flight.sheet,
      directArtFrame:pose.artFrameIndex,frame:flight.framesElapsed,facing:flight.facing};
  }
  if (s.characterId === 'pikachu' && s.groundRecoveryPresentation && !s.grabbed) {
    const recovery = s.groundRecoveryPresentation;
    const pose = selectPikachuAuxiliaryBody(recovery.sheet, recovery.framesElapsed);
    if (!pose) throw new Error('Pikachu ground recovery lacks its accepted source drawing');
    return {state: recovery.sheet, sheets: [recovery.sheet], auxiliarySheet: recovery.sheet,
      directArtFrame: pose.artFrameIndex, frame: recovery.framesElapsed, facing: recovery.facing};
  }
  if (s.characterId === 'pikachu' && s.itemShooting && !s.grabbed) {
    // A shooting item: the phase's native motion, or its upper-body layer over the shooting legs.
    const shot = s.itemShooting, base = reviewedStatePose(shot.sheet, shot.age, shot.facing);
    const overlay = shot.upper && reviewedStatePose(shot.upper.sheet, shot.upper.age, shot.facing);
    if (base) return { ...base, state: `shoot.${shot.sheet}`, ...(overlay ? { overlay } : {}) };
  }
  if (s.characterId === 'pikachu' && s.itemPresentation && !s.grabbed) {
    const item=s.itemPresentation;
    return {state:item.sheet,sheets:[item.sheet],auxiliarySheet:item.sheet,
      directArtFrame:item.artFrameIndex,frame:item.nativeAge,facing:item.facing};
  }
  if (s.characterId === 'pikachu' && s.reactionPresentation && !s.grabbed && s.shield.name !== 'broken') {
    const reaction = s.reactionPresentation;
    // These observed identities select explicitly authored beta resources.
    // Native reaction selectors/rates and stand/tech/roll cues remain separate.
    const sheet = reaction.kind === 'trip' ? 'trip' : reaction.kind === 'tumble' ? 'tumble'
      : reaction.kind === 'damage' ? s.grounded ? 'hurt' : 'hurt_air'
      : reaction.kind === 'prone' ? reaction.origin === 'face-up' ? 'down_wait'
        : reaction.origin === 'face-down' ? 'down_wait_face_down' : null : null;
    const pose = sheet && reviewedStatePose(sheet, reaction.framesElapsed, reaction.facing);
    if (pose) return pose;
  }
  // A damage reaction starts on the hit step: hitlag only queues the hitstun (hitstunRemaining is still 0).
  if (s.hitstunRemaining > 0 || s.reactionPresentation?.kind === 'damage' || s.grabbed || s.shield.name === 'broken') {
    return { state: 'hurt', sheets: ['hurt', 'idle'], hold: 'first' };
  }
  if (s.clankPresentation?.interruptedAttack) {
    // Source contact happens before presentation updates. Use the captured
    // collision frame, not the preceding rendered startup. Native rebound
    // body art is still missing; holding this contact pose is an explicit beta.
    return { ...attackPose(s.clankPresentation.interruptedAttack),
      state: `clank.${s.clankPresentation.phase}` };
  }
  if (s.characterId === 'pikachu' && s.tauntPresentation) {
    const taunt = s.tauntPresentation;
    const pose = reviewedStatePose(`taunt_${taunt.kind}`, taunt.framesElapsed, taunt.facing);
    if (pose) return pose;
  }
  if (s.ledgeHang.name === 'hanging') {
    if (s.characterId === 'pikachu' && s.ledgeHang.active) {
      const clock = ledgeHangPresentationClock(s.ledgeHang.active.framesElapsed, s.ledgeHang.ledgeGrabsSinceGround,
        s.ledgeCatchFrames, s.ledgeCatchMotionRates);
      const pose = reviewedStatePose(clock.sheet, clock.age, s.ledgeHang.active.facing);
      if (pose) return pose;
    }
    return { state: 'ledge', sheets: ['jump', 'idle'], hold: 'last' };
  }
  if (s.ledgeHang.name === 'climbing' || s.ledgeHang.name === 'rolling') {
    if (s.characterId === 'pikachu' && s.ledgeHang.active) {
      const sheet = s.ledgeHang.name === 'climbing' ? 'ledge_getup' : 'ledge_roll';
      const pose = reviewedStatePose(sheet, s.ledgeHang.active.framesElapsed, s.ledgeHang.active.facing);
      if (pose) return pose;
    }
    return { state: s.ledgeHang.name, sheets: ['jump', 'idle'], hold: 'last' };
  }
  if (s.dodge.name === 'active' || s.dodge.name === 'recovery') {
    if (s.characterId === 'pikachu' && s.dodge.active) {
      const active = s.dodge.active;
      if (active.kind === 'air' && active.directional) {
        const drawing = directionalDodgeDrawing(active.framesElapsed, active.framesElapsed + 1);
        if (drawing) return { state: 'dodge.directional-air', sheets: [drawing.sheet],
          directArtFrame: drawing.artFrameIndex, frame: active.framesElapsed, facing: active.facing,
          display: { action: DIRECTIONAL_AIR_DODGE_ACTION, tick: active.framesElapsed } };
      }
      const sheet = active.kind === 'spot' ? 'spot_dodge' : active.kind === 'roll'
        ? active.backward ? 'roll_back' : 'roll' : !active.directional ? 'air_dodge' : null;
      // Forward-roll drawings bake the turn; backward drawings retain entry
      // orientation. Active backward facing is travel direction, not body basis.
      const basis = (active.facing * (active.backward ? -1 : 1)) as 1 | -1;
      const pose = sheet && reviewedStatePose(sheet, active.framesElapsed, basis);
      if (pose) return pose;
    }
    return { state: `dodge.${s.dodge.active?.kind}`, sheets: ['shield', 'crouch', 'idle'], hold: 'last', scaleY: 0.85 };
  }
  if (s.characterId === 'pikachu' && s.shieldPresentation) {
    const shield = s.shieldPresentation;
    const sheet = shield.kind === 'release' ? 'shield_end' : shield.kind === 'block' ? 'shield_hit'
      : shield.kind === 'parry' ? 'parry' : null;
    const pose = sheet && reviewedStatePose(sheet, shield.framesElapsed, shield.facing);
    if (pose) return pose;
    // Neutral hold continues to use native pose0 below. Native startup,
    // airborne break→dizzy and recovery transitions are still unbound.
  }
  if (s.shield.name === 'active') {
    const pose = s.characterId === 'pikachu' && reviewedStatePose('shield', 0);
    if (pose) return pose;
    return { state: 'shield', sheets: ['shield', 'idle'], hold: 'last' };
  }
  if (s.activeAttack) {
    if (s.characterId === 'pikachu' && s.pikachuSpecial) {
      const clock = resolvePikachuSpecialBodyClock(s.pikachuSpecial);
      const { sheet } = clock;
      // Skull's held action age can reach80; its native body loops every6.
      // Keep the renderer on the same accepted native clock as receiving.
      const local = clock.phase === 'hold' ? clock.nativeFrame : clock.localFrame;
      const clip = (pikachuReviewedFrames.animations as Record<string, {
        frameCount: number; frameWindows?: Array<{ startFrame: number; endFrame: number | null; artFrameIndex: number }>;
      }>)[sheet];
      if (clip) {
        if (!clip.frameWindows) throw new Error(`Reviewed Pikachu ${sheet} needs explicit drawing windows`);
        const pose = clip.frameWindows.find(window => window.startFrame <= local && (window.endFrame === null || local < window.endFrame));
        if (!pose) throw new Error(`Missing reviewed Pikachu ${sheet} drawing at source frame${local}`);
        // `frame` holds the drawing (receiving and capture read this pose); the package shows the clip at `local`.
        return { state: `special.${sheet}`, sheets: [sheet], frame: pose.artFrameIndex, duration: clip.frameCount,
          display: { action: sheet, tick: local } };
      }
      return { state: `special.missing.${sheet}`, sheets: ['idle'], hold: 'first' };
    }
    // A held-item use plays its native item motion on the action clock.
    const item = s.characterId === 'pikachu' && s.activeAttack.move.itemClip
      && reviewedStatePose(itemMotionClip(s.activeAttack.move.itemClip), s.activeAttack.framesElapsed, s.activeAttack.facing);
    if (item) return item;
    return attackPose(s.activeAttack);
  }
  if (s.chargingMove) {
    const itemClip = s.characterId === 'pikachu' ? s.chargingMove.itemClip : undefined;
    if (itemClip) {
      // A held-item smash winds up on its swing motion, then holds on the swing's native charge loop.
      const startup = s.chargeStartupElapsed !== undefined
        && s.chargeStartupElapsed < ((s.chargingMove as AttackMoveWithAnimation).chargeStartFrame ?? 0);
      const pose = startup ? reviewedStatePose(itemMotionClip(itemClip), s.chargeStartupElapsed, s.facing)
        : reviewedStatePose(itemChargeClip(itemClip), s.chargeHeldFrames, s.facing);
      if (pose) return { ...pose, state: `charge.${s.chargingMove.id}` };
    }
    const pause = (s.chargingMove as AttackMoveWithAnimation).chargeStartFrame;
    const paused = pause !== undefined && (s.chargeStartupElapsed ?? 0) >= pause;
    if (s.characterId === 'pikachu' && paused && s.chargingMove.type === 'smash') {
      const base = attackMoveToSheets(s.chargingMove)[0]!;
      const sheet = `${base}_charge` as keyof typeof pikachuChargePoses.animations;
      const authored = pikachuChargePoses.animations[sheet];
      if (authored) {
        const local = Math.min(60, s.chargeHeldFrames);
        const art = authored.frameWindows.find(window => window.startFrame <= local && (window.endFrame === null || local < window.endFrame));
        return { state: `charge.${s.chargingMove.id}`, sheets: [sheet], frame: art?.artFrameIndex ?? 0,
          duration: authored.frameCount, display: { action: sheet, tick: local } };
      }
    }
    // Source-timed charge startup advances to the simulation's pause frame.
    // Legacy charge moves without this clock retain their anticipation pose.
    return { ...attackPose({ move: s.chargingMove, framesElapsed: s.chargeStartupElapsed
      ?? Math.max(0, s.chargingMove.startupFrames - 1) }), state: `charge.${s.chargingMove.id}` };
  }
  if (s.characterId === 'pikachu' && s.throwPresentation) {
    const presentation = s.throwPresentation;
    const sheet = { forward: 'fthrow', back: 'bthrow', up: 'uthrow', down: 'dthrow' }[presentation.direction];
    // Native bthrow settles RIGHT in its acquisition basis. Use actual actor
    // facing for beta art; release HIT facing reverses the launch independently
    // and is not evidence of an actor turn or a native LR-change boundary.
    const pose = reviewedStatePose(sheet, presentation.framesElapsed,
      presentation.direction === 'back' ? s.facing : presentation.facing);
    if (pose) return pose;
  }
  const grab = s.grab.active;
  const spec = s.grabSpec;
  if (grab && spec) {
    if (s.grab.name === 'holding') {
      if (grab.pummelCooldownRemaining > 0 && spec.pummel) {
        if (s.characterId === 'pikachu') {
          // Character installs five motion steps after the independent eleven
          // impact-freeze steps. The full16 commitment is not native pose age.
          const duration = spec.pummel.cooldownFrames - (spec.pummel.hitlagFrames ?? 0);
          const local = duration - grab.pummelCooldownRemaining;
          const pose = reviewedStatePose('pummel', local);
          if (pose) return pose;
          return { state: 'pummel', sheets: ['pummel', 'grab', 'idle'], frame: local, duration };
        }
        return { state: 'pummel', sheets: ['pummel', 'grab', 'attack', 'idle'], frame: spec.pummel.cooldownFrames - grab.pummelCooldownRemaining, duration: Math.max(1, spec.pummel.cooldownFrames) };
      }
      const pose = s.characterId === 'pikachu' && reviewedStatePose(grab.framesElapsed < 20 ? 'grab_pull' : 'grab_hold', grab.framesElapsed);
      if (pose) return pose;
      return { state: 'holding', sheets: ['grab', 'idle'], hold: 'last' };
    }
    if (s.grab.name === 'throwing' && grab.throwDirection) {
      const sheet = { forward: 'fthrow', back: 'bthrow', up: 'uthrow', down: 'dthrow' }[grab.throwDirection];
      return { state: sheet, sheets: [sheet, 'grab', 'attack', 'idle'], frame: grab.framesElapsed, duration: spec.throws[grab.throwDirection].animationFrames };
    }
    if (s.characterId === 'pikachu' && s.grabPresentation &&
      ['whiffStartup', 'whiffActive', 'whiffRecovery'].includes(s.grab.name)) {
      const presentation = s.grabPresentation;
      const sheet = presentation.variant === 'dash' ? 'dash_grab' : presentation.variant === 'pivot' ? 'pivot_grab' : 'grab';
      // CatchTurn native0 retains the original camera basis and native10+
      // reaches/settles LEFT. The shared pivot flips the actor on entry;
      // retain the preceding basis for the entire baked drawing/receiving.
      const drawingFacing = presentation.variant === 'pivot' ? -presentation.facing : presentation.facing;
      const pose = reviewedStatePose(sheet, presentation.framesElapsed, drawingFacing as 1 | -1);
      if (pose) return pose;
    }
    const phase = s.grab.name === 'whiffStartup' ? 'startup' : s.grab.name === 'whiffActive' ? 'active' : 'recovery';
    if (s.grab.name !== 'cooldown') {
      return { state: 'grab', sheets: excludeCompleteStandingGrabFromNonstandingFallback(s)
        ? ['review_legacy_grab','attack','idle'] : ['grab', 'attack', 'idle'], phase, frame: grab.framesElapsed,
        duration: phase === 'startup' ? spec.startupFrames : phase === 'active' ? spec.activeFrames : spec.whiffRecoveryFrames };
    }
  }
  if (s.characterId === 'pikachu' && s.jumpsquatRemaining > 0) {
    const pose = reviewedStatePose('jumpsquat', 3 - s.jumpsquatRemaining);
    if (pose) return pose;
  }
  if (s.jumpsquatRemaining > 0) return { state: 'jumpsquat', sheets: ['crouch', 'idle'], hold: 'last', scaleX: 1.05, scaleY: 0.88 };
  if (s.characterId === 'pikachu' && s.landingPresentation) {
    const presentation = s.landingPresentation;
    if (presentation.kind === 'air-dodge' || presentation.kind === 'directional-air-dodge') {
      // Retain the existing beta final crouch drawing with its accepted
      // receiving geometry. A generic scaled fallback had lost all12caps.
      const pose = reviewedStatePose('crouch', 59);
      if (pose) return { ...pose, state: 'landing.air-dodge' };
    }
    const sheet = presentation.kind === 'soft' ? 'landing_soft' : presentation.kind === 'hard' ? 'landing_hard'
      : presentation.kind === 'special' ? 'landing_special' : null;
    const pose = sheet && reviewedStatePose(sheet, presentation.framesElapsed);
    if (pose) return pose;
  }
  if (s.landingRecoveryRemaining > 0) return { state: 'landing', sheets: ['crouch', 'idle'], hold: 'last', scaleY: 0.92 };
  if (s.characterId === 'pikachu' && s.turnBrakePresentation) {
    const turn = s.turnBrakePresentation;
    const pose = reviewedStatePose(turn.sheet, turn.framesElapsed, turn.facing);
    if (pose) return pose;
  }
  if (s.characterId === 'pikachu' && s.crouchPresentation) {
    const drawing = pikachuCrouchCrawlDrawing(s.crouchPresentation);
    const pose = drawing && reviewedStatePose(drawing.sheet, drawing.localFrame, drawing.facing);
    if (pose) return pose;
  }
  if (s.crouching && s.characterId === 'pikachu') {
    const pose = reviewedStatePose('crouch', s.crouchPresentation?.framesElapsed ?? s.locomotion.framesElapsed,
      s.crouchPresentation?.facing);
    if (pose) return pose;
  }
  if (s.crouching) return { state: 'crouch', sheets: ['crouch', 'idle'], hold: 'last' };
  if (s.characterId === 'pikachu') {
    let pose: ActionPose | null = null;
    if (!s.grounded && s.helpless) pose = reviewedStatePose('fall_special',
      s.ordinaryPresentation?.sheet === 'fall_special' ? s.ordinaryPresentation.framesElapsed : undefined);
    else if (!s.grounded && (s.velocityY > 0 || s.ordinaryPresentation?.sheet === 'fall')) pose = reviewedStatePose('fall',
      s.ordinaryPresentation?.sheet === 'fall' ? s.ordinaryPresentation.framesElapsed : undefined);
    else if (!s.grounded && s.jumpPresentation?.kind === 'air') {
      const jump = s.jumpPresentation;
      // Explicit beta contextual choice using the latched jump-entry controls.
      // Later drift must not swap resources. Native common motion selector
      // parity remains separate from this authored forward/backward route.
      const sheet = jump.moveX * jump.facing < 0 ? 'airjump_back' : 'airjump';
      pose = reviewedStatePose(sheet, jump.framesElapsed, jump.facing);
    }
    else if (!s.grounded && s.jumpPresentation?.kind === 'ground') {
      const jump = s.jumpPresentation;
      const backward = jump.moveX * jump.facing < 0;
      const launch = getPikachuGroundJumpLaunchPose(jump.framesElapsed, jump.shortHop, backward);
      pose = launch ? reviewedStatePose(launch.sheet, launch.localFrame, jump.facing)
        : reviewedStatePose(backward ? 'jump_back' : 'jump', jump.framesElapsed, jump.facing);
    }
    else if (s.grounded && s.locomotion.name === 'initialDash') pose = reviewedStatePose('dash', s.locomotion.framesElapsed);
    else if (s.grounded && s.locomotion.name === 'run') pose = reviewedStatePose('run', s.locomotion.framesElapsed);
    else if (s.grounded && s.locomotion.name === 'walk') pose = reviewedStatePose('walk',
      s.ordinaryPresentation?.sheet === 'walk' ? s.ordinaryPresentation.framesElapsed : s.locomotion.framesElapsed);
    // Shared pivot flips actor facing on entry. Whole baked turn uses the
    // preceding body basis; exact native LR-change remains a source gap.
    else if (s.grounded && s.locomotion.name === 'pivot') pose = reviewedStatePose('run_turn', s.locomotion.framesElapsed, (-s.locomotion.facing) as 1 | -1);
    else if (s.grounded && s.locomotion.name === 'standing' && s.ordinaryPresentation?.sheet === 'idle')
      pose = reviewedStatePose('idle', s.ordinaryPresentation.framesElapsed, s.ordinaryPresentation.facing);
    if (pose) return pose;
  }
  const state = classifySpriteAnimationState({ ...s, isAttacking: false });
  if (s.characterId === 'pikachu' && s.grounded && (state === 'idle' || state === 'run')) {
    // First solver contact suppresses the ordinary clock until next input.
    // Keep the existing classifier's idle0/run0 drawing (including residual
    // X), paired with source receiving and Have, without advancing a clock.
    const pose = reviewedStatePose(state, 0, s.facing);
    if (pose) return pose;
  }
  return { state, sheets: [state === 'fall' ? 'jump' : state, 'idle'], ...(state === 'fall' ? { hold: 'last' as const } : {}) };
}

/** Loaded strips often contain fewer frames than the symbolic move-animation data.
 * Keep each gameplay phase in its own art region instead of letting a fixed-FPS
 * clip finish before the hitbox, or remain in windup after contact.
 */
export function selectSimulationAttackFrame(move: AttackMoveWithAnimation, elapsed: number, count: number, sheet = 'attack'): number {
  const windows = move.animation?.frameWindows;
  if (windows) {
    const authoredCount = move.animation!.startupFrames + move.animation!.activeFrames + move.animation!.recoveryFrames;
    if (!Number.isInteger(elapsed) || elapsed < 0 || count !== authoredCount)
      throw new Error('Explicit attack drawing timeline requires an integer clock and matching loaded strip');
    const window = windows.find(window => elapsed >= window.startFrame && elapsed < window.endFrame);
    if (window) return window.artFrameIndex;
    if (elapsed >= move.startupFrames + move.activeFrames + move.recoveryFrames) return count - 1;
    throw new Error('Missing explicit attack drawing window');
  }
  if (count <= 1) return 0;
  const phase = computeAttackPhase(elapsed, move);
  if (phase === 'done') return count - 1;
  if (move.hitWindows?.length) {
    const timing = windowAnimationPhase(move, elapsed);
    const authored = move.animation;
    if (authored && authored.startupFrames + authored.activeFrames + authored.recoveryFrames === count) {
      const length = timing.phase === 'startup' ? authored.startupFrames
        : timing.phase === 'active' ? authored.activeFrames : authored.recoveryFrames;
      if (length > 0) {
        const offset = timing.phase === 'startup' ? 0
          : timing.phase === 'active' ? authored.startupFrames : authored.startupFrames + authored.activeFrames;
        return offset + Math.min(length - 1, Math.floor(timing.elapsed * length / Math.max(1, timing.duration)));
      }
    }
    return selectPhaseFrame(timing.phase, timing.elapsed, timing.duration, count, sheet);
  }
  const authored = move.animation;
  if (authored && authored.startupFrames + authored.activeFrames + authored.recoveryFrames === count) {
    const selection = selectAnimationFrame(elapsed, move);
    const offset = phase === 'startup' ? 0 : phase === 'active' ? authored.startupFrames : authored.startupFrames + authored.activeFrames;
    return Math.min(count - 1, offset + selection.artFrameIndex);
  }
  const length = phase === 'startup' ? move.startupFrames : phase === 'active' ? move.activeFrames : move.recoveryFrames;
  const within = elapsed - (phase === 'startup' ? 0 : phase === 'active' ? move.startupFrames : move.startupFrames + move.activeFrames);
  return selectPhaseFrame(phase, within, length, count, sheet);
}

/** Separate swings reuse the existing release/windup art in the harmless gap.
 * Adjacent early/late windows form one continuous contact interval. */
function windowAnimationPhase(move: AttackMoveWithAnimation, elapsed: number): {
  phase: Phase; elapsed: number; duration: number; windowIndex: number;
} {
  const windows = move.hitWindows!;
  const index = attackHitWindowIndex(move, elapsed);
  if (index >= 0) {
    let first = index, last = index;
    while (first > 0 && windows[first - 1]!.endFrame === windows[first]!.startFrame) first--;
    while (last + 1 < windows.length && windows[last]!.endFrame === windows[last + 1]!.startFrame) last++;
    return { phase: 'active', elapsed: elapsed - windows[first]!.startFrame,
      duration: windows[last]!.endFrame - windows[first]!.startFrame, windowIndex: index };
  }
  const nextIndex = windows.findIndex(window => window.startFrame > elapsed);
  if (nextIndex === 0) return { phase: 'startup', elapsed: Math.max(0, elapsed), duration: windows[0]!.startFrame, windowIndex: 0 };
  if (nextIndex === -1) {
    const end = windows[windows.length - 1]!.endFrame;
    return { phase: 'recovery', elapsed: elapsed - end,
      duration: move.startupFrames + move.activeFrames + move.recoveryFrames - end, windowIndex: windows.length - 1 };
  }
  const previous = windows[nextIndex - 1]!, next = windows[nextIndex]!;
  const releaseFrames = Math.ceil((next.startFrame - previous.endFrame) / 2);
  const anticipationStart = previous.endFrame + releaseFrames;
  return elapsed < anticipationStart
    ? { phase: 'recovery', elapsed: elapsed - previous.endFrame, duration: releaseFrames, windowIndex: nextIndex - 1 }
    : { phase: 'startup', elapsed: elapsed - anticipationStart, duration: next.startFrame - anticipationStart, windowIndex: nextIndex };
}

function selectPhaseFrame(phase: Phase, elapsed: number, duration: number, count: number, sheet: string): number {
  if (count <= 1) return 0;
  if (count === 2) return phase === 'startup' ? 0 : 1;
  // The existing four-frame smash strips contain two windups, contact, release.
  const startup = sheet === 'smash' && count === 4 ? 2 : Math.max(1, Math.floor(count / 3));
  const active = Math.max(1, Math.floor((count - startup) / 2));
  const start = phase === 'startup' ? 0 : phase === 'active' ? startup : startup + active;
  const length = phase === 'startup' ? startup : phase === 'active' ? active : count - startup - active;
  return start + Math.min(length - 1, Math.floor(Math.max(0, elapsed) * length / Math.max(1, duration)));
}

/**
 * The drawing an action shows in a strip of `count` drawings. `stateElapsed` is the renderer's own
 * state clock, used only by unclocked locomotion fallbacks; a caller without it (the held-item socket)
 * gets null there.
 */
export function selectActionArtFrame(action: ActionPose, count: number, sheet: string, stateElapsed: number | null): number | null {
  const clock = action.frame ?? stateElapsed;
  if (action.directArtFrame !== undefined) return action.directArtFrame;
  if (action.reviewedSheet) return clock === null ? null : reviewedStateFrame(action.reviewedSheet, clock, count);
  if (action.nativeTimedSheet) return clock === null ? null : selectPackedNativeSampleFrame(action.nativeTimedFighter!, action.nativeTimedSheet, clock);
  if (action.move) return selectSimulationAttackFrame(action.move, action.frame ?? 0, count, sheet);
  if (action.phase) return selectPhaseFrame(action.phase, action.frame ?? 0, action.duration ?? 1, count, sheet);
  if (action.hold) return action.hold === 'first' ? 0 : count - 1;
  if (action.duration !== undefined) return Math.min(count - 1, Math.floor((action.frame ?? 0) * count / Math.max(1, action.duration)));
  if (stateElapsed === null) return null;
  const rate = action.state === 'run' ? 12 : action.state === 'jump' ? 12 : 6;
  const index = Math.floor(stateElapsed * rate / 60);
  return action.state === 'jump' ? Math.min(count - 1, index) : index % count;
}

export interface SimulationSpritePose {
  readonly key: string;
  readonly state: string;
  readonly frameIndex: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly crouchClip: boolean;
  /** Visual facing can change for a reverse strike without changing controls. */
  readonly facing: 1 | -1;
  /** Upper-body layer drawn above the waist line over this pose (ActionPose.overlay). */
  readonly overlay?: { readonly key: string; readonly frameIndex: number };
  /** The same drawing as a character package action and tick; absent when no exported action shows it. */
  readonly display?: ActionDisplay;
}

export interface SimulationSpriteAnimationDriver {
  tick(): SimulationSpritePose | null;
  current(): SimulationSpritePose | null;
  detach(): void;
}

/** Renderer-neutral animation sink. It owns no animation clock. */
export interface SimulationSpriteSurface {
  play(key:string,ignoreIfPlaying?:boolean):unknown;
  readonly anims:{pause():unknown;setCurrentFrame(frame:unknown):unknown;readonly currentAnim:{readonly key:string}|null;readonly currentFrame:unknown};
}
export interface SimulationAnimationCatalog {
  exists(key:string):boolean;
  get(key:string):{readonly frames:readonly unknown[]};
}

/** Phaser's wall-clock animation is deliberately paused. Only this driver sets
 * frames, including locomotion, so repeated renders and menu pauses cannot drift.
 */
export function createSimulationSpriteAnimationDriver(
  provider: () => SimulationAnimationSnapshot,
  sprite: SimulationSpriteSurface,
  catalog: SimulationAnimationCatalog,
): SimulationSpriteAnimationDriver {
  const selector = createArtFrameSelector({ frameCount: key => catalog.exists(key) ? catalog.get(key).frames.length : 0 });
  let attached = true;
  return {
    tick() {
      if (!attached || !sprite.anims) return selector.current();
      sprite.anims.pause();
      const pose = selector.select(provider());
      if (!pose) return null;
      // Re-applying an unchanged pose (frozen, or no art for the action) is a no-op.
      if (sprite.anims.currentAnim?.key !== pose.key) {
        sprite.play(pose.key, true);
        sprite.anims.pause();
      }
      const frames = catalog.get(pose.key).frames;
      const frame = frames[Math.max(0, Math.min(frames.length - 1, pose.frameIndex))]!;
      if (sprite.anims.currentFrame !== frame) sprite.anims.setCurrentFrame(frame);
      return pose;
    },
    current: () => selector.current(),
    detach() { attached = false; sprite.anims?.pause(); },
  };
}
