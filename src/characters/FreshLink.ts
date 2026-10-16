import {parseLinkTauntEquipmentInput,selectLinkTauntEquipment,type LinkTauntEquipmentMotion} from './linkTauntEquipment';
import {admitLinkCaptureEquipmentOwner,stepLinkCaptureEquipmentLease,parseLinkCaptureEquipmentLease,type LinkCaptureEquipmentLease} from './linkCaptureEquipmentLease';
import {selectLinkCaptureActionEquipment} from './linkCaptureActionEquipment';
import {beginLinkLandingPresentationLease,stepLinkLandingPresentationLease,parseLinkLandingPresentationLease,type LinkLandingPresentationLease} from './linkLandingPresentationLease';
import {selectLinkLandingEquipment} from './linkLandingEquipment';
/** Fresh Ultimate runtime. Missing paired geometry remains an installation
 * dependency; it cannot inherit historical Link reach/receiving. */
import {selectLinkShieldTilt} from './linkShieldTilt';
import {beginLinkGuardReleasePresentation,stepLinkGuardReleasePresentation,selectLinkGuardReleasePresentation,parseLinkGuardReleasePresentation,type LinkGuardReleasePresentation} from './linkGuardReleasePresentation';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { ContractFighter } from './contractFighter';
import {beginLinkContextualPresentation,observeLinkContextualPresentation,stepLinkEntryPresentation,selectLinkEntryPresentation,selectLinkContextualPresentation,parseLinkContextualPresentationState,linkEntryEquipment,type LinkContextualPresentationState} from './linkContextualPresentation';
import type { CharacterInput, CharacterOptions, CharacterTuning, CharacterHitOutcome } from './Character';
import { OFFENSIVE_ACTION_BUFFER_FRAMES } from './Character';
import type { AttackMove,ActiveAttack } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import { registerFighterAttack } from './attackRegistration';
import { FRESH_LINK_NORMALS } from './linkFreshNormals';
import { LINK_NORMAL_RULES,linkNormalContinuation,type LinkNormalId } from './linkNormalRules';
import { linkSourceNormalId,linkSourceIntrinsicId,linkSourceRecoveryId,parseLinkSourcePoseId,type LinkSourceMoveId } from './linkSourceMoveIdentity';
import { linkNormalNativeFrame,linkNormalScriptNativeFrame } from './linkNormalBodyClock';
import {beginLinkItemContextEquipment,stepLinkItemContextEquipment,selectLinkItemContextEquipment,parseLinkItemContextEquipmentState,LINK_ITEM_CONTEXT_EQUIPMENT_FACTS,type LinkItemContextEquipmentState,type LinkItemContextMotion} from './linkItemContextEquipment';
import type {ItemAction} from '../items/itemActions';
import type {DonkeyKongHeavyItemAction} from './donkeykongHeavyItems';
import { LINK_NORMAL_EQUIPMENT,linkPassiveShieldEligible,type LinkEquipmentState,type LinkPassiveShieldPose } from './linkEquipment';
import { linkPassiveShieldSurfaces,linkPassiveShieldWorldSurfaces } from './linkPassiveShield';
import type { LinkAncientFinalEvent } from './linkAncientFinal';
import { beginLinkBow,beginLinkBoomerang,beginLinkBoomerangCatch,beginLinkBomb,admitLinkSpecial,stepLinkSpecial,linkSpecialChargePresentation,
  type LinkSpecialState,type LinkSpecialEvent } from './linkSpecialController';
import { beginLinkSpin,admitLinkSpin,stepLinkSpin,linkAirSpinContactPolicy,LINK_SPIN_SOURCE,type LinkSpinState,type LinkSpinEvent } from './linkSpinController';
import {linkRecoveryAttackSource,linkRecoveryAttackNativeFrame} from './linkFreshRecoveryAttacks';
import {linkSpecialBodyRoute,linkSpinBodyRoute} from './linkIntrinsicPresentation';
import {beginLinkOwnBowArticle,parseLinkOwnBowArticleLease,type LinkOwnBowArticleLease} from './linkOwnBowArticle';
import {parseLinkNormalEquipmentInput,selectLinkNormalEquipment,selectLinkNormalMotionGearOverride,type LinkNormalEquipmentId} from './linkNormalEquipment';
import {parseLinkIntrinsicEquipmentInput,selectLinkIntrinsicEquipment,type LinkIntrinsicEquipmentMotion} from './linkIntrinsicEquipment';
import {selectLinkDamagePresentation} from './linkDamagePresentation';
import {advanceLinkAirPresentation,selectLinkAirPresentation,parseLinkAirPresentationState,type LinkAirPresentationState} from './linkAirPresentation';
import {linkSpinTiming,linkSpinSourceState} from './linkSpinTiming';
import {tuneArrowPlan,tuneBeamPlan,selectLinkIntrinsicAuthoringMetadata,parseLinkIntrinsicAuthoringMetadata,parseLinkIntrinsicAuthoringMove,type LinkIntrinsicAuthoringMetadata} from './linkIntrinsicAuthoring';
import {selectLinkSpinContact} from './linkSpinContactSelection';
import {parseLinkArrowLaunchPlan,parseLinkSwordBeamPlan} from './linkArticlePlanValidation';
import {parseLinkSpecialState,parseLinkSpinState,parseLinkRemoteBombState} from './linkIntrinsicStateValidation';
import { linkAirSpinAttributes } from './linkMovement';
import {linkSwordBeamPlan,type LinkSwordBeamPlan} from './linkSwordBeam';
import type { LinkRemoteBombState } from './linkRemoteBomb';
import type { HeldItemHandle } from '../items/ItemDefinition';
import { computeChargeTFromSpec } from './chargeSchema';
import { LINK_MOVESET,LINK_MOVEMENT_PROFILE,LINK_FIGHTER_CONTRACT,LINK_TUNING,LINK_GRAB,
  LINK_NEUTRAL_SPECIAL,LINK_SIDE_SPECIAL,LINK_UP_SPECIAL,LINK_DOWN_SPECIAL,LINK_UTILT,LINK_DTILT,
  LINK_USMASH,LINK_DSMASH,LINK_DASHATTACK,LINK_TAUNTS,FRESH_LINK_RECOVERY_ATTACKS } from './linkFreshKit';
import { linkCommonBodyRoute,type LinkCommonBodyRoute } from './linkCommonBodyRoute';
import { beginLinkCommonPresentation,stepLinkCommonPresentation,selectLinkCommonPresentation,parseLinkCommonPresentationState,type LinkCommonPresentationState } from './linkCommonPresentationController';
export interface LinkOptions extends CharacterTuning, Pick<CharacterOptions,'slotIndex'> {readonly spawnX:number;readonly spawnY:number;}
export interface LinkRuntimeEvent {readonly frame:number;readonly generation:number;readonly facing:1|-1;
  readonly actionId:string;readonly moveId:string;readonly attackToken?:object;readonly authoringMove?:AttackMove;
  readonly authoring?:LinkIntrinsicAuthoringMetadata;readonly authoredCollisionDamageFactor?:number;readonly event:LinkSpecialEvent|LinkSpinEvent|{readonly kind:'sword-beam';readonly plan:LinkSwordBeamPlan};}
interface SourceBodyTail {motion:string;rawAge:number;facing:1|-1;grounded:boolean;entryFrame:number;endAgeExclusive:number;
  origin:{moveId:string;sourcePoseId:string;entryFrame:number;generation:number};}
// Raw animation extents +1; these are presentation fallback facts, never FAF.
const INTRINSIC_TAIL_EXTENTS:Readonly<Record<string,number>>=Object.freeze({special_n_end:52,special_air_n_end:52,
  special_s1:64,special_air_s1:64,special_s1_blank:64,special_air_s1_blank:64,special_s2:32,special_air_s2:32,
  special_hi:92,special_lw:70,special_air_lw:70,special_lw_blast:61,special_air_lw_blast:61});
interface IntrinsicEquipmentLease {motion:LinkIntrinsicEquipmentMotion;equipmentAtEntry:LinkEquipmentState;origin:SourceBodyTail['origin'];}
interface TauntEquipmentLease {motion:LinkTauntEquipmentMotion;ownerKey:string;entryFrame:number;generation:number;equipmentAtEntry:LinkEquipmentState;}
interface NormalEquipmentLease {id:LinkNormalEquipmentId;equipmentAtEntry:LinkEquipmentState;origin:SourceBodyTail['origin'];phase:'active'|'charge'|'tail';}
interface NormalTail {id:LinkNormalId;age:number;facing:1|-1;move:AttackMove;hitConfirmed:boolean;chargeHeldFrames:number|null;}
interface SourceLinkItemIdentity {readonly entityId:number;readonly entityGeneration:number;readonly actorGeneration:number;readonly frame:number;}
interface SourceLinkPickupIdentity extends SourceLinkItemIdentity {readonly committed:boolean;}
interface SourceItemContextOwner {readonly kind:'battering'|'hammer';readonly serial:number;readonly moveId:string|null;readonly phase:'active'|'charge'|'hammer';readonly motion:string;}
export interface LinkIntrinsicRuntimeSnapshot {
  readonly schema:'fresh-link-runtime/1';readonly generation:number;readonly sourceSpecial:LinkSpecialState|null;
  readonly sourceSpin:LinkSpinState|null;readonly sourceFacing:1|-1;readonly sourceEntryFrame:number;readonly sourceGeneration:number;
  readonly sourceFrame:number;readonly sourceActionMove:AttackMove|null;readonly runtimeEvents:readonly LinkRuntimeEvent[];readonly remoteBomb:LinkRemoteBombState|null;
  readonly tauntEquipmentLease:TauntEquipmentLease|null;readonly captureEquipmentLease:LinkCaptureEquipmentLease|null;readonly landingEquipmentLease:LinkLandingPresentationLease|null;readonly normalEquipmentLease:NormalEquipmentLease|null;readonly intrinsicEquipmentLease:IntrinsicEquipmentLease|null;readonly sourceBowArticlePresent:boolean;readonly sourceOwnBowLease:LinkOwnBowArticleLease|null;
  readonly boomerangPresent:boolean;readonly equipment:LinkEquipmentState;readonly normalTail:NormalTail|null;readonly sourceBodyTail:SourceBodyTail|null;
  readonly normalHitConfirmed:boolean;readonly previousAttackHeld:boolean;readonly normalTapBuffer:number;readonly lastStickX:number;readonly sourceFlickAge:number;
  readonly sourceFlickSmash:boolean;readonly sourceStickY:number;readonly sourceRawSpecialHeld:boolean;readonly sourceSpinVelocityY:number|null;readonly sourceLandingFrames:number|null;
  readonly sourceKineticFrame:number;readonly normalBeamIssued:boolean;readonly guardReleasePresentation:LinkGuardReleasePresentation|null;
  readonly shieldTiltInput:{readonly moveX:number;readonly moveY:number;readonly facing:1|-1}|null;readonly commonPresentation:LinkCommonPresentationState;
  readonly sourceAirPresentation:LinkAirPresentationState|null;
  readonly contextualPresentation:LinkContextualPresentationState|null;
  readonly lightPickupIdentity:SourceLinkPickupIdentity|null;readonly temporaryFoodIdentity:SourceLinkItemIdentity|null;
  readonly itemContextEquipment:LinkItemContextEquipmentState|null;
  readonly itemContextOwner:SourceItemContextOwner|null;readonly itemContextOwnerSerial:number;
  readonly spinContacts:readonly {strike:string;targets:readonly number[]}[];
}
export class Link extends ContractFighter {
  readonly moveset=LINK_MOVESET;readonly movementProfile=LINK_MOVEMENT_PROFILE;readonly contract=LINK_FIGHTER_CONTRACT;
  private tauntEquipmentLease:TauntEquipmentLease|null=null;
  private captureEquipmentLease:LinkCaptureEquipmentLease|null=null;
  private landingEquipmentLease:LinkLandingPresentationLease|null=null;
  private sourceSpecial:LinkSpecialState|null=null;
  private sourceSpin:LinkSpinState|null=null;
  private sourceFacing:1|-1=1;private sourceEntryFrame=-1;private sourceGeneration=0;private sourceFrame=0;
  private readonly runtimeEvents:LinkRuntimeEvent[]=[];
  private remoteBomb:LinkRemoteBombState|null=null;private boomerangPresent=false;
  private equipment:LinkEquipmentState={...LINK_NORMAL_EQUIPMENT};
  private normalEquipmentLease:NormalEquipmentLease|null=null;private normalEquipmentToken:object|null=null;
  private intrinsicEquipmentLease:IntrinsicEquipmentLease|null=null;private sourceBowArticlePresent=false;private sourceOwnBowLease:LinkOwnBowArticleLease|null=null;
  private sourceBodyTail:SourceBodyTail|null=null;private normalTail:NormalTail|null=null;private normalHitConfirmed=false;private previousAttackHeld=false;private normalTapBuffer=0;
  private sourceStickY=0;private sourceRawSpecialHeld=false;
  private lastStickX=0;private sourceFlickAge=Number.MAX_SAFE_INTEGER;private sourceFlickSmash=false;
  private sourceActionMove:AttackMove|null=null;private requestedSourceMove:AttackMove|null=null;
  private sourceActionToken:object={};private readonly spinStrikeTokens=new Map<string,object>();
  private readonly spinContacts=new Map<string,Set<number>>();
  private sourceSpinVelocityY:number|null=null;private sourceLandingFrames:number|null=null;
  private sourceKineticFrame=-1;private normalBeamIssued=false;
  private contextualPresentation:LinkContextualPresentationState|null=null;
  private lightPickupIdentity:SourceLinkPickupIdentity|null=null;private temporaryFoodIdentity:SourceLinkItemIdentity|null=null;
  private itemContextEquipment:LinkItemContextEquipmentState|null=null;
  private itemContextOwner:SourceItemContextOwner|null=null;private itemContextOwnerToken:object|null=null;private itemContextOwnerSerial=0;
  private guardReleasePresentation:LinkGuardReleasePresentation|null=null;
  private shieldTiltInput:{moveX:number;moveY:number;facing:1|-1}|null=null;
  private commonPresentation=beginLinkCommonPresentation(0);private sourceAirPresentation:LinkAirPresentationState|null=null;
  constructor(scene:PhysicsHost,options:LinkOptions){
    super(scene,{id:'link',...LINK_TUNING,...options});
    for(const move of [...Object.values(FRESH_LINK_NORMALS),...Object.values(FRESH_LINK_RECOVERY_ATTACKS)])registerFighterAttack(this,move);
    for(const move of [LINK_NEUTRAL_SPECIAL,LINK_SIDE_SPECIAL,LINK_UP_SPECIAL,LINK_DOWN_SPECIAL])registerFighterAttack(this,move);
    this.setUpTilt(LINK_UTILT.id);this.setDownTilt(LINK_DTILT.id);this.setUpSmash(LINK_USMASH.id);
    this.setDownSmash(LINK_DSMASH.id);this.setDashAttack(LINK_DASHATTACK.id);this.setGrabSpec(LINK_GRAB);
    this.setTauntSpec(LINK_TAUNTS);
  }
  override addAttack(move:AttackMove){
    if(move.sourcePoseId!==undefined)parseLinkSourcePoseId(move.sourcePoseId,`move ${move.id}.sourcePoseId`);
    super.addAttack(move);
  }
  private currentSourceMove(id:LinkSourceMoveId):AttackMove|undefined {
    // Later authored registration supersedes compiled source records without
    // changing the user's actual input/queue identity.
    return [...this.attacks.values()].reverse().find(m=>m.sourcePoseId===id);
  }
  protected override sourceIntrinsicActionCommitted(){return this.sourceSpecial!==null||this.sourceSpin!==null;}
  protected override onSourcePositionReset():void {
    this.tauntEquipmentLease=null;this.captureEquipmentLease=null;this.normalEquipmentLease=null;this.normalEquipmentToken=null;this.guardReleasePresentation=null;this.shieldTiltInput=null;this.intrinsicEquipmentLease=null;this.sourceBowArticlePresent=false;this.sourceOwnBowLease=null;this.finishSourceAction();this.runtimeEvents.length=0;this.normalTail=null;this.sourceBodyTail=null;
    this.sourceGeneration=this.getPositionResetGeneration();this.sourceEntryFrame=-1;
    this.commonPresentation=beginLinkCommonPresentation(this.sourceGeneration);this.sourceAirPresentation=null;this.landingEquipmentLease=null;
    this.contextualPresentation=null;this.lightPickupIdentity=null;this.temporaryFoodIdentity=null;this.itemContextEquipment=null;
    this.itemContextOwner=null;this.itemContextOwnerToken=null;this.itemContextOwnerSerial=0;
    this.normalBeamIssued=false;this.normalHitConfirmed=false;this.previousAttackHeld=false;this.normalTapBuffer=0;
    this.sourceSpinVelocityY=null;this.sourceLandingFrames=null;this.spinStrikeTokens.clear();this.spinContacts.clear();
    this.equipment={...LINK_NORMAL_EQUIPMENT};this.reconcileEquipment();
  }
  protected override sourceRecoveryAttack(lineage:string){return [...this.attacks.values()].reverse().find(m=>linkSourceRecoveryId(m)===lineage)??super.sourceRecoveryAttack(lineage);}
  override isSourceVelocityControlled(){return super.isSourceVelocityControlled()||this.sourceSpin!==null;}
  override isSourceIntrinsicJostleDisabled(){return (this.sourceSpin?linkAirSpinContactPolicy(linkSpinSourceState(this.sourceSpin,this.sourceActionMove))?.jostle===false:false);}
  protected override sourceIntrinsicLedgePolicy(){const policy=this.sourceSpin?linkAirSpinContactPolicy(linkSpinSourceState(this.sourceSpin,this.sourceActionMove)):null;
    return policy?{front:policy.frontLedge,back:policy.backLedge,allowRise:true}:null;}
  override canAttack(){return this.sourceSpecial===null&&this.sourceSpin===null&&super.canAttack();}
  override canUseItemsBeforeInput(){return this.sourceSpecial===null&&this.sourceSpin===null&&super.canUseItemsBeforeInput();}
  override equipItem(item:HeldItemHandle){super.equipItem(item);this.reconcileEquipment();}
  override unequipItem(){super.unequipItem();this.reconcileEquipment();}
  override resetForRound(x:number,y:number){super.resetForRound(x,y);this.reconcileEquipment();}
  private clearItemContextOwner():void {this.itemContextEquipment=null;this.itemContextOwner=null;this.itemContextOwnerToken=null;}
  /** The bow, boomerang or bomb phase, or the spin before its helpless fall, on its source motion clock. */
  private intrinsicBodyRoute(){
    if(this.sourceSpecial)return linkSpecialBodyRoute(this.sourceSpecial,{grounded:this.isGrounded(),facing:this.sourceFacing,
      move:this.sourceActionMove,chargeMaxFrames:this.sourceChargeSpec()?.maxChargeFrames});
    if(!this.sourceSpin||this.sourceSpin.phase==='helpless'||this.sourceSpin.phase==='done')return null;
    return linkSpinBodyRoute(linkSpinSourceState(this.sourceSpin,this.sourceActionMove),this.sourceFacing);
  }
  /** The packed body's Link-owned motion: the match entry, else the special's phase. */
  protected override getPackedIntrinsicBody(){
    const entry=this.contextualPresentation?.entry,route=entry?selectLinkEntryPresentation(entry):this.intrinsicBodyRoute();
    return route&&{sheet:route.motion,age:route.rawAge,facing:route.facing};
  }
  private intrinsicEquipmentRoute(){
    if(!this.sourceSpecial&&(this.sourceSpin?.phase==='helpless'||this.sourceSpin?.phase==='done'))return null;
    return this.intrinsicBodyRoute()??(this.sourceBodyTail?{motion:this.sourceBodyTail.motion,rawAge:this.sourceBodyTail.rawAge,facing:this.sourceBodyTail.facing}:null);
  }
  private syncIntrinsicEquipment(){
    const route=this.intrinsicEquipmentRoute(),origin=this.sourceBodyTail?.origin??this.sourceTailOrigin();
    if(!route||!origin){this.intrinsicEquipmentLease=null;return null;}
    const prior=this.intrinsicEquipmentLease;
    if(!prior||prior.origin.generation!==origin.generation||prior.origin.entryFrame!==origin.entryFrame||prior.origin.moveId!==origin.moveId||prior.motion!==route.motion)
      this.intrinsicEquipmentLease={origin:{...origin},motion:route.motion as LinkIntrinsicEquipmentMotion,equipmentAtEntry:{...this.equipment}};
    const selected=selectLinkIntrinsicEquipment({motion:this.intrinsicEquipmentLease!.motion,rawAge:route.rawAge,
      equipmentAtEntry:this.intrinsicEquipmentLease!.equipmentAtEntry,bowArticlePresent:this.sourceBowArticlePresent});
    this.equipment={...selected.equipment};return selected;
  }
  private normalEquipmentOwner(){
    if(this.sourceSpecial||this.sourceSpin||this.sourceBodyTail||this.getFinalSmashControl()||this.isInHitstun()||this.isGrabbed())return null;
    const charge=this.getNormalChargePresentationOwner(),chargeMove=charge?this.getAttack(charge.moveId):null,
      chargeId=chargeMove?linkSourceNormalId(chargeMove):null;
    if(charge&&chargeMove&&chargeId){const holdId=chargeId==='link.smash'?'link.smash_hold':chargeId==='link.usmash'?'link.usmash_hold':chargeId==='link.dsmash'?'link.dsmash_hold':null;
      return {id:(holdId&&charge.heldFrames>0?holdId:chargeId) as LinkNormalEquipmentId,phase:'charge' as const,
        move:chargeMove,token:charge.token,scriptNativeFrame:holdId&&charge.heldFrames>0?charge.heldFrames:
          linkNormalScriptNativeFrame(chargeId,charge.startupElapsed)};}
    const active=super.getActiveAttack(),id=active?linkSourceNormalId(active.move):null;
    if(active&&id)return{id,phase:'active' as const,move:active.move,token:this.getNormalAttackPresentationOwner()!.token,
      scriptNativeFrame:linkNormalScriptNativeFrame(id,active.framesElapsed)};
    const tail=this.normalTail;
    if(this.getItemActionState()||this.getItemShootingPresentation()||this.getRecoveryPresentation()||this.itemContextEquipment||
      this.getDonkeyKongHeavyItemActionState()||this.getHammerPresentation()||this.getGrabState().active||this.getThrowPresentationState()||
      this.getTauntPresentationState()||this.getJumpsquatRemaining()>0||this.getLandingPresentationState()||this.isShielding()||
      !['idle','cooldown'].includes(this.getDodgeState().name))return null;
    if(tail)return{id:tail.id,phase:'tail' as const,move:tail.move,token:null,
      scriptNativeFrame:linkNormalScriptNativeFrame(tail.id,tail.age)};
    return null;
  }
  private inventoryEquipmentBaseline():LinkEquipmentState {
    const held=this.getEquippedItem();return {...this.equipment,shield:held?'back':'normal',
      sword:held?.definition.heavy||held?.definition.hammer?'back':'normal',
      bow:this.sourceBowArticlePresent?'back':'hidden',heldItemVisible:true,ancientBowVisible:false};
  }
  private syncNormalEquipment(){
    const owner=this.normalEquipmentOwner(),prior=this.normalEquipmentLease;
    if(!owner){this.normalEquipmentLease=null;this.normalEquipmentToken=null;return;}
    const sameGeneration=prior?.origin.generation===this.getPositionResetGeneration(),
      sameTransaction=sameGeneration&&prior?.origin.moveId===owner.move.id&&
        (owner.phase==='tail'||this.normalEquipmentToken===owner.token||prior.phase==='charge'&&owner.phase==='active');
    if(!sameTransaction||prior!.id!==owner.id){const inherited=sameTransaction?this.equipment:null;
      this.normalEquipmentLease={id:owner.id,phase:owner.phase,
        origin:sameTransaction?{...prior!.origin}:{moveId:owner.move.id,sourcePoseId:owner.move.sourcePoseId??owner.id,
          entryFrame:this.sourceFrame,generation:this.getPositionResetGeneration()},
        equipmentAtEntry:{...(inherited??this.inventoryEquipmentBaseline())}};
    }else this.normalEquipmentLease={...prior!,phase:owner.phase};
    this.normalEquipmentToken=owner.token;
  }
  getSourceNormalEquipmentPresentationState(){
    const owner=this.normalEquipmentOwner(),lease=this.normalEquipmentLease;
    if(!owner||!lease||lease.id!==owner.id||lease.origin.moveId!==owner.move.id||lease.origin.generation!==this.getPositionResetGeneration()||
      owner.phase!=='tail'&&this.normalEquipmentToken!==owner.token)return null;
    const selected=this.selectNormalRuntimeEquipment({id:owner.id,scriptNativeFrame:owner.scriptNativeFrame,equipmentAtEntry:lease.equipmentAtEntry});
    return {...selected,id:owner.id,scriptNativeFrame:owner.scriptNativeFrame,phase:owner.phase,origin:{...lease.origin},equipmentAtEntry:{...lease.equipmentAtEntry}};
  }
  private selectNormalRuntimeEquipment(input:Parameters<typeof selectLinkNormalEquipment>[0]){
    const selected=selectLinkNormalEquipment(input),motionPlacementOverride=selectLinkNormalMotionGearOverride({
      id:input.id,unheld:this.getEquippedItem()===null});
    // Keep reviewed motion placement separate from captured expression deltas/events.
    return {...selected,equipment:motionPlacementOverride?{...selected.equipment,...motionPlacementOverride.changes}:selected.equipment,
      authoredMotionGearOverride:motionPlacementOverride,motionPlacementOverride};
  }
  protected override notifySourceAerialLandingAdmitted(receipt:{readonly frame:number;readonly generation:number;readonly moveId:string;readonly sourcePoseId:string|null;readonly facing:1|-1;readonly landingLagFrames:number}):void {
    this.landingEquipmentLease=null;this.normalEquipmentLease=null;this.normalEquipmentToken=null;
    this.normalTail=null;this.sourceBodyTail=null;this.intrinsicEquipmentLease=null;this.clearItemContextOwner();
    this.equipment=this.inventoryEquipmentBaseline();
    this.landingEquipmentLease=beginLinkLandingPresentationLease({...receipt,equipmentAtEntry:this.equipment});
    this.reconcileEquipment();
  }
  private actualLandingControlMatches(state:LinkLandingPresentationLease){const landing=this.getLandingPresentationState();
    return landing?.kind==='aerial'&&landing.entryFrame===state.origin.entryFrame&&landing.moveId===state.origin.moveId&&
      landing.sourcePoseId===state.origin.sourcePoseId;}
  private landingHasNewOwner(){return !this.isGrounded()||this.isInHitstun()||this.isGrabbed()||this.getFinalSmashControl()!==null||
    super.getActiveAttack()!==null||super.getAnimationActionState().chargingMove!==null||this.sourceSpecial!==null||this.sourceSpin!==null||
    this.getItemActionState()!==null||this.getItemShootingPresentation()!==null||this.getRecoveryPresentation()!==null||this.itemContextEquipment!==null||
    this.getThrowPresentationState()!==null||this.getGrabState().active!==null||this.getTauntPresentationState()!==null||
    this.getJumpsquatRemaining()>0||this.isShielding()||this.getShieldPresentationState()!==null||
    !['idle','cooldown'].includes(this.getDodgeState().name)||['hanging','climbing','rolling'].includes(this.getLedgeHangState().name)||
    this.getSourceShieldBreakPresentationState()!==null;}
  getSourceLandingEquipmentPresentationState(){const state=this.landingEquipmentLease;
    if(!state||state.origin.generation!==this.getPositionResetGeneration()||this.landingHasNewOwner())return null;
    return {...selectLinkLandingEquipment({motion:state.motion,scriptNativeFrame:state.rawAge,equipmentAtEntry:state.equipmentAtEntry}),
      scriptNativeFrame:state.rawAge,rawAge:state.rawAge,phase:this.actualLandingControlMatches(state)?'control':'tail',
      origin:{...state.origin},facing:state.facing,equipmentAtEntry:{...state.equipmentAtEntry}};
  }
  override getSourceLinkLandingPresentationRoute(){const state=this.getSourceLandingEquipmentPresentationState();
    return state?{motion:state.motion,rawAge:state.rawAge,facing:state.facing,terminal:true}:null;}
  private advanceSourceLandingEquipment(input:CharacterInput,clockAdvances:boolean){const state=this.landingEquipmentLease;if(!state)return;
    const controlActive=this.actualLandingControlMatches(state),tailInput=!controlActive&&
      (Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1);
    this.landingEquipmentLease=stepLinkLandingPresentationLease(state,{frame:this.sourceFrame,generation:this.getPositionResetGeneration(),clockAdvances,
      controlActive,interrupted:this.landingHasNewOwner()||tailInput});
  }
  protected override notifySourceTauntEquipmentOwnerChanged():void {this.syncTauntEquipment();this.reconcileEquipment();}
  private syncTauntEquipment(){const owner=this.getSourceTauntPresentationOwner(),prior=this.tauntEquipmentLease;
    if(!owner){this.tauntEquipmentLease=null;return;}
    if(!prior||prior.ownerKey!==owner.ownerKey||prior.generation!==owner.generation){
      this.captureEquipmentLease=null;this.normalEquipmentLease=null;this.normalEquipmentToken=null;this.normalTail=null;
      this.sourceBodyTail=null;this.intrinsicEquipmentLease=null;this.landingEquipmentLease=null;this.clearItemContextOwner();
      this.equipment=this.inventoryEquipmentBaseline();
      this.tauntEquipmentLease={motion:owner.motion,ownerKey:owner.ownerKey,entryFrame:owner.entryFrame,generation:owner.generation,equipmentAtEntry:{...this.equipment}};
    }
  }
  getSourceTauntEquipmentPresentationState(){const state=this.tauntEquipmentLease,owner=this.getSourceTauntPresentationOwner();
    if(!state||!owner||state.ownerKey!==owner.ownerKey||state.generation!==this.getPositionResetGeneration()||this.isInHitstun()||this.isGrabbed()||this.getFinalSmashControl())return null;
    return {...selectLinkTauntEquipment({motion:state.motion,scriptNativeFrame:owner.rawAge+1,equipmentAtEntry:state.equipmentAtEntry}),
      rawAge:owner.rawAge,scriptNativeFrame:owner.rawAge+1,facing:owner.facing,phase:owner.rawAge>=owner.cancelAfterFrames?'tail':'control',
      origin:{ownerKey:state.ownerKey,entryFrame:state.entryFrame,generation:state.generation},equipmentAtEntry:{...state.equipmentAtEntry}};
  }
  protected override notifySourceCaptureEquipmentOwnerChanged():void {this.syncCaptureEquipment();this.reconcileEquipment();}
  private captureGearHasNewOwner(){return !this.isGrounded()&&this.getSourceCaptureEquipmentOwner()===null||this.isGrabbed()||this.isInHitstun()||this.getFinalSmashControl()!==null||
    super.getActiveAttack()!==null||super.getAnimationActionState().chargingMove!==null||this.sourceSpecial!==null||this.sourceSpin!==null||
    this.getItemActionState()!==null||this.getItemShootingPresentation()!==null||this.getRecoveryPresentation()!==null||this.itemContextEquipment!==null||
    this.getJumpsquatRemaining()>0||this.isShielding()||this.getShieldPresentationState()!==null||this.getTauntPresentationState()!==null||
    this.getLandingPresentationState()!==null||!['idle','cooldown'].includes(this.getDodgeState().name)||
    ['hanging','climbing','rolling'].includes(this.getLedgeHangState().name)||
    this.getSourceShieldBreakPresentationState()!==null;}
  private syncCaptureEquipment(){const owner=this.getSourceCaptureEquipmentOwner(),prior=this.captureEquipmentLease;if(!owner)return;
    if(prior?.ownerKey!==owner.ownerKey||prior.motion!==owner.motion||prior.generation!==owner.generation){
      const current={...this.equipment};this.normalEquipmentLease=null;this.normalEquipmentToken=null;this.normalTail=null;
      this.sourceBodyTail=null;this.intrinsicEquipmentLease=null;this.landingEquipmentLease=null;this.clearItemContextOwner();
      this.captureEquipmentLease=admitLinkCaptureEquipmentOwner(prior,owner,this.sourceFrame,this.inventoryEquipmentBaseline(),current);
    }else this.captureEquipmentLease=stepLinkCaptureEquipmentLease(prior,{frame:this.sourceFrame,generation:this.getPositionResetGeneration(),clockAdvances:false,owner,interrupted:false});
  }
  getSourceCaptureEquipmentPresentationState(){const state=this.captureEquipmentLease,owner=this.getSourceCaptureEquipmentOwner();
    if(!state||state.generation!==this.getPositionResetGeneration()||this.captureGearHasNewOwner()||
      state.phase==='control'&&(!owner||owner.ownerKey!==state.ownerKey||owner.motion!==state.motion||owner.rawAge!==state.rawAge||owner.captureKey!==state.captureKey)||
      state.phase==='tail'&&owner!==null)return null;
    return {...selectLinkCaptureActionEquipment({motion:state.motion,scriptNativeFrame:state.rawAge+1,equipmentAtEntry:state.equipmentAtEntry}),
      scriptNativeFrame:state.rawAge+1,rawAge:state.rawAge,facing:state.facing,phase:state.phase,
      origin:{ownerKey:state.ownerKey,groupKey:state.groupKey,captureKey:state.captureKey,entryFrame:state.entryFrame,generation:state.generation},equipmentAtEntry:{...state.equipmentAtEntry}};
  }
  override getSourceLinkCaptureActionPresentationRoute(){const state=this.getSourceCaptureEquipmentPresentationState();
    return state?{motion:state.motion,rawAge:state.rawAge,facing:state.facing,terminal:state.motion!=='catch_wait'}:null;}
  private advanceSourceCaptureEquipment(input:CharacterInput,clockAdvances:boolean){this.syncCaptureEquipment();const state=this.captureEquipmentLease;if(!state)return;
    const owner=this.getSourceCaptureEquipmentOwner(),legalInput=owner===null&&super.canUseItemsBeforeInput()&&
      (Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1||this.getJumpsquatRemaining()>0);
    this.captureEquipmentLease=stepLinkCaptureEquipmentLease(state,{frame:this.sourceFrame,generation:this.getPositionResetGeneration(),clockAdvances,
      owner,interrupted:this.captureGearHasNewOwner()||legalInput});
  }
  private reconcileEquipment(){
    if(this.getFinalSmashControl())return; // source Final callbacks own stow/restore
    if(this.syncIntrinsicEquipment())return;
    const guardRelease=this.getSourceGuardReleasePresentationRoute();if(guardRelease){this.equipment={...guardRelease.equipment};return;}
    const held=this.getEquippedItem();
    this.equipment={...this.equipment,shield:held?'back':'normal',
      sword:held?.definition.heavy||held?.definition.hammer?'back':'normal',
      bow:this.sourceBowArticlePresent?'back':'hidden',heldItemVisible:true};
    const taunt=this.getSourceTauntEquipmentPresentationState();if(taunt){this.equipment={...taunt.equipment};return;}
    const capture=this.getSourceCaptureEquipmentPresentationState();if(capture){this.equipment={...capture.equipment};return;}
    const carryGear=this.getSourceHeavyCarryEquipmentPresentationState();if(carryGear){this.equipment={...carryGear.equipment};return;}
    const item=this.getSourceLinkItemContextPresentationState();if(item)this.equipment={...item.equipment};
    else {const normal=this.getSourceNormalEquipmentPresentationState();if(normal)this.equipment={...normal.equipment};
    const landing=this.getSourceLandingEquipmentPresentationState();if(landing)this.equipment={...landing.equipment};}
  }
  private legalSourceEntry(){return this.canAttack()&&!this.isInHitstun()&&!this.isGrabbed()&&!this.isHelpless();}
  private enterSourceAction(move:AttackMove|null=this.currentSourceMove('link.side_special')??null){this.noteIntrinsicSourceActionStarted();this.sourceActionMove=move;this.sourceFacing=this.getFacing();this.sourceEntryFrame=this.sourceFrame;
    this.normalEquipmentLease=null;this.normalEquipmentToken=null;this.guardReleasePresentation=null;this.clearItemContextOwner();this.temporaryFoodIdentity=null;this.normalTail=null;this.sourceBodyTail=null;this.intrinsicEquipmentLease=null;
    this.reconcileEquipment();this.sourceGeneration=this.getPositionResetGeneration();
    this.sourceActionToken={};this.spinStrikeTokens.clear();this.spinContacts.clear();}
  override executeNeutralSpecial(){const move=this.requestedSourceMove??this.getAttack(this.getNeutralSpecialId()??'link.neutral_special');
    if(!move)return false;if(!linkSourceIntrinsicId(move))return super.attemptAttack(move.id);
    if(!this.legalSourceEntry())return false;this.enterSourceAction(move);
    const doubleArrow=this.getEquippedItem()?.definition.generated?.kind==='link-arrow';
    this.sourceOwnBowLease??=beginLinkOwnBowArticle({ownerIndex:this.slotIndex,generation:this.getPositionResetGeneration(),frame:this.sourceFrame,acceptedBow:true});
    this.sourceBowArticlePresent=this.sourceOwnBowLease!==null;this.sourceSpecial=beginLinkBow(doubleArrow);this.syncIntrinsicEquipment();
    this.commitZeroStartupSpecial(move);return true;}
  override executeSideSpecial(){const move=this.requestedSourceMove??this.getAttack(this.getSideSpecialId()??'link.side_special');
    if(!move)return false;if(!linkSourceIntrinsicId(move))return super.attemptAttack(move.id);
    if(!this.legalSourceEntry())return false;this.enterSourceAction(move);
    this.sourceSpecial=beginLinkBoomerang(this.boomerangPresent,this.isGrounded(),this.sourceFlickSmash?'smash':'tilt');this.syncIntrinsicEquipment();this.commitZeroStartupSpecial(move);return true;}
  override executeDownSpecial(){const move=this.requestedSourceMove??this.getAttack(this.getDownSpecialId()??'link.down_special');
    if(!move)return false;if(!linkSourceIntrinsicId(move))return super.attemptAttack(move.id);
    if(!this.legalSourceEntry())return false;
    const state=beginLinkBomb(this.slotIndex,this.remoteBomb,this.getEquippedItem()!==null);if(!state)return false;
    this.enterSourceAction(move);this.sourceSpecial=state;this.syncIntrinsicEquipment();this.commitZeroStartupSpecial(move);return true;}
  private commitZeroStartupSpecial(move:AttackMove):void {const state=this.sourceSpecial;if(!state)return;
    const admitted=admitLinkSpecial(state,{specialHeld:this.sourceRawSpecialHeld,timing:move});
    this.sourceSpecial=admitted.state;this.syncIntrinsicEquipment();this.queueRuntimeEvents(move.id,admitted.events);
  }
  override executeUpSpecial(_stickX=0,_stickY=-1){const move=this.requestedSourceMove??this.getAttack(this.getUpSpecialId()??'link.up_special');
    if(!move)return false;if(!linkSourceIntrinsicId(move))return this.attemptUpSpecial(_stickX,_stickY);
    if(!this.legalSourceEntry())return false;this.enterSourceAction(move);
    const start=beginLinkSpin(this.isGrounded()),admitted=admitLinkSpin(start.state,{specialHeld:this.sourceRawSpecialHeld,timing:linkSpinTiming(move)});this.sourceSpin=admitted.state;this.syncIntrinsicEquipment();
    const kinetic=(move as AttackMove&{multiHitRising?:{riseImpulse:number;driftImpulse:number}}).multiHitRising;
    this.sourceSpinVelocityY=start.state.phase==='air'?kinetic?.riseImpulse??-2.4*5:null;
    if(this.sourceSpinVelocityY!==null)this.setIntrinsicSourceVelocity({x:kinetic&&kinetic.driftImpulse!==0?kinetic.driftImpulse*this.sourceFacing:this.getVelocity().x,y:this.sourceSpinVelocityY});
    this.queueRuntimeEvents('link.up_special',[...start.events,...admitted.events]);return true;}
  override attemptAttack(id:string):boolean {
    const source=this.getAttack(id),intrinsic=source?linkSourceIntrinsicId(source):null;
    if(intrinsic){this.requestedSourceMove=source??null;try{
      if(intrinsic==='link.neutral_special')return this.executeNeutralSpecial();if(intrinsic==='link.side_special')return this.executeSideSpecial();
      if(intrinsic==='link.up_special')return this.executeUpSpecial();if(intrinsic==='link.down_special')return this.executeDownSpecial();
    }finally{this.requestedSourceMove=null;}}
    const started=super.attemptAttack(id);if(started){this.sourceBodyTail=null;this.normalTail=null;this.normalHitConfirmed=false;this.syncNormalEquipment();this.reconcileEquipment();}return started;
  }
  private queueRuntimeEvents(moveId:string,events:readonly (LinkSpecialEvent|LinkSpinEvent)[]){
    moveId=this.sourceActionMove?.id??moveId;
    const move=this.sourceActionMove;
    for(const raw of events){
      let event:LinkSpecialEvent|LinkSpinEvent=raw.kind==='boomerang'?{...raw,angleDegrees:this.boomerangReleaseAngle()}:raw;
      let authoring:LinkIntrinsicAuthoringMetadata|undefined;
      let authoredCollisionDamageFactor:number|undefined;
      if(raw.kind==='arrow'&&move){const bow=this.sourceSpecial?.kind==='bow'?this.sourceSpecial:null;
        if(!bow)throw new Error('Arrow callback requires its admitted Bow charge receipt');
        const tuned=tuneArrowPlan(raw.plan,move,bow.chargeFrames,{doubleArrow:bow.doubleArrow});
        event={...raw,plan:tuned.plan};authoring=tuned.metadata;authoredCollisionDamageFactor=tuned.authoredCollisionDamageFactor;
      }else if(move&&(raw.kind==='generate-bomb'||raw.kind==='boomerang'))
        authoring=selectLinkIntrinsicAuthoringMetadata(move,raw.kind==='boomerang'?LINK_SIDE_SPECIAL:LINK_DOWN_SPECIAL);
      this.runtimeEvents.push({frame:this.sourceFrame,generation:this.sourceGeneration,facing:this.sourceFacing,
        actionId:`link-${this.slotIndex}-${this.sourceGeneration}-${this.sourceEntryFrame}-${moveId}`,moveId,event,
        ...(move?{authoringMove:structuredClone(move)}:{}),...(authoring?{authoring}: {}),
        ...(authoredCollisionDamageFactor===undefined?{}:{authoredCollisionDamageFactor})});}}
  consumeLinkRuntimeEvents():readonly LinkRuntimeEvent[]{return this.runtimeEvents.splice(0);}
  setLinkRemoteBombState(state:LinkRemoteBombState|null){this.remoteBomb=state?{...state}:null;}
  override setLinkBoomerangPresent(present:boolean){this.boomerangPresent=present;}
  private boomerangReleaseAngle(){const y=this.sourceStickY;return Math.abs(y)<=.1?0:-Math.sign(y)*(Math.abs(y)-.1)/.9*26;}
  override notifyLinkBoomerangCatch(){this.boomerangPresent=false;
    const catchState=beginLinkBoomerangCatch(this.legalSourceEntry()&&this.getActiveAttack()===null);
    if(!catchState)return false;this.enterSourceAction();this.sourceSpecial=catchState;this.syncIntrinsicEquipment();return true;}
  getLinkSpecialState(){return this.sourceSpecial?structuredClone(this.sourceSpecial):null;}
  getLinkSpinState(){return this.sourceSpin?{...this.sourceSpin}:null;}
  private sourceChargeSpec(){const move=this.sourceActionMove as (AttackMoveWithAnimation&{chargedProjectile?:{charge?:import('./chargeSchema').ChargeSpec}})|null;
    return move?.chargedProjectile?.charge??move?.charge??null;}
  private sourceSpinLandingFrames(){return(this.sourceActionMove as AttackMove&{specialLandingLagFrames?:number}|null)?.specialLandingLagFrames??30;}
  getLinkChargePresentation(){const s=this.sourceSpecial,spec=this.sourceChargeSpec();
    return s?.kind==='bow'&&s.phase!=='release'&&spec?{ratio:computeChargeTFromSpec(spec,s.chargeFrames),full:s.chargeFrames>=spec.maxChargeFrames,
      fullHoldRemaining:Math.max(0,(spec.maxHoldFrames??spec.maxChargeFrames)-s.chargeFrames)}:linkSpecialChargePresentation(s);}
  override getIntrinsicChargeReadout(){const bow=this.getLinkChargePresentation();
    if(bow)return{progress:bow.ratio,label:`BOW · ${bow.full?'FULL':`${Math.floor(bow.ratio*100)}%`}`};
    const spin=this.sourceSpin;
    if(spin?.phase==='ground-start'||spin?.phase==='ground-hold'){
      const spec=this.sourceChargeSpec(),progress=spec?computeChargeTFromSpec(spec,spin.chargeFrames):Math.min(1,spin.chargeFrames/60);return{progress,label:`SPIN · ${progress>=1?'FULL':`${Math.floor(progress*100)}%`}`};}
    return null;}
  override getChargeProgress(){return this.getIntrinsicChargeReadout()?.progress??super.getChargeProgress();}
  private finishSourceAction(){
    this.sourceSpecial=null;this.sourceSpin=null;this.sourceActionMove=null;this.sourceSpinVelocityY=null;this.clearIntrinsicSourceHitbox();
    this.reconcileEquipment();}
  protected override onIntrinsicSourceInterrupted(){this.tauntEquipmentLease=null;this.captureEquipmentLease=null;this.landingEquipmentLease=null;this.normalEquipmentLease=null;this.normalEquipmentToken=null;this.guardReleasePresentation=null;this.clearItemContextOwner();this.temporaryFoodIdentity=null;this.sourceBodyTail=null;this.intrinsicEquipmentLease=null;this.finishSourceAction();this.normalTail=null;}
  protected override getIntrinsicSourceLandingFrames(){return this.sourceLandingFrames??
    (this.sourceSpin?.phase==='air'||this.sourceSpin?.phase==='helpless'?30:null);}
  override getLinkEquipmentState(){const entry=this.getSourceMatchEntryEquipment();return {...this.equipment,...(entry?{sword:entry.sword,shield:entry.shield}:{})};}
  override onLinkFinalEvent(event:LinkAncientFinalEvent,_runId:number){
    if(event.kind==='stow'){this.clearItemContextOwner();this.temporaryFoodIdentity=null;this.finishSourceAction();this.sourceSpecial=null;this.sourceSpin=null;this.sourceActionMove=null;this.normalTail=null;this.sourceBodyTail=null;
      this.equipment={...this.equipment,sword:'back',shield:'back',heldItemVisible:false,ancientBowVisible:true};}
    else if(event.kind==='restore-sword')this.equipment={...this.equipment,sword:'normal'};
    else if(event.kind==='restore-shield')this.equipment={...this.equipment,shield:'normal'};
    else if(event.kind==='complete'){this.equipment={...event.equipmentBeforeEntry};
      // Preserve the actual pre-entry article placement and visibility. The
      // shared lease clears immediately after this callback; held-item hooks
      // then reconcile any real inventory change made during the Final.
    }
  }
  override notifyIntrinsicSourceContact(moveId:string,outcome:CharacterHitOutcome,targetIndex?:number,attackInstance?:object){
    if(outcome==='landed'&&super.getActiveAttack()?.move.id===moveId)this.normalHitConfirmed=true;
    const selected=selectLinkSpinContact(this.sourceSpin,this.sourceActionMove??LINK_UP_SPECIAL);
    if(attackInstance===this.sourceActionToken&&selected&&targetIndex!==undefined&&['landed','shielded','parried'].includes(outcome)){
      let targets=this.spinContacts.get(selected.strike);if(!targets){targets=new Set();this.spinContacts.set(selected.strike,targets);}targets.add(targetIndex);}}
  override mayResolveIntrinsicSourceContact(targetIndex:number,attackInstance?:object){
    if(attackInstance!==this.sourceActionToken)return true;
    const selected=selectLinkSpinContact(this.sourceSpin,this.sourceActionMove??LINK_UP_SPECIAL);
    return selected!==null&&!this.spinContacts.get(selected.strike)?.has(targetIndex);
  }
  override captureIntrinsicRuntimeState():LinkIntrinsicRuntimeSnapshot {
    return structuredClone({schema:'fresh-link-runtime/1',generation:this.getPositionResetGeneration(),sourceSpecial:this.sourceSpecial,
      sourceSpin:this.sourceSpin,sourceFacing:this.sourceFacing,sourceEntryFrame:this.sourceEntryFrame,sourceGeneration:this.sourceGeneration,
      sourceFrame:this.sourceFrame,sourceActionMove:this.sourceActionMove,runtimeEvents:this.runtimeEvents.map(({attackToken:_token,...row})=>row),remoteBomb:this.remoteBomb,boomerangPresent:this.boomerangPresent,
      tauntEquipmentLease:this.tauntEquipmentLease,captureEquipmentLease:this.captureEquipmentLease,landingEquipmentLease:this.landingEquipmentLease,normalEquipmentLease:this.normalEquipmentLease,intrinsicEquipmentLease:this.intrinsicEquipmentLease,sourceBowArticlePresent:this.sourceBowArticlePresent,sourceOwnBowLease:this.sourceOwnBowLease,
      equipment:this.equipment,normalTail:this.normalTail,sourceBodyTail:this.sourceBodyTail,normalHitConfirmed:this.normalHitConfirmed,previousAttackHeld:this.previousAttackHeld,normalTapBuffer:this.normalTapBuffer,
      lastStickX:this.lastStickX,sourceFlickAge:this.sourceFlickAge,sourceFlickSmash:this.sourceFlickSmash,sourceStickY:this.sourceStickY,sourceRawSpecialHeld:this.sourceRawSpecialHeld,sourceSpinVelocityY:this.sourceSpinVelocityY,
      sourceLandingFrames:this.sourceLandingFrames,sourceKineticFrame:this.sourceKineticFrame,normalBeamIssued:this.normalBeamIssued,guardReleasePresentation:this.guardReleasePresentation,shieldTiltInput:this.shieldTiltInput,commonPresentation:this.commonPresentation,sourceAirPresentation:this.sourceAirPresentation,contextualPresentation:this.contextualPresentation,
      lightPickupIdentity:this.lightPickupIdentity,temporaryFoodIdentity:this.temporaryFoodIdentity,
      itemContextEquipment:this.itemContextEquipment,
      itemContextOwner:this.itemContextOwner,itemContextOwnerSerial:this.itemContextOwnerSerial,
      spinContacts:[...this.spinContacts].map(([strike,targets])=>({strike,targets:[...targets]}))});
  }
  override restoreIntrinsicRuntimeState(value:unknown){
    if(!value||typeof value!=='object')throw new Error('Missing fresh Link runtime checkpoint');
    const state=value as LinkIntrinsicRuntimeSnapshot;
    const finiteTree=(v:unknown):boolean=>v===null||v===undefined||typeof v==='string'||typeof v==='boolean'||
      (typeof v==='number'?Number.isFinite(v):Array.isArray(v)?v.every(finiteTree):typeof v==='object'&&Object.values(v).every(finiteTree));
    if(state.schema!=='fresh-link-runtime/1'||state.generation!==this.getPositionResetGeneration()||!finiteTree(state)||
      ![1,-1].includes(state.sourceFacing)||!Array.isArray(state.runtimeEvents)||!Array.isArray(state.spinContacts)||
      typeof state.boomerangPresent!=='boolean'||typeof state.previousAttackHeld!=='boolean'||!Number.isSafeInteger(state.normalTapBuffer)||state.normalTapBuffer<0||!state.equipment)
      throw new Error('Malformed fresh Link runtime checkpoint');
    for(const key of ['sourceEntryFrame','sourceGeneration','sourceFrame','lastStickX','sourceFlickAge','sourceKineticFrame'] as const)
      if(typeof state[key]!=='number'||!Number.isFinite(state[key]))throw new Error(`Missing Link checkpoint ${key}`);
    if(typeof state.normalBeamIssued!=='boolean'||typeof state.normalHitConfirmed!=='boolean'||typeof state.sourceFlickSmash!=='boolean'||typeof state.sourceRawSpecialHeld!=='boolean'||
      !state.commonPresentation||state.commonPresentation.generation!==state.generation||!['normal','back','hidden'].includes(state.equipment.sword)||!['normal','back','hidden'].includes(state.equipment.shield)||
      !['have','back','hidden'].includes(state.equipment.bow)||typeof state.equipment.heldItemVisible!=='boolean'||
      typeof state.equipment.ancientBowVisible!=='boolean')throw new Error('Malformed Link checkpoint equipment/control');
    if(typeof state.sourceBowArticlePresent!=='boolean')throw new Error('Missing genuine Bow article admission checkpoint');
    if((state.sourceSpecial||state.sourceSpin)&&(!state.sourceActionMove||!linkSourceIntrinsicId(state.sourceActionMove)))
      throw new Error('Missing compatible source-owned move in Link checkpoint');
    if(state.sourceSpecial&&(!['bow','boomerang','bomb'].includes(state.sourceSpecial.kind)||state.sourceSpecial.age<0))
      throw new Error('Malformed Link special checkpoint');
    if(state.sourceSpin&&(!['ground-start','ground-hold','ground-release','air','helpless','done'].includes(state.sourceSpin.phase)||state.sourceSpin.age<0))
      throw new Error('Malformed Link Spin checkpoint');
    for(const row of state.spinContacts)if(typeof row.strike!=='string'||!Array.isArray(row.targets)||row.targets.some((t:number)=>!Number.isSafeInteger(t)||t<0))
      throw new Error('Malformed Link contact ledger');
    const tail=state.sourceBodyTail;
    if(tail&&(!Number.isFinite(tail.rawAge)||tail.rawAge<0||!Number.isSafeInteger(tail.entryFrame)||
      !Number.isSafeInteger(tail.endAgeExclusive)||tail.endAgeExclusive<=tail.rawAge||typeof tail.grounded!=='boolean'||
      ![1,-1].includes(tail.facing)||typeof tail.motion!=='string'||!tail.motion))throw new Error('Malformed Link source body tail');
    const parsedSpecial=parseLinkSpecialState(state.sourceSpecial),parsedSpin=parseLinkSpinState(state.sourceSpin),
      parsedBomb=parseLinkRemoteBombState(state.remoteBomb),parsedMove=state.sourceActionMove===null?null:
        parseLinkIntrinsicAuthoringMove(state.sourceActionMove,'actor.sourceActionMove');
    if(parsedSpecial&&parsedSpin)throw new Error('Two simultaneous Link intrinsic owners in checkpoint');
    const copy=structuredClone(state);this.clearIntrinsicSourceHitbox();
    this.sourceSpecial=parsedSpecial;
    this.sourceSpin=parsedSpin;this.sourceFacing=copy.sourceFacing;
    this.sourceEntryFrame=copy.sourceEntryFrame;this.sourceGeneration=copy.sourceGeneration;this.sourceFrame=copy.sourceFrame;
    this.sourceActionMove=parsedMove;this.requestedSourceMove=null;
    this.runtimeEvents.splice(0,this.runtimeEvents.length,...copy.runtimeEvents.map((row,index)=>{
      if(!Number.isSafeInteger(row.frame)||row.frame<0||!Number.isSafeInteger(row.generation)||row.generation!==this.getPositionResetGeneration()||
        ![1,-1].includes(row.facing)||typeof row.actionId!=='string'||!row.actionId||typeof row.moveId!=='string'||!row.moveId||
        row.authoredCollisionDamageFactor!==undefined&&(!Number.isFinite(row.authoredCollisionDamageFactor)||row.authoredCollisionDamageFactor<0))
        throw new Error(`Malformed queued Link callback ${index}`);
      const event=row.event.kind==='arrow'?{...row.event,plan:parseLinkArrowLaunchPlan(row.event.plan)}:
        row.event.kind==='sword-beam'?{...row.event,plan:parseLinkSwordBeamPlan(row.event.plan)}:row.event;
      return{...row,event,...(row.authoringMove?{authoringMove:parseLinkIntrinsicAuthoringMove(row.authoringMove,`actor.callbacks[${index}].move`)}:{}),
        ...(row.authoring?{authoring:parseLinkIntrinsicAuthoringMetadata(row.authoring,`actor.callbacks[${index}].authoring`)}:{})};
    }));this.remoteBomb=parsedBomb;
    this.boomerangPresent=copy.boomerangPresent;this.equipment=copy.equipment;this.sourceBowArticlePresent=copy.sourceBowArticlePresent;
    this.sourceOwnBowLease=parseLinkOwnBowArticleLease(copy.sourceOwnBowLease);
    if(this.sourceBowArticlePresent!==(this.sourceOwnBowLease!==null)||this.sourceOwnBowLease&&(this.sourceOwnBowLease.ownerIndex!==this.slotIndex||
      this.sourceOwnBowLease.generation!==this.getPositionResetGeneration()||this.sourceOwnBowLease.admittedFrame>this.sourceFrame))throw new Error('Invalid actual persistent Bow admission checkpoint');
    if(copy.normalTail&&copy.normalTail.chargeHeldFrames!==null&&(!Number.isSafeInteger(copy.normalTail.chargeHeldFrames)||copy.normalTail.chargeHeldFrames<0))
      throw new Error('Normal tail requires actual original held-charge receipt');
    this.normalTail=copy.normalTail?{...copy.normalTail,move:parseLinkIntrinsicAuthoringMove(copy.normalTail.move,'actor.normalTail.move')}:null;this.sourceBodyTail=copy.sourceBodyTail??null;
    if(this.sourceBodyTail){const tail=this.sourceBodyTail,origin=tail.origin;
      if(!origin||origin.generation!==this.getPositionResetGeneration()||typeof origin.moveId!=='string'||!origin.moveId||
        !Number.isSafeInteger(origin.entryFrame)||origin.entryFrame<0||origin.entryFrame>tail.entryFrame||
        !['link.neutral_special','link.side_special','link.up_special','link.down_special'].includes(origin.sourcePoseId))
        throw new Error('Malformed intrinsic tail originating admission checkpoint');
      parseLinkSourcePoseId(origin.sourcePoseId,'actor.sourceBodyTail.origin.sourcePoseId');}
    this.intrinsicEquipmentLease=null;
    const gear=copy.intrinsicEquipmentLease,gearRoute=this.intrinsicEquipmentRoute(),gearOrigin=this.sourceBodyTail?.origin??this.sourceTailOrigin();
    if(gearRoute){
      if(!gear||Object.keys(gear).length!==3||!gearOrigin||Object.keys(gear.origin??{}).length!==4||
        (['moveId','sourcePoseId','entryFrame','generation'] as const).some(key=>gear.origin[key]!==gearOrigin[key])||gear.motion!==gearRoute.motion)
        throw new Error('Restore exact intrinsic source/body-tail equipment admission before rearming');
      const parsed=parseLinkIntrinsicEquipmentInput({motion:gear.motion,rawAge:gearRoute.rawAge,equipmentAtEntry:gear.equipmentAtEntry,
        bowArticlePresent:this.sourceBowArticlePresent});
      const selected=selectLinkIntrinsicEquipment(parsed);
      if((['sword','shield','bow','heldItemVisible','ancientBowVisible'] as const).some(key=>selected.equipment[key]!==this.equipment[key]))throw new Error('Intrinsic equipment checkpoint disagrees with exact expression/source clock');
      this.intrinsicEquipmentLease={motion:parsed.motion,equipmentAtEntry:parsed.equipmentAtEntry,origin:{...gearOrigin}};
    }else if(gear!==null)throw new Error('Intrinsic gear lease without actual source/body-tail owner');
    this.tauntEquipmentLease=null;
    const tauntGear=copy.tauntEquipmentLease,tauntOwner=this.getSourceTauntPresentationOwner();
    if(tauntGear!==null){if(!tauntGear||Object.keys(tauntGear).length!==5||!['motion','ownerKey','entryFrame','generation','equipmentAtEntry'].every(k=>Object.hasOwn(tauntGear,k))||
      !tauntOwner||tauntOwner.motion!==tauntGear.motion||tauntOwner.ownerKey!==tauntGear.ownerKey||tauntGear.generation!==copy.generation||
      tauntGear.entryFrame!==tauntOwner.entryFrame)throw new Error('Restore exact actual taunt admission before gear');
      const parsed=parseLinkTauntEquipmentInput({motion:tauntGear.motion,scriptNativeFrame:tauntOwner.rawAge+1,equipmentAtEntry:tauntGear.equipmentAtEntry});
      const selected=selectLinkTauntEquipment(parsed);
      if((['sword','shield','bow','heldItemVisible','ancientBowVisible'] as const).some(k=>selected.equipment[k]!==copy.equipment[k]))throw new Error('Taunt gear callback checkpoint mismatch');
      this.tauntEquipmentLease={...tauntGear,equipmentAtEntry:parsed.equipmentAtEntry};
    }
    this.captureEquipmentLease=parseLinkCaptureEquipmentLease(copy.captureEquipmentLease);
    if(this.captureEquipmentLease){const lease=this.captureEquipmentLease,owner=this.getSourceCaptureEquipmentOwner();
      if(lease.generation!==copy.generation||lease.lastFrame!==copy.sourceFrame||lease.entryFrame>copy.sourceFrame||
        lease.phase==='control'&&(!owner||owner.ownerKey!==lease.ownerKey||owner.groupKey!==lease.groupKey||owner.captureKey!==lease.captureKey||owner.motion!==lease.motion||owner.rawAge!==lease.rawAge||owner.facing!==lease.facing)||
        lease.phase==='tail'&&(owner!==null||this.captureGearHasNewOwner()))throw new Error('Restore real capture participant/action clock before equipment lease');
      const selected=selectLinkCaptureActionEquipment({motion:lease.motion,scriptNativeFrame:lease.rawAge+1,equipmentAtEntry:lease.equipmentAtEntry});
      if((['sword','shield','bow','heldItemVisible','ancientBowVisible'] as const).some(k=>selected.equipment[k]!==copy.equipment[k]))throw new Error('Capture equipment checkpoint callback mismatch');
    }
    this.landingEquipmentLease=parseLinkLandingPresentationLease(copy.landingEquipmentLease);
    const landingLease=this.landingEquipmentLease;
    if(landingLease){
      if(landingLease.origin.generation!==copy.generation||landingLease.lastFrame!==copy.sourceFrame||landingLease.origin.entryFrame>copy.sourceFrame||
        this.landingHasNewOwner()||landingLease.phase==='control'&&!this.actualLandingControlMatches(landingLease)||
        landingLease.phase==='tail'&&this.actualLandingControlMatches(landingLease))throw new Error('Restore actual landing controller/identity before visual lease');
      const selected=selectLinkLandingEquipment({motion:landingLease.motion,scriptNativeFrame:landingLease.rawAge,equipmentAtEntry:landingLease.equipmentAtEntry});
      if((['sword','shield','bow','heldItemVisible','ancientBowVisible'] as const).some(key=>selected.equipment[key]!==copy.equipment[key]))
        throw new Error('Landing equipment checkpoint disagrees with actual SCRIPT clock');
    }
    this.normalEquipmentLease=null;this.normalEquipmentToken=null;
    const normalGear=copy.normalEquipmentLease,normalOwner=this.normalEquipmentOwner();
    if(normalOwner){
      if(!normalGear||Object.keys(normalGear).length!==4||!normalGear.origin||Object.keys(normalGear.origin).length!==4||
        normalGear.id!==normalOwner.id||normalGear.phase!==normalOwner.phase||normalGear.origin.moveId!==normalOwner.move.id||
        normalGear.origin.sourcePoseId!==normalOwner.move.sourcePoseId||normalGear.origin.generation!==copy.generation||
        !Number.isSafeInteger(normalGear.origin.entryFrame)||normalGear.origin.entryFrame<0||normalGear.origin.entryFrame>copy.sourceFrame)
        throw new Error('Restore exact normal equipment admission/tail identity before rearming');
      const parsed=parseLinkNormalEquipmentInput({id:normalGear.id,scriptNativeFrame:normalOwner.scriptNativeFrame,equipmentAtEntry:normalGear.equipmentAtEntry});
      this.normalEquipmentLease={id:parsed.id,phase:normalGear.phase,equipmentAtEntry:parsed.equipmentAtEntry,origin:{...normalGear.origin}};
      this.normalEquipmentToken=normalOwner.token;
      const selected=this.selectNormalRuntimeEquipment(parsed);
      if((['sword','shield','bow','heldItemVisible','ancientBowVisible'] as const).some(key=>selected.equipment[key]!==copy.equipment[key]))
        throw new Error('Normal equipment checkpoint disagrees with exact SCRIPT callbacks');
    }else if(normalGear!==null)throw new Error('Normal equipment lease without actual normal owner');
    this.normalHitConfirmed=copy.normalHitConfirmed;this.previousAttackHeld=copy.previousAttackHeld;this.normalTapBuffer=copy.normalTapBuffer;
    this.lastStickX=copy.lastStickX;this.sourceFlickAge=copy.sourceFlickAge;this.sourceFlickSmash=copy.sourceFlickSmash;this.sourceStickY=copy.sourceStickY;this.sourceRawSpecialHeld=copy.sourceRawSpecialHeld;
    this.sourceSpinVelocityY=copy.sourceSpinVelocityY;this.sourceLandingFrames=copy.sourceLandingFrames;this.sourceKineticFrame=copy.sourceKineticFrame;this.normalBeamIssued=copy.normalBeamIssued;this.guardReleasePresentation=parseLinkGuardReleasePresentation(copy.guardReleasePresentation);
    if(this.guardReleasePresentation&&(this.guardReleasePresentation.playerIndex!==this.slotIndex||this.guardReleasePresentation.generation!==copy.generation||
      this.guardReleasePresentation.lastFrame>copy.sourceFrame))throw new Error('Guard release checkpoint participant/frame mismatch');
    if(this.guardReleasePresentation&&this.getShieldReleaseRemaining()!==Math.max(0,11-this.guardReleasePresentation.rawAge))
      throw new Error('Restore actual public shield-release counter before rearming its natural presentation tail');
    const tilt=copy.shieldTiltInput;
    if(tilt!==null&&(!tilt||Object.keys(tilt).length!==3||!['moveX','moveY','facing'].every(k=>Object.hasOwn(tilt,k))||
      !Number.isFinite(tilt.moveX)||!Number.isFinite(tilt.moveY)||Math.abs(tilt.moveX)>1||Math.abs(tilt.moveY)>1||
      ![1,-1].includes(tilt.facing)||!this.isShielding()))throw new Error('Restore exact active shield input before rearming its parametric pose');
    this.shieldTiltInput=tilt===null?null:{...tilt};
    this.commonPresentation=parseLinkCommonPresentationState(copy.commonPresentation);this.sourceAirPresentation=parseLinkAirPresentationState(copy.sourceAirPresentation);this.contextualPresentation=copy.contextualPresentation===null?null:parseLinkContextualPresentationState(copy.contextualPresentation);
    if(this.contextualPresentation&&this.contextualPresentation.generation!==this.getPositionResetGeneration())throw new Error('Contextual presentation generation mismatch');
    const parseItemIdentity=(value:unknown,pickup:boolean):SourceLinkItemIdentity|SourceLinkPickupIdentity|null=>{
      if(value===null||value===undefined)return null;
      if(typeof value!=='object'||Array.isArray(value))throw new Error('Malformed actual item identity checkpoint');
      const row=value as Record<string,unknown>,keys=['entityId','entityGeneration','actorGeneration','frame',...(pickup?['committed']:[])];
      if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||
        ['entityId','entityGeneration','actorGeneration','frame'].some(key=>typeof row[key]!=='number'||!Number.isSafeInteger(row[key])||(row[key] as number)<0)||
        row.actorGeneration!==this.getPositionResetGeneration()||pickup&&typeof row.committed!=='boolean')throw new Error('Stale or malformed actual item identity checkpoint');
      return Object.freeze({...row}) as unknown as SourceLinkItemIdentity|SourceLinkPickupIdentity;};
    this.lightPickupIdentity=parseItemIdentity(copy.lightPickupIdentity,true) as SourceLinkPickupIdentity|null;
    this.temporaryFoodIdentity=parseItemIdentity(copy.temporaryFoodIdentity,false);
    this.itemContextOwner=copy.itemContextOwner??null;this.itemContextOwnerSerial=copy.itemContextOwnerSerial??0;
    if(!Number.isSafeInteger(this.itemContextOwnerSerial)||this.itemContextOwnerSerial<0)throw new Error('Malformed item context serial');
    if(this.itemContextOwner){const owner=this.itemContextOwner;
      if(Object.keys(owner).length!==5||!['battering','hammer'].includes(owner.kind)||!['active','charge','hammer'].includes(owner.phase)||
        !Number.isSafeInteger(owner.serial)||owner.serial<=0||owner.serial>this.itemContextOwnerSerial||typeof owner.motion!=='string'||!owner.motion||
        (owner.kind==='hammer'?owner.moveId!==null||owner.phase!=='hammer':typeof owner.moveId!=='string'||!owner.moveId||owner.phase==='hammer'))
        throw new Error('Malformed item context owner checkpoint');}
    this.itemContextEquipment=copy.itemContextEquipment==null?null:parseLinkItemContextEquipmentState(copy.itemContextEquipment);
    if(this.itemContextOwner&&!this.itemContextEquipment)throw new Error('Item context owner without its source lease');
    if(this.itemContextEquipment&&this.itemContextEquipment.generation!==this.getPositionResetGeneration())throw new Error('Item context generation mismatch');
    if(this.itemContextEquipment){const context=this.itemContextEquipment;let identity:unknown;
      try{identity=JSON.parse(context.itemIdentity);}catch{throw new Error('Malformed item context entity identity');}
      if(!Array.isArray(identity)||identity.length!==4||identity[0]!==this.slotIndex||identity[1]!==context.generation||
        identity.some(value=>!Number.isSafeInteger(value)||value<0)||context.actionId!==this.itemContextActionId(context.motion,context.entryFrame,this.itemContextOwner?.serial)||
        context.temporaryFood&&(!this.temporaryFoodIdentity||context.itemIdentity!==JSON.stringify([this.slotIndex,this.temporaryFoodIdentity.actorGeneration,
          this.temporaryFoodIdentity.entityId,this.temporaryFoodIdentity.entityGeneration])||this.temporaryFoodIdentity.frame!==context.entryFrame))
        throw new Error('Stale item/Food context checkpoint identity');}
    const restoredItemOwner=this.currentEquipmentActionOwner();
    this.itemContextOwnerToken=restoredItemOwner&&this.itemContextOwner&&restoredItemOwner.kind===this.itemContextOwner.kind&&
      restoredItemOwner.moveId===this.itemContextOwner.moveId&&restoredItemOwner.phase===this.itemContextOwner.phase&&restoredItemOwner.motion===this.itemContextOwner.motion?
        restoredItemOwner.token:null;
    if(this.itemContextOwner&&this.itemContextEquipment?.phase==='active'&&!this.itemContextOwnerToken)throw new Error('Restore actual held attack/Hammer owner before gear checkpoint');

    if(this.sourceAirPresentation&&this.sourceAirPresentation.generation!==this.getPositionResetGeneration())throw new Error('Air presentation generation mismatch');
    this.sourceActionToken={};this.spinStrikeTokens.clear();this.spinContacts.clear();
    for(const row of copy.spinContacts)this.spinContacts.set(row.strike,new Set(row.targets));
    this.syncSpinContact();
  }
  protected override filterSourceIntrinsicInput(input:CharacterInput,frame:number):CharacterInput {
    this.sourceFrame=frame;this.sourceLandingFrames=null;this.sourceStickY=input.moveY??0;this.sourceRawSpecialHeld=input.special===true;
    if(Math.abs(input.moveX)<.85||Math.sign(input.moveX)!==Math.sign(this.lastStickX))this.sourceFlickAge=0;
    else this.sourceFlickAge=Math.min(Number.MAX_SAFE_INTEGER,this.sourceFlickAge+1);
    this.sourceFlickSmash=Math.abs(input.moveX)>=.85&&this.sourceFlickAge<8;this.lastStickX=input.moveX;
    if(this.sourceGeneration!==this.getPositionResetGeneration()){
      this.finishSourceAction();this.runtimeEvents.length=0;this.normalTail=null;this.sourceBodyTail=null;this.equipment={...LINK_NORMAL_EQUIPMENT};
      this.sourceGeneration=this.getPositionResetGeneration();this.normalBeamIssued=false;}
    if(this.isInHitstun()||this.isGrabbed()){this.finishSourceAction();this.sourceBodyTail=null;}
    // Keyboard up also carries jump. Reserve legal source Up Special before
    // the shared ordinary jump buffer/squat runs, using the existing special
    // edge and direction priority. Other defense/OoS routes keep their owner.
    const upIntent=(input.moveY??0)<-.3||(input.jump&&(input.moveY??0)<=.3);
    if(this.sourceSpecialJustPressed(input)&&upIntent&&!this.isInHitlag()&&
      this.getJumpsquatRemaining()===0&&this.getShieldState().name==='idle'&&
      ['idle','cooldown'].includes(this.getDodgeState().name)&&['idle','cooldown'].includes(this.getLedgeHangState().name)&&this.legalSourceEntry())
      this.executeUpSpecial(input.moveX,-1);
    // `age` is the age this step processes (the attack ticks after this filter; a tail's age
    // already counts it), so a continuation opening on public frame N replaces that frame:
    // SmashWiki Link (SSBU)/Neutral attack quickest loop hits 7-8, 14-15, 22-23.
    const active=super.getActiveAttack(),activeNormalId=active?linkSourceNormalId(active.move):null,normal=active&&activeNormalId?{id:activeNormalId,
      age:active.framesElapsed+1,move:active.move,facing:active.facing??this.getFacing(),hitConfirmed:this.normalHitConfirmed,chargeHeldFrames:active.chargeHeldFrames}:this.normalTail;
    if(normal&&!this.isInHitlag()&&!this.isInHitstun()&&!this.isGrabbed()){
      // A fresh press stays live for the common offensive-action buffer, so a
      // tap made before the continuation window opens still advances the chain.
      // Only the second forward-smash slash also accepts the smash button.
      const down=input.attack===true||input.attackHeavy===true;
      this.normalTapBuffer=down&&!this.previousAttackHeld&&(input.attack===true||normal.id==='link.smash')?OFFENSIVE_ACTION_BUFFER_FRAMES:Math.max(0,this.normalTapBuffer-1);
      const next=linkNormalContinuation(normal,{attackHeld:input.attack===true,attackTapped:this.normalTapBuffer>0});
      if(next){const nextMove=this.currentSourceMove(next);if(nextMove){if(active)this.advanceSourceChainedAttack(nextMove.id,normal.id==='link.smash');else{this.setFacing(normal.facing);if(super.attemptAttack(nextMove.id)){if(normal.id==='link.smash')this.inheritSourceSmashFollowupCharge(normal.move,normal.chargeHeldFrames??null);this.deferSourceAttackInitialTick();}}}
        this.normalTail=null;this.normalHitConfirmed=false;this.normalTapBuffer=0;}}
    else if(!normal)this.normalTapBuffer=0;
    this.previousAttackHeld=input.attack===true||input.attackHeavy===true;
    if(this.sourceSpecial&&frame!==this.sourceEntryFrame){const before=this.sourceSpecial;
      const step=stepLinkSpecial(before,{specialHeld:input.special===true,clockAdvances:!this.isInHitlag(),charge:this.sourceChargeSpec()??undefined,timing:this.sourceActionMove??undefined});
      this.sourceSpecial=step.state;this.queueRuntimeEvents(`link.${before.kind==='bow'?'neutral':before.kind==='boomerang'?'side':'down'}_special`,step.events);
      if(!step.state){const route=linkSpecialBodyRoute({...before,age:before.age+1},{grounded:this.isGrounded(),facing:this.sourceFacing,move:this.sourceActionMove,chargeMaxFrames:this.sourceChargeSpec()?.maxChargeFrames}),origin=this.sourceTailOrigin();
        this.retainSourceBodyTail(route,origin);this.finishSourceAction();}}
    if(this.sourceSpin&&frame!==this.sourceEntryFrame){const before=this.sourceSpin;
      const timing=linkSpinTiming(this.sourceActionMove);
      const step=stepLinkSpin(before,{grounded:this.isGrounded(),specialHeld:input.special===true,clockAdvances:!this.isInHitlag(),charge:this.sourceChargeSpec()??undefined,
        timing,nativeMotionEnded:before.phase==='air'&&linkSpinSourceState({...before,age:before.age+1},this.sourceActionMove).age>=LINK_SPIN_SOURCE.airAnimationFrames});this.sourceSpin=step.state;this.queueRuntimeEvents('link.up_special',step.events);
      if(step.events.some(e=>e.kind==='helpless'))this.enterIntrinsicSourceHelpless(this.sourceSpinLandingFrames());
      if(step.events.some(e=>e.kind==='land'))this.sourceLandingFrames=this.sourceSpinLandingFrames();
      if(step.state.phase==='done'){const tail=before.phase==='ground-release'&&this.isGrounded()?linkSpinBodyRoute(linkSpinSourceState({...before,age:before.age+1},this.sourceActionMove),this.sourceFacing):null,origin=this.sourceTailOrigin();
        if(tail)this.retainSourceBodyTail(tail,origin);this.finishSourceAction();}}
    if(!this.sourceSpecial&&!this.sourceSpin)return input;
    this.setFacing(this.sourceFacing);return this.lockSourceIntrinsicInput(input,!this.isGrounded());
  }
  protected override reserveSourceUpdatedControlInput(input:CharacterInput,frame:number):CharacterInput {
    // The early reducer could not admit while a real taunt/landing/release
    // counter still owned control. Re-check only after those counters advance,
    // before ordinary keyboard Up's simultaneous jump can consume this step.
    // Existing source controllers already filtered input and advance once.
    if(this.sourceSpecial||this.sourceSpin)return input;
    const upIntent=(input.moveY??0)<-.3||(input.jump&&(input.moveY??0)<=.3);
    if(frame===this.sourceFrame&&this.sourceSpecialJustPressed(input)&&upIntent&&!this.isInHitlag()&&
      this.getJumpsquatRemaining()===0&&this.getShieldState().name==='idle'&&
      ['idle','cooldown'].includes(this.getDodgeState().name)&&['idle','cooldown'].includes(this.getLedgeHangState().name)&&this.legalSourceEntry()&&
      this.executeUpSpecial(input.moveX,-1)){
      this.setFacing(this.sourceFacing);return this.lockSourceIntrinsicInput(input,!this.isGrounded());
    }
    return input;
  }
  private sourceTailOrigin():SourceBodyTail['origin']|null {
    const move=this.sourceActionMove;if(!move?.sourcePoseId||!linkSourceIntrinsicId(move))return null;
    return{moveId:move.id,sourcePoseId:move.sourcePoseId,entryFrame:this.sourceEntryFrame,generation:this.sourceGeneration};
  }
  private retainSourceBodyTail(route:{motion:string;rawAge:number;facing:1|-1},origin:SourceBodyTail['origin']|null):void {
    const end=INTRINSIC_TAIL_EXTENTS[route.motion];
    if(origin&&end!==undefined&&route.rawAge<end)this.sourceBodyTail={...route,origin,grounded:this.isGrounded(),entryFrame:this.sourceFrame,endAgeExclusive:end};
  }
  override applyInput(input:CharacterInput,frame?:number){this.sourceFrame=frame??this.sourceFrame+1;const before=super.getActiveAttack(),frozen=this.isInHitlag();
    const priorShield=this.getShieldPresentationState(),priorGear={...this.equipment},priorAir=this.getSourceAirPresentationReceipt();
    super.applyInput(input,frame);this.retireSourceDamagePresentationIfUnowned();const after=super.getActiveAttack();
    if(this.normalEquipmentOwner()?.phase!=='tail'&&(after||this.getNormalChargePresentationOwner()))this.syncNormalEquipment();
    this.syncEquipmentActionOwner();this.advanceSourceItemContext(input,!frozen,priorAir.jumpEventSerial!==this.getSourceAirPresentationReceipt().jumpEventSerial);this.syncCaptureEquipment();this.syncTauntEquipment();this.reconcileEquipment();
    if(after&&(!before||before.move!==after.move||after.framesElapsed<before.framesElapsed))this.normalBeamIssued=false;
    if(after&&linkSourceNormalId(after.move)==='link.smash'&&!this.normalBeamIssued&&after.framesElapsed===after.move.startupFrames&&!frozen){
      this.normalBeamIssued=true;
      if(this.getDamagePercent()===0){const registered=this.getAttack(after.move.id)??after.move;
        const tuned=tuneBeamPlan(linkSwordBeamPlan(after.chargeHeldFrames??0),registered as AttackMoveWithAnimation,after.chargeHeldFrames??0);
        this.runtimeEvents.push({frame:this.sourceFrame,generation:this.getPositionResetGeneration(),
        facing:after.facing,actionId:`link-beam-${this.slotIndex}-${this.getPositionResetGeneration()}-${this.sourceFrame}`,
        moveId:after.move.id,attackToken:after.hitboxBody?.plugin.attackInstance,
        authoringMove:structuredClone(registered),authoring:tuned.metadata,authoredCollisionDamageFactor:tuned.authoredCollisionDamageFactor,
        event:{kind:'sword-beam',plan:tuned.plan}});}
    }
    const ordinary=this.getOrdinaryPresentationState(),shield=this.getShieldPresentationState();
    if(this.isShielding()&&shield&&!frozen)this.shieldTiltInput={moveX:input.moveX,moveY:input.moveY??0,facing:shield.facing};
    else if(!this.isShielding())this.shieldTiltInput=null;
    if(priorShield?.kind!=='release'&&shield?.kind==='release'&&shield.framesElapsed===0)
      this.guardReleasePresentation=beginLinkGuardReleasePresentation({playerIndex:this.slotIndex,generation:this.getPositionResetGeneration(),
        frame:this.sourceFrame,facing:shield.facing,acceptedRelease:true,equipment:priorGear});
    else if(this.guardReleasePresentation){const legalMove=super.canUseItemsBeforeInput()&&(Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1);
      const interrupted=!this.isGrounded()||after!==null||this.sourceSpecial!==null||this.sourceSpin!==null||this.getFinalSmashControl()!==null||
        this.isInHitstun()||this.isGrabbed()||this.getSourceShieldBreakPresentationState()!==null||this.getRecoveryPresentation()!==null||
        this.getItemActionState()!==null||this.getItemShootingPresentation()!==null||this.itemContextEquipment!==null||
        super.getAnimationActionState().chargingMove!==null||this.getJumpsquatRemaining()>0||this.getGrabState().active!==null||
        this.getTauntPresentationState()!==null||this.getLandingPresentationState()!==null||this.getLinkPassiveShieldPresentationState()!==null||
        !['idle','cooldown'].includes(this.getDodgeState().name)||shield!==null&&shield.kind!=='release'||legalMove;
      this.guardReleasePresentation=stepLinkGuardReleasePresentation(this.guardReleasePresentation,{frame:this.sourceFrame,
        generation:this.getPositionResetGeneration(),clockAdvances:!frozen,interrupted});
    }
    const committed=after!==null||this.sourceSpecial!==null||this.sourceSpin!==null||this.getFinalSmashControl()!==null||
      this.getSourceLinkFootstoolPresentationRoute()!==null||
      super.getAnimationActionState().chargingMove!==null||this.getItemActionState()!==null||this.getItemShootingPresentation()!==null||
      this.getDonkeyKongHeavyItemActionState()!==null||this.getHammerPresentation()!==null||this.getRecoveryPresentation()!==null||
      this.itemContextEquipment!==null||
      this.isInHitstun()||this.isGrabbed()||
      this.getGrabState().active!==null||this.getThrowPresentationState()!==null||this.getLinkPassiveShieldPresentationState()!==null||this.getDonkeyKongHeavyCarryState()!==null||
      this.getSourceShieldBreakPresentationState()!==null||this.getReactionPresentationState()!==null||this.getTauntPresentationState()!==null||this.getLandingPresentationState()!==null||
      this.getJumpsquatRemaining()>0||['hanging','climbing','rolling'].includes(this.getLedgeHangState().name)||
      !['idle','cooldown'].includes(this.getDodgeState().name);
    this.commonPresentation=stepLinkCommonPresentation(this.commonPresentation,{frame:this.sourceFrame,generation:this.getPositionResetGeneration(),
      clockAdvances:!frozen,grounded:this.isGrounded(),facing:this.getFacing(),velocityX:this.getVelocity().x,inputX:input.moveX,inputY:input.moveY??0,
      ordinary:ordinary?{kind:ordinary.sheet,framesElapsed:ordinary.framesElapsed}:null,locomotion:this.getLocomotionState(),
      crouching:this.isCrouching(),passiveCrouchHold:this.getLinkPassiveShieldPresentationState()?.crouchedAtEntry===true,shield:shield?{kind:shield.kind,framesElapsed:shield.framesElapsed}:null,
      uncommitted:!committed,heldItem:this.getEquippedItem()!==null});
    this.sourceAirPresentation=advanceLinkAirPresentation(this.sourceAirPresentation,{...this.getSourceAirPresentationReceipt(),bodyAvailable:!committed});
    this.contextualPresentation=observeLinkContextualPresentation(this.contextualPresentation??beginLinkContextualPresentation({frame:this.sourceFrame,
      generation:this.getPositionResetGeneration(),facing:this.getFacing(),side:'left',reason:'respawn'}),{
      frame:this.sourceFrame,generation:this.getPositionResetGeneration(),clockAdvances:!frozen,interrupted:committed,
      grounded:this.isGrounded(),uncommitted:!committed,gameplayStarted:true,facing:this.getFacing(),
      actualJump:priorAir.jumpEventSerial!==this.getSourceAirPresentationReceipt().jumpEventSerial,
      actualDropThrough:this.isInDropThroughWindow(),support:this.getSourceSupportPresentationObservation()});
    const beforeNormalId=before?linkSourceNormalId(before.move):null;
    if(before&&beforeNormalId&&!after&&!this.sourceSpecial&&!this.sourceSpin&&!this.isInHitstun()&&!this.isGrabbed()&&
      super.canUseItemsBeforeInput()&&!super.getAnimationActionState().chargingMove&&!this.getLandingPresentationState())
      this.normalTail={id:beforeNormalId,age:before.framesElapsed+(frozen?0:1),facing:before.facing??this.getFacing(),move:before.move,hitConfirmed:this.normalHitConfirmed,chargeHeldFrames:before.chargeHeldFrames??null};
    else if(this.normalTail&&!after&&!frozen)this.normalTail.age+=1;
    if(this.normalTail&&(after!==null||!super.canUseItemsBeforeInput()||super.getAnimationActionState().chargingMove||this.getLandingPresentationState()||
      input.jump||input.special||input.shield||input.dodge||input.grab||Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1||
      this.isInHitstun()||this.isGrabbed()||this.getSourceCommonPresentationRoute()?.admission!=='idle'&&this.getSourceCommonPresentationRoute()!==null))this.normalTail=null;
    if(this.sourceBodyTail){const tail=this.sourceBodyTail;
      if(this.sourceSpecial||this.sourceSpin||after||this.getFinalSmashControl()||!super.canUseItemsBeforeInput()||
        super.getAnimationActionState().chargingMove||this.getLandingPresentationState()||this.isInHitstun()||this.isGrabbed()||
        this.getSourceShieldBreakPresentationState()||this.getGrabState().active||this.getTauntPresentationState()||
        this.getDonkeyKongHeavyCarryState()||this.isGrounded()!==tail.grounded||
        Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1||input.shield||input.dodge||input.grab||
        this.getJumpsquatRemaining()>0||this.getSourceCommonPresentationRoute()?.admission!=='idle'&&this.getSourceCommonPresentationRoute()!==null)
        this.sourceBodyTail=null;
      else {if(!frozen&&this.sourceFrame!==tail.entryFrame)tail.rawAge+=1;
        if(tail.rawAge>=tail.endAgeExclusive)this.sourceBodyTail=null;}
    }
    this.advanceSourceCaptureEquipment(input,!frozen);this.syncTauntEquipment();this.advanceSourceLandingEquipment(input,!frozen);this.syncNormalEquipment();this.reconcileEquipment();this.syncSpinContact();
  }
  private syncSpinContact(){const selected=selectLinkSpinContact(this.sourceSpin,this.sourceActionMove??LINK_UP_SPECIAL);
    if(!selected){this.clearIntrinsicSourceHitbox();return;}
    let group=this.spinStrikeTokens.get(selected.strike);if(!group){group={};this.spinStrikeTokens.set(selected.strike,group);}
    this.syncIntrinsicSourceHitbox(selected.resolvedMove,selected.collisionHits,
      this.sourceFacing*selected.facingMultiplier as 1|-1,this.sourceActionToken,group,selected.rectangle);
  }
  override preparePhysicsStep(worldGravityDeltaY:number,additionalReferenceTick=false){
    super.preparePhysicsStep(worldGravityDeltaY,additionalReferenceTick);
    const state=this.sourceSpin;if(!state||this.isInHitlag()||additionalReferenceTick)return;
    if(state.phase==='ground-start'||state.phase==='ground-hold'||state.phase==='ground-release'){
      this.setIntrinsicSourceVelocity({x:0,y:this.getVelocity().y});return;}
    if(state.phase!=='air'&&state.phase!=='helpless')return;
    const attributes=linkAirSpinAttributes(linkSpinSourceState(state,this.sourceActionMove).age,state.phase==='air'?'powered':'helpless',5);
    const gravity=attributes.gravity??.096*5;
    // Matter receives a single source-owned vertical dose; ordinary input's
    // calibrated ascent/descent contributions do not accumulate underneath.
    if(this.sourceSpinVelocityY===null)this.sourceSpinVelocityY=this.getVelocity().y;
    if(this.sourceKineticFrame!==this.sourceFrame){
      if(this.sourceFrame!==this.sourceEntryFrame)this.sourceSpinVelocityY=Math.min(8,this.sourceSpinVelocityY+gravity);
      this.sourceKineticFrame=this.sourceFrame;}
    const cap=attributes.horizontalSpeedCap;
    this.setIntrinsicSourceVelocity({x:Math.max(-cap,Math.min(cap,this.getVelocity().x)),y:this.sourceSpinVelocityY-worldGravityDeltaY});
  }
  override getActiveAttack():ActiveAttack|null {const active=super.getActiveAttack();if(active)return active;
    const state=this.sourceSpecial??this.sourceSpin;if(!state)return null;
    const move=this.sourceActionMove??(this.sourceSpecial?.kind==='bow'?LINK_NEUTRAL_SPECIAL:this.sourceSpecial?.kind==='boomerang'?LINK_SIDE_SPECIAL:
      this.sourceSpecial?.kind==='bomb'?LINK_DOWN_SPECIAL:LINK_UP_SPECIAL);
    const body=this.getIntrinsicSourceHitbox();return{move,facing:this.sourceFacing,framesElapsed:state.age,hitboxBody:body,
      chargeHeldFrames:null,phase:body?'active':'startup'};}
  override getAnimationActionState():ReturnType<ContractFighter['getAnimationActionState']>{const s=this.sourceSpecial;
    if(this.sourceSpin?.phase==='ground-start'||this.sourceSpin?.phase==='ground-hold')return{chargingMove:this.sourceActionMove??LINK_UP_SPECIAL,
      chargeHeldFrames:this.sourceSpin.chargeFrames,chargeStartupElapsed:this.sourceSpin.phase==='ground-start'?this.sourceSpin.age:linkSpinTiming(this.sourceActionMove).groundStart,landingRecoveryRemaining:0};
    return s?.kind==='bow'&&s.phase!=='release'?{chargingMove:this.sourceActionMove??LINK_NEUTRAL_SPECIAL,chargeHeldFrames:s.chargeFrames,
      chargeStartupElapsed:s.phase==='startup'?s.age:this.sourceActionMove?.startupFrames??15,landingRecoveryRemaining:0}:super.getAnimationActionState();}
  override getSourceGuardReleasePresentationRoute(){const state=this.guardReleasePresentation,shield=this.getShieldPresentationState();
    if(!state||state.generation!==this.getPositionResetGeneration()||!this.isGrounded()||this.isInHitstun()||this.isGrabbed()||
      this.getFinalSmashControl()||shield&&shield.kind!=='release'||super.getActiveAttack()||this.sourceSpecial||this.sourceSpin||
      this.getJumpsquatRemaining()>0||!['idle','cooldown'].includes(this.getDodgeState().name))return null;
    return selectLinkGuardReleasePresentation(state);}
  override applyHitDetailed(hit:Parameters<ContractFighter['applyHitDetailed']>[0]){const result=super.applyHitDetailed(hit);
    if(!this.isShielding())this.shieldTiltInput=null;
    if(this.guardReleasePresentation&&['landed','parried','shielded'].includes(result.outcome)){
      this.guardReleasePresentation=null;this.reconcileEquipment();}
    return result;
  }
  private sourceShieldTiltSelection(){
    const input=this.shieldTiltInput??{moveX:0,moveY:0,facing:this.getShieldPresentationState()?.facing??this.getFacing()};
    return selectLinkShieldTilt({...input,currentHP:this.getShieldState().health,actorSourceRoot:{x:0,y:0}});}
  private passiveShieldPose():LinkPassiveShieldPose{
    if(!this.isGrounded())return 'other';
    if(this.isCrouching())return 'crouching';
    const gait=this.getLocomotionState().name;
    return gait==='walk'?'walking':gait==='standing'?'standing':'other';
  }
  /** The passive shield while standing, walking or crouching uncommitted (a guard in progress keeps it). */
  override getLinkPassiveShieldWorldSurfaces(){
    const pose=this.passiveShieldPose();
    if(pose==='other'||!linkPassiveShieldEligible({pose,equipment:this.getLinkEquipmentState(),captured:this.isGrabbed(),hitstun:this.isInHitstun(),
      committingAction:!this.canUseItemsBeforeInput()&&this.getLinkPassiveShieldPresentationState()===null}))return [];
    return linkPassiveShieldWorldSurfaces(linkPassiveShieldSurfaces(pose,this.getFacing()),this.getSourceRootPosition());
  }
  override getSourceShieldBubble(){if(!this.isShielding()||!this.isGrounded()||this.getFinalSmashControl())return null;
    const selected=this.sourceShieldTiltSelection(),root=this.getSourceRootPosition();
    return{...selected,centre:{x:root.x+selected.centre.x,y:root.y+selected.centre.y},
      actorGeneration:this.getPositionResetGeneration()};}
  override getSourceLinkDamagePresentationRoute(){const receipt=this.getSourceDamagePresentationReceipt();
    return selectLinkDamagePresentation(receipt,{localStop:this.isInHitlag()||!this.getSourceAirPresentationReceipt().clockAdvances,nativeLaunchAngleRadians:receipt?.nativeLaunchAngleRadians??null});}
  override getSourceLinkAirPresentationRoute(){return selectLinkAirPresentation(this.sourceAirPresentation);}
  override getSourceCommonPresentationRoute(){
    const route=selectLinkCommonPresentation(this.commonPresentation),shield=this.getShieldPresentationState();
    if(route&&(route.admission==='shield-hold'||route.admission==='shield-raise')&&shield?.kind!=='hold')return null;
    if(route?.motion==='guard')return{...route,rawAge:this.sourceShieldTiltSelection().rawAngle};
    return route;
  }
  override beginSourceMatchEntry(side:'left'|'right'){
    this.contextualPresentation=beginLinkContextualPresentation({frame:0,generation:this.getPositionResetGeneration(),facing:this.getFacing(),side,reason:'match-start'});
    this.normalTail=null;this.sourceBodyTail=null;return true;
  }
  override advanceSourceMatchEntry(frame:number,gameplayStarted:boolean){
    const state=this.contextualPresentation;if(!state?.entry)return;
    this.contextualPresentation={...state,entry:stepLinkEntryPresentation(state.entry,{frame,generation:this.getPositionResetGeneration(),
      clockAdvances:true,interrupted:false,gameplayStarted})};
  }
  override getSourceMatchEntryEquipment(){const entry=this.contextualPresentation?.entry;return entry?linkEntryEquipment(entry):null;}
  override getSourceContextualPresentationRoute(){return this.contextualPresentation?selectLinkContextualPresentation(this.contextualPresentation):null;}
  protected override sourceCurrentBodyRoute(){return this.getLinkBodyRoute();}
  getLinkBodyRoute():LinkCommonBodyRoute|null{
    if(this.getFinalSmashControl())return null;
    if(this.contextualPresentation?.entry)return this.getSourceContextualPresentationRoute();
    const shieldBreak=this.getSourceShieldBreakPresentationState();if(shieldBreak)return shieldBreak;
    const footstool=this.getSourceLinkFootstoolPresentationRoute();if(footstool)return footstool;
    if(this.sourceSpecial)return linkSpecialBodyRoute(this.sourceSpecial,{grounded:this.isGrounded(),facing:this.sourceFacing,move:this.sourceActionMove,chargeMaxFrames:this.sourceChargeSpec()?.maxChargeFrames});
    if(this.sourceSpin)return linkSpinBodyRoute(linkSpinSourceState(this.sourceSpin,this.sourceActionMove),this.sourceFacing);
    const charge=super.getAnimationActionState(),chargingId=charge.chargingMove?linkSourceNormalId(charge.chargingMove):null;
    if(chargingId&&charge.chargingMove){const hold=chargingId==='link.smash'?'attack_s4_hold':chargingId==='link.usmash'?'attack_hi4_hold':chargingId==='link.dsmash'?'attack_lw4_hold':null;
      return{motion:hold&&charge.chargeHeldFrames>0?hold:LINK_NORMAL_RULES[chargingId].motion,
        // The first genuinely owned held step increments0->1. Only these
        // three normal holds use the selected authored birth adapter to
        // present captured0 first, play through60, then keep terminal60.
        // SCRIPT/power/stop clocks retain the genuine held-frame counter.
        rawAge:hold&&charge.chargeHeldFrames>0?Math.max(0,Math.min(60,charge.chargeHeldFrames-1)):
          linkNormalNativeFrame(chargingId,charge.chargeStartupElapsed??0),facing:this.getFacing(),
        ...(hold&&charge.chargeHeldFrames>0?{terminal:true}:{} )};}
    const active=super.getActiveAttack(),normalId=active?linkSourceNormalId(active.move):null;if(active&&linkSourceRecoveryId(active.move)){const id=linkSourceRecoveryId(active.move)!;return{motion:linkRecoveryAttackSource(id).motion,rawAge:linkRecoveryAttackNativeFrame(id,active.framesElapsed),facing:active.facing??this.getFacing()};}
    if(active&&normalId)return{motion:LINK_NORMAL_RULES[normalId].motion,
      rawAge:linkNormalNativeFrame(normalId,active.framesElapsed),facing:active.facing??this.getFacing()};
    const captureAction=this.getSourceLinkCaptureActionPresentationRoute();if(captureAction)return captureAction;
    const itemContext=this.getSourceLinkItemContextPresentationState();if(itemContext?.ownsBodyRoute)return itemContext.route;
    const guardRelease=this.getSourceGuardReleasePresentationRoute();if(guardRelease)return guardRelease;
    const landing=this.getSourceLinkLandingPresentationRoute();if(landing)return landing;
    if(this.sourceBodyTail)return{motion:this.sourceBodyTail.motion,rawAge:this.sourceBodyTail.rawAge,facing:this.sourceBodyTail.facing};
    if(this.normalTail)return{motion:LINK_NORMAL_RULES[this.normalTail.id].motion,
      rawAge:linkNormalNativeFrame(this.normalTail.id,this.normalTail.age),facing:this.normalTail.facing};
    return linkCommonBodyRoute(this);
  }
  override notifySourceLinkLightPickup(identity:SourceLinkItemIdentity|null):void {
    this.lightPickupIdentity=identity?Object.freeze({...identity,committed:false}):null;
    this.notifySourceLinkItemActionIdentity(identity);
  }
  override notifySourceLinkLightPickupResult(entityId:number,entityGeneration:number,accepted:boolean):void {
    const identity=this.lightPickupIdentity;if(!identity||identity.entityId!==entityId||identity.entityGeneration!==entityGeneration)return;
    this.lightPickupIdentity=accepted?Object.freeze({...identity,committed:true}):null;
    if(!accepted&&!this.getItemActionState()){this.clearItemContextOwner();this.reconcileEquipment();}
  }
  override notifySourceLinkTemporaryFood(identity:SourceLinkItemIdentity|null):void {
    this.temporaryFoodIdentity=identity?Object.freeze({...identity}):null;
    if(!identity){if(this.itemContextEquipment?.temporaryFood)this.clearItemContextOwner();this.reconcileEquipment();return;}
    const eating=this.getEatingState();if(!identity||!eating||eating.itemId!==identity.entityId)return;
    this.beginSourceItemContext(identity,eating.walking?'item_light_walk_eat':'item_light_eat',eating.age+1,1,eating.facing,true,eating.entryFrame);
  }
  /** Selected native6 -> ordinal age5. The retained decompiler signature is
   * malformed; this is the explicitly selected item callback interpretation. */
  protected override sourceItemEatingConsumeAge():number{return 5;}
  override notifyItemRecoveryTransactionRejected(itemId:number,entryFrame:number):void {
    super.notifyItemRecoveryTransactionRejected(itemId,entryFrame);
    if(this.temporaryFoodIdentity?.entityId===itemId&&this.temporaryFoodIdentity.frame===entryFrame)this.notifySourceLinkTemporaryFood(null);
  }
  override beginItemAction(action:ItemAction,frame:number,facing:1|-1=this.getFacing()):boolean {
    const accepted=super.beginItemAction(action,frame,facing);if(accepted)this.beginHeldItemContext(frame);return accepted;
  }
  override beginDonkeyKongHeavyItemAction(action:DonkeyKongHeavyItemAction,frame:number,facing:1|-1=this.getFacing()):boolean {
    const accepted=super.beginDonkeyKongHeavyItemAction(action,frame,facing);if(accepted)this.beginHeldItemContext(frame);return accepted;
  }
  private beginHeldItemContext(frame:number):void {
    const held=this.getEquippedItem() as (HeldItemHandle&{id?:number;spawnedAtFrame?:number})|null;
    if(held&&Number.isSafeInteger(held.id)&&Number.isSafeInteger(held.spawnedAtFrame))this.notifySourceLinkItemActionIdentity({
      entityId:held.id!,entityGeneration:held.spawnedAtFrame!,actorGeneration:this.getPositionResetGeneration(),frame});
  }
  override notifySourceLinkItemActionIdentity(identity:SourceLinkItemIdentity|null):void {
    if(!identity||identity.actorGeneration!==this.getPositionResetGeneration())return;
    const light=this.getItemActionState(),heavy=this.getDonkeyKongHeavyItemActionState();
    if(light?.plan.motion)this.beginSourceItemContext(identity,light.plan.motion,light.nativeFrame,light.plan.nativeMotionRate,light.facing,false,light.entryFrame);
    else if(heavy)this.beginSourceItemContext(identity,heavy.plan.motion,heavy.nativeFrame,heavy.plan.selectedMotionRate,heavy.facing,false,heavy.entryFrame);
  }
  private itemContextActionId(motion:string,entryFrame:number,serial?:number):string{return JSON.stringify([this.slotIndex,this.getPositionResetGeneration(),motion,entryFrame,...(serial===undefined?[]:[serial])]);}
  private beginSourceItemContext(identity:SourceLinkItemIdentity,motion:string,nativeMotionFrame:number,motionRate:number,facing:1|-1,temporaryFood:boolean,entryFrame:number,
    owner?:{state:SourceItemContextOwner;token:object}):void {
    if(!Object.hasOwn(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS,motion))return;
    // A new accepted owner interrupts the prior cosmetic callback tail.
    // Source expressions which only change Shield inherit CURRENT inventory,
    // rather than a previous Bat4 Swordback before its raw85 restoration.
    this.guardReleasePresentation=null;this.clearItemContextOwner();this.sourceBodyTail=null;this.intrinsicEquipmentLease=null;this.reconcileEquipment();
    this.itemContextOwner=owner?.state??null;this.itemContextOwnerToken=owner?.token??null;
    this.itemContextEquipment=beginLinkItemContextEquipment({frame:identity.frame,generation:this.getPositionResetGeneration(),
      actionId:this.itemContextActionId(motion,entryFrame,owner?.state.serial),itemIdentity:JSON.stringify([this.slotIndex,identity.actorGeneration,identity.entityId,identity.entityGeneration]),
      motion:motion as LinkItemContextMotion,nativeMotionFrame,motionRate,facing,temporaryFood,equipmentAtEntry:this.equipment});
    this.normalTail=null;this.sourceBodyTail=null;this.reconcileEquipment();
  }
  private currentEquipmentActionOwner(){
    const held=this.getEquippedItem() as (HeldItemHandle&{id?:number;spawnedAtFrame?:number})|null;
    if(!held||!Number.isSafeInteger(held.id)||!Number.isSafeInteger(held.spawnedAtFrame))return null;
    const identity={entityId:held.id!,entityGeneration:held.spawnedAtFrame!,actorGeneration:this.getPositionResetGeneration(),frame:this.sourceFrame},
      hammer=held.definition.hammer?this.getHammerPresentation():null;
    if(hammer){const motion=hammer.sheet.replace('item_golden_hammer_','item_hammer_');
      return{kind:'hammer' as const,token:held,phase:'hammer' as const,moveId:null,motion,nativeFrame:1,facing:hammer.facing,identity};}
    const attack=held.definition.itemClass==='battering'?this.getItemAttackPresentationOwner():null;if(!attack)return null;
    const heldCharge=attack.phase==='charge'&&this.getAnimationActionState().chargeHeldFrames>0&&
      (attack.move.itemClip==='item_sword_swing_4'||attack.move.itemClip==='item_starrod_swing_4');
    return{kind:'battering' as const,token:attack.token,phase:attack.phase,moveId:attack.move.id,
      motion:`${attack.move.itemClip}${heldCharge?'_hold':''}`,nativeFrame:attack.rawAge+1,facing:attack.facing,identity};
  }
  private syncEquipmentActionOwner():void {
    const current=this.currentEquipmentActionOwner();if(!current||!Object.hasOwn(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS,current.motion))return;
    const owner=this.itemContextOwner,state=this.itemContextEquipment,
      itemIdentity=JSON.stringify([this.slotIndex,current.identity.actorGeneration,current.identity.entityId,current.identity.entityGeneration]);
    if(owner&&state&&this.itemContextOwnerToken===current.token&&owner.phase===current.phase&&owner.motion===current.motion&&
      owner.moveId===current.moveId&&state.itemIdentity===itemIdentity)return;
    const next:SourceItemContextOwner={kind:current.kind,serial:++this.itemContextOwnerSerial,moveId:current.moveId,phase:current.phase,motion:current.motion};
    this.beginSourceItemContext(current.identity,current.motion,current.nativeFrame,1,current.facing,false,this.sourceFrame,{state:next,token:current.token});
  }
  override getSourceLinkItemContextPresentationState(){
    const lease=this.itemContextEquipment;if(!lease||lease.generation!==this.getPositionResetGeneration()||this.getFinalSmashControl()||
      this.isGrabbed()||this.isInHitstun()||this.sourceSpecial||this.sourceSpin||
      this.getSourceShieldBreakPresentationState())return null;
    if(this.itemContextOwner?.kind==='hammer'&&!this.getEquippedItem()?.definition.hammer)return null;
    return selectLinkItemContextEquipment(lease);
  }
  private advanceSourceItemContext(input:CharacterInput,clockAdvances:boolean,jumped:boolean):void {
    const state=this.itemContextEquipment;if(!state)return;
    const light=this.getItemActionState(),heavy=this.getDonkeyKongHeavyItemActionState(),eating=this.getEatingState();
    const owned=this.currentEquipmentActionOwner(),matchesOwned=owned&&this.itemContextOwner&&this.itemContextOwnerToken===owned.token&&
      owned.phase===this.itemContextOwner.phase&&owned.motion===this.itemContextOwner.motion&&owned.moveId===this.itemContextOwner.moveId;
    const active=this.itemContextOwner?matchesOwned?{id:state.actionId,nativeFrame:owned.nativeFrame}:null:state.temporaryFood?eating&&this.temporaryFoodIdentity&&
      state.itemIdentity===JSON.stringify([this.slotIndex,this.temporaryFoodIdentity.actorGeneration,eating.itemId,this.temporaryFoodIdentity.entityGeneration])?
        {id:this.itemContextActionId(eating.walking?'item_light_walk_eat':'item_light_eat',eating.entryFrame),nativeFrame:eating.age+1}:null:
      light?.plan.motion?{id:this.itemContextActionId(light.plan.motion,light.entryFrame),nativeFrame:light.nativeFrame}:
        heavy?{id:this.itemContextActionId(heavy.plan.motion,heavy.entryFrame),nativeFrame:heavy.nativeFrame}:null;
    const hasNewOwner=(!matchesOwned&&(this.getActiveAttack()!==null||this.getAnimationActionState().chargingMove!==null))||this.sourceSpecial!==null||this.sourceSpin!==null||
      this.getItemShootingPresentation()!==null||this.getGrabState().active!==null||this.getThrowPresentationState()!==null||this.getTauntPresentationState()!==null||
      (!matchesOwned&&(this.getJumpsquatRemaining()>0||jumped))||this.getShieldPresentationState()!==null||
      !['idle','cooldown'].includes(this.getDodgeState().name)||['hanging','climbing','rolling'].includes(this.getLedgeHangState().name);
    const interrupted=this.getFinalSmashControl()?'final':this.isGrabbed()?'capture':this.isInHitstun()||
      this.getSourceShieldBreakPresentationState()?'accepted-hit':hasNewOwner||!active&&
        (Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1)?'new-owner':null;
    this.itemContextEquipment=stepLinkItemContextEquipment(state,{frame:this.sourceFrame,generation:this.getPositionResetGeneration(),clockAdvances,
      nativeMotionFrame:active?.nativeFrame??null,activeActionId:active?.id??null,controlEnded:active===null,interruption:interrupted});
    if(!this.itemContextEquipment&&state.temporaryFood)this.temporaryFoodIdentity=null;
    if(!this.itemContextEquipment){this.itemContextOwner=null;this.itemContextOwnerToken=null;}
  }
  /** Heavy walk already has a real carry controller/body route. Its captured
   * constant entry expression owns gear only, never a new body/physics clock. */
  getSourceHeavyCarryEquipmentPresentationState(){
    const held=this.getEquippedItem() as (HeldItemHandle&{id:number;spawnedAtFrame:number})|null,carry=this.getDonkeyKongHeavyCarryState();
    if(!held?.definition.heavy||!carry||carry.phase!=='walk'||this.getLinkBodyRoute()?.motion!=='item_heavy_walk')return null;
    if(!Number.isSafeInteger(held.id)||!Number.isSafeInteger(held.spawnedAtFrame))return null;
    const generation=this.getPositionResetGeneration(),itemIdentity=JSON.stringify([this.slotIndex,generation,held.id,held.spawnedAtFrame]),
      actionId=`heavy-carry:${itemIdentity}`,fact=LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_heavy_walk,
      selected=selectLinkItemContextEquipment(beginLinkItemContextEquipment({frame:this.sourceFrame,generation,actionId,itemIdentity,
        motion:'item_heavy_walk',nativeMotionFrame:carry.age+1,motionRate:1,facing:carry.facing,temporaryFood:false,equipmentAtEntry:this.inventoryEquipmentBaseline()}));
    return{...selected,ownsBodyRoute:false,sourceExpression:{function:fact.expressionFunction,sha256:fact.expressionSourceSha256},
      scriptNativeFrame:carry.age+1,sourceClockPolicy:'actual-carry-age-plus-one-current-engine-adapter',carry:{...carry}};
  }
  /** Accepted action leases retain their original entity after release/food
   * consumption; current held-object requirements belong only to carry/Hammer. */
  getCanonicalItemActionPresentationOwners(){
    const generation=this.getPositionResetGeneration(),context=this.getSourceLinkItemContextPresentationState(),state=this.itemContextEquipment;
    if(context?.ownsBodyRoute&&state&&!this.itemContextOwner){
      let tuple:unknown;try{tuple=JSON.parse(state.itemIdentity);}catch{return[];}
      if(!Array.isArray(tuple)||tuple.length!==4||tuple[0]!==this.slotIndex||tuple[1]!==generation||tuple.some(v=>!Number.isSafeInteger(v)||v<0))return[];
      const identity={actorIndex:this.slotIndex,actorGeneration:generation,entityId:tuple[2],entityGeneration:tuple[3]},fact=LINK_ITEM_CONTEXT_EQUIPMENT_FACTS[state.motion];
      const pickup=['item_light_get','item_light_walk_get','item_heavy_get'].includes(state.motion),kind=state.temporaryFood?
        'temporary-consumed-food-action':pickup?'reserved-pickup-action':'original-released-item-action';
      if(state.temporaryFood&&(!this.temporaryFoodIdentity||this.temporaryFoodIdentity.entityId!==identity.entityId||
        this.temporaryFoodIdentity.entityGeneration!==identity.entityGeneration||this.temporaryFoodIdentity.actorGeneration!==generation))return[];
      return[{componentRole:'body' as const,canonicalMotion:context.route.motion,rawAge:context.route.rawAge,facing:context.route.facing,
        ownerKind:kind,phase:context.phase,identity,actionId:state.actionId,itemIdentity:state.itemIdentity,entryFrame:state.entryFrame,
        actualItemActionLease:{...context,nativeMotionFrame:state.nativeMotionFrame,generation,entryFrame:state.entryFrame,temporaryFood:state.temporaryFood},
        sourceExpression:{function:fact.expressionFunction,sha256:fact.expressionSourceSha256}}];
    }
    const held=this.getEquippedItem() as (HeldItemHandle&{id:number;spawnedAtFrame:number;getHolderPlayerIndex?():number|null})|null;
    if(!held||held.getHolderPlayerIndex?.()!==this.slotIndex||!Number.isSafeInteger(held.id)||!Number.isSafeInteger(held.spawnedAtFrame))return[];
    const identity={actorIndex:this.slotIndex,actorGeneration:generation,entityId:held.id,entityGeneration:held.spawnedAtFrame,holderPlayerIndex:this.slotIndex},
      carry=this.getSourceHeavyCarryEquipmentPresentationState();
    if(carry)return[{componentRole:'body' as const,canonicalMotion:'item_heavy_walk',rawAge:carry.carry.age,facing:carry.carry.facing,
      ownerKind:'current-heavy-carry',identity,phase:carry.carry.phase,carry:carry.carry,sourceExpression:carry.sourceExpression}];
    const hammer=this.getHammerPresentation();if(!held.definition.hammer||!hammer||!context||context.ownsBodyRoute)return[];
    const motion=held.definition.hammer.golden?hammer.sheet.replace('item_hammer_','item_golden_hammer_'):hammer.sheet,
      source=LINK_ITEM_CONTEXT_EQUIPMENT_FACTS[hammer.sheet as LinkItemContextMotion];if(!source)return[];
    return[{componentRole:'body' as const,canonicalMotion:motion,rawAge:hammer.age,facing:hammer.facing,ownerKind:'current-hammer-gear-only',
      identity,phase:'hammer',golden:held.definition.hammer.golden===true,hammer:{...hammer},actualItemActionLease:context,
      sourceExpression:{function:source.expressionFunction,sha256:source.expressionSourceSha256}}];
  }
  /** Canonical motion is read from its admitted original spec/context. Drawn
   * aliases remain separate; the final observer cannot invent this name. */
  getCanonicalItemPresentationOwners(){
    const held=this.getEquippedItem() as (HeldItemHandle&{id:number;spawnedAtFrame:number;definition:HeldItemHandle['definition']&{type:string};getHolderPlayerIndex?():number|null})|null;
    if(!held||!Number.isSafeInteger(held.id)||!Number.isSafeInteger(held.spawnedAtFrame)||held.getHolderPlayerIndex?.()!==this.slotIndex)return[];
    const generation=this.getPositionResetGeneration(),identity={entityId:held.id,entityGeneration:held.spawnedAtFrame,actorGeneration:generation,itemType:held.definition.type,holderPlayerIndex:this.slotIndex};
    const context=this.getSourceLinkItemContextPresentationState(),state=this.itemContextEquipment;
    if(context?.ownsBodyRoute&&state&&!state.temporaryFood&&context.itemIdentity===JSON.stringify([this.slotIndex,generation,held.id,held.spawnedAtFrame])){
      const fact=LINK_ITEM_CONTEXT_EQUIPMENT_FACTS[state.motion];
      return[{componentRole:'body' as const,canonicalMotion:context.route.motion,rawAge:context.route.rawAge,facing:context.route.facing,
        phase:context.phase==='tail'?'tail':this.itemContextOwner?.phase==='charge'?'charge':'active',ownerKind:'actual-original-item-attack-and-context' as const,identity,actionId:context.actionId,
        sourceExpression:{function:fact.expressionFunction,sha256:fact.expressionSourceSha256},sourceIdentity:context.sourceIdentity}];
    }
    const shooting=this.getItemShootingCanonicalPresentation();
    return shooting?shooting.roles.map(role=>({...role,phase:shooting.phase,
      ownerKind:role.componentRole==='lower'?'actual-supported-shooting-legs' as const:shooting.kind==='scope'?
        'actual-original-shooting-spec-and-phase' as const:'actual-original-shooting-spec-and-paid-callback' as const,
      identity,shootingKind:shooting.kind})):[];
  }
}

