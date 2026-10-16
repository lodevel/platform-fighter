/** Real existing engine events -> fresh Link source motion names.
 * Reads clocks without creating a combat, menu or receiving event. Missing
 * common phase producers remain recorded in common-route-static-dependencies.
 * Native item callback ordinals retain their own declared clock convention;
 * normal contact N -> raw N is not applied indiscriminately to item actions.
 */
import type { Character } from './Character';
import { linkRecoveryAttackSource, linkRecoveryAttackNativeFrame } from './linkFreshRecoveryAttacks';
import { linkSourceRecoveryId } from './linkSourceMoveIdentity';

export interface LinkCommonBodyRoute {
  readonly motion: string;
  readonly rawAge: number;
  readonly facing: 1 | -1;
  readonly terminal?: boolean;
  /** Real upper phase to compose over these legs. Shared renderer installation
   * and paired source registration are separate consumer dependencies. */
  readonly upper?: { readonly motion: string; readonly rawAge: number; readonly facing: 1 | -1 };
}
const THROW_SUFFIX = { forward: 'f', back: 'b', up: 'hi', down: 'lw' } as const;
const AERIAL_LANDING: Readonly<Record<string, string>> = {
  'link.nair': 'landing_air_n', 'link.fair': 'landing_air_f',
  'link.bair': 'landing_air_b', 'link.uair': 'landing_air_hi', 'link.dair': 'landing_air_lw',
};
// Native pulled/damage resources have indices0..19. Full20-sample presentation
// before wait is an explicit source-extent adapter, not recovered common status.
const CAPTURE_PRESENTATION_SAMPLES = 20;
// e00catchpull contains raw indices0..20. Its cancel2 is action admission, not
// proof the common caller exits the motion there. Keep the full21-sample tail
// unless a real pummel/throw/release interrupts; no controls/attachment change.
const CATCH_PULL_PRESENTATION_SAMPLES = 21;
function route(motion: string, rawAge: number, facing: 1 | -1, terminal = false): LinkCommonBodyRoute {
  return { motion, rawAge: Math.max(0, rawAge), facing, ...(terminal ? { terminal: true } : {}) };
}
/** Named common chooser/rate adapter: actual nonheavy held-item crouch wait,
 * using the existing crouch clock. Passive ShieldGuard keeps squat_wait. */
export function linkHeldCrouchSourceMotion(motion: string, input: { readonly crouching: boolean;
  readonly heldItemClass: string | null; readonly heavy: boolean; readonly passiveGuard: boolean }): string {
  return motion === 'squat_wait' && input.crouching && input.heldItemClass !== null
    && input.heldItemClass !== 'hammer' && !input.heavy && !input.passiveGuard ? 'squat_wait_item' : motion;
}

export function linkCommonBodyRoute(actor: Character): LinkCommonBodyRoute {
  const facing = actor.getFacing();
  const recipient = actor.getSourceRecipientPresentationState();
  if (actor.isGrabbed() && recipient) {
    if (recipient.phase === 'throw' && recipient.throwDirection) {
      return route(recipient.cargo ? `thrown_f_donkey_${THROW_SUFFIX[recipient.throwDirection]}`
        : `thrown_${THROW_SUFFIX[recipient.throwDirection]}`, recipient.framesElapsed, recipient.facing, true);
    }
    // Actual accepted capture latches an explicit authored override. Absence
    // retains Link's parameter-supported HIGH; ownership/cargo/grip height
    // never infers the LOW family or masquerades as a native caller.
    const suffix = recipient.selectedHeight === 'low' ? 'lw' : 'hi';
    if (recipient.phase === 'damage' && recipient.framesElapsed < CAPTURE_PRESENTATION_SAMPLES)
      return route(`capture_damage_${suffix}`, recipient.framesElapsed, recipient.facing, true);
    if (recipient.cargo && recipient.cargoStartupRemaining === 0 && !recipient.cargoLiftPending) {
      return route('shouldered_donkey', recipient.framesElapsed, recipient.facing);
    }
    if (recipient.phase === 'entry' && recipient.framesElapsed < CAPTURE_PRESENTATION_SAMPLES)
      return route(`capture_pulled_${suffix}`, recipient.framesElapsed, recipient.facing, true);
    // A pending cargo lift retains the actual capture phase. Conditional
    // low/DX overrides need caller facts; never infer them from ownership.
    return route(`capture_wait_${suffix}`, recipient.framesElapsed - CAPTURE_PRESENTATION_SAMPLES, recipient.facing);
  }
  // Genuine captor group owns its pull/wait/pummel/throw/cut and natural tail
  // clocks; target receiving above retains its independent capture lease.
  const captureAction = actor.getSourceLinkCaptureActionPresentationRoute();
  if (captureAction) return route(captureAction.motion, captureAction.rawAge,
    captureAction.facing, captureAction.terminal);
  const release = actor.getGrabReleasePresentationState();
  if (release) return route(release.role === 'target'
    ? release.groundedAtEntry ? 'capture_cut' : 'capture_jump' : 'catch_cut',
    release.framesElapsed, release.facing, true);

  // Born only from initial intro or actual support/drop-through receipts.
  // Producer clears uncommitted cues when a real action owns the actor.
  const contextual = actor.getSourceContextualPresentationRoute();
  if (contextual?.motion === 'entry_l' || contextual?.motion === 'entry_r')
    return route(contextual.motion, contextual.rawAge, contextual.facing, contextual.terminal);

  const shieldBreak = actor.getSourceShieldBreakPresentationState();
  if (shieldBreak) return route(shieldBreak.motion, shieldBreak.rawAge, shieldBreak.facing, shieldBreak.terminal);

  const footstool = actor.getSourceLinkFootstoolPresentationRoute();
  if (footstool) return route(footstool.motion, footstool.rawAge, footstool.facing, footstool.terminal);


  const sourceRecoveryAttack = actor.getActiveAttack();
  const recoveryLineage = sourceRecoveryAttack ? linkSourceRecoveryId(sourceRecoveryAttack.move) : null;
  if (sourceRecoveryAttack && recoveryLineage) return route(linkRecoveryAttackSource(recoveryLineage).motion,
    linkRecoveryAttackNativeFrame(recoveryLineage, sourceRecoveryAttack.framesElapsed),
    sourceRecoveryAttack.facing ?? facing, true);

  const damage = actor.getSourceLinkDamagePresentationRoute();
  if (damage?.motion === 'damage_elec') return route(damage.motion, damage.rawAge, damage.facing, damage.terminal);

  const reaction = actor.getSourceGroundRecoveryPresentationState();
  if (reaction) {
    const suffix = reaction.origin === 'face-down' ? 'd' : 'u';
    const backward = reaction.travelDirection !== undefined && reaction.travelDirection !== reaction.facing;
    if (reaction.kind === 'getup-roll') return route(reaction.origin === 'tech'
      ? `passive_stand_${backward ? 'b' : 'f'}`
      : reaction.origin === 'trip' ? `slip_escape_${backward ? 'b' : 'f'}`
        : `down_${backward ? 'back' : 'forward'}_${suffix}`, reaction.framesElapsed, reaction.facing, true);
    if (reaction.kind === 'getup-attack') return route(reaction.origin === 'trip' ? 'slip_attack'
      : `down_attack_${suffix}`, reaction.framesElapsed, reaction.facing, true);
    if (reaction.kind === 'stand') return route(reaction.origin === 'trip' ? 'slip_stand'
      : `down_stand_${suffix}`, reaction.framesElapsed, reaction.facing, true);
    if (reaction.kind === 'prone') return route(reaction.origin === 'trip' ? 'slip_wait'
      : `down_wait_${suffix}`, reaction.framesElapsed, reaction.facing);
    // Actual trip entry. No invented40/30 timer cycles clips while input locks
    // run; a distinct trip-start->wait producer is still required.
    if (reaction.kind === 'trip') return route('slip_down', reaction.framesElapsed, reaction.facing, true);
    if (reaction.kind === 'tech-in-place') return route('passive', reaction.framesElapsed, reaction.facing, true);
    return damage ? route(damage.motion, damage.rawAge, damage.facing, damage.terminal)
      : route('missing_fresh_damage_event', reaction.framesElapsed, reaction.facing, true);
  }
  if (damage) return route(damage.motion, damage.rawAge, damage.facing, damage.terminal);
  if (contextual) return route(contextual.motion, contextual.rawAge, contextual.facing, contextual.terminal);
  const throwing = actor.getThrowPresentationState();
  if (throwing) return route(`throw_${THROW_SUFFIX[throwing.direction]}`, throwing.framesElapsed, throwing.facing, true);
  const sourceGrab = actor.getSourceGrabPresentationState();
  if (sourceGrab.pummel) return route('catch_attack', sourceGrab.pummel.framesElapsed, sourceGrab.pummel.facing, true);
  const grab = actor.getGrabPresentationState();
  if (grab) {
    if (grab.phase === 'holding') return sourceGrab.heldAfterPummel
      ? route('catch_wait', grab.framesElapsed, sourceGrab.heldAfterPummel.facing)
      : grab.framesElapsed < CATCH_PULL_PRESENTATION_SAMPLES ? route('catch_pull', grab.framesElapsed, grab.facing, true)
        : route('catch_wait', grab.framesElapsed - CATCH_PULL_PRESENTATION_SAMPLES, grab.facing);
    return route(grab.variant === 'dash' ? 'catch_dash' : grab.variant === 'pivot' ? 'catch_turn' : 'catch',
      grab.framesElapsed, grab.facing, true);
  }

  // Bound capture and real receiving outrank every item commitment.
  const itemContext = actor.getSourceLinkItemContextPresentationState();
  if (itemContext?.ownsBodyRoute) return route(itemContext.route.motion, itemContext.route.rawAge,
    itemContext.route.facing, itemContext.route.terminal);
  const eating = actor.getRecoveryPresentation();
  if (eating) return route(eating.sheet, eating.age, eating.facing, true);
  const itemAction = actor.getItemActionState();
  if (itemAction?.plan.motion) return route(itemAction.plan.motion, itemAction.nativeFrame - 1, itemAction.facing, true);
  // Legacy getter names expose shared storage. Select Link's own plan.motion,
  // not DK sheet names or DK lift parameters as Link source evidence.
  const heavyAction = actor.getDonkeyKongHeavyItemActionState();
  if (heavyAction) return route(heavyAction.plan.motion, heavyAction.nativeFrame - 1, heavyAction.facing, true);
  const shooter = actor.getItemShootingPresentation();
  if (shooter) return { ...route(shooter.sheet, shooter.age, shooter.facing),
    ...(shooter.upper ? { upper: { motion: shooter.upper.sheet, rawAge: shooter.upper.age, facing: shooter.facing } } : {}) };
  const hammer = actor.getHammerPresentation();
  if (hammer) {
    const golden = actor.getEquippedItem()?.definition.hammer?.golden === true;
    return route(golden ? hammer.sheet.replace('item_hammer_', 'item_golden_hammer_') : hammer.sheet,
      hammer.age, hammer.facing);
  }
  const itemAttack = actor.getActiveAttack();
  if (itemAttack?.move.itemClip) return route(itemAttack.move.itemClip,
    itemAttack.framesElapsed, itemAttack.facing ?? facing, true);
  const charge = actor.getAnimationActionState();
  if (charge.chargingMove?.itemClip) {
    const base = charge.chargingMove.itemClip;
    const nativeHold = base === 'item_sword_swing_4' || base === 'item_starrod_swing_4';
    return route(nativeHold && charge.chargeHeldFrames > 0 ? `${base}_hold` : base,
      nativeHold && charge.chargeHeldFrames > 0 ? charge.chargeHeldFrames : charge.chargeStartupElapsed ?? 0, facing, true);
  }
  const carry = actor.getDonkeyKongHeavyCarryState();
  if (actor.getEquippedItem()?.definition.heavy && carry) return carry.phase === 'walk'
    ? route('item_heavy_walk', carry.age, carry.facing)
    : route('item_heavy_get', 24, carry.facing, true); // Link pickup terminal; no captured heavy_wait.

  const passiveGuard = actor.getLinkPassiveShieldPresentationState();
  if (passiveGuard) {
    // The real passive contact owns ShieldGuard's stopped/advancing clock.
    // Crouch retains its existing body motion, not a fresh guard-age loop.
    if (passiveGuard.crouchedAtEntry) {
      const selected = actor.getSourceCommonPresentationRoute();
      const crouch = actor.getCrouchPresentationState();
      const ordinary = actor.getOrdinaryPresentationState();
      return route('squat_wait', selected?.motion === 'squat_wait' ? selected.rawAge
        : crouch?.framesElapsed ?? ordinary?.framesElapsed ?? 0,
        passiveGuard.facing);
    }
    return route('shield_guard', passiveGuard.framesElapsed, passiveGuard.facing, true);
  }

  const taunt = actor.getTauntPresentationState();
  if (taunt) return route(`appeal_${taunt.kind === 'up' ? 'hi' : taunt.kind === 'down' ? 'lw' : 's'}_${taunt.facing === 1 ? 'r' : 'l'}`,
    taunt.framesElapsed, taunt.facing, true);
  // Genuine release keeps its own natural body/equipment tail after the
  // public11 control lock ends. This getter rejects a new real owner; the
  // coarse shield counter alone only exposes the locked first11 samples.
  const guardRelease = actor.getSourceGuardReleasePresentationRoute();
  if (guardRelease) return route(guardRelease.motion, guardRelease.rawAge, guardRelease.facing,
    guardRelease.terminal);
  const shield = actor.getShieldPresentationState();
  if (shield && shield.kind !== 'hold') return route(shield.kind === 'release' ? 'guard_off'
    : shield.kind === 'parry' ? 'just_shield_off' : shield.kind === 'broken' ? 'shield_break_fly' : 'guard_damage',
    shield.framesElapsed, shield.facing, true);
  const dodge = actor.getDodgeState();
  if (dodge.name !== 'idle' && dodge.name !== 'cooldown' && dodge.active) return route(dodge.active.kind === 'spot' ? 'escape'
    : dodge.active.kind === 'air' ? dodge.active.directional ? 'escape_air_slide' : 'escape_air'
      : dodge.active.backward ? 'escape_b' : 'escape_f', dodge.active.framesElapsed, dodge.active.facing, true);
  const ledge = actor.getLedgeHangState();
  if (ledge.name === 'hanging' || ledge.name === 'climbing' || ledge.name === 'rolling') {
    const age = ledge.active?.framesElapsed ?? 0;
    const catchFrames = actor.getTuning().ledge.catchFrames ?? 0;
    return route(ledge.name === 'hanging' ? age < catchFrames ? 'cliff_catch' : 'cliff_wait'
      : ledge.name === 'climbing' ? 'cliff_climb_quick' : 'cliff_escape_quick',
      ledge.name === 'hanging' && age >= catchFrames ? age - catchFrames : age,
      ledge.active?.facing ?? facing, ledge.name !== 'hanging' || age < catchFrames);
  }
  const active = actor.getActiveAttack();
  if (active?.move.id === 'link.ledgeAttack') return route('cliff_attack_quick', active.framesElapsed, active.facing ?? facing, true);
  const sourceLanding = actor.getSourceLinkLandingPresentationRoute();
  if (sourceLanding) return route(sourceLanding.motion, sourceLanding.rawAge, sourceLanding.facing, sourceLanding.terminal);
  const landing = actor.getLandingPresentationState();
  if (landing) return route(landing.kind === 'aerial' ? (landing.sourcePoseId ? AERIAL_LANDING[landing.sourcePoseId] : undefined)
    ?? 'missing_aerial_landing_source'
    : landing.kind === 'special' ? 'landing_fall_special' : landing.kind === 'hard' ? 'landing_heavy' : 'landing_light',
    landing.framesElapsed, facing, true);
  if (actor.getJumpsquatRemaining() > 0) return route('jump_squat', 3 - actor.getJumpsquatRemaining(), facing, true);
  const ordinary = actor.getOrdinaryPresentationState();
  if (!actor.isGrounded() && !actor.isOnRevivalPlatform()) {
    const air = actor.getSourceLinkAirPresentationRoute();
    // The real takeoff serial, short/full/aerial admission and prior tumble
    // own the phase clock. No old generic jump/fall substitutes for a missing
    // fresh producer or source profile.
    return air ? route(air.motion, air.rawAge, air.facing, air.terminal)
      : route('missing_fresh_air_event', 0, facing, true);
  }
  // This getter validates the real current owner/defense state; cached common
  // hold/turn cues cannot override a newly accepted block or item commitment.
  const common = actor.getSourceCommonPresentationRoute();
  if (common) {
    const held = actor.getEquippedItem();
    return route(linkHeldCrouchSourceMotion(common.motion, { crouching: actor.isCrouching(),
      heldItemClass: held?.definition.itemClass ?? null, heavy: held?.definition.heavy === true, passiveGuard: false }),
      common.rawAge, common.facing, common.terminal);
  }
  if (shield) return route('guard', 0, shield.facing, true);
  const crouch = actor.getCrouchPresentationState();
  if (crouch) {
    const held = actor.getEquippedItem();
    return route(linkHeldCrouchSourceMotion('squat_wait', { crouching: actor.isCrouching(),
      heldItemClass: held?.definition.itemClass ?? null, heavy: held?.definition.heavy === true, passiveGuard: false }),
      crouch.framesElapsed, crouch.facing);
  }
  const loco = actor.getLocomotionState(), speed = Math.abs(actor.getVelocity().x);
  const walkCap = actor.getTuning().locomotion?.walkMaxSpeed ?? 1.247 * 5;
  const motion = loco.name === 'initialDash' ? 'dash' : loco.name === 'run' ? 'run' : loco.name === 'pivot' ? 'turn_run'
    : loco.name === 'walk' ? speed <= walkCap * .5 ? 'walk_slow' : speed < walkCap * .75 ? 'walk_middle' : 'walk_fast'
      : actor.getEquippedItem() ? 'wait_item' : 'wait';
  return route(motion, loco.name === 'standing' ? ordinary?.framesElapsed ?? 0 : loco.framesElapsed,
    facing, motion === 'wait' || motion === 'dash' || motion === 'turn_run');
}
