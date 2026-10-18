/**
 * Packed-body presentation: which drawing a fighter's body shows, for every fighter whose art is packed by
 * tools/fighter-pack.py (per-clip strips with a fixed root, `scaleToWorld`, `nativeSampleIndices` /
 * `actionFrameStarts`, optional `loopDuration`). One implementation: the observed-state body candidate, the
 * native-timed clip clock, the Smash-style animation tail, render metrics and the paired-clip readers.
 *
 * Fighter-specific data is a `PackedBodyProfile` (its frames.json clips, sheet aliases and the few move-to-sheet
 * rules that differ). Registering a profile in `PACKED_BODY_PROFILES` is what puts a fighter on this path.
 */
import type { CharacterId } from '../types';
import { itemMotionClip, itemChargeClip } from '../items/itemMotionClips';
import type { CaptureAttachmentGrip } from './donkeykongCaptureAttachment';
import { getCompleteDonkeyKongStandingGrabTimeline, selectCompleteDonkeyKongStandingGrab, isCompleteStandingGrabCandidate,
  type DonkeyKongReviewedGrabTimeline } from './donkeykongCompleteGrab';
import type { Hurtbox } from './moveSchema';
import { attackMoveToSheets } from './spriteAnimationDriver';
import { classifyAerialDirection } from './aerialAttackInput';
import type { ActionPose, SimulationAnimationSnapshot } from './simulationSpriteAnimation';
import { applyDonkeyKongMoveProtection } from './donkeykongPairedProtectionClock';
import type { ActiveAttack, AttackCollisionHit, AttackMove } from './attacks';
import { mapDonkeyKongPairedActionAge } from './donkeykongPairedActionTimeline';
import { ledgeHangPresentationClock } from './ledgeHangState';
import { readDonkeyKongCatchPose, type DonkeyKongCatchCollisionPoseRow, type DonkeyKongCatchPoseSelection } from './donkeykongCatchCollisionPose';
import { DONKEYKONG_BODY_PROFILE } from './donkeykongBodyProfile';
import { LINK_BODY_PROFILE } from './linkPackedBodyProfile';

export interface PackedBodyClip {
  readonly pairedGrabTimeline?:DonkeyKongReviewedGrabTimeline;
  readonly captureGripPoses?:readonly CaptureAttachmentGrip[];
  readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number;
  readonly root?: readonly number[]; readonly scaleToWorld?: number; readonly bodyCentreFromRootY?: number;
  readonly frameWindows?: readonly {startFrame:number;endFrame:number|null;artFrameIndex:number}[];
  readonly loopDuration?:number|null;
  /** 1-based native frames (60 Hz) at which each art frame starts; packed new-art clips only. */
  readonly nativeSampleIndices?:readonly number[];
  /** 1-based gameplay frames at which each drawing starts, when the action clock is not the native
   * motion clock (entry offsets, MOTION_RATE scripts); defaults to `nativeSampleIndices`. */
  readonly actionFrameStarts?:readonly number[];
  readonly pairedActionTimeline?:{readonly endFrame:number};
  readonly hurtboxPoses?: readonly {artFrameIndex:number;nativeSample:number;hurtboxes:readonly Hurtbox[];headContact?:{readonly point:{readonly x:number;readonly y:number};readonly reviewKey:string}}[];
  readonly sourceRootDelta?:readonly {x:number;y:number}[];
  readonly attackCollisionPoses?:readonly {artFrameIndex:number;nativeSample:number;
    collisionHits:readonly Pick<AttackCollisionHit,'id'|'capsule'>[]}[];
  readonly catchCollisionPoses?:readonly DonkeyKongCatchCollisionPoseRow[];
}
type GrabVariant='standing'|'dash'|'pivot';
/** Everything about one fighter that the shared presentation needs. */
export interface PackedBodyProfile {
  readonly id: CharacterId;
  /** Fighter name in error messages. */
  readonly label: string;
  /** The fighter's frames.json `animations`. */
  readonly clips: Readonly<Record<string, PackedBodyClip>>;
  /** Runtime sheet → drawn clip, followed (transitively) only while the runtime sheet has no clip of its own. */
  readonly sheetAliases: Readonly<Record<string, string>>;
  /** A candidate whose sheet has no packed clip: 'generic' falls through to the generic sprite path (DK's
   * remaining legacy art); 'invisible' shows nothing (no fallback pose). */
  readonly missingSheet: 'generic' | 'invisible';
  /** Root-to-body-centre offset of a clip that does not declare its own. */
  readonly bodyCentreFromRootY: number;
  /** The body sheet of an attack, from its first driver sheet (before aliasing). Default: the driver sheet. */
  readonly attackSheet?: (sheet: string, attack: { readonly move: AttackMove; readonly chargeHeldFrames?: number | null }) => string;
  /** Single-age reviewed contact drawings by move id, used when that clip has a window on exactly that age. */
  readonly attackPilots?: Readonly<Record<string, { readonly sheet: string; readonly age: number }>>;
  /** Single-age reviewed catch drawings by grab variant. */
  readonly grabPilots?: Readonly<Partial<Record<GrabVariant, { readonly sheet: string; readonly age: number; readonly nativeSample: number }>>>;
  /** The landing-lag sheet after an aerial. Default: `landing_aerial`. */
  readonly aerialLandingSheet?: (moveId?: string, sourcePoseId?: string) => string;
  /** The landing sheet after a special fall (moveId: the special that caused it, when known). */
  readonly specialLandingSheet: (moveId?: string) => string;
}

const PACKED_BODY_PROFILES: Readonly<Partial<Record<CharacterId, PackedBodyProfile>>> = {
  donkeykong: DONKEYKONG_BODY_PROFILE,
  link: LINK_BODY_PROFILE,
};
/** The fighter's packed-body profile; null for a fighter not on this path. */
export function packedBodyProfile(fighter: CharacterId): PackedBodyProfile | null {
  return PACKED_BODY_PROFILES[fighter] ?? null;
}

export interface PackedBodyState {
  readonly pummel?:{framesElapsed:number;facing:1|-1}|null;
  readonly heldAfterPummel?:{facing:1|-1}|null;
  readonly cargoEntry?:{framesElapsed:number;facing:1|-1}|null;
  /** A recipient of a Cargo Throw: carried (throw null) or through a throw on the captor's throw age. */
  readonly cargoRecipient?:{throw:{direction:'forward'|'back'|'up'|'down';age:number}|null;age:number}|null;
  /** A heavy pickup / throw (an action), or the carry (`carry`: a rest). */
  readonly heavyItem?:{sheet:string;age:number;facing:1|-1;carry?:true}|null;
  readonly surfaceTech?:{kind:'wall'|'wall-jump'|'ceiling';framesElapsed:number;facing:1|-1;protected:boolean}|null;
  readonly footstoolPerformer?:{framesElapsed:number;facing:1|-1;mini:boolean}|null;
  /** A fighter-owned footstool source route, including recipient side/phase. */
  readonly footstool?:{sheet:string;age:number;facing:1|-1}|null;
  readonly punch?:{phase:'start'|'loop'|'cancel'|'end';age:number;grounded:boolean;facing:1|-1;jumpCancel:boolean}|null;
  /** A fighter-owned special's current phase motion on its own clock (Link's bow, boomerang, bomb and spin). */
  readonly intrinsic?:{sheet:string;age:number;facing:1|-1}|null;
  /** A finished action whose clip outlasts it, on the clip's age, while the fighter stays at the rest the action left it in. */
  readonly tail?:PackedBodyTail|null;
  readonly clock:{sheet:string;framesElapsed:number;facing:1|-1;action?:boolean}|null;
  readonly committed:{sheet:string;framesElapsed:number;facing:1|-1;protectionFrames?:number}|null;
  readonly crouchPhase:'start'|'hold'|'end'|null;
  readonly turnBrake:{sheet:string;facing:1|-1;framesElapsed?:number}|null;
  readonly itemCue:{sheet:string;age:number;facing:1|-1}|null;
  readonly airDodgeDirection:{x:number;y:number};
  readonly fastFall:boolean;
  /** Clamped stick X of the last step; selects the facing-relative fall variant. */
  readonly stickX?:number;
}

function profileOf(fighter:CharacterId):PackedBodyProfile {
  const profile=packedBodyProfile(fighter);
  if(!profile)throw new Error(`${fighter} has no packed-body profile`);
  return profile;
}
function bodyDrawing(p:PackedBodyProfile,sheet:string,elapsed:number) {
  const clip=p.clips[sheet];if(!clip?.frameWindows?.length)return null;
  if(sheet==='grab'&&isCompleteStandingGrabCandidate(clip)){
    const source=getCompleteDonkeyKongStandingGrabTimeline(clip);
    if(!source||elapsed>=source.startupFrames+source.activeFrames+source.recoveryFrames)return null;
  }
  if(!Number.isFinite(elapsed)||elapsed<0)throw new Error(`Invalid ${p.label} ${sheet} action age`);
  if(clip.pairedActionTimeline&&elapsed>=clip.pairedActionTimeline.endFrame)return null;
  const end=clip.frameWindows[clip.frameWindows.length-1]!.endFrame;
  const local=clip.loopDuration ? elapsed%clip.loopDuration : clip.pairedActionTimeline||end===null ? elapsed : Math.min(elapsed,end-1);
  const window=clip.frameWindows.find(w=>w.startFrame<=local&&(w.endFrame===null||local<w.endFrame));
  if(!window)throw new Error(`${p.label} ${sheet} has no declared body drawing at ${local}`);
  const receiving=clip.hurtboxPoses?.find(row=>row.artFrameIndex===window.artFrameIndex);
  if(!receiving)throw new Error(`${p.label} ${sheet} drawing ${window.artFrameIndex} has no paired receiving`);
  return {clip,artFrameIndex:window.artFrameIndex,localFrame:local,hurtboxes:receiving.hurtboxes,nativeSample:receiving.nativeSample};
}
/** A paired (frameWindows) clip's drawing at an action age; null for a clip without windows or past its timeline. */
export function getPackedBodyDrawing(fighter:CharacterId,sheet:string,elapsed:number){return bodyDrawing(profileOf(fighter),sheet,elapsed);}
export function getPackedBodyRootDelta(fighter:CharacterId,sheet:string,age:number){
  const rows=packedBodyProfile(fighter)?.clips[sheet]?.sourceRootDelta;return rows?.[Math.max(0,Math.min(age,rows.length-1))]??null;}

function pairedMoveDrawing(p:PackedBodyProfile,move:AttackMove,elapsed:number,sheet:string){
  const clip=p.clips[sheet];if(!clip?.pairedActionTimeline)return null;
  const sourceActionAge=mapDonkeyKongPairedActionAge(clip,move,elapsed);if(sourceActionAge===null)return null;
  const drawing=bodyDrawing(p,sheet,sourceActionAge);
  if(!drawing)return null;
  return {...drawing,sheet,sourceActionAge};
}
/** Editor and running fighter consume the same canonical sample clock. */
export function resolvePackedPairedMoveDrawing(fighter:CharacterId,move:AttackMove,elapsed:number,
  sheet=attackMoveToSheets(move)[0]!){
  return pairedMoveDrawing(profileOf(fighter),move,elapsed,sheet);
}

function grabSheet(p:PackedBodyProfile,variant:GrabVariant,age:number):string {
  const canonical=variant==='dash'?'dash_grab':variant==='pivot'?'pivot_grab':'grab';
  const pilot=p.grabPilots?.[variant],clip=pilot&&p.clips[pilot.sheet];
  if(!pilot||age!==pilot.age||clip?.catchCollisionPoses===undefined)return canonical;
  // A pilot never replaces an unreviewed legacy age or a mismatched paired
  // drawing. Invalid CATCH rows themselves retain this valid body selection.
  try{
    const windows=clip.frameWindows?.filter(w=>w.startFrame<=age&&(w.endFrame===null||age<w.endFrame));
    const window=windows?.length===1?windows[0]:null;
    if(!window||window.startFrame!==pilot.age||window.endFrame!==pilot.age+1)return canonical;
    const drawing=bodyDrawing(p,pilot.sheet,age);
    return drawing?.artFrameIndex===window.artFrameIndex&&drawing.nativeSample===pilot.nativeSample?pilot.sheet:canonical;
  }catch{return canonical;}
}

function completeStandingGrab(p:PackedBodyProfile,s:SimulationAnimationSnapshot){
  const g=s.grabPresentation,active=s.grab.active,spec=s.grabSpec;
  if(!g||g.variant!=='standing'||!active||!spec)return null;
  return selectCompleteDonkeyKongStandingGrab(p.clips.grab,{variant:g.variant,phase:s.grab.name,
    phaseFramesElapsed:active.framesElapsed,spec});
}

/** Replacing the canonical standing atlas must not make its generic fallback
 * look like reviewed dash/pivot choreography. Exact reviewed pilots resolve
 * before this guard; the renderer retains a separately keyed legacy baseline.
 */
export function excludeCompleteStandingGrabFromNonstandingFallback(s:SimulationAnimationSnapshot):boolean {
  const p=packedBodyProfile(s.characterId);
  return !!p&&s.grabPresentation?.variant!=='standing'&&
    !!s.grabPresentation&&['whiffStartup','whiffActive','whiffRecovery'].includes(s.grab.name)&&
    isCompleteStandingGrabCandidate(p.clips.grab);
}

function installedSheet(p:PackedBodyProfile,sheet:string):string {
  let resolved=sheet;
  while(!p.clips[resolved]&&p.sheetAliases[resolved])resolved=p.sheetAliases[resolved]!;
  return resolved;
}
/** The drawn clip a runtime sheet resolves to through the fighter's aliases (itself when it has no profile). */
export function installedPackedSheet(fighter:CharacterId,sheet:string):string {
  const p=packedBodyProfile(fighter);return p?installedSheet(p,sheet):sheet;
}
/** Ultimate-style fall motions by stick relative to facing: fall / fall_f (sheet `air_drift`) /
 * fall_b, and the fall_aerial set after an aerial (double) jump. */
const FALL_SHEETS={
  ground:{neutral:'fall',forward:'air_drift',back:'fall_b'},
  aerial:{neutral:'fall_aerial',forward:'fall_aerial_f',back:'fall_aerial_b'}} as const;
type AttackClock=Pick<ActiveAttack,'move'|'framesElapsed'>&{readonly chargeHeldFrames?:number|null};
function attackSheet(p:PackedBodyProfile,a:Pick<AttackClock,'move'|'chargeHeldFrames'>):string {
  const sheet=attackMoveToSheets(a.move)[0]!;
  return p.attackSheet?p.attackSheet(sheet,a):sheet;
}
/** The move's body drawing source on its action clock; null when a paired clip has no drawing at that age. */
function attackBody(p:PackedBodyProfile,a:AttackClock):{sheet:string;age:number}|null {
  // A held-item use plays its native item motion (AttackMove.itemClip, e.g. item_bat_swing_3).
  const canonical=a.move.itemClip?itemMotionClip(a.move.itemClip):attackSheet(p,a);
  if(p.clips[canonical]?.pairedActionTimeline){
    const drawing=pairedMoveDrawing(p,a.move,a.framesElapsed,canonical);
    return drawing&&{sheet:canonical,age:drawing.sourceActionAge};
  }
  const selected=p.attackPilots?.[a.move.id];
  if(selected&&a.framesElapsed===selected.age&&p.clips[selected.sheet]?.frameWindows?.some(w=>w.startFrame===selected.age&&w.endFrame===selected.age+1))return {sheet:selected.sheet,age:a.framesElapsed};
  return {sheet:canonical,age:a.framesElapsed};
}
function nativeTimedClip(p:PackedBodyProfile,sheet:string){
  const clip=p.clips[sheet];return clip?.nativeSampleIndices?.length&&!clip.frameWindows?.length?clip:null;
}
function animationEnd(p:PackedBodyProfile,sheet:string):number {
  const clip=nativeTimedClip(p,sheet);
  return clip&&!clip.loopDuration?(clip.actionFrameStarts??clip.nativeSampleIndices!).at(-1)!:0;
}
/** First age past a clip's drawings. A native-timed one-shot clip runs to its last sample, which can outlast the
 * action that plays it (the animation tail); paired, pilot, legacy and loop clips have none (0). */
export function packedAnimationEnd(fighter:CharacterId,sheet:string):number {return animationEnd(profileOf(fighter),sheet);}
function stickSide(moveX:number,facing:1|-1):'neutral'|'forward'|'back' {
  const side=classifyAerialDirection(moveX,facing);
  return side==='forward'||side==='back'?side:'neutral';
}

const THROW_SHEET={forward:'fthrow',back:'bthrow',up:'uthrow',down:'dthrow'} as const;
export interface PackedBodyTail {readonly sheet:string;readonly framesElapsed:number;readonly facing:1|-1;readonly end:number;readonly rest:string}
export interface PackedBodyCandidate {readonly sheet:string;readonly age?:number;readonly facing:1|-1;
  /** Upper-body layer over this (legs) drawing: a shooting item fired while walking / squatting / landing. */
  readonly overlay?:{readonly sheet:string;readonly age:number};
  /** An action's drawing: when the action ends before the clip, its remaining drawings play out as a tail. */
  readonly action?:boolean;
  /** The rest an action can leave the fighter in (standing, airborne on the same jump, holding, carrying); a tail shows only over it. */
  readonly rest?:string}
/** No age: the sheet runs on the body clock, so it starts at its own drawing 0 when it begins. */
const ON_BODY_CLOCK=undefined;

/** Observed state priority, without the tail. A missing dedicated clip stays a reported gap. */
function baseBodyCandidate(P:PackedBodyProfile,s:SimulationAnimationSnapshot):PackedBodyCandidate|null {
  const body=s.packedBody;
  const pick=(sheet:string,age?:number,facing=s.facing)=>({sheet:installedSheet(P,sheet),age,facing});
  const act=(sheet:string,age?:number,facing=s.facing)=>({...pick(sheet,age,facing),action:true});
  const rest=(kind:string,sheet:string,age?:number,facing=s.facing)=>({...pick(sheet,age,facing),rest:kind});
  if(s.grabReleasePresentation){const p=s.grabReleasePresentation;return act(p.role==='target'?'captured_release':'grab_escape',p.framesElapsed,p.facing);}
  if(s.grabbed&&s.capturePresentation?.active&&body.cargoRecipient){const p=s.capturePresentation,c=body.cargoRecipient,t=c.throw;
    // Carried: a loop on the captor's cargo age (a captured body's own clock does not run); thrown: an action on the captor's throw age (its clip ends at the release frame).
    return t?act(`cargo_recipient_${THROW_SHEET[t.direction]}`,t.age,p.facing):rest('cargo-recipient','cargo_recipient_carried',c.age,p.facing);}
  if(s.grabbed&&s.capturePresentation?.active){const p=s.capturePresentation,hit=p.event.kind==='damage'&&p.event.framesElapsed<20;return pick(hit?'captured_hit':'captured',hit?p.event.framesElapsed:p.framesElapsed,p.facing);}
  if(s.buriedPresentation){const p=s.buriedPresentation;return pick(p.phase==='buried'?'buried':'buried_escape',p.framesElapsed,p.facing);}
  if(body.surfaceTech){const p=body.surfaceTech;return pick(p.kind==='wall-jump'?'tech_wall_jump':p.kind==='ceiling'?'tech_ceiling':'tech_wall',p.framesElapsed,p.facing);}
  if(body.committed)return pick(body.committed.sheet,body.committed.framesElapsed,body.committed.facing);
  if(body.footstool){const p=body.footstool;return pick(p.sheet,p.age,p.facing);}
  if(s.footstoolRecipientPresentation){const p=s.footstoolRecipientPresentation;return pick(p.grounded?'footstool_pose':p.framesElapsed<8?'footstool_air_pose':'footstool_fall',p.grounded||p.framesElapsed<8?p.framesElapsed:p.framesElapsed-8,p.facing);}
  const reaction=s.reactionPresentation;
  if(reaction&&['damage','tumble','prone','trip'].includes(reaction.kind))return pick(reaction.kind==='damage'?(s.grounded?'hurt':'hurt_air'):reaction.kind==='prone'?(reaction.origin==='face-down'?'down_wait_face_down':'down_wait'):reaction.kind,reaction.framesElapsed,reaction.facing);
  if(s.clankPresentation?.interruptedAttack){const p=s.clankPresentation.interruptedAttack;return pick(attackSheet(P,{move:p.move}),p.framesElapsed,p.facing);}
  if(s.tauntPresentation){const p=s.tauntPresentation;return act(`taunt_${p.kind}_${p.facing===1?'r':'l'}`,p.framesElapsed,p.facing);}
  // Heavy / light pickups, throws and drops are actions (their clips outlast the action); the carries are rests.
  if(body.heavyItem){const p=body.heavyItem;
    return p.carry?rest('heavy',p.sheet,p.age,p.facing):act(p.sheet,p.age,p.facing);}
  if(body.itemCue){const p=body.itemCue;
    return p.sheet==='item_carry'?rest('item',p.sheet,p.age,p.facing):act(p.sheet,p.age,p.facing);}
  if(s.ledgeHang.active&&s.ledgeHang.name==='hanging'){const p=s.ledgeHang.active,clock=ledgeHangPresentationClock(p.framesElapsed,s.ledgeHang.ledgeGrabsSinceGround,s.ledgeCatchFrames,s.ledgeCatchMotionRates);return pick(clock.sheet,clock.age,p.facing);}
  if(s.ledgeHang.active&&['climbing','rolling'].includes(s.ledgeHang.name)){const p=s.ledgeHang.active;return pick(s.ledgeHang.name==='climbing'?'ledge_getup':'ledge_roll',p.framesElapsed,p.facing);}
  if(s.dodge.active&&['active','recovery'].includes(s.dodge.name)){const p=s.dodge.active;let sheet=p.kind==='spot'?'spot_dodge':p.kind==='roll'?(p.backward?'roll_back':'roll'):'air_dodge';
    if(p.kind==='air'&&p.directional){const dir=body.airDodgeDirection;sheet=dir.y<-.5?(Math.abs(dir.x)>.1?'air_dodge_up_diagonal':'air_dodge_up'):dir.y>.5?(Math.abs(dir.x)>.1?'air_dodge_down_diagonal':'air_dodge_down'):'air_dodge_horizontal';}
    return pick(sheet,p.framesElapsed,(p.facing*(p.backward?-1:1)) as 1|-1);}
  if(s.shieldPresentation){const p=s.shieldPresentation;
    // The parry is an action: its clip (native just_shield_off, 28 frames) outlasts the 3-step stun and plays out as a tail.
    if(p.kind==='parry')return act('parry',p.framesElapsed,p.facing);
    return pick(p.kind==='hold'?'shield':p.kind==='release'?'shield_end':p.kind==='block'?'shield_hit':'shield_break',p.framesElapsed,p.facing);}
  // A shooting item: the phase's native motion (an action: its clip plays out), or the legs under the upper-body layer.
  if(s.itemShooting){const p=s.itemShooting;
    return p.upper?{...pick(p.sheet,p.age,p.facing),overlay:{sheet:installedSheet(P,p.upper.sheet),age:p.upper.age}}:act(p.sheet,p.age,p.facing);}
  if(body.intrinsic){const p=body.intrinsic;return act(p.sheet,p.age,p.facing);}
  // A helpless body is in special fall, never an attack (SmashWiki: the air Spin Attack leaves Link helpless; Link's
  // spin record lasts until it lands). Its fall and touchdown are drawn below.
  if(s.activeAttack&&!s.helpless){const a=s.activeAttack,attack=attackBody(P,a);
    return attack&&act(attack.sheet,attack.age,a.facing);}
  if(body.punch){const p=body.punch;return pick(`neutral_special${p.grounded?'':'_air'}_${p.phase==='loop'?'charge':p.phase==='cancel'&&p.jumpCancel?'jump_cancel':p.phase}`,p.age,p.facing);}
  if(s.chargingMove){const p=s.chargingMove,startup=p.type==='smash'&&s.chargeStartupElapsed!==undefined&&s.chargeStartupElapsed<((p as {chargeStartFrame?:number}).chargeStartFrame??0);
    // A held-item smash winds up on its swing motion and holds on the swing's native charge loop.
    const base=p.itemClip?itemMotionClip(p.itemClip):attackMoveToSheets(p)[0]!,hold=p.itemClip?itemChargeClip(p.itemClip):`${base}_charge`;
    return pick(startup?base:hold,startup?s.chargeStartupElapsed:s.chargeHeldFrames);}
  if(s.throwPresentation){const p=s.throwPresentation,base=THROW_SHEET[p.direction];return act(p.cargo?`cargo_${base}${p.airborne?'_air':''}`:base,p.framesElapsed,p.facing);}
  const grab=s.grab.active,spec=s.grabSpec;
  if(grab&&spec){if(s.grab.name==='holding'){
    if(body.pummel){const p=body.pummel;return act('pummel',p.framesElapsed,p.facing);}
    if(grab.cargo){if(body.cargoEntry){const p=body.cargoEntry;return act('fthrow',p.framesElapsed,p.facing);}
      if(grab.cargoStartupRemaining)return act('fthrow',(spec.cargo?.startupFrames??0)-grab.cargoStartupRemaining);
      // The cargo jump runs on the jump clock until its drawings end; every other carry state starts at its own drawing 0.
      if(!s.grounded)return s.jumpPresentation&&s.jumpPresentation.framesElapsed<animationEnd(P,'cargo_jump')
        ?pick('cargo_jump',s.jumpPresentation.framesElapsed):pick('cargo_hold_air',ON_BODY_CLOCK);
      return Math.abs(s.velocityX)>.1?pick('cargo_walk',ON_BODY_CLOCK):rest('cargo','cargo_hold',ON_BODY_CLOCK);}
    if(body.heldAfterPummel)return rest('hold','grab_hold',ON_BODY_CLOCK,body.heldAfterPummel.facing);
    if(spec.pummel?.motionFrames===undefined&&grab.pummelCooldownRemaining>0&&spec.pummel)return act('pummel',spec.pummel.cooldownFrames-grab.pummelCooldownRemaining);
    return grab.framesElapsed<20?pick('grab_pull',grab.framesElapsed):rest('hold','grab_hold',ON_BODY_CLOCK);}
    if(s.grabPresentation&&s.grab.name.startsWith('whiff')){
      const p=s.grabPresentation,full=completeStandingGrab(P,s);
      if(full)return pick(full.sheet,full.sourceAge,p.facing);
      const sheet=grabSheet(P,p.variant,p.framesElapsed);
      // Never read unreviewed full canonical inputs as legacy paired geometry.
      if(sheet==='grab'&&isCompleteStandingGrabCandidate(P.clips.grab))return null;
      return act(sheet,p.framesElapsed,p.variant==='pivot'?(-p.facing) as 1|-1:p.facing);
    }}
  if(s.jumpsquatRemaining>0)return pick('jumpsquat',3-s.jumpsquatRemaining);
  if(s.landingPresentation){const p=s.landingPresentation;return pick(p.kind==='soft'?'landing_soft':p.kind==='hard'?'landing_hard':p.kind==='special'?P.specialLandingSheet(p.moveId):p.kind==='aerial'?(P.aerialLandingSheet?.(p.moveId,p.sourcePoseId)??'landing_aerial'):'landing_air_dodge',p.framesElapsed);}
  // Touchdown step of a special fall: physics has grounded the body, but the landing lag starts on
  // the next input step (Character.tickLanding). Show the landing's first drawing, not standing idle.
  if(s.helpless&&s.grounded)return pick(P.specialLandingSheet(),0);
  if(body.crouchPhase)return pick(`crouch${body.crouchPhase==='hold'?'':'_'+body.crouchPhase}`);
  if(body.turnBrake)return pick(body.turnBrake.sheet,body.turnBrake.framesElapsed,body.turnBrake.facing);
  if(body.footstoolPerformer){const p=body.footstoolPerformer;return pick(p.mini?'footstool_jump_mini':'footstool_jump',p.framesElapsed,p.facing);}
  if(s.crouching)return pick('crouch',s.crouchPresentation?.framesElapsed);
  if(!s.grounded){if(s.helpless)return pick('fall_special',s.ordinaryPresentation?.framesElapsed);
    const jump=s.jumpPresentation,air=(sheet:string,age?:number,facing=s.facing)=>rest(`air:${s.jumpsUsed}`,sheet,age,facing);
    // Backward = entry stick away from the kept facing (native a03jumpb / a03jumpaerialb).
    if(jump&&s.velocityY<0){const back=stickSide(jump.moveX,jump.facing)==='back'?'_b':'';
      return air(jump.kind==='air'?`airjump${back}`:jump.kind==='ledge'?'ledge_jump':`${jump.shortHop?'jump_short':'jump'}${back}`,jump.framesElapsed,jump.facing);}
    if(body.fastFall)return air('fall_fast',s.ordinaryPresentation?.framesElapsed);
    return air(FALL_SHEETS[jump?.kind==='air'?'aerial':'ground'][stickSide(body.stickX??0,s.facing)],s.ordinaryPresentation?.framesElapsed);}
  if(s.locomotion.name==='standing')return rest('ground','idle',s.ordinaryPresentation?.framesElapsed);
  return pick(s.locomotion.name==='initialDash'?'dash':s.locomotion.name==='run'?'run':s.locomotion.name==='walk'?'walk':'run_turn',s.locomotion.framesElapsed);
}
function bodyCandidate(p:PackedBodyProfile,s:SimulationAnimationSnapshot):PackedBodyCandidate|null {
  const base=baseBodyCandidate(p,s),tail=s.packedBody.tail;
  return tail&&base?.rest===tail.rest?{sheet:tail.sheet,age:tail.framesElapsed,facing:tail.facing}:base;
}
/** The sheet (already aliased) and age the body shows; null without a profile or without a candidate. */
export function packedBodyCandidate(s:SimulationAnimationSnapshot):PackedBodyCandidate|null {
  const p=packedBodyProfile(s.characterId);return p&&bodyCandidate(p,s);
}
/** Smash-style animation tail. When an action ends before its clip (an attack after FAF, a throw, grab, pummel...), the
 * clip's remaining drawings play out while the fighter stays at the rest the action left it in; any new action or state
 * ends it (the next body clock starts afresh). `s` carries last step's clock; the tail starts on the age after it. */
export function nextPackedBodyTail(s:SimulationAnimationSnapshot,advance:boolean):PackedBodyTail|null {
  const p=packedBodyProfile(s.characterId);if(!p)return null;
  const base=baseBodyCandidate(p,s),tail=s.packedBody.tail,clock=s.packedBody.clock;
  if(!base?.rest)return null;
  if(tail){const age=tail.framesElapsed+(advance?1:0);return tail.rest===base.rest&&age<tail.end?{...tail,framesElapsed:age}:null;}
  if(!clock?.action)return null;
  const end=animationEnd(p,clock.sheet),age=clock.framesElapsed+1;
  return age<end?{sheet:clock.sheet,framesElapsed:age,facing:clock.facing,end,rest:base.rest}:null;
}

function candidateAge(s:SimulationAnimationSnapshot,candidate:{sheet:string;age?:number}):number {
  const clock=s.packedBody.clock;return candidate.age??(clock?.sheet===candidate.sheet?clock.framesElapsed:0);
}
function pairedBodyAction(p:PackedBodyProfile,s:SimulationAnimationSnapshot):ActionPose|null {
  const candidate=bodyCandidate(p,s);if(!candidate)return null;
  const age=candidateAge(s,candidate);
  const drawing=bodyDrawing(p,candidate.sheet,age);if(!drawing)return null;
  return {state:candidate.sheet,sheets:[candidate.sheet],directArtFrame:drawing.artFrameIndex,frame:age,facing:candidate.facing};
}
/** The body pose when the candidate's clip is a paired (frameWindows) clip. */
export function resolvePackedBodyAction(s:SimulationAnimationSnapshot):ActionPose|null {
  const p=packedBodyProfile(s.characterId);return p&&pairedBodyAction(p,s);
}
/** A clip packed by tools/fighter-pack.py: no frameWindows (generic body-default hurtbox), but
 * `nativeSampleIndices` give each drawing's start on the 60 Hz native clock. Old 256 px clips
 * carry neither and keep the classifier/fixed-rate path. */
export function getPackedNativeTimedClip(fighter:CharacterId,sheet:string){
  const p=packedBodyProfile(fighter);return p&&nativeTimedClip(p,sheet);
}
function nativeSampleFrame(p:PackedBodyProfile,sheet:string,age:number):number {
  const clip=nativeTimedClip(p,sheet);
  if(!clip)throw new Error(`${p.label} ${sheet} has no native sample timing`);
  const samples=clip.actionFrameStarts??clip.nativeSampleIndices!;
  if(samples.length!==clip.frameCount)throw new Error(`${p.label} ${sheet} has ${samples.length} drawing starts for ${clip.frameCount} drawings`);
  if(!Number.isFinite(age)||age<0)throw new Error(`Invalid ${p.label} ${sheet} action age`);
  const loop=clip.loopDuration;
  const native=(loop?age%loop:age)+1;
  let index=0;samples.forEach((sample,i)=>{if(sample<=native&&!(loop&&(samples[i+1]??loop+1)-sample<2))index=i;});
  return index;
}
/** Action age 0 is native frame 1 (frame 1 of `actionFrameStarts` when present). Each drawing is held until the next start;
 * `loopDuration` (last sample for loop clips) wraps, otherwise the last drawing is held. A loop never shows a
 * drawing for a single step: the last sample sits on the cycle's final frame (one step before native 1 repeats)
 * and charge loops carry the smash's contact samples, so those drawings would flash once per cycle; the
 * preceding drawing holds instead. One-shot clips keep their single-step (contact) drawings. */
export function selectPackedNativeSampleFrame(fighter:CharacterId,sheet:string,age:number):number {
  return nativeSampleFrame(profileOf(fighter),sheet,age);
}
function drawingAt(p:PackedBodyProfile,sheet:string,age:number):{clip:PackedBodyClip;artFrameIndex:number;nativeSample:number}|null {
  const native=nativeTimedClip(p,sheet);
  if(!native)return bodyDrawing(p,sheet,age);
  const artFrameIndex=nativeSampleFrame(p,sheet,age);
  return {clip:native,artFrameIndex,nativeSample:native.nativeSampleIndices![artFrameIndex]!};
}
/** The drawing (and its metadata rows) a sheet shows at an age, on either clock: paired windows or native samples. */
export function selectPackedDrawing(fighter:CharacterId,sheet:string,age:number){return drawingAt(profileOf(fighter),sheet,age);}
function nativeTimedAction(p:PackedBodyProfile,s:SimulationAnimationSnapshot):ActionPose|null {
  const candidate=bodyCandidate(p,s);
  if(!candidate||!nativeTimedClip(p,candidate.sheet))return null;
  const overlay=candidate.overlay&&nativeTimedClip(p,candidate.overlay.sheet)?{state:candidate.overlay.sheet,
    sheets:[candidate.overlay.sheet],nativeTimedSheet:candidate.overlay.sheet,nativeTimedFighter:p.id,frame:candidate.overlay.age,facing:candidate.facing}:null;
  return {state:candidate.sheet,sheets:[candidate.sheet],nativeTimedSheet:candidate.sheet,nativeTimedFighter:p.id,
    frame:candidateAge(s,candidate),facing:candidate.facing,...(overlay?{overlay}:{})};
}
/** The body pose when the candidate's clip is native-timed (packed). */
export function resolvePackedNativeTimedAction(s:SimulationAnimationSnapshot):ActionPose|null {
  const p=packedBodyProfile(s.characterId);return p&&nativeTimedAction(p,s);
}
/** The renderer's body pose for a packed fighter: a paired clip, a native-timed clip, or — for a profile whose
 * missing sheets are invisible — nothing drawn (no sheets). Null: not a packed fighter, or its missing sheet
 * falls through to the generic sprite path. */
export function resolvePackedBodyPose(s:SimulationAnimationSnapshot):ActionPose|null {
  const p=packedBodyProfile(s.characterId);if(!p)return null;
  const pose=pairedBodyAction(p,s)??nativeTimedAction(p,s);
  if(pose||p.missingSheet==='generic')return pose;
  return {state:`${p.id}.missing-sheet:${bodyCandidate(p,s)?.sheet??'none'}`,sheets:[],invisible:true};
}
function selectedDrawing(p:PackedBodyProfile,s:SimulationAnimationSnapshot){
  const action=pairedBodyAction(p,s)??nativeTimedAction(p,s);
  if(!action||action.frame===undefined)return null;
  const drawing=drawingAt(p,action.sheets[0]!,action.frame);
  return drawing&&{action,drawing};
}
export function selectPackedBodyReceiving(s:SimulationAnimationSnapshot):readonly Hurtbox[]|null {
  const p=packedBodyProfile(s.characterId);if(!p)return null;
  const selected=selectedDrawing(p,s);if(!selected)return null;
  const {action,drawing}=selected;
  // Native-timed strips retain their exact renderer selection, including the
  // existing loop-endpoint suppression. Metadata does not invent new windows.
  const receiving=drawing.clip.hurtboxPoses?.find(row=>row.artFrameIndex===drawing.artFrameIndex);
  if(!receiving)return null; // explicit baseline until a paired row is installed
  if(receiving.nativeSample!==drawing.nativeSample)
    throw new Error(`${p.label} ${action.state} receiving sample disagrees with its rendered drawing`);
  const basis=(action.facing??s.facing)*s.facing;
  const boxes=receiving.hurtboxes.map(h=>({...h,offsetX:h.offsetX*basis,...(h.capsule?{capsule:{start:{x:h.capsule.start.x*basis,y:h.capsule.start.y},end:{x:h.capsule.end.x*basis,y:h.capsule.end.y},radius:h.capsule.radius}}:{})}));
  if(s.packedBody.surfaceTech?.protected)return boxes.map(h=>({...h,intangible:true}));
  if(s.packedBody.committed){const state=s.packedBody.committed;if(state.framesElapsed<(state.protectionFrames??0))return boxes.map(h=>({...h,intangible:true}));}
  return applyDonkeyKongMoveProtection(boxes,s.activeAttack?.move??null,s.activeAttack?.framesElapsed??0);
}
/** Same selected drawing as receiving; points retain historical BODY-CENTRE coordinates. */
export function selectPackedHeadContact(s:SimulationAnimationSnapshot):{x:number;y:number}|null {
  const p=packedBodyProfile(s.characterId);if(!p)return null;
  const selected=selectedDrawing(p,s);if(!selected)return null;
  const {action,drawing}=selected;
  const row=drawing.clip.hurtboxPoses?.find(r=>r.artFrameIndex===drawing.artFrameIndex);
  if(!row?.headContact)return null;
  const h=row.headContact;
  if(row.nativeSample!==drawing.nativeSample||!h.reviewKey||!Number.isFinite(h.point.x)||!Number.isFinite(h.point.y))
    throw new Error(`Invalid same-drawing ${p.label} anatomical head contact`);
  return {x:h.point.x*(action.facing??s.facing),y:h.point.y};
}
/** Geometry alone is paired to the body drawing. Native IDs, timing and all
 * interaction/launch scalars remain on the active source collision records. */
export function getPackedAttackCollisionPose(s:SimulationAnimationSnapshot) {
  const p=packedBodyProfile(s.characterId);if(!p)return null;
  const action=pairedBodyAction(p,s);if(!action||action.frame===undefined)return null;
  const drawing=bodyDrawing(p,action.sheets[0]!,action.frame)!;
  if(!drawing.clip.attackCollisionPoses)return null;
  const pose=drawing.clip.attackCollisionPoses.find(row=>row.artFrameIndex===drawing.artFrameIndex);
  if(!pose||pose.nativeSample!==drawing.nativeSample)throw new Error(`${p.label} ${action.state} attack pose is not paired to drawing ${drawing.artFrameIndex}`);
  const ids=new Set<number>();
  for(const hit of pose.collisionHits){
    const c=hit.capsule;
    if(ids.has(hit.id)||!Number.isInteger(hit.id)||hit.id<0||!Number.isFinite(c.radius)||c.radius<=0||
      ![c.start.x,c.start.y,c.end.x,c.end.y].every(Number.isFinite))throw new Error(`Invalid ${p.label} ${action.state} paired attack geometry`);
    ids.add(hit.id);
  }
  return {...pose,sheet:action.state,gameplayAge:s.activeAttack?.framesElapsed??action.frame,sourceActionAge:drawing.localFrame,facing:action.facing??s.facing};
}
/** Where a sheet's drawing is rooted and how big it is; null for a clip without a root (or a fighter without a profile). */
export function getPackedBodyRenderMetrics(fighter:CharacterId,sheet:string){
  const p=packedBodyProfile(fighter),clip=p?.clips[sheet];if(!p||!clip?.root||clip.scaleToWorld===undefined)return null;
  return{originX:clip.root[0]!/clip.frameWidth,originY:clip.root[1]!/clip.frameHeight,scaleToWorld:clip.scaleToWorld,bodyCentreFromRootY:clip.bodyCentreFromRootY??p.bodyCentreFromRootY};
}
/** CATCH geometry follows the same selected drawing/receiving snapshot.
 * Missing or bad active rows retain parent source capture, explicitly fallback.
 * No clocks, source phase lifetime, receiving or recipient anchors mutate here. */
export function getPackedCatchCollisionPose(s:SimulationAnimationSnapshot):DonkeyKongCatchPoseSelection|null {
  const P=packedBodyProfile(s.characterId);
  if(!P||s.grab.name!=='whiffActive'||!s.grabPresentation)return null;
  const p=s.grabPresentation;
  const candidate=bodyCandidate(P,s);
  const full=completeStandingGrab(P,s);
  const sheet=full?.sheet??grabSheet(P,p.variant,p.framesElapsed);
  const clip=P.clips[sheet];
  const rows=sheet==='grab'&&isCompleteStandingGrabCandidate(clip)&&!full?undefined:clip?.catchCollisionPoses;
  let drawing:ReturnType<typeof bodyDrawing>=null;
  if(rows!==undefined&&candidate?.sheet===sheet){
    try{drawing=bodyDrawing(P,sheet,candidate.age??p.framesElapsed);}
    catch{drawing=null;}
  }
  return readDonkeyKongCatchPose({sheet,sourceGameplayAge:full?.sourceAge??p.framesElapsed,
    facing:candidate?.facing??p.facing,rows,drawing});
}
