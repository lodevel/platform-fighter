import type {InputProfileStore} from '../input/InputProfileStore';
import {InputResolver} from '../input/InputResolver';
import {DeviceInputDispatcher} from '../input/DeviceInputDispatcher';
import type {CustomStageData} from '../builder/customStageSerializer';
import type {CharacterDataSpec} from '../characters/characterSerializer';
import type {InputResolverHistoryState} from '../input/InputResolver';
import type {MatchResultPayload} from '../match/MatchEndDetector';
import type {SimView} from './view';
import {NEUTRAL_INPUT} from '../replay/InputCaptureBuffer';
import {buildSimView} from './buildSimView';
import {GAZE_KNOCKOUT_FLIGHT_FRAMES,type GazeKnockoutReceipt} from './knockoutFlight';
import {SIMULATION_BUILD_ID} from '../engine/buildIdentity';
import { parseMatchHistoryCheckpoint } from '../replay/MatchHistoryCheckpoint';
import { matchHistoryJson } from '../replay/MatchHistoryCheckpoint';
import type { MatchHistoryCheckpoint } from '../replay/MatchHistoryCheckpoint';
import { serializeReplay } from '../replay/ReplayFile';
import { serializeBindingsSnapshot } from '../input/InputBindingsSerializer';
import { deserializeBindingsSnapshot } from '../input/InputBindingsSerializer';
import { serializeCustomStage } from '../builder/customStageSerializer';
import { deserializeCustomStage } from '../builder/customStageSerializer';
import { canonicalMatchHistoryEvidence } from '../replay/MatchHistoryEvidence';
import { recoveryTransactionAccepted } from '../items/recoveryTransaction';
import { parseRecoveryTransactionEvent } from '../items/recoveryTransaction';
import type { RecoveryTransactionEvent } from '../items/recoveryTransaction';
import { AttackClankHandler } from '../match/AttackClankHandler';
import { smashBallSurfaceCpuInput } from '../ai/smashBallSurfaceCpuPolicy';
import type { SmashBallSurfaceCpuContext } from '../ai/smashBallSurfaceCpuPolicy';
import { resolvePikachuAndDonkeyKongFootstools } from '../characters/donkeykongFootstool';
import { stepCharacterPhysics } from '../characters/stepCharacterPhysics';
import { SmashBallRuntime } from '../finalSmash/SmashBallRuntime';
import type { SmashBallRuntimeSnapshot } from '../finalSmash/SmashBallRuntime';
import { getItemSpawnInterval } from '../items/itemSpawnSettings';
import { smashBallSwitchEnabled } from '../items/itemCatalog';
import { FinalSmashChoreography } from '../finalSmash/FinalSmashChoreography';
import { projectPikachuFinalCliffVelocity } from '../finalSmash/pikachuFinalCliffStop';
import type { FinalChoreographySnapshot } from '../finalSmash/FinalSmashChoreography';
import type { FinalContact } from '../finalSmash/FinalSmashChoreography';
import { beginFinalImpactVictimPresentation } from '../finalSmash/finalVictimPresentation';
import { parseFinalVictimPresentationState } from '../finalSmash/finalVictimPresentation';
import { finalBodyPose } from '../finalSmash/finalBodyPose';
import { FINAL_FX_CUES } from '../finalSmash/registeredFinalFx';
import { isFinalFxFighter } from '../finalSmash/finalFxProfiles';
import { stepFinalFxRunClock } from '../finalSmash/finalFxRunClock';
import { parseFinalFxRunClock } from '../finalSmash/finalFxRunClock';
import type { FinalFxRunClock } from '../finalSmash/finalFxRunClock';
import { finalPacketBinding } from '../finalSmash/finalPacketBinding';
import { finalRunPacketHit } from '../finalSmash/finalPacketBinding';
import { capsuleIntersectsBounds } from '../characters/attackCollisionShapes';
import type { FinalRun } from '../finalSmash/finalSmashSchema';
import type { FinalControllerEvent } from '../finalSmash/finalSmashSchema';
import { isFinalFighter } from '../finalSmash/finalSmashSchema';
import type { LinkAncientFinalEvent } from '../characters/linkAncientFinal';
import { LinkArticles } from '../match/linkArticles';
import { advanceLinkBoomerang } from '../match/linkArticles';
import { brakeLinkProjectile } from '../match/linkArticles';
import { linkProjectileAngle } from '../match/linkArticles';
import { linkProjectileHit } from '../match/linkArticles';
import { linkProjectileSpares } from '../match/linkArticles';
import { linkProjectileTerrain } from '../match/linkArticles';
import { linkProjectileTerrainContact } from '../match/linkArticles';
import { reflectLinkProjectile } from '../match/linkArticles';
import type { LinkArticleFighter } from '../match/linkArticles';
import type { LinkArticleHost } from '../match/linkArticles';
import type { LinkProjectileMotion } from '../match/linkArticles';
import type { LinkTerrainBox } from '../match/linkArticles';
import type { LinkTerrainSurface } from '../match/linkArticles';
import { beginLinkScreenKoPresentation } from '../characters/linkContextualPresentation';
import { stepLinkScreenKoPresentation } from '../characters/linkContextualPresentation';
import { parseLinkScreenKoPresentationState } from '../characters/linkContextualPresentation';
import type { LinkScreenKoPresentationState } from '../characters/linkContextualPresentation';
import { sweepTranslatedSourceShape } from '../characters/sourceShapeSweep';
import type { SourceSweepTarget } from '../characters/sourceShapeSweep';
import { transformPikachuFinalOrientationPoint } from '../finalSmash/pikachuFinalOrientation';
import type { AttackCollisionHit } from '../characters/attacks';
import { parseOrdinaryProjectileCheckpoint } from '../characters/ordinaryProjectileCheckpoint';
import type { OrdinaryProjectileCheckpoint } from '../characters/ordinaryProjectileCheckpoint';
import type { OrdinaryProjectileVisualRecipe } from '../characters/ordinaryProjectileCheckpoint';
import { LINK_ARROW_ITEM_DEFINITION } from '../items/LinkArrowItem';
import { LINK_REMOTE_BOMB_ITEM_DEFINITION } from '../items/LinkRemoteBombItem';
import { linkRemoteBombReleaseVelocity } from '../characters/linkRemoteBomb';
import { activeAbsorber } from '../characters/attackAbsorber';
import { sweepAttackAbsorber } from '../characters/attackAbsorber';
import { absorbedHealingAmount } from '../characters/attackAbsorber';
import type { AttackAbsorbWindow } from '../characters/attackAbsorber';
import type { AbsorbProjectileShape } from '../characters/attackAbsorber';
import { sweepLinkPassiveShield } from '../characters/linkPassiveShield';
import { linkPassiveShieldCanIntercept } from '../characters/linkEquipment';
import { FinalSmashController } from '../finalSmash/FinalSmashController';
import type { FinalControllerSnapshot } from '../finalSmash/FinalSmashController';
import { NEW_MATCH_FINAL_RULES } from '../finalSmash/finalSmashSchema';
import { parseFinalSmashRules } from '../finalSmash/finalSmashSchema';
import { finalMeterStockRetentionRatio } from '../finalSmash/finalSmashMeter';
import { coordinateCaptureAttachments } from '../characters/captureAttachmentCoordinator';
import { captureAttachmentLinkIdentity } from '../characters/captureAttachmentCoordinator';
import { isNewCaptureAttachmentLink } from '../characters/captureAttachmentCoordinator';
import { advanceItemFlick } from '../items/itemActions';
import { itemFlickStrength } from '../items/itemActions';
import { EMPTY_ITEM_FLICK } from '../items/itemActions';
import { fighterItemProfile } from '../items/itemActions';
import { itemReleaseVelocity } from '../items/itemActions';
import { resolveItemThrowDirection } from '../items/itemActions';
import { selectGroundPickup } from '../items/itemActions';
import { selectHeldItemPress } from '../items/itemActions';
import type { ItemAction } from '../items/itemActions';
import type { ItemFlickState } from '../items/itemActions';
import { canCatchItem } from '../items/itemCatch';
import { canRecatchItem } from '../items/itemCatch';
import { canRepeatAerialItemThrow } from '../items/itemCatch';
import { EMPTY_ITEM_REPEAT_RULES } from '../items/itemCatch';
import { noteAerialItemThrowEnd } from '../items/itemCatch';
import { noteItemZDrop } from '../items/itemCatch';
import { tickItemRepeatRules } from '../items/itemCatch';
import type { ItemRepeatRules } from '../items/itemCatch';
import { acquisitionRectanglesOverlap } from '../items/itemAcquisitionBounds';
import { fighterAcquisitionRectangle } from '../items/itemAcquisitionBounds';
import { itemAcquisitionRectangle } from '../items/itemAcquisitionBounds';
import { nearestAcquirableItem } from '../items/itemAcquisitionBounds';
import { ITEM_DROP_RNG_STREAM } from '../items/heldItemDrop';
import { rollHeldItemDrop } from '../items/heldItemDrop';
import { ITEM_CONTAINER_RNG_STREAM } from '../items/itemContainer';
import { eligibleContainerContents } from '../items/itemContainer';
import { containerBreaksOnImpact } from '../items/itemContainer';
import { stepContainerRoll } from '../items/itemContainer';
import type { ContainerBreakOutcome } from '../items/itemContainer';
import { foodDefinition } from '../items/Food';
import { FOOD_VARIANTS } from '../items/Food';
import { donkeyKongHeavyReleaseVelocity } from '../characters/donkeykongHeavyItems';
import { fighterHeavyItemProfile } from '../characters/donkeykongHeavyItems';
import type { DonkeyKongHeavyItemAction } from '../characters/donkeykongHeavyItems';
import { advanceNativeItemVelocity } from '../items/nativeItemThrow';
import { itemAttackLaunchVelocity } from '../items/nativeItemThrow';
import { itemThrowReboundVelocity } from '../items/nativeItemThrow';
import { nativeItemReleaseVelocity } from '../items/nativeItemThrow';
import { thrownItemHit } from '../items/nativeItemThrow';
import { advanceBoomerang } from '../characters/projectileMotion';
import { orderProjectileContacts } from '../characters/projectileMotion';
import { reflectProjectile } from '../characters/projectileMotion';
import { sweptHurtboxEntry } from '../characters/projectileMotion';
import { sweptProjectileEntry } from '../characters/projectileMotion';
import { sweptProjectileCapsuleEntry } from '../characters/projectileMotion';
import type { BoomerangFlight } from '../characters/projectileMotion';
import { HITBOX_LABEL } from '../characters/attacks';
import { hitLaunchFacing } from '../characters/attacks';
import type { HitboxPlugin } from '../characters/attacks';
import { capsulesIntersect } from '../characters/capsuleGeometry';
import { posedCapsule, type CollisionCapsule } from '../characters/capsuleGeometry';
import type { SpecialProjectileTarget } from '../characters/pikachuSpecialRuntime';
import { activeReflector } from '../characters/attackReflector';
import { GAME_CONFIG } from '../engine/constants';
import { ASSET_KEYS } from '../assets/manifest';
import { PhysicsEngine } from '../engine/PhysicsEngine';
import { CHARACTER_SLOT_BITS } from '../engine/collisionCategories';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { BaseStage } from '../stages/BaseStage';
import { FLAT_STAGE } from '../stages/stageDefinitions';
import { STAGES } from '../stages/stageDefinitions';
import { getStage } from '../stages/stageDefinitions';
import { customStageDataToStageLayout } from '../stages/customStageLoader';
import { customStageSlotIdFromRuntimeId } from '../stages/customStageLoader';
import { isCustomStageId } from '../stages/customStageLoader';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { loadCustomStage } from '../builder/customStageStorage';
import type { Character } from '../characters/Character';
import type { CharacterInput } from '../characters/Character';
import { applyCharacterMoveOverrides } from '../characters/characterFactory';
import { createCharacterById } from '../characters/characterFactory';
import { getCharacterSpec } from '../characters/roster';
import { isLedgeLockingInput } from '../characters/ledgeHangState';
import type { LedgeCandidate } from '../characters/ledgeDetection';
import { resolveLedgeTrumps } from '../characters/ledgeHangState';
import { computeHitboxCenter } from '../characters/attacks';
import type { ItemShot } from '../characters/attacks';
import { computeHitlag } from '../characters/combat';
import { computeShieldParryHitlag } from '../characters/combat';
import type { HitInfo } from '../characters/combat';
import { applyCombatModifiers } from '../characters/referenceCombatModifiers';
import type { ChargeSpec } from '../characters/chargeSchema';
import { computeChargeTFromSpec } from '../characters/chargeSchema';
import { computeChargedDamageFromSpec } from '../characters/chargeSchema';
import { computeChargedKnockbackFromSpec } from '../characters/chargeSchema';
import { LiveCpuController } from '../ai/LiveCpuController';
import type { LiveCpuWorld } from '../ai/LiveCpuController';
import type { LiveCpuFighter } from '../ai/LiveCpuController';
import { finalSmashCpuInput } from '../ai/finalSmashCpuPolicy';
import type { FinalCpuDecision } from '../ai/finalSmashCpuPolicy';
import { InputBindingsStore } from '../input/InputBindingsStore';
import { BlastZoneWatcher } from '../match/BlastZoneWatcher';
import { BlastZonePositionWatcher } from '../match/BlastZonePositionWatcher';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { StockTracker } from '../match/StockTracker';
import { MatchEndDetector } from '../match/MatchEndDetector';
import { MatchStatsTracker } from '../match/MatchStatsTracker';
import { RespawnHandler } from '../match/RespawnHandler';
import { DEFAULT_ENDING_DURATION_FRAMES } from '../match/MatchEndDetector';
import { DEFAULT_INVINCIBILITY_FRAMES } from '../match/StockTracker';
import { DEFAULT_STOCK_COUNT } from '../match/StockTracker';
import { buildMatchStartMetadata } from '../match/MatchStart';
import { initialiseMatchRngFromConfig } from '../match/MatchInit';
import type { BlastZoneCollisionEvent } from '../match/BlastZoneWatcher';
import type { HitboxCollisionEvent } from '../match/HitboxDamageHandler';
import type { LavaCollisionEvent } from '../match/LavaCollisionWatcher';
import type { WindCollisionEvent } from '../match/WindForceController';
import type { MatchRng } from '../match/MatchRng';
import type { MatchStartMetadata } from '../match/MatchStart';
import type { MatchConfig } from '../types/index';
import type { PlayerSlot } from '../types/index';
import type { StageLayout } from '../types/index';
import { maskPlayerSlots } from '../characters/activeFighters';
import { MatchRulesController } from '../match/MatchRulesController';
import { LIVE_SUDDEN_DEATH_PERCENT } from '../match/MatchRulesController';
import { simDigest } from '../match/simDigest';
import { SimEventQueue } from './simEvents';
import { displayAngleDegrees } from './displayAngle';
import { createMatterPhysicsWorld } from '../physics/matterPhysicsWorld';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { snapshotMatchCharacters } from '../match/characterSnapshot';
import { oneOnOneDamageTakenMultiplier } from '../match/oneOnOneDamage';
import { buildMatchParticipants } from '../match/matchParticipants';
import { createMatchBindingsStore } from '../match/matchParticipants';
import type { MatchParticipant } from '../match/matchParticipants';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import { InputCaptureBuffer } from '../replay/InputCaptureBuffer';
import type { CapturedFrame } from '../replay/InputCaptureBuffer';
import { RecordingController } from '../replay/RecordingController';
import { ItemSpawnManager } from '../items/ItemSpawnManager';
import { resolveItemFrequency } from '../items/itemSpawnSettings';
import { ItemRegistry } from '../items/ItemRegistry';
import { ItemEntity } from '../items/ItemEntity';
import { Inventory } from '../items/Inventory';
import type { ItemDefinition } from '../items/ItemDefinition';
import { enabledSpawnItems } from '../items/itemCatalog';
import { isBatteringItemMove } from '../items/itemCatalog';
import { ITEM_TYPE_RNG_STREAM } from '../items/itemCatalog';
import { pickSpawnItem } from '../items/itemCatalog';
import { HAMMER_RNG_STREAM } from '../items/Hammer';
import { GOLDEN_HAMMER_RNG_STREAM } from '../items/Hammer';
import { HAMMER_HEAD_DEFINITION } from '../items/Hammer';
import { hammerHit } from '../items/Hammer';
import { itemExplosionHit } from '../items/BobOmb';
import { stepBobOmb } from '../items/BobOmb';
import type { ItemExplosionSpec } from '../items/BobOmb';
import { BANANA_SLIP_PUSH } from '../items/BananaPeel';
import { BANANA_SLIP_RADIUS } from '../items/BananaPeel';
import { bananaSlipHit } from '../items/BananaPeel';
import { ItemSpawnEventLog } from '../replay/ItemSpawnEventLog';
import { mapHitConnectToSfxKey } from '../audio/combatAudio';
export interface MatchSimData {
  /** Rebuild the complete world by consuming its original fixed-step history. */
  readonly historyCheckpoint?:MatchHistoryCheckpoint;
  readonly matchConfig?: MatchConfig;
  readonly rngSeed?: number;
  /**
   * AC 20104 Sub-AC 4 — saved-stage loader entry point. When the menu
   * flow selects a custom stage, the Stage Select scene loads the
   * saved blob via `loadCustomStage(slotId)` and forwards the typed
   * {@link CustomStageData} body here. `MatchScene` converts it to a
   * runtime {@link StageLayout} via `customStageDataToStageLayout` and
   * uses that as the active stage instead of consulting the built-in
   * `STAGES` registry.
   *
   * When omitted, the scene falls back to the M2 lookup-by-id path so
   * existing call sites (replay loader, dev-mode "press ENTER to
   * fight", built-in stage selection) continue to work unchanged.
   *
   * If the `matchConfig.stageId` is also set to a `'custom:<slot-id>'`
   * value AND no `customStage` body is supplied, the scene falls back
   * to loading the body from `localStorage` via `loadCustomStage` —
   * useful for the (future) replay-load path that re-enters the match
   * scene from a saved replay header.
   */
  readonly customStage?: CustomStageData;
  /** Character Lab-only per-slot tuning; validated before the scene starts. */
  readonly characterOverrides?: ReadonlyArray<{
    readonly slotIndex: 1 | 2 | 3 | 4;
    readonly spec: CharacterDataSpec;
  }>;
  /** Lab matches deliberately do not create replay files with incomplete metadata. */
  readonly labMode?: boolean;
}
export interface MatchSimOptions extends MatchSimData {
 readonly viewport?:{readonly width:number;readonly height:number};
 readonly bindingsStore?:InputBindingsStore;
 /** Exact match-local store shared with the browser's input resolver. */
 readonly runtimeBindingsStore?:InputBindingsStore;
 readonly inputProfiles?:InputProfileStore;
 readonly buildIdentity?:string;
 readonly inputHistory?:{captureHistoryState():InputResolverHistoryState;restoreHistoryState(value:InputResolverHistoryState):void};
}
/** Deterministic match runtime shared by the browser renderer and Node replay tools. */
export class MatchSim {
 readonly viewport:{readonly width:number;readonly height:number};
 readonly buildIdentity:string;
 result:MatchResultPayload|null=null;
 isFinished=false;
 stepInputs:readonly (CharacterInput|null|undefined)[]|undefined;
 constructor(public readonly options:MatchSimOptions){this.viewport=options.viewport??{width:GAME_CONFIG.width,height:GAME_CONFIG.height};this.buildIdentity=options.buildIdentity??SIMULATION_BUILD_ID;this.create(options);this.reconstructHistory();}
 get matter():PhysicsWorld{return this.physicsWorld;}
 pause():void{this.pausedForMenu=true;this.physicsEngine.pause();}
 resume():void{
   const loop=this.physicsEngine.getLoop(),frame=loop.getFrame(),accumulatorMs=loop.getAccumulatorMs();
   this.pausedForMenu=false;this.physicsEngine.resume();
   // Menu pause never accumulates elapsed time. Keep the already-earned
   // fractional step; GameLoop.resume otherwise intentionally drops it.
   loop.restoreReconstructedClock({frame,accumulatorMs,paused:false});
 }
 step(inputs?:readonly (CharacterInput|null|undefined)[]):number{
   if(this.pausedForMenu||this.physicsEngine.isPaused()||this.isFinished)return 0;
   this.stepInputs=inputs;
   if(this.advanceSourceIntro(this.physicsEngine.fixedTimestepMs))return 0;
   const accumulatorMs=this.physicsEngine.getLoop().getAccumulatorMs();
   this.fixedStep();this.physicsEngine.setFrame(this.physicsEngine.getFrame()+1);
   this.physicsEngine.getLoop().restoreReconstructedClock({frame:this.physicsEngine.getFrame(),accumulatorMs,paused:false});return 1;
 }
 advance(deltaMs:number,inputs?:readonly (CharacterInput|null|undefined)[]|((frame:number)=>readonly (CharacterInput|null|undefined)[]|undefined)):number{
   if(this.pausedForMenu||this.isFinished)return 0;
   return this.physicsEngine.advance(this.advanceSourceIntro(deltaMs)?0:deltaMs,()=>{
     this.stepInputs=typeof inputs==='function'?inputs(this.physicsEngine.getFrame()):inputs;
     this.fixedStep();
   });
 }
 reconstructHistory():void{
   const history=this.historyRestore;if(!history)return;
   while(this.sourceIntro&&!(history.frame===0&&history.intro&&this.sourceIntro.frame>=history.intro.frame))this.advanceSourceIntro(this.physicsEngine.fixedTimestepMs);
   while(this.physicsEngine.getFrame()<history.frame){
     const before=this.physicsEngine.getFrame();this.step();
     if(this.physicsEngine.getFrame()===before)throw new Error('History reconstruction stopped before its target frame');
   }
   this.finishMatchHistoryRestore();
 }
 dispose():void{
   this.physicsEngine?.pause();
   this.finalContactDebugCapsules.length=0;
   this.gazeKnockouts.clear();
   for(const slot of this.playerSlots??[])slot.character.destroy();
   this.baseStage?.destroy();
   if(this.physicsWorld){for(const [name,handler] of [['collisionstart',this.collisionStartHandler],['collisionactive',this.hitboxCollisionActiveHandler],['collisionend',this.collisionEndHandler],['beforeupdate',this.passThroughPlatformHandler],['afterupdate',this.fighterSeparationHandler]] as const)if(handler)this.physicsWorld.world.off(name,handler);}
   this.simEvents.drain();
 }
 emptyInputHistory():InputResolverHistoryState{
   return new InputResolver({slots:this.playerSlots.map(slot=>slot.bindingsSlot),dispatcher:new DeviceInputDispatcher({
     bindings:this.finalBindingsStore!,keyboard:{isDown:()=>false},gamepad:{isConnected:()=>false,getButton:()=>({pressed:false,value:0}),getAxis:()=>0}
   })}).captureHistoryState();
 }
 view():SimView{return buildSimView(this);}
public fixedStep():void {
const frame = this.physicsEngine.getFrame();
this.finalContactDebugCapsules.length=0;
for(const [index,flight]of this.gazeKnockouts)if(frame-flight.bornFrame>=GAZE_KNOCKOUT_FLIGHT_FRAMES)this.gazeKnockouts.delete(index);
for(const [index,state] of this.sourceScreenKo){const next=stepLinkScreenKoPresentation(state,{frame,generation:state.generation,clockAdvances:true,interrupted:false});
          if(next)this.sourceScreenKo.set(index,next);else this.sourceScreenKo.delete(index);}
const matchOverFrozen = this.matchEndDetector.isMatchOver();
if (!matchOverFrozen) {
          // ---- Inputs (AC 204 Sub-AC 4 → AC 5 Sub-AC 3 → AC 50202 Sub-AC 2)
          // Sample BEFORE stepping the world so the per-step velocity
          // commit in `Character.applyInput` is integrated by the very
          // next Matter step.
          //
          // AC 5 Sub-AC 3 — the input loop is slot-uniform: for every
          // entry in `playerSlots` we resolve the slot's
          // `CharacterInput` through the central InputResolver keyed
          // by `slot.bindingsSlot` (1–4). The bindings-slot index
          // selects the per-player profile in the live
          // {@link InputBindingsStore}, so gameplay reads remapped
          // keyboard/gamepad inputs for every player from their
          // per-player binding profile — no hardcoded WASD / arrow /
          // button-index path is left in this hot loop. The same loop
          // scales unchanged when 4-player wiring grows `playerSlots`
          // to 4 entries: P3 / P4 just read through their gamepad
          // profiles via the same call.
          //
          // AC 50202 Sub-AC 2 — every gameplay consumer (movement /
          // jump logic, attack and special triggers, shield / grab /
          // dodge handlers) reads inputs through the central
          // {@link InputResolver}. The resolver is updated exactly
          // once per fixed step so a single device sample feeds every
          // per-slot read; it exposes `getAction(playerIndex,
          // actionName)` / `isActionHeld(playerIndex, actionName)` /
          // `getMoveVector(playerIndex)` over the eight action
          // categories the Seed names (`move{Left,Right,Up,Down}` /
          // jump / attack / special / shield / grab / dodge); the
          // {@link buildCharacterInputFromResolver} helper translates
          // the resolver's per-player snapshot into the
          // `CharacterInput` record the runtime consumes. There is
          // no raw key code, gamepad button index, or device-specific
          // lookup left in the gameplay path — every action category
          // routes through the rebindable binding layer (resolver →
          // dispatcher → bindings store).
          //
          // Sub-AC 4.2: skip applyInput for eliminated fighters so a
          // ghost body on the eliminated slot doesn't keep responding
          // to its bindings. The body is left in the world but
          // unregistered from the blast-zone watcher; we'll hide its
          // visuals further down.
          //
          // AC 30002 Sub-AC 2: capture the per-player snapshot into the
          // input buffer keyed by frame number. The buffer normalises
          // each entry into a closed `RecordedCharacterInput` so the
          // (later-AC) replay player can feed it back into
          // `applyInput` byte-for-byte. Eliminated slots collapse to
          // `undefined` here, which the buffer records as
          // `NEUTRAL_INPUT` — preserving the "exactly playerCount
          // entries per frame" invariant.
          //
          // Single device poll feeds every consumer: refresh the
          // resolver ONCE here so the subsequent per-slot translator
          // calls all read off the same snapshot — no double-polling,
          // no per-slot device sample.
          this.consumeFinalEvents(this.finalSmashController?.step(frame, frame, true) ?? [], frame);
          
          const frameInputs: Array<CharacterInput | undefined> =
            new Array(this.playerSlots.length);
          // A throw direction is relative to the body before this input can
          // turn it. Keep that basis through the solved release position.
          const itemEntryFacings = new Map(this.playerSlots.map(slot=>[slot.playerIndex,slot.character.getFacing()] as const));
          const recorded = this.recordedInputs?.get(frame) ?? null;
          if (this.recordedInputs && recorded?.length !== this.playerSlots.length) throw new Error('Missing exact reconstruction input frame');
          const cpuWorld = this.cpuControllers.size > 0 ? this.buildCpuWorld() : null;
          for (let i = 0; i < this.playerSlots.length; i += 1) {
            const slot = this.playerSlots[i]!;
            if (this.stockTracker.isEliminated(slot.playerIndex)) {
              frameInputs[i] = undefined;
              continue;
            }
            // Per-player binding lookup: slot.bindingsSlot ∈ {1..4}
            // selects which binding profile in the shared store the
            // dispatcher reads, so each player's keyboard / gamepad
            // sources go through the rebinds they configured (or the
            // defaults, if they never visited the rebinding screen).
            //
            // AC 50202 Sub-AC 2: resolve the slot's `CharacterInput`
            // through the central InputResolver — every action
            // (move vector, jump, attack, special, shield, grab,
            // dodge) is read by name through `resolver.getAction(...)
            // ` / `resolver.isActionHeld(...)`, and the result is
            // folded into the `CharacterInput` shape that
            // `Character.applyInput` consumes.
            const cpu = this.cpuControllers.get(slot.playerIndex);
            let input: CharacterInput;
            if (cpu && cpuWorld) {
              input = cpu.sample(frame, cpuWorld);
              const self=slot.character,p=self.getPosition(),target=cpuWorld.fighters.filter(f=>f.active&&f.playerIndex!==slot.playerIndex)
                .slice().sort((a,b)=>Math.hypot(a.position.x-p.x,a.position.y-p.y)-Math.hypot(b.position.x-p.x,b.position.y-p.y)||a.playerIndex-b.playerIndex)[0];
              const targetActor=target?this.playerSlots.find(s=>s.playerIndex===target.playerIndex)?.character:null;
              const ball=this.smashBallRuntime?.getRoaming(),preview=self.getCpuNeutralAttackContactPreview(frame),hull=self.body.bounds;
              const surfaceDecision=this.retainedBallCpuInput(input,{frame,actor:{playerIndex:slot.playerIndex,generation:self.getPositionResetGeneration(),
                position:p,sourceRoot:self.getSourceRootPosition(),feetY:hull.max.y,halfWidth:(hull.max.x-hull.min.x)/2,velocity:self.getVelocity(),
                grounded:self.isGrounded(),mayJump:self.canAttack(),mayAttack:self.canAttack()&&self.getActiveAttack()===null,facing:self.getFacing(),
                currentNeutralAttackIdentity:preview?.provenance.moveIdentity??null,hasHeldItem:self.getEquippedItem()!==null},
                surfaces:this.baseStage.bodies.platformBodies.filter(body=>!body.isSensor&&body.collisionFilter.mask!==0&&
                  ([PLATFORM_LABELS.solid,PLATFORM_LABELS.passThrough] as readonly string[]).includes(body.label)).map(body=>({id:body.id,minX:body.bounds.min.x,maxX:body.bounds.max.x,topY:body.bounds.min.y})),
                supportBodyId:self.getSourceSupportPresentationObservation()?.bodyId??null,
                ball:ball?{position:ball.position,radius:this.smashBallRuntime!.policy.radius,variant:ball.resource.heavy?'heavy':'ordinary',active:true}:null,
                eligible:this.finalSmashController?.canOwnResource(slot.playerIndex)??false,
                availableResource:this.finalSmashController?.getAvailableResource(slot.playerIndex)??null,
                activeFinal:this.finalSmashController?.getActive()!=null,previousAttackHeld:this.cpuBallAttackHeld.get(slot.playerIndex)??false,
                attackContactRange:preview?.range??null,attackContactProvenance:preview?.provenance??null,canExecuteJumpProof:false},self,ball?.resource.id??null);
              input=surfaceDecision.input;this.cpuBallStrategies.set(slot.playerIndex,{frame,strategy:surfaceDecision.strategy});
              const decision=finalSmashCpuInput(input,{self:{playerIndex:slot.playerIndex,generation:self.getPositionResetGeneration(),position:p,
                facing:self.getFacing(),grounded:self.isGrounded(),active:!this.stockTracker.isRespawning(slot.playerIndex)&&!this.stockTracker.isEliminated(slot.playerIndex),
                eligible:this.finalSmashController?.canOwnResource(slot.playerIndex)??false,legallyActionable:self.canActivateFinalSmash()},
                target:target&&targetActor?{playerIndex:target.playerIndex,generation:targetActor.getPositionResetGeneration(),position:target.position,active:target.active}:null,
                availableResource:this.finalSmashController?.getAvailableResource(slot.playerIndex)??null,
                activeFinal:this.finalSmashController?.getActive()!==null&&this.finalSmashController?.getActive()!==undefined,
                previousSpecialHeld:this.finalSpecialHeld.get(slot.playerIndex)??false});
              input=decision.input;this.cpuBallAttackHeld.set(slot.playerIndex,input.attack===true);this.cpuFinalStrategies.set(slot.playerIndex,{frame,strategy:decision.strategy});
            } else {
              input = this.stepInputs?.[i] ?? NEUTRAL_INPUT;
            }
            // A recorded input overrides the sampled one (the CPU above still ran, as when recorded).
            frameInputs[i] = recorded?.[i] ?? this.stepInputs?.[i] ?? input;
          }
          const finalRequests = this.playerSlots.flatMap((slot, i) => {
            const input = frameInputs[i], fighter = slot.character.id;
            const prior = this.finalSpecialHeld.get(slot.playerIndex) ?? false;
            this.finalSpecialHeld.set(slot.playerIndex, input?.special === true);
            if (!input || !isFinalFighter(fighter) || !this.finalSmashController?.canOwnResource(slot.playerIndex)) return [];
            const neutral = Math.abs(input.moveX) < .35 && Math.abs(input.moveY ?? 0) < .35;
            return [{ playerIndex: slot.playerIndex, fighter, generation: slot.character.getPositionResetGeneration(),
              intendedFacing: Math.abs(input.moveX) > .1 ? (input.moveX>0?1:-1) as 1|-1 : slot.character.getFacing(),
              neutralSpecialEdge: input.special === true && !prior && neutral,
              legallyActionable: slot.character.canActivateFinalSmash(), airborne: !slot.character.isGrounded() }];
          });
          this.consumeFinalEvents(this.finalSmashController?.activate(finalRequests, frame) ?? [], frame);
          const finalOwner = this.finalSmashController?.getActive()?.owner.playerIndex;
          const finalFxClockOwner=this.playerSlots.find(slot=>slot.playerIndex===finalOwner)?.character,
            finalFxClockAdvances=!!finalFxClockOwner&&!finalFxClockOwner.isInHitlag();
          const finalOwnerInput = finalOwner === undefined ? undefined : frameInputs[this.playerSlots.findIndex(s=>s.playerIndex===finalOwner)];
          this.finalChoreography?.beforeStep(frame, !!finalOwnerInput && (finalOwnerInput.jump || finalOwnerInput.attack === true ||
            finalOwnerInput.special === true || finalOwnerInput.shield === true || finalOwnerInput.dodge === true || Math.abs(finalOwnerInput.moveX) > .1));
          // Capture the actual Dash admission before its detector can enter
          // Hit in the same Matter step. The later update is frame-idempotent.
          this.advanceFinalFxClock(frame,this.finalSmashController?.getActive()?.owner.playerIndex,finalFxClockAdvances);
          for (const body of this.baseStage.bodies.platformBodies) this.prevPlatformTopY.set(body, body.bounds.min.y);
          this.baseStage.updatePlatforms(frame, this.playerSlots.map((slot, i) => ({
            body: slot.character.body,
            canRide: !this.stockTracker.isEliminated(slot.playerIndex)
              && !slot.character.isSourceTerrainBypassControlled()
              && !slot.character.isInHitlag() && !slot.character.isGrabbed()
              && !isLedgeLockingInput(slot.character.getLedgeHangState()),
            dropThrough: !slot.character.getFinalSmashControl() && !slot.character.isSourceTerrainBypassControlled() && (frameInputs[i]?.dropThrough === true || slot.character.isInDropThroughWindow()),
          })));
          this.ledgeCandidatesByStage = this.baseStage.getLedgeCandidates();
          for (const slot of this.playerSlots) slot.character.setLedgeCandidates(this.ledgeCandidatesByStage);
          for(const slot of this.playerSlots)slot.character.advanceSourceGlobalPresentationClock(frame);
          const localInputs = frameInputs.map((raw,i)=>raw ? this.playerSlots[i]!.character.sampleFinalOpponentSlowInput(raw,frame) ?? undefined : undefined);
          this.ensureInventories();
          this.linkArticles.syncOwners(this.linkArticleFighters(),this.projectiles);
          // Resolve head contact from one pre-input snapshot. Neither slot
          // order nor the recipient's later input can erase this jump edge.
          const footstoolParticipants=this.playerSlots.flatMap((slot,i)=>
            localInputs[i] && !slot.character.getFinalSmashControl() && !this.stockTracker.isEliminated(slot.playerIndex)
              ? [slot.character.getFootstoolParticipant(slot.playerIndex,localInputs[i]!)] : []);
          const footstoolSlots=new Map(this.playerSlots.map(slot=>[slot.playerIndex,slot]));
          for (const contact of resolvePikachuAndDonkeyKongFootstools(footstoolParticipants)) {
            const jumper=footstoolSlots.get(contact.jumperIndex)!.character;
            const recipient=footstoolSlots.get(contact.recipientIndex)!.character;
            if (!contact.phantom && !recipient.canPresentFootstoolRecipient(contact.groundedRecipient)) continue;
            const identity={jumperIndex:contact.jumperIndex,jumperGeneration:jumper.getPositionResetGeneration(),
              recipientIndex:contact.recipientIndex,recipientGeneration:recipient.getPositionResetGeneration()};
            jumper.queueFootstoolJump(contact.phantom,identity);
            if (!contact.phantom) recipient.applyFootstoolRecipient(contact.groundedRecipient,frame,jumper.getPosition().x,identity);
          }
          const itemEvents: Array<{
            playerIndex:number;event:ReturnType<Character['drainItemActionEvents']>[number];
          }> = [];
          const donkeykongHeavyItemEvents:Array<{
            playerIndex:number;event:ReturnType<Character['drainDonkeyKongHeavyItemActionEvents']>[number];
          }>=[];
          for (let i = 0; i < this.playerSlots.length; i += 1) {
            const slot = this.playerSlots[i]!;
            const seconds=this.matchRules.getSecondsRemaining();slot.character.setSourceShieldBreakLastFiveSeconds(!this.matchRules.isSuddenDeath()&&seconds!==null&&seconds<=5);
            const raw = localInputs[i];
            if (!raw) continue;
            if (slot.character.getFinalSmashControl()) { slot.character.applyInput(frameInputs[i]!, frame); continue; }
            // Post-pickup latch: the pickup press never also fires the item's use; the
            // attack button stays suppressed until it is released.
            if (raw.attack !== true) this.suppressAttackUntilRelease.set(slot.playerIndex, false);
            const input = this.prepareItemInput(slot, raw, frame,
              itemEntryFacings.get(slot.playerIndex) ?? slot.character.getFacing());
            const suppressAttack = this.suppressAttackUntilRelease.get(slot.playerIndex) ?? false;
            slot.character.applyInput(suppressAttack ? { ...input, attack: false } : input, frame);
            itemEvents.push(...slot.character.drainItemActionEvents().map(event=>({playerIndex:slot.playerIndex,event})));
            for(const completed of slot.character.drainItemActionCompletions()){
              const repeat=this.itemRepeat.get(slot.playerIndex);
              if(repeat&&completed.plan.action.startsWith('throw-air-'))
                this.itemRepeat.set(slot.playerIndex,{...repeat,state:noteAerialItemThrowEnd(repeat.state)});
            }
            donkeykongHeavyItemEvents.push(...slot.character.drainDonkeyKongHeavyItemActionEvents()
              .map(event=>({playerIndex:slot.playerIndex,event})));
          }
          this.commitRecoveryEvents(frame,'beforePhysics');
          this.inputCaptureBuffer.captureFrame(frame, frameInputs);

          // ---- Ledge-TRUMP (Ultimate ledge-occupancy) -------------------
          // A fighter that JUST grabbed a ledge another was already hanging on
          // steals it and knocks the prior occupant off. Resolved here, after
          // every fighter's applyInput, against the previous step's keys.
          {
            const trumpSnaps = this.playerSlots.map((s) => {
              const nowKey = s.character.getHangingLedgeKey();
              const wasKey = this.prevLedgeKeys.get(s.playerIndex) ?? null;
              return {
                id: s.playerIndex,
                wasHanging: wasKey !== null,
                wasKey,
                nowHanging: nowKey !== null,
                nowKey,
              };
            });
            for (const victimId of resolveLedgeTrumps(trumpSnaps)) {
              this.playerSlots
                .find((s) => s.playerIndex === victimId)
                ?.character.trumpOffLedge();
            }
            for (const s of this.playerSlots) {
              this.prevLedgeKeys.set(
                s.playerIndex,
                s.character.getHangingLedgeKey(),
              );
            }
          }

          // ---- Hazard pre-step tick (AC 20101 Sub-AC 1 — BaseStage) ----
          // Tick every hazard entity (lava + wind, plus any future
          // hazard family the stage owns) exactly once before
          // `matter.world.step` so the freshly-computed bounds /
          // active state are reflected in the sensor body update —
          // and so a fighter that walks onto newly-active lava on
          // this step gets KO'd at the same frame the lava became
          // lethal. The stage is a no-op on hazard-free layouts so
          // the flat stage still pays zero cost.
          this.baseStage.tickHazards(frame);
          // Ambient background pulse rides the same fixed frame counter
          // so replays repaint identically.

          // One deterministic 16.67 ms physics step. Step the Matter world
          // explicitly so its integration uses *our* fixed dt, not Phaser's
          // variable rAF delta. Blast-zone collisions for *this* step's
          // motion fire during this call and the watcher records stock
          // losses against the current frame.
          const specialSurfaces = this.baseStage.bodies.platformBodies.filter(body => body.collisionFilter.mask !== 0)
            .map(body => ({ vertices: body.vertices ?? [], oneWay: body.label === PLATFORM_LABELS.passThrough }));
          const specialTargets: SpecialProjectileTarget[] = this.playerSlots.filter(slot => !this.stockTracker.isEliminated(slot.playerIndex))
            .map(slot => {
              const fighter = slot.character, p = fighter.getPosition(), facing = fighter.getFacing(), attack = fighter.getActiveAttack();
              const r = activeReflector(attack);
              return { ownerId: fighter.id, bodyId: fighter.body.id,
                hurtboxes: fighter.getActiveHurtboxes().filter(h => !h.intangible).map(h => h.capsule
                  ? posedCapsule(h.capsule, p, facing)
                  : { x: p.x + h.offsetX * facing, y: p.y + h.offsetY, width: h.width, height: h.height }),
                ...(r ? { reflector: { x: p.x + r.body.offsetX * attack!.facing,
                  y: p.y + r.body.offsetY, width: r.body.width, height: r.body.height,
                  damageScale: r.damageScale, velocityScale: r.velocityScale, onReflect: () => fighter.noteProjectileReflected() } } : {}) };
            });
          for (const slot of this.playerSlots) {
            slot.character.tickPikachuSpecialEntities(specialSurfaces, specialTargets);
          }
          const physicsCharacters = this.playerSlots.filter(slot =>
            !this.stockTracker.isEliminated(slot.playerIndex)).map(slot => slot.character);
          this.coordinatingPhysicsStep = physicsCharacters.some(character =>
            (character.getReferencePhysicsStep()?.ticks ?? 1) > 1);
          try {
            stepCharacterPhysics({
              characters: physicsCharacters,
              bodies: this.physicsWorld.world.getAllBodies(),
              gravity: this.physicsWorld.world.localWorld.gravity,
              body: this.physicsWorld.body,
              deltaMs: this.physicsEngine.fixedTimestepMs,
              stepWorld: delta => this.physicsWorld.world.step(delta),
              afterSubstep: () => {
                const placementAllowed: Parameters<typeof coordinateCaptureAttachments>[1] = (_captor,target,result)=>{
                  // Conservative project physical-body feasibility only: no native/alpha grip claim.
                  const size=target.getTuning(),p=result.stage.recipientCentre;
                  return this.baseStage.bodies.platformBodies.every(platform=>{
                    if(platform.isSensor||platform.collisionFilter.mask===0||platform.label!==PLATFORM_LABELS.solid)return true;
                    const b=platform.bounds;
                    return p.x+size.width/2<=b.min.x||p.x-size.width/2>=b.max.x||
                      p.y+size.height/2<=b.min.y+.05||p.y-size.height/2>=b.max.y;
                  });
                };
                coordinateCaptureAttachments(physicsCharacters,placementAllowed);
                const linksBeforeSampler=new Map(physicsCharacters.map(captor=>
                  [captor,captureAttachmentLinkIdentity(captor,captor.getCaptureAttachmentLink())] as const));
                this.hitboxDamageHandler.sampleHurtboxContacts(this.physicsWorld.world.getAllBodies());
                // The sampler can create a new capture whose pull pose renders this tick.
                // Established pairs were already coordinated above; only new live links
                // receive this second pass, using the same feasibility and global guards.
                coordinateCaptureAttachments(physicsCharacters,placementAllowed,(captor,link)=>
                  link !== null && captor.getGrabState().name === 'holding' &&
                  captor.getGrabState().active?.framesElapsed === 0 &&
                  isNewCaptureAttachmentLink(linksBeforeSampler.get(captor)??null,captor,link));
                // Catch transient crossings before another reference tick can
                // move the fighter back inside. Wind remains once per frame.
                this.baseStage.applyLavaEffects(frame);
                this.blastZonePositionWatcher.update(frame);
                for (const slot of this.playerSlots) {
                  if (this.stockTracker.isRespawning(slot.playerIndex) ||
                      this.stockTracker.isEliminated(slot.playerIndex)) slot.character.stopReferencePhysicsStep();
                }
              },
            });
            if (this.coordinatingPhysicsStep) this.updateFighterSeparation();
          } finally {
            this.coordinatingPhysicsStep = false;
          }

          // Held snapshots share the solved actor root used by the rendered
          // fighter and later item release. Prephysics tracking lagged a moving
          // hand by one integration step. Remote bombs retain their own adapter.
          // Activate Hammer before its first socket/render observation, preserving registry RNG order.
          for(const entity of this.itemRegistry.getActive())if(entity.definition.hammer&&entity.isHeld()&&!entity.getHammerState()){
            const holder=this.playerSlots.find(slot=>slot.playerIndex===entity.getHolderPlayerIndex());
            if(holder?.character.getEquippedItem()===entity)entity.startHammer(this.matchRng.stream(
              entity.definition.hammer.golden?GOLDEN_HAMMER_RNG_STREAM:HAMMER_RNG_STREAM).next());
          }
          for (const slot of this.playerSlots) {
            const held = this.inventoriesByPlayerIndex.get(slot.playerIndex)?.getHeldItem();
            if (held) {
              held.updateHeldPosition(slot.character.getHeldItemWorldPosition());
            }
          }

          // ---- Hazard post-step effects (AC 20101 Sub-AC 1 — BaseStage)
          // Drains the lava-KO and wind-force overlap queues. Lava
          // fires once per overlap session (leave + re-enter to re-
          // arm); wind is continuous (every active tick fires — the
          // gust is supposed to push every frame). Same `frame` that
          // drove `tickHazards` is forwarded so the listener
          // callbacks stamp the correct simulation frame onto stats /
          // replay events. No-op on hazard-free stages.
          this.baseStage.applyHazardEffects(frame);
          this.applyGazeHazards(frame);

          // ---- AC 90302 Sub-AC 2: items framework spawn-manager tick ---
          // Advance the per-match item-spawn schedule by exactly one
          // fixed-step. Driven AFTER hazard effects so the spawn cadence
          // observes the same `frame` the rest of the simulation just
          // committed against — every replay reproduces the same spawn
          // schedule tick-for-tick under the same `MatchConfig`.
          //
          // `activeItemCount` is hard-zero for now because the item-
          // entity layer (and its live-on-field registry) lands in a
          // later sub-AC. The manager treats `0` as "field empty, OK to
          // spawn" — which is the correct steady-state for a match with
          // no item entities yet. Once the entity layer wires in, the
          // count will read from the live items registry instead.
          //
          // Returned spawn requests are intentionally discarded here:
          // sub-AC 2 wires only the lifecycle so the `'item-spawn'` RNG
          // substream begins materialising from the canonical match-start
          // tick. A follow-up sub-AC will replace the discard with a
          // real `spawnItemAt(req.anchor, req.frame)` callsite without
          // touching the lifecycle wiring established here.
          if (this.itemSpawnManager) {
            // T3 (AC 10, 17) — drive the spawn manager with the live
            // active count so the on-field cap is respected.
            const reqs = this.itemSpawnManager.step(
              frame,
              this.itemRegistry.getActiveCount(),
            );
            // Inline viewport-translation closures because the
            // `toViewportX/Y` helpers from `create()` aren't in scope
            // here in `update()`. Same math, same source of truth.
            const stageOffsetX = this.baseStage.transform.offsetX;
            const stageOffsetY = this.baseStage.transform.offsetY;
            const stageScale = this.baseStage.bodies.scale;
            const toVx = (dx: number): number => stageOffsetX + dx * stageScale;
            const toVy = (dy: number): number => stageOffsetY + dy * stageScale;
            for (const req of reqs) {
              const interval = getItemSpawnInterval(resolveItemFrequency(this.activeMatchConfig.itemFrequency));
              if (interval && this.smashBallRuntime) this.smashBallRuntime.propose({ frame,
                enabled: this.finalSmashController?.rules.smashBallEnabled === true && smashBallSwitchEnabled(this.activeMatchConfig.itemSwitch),
                finalActive: this.finalSmashController?.getActive() !== null,
                interval, origin: { x: toVx(req.anchor.x), y: toVy(req.anchor.y) },
                chanceRoll: () => this.matchRng.stream('final-ball-spawn').next(),
                heavyRoll: () => this.matchRng.stream('final-ball-variant').next() });

              // Item Switch (MatchConfig.itemSwitch) + equal weights on the item-type stream.
              let def = pickSpawnItem(this.matchRng.stream(ITEM_TYPE_RNG_STREAM), enabledSpawnItems(this.activeMatchConfig.itemSwitch));
              if (!def) continue;
              if(def.type==='food')def=foodDefinition(FOOD_VARIANTS[this.matchRng.stream('item-food').range(0,FOOD_VARIANTS.length-1)]!);
              const spawnWorldPosition = { x: toVx(req.spawnPosition.x), y: toVy(req.spawnPosition.y) };
              const entity = this.itemRegistry.spawn(
                def,
                spawnWorldPosition,
                req.frame,
                ItemEntity,
              );
              this.itemSpawnEventLog.record({
                frame: req.frame,
                type: def.type,
                x: req.spawnPosition.x,
                y: req.spawnPosition.y,
                anchorIndex: req.anchorIndex,
              });
              const vx = spawnWorldPosition.x;
              const vy = spawnWorldPosition.y;
              // The stage authoring places `anchor.y` 60 design pixels
              // ABOVE the platform top (see
              // `FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset` in
              // stageDefinitions.ts) — that's the SPAWN hover point,
              // not the rest position. Compensating here lands items
              // on the platform top. Container parts are drawn from
              // y=0 upward so container.y == platform top puts the
              // silhouette's BASE on the platform (not its centre,
              // which would sink it halfway through).
              const ITEM_ANCHOR_HOVER_OFFSET_PX = 60;
              this.itemSurfaceY.set(
                entity.id,
                toVy(req.anchor.y + ITEM_ANCHOR_HOVER_OFFSET_PX),
              );
              this.itemFallingY.set(entity.id, spawnWorldPosition.y);
              // Recovery objects use their native individual gravity/fall cap, especially the slowly floating Heart.
              if(def.recovery)this.thrownItems.push({entity,ownerSlotIndex:-1,x:vx,y:vy,vx:0,vy:0,passiveDrop:true});
            }
            // T3 — falling-simulation + held-tracking + visual sync.
            const FALL_VELOCITY_PER_TICK = 6; // physical pixels / tick
            // Bug fix: a falling item without a registered `surfaceY`
            // (e.g. spawn anchor was stale or missing) used to freeze
            // in place mid-air. Compute a fallback surface from the
            // nearest enabled platform under the item's x position.
            // Pass-through platforms also catch items falling from above.
            const nearestItemPlatformTopBelow = (x: number, y: number): number | null => {
              let best: number | null = null;
              for (const p of this.baseStage.bodies.platformBodies) {
                if ((p.label !== PLATFORM_LABELS.solid && p.label !== PLATFORM_LABELS.passThrough)
                  || p.isSensor || p.collisionFilter.mask === 0) continue;
                if (x < p.bounds.min.x || x > p.bounds.max.x) continue;
                const top = p.bounds.min.y;
                if (top < y) continue; // platform above the item — skip
                if (best === null || top < best) best = top;
              }
              return best;
            };
            for (const entity of this.itemRegistry.getActive()) {
              const state = entity.getSnapshot().state;
              // Items in flight (throws, drops on damage) have one flight owner below; the
              // generic spawn-fall loop must not add its separate 6 px step as well.
              if(state==='falling'&&this.thrownItems.some(t=>t.entity===entity))continue;
              if (state === 'falling') {
                let visualY = this.itemFallingY.get(entity.id);
                // Recover from a missing `itemSurfaceY` entry (e.g. an
                // item spawned via a path that didn't register one):
                // use the nearest platform below as the fall target.
                if (visualY === undefined) {
                  visualY = entity.getPosition().y;
                  this.itemFallingY.set(entity.id, visualY);
                }
                // Live physical bounds also handle moved or disabled platforms.
                const surfaceY = nearestItemPlatformTopBelow(entity.getPosition().x, visualY) ?? undefined;
                if (surfaceY === undefined) this.itemSurfaceY.delete(entity.id);
                else this.itemSurfaceY.set(entity.id, surfaceY);
                if (surfaceY !== undefined) {
                  const nextY = visualY + (entity.definition.recovery?entity.definition.throwProfile.terminalFallSpeed*5:FALL_VELOCITY_PER_TICK);
                  if (nextY >= surfaceY) {
                    entity.markGrounded(frame, {
                      x: entity.getPosition().x,
                      y: surfaceY,
                    });
                    this.itemFallingY.delete(entity.id);
                  } else {
                    this.itemFallingY.set(entity.id, nextY);
                    entity.updateFreePosition({ x: entity.getPosition().x, y: nextY });
                  }
                } else {
                  // No platform under the item at all — fall freely
                  // until it crosses the bottom blast-zone threshold,
                  // then despawn it so it doesn't leak into the
                  // active-item count and starve future spawns.
                  // Bug fix: previously this branch fell forever and
                  // items stopped spawning once the cap was hit.
                  const nextY = visualY + (entity.definition.recovery?entity.definition.throwProfile.terminalFallSpeed*5:FALL_VELOCITY_PER_TICK);
                  const blast = this.baseStage.getViewportBlastZone();
                  const FALL_OFF_STAGE_Y = blast.y + blast.height;
                  if (nextY > FALL_OFF_STAGE_Y) {
                    entity.markDespawned(frame);
                    this.itemSurfaceY.delete(entity.id);
                    this.itemFallingY.delete(entity.id);
                  } else {
                    this.itemFallingY.set(entity.id, nextY);
                    entity.updateFreePosition({ x: entity.getPosition().x, y: nextY });
                  }
                }
              }
            }
            // Per-tick despawn / TTL housekeeping.
            const despawnedIds = this.itemRegistry.tick(frame);
            for (const id of despawnedIds) {
              this.containerStrikeFrames.delete(id);
              this.itemSurfaceY.delete(id);
              this.itemFallingY.delete(id);
            }
            // Auto-detach broken / despawned items from inventories.
            // The slot-override callback marks an item `broken` when
            // durability hits 0 but doesn't clear the holder's
            // inventory — without this sweep, the player keeps
            // "holding" a defunct item and every subsequent pickup
            // attempt is rejected by the single-slot invariant.
            for (const inv of this.inventoriesByPlayerIndex.values()) {
              const held = inv.getHeldItem();
              if (held && (held.isBroken() || held.isDespawned())) {
                inv.detachWithoutDrop();
              }
            }
          }

          // ---- Projectile system -------------------------------------
          // Spawn: any slot whose active attack is a `projectile` kind
          // and just entered the active phase (framesElapsed ===
          // startupFrames) emits exactly one projectile this frame.
          // The `projectileSpawnLatch` prevents repeats across the
          // multi-frame active window.
          for (const slot of this.playerSlots) {
            const active = slot.character.getActiveAttack();
            if (!active) continue;
            if (active.move.sourceRuntimeOwned) continue;
            const move = active.move as unknown as {
              specialKind?: string;
              sideSpecialKind?: string;
              boomerang?: Omit<BoomerangFlight, 'age' | 'returning' | 'hitTargets'>;
              projectile?: {
                speed: number;
                lifetimeFrames: number;
                width: number;
                height: number;
                spawnOffsetX: number;
                spawnOffsetY: number;
              };
              chargedProjectile?: {
                charge: ChargeSpec;
                maxSpeed: number;
                maxWidth: number;
                maxHeight: number;
              };
              startupFrames: number;
              id: string;
            };
            if (active.move.pikachuSpecial) continue;
            if ((move.specialKind !== 'projectile' && move.sideSpecialKind !== 'boomerang') || !move.projectile) continue;
            const latchKey = `${slot.playerIndex}:${move.id}:${active.framesElapsed}`;
            const inActive = active.framesElapsed === move.startupFrames;
            const slotMoveKey = `${slot.playerIndex}:${move.id}`;
            if (inActive && !this.projectileSpawnLatch.has(slotMoveKey)) {
              this.projectileSpawnLatch.add(slotMoveKey);
              if (move.boomerang && this.projectiles.some(p => p.ownerSlotIndex === slot.playerIndex && p.moveId === move.id)) continue;
              const facing = active.facing;
              const pos = slot.character.getPosition();
              const proj = move.projectile!;
              // Samus charge-beam scaling: the released shot's damage,
              // knockback, travel speed, and size all lerp from the
              // un-charged baseline (the move's authored damage/knockback
              // and the parent projectile speed/width/height — the t=0
              // endpoint) up to the full-charge endpoint, by how long the
              // button was held. Pure integer-frame lerp → replay-safe.
              const cp = move.chargedProjectile;
              const heldFrames = active.chargeHeldFrames ?? 0;
              const chargeT = cp ? computeChargeTFromSpec(cp.charge, heldFrames) : 0;
              const pSpeed = cp ? proj.speed + (cp.maxSpeed - proj.speed) * chargeT : proj.speed;
              const pWidth = cp ? proj.width + (cp.maxWidth - proj.width) * chargeT : proj.width;
              const pHeight = cp ? proj.height + (cp.maxHeight - proj.height) * chargeT : proj.height;
              const pDamage = cp ? computeChargedDamageFromSpec(cp.charge, heldFrames) : active.move.damage;
              const pKnockback = cp ? computeChargedKnockbackFromSpec(cp.charge, heldFrames, active.move.knockback) : active.move.knockback;
              const px = pos.x + facing * proj.spawnOffsetX;
              const py = pos.y + proj.spawnOffsetY;
              // Procedural sprite: boomerang, else the generic shuriken cross.
              const visualRecipe:OrdinaryProjectileVisualRecipe=move.boomerang?{kind:'boomerang'}:{kind:'shuriken'};
              this.addProjectile({visualRecipe,visualFacing:facing,
                ownerSlotIndex: slot.playerIndex,
                moveId: move.id,
                facing,
                damage: pDamage,
                knockback: pKnockback,
                hitlagMultiplier: active.move.hitlagMultiplier,
                sdiMultiplier: active.move.sdiMultiplier,
                reflectable:active.move.reflectable,absorbable:active.move.absorbable,
                x: px,
                y: py,
                vx: facing * pSpeed,
                vy: 0,
                width: pWidth,
                height: pHeight,
                framesRemaining: proj.lifetimeFrames,
                ...(move.boomerang ? { boomerang: { ...move.boomerang, age: 0, returning: false, hitTargets: new Set<number>() } } : {}),
              },frame);

            }
            // Drop the latch when the move ends so the NEXT press of
            // the same special spawns a fresh projectile.
            const totalBusy = move.startupFrames + (active.move.activeFrames ?? 0) + (active.move.recoveryFrames ?? 0);
            if (active.framesElapsed >= totalBusy - 1) {
              this.projectileSpawnLatch.delete(slotMoveKey);
            }
            void latchKey;
          }

          // Item shots (Star Rod stars, Ray Gun / Super Scope shots, Fire Flower flames) the holders queued this step.
          for (const slot of this.playerSlots)
            for (const event of slot.character.consumeItemShots()) this.spawnItemShot(slot.playerIndex, event);

          // ---- Swing-flash visual for held-item moves ----------------
          // Battering swings spawn a real Matter hitbox via the canonical attemptAttack path; flash a translucent
          // rectangle at the hitbox for ~6 frames whenever a battering item swing JUST entered its active phase.
          for (const slot of this.playerSlots) {
            const active = slot.character.getActiveAttack();
            if (!active || !isBatteringItemMove(active.move.id)) continue;
            if (active.framesElapsed !== active.move.startupFrames) continue;
            const pos = slot.character.getPosition();
            const fx = active.hitboxBody?.position.x ?? pos.x + active.facing * active.move.hitbox.offsetX;
            const fy = active.hitboxBody?.position.y ?? pos.y + active.move.hitbox.offsetY;
            this.simEvents.push({ kind: 'damageFlash', frame, x: fx, y: fy,
              width: active.move.hitbox.width, height: active.move.hitbox.height, color: 0xfff080 });
          }
          // A crossed source callback commits once at the solved actor pose.
          // Pending ownership remains attached before that event; interruption
          // before crossing discards the request without detaching inventory.
          this.commitItemCatches(frame);
          this.commitItemEvents(itemEvents,frame);
          this.commitRecoveryEvents(frame,'afterPhysics');
          this.commitDonkeyKongHeavyItemEvents(donkeykongHeavyItemEvents,frame);
          this.linkArticles.commit(this.linkArticleFighters(),this.linkArticleHost(frame));
          this.linkArticles.step(this.linkArticleHost(frame));
          // Tick thrown items — the item's own flight profile, swept hits, platform landing.
          if (this.thrownItems.length > 0) {
            // Item containers use their bottom as the anchor, including
            // during flight; settling puts that same anchor on the surface.
            const platforms = this.baseStage.bodies.platformBodies;
            const survivors: typeof this.thrownItems = [];
            const originalFlight=new Set(this.thrownItems.map(item=>item.entity));
            for (const t of [...this.thrownItems]) {
              // A caught/retired passive drop no longer owns its free trajectory.
              if(t.entity.isHeld()||t.entity.isBroken()||t.entity.isDespawned())continue;
              const prevX = t.x;
              const prevY = t.y;
              const profile=t.entity.definition.throwProfile;
              t.x += t.vx;
              t.y += t.vy;
              {const velocity=advanceNativeItemVelocity(profile,t);t.vx=velocity.vx;t.vy=velocity.vy;}


              // Sync the entity snapshot position to the in-flight
              // position so the per-tick falling-sim's container-
              // sync block (which reads entity.getPosition()) doesn't
              // contradict the throw arc. Belt-and-braces against
              // the held-position-snap-back bug.
              t.entity.updateFreePosition({ x: t.x, y: t.y });
              // Both solid and pass-through platforms catch a descending
              // item crossing their top from above. The swept crossing check
              // leaves upward flight and items already below a platform free.
              let landedPlatformY: number | null = null;
              let landedPlatformX: number | null = null;
              if (t.vy > 0) {
                for (const p of platforms) {
                  if ((p.label !== PLATFORM_LABELS.solid && p.label !== PLATFORM_LABELS.passThrough)
                    || p.isSensor || p.collisionFilter.mask === 0) continue;
                  const top = p.bounds.min.y;
                  // Cross from above to below the platform top this step.
                  const wasAbove = prevY <= top + 0.5;
                  const nowOverlap = t.y >= top;
                  if (wasAbove && nowOverlap) {
                    const progress = t.y === prevY ? 0 : Math.max(0, Math.min(1, (top - prevY) / (t.y - prevY)));
                    const crossingX = prevX + (t.x - prevX) * progress;
                    if (crossingX < p.bounds.min.x || crossingX > p.bounds.max.x) continue;
                    if (landedPlatformY === null || top < landedPlatformY) {
                      landedPlatformY = top;
                      landedPlatformX = crossingX;
                    }
                  }
                }
              }
              if (landedPlatformY !== null) {
                // Snap onto the platform top so the visual rests on
                // the surface; suppress further travel + impact loop.
                t.y = landedPlatformY;
                t.x = landedPlatformX ?? t.x;
                t.entity.updateFreePosition({ x: t.x, y: t.y });


              }
              let impact = false;
              // One thrown-hit path: the item's throw sphere swept against posed receiving
              // geometry, resolved through resolveCombatHit (shield, intangibility, hitlag,
              // 1v1 rule). Thrown items never stale (SmashWiki Stale Moves).
              const contacts:Array<{kind:'hurtbox';fraction:number;playerIndex:number;damageMultiplier:number}>=[];
              if(!t.passiveDrop){
                const centreOffset=profile.mapBottom*profile.pixelsPerUnit;
                const from={x:prevX,y:prevY-centreOffset},to={x:t.x,y:t.y-centreOffset};
                for(const slot of this.playerSlots){
                  const containerSpec=t.entity.definition.container;
                  const ownerImmune=!containerSpec?.downThrowOwnerImmune||!!t.throwAction?.includes('-down-');
                  if(slot.playerIndex===t.ownerSlotIndex&&!ownerImmune&&!t.ownerCleared){
                    const released=this.sweptHurtboxContact(slot.character,from,from,profile.attackRadius*profile.pixelsPerUnit);
                    if(released)continue;
                    t.ownerCleared=true;
                  }
                  if(slot.playerIndex===t.ownerSlotIndex&&ownerImmune||this.stockTracker.isEliminated(slot.playerIndex))continue;
                  const contact=this.sweptHurtboxContact(slot.character,from,to,profile.attackRadius*profile.pixelsPerUnit);
                  if(contact)contacts.push({kind:'hurtbox',playerIndex:slot.playerIndex,...contact});
                }
              }
              let victim:number|null=null;
              for(const contact of orderProjectileContacts(contacts)){
                const owner=this.playerSlots.find(s=>s.playerIndex===t.ownerSlotIndex);
                const target=this.playerSlots.find(s=>s.playerIndex===contact.playerIndex);
                const containerSpec=t.entity.definition.container;
                if(containerSpec&&containerBreaksOnImpact(containerSpec,'fighter')){
                  const outcome=this.openContainer(t.entity,frame,t.ownerSlotIndex,t.throwAction);
                  impact=true;victim=contact.playerIndex;
                  if(outcome?.kind==='explosion')break;
                }
                const hit=thrownItemHit(t.entity.definition,t.throwAction,t,t.damagePower??1,contact.damageMultiplier,
                  target?.character.isGrounded()??false);
                const result=this.resolveCombatHit(contact.playerIndex,hit,
                  {kind:'attack',projectile:true,ignoreStaleMoves:true,moveId:`item.${t.entity.definition.type}.throw`,attackInstance:t.entity,
                    contactCircleSweepWorld:{from:{x:prevX,y:prevY-profile.mapBottom*profile.pixelsPerUnit},
                      to:{x:prevX+(t.x-prevX)*contact.fraction,y:prevY-profile.mapBottom*profile.pixelsPerUnit+(t.y-prevY)*contact.fraction},radius:profile.attackRadius*profile.pixelsPerUnit},
                    attackerOwnerId:owner?.character.id??'',attackerPlayerIndex:t.ownerSlotIndex,attackerBodyId:owner?.character.body.id});
                if(result?.confirmed){impact=true;victim=contact.playerIndex;break;}
                if(containerSpec)break; // An opened container has one physical impact.
              }
              const blast = this.baseStage.getViewportBlastZone();
              const offStage = t.x < blast.x || t.x > blast.x + blast.width || t.y > blast.y + blast.height;
              const settledOnPlatform = landedPlatformY !== null;
              if(t.entity.isDespawned())continue;
              const containerSpec=t.entity.definition.container;
              if(t.entity.definition.generated?.vanishesOnImpact&&!t.passiveDrop&&(impact||settledOnPlatform)){
                this.removeItem(t.entity,frame);continue;
              }
              if(containerSpec&&settledOnPlatform&&!t.passiveDrop){
                if(containerBreaksOnImpact(containerSpec,'terrain')){
                  this.openContainer(t.entity,frame,t.ownerSlotIndex,t.throwAction);continue;
                }
                t.entity.startContainerRoll(t.vx);
              }
              // A thrown Bob-omb explodes on the player it hits (that hit is its explosion) or on the stage it lands on.
              if(t.entity.definition.bobOmb&&!t.passiveDrop&&(impact||settledOnPlatform)){
                this.explodeItem(t.entity,frame,t.ownerSlotIndex,victim===null?[]:[victim]);continue;
              }
              // A thrown item that hit bounces back by its native rebound and falls without
              // attacking again (SmashWiki is silent on items breaking on hit).
              if(impact&&!settledOnPlatform){
                const rebound=itemThrowReboundVelocity(profile,t);
                t.vx=rebound.vx;t.vy=rebound.vy;t.passiveDrop=true;survivors.push(t);continue;
              }
              // An item in flight leaves play past the blast zone, or flies until it lands. An empty shooting item always
              // disappears on touching the ground (SmashWiki Item#Item_drop_chance); a Banana Peel after its second throw
              // (SmashWiki: "two slips and/or throws").
              if((offStage&&!settledOnPlatform)||(settledOnPlatform&&(t.entity.isEmptyShooter()||t.entity.getDurability()===0||t.entity.definition.hammer?.golden))){
                this.removeItem(t.entity,frame);continue;
              }
              if (impact || settledOnPlatform) {
                // Settle as grounded so it can be picked up again at its rest position.
                t.entity.markGrounded(frame, { x: t.x, y: t.y });


                this.itemSurfaceY.set(t.entity.id, t.y);
                this.itemFallingY.delete(t.entity.id);
              } else {
                survivors.push(t);
              }
            }
            // An explosion during this loop may have removed an item that is still listed.
            this.thrownItems = [...survivors,...this.thrownItems.filter(t=>!originalFlight.has(t.entity))].filter(t=>!t.entity.isDespawned());
          }
          // Bob-omb fuses and walks, items hit by attacks, Banana Peel slips, live explosions.
          this.finalChoreography?.afterPhysics(frame);
          this.advanceFinalFxClock(frame,this.finalSmashController?.getActive()?.owner.playerIndex,finalFxClockAdvances);
          this.linkArticles.stepAncientArrows(this.linkArticleFighters(),this.linkTerrainBoxes(),(run,target,label,damageMultiplier)=>
            this.finalHit(run,'ancient-blast',{target,packetId:0,damageMultiplier},label,'final',true),frame);
          this.tickWorldItems(frame);
          this.tickSmashBall(frame);
          // A detonating down-special trap (bomb / mine) flashes its blast box under its explosion art.
          this.latchTrapExplosions(frame);
          // Tick projectiles — advance position, sync visual, AABB
          // hit-check vs every other slot's body, despawn on hit or
          // lifetime expiry.
          if (this.projectiles.length > 0) {
            const survivors: typeof this.projectiles = [];
            const linkFighters = this.linkArticleFighters(), terrain = this.linkTerrainBoxes();
            for (const p of this.projectiles) {
              const owner = this.playerSlots.find(s => s.playerIndex === p.ownerSlotIndex);
              if (p.boomerang && advanceBoomerang(p, p.boomerang,
                owner && !this.stockTracker.isEliminated(owner.playerIndex) ? owner.character.getPosition() : null)) {
                continue;
              }
              const previous = { x: p.x, y: p.y };
              if (p.link?.kind === 'boomerang') {
                // Link's boomerang flies, turns back and is caught on its own flight (linkArticles.ts).
                const thrower = p.link.state.originalOwnerIndex;
                if (!advanceLinkBoomerang(p, linkFighters.find(f => f.playerIndex === thrower), frame)) { continue; }
              } else {
                if (p.gravity) p.vy += p.gravity;
                brakeLinkProjectile(p);
                p.x += p.vx;
                p.y += p.vy;
              }
              p.framesRemaining -= 1;
              if(p.boomerang)p.display.angle=displayAngleDegrees(p.boomerang.age*24);
              else if(p.link)p.display.angle=displayAngleDegrees(linkProjectileAngle(p));

              // Collect physical sweep contacts before resolving any of
              // them. A farther reflector or earlier roster slot must
              // never preempt a nearer fighter along the flight segment.
              type Contact = { fraction: number; playerIndex: number } & (
                { kind: 'reflector'; damageScale: number; velocityScale: number }
                | {kind:'absorber';window:AttackAbsorbWindow}
                | { kind: 'hurtbox'; damageMultiplier: number }
                | { kind: 'passive-shield'; bodyContactFraction?:number }
                | { kind: 'container'; entity: ItemEntity }
                | { kind: 'final-resource'; resourceId: number }
                | { kind: 'terrain'; surface: LinkTerrainSurface }
              );
              const contacts: Contact[] = [];
              for (const s of this.playerSlots) {
                if (s.playerIndex === p.ownerSlotIndex) continue;
                if (this.stockTracker.isEliminated(s.playerIndex)) continue;
                const absorbed=this.sourceAbsorberContact(s.character,previous,p,{kind:'rectangle',width:p.width,height:p.height},p.absorbable===true);if(absorbed)contacts.push({...absorbed,playerIndex:s.playerIndex});
                const tpos = s.character.getPosition();
                let nearest: Contact | undefined;
                if (!p.boomerang?.hitTargets.has(s.playerIndex) && !linkProjectileSpares(p, s.playerIndex)) {
                  for (const hurtbox of s.character.getActiveHurtboxes()) {
                    if (hurtbox.intangible) continue;
                    const fraction = hurtbox.capsule
                      ? sweptProjectileCapsuleEntry(previous, p, posedCapsule(hurtbox.capsule, tpos, s.character.getFacing()), p)
                      : sweptProjectileEntry(previous, p, {
                        x: tpos.x + hurtbox.offsetX * s.character.getFacing(), y: tpos.y + hurtbox.offsetY,
                        width: hurtbox.width, height: hurtbox.height,
                      }, p);
                    if (fraction !== null && (!nearest || fraction < nearest.fraction)) nearest = {
                      fraction, playerIndex: s.playerIndex, kind: 'hurtbox', damageMultiplier: hurtbox.damageMultiplier ?? 1,
                    };
                  }
                  const bubble=s.character.getSourceShieldBubble();
                  if(bubble&&s.character.getActiveHurtboxes().some(h=>!h.intangible)){const shieldHit=sweepTranslatedSourceShape({from:previous,to:p,
                    shape:{kind:'rectangle',offsetX:0,offsetY:0,width:p.width,height:p.height},
                    target:{kind:'capsule',start:bubble.centre,end:bubble.centre,radius:bubble.radius}});
                    if(shieldHit&&(!nearest||shieldHit.fraction<=nearest.fraction))nearest={kind:'hurtbox',fraction:shieldHit.fraction,playerIndex:s.playerIndex,damageMultiplier:1};}
                  if (nearest) contacts.push(nearest);
                  if(linkPassiveShieldCanIntercept({reflectable:p.reflectable===true,isProjectile:true,unblockable:false},true)){
                    const passive=sweepLinkPassiveShield({surfacesWorld:s.character.getLinkPassiveShieldWorldSurfaces(),
                      from:previous,to:p,projectile:{width:p.width,height:p.height},bodyContactFraction:nearest?.fraction});
                    if(passive)contacts.push({kind:'passive-shield',fraction:passive.fraction,playerIndex:s.playerIndex,bodyContactFraction:nearest?.fraction});
                  }
                }
                const ra = s.character.getActiveAttack();
                const reflector = activeReflector(ra);
                if (!ra || !reflector || p.reflectable===false) continue;
                const rb = reflector.body;
                const fraction = sweptProjectileEntry(previous, p, {
                  x: tpos.x + ra.facing * rb.offsetX, y: tpos.y + rb.offsetY, width: rb.width, height: rb.height,
                }, p);
                if (fraction !== null) contacts.push({ fraction, playerIndex: s.playerIndex, kind: 'reflector',
                  damageScale: reflector.damageScale, velocityScale: reflector.velocityScale });
              }

              for(const entity of this.itemRegistry.getActive()){
                if(!entity.definition.container||entity.isDespawned()||entity.getHolderPlayerIndex()===p.ownerSlotIndex)continue;
                const position=entity.getPosition(),bounds=entity.definition.pickupBounds;
                const target={x:position.x+(bounds?.offsetX??0),y:position.y+(bounds?.offsetY??-20),width:bounds?.width??40,height:bounds?.height??40};
                const fraction=sweptProjectileEntry(previous,p,target,p);
                if(fraction!==null)contacts.push({kind:'container',fraction,playerIndex:-1,entity});
              }
              const ball = this.smashBallRuntime?.getRoaming();
              if (ball) {
                const fraction = sweptProjectileCapsuleEntry(previous, p,
                  { start: ball.position, end: ball.position, radius: this.smashBallRuntime!.policy.radius }, p);
                if (fraction !== null) contacts.push({ kind: 'final-resource', fraction, playerIndex: -1, resourceId: ball.resource.id });
              }
              const ground = linkProjectileTerrainContact(p, previous, terrain);
              if (ground) contacts.push({ kind: 'terrain', fraction: ground.fraction, playerIndex: -1, surface: ground.surface });
              let hit = false;
              for (const contact of orderProjectileContacts(contacts)) {
                if (contact.kind === 'terrain') {
                  // A Link arrow sticks (and becomes a pickup arrow); the boomerang bounces.
                  const at = { x: previous.x + (p.x - previous.x) * contact.fraction, y: previous.y + (p.y - previous.y) * contact.fraction };
                  const outcome = linkProjectileTerrain(p, at, contact.surface);
                  if (outcome.arrowItem) this.spawnLinkArrowItem(outcome.arrowItem.at, outcome.arrowItem.lifetimeFrames, frame);
                  hit = outcome.retire; break;
                }
                if(contact.kind==='absorber'){this.acceptSourceAbsorption(contact.playerIndex,contact.window,p.damage);hit=true;break;}
                if(contact.kind==='passive-shield'){
                  const result=this.resolveCombatHit(contact.playerIndex,{damage:p.damage,knockback:p.knockback,facing:p.facing,
                    hitlagMultiplier:p.hitlagMultiplier,sdiMultiplier:p.sdiMultiplier,reflectable:p.reflectable,
                    absorbable:p.absorbable,direct:false,hitlagProjectile:true},
                    {kind:'attack',projectile:true,moveId:p.moveId,attackInstance:p.attackInstance,
                      ...(p.ignoreStaleMoves?{ignoreStaleMoves:true}:{}),
                      contactSweepWorld:{from:previous,to:{x:p.x,y:p.y},projectile:{width:p.width,height:p.height},bodyContactFraction:contact.bodyContactFraction},
                      attackerOwnerId:owner?.character.id??'',attackerPlayerIndex:p.ownerSlotIndex,attackerBodyId:owner?.character.body.id});
                  if(result?.confirmed){hit=true;break;}continue;
                }
                if (contact.kind === 'final-resource') {
                  this.damageSmashBall(p.ownerSlotIndex, p.damage * (p.ignoreStaleMoves ? 1 : owner?.character.getStaleMultiplier(p.moveId) ?? 1),
                    `ball-${contact.resourceId}-projectile-${p.id}-${p.moveId}`);
                  hit = true; break;
                }

        if(contact.kind==='container'){
                  if(contact.entity.damageContainer(p.damage))this.openContainer(contact.entity,frame,p.ownerSlotIndex);
                  else if(contact.entity.definition.container?.rolling&&contact.entity.getSnapshot().state==='grounded')
                    contact.entity.startContainerRoll(p.facing*contact.entity.definition.container.rolling.maxSpeed);
                  hit=true;break;
                }
                if (contact.kind === 'reflector') {
                  // Transfer ownership so the reflected shot can hit its
                  // original shooter and cannot bounce off this owner again.
                  reflectProjectile(p, contact.playerIndex, contact.damageScale, contact.velocityScale);
                  reflectLinkProjectile(p, contact.playerIndex, contact.damageScale);
                  p.attackInstanceKey+=`/reflect:${frame}:${contact.playerIndex}`;
                  p.attackInstance=this.linkArrowAttackToken(p.attackInstanceKey,p.attackInstance);
                  this.playerSlots.find(sl => sl.playerIndex === contact.playerIndex)?.character.noteProjectileReflected();
                  break;
                }
                const result = this.resolveCombatHit(contact.playerIndex, {
                  damage: p.damage * contact.damageMultiplier,
                  knockback: p.knockback,
                  facing: p.facing,
                  hitlagMultiplier: p.hitlagMultiplier,
                  sdiMultiplier: p.sdiMultiplier,reflectable:p.reflectable,absorbable:p.absorbable,direct:false,
                }, { kind: 'attack', projectile: true, moveId: p.moveId,
                  ...(p.ignoreStaleMoves ? { ignoreStaleMoves: true } : {}),
                  attackInstance: p.attackInstance,
                  contactSweepWorld:{from:previous,to:{x:previous.x+(p.x-previous.x)*contact.fraction,y:previous.y+(p.y-previous.y)*contact.fraction},
                    projectile:{width:p.width,height:p.height}},
                  attackerOwnerId: owner?.character.id ?? '', attackerPlayerIndex: p.ownerSlotIndex,
                  attackerBodyId: owner?.character.body.id });
                if (result?.confirmed) {
                  if (p.boomerang) p.boomerang.hitTargets.add(contact.playerIndex);
                  else if (!linkProjectileHit(p, contact.playerIndex)) { hit = true; break; }
                }
              }
              const blast = this.baseStage.getViewportBlastZone();
              const pastBlastZone = p.x < blast.x || p.x > blast.x + blast.width || p.y < blast.y || p.y > blast.y + blast.height;
              if (hit || p.framesRemaining <= 0 || pastBlastZone || p.x < -200 || p.x > 4200) {
                              } else {
                survivors.push(p);
              }
            }
            this.projectiles = survivors;
          }
          this.linkArticles.syncOwners(this.linkArticleFighters(), this.projectiles);

          // ---- Sub-AC 2 of AC 60202: position-based KO scan -------------
          // Run AFTER the Matter step so the body positions reflect this
          // step's integration. The watcher reads each registered
          // fighter's centre-of-mass, compares it against the configured
          // blast-zone rect, and fires `loseStock` for every fighter that
          // newly crossed an edge. Tunnelling-safe (a body moving past
          // the boundary at >sensor-thickness/step still registers) and
          // deterministic (pure position math, frame-stamped).
          this.blastZonePositionWatcher.update(frame);

          // ---- Sub-AC 3 of AC 303: drive respawns + finalise eliminations
          // Drained AFTER stepping the world so any blast-zone touch from
          // this step is included in `loseStock` calls and queued
          // respawns whose fire-frame just elapsed get re-spawned this
          // very same step (zero perceptual delay at respawnDelay=0).
          //
          // The whole respawn pipeline — teleport (state reset), damage
          // → 0, invincibility window, face inward, spawn-platform
          // overlay creation, and the position-watcher latch reset
          // (registered as a side-effect hook in `create()`) — lives in
          // the dedicated `RespawnHandler` so the logic is testable
          // under plain Node and replayable byte-for-byte.
          const ready = this.stockTracker.consumePendingRespawns(frame);
          this.respawnHandler.applyRespawns(ready, frame);
          // Tick the spawn-platform expiry. Returned list of expired
          // platforms drives the visual cleanup loop in the render hook.
          this.respawnHandler.update(frame);

          // Eliminated slots: unregister from the watcher so a corpse
          // body lingering at the blast-zone edge can't fire phantom
          // stock losses, AND from the damage handler so a stray hitbox
          // overlap on the corpse can't fire a phantom hit. Idempotent
          // — `unregisterPlayer` is a no-op for an already-removed slot.
          for (const slot of this.playerSlots) {
            if (this.stockTracker.isEliminated(slot.playerIndex)) {
              if (this.blastZoneWatcher.isRegistered(slot.playerIndex)) {
                this.blastZoneWatcher.unregisterPlayer(slot.playerIndex);
              }
              // Sub-AC 2 of AC 60202: also drop the corpse from the
              // position-based watcher so its post-elimination drift
              // past a boundary doesn't fire a phantom stock-loss.
              if (this.blastZonePositionWatcher.isRegistered(slot.playerIndex)) {
                this.blastZonePositionWatcher.unregisterPlayer(slot.playerIndex);
              }
              if (this.hitboxDamageHandler.isRegistered(slot.playerIndex)) {
                this.hitboxDamageHandler.unregisterPlayer(slot.playerIndex);
              }
              // AC 20101 Sub-AC 1 — drop the corpse from every
              // stage-owned hazard adapter (lava overlap registry,
              // wind force controller, and any future hazard family
              // a custom-stage trap watcher adds). The stage's
              // `unregisterPlayer` is idempotent and a no-op for
              // hazard-free layouts, so the flat-stage path stays
              // free.
              this.baseStage.unregisterPlayer(slot.playerIndex);
            }
          }
        }
if (!matchOverFrozen) {
          const event = this.matchRules.update(frame);
          if (event?.kind === 'suddenDeath') {
            this.beginSuddenDeath(event.participants);
          } else if (event?.kind === 'finished') {
            this.matchEndDetector.finish(frame, event.winnerIndex, {
              mode: this.activeMatchConfig.mode,
              ...(this.activeMatchConfig.mode === 'time' ? { scores: this.matchRules.getScores(frame) } : {}),
              decidedBySuddenDeath: this.matchRules.isSuddenDeath(),
            });
          }
        }
this.matchEndDetector.update(frame);
if (
          !this.recordingStopped &&
          this.matchEndDetector.isMatchOver()
        ) {
          this.recordingController.stop();
          this.recordingStopped = true;
        }
if(this.matchEndDetector.consumeShouldTransition()){this.result=this.matchEndDetector.getResultPayload();this.isFinished=true;}
}

public physicsEngine!: PhysicsEngine;

public sourceScreenKo=new Map<number,LinkScreenKoPresentationState>();

public matchEndDetector!: MatchEndDetector;

public consumeFinalEvents(events: readonly FinalControllerEvent[], frame: number): void {
    for (const event of events) {
      if (event.kind === 'exit' && event.reason !== 'complete') this.linkArticles.cancelAncientArrow(event.run.id);
      if (event.kind === 'activate') {
        if (event.run.owner.fighter !== 'link') this.slowFinalOpponents(event.run,
          event.run.owner.fighter === 'donkeykong' ? 7 : 9, event.run.owner.fighter === 'donkeykong' ? 30 : 45, frame);
        this.finalCombatReceipts.set(event.run.id, { stale: null, registered: false });
        if (event.run.resource === 'ball') this.smashBallRuntime?.consumeOrRetireStandby(event.run.owner.playerIndex, frame);
      }
    }
    this.finalChoreography?.consume(events, frame);
    for(const event of events)if(event.kind==='exit')this.finalVictimFitDependencies.clear();
    for (const event of events) if (event.kind === 'exit')
      for (const slot of this.playerSlots) slot.character.clearFinalOpponentSlow(event.run.id);
  }

public readonly linkArticles=new LinkArticles();

public slowFinalOpponents(run: FinalRun, divisor: number, duration: number, frame: number): void {
    for (const slot of this.playerSlots) if (slot.playerIndex!==run.owner.playerIndex && !this.stockTracker.isEliminated(slot.playerIndex))
      slot.character.setFinalOpponentSlow(run.id,divisor,duration,frame);
  }

public playerSlots!:Array<{readonly playerIndex:number;readonly character:Character;readonly spawnX:number;readonly spawnY:number;readonly faceOnSpawn:1|-1;readonly bindingsSlot:PlayerBindingsIndex}>;

public stockTracker!: StockTracker;

public finalCombatReceipts = new Map<number, { stale: number | null; registered: boolean }>();

public smashBallRuntime: SmashBallRuntime | null = null;

public finalChoreography: FinalSmashChoreography | null = null;

public readonly finalVictimFitDependencies=new Map<number,string>();
/** Presentation only: exact analytical capsules queried this fixed tick.
 * No clock/window reconstruction, canonical evidence or physics dependency. */
public readonly finalContactDebugCapsules:CollisionCapsule[]=[];
public readonly gazeKnockouts=new Map<number,GazeKnockoutReceipt>();

public finalSmashController: FinalSmashController | null = null;

public recordedInputs: ReadonlyMap<number, ReadonlyArray<CharacterInput>> | null = null;

public cpuControllers = new Map<number, LiveCpuController>();

public buildCpuWorld(): LiveCpuWorld {
    const fighters = this.playerSlots.map((slot): LiveCpuFighter => {
      const fighter = slot.character;
      const active = fighter.getActiveAttack();
      return {
        playerIndex: slot.playerIndex as 0 | 1 | 2 | 3,
        position: { ...fighter.getPosition() }, velocity: { ...fighter.getVelocity() },
        facing: fighter.getFacing(), feetY: fighter.getBodyBottomY(),
        halfWidth: (fighter.getBodyRightX() - fighter.getBodyLeftX()) / 2,
        damagePercent: fighter.getDamagePercent(), stocksRemaining: this.stockTracker.getStocks(slot.playerIndex),
        active: !this.stockTracker.isEliminated(slot.playerIndex) && !this.stockTracker.isRespawning(slot.playerIndex),
        grounded: fighter.isGrounded(), hitstun: fighter.isInHitstun(), hitlag: fighter.isInHitlag(),
        grabbed: fighter.isGrabbed(), holdingGrab: fighter.getGrabState().name === 'holding',
        onLedge: fighter.isHangingOnLedge(), invincible: fighter.isInvincible(),
        canAttack: fighter.canAttack(), jumpsRemaining: fighter.getJumpsRemaining(),
        upSpecialAvailable: !fighter.isHelpless() && fighter.getUpSpecialId() !== null,
        currentMove: active ? { kind: active.move.type, phase: active.phase,
          framesRemaining: Math.max(1, active.move.startupFrames + active.move.activeFrames + active.move.recoveryFrames - active.framesElapsed) } : null,
        stateLabel: fighter.isInHitstun() ? 'hitstun' : fighter.isShielding() ? 'shielding'
          : fighter.isDodging() ? 'dodging' : fighter.isHangingOnLedge() ? 'ledgeHang'
            : active ? active.phase === 'recovery' ? 'recovering' : 'attacking'
              : !fighter.isGrounded() ? 'airborne' : 'idle',
      };
    });
    const zone = this.baseStage.getViewportBlastZone();
    return { fighters,
      platforms: this.baseStage.bodies.platformBodies.filter((body) => body.collisionFilter.mask !== 0).map((body) => ({
        left: body.bounds.min.x, right: body.bounds.max.x, top: body.bounds.min.y,
        passThrough: body.label === 'platform.passThrough',
      })),
      ledges: this.baseStage.getLedgeCandidates(),
      blastZone: { left: zone.x, right: zone.x + zone.width, top: zone.y, bottom: zone.y + zone.height },
    };
  }

public baseStage!: BaseStage;

public retainedBallCpuInput(base:CharacterInput,context:SmashBallSurfaceCpuContext,actor:Character,ballId:number|null){
    const decision=smashBallSurfaceCpuInput(base,context),index=context.actor.playerIndex,a=context.actor;
    const release=(moveX:number):CharacterInput=>({...base,moveX,moveY:0,jump:false,attack:false,attackHeavy:false,special:false,shield:false,
      grab:false,dodge:false,appeal:false,dropThrough:false,attackStickX:0,attackStickY:0,ledgeRelease:null});
    if(!context.eligible||context.activeFinal||context.availableResource!==null||!context.ball?.active||ballId===null||!a.grounded||!a.mayAttack||a.hasHeldItem||
      this.stockTracker.isRespawning(index)||this.stockTracker.isEliminated(index)||context.supportBodyId===null){this.cpuBallGoals.delete(index);return decision;}
    const surface=context.surfaces.find(row=>row.id===context.supportBodyId),body=this.baseStage.bodies.platformBodies.find(row=>row.id===context.supportBodyId);
    const geometryIdentity=surface&&body?JSON.stringify([surface.id,body.area,body.inverseInertia,body.vertices?.length,body.angle,body.label,body.collisionFilter.category,body.collisionFilter.mask,body.collisionFilter.group]):null;
    if(!surface||geometryIdentity===null){this.cpuBallGoals.delete(index);return decision;}
    const hullShapeIdentity=JSON.stringify([actor.body.area,actor.body.inverseInertia,actor.body.vertices?.length,actor.body.angle]);
    let lease=this.cpuBallGoals.get(index);
    if(lease&&(lease.actorGeneration!==a.generation||lease.ballId!==ballId||lease.surfaceId!==surface.id||lease.hullShapeIdentity!==hullShapeIdentity||
      lease.surfaceGeometryIdentity!==geometryIdentity||lease.neutralAttackIdentity!==a.currentNeutralAttackIdentity)){this.cpuBallGoals.delete(index);lease=undefined;}
    if(!lease){
      const toward=(context.ball.position.x<a.position.x?-1:1) as 1|-1;
      if(a.facing!==toward)return{...decision,input:release(toward),strategy:'turn-to-ball'};
      const goal=decision.surfaceGoal;if(!goal)return decision;
      lease={actorGeneration:a.generation,ballId,surfaceId:surface.id,attackFacing:goal.attackFacing,
        neutralAttackIdentity:goal.neutralAttackIdentity,surfaceGeometryIdentity:geometryIdentity,halfWidth:goal.halfWidth,
        hullShapeIdentity,contactGeometryIdentity:'',goalX:goal.x};this.cpuBallGoals.set(index,lease);
    }
    // Hypothetical retained facing supplies only a relocation goal. Actual
    // same-frame contact admission below still uses current actor facing.
    const future=actor.getCpuNeutralAttackContactPreview(context.frame!,lease.attackFacing);
    if(!future||future.provenance.moveIdentity!==lease.neutralAttackIdentity){this.cpuBallGoals.delete(index);return decision;}
    const r=future.range,identity=future.geometryIdentity;
    if(lease.contactGeometryIdentity&&lease.contactGeometryIdentity!==identity){this.cpuBallGoals.delete(index);return decision;}
    lease.contactGeometryIdentity=identity;lease.halfWidth=a.halfWidth;
    const min=surface.minX+a.halfWidth,max=surface.maxX-a.halfWidth;if(min>max){this.cpuBallGoals.delete(index);return decision;}
    lease.goalX=Math.max(min,Math.min(max,context.ball.position.x-(r.minX+r.maxX)/2+a.position.x));
    const stopX=a.position.x+a.velocity.x;
    if(a.velocity.x>0&&stopX>=max||a.velocity.x<0&&stopX<=min)return{...decision,input:release(-Math.sign(a.velocity.x)),strategy:'brake-safe-surface'};
    const dx=lease.goalX-a.position.x,atGoal=Math.abs(dx)<=Math.max(1,Math.abs(a.velocity.x));
    if(!atGoal)return{...decision,input:release(Math.sign(dx)),strategy:'relocate-retained-goal'};
    if(a.facing!==lease.attackFacing)return{...decision,input:release(lease.attackFacing),strategy:'turn-at-retained-goal'};
    if(['initialDash','run','pivot'].includes(actor.getLocomotionState().name))return{...decision,input:release(0),strategy:'settle-neutral-route'};
    // Fresh real-facing policy is the only path permitted to pulse attack.
    if(decision.strategy==='attack-ball'||decision.strategy==='release-attack')return decision;
    return{...decision,input:release(0),strategy:'wait-at-safe-edge'};
  }

public cpuBallGoals=new Map<number,{actorGeneration:number;ballId:number;surfaceId:number;attackFacing:1|-1;neutralAttackIdentity:string;
    surfaceGeometryIdentity:string;halfWidth:number;hullShapeIdentity:string;contactGeometryIdentity:string;goalX:number}>();

public cpuBallAttackHeld=new Map<number,boolean>();

public cpuBallStrategies=new Map<number,{frame:number;strategy:string}>();

public finalSpecialHeld = new Map<number, boolean>();

public cpuFinalStrategies=new Map<number,{frame:number;strategy:FinalCpuDecision['strategy']}>();

public advanceFinalFxClock(frame:number,ownerIndex:number|undefined,clockAdvances:boolean):void {
    const owner=ownerIndex===undefined?null:this.playerSlots.find(slot=>slot.playerIndex===ownerIndex)?.character,
      control=owner?.getFinalSmashControl()??null;
    if(!owner||!control||!isFinalFxFighter(owner.id)){this.finalFxClocks.clear();return;}
    for(const key of this.finalFxClocks.keys())if(key!==ownerIndex)this.finalFxClocks.delete(key);
    const next=stepFinalFxRunClock(this.finalFxClocks.get(ownerIndex!)??null,{frame,ownerIndex:ownerIndex!,
      generation:owner.getPositionResetGeneration(),control,clockAdvances,facts:FINAL_FX_CUES});
    if(next)this.finalFxClocks.set(ownerIndex!,next);else this.finalFxClocks.delete(ownerIndex!);
  }

public finalFxClocks=new Map<number,FinalFxRunClock>();

public prevPlatformTopY: WeakMap<MatterJS.BodyType, number> = new WeakMap();

public ledgeCandidatesByStage: ReadonlyArray<LedgeCandidate> = [];

public ensureInventories(): void {
    for (const slot of this.playerSlots)
      if (!this.inventoriesByPlayerIndex.has(slot.playerIndex))
        this.inventoriesByPlayerIndex.set(slot.playerIndex, new Inventory(slot.character));
  }

/** Inferno's authored flash enters the same accepted stock-loss path as lava. */
public applyGazeHazards(frame:number):void {
  if(!this.baseStage.gazeHazards.length)return;
  const targets=this.playerSlots.map(slot=>{
    const actor=slot.character,receiving=actor.getActiveHurtboxes();
    return {crouching:actor.isCrouching(),intangible:actor.isInvincible()||receiving.length===0||receiving.every(box=>box.intangible===true),
      active:!this.stockTracker.isEliminated(slot.playerIndex)&&!this.stockTracker.isRespawning(slot.playerIndex)};
  });
  for(const hazard of this.baseStage.gazeHazards)
    for(const index of hazard.fightersHitByFlash(targets)){
      const slot=this.playerSlots[index]!,actor=slot.character,before=this.stockTracker.getStocks(slot.playerIndex),root=actor.getSourceRootPosition();
      const event=this.recordStockLossWithStats(slot.playerIndex,frame);
      if(event.stocksRemaining<before)this.gazeKnockouts.set(slot.playerIndex,{playerIndex:slot.playerIndex,
        characterId:actor.id,paletteIndex:this.matchParticipants[index]!.slot.paletteIndex,bornFrame:frame+1,
        sourceRoot:{...root},facing:actor.getFacing(),away:root.x<this.viewport.width/2?-1:1});
    }
}

public inventoriesByPlayerIndex: Map<number, Inventory> = new Map();

public linkArticleFighters():LinkArticleFighter[] {
    return this.playerSlots.map(slot=>({playerIndex:slot.playerIndex,character:slot.character,
      live:!this.stockTracker.isEliminated(slot.playerIndex)&&!this.stockTracker.isRespawning(slot.playerIndex)}));
  }

public projectiles: Array<{
    id: number;
    creatorPlayerIndex:number;creatorGeneration:number;bornFrame:number;attackInstanceKey:string;
    visualRecipe:OrdinaryProjectileVisualRecipe;visualFacing:1|-1;
    ownerSlotIndex: number;
    moveId: string;
    facing: 1 | -1;
    damage: number;
    knockback: HitInfo['knockback'];
    hitlagMultiplier?: number;
    sdiMultiplier?: number;
    reflectable?:boolean;absorbable?:boolean;
    attackInstance: object;
    x: number;
    y: number;
    vx: number;
    vy: number;
    width: number;
    height: number;
    framesRemaining: number;
    display: { angle:number;scaleX:number;scaleY:number;visible:boolean };
    spawnedThisFrameByMove: string;
    boomerang?: BoomerangFlight;
    /** Item shots never enter the stale-moves queue (SmashWiki Stale_Moves, Ultimate: "Items no longer enter the Stale Moves queue"). */
    ignoreStaleMoves?: true;
    /** World px per frame² added to vy before each move (Link's arrows drop). */
    gravity?: number;
    /** Link's own article behaviour (src/match/linkArticles.ts). */
    link?: LinkProjectileMotion;
  }> = [];

public matchRules!: MatchRulesController;

public suppressAttackUntilRelease: Map<number, boolean> = new Map();

public prepareItemInput(slot: {playerIndex:number;character:Character},
    input: CharacterInput, frame: number, entryFacing: 1 | -1) {
    const fighter=slot.character, player=slot.playerIndex;
    const inventory=this.inventoriesByPlayerIndex.get(player)!;
    const held=inventory.getHeldItem();
    this.itemFrozen.set(player,fighter.isInHitlag());
    const previous=this.itemButtons.get(player)??{attack:false,heavy:false,release:false,grab:false,consumedGrab:false};
    const generation=fighter.getPositionResetGeneration();
    const oldRepeat=this.itemRepeat.get(player);
    const repeatState=oldRepeat?.generation===generation?oldRepeat.state:EMPTY_ITEM_REPEAT_RULES;
    const acquisition=this.fighterItemRectangle(fighter,entryFacing);
    const separated=repeatState.unseparatedZDrops.filter(id=>{
      const entity=this.itemRegistry.getActive().find(item=>String(item.id)===id);
      return !entity||!acquisitionRectanglesOverlap(acquisition,itemAcquisitionRectangle(entity));
    });
    const repeat=tickItemRepeatRules(repeatState,{frozen:fighter.isInHitlag(),separatedItemIds:separated});
    this.itemRepeat.set(player,{generation,state:repeat});
    if(!held&&input.grab&&!previous.grab)this.itemCatchEdges.set(player,{frame,facing:entryFacing});
    // Grab or shield+attack releases a held item (universal-rules.json dropToss.inputs).
    const releaseHeld=input.grab===true || (input.attack===true && input.shield===true);
    const consumedGrab=input.grab===true && (previous.consumedGrab || held!==null);
    this.itemButtons.set(player,{attack:input.attack===true,heavy:input.attackHeavy===true,release:releaseHeld,grab:input.grab===true,consumedGrab});
    const flick=advanceItemFlick(this.itemFlicks.get(player)??EMPTY_ITEM_FLICK,
      {moveX:input.moveX,moveY:input.moveY??0,frozen:fighter.isInHitlag()});
    this.itemFlicks.set(player,flick);
    const pending=this.itemPickupRequests.get(player);
    if(pending && (pending.resetGeneration!==generation || !fighter.getItemActionState())) this.itemPickupRequests.delete(player);
    const heavyPending=this.donkeykongHeavyItemRequests.get(player);
    if(heavyPending&&(heavyPending.resetGeneration!==generation||!fighter.getDonkeyKongHeavyItemActionState()))
      this.donkeykongHeavyItemRequests.delete(player);
    if(held?.definition.hammer){
      if(releaseHeld&&!previous.release&&fighter.isTumbling())this.dropHeldItemAfterDamage(slot,
        {entity:held,position:fighter.getHeldItemWorldPosition(),resetGeneration:generation},frame);
      return input;
    }
    if(fighter.getEatingState())return {...input,attack:false,attackHeavy:false,grab:false};
    // Recovery has pickup priority on a fresh neutral attack even while another item is held.
    // Heart can also be acquired in midair with grab; a passive touch never consumes an item.
    const recoveryPress=input.attack===true&&!previous.attack || !fighter.isGrounded()&&input.grab===true&&!previous.grab;
    if(recoveryPress&&!input.shield&&fighter.canUseItemsBeforeInput()&&!this.stockTracker.isEliminated(player)){
      const candidate=nearestAcquirableItem(acquisition,fighter.getPosition(),this.itemRegistry.getActive()
        .filter(item=>!!item.definition.recovery&&(item.isPickable()||item.isCatchable())));
      if(candidate?.definition.recovery&&fighter.beginItemRecovery(candidate.id,candidate.definition.recovery,frame,
        fighter.isGrounded()&&(Math.abs(input.moveX)>.05||Math.abs(fighter.getVelocity().x)>.1),candidate.spawnedAtFrame)){
        if(candidate.definition.recovery.eat)fighter.notifySourceLinkTemporaryFood({entityId:candidate.id,entityGeneration:candidate.spawnedAtFrame,actorGeneration:generation,frame});
        const origin=fighter.getHeldItemWorldPosition();candidate.markHeld(frame,player,origin);
        // Immediate acquisition budgets retain their old input-top cadence:
        // authoritative consumption happens before this actor applyInput.
        if(!candidate.definition.recovery.eat)this.commitRecoveryEvents(frame,'beforeInput',player);
        this.thrownItems=this.thrownItems.filter(t=>t.entity!==candidate);
        this.itemSurfaceY.delete(candidate.id);this.itemFallingY.delete(candidate.id);
        this.suppressAttackUntilRelease.set(player,true);
        return {...input,attack:false,attackHeavy:false,grab:false};
      }
    }
    if(held?.definition.heavy){
      fighter.syncDonkeyKongHeavyItem(true);
      if(fighterHeavyItemProfile(fighter.id).carry.groundOnly&&!fighter.isGrounded()){
        this.dropHeldItemAfterDamage({playerIndex:player,character:fighter},{entity:held,position:fighter.getHeldItemWorldPosition(),resetGeneration:generation},frame);
        return {...input,attack:false,attackHeavy:false,grab:false};
      }
      const heavyRelease=input.attack===true||input.attackHeavy===true||input.grab===true;
      const heavyEdge=input.attack===true&&!previous.attack||input.attackHeavy===true&&!previous.heavy||input.grab===true&&!previous.grab;
      if(heavyEdge&&!fighter.getDonkeyKongHeavyItemActionState()){
        // Heavy items: four directions and smash, no drop (dropToss.heavyThrows); neutral throws forward.
        const resolved=resolveItemThrowDirection(input.moveX,input.moveY??0,entryFacing);
        const direction=resolved==='drop'?'forward':resolved;
        const strength=input.attackHeavy===true&&!previous.heavy?'strong':resolved==='drop'?'ordinary':itemFlickStrength(flick,!fighter.isGrounded(),direction,entryFacing);
        const action:DonkeyKongHeavyItemAction=`throw-${direction}-${strength}`;
        if(fighter.beginDonkeyKongHeavyItemAction(action,frame,entryFacing))
          this.donkeykongHeavyItemRequests.set(player,{entity:held,action,resetGeneration:generation});
      }
      return {...input,grab:false,attackHeavy:false,...(heavyRelease?{attack:false}: {})};
    }
    fighter.syncDonkeyKongHeavyItem(false);
    if(held){
      // A throwing item is thrown by the attack (or smash) button; grab releases any item (selectHeldItemPress).
      const throwing=held.definition.itemClass==='throwing';
      const action=fighter.getItemActionState()?null:selectHeldItemPress({releasePress:releaseHeld&&!previous.release,
        attackPress:input.attack===true&&!previous.attack,smashPress:input.attackHeavy===true&&!previous.heavy,
        itemClass:held.definition.itemClass,airborne:!fighter.isGrounded(),
        dashing:['initialDash','run'].includes(fighter.getLocomotionStateName()),
        moveX:input.moveX,moveY:input.moveY??0,entryFacing,flick});
      if(action&&(!action.startsWith('throw-air-')||canRepeatAerialItemThrow(repeat)))fighter.beginItemAction(action,frame,entryFacing);
      // A carried grab edge belongs to the item, even if its request is
      // ineligible. The same press must not create a fighter grab.
      return {...input,grab:false,...(throwing?{attack:false,attackHeavy:false}:releaseHeld?{attack:false}: {})};
    }
    if(consumedGrab)input={...input,grab:false};
    // Air catch windows are sampled after the action and solved pose advance;
    // they preserve that aerial/dodge body and never start ground pickup.
    if(!fighter.isGrounded())return {...input,grab:false};
    if(input.attack && !previous.attack && !(this.suppressAttackUntilRelease.get(player)??false) && !fighter.getItemActionState() &&
      fighter.canUseItemsBeforeInput() && !this.stockTracker.isEliminated(player)){
      const reserved=new Set([...this.itemPickupRequests.values(),...this.donkeykongHeavyItemRequests.values()].map(r=>r.entity));
      const candidate=nearestAcquirableItem(acquisition,fighter.getPosition(),this.itemRegistry.getGrounded()
        .filter(item=>item.isPickable()&&!reserved.has(item)&&item.definition.holdable!==false));
      // Heavy acquisition has its own fighter-specific source callback.
      if(candidate?.definition.heavy){
        if(fighter.beginDonkeyKongHeavyItemAction('pickup',frame,entryFacing)){
          this.donkeykongHeavyItemRequests.set(player,{entity:candidate,action:'pickup',resetGeneration:generation});
          fighter.notifySourceLinkItemActionIdentity({entityId:candidate.id,entityGeneration:candidate.spawnedAtFrame,actorGeneration:generation,frame});
          this.suppressAttackUntilRelease.set(player,true);
          return {...input,attack:false};
        }
        return input;
      }
      if(candidate&&!candidate.definition.heavy){
        const action=selectGroundPickup({moveX:input.moveX,locomotion:fighter.getLocomotionStateName()});
        if(action&&fighter.beginItemAction(action,frame,entryFacing)){
          this.itemPickupRequests.set(player,{entity:candidate,action,resetGeneration:generation});
          fighter.notifySourceLinkLightPickup({entityId:candidate.id,entityGeneration:candidate.spawnedAtFrame,actorGeneration:generation,frame});
          this.suppressAttackUntilRelease.set(player,true);
          return {...input,attack:false};
        }
      }
    }
    return input;
  }

public readonly itemFrozen = new Map<number,boolean>();

public readonly itemButtons = new Map<number, { attack: boolean; heavy: boolean; release: boolean; grab:boolean; consumedGrab: boolean }>();

public readonly itemRepeat = new Map<number,{generation:number;state:ItemRepeatRules}>();

public fighterItemRectangle(fighter:Character,facing:1|-1,airborne=!fighter.isGrounded()){
    return fighterAcquisitionRectangle(fighterItemProfile(fighter.id),fighter.getPosition(),facing,airborne,fighter.getTuning().height/2);
  }

public itemRegistry: ItemRegistry = new ItemRegistry();

public readonly itemCatchEdges = new Map<number,{frame:number;facing:1|-1}>();

public readonly itemFlicks = new Map<number, ItemFlickState>();

public readonly itemPickupRequests = new Map<number, {
    entity: ItemEntity; action: ItemAction; resetGeneration: number;
  }>();

public readonly donkeykongHeavyItemRequests=new Map<number,{entity:ItemEntity;action:DonkeyKongHeavyItemAction;resetGeneration:number}>();

public dropHeldItemAfterDamage(slot:{playerIndex:number;character:Character},
    before:{entity:ItemEntity;position:{x:number;y:number};resetGeneration:number},frame:number):void {
    const inventory=this.inventoriesByPlayerIndex.get(slot.playerIndex);
    if(!inventory||inventory.getHeldItem()!==before.entity||
      before.resetGeneration!==slot.character.getPositionResetGeneration()||
      this.stockTracker.isEliminated(slot.playerIndex))return;
    const entity=inventory.drop(frame,before.position,'damage');
    if(!entity)return;
    this.donkeykongHeavyItemRequests.delete(slot.playerIndex);
    this.itemPickupRequests.delete(slot.playerIndex);
    slot.character.interruptHeavyItemCarry();
    this.itemSurfaceY.delete(entity.id);this.itemFallingY.delete(entity.id);
    entity.markFalling(frame,before.position);
    this.thrownItems.push({entity,ownerSlotIndex:slot.playerIndex,x:before.position.x,y:before.position.y,
      vx:0,vy:0,passiveDrop:true});
  }

public readonly itemSurfaceY: Map<number, number> = new Map();

public readonly itemFallingY: Map<number, number> = new Map();

public thrownItems: Array<{
    entity: ItemEntity;
    ownerSlotIndex: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    damagePower?: number;
    /** The planner throw that released it (per-throw thrown-hit rules, ItemDefinition.thrownHit). */
    throwAction?: ItemAction;
    /** Capsule may hit its user after it has first cleared the release body. */
    ownerCleared?: boolean;
    /** Source drop_item has no observed Throw attack dispatch. Passive status
     * remains an explicit adapter until native item dispatch is recovered. */
    passiveDrop?: true;

  }> = [];

public commitRecoveryEvents(frame:number,timing:'beforeInput'|'beforePhysics'|'afterPhysics',onlyPlayer?:number):void {
    for(const slot of this.playerSlots){
      if(onlyPlayer!==undefined&&slot.playerIndex!==onlyPlayer)continue;
      this.pendingRecoveryEvents.push(...slot.character.drainRecoveryEvents().map(event=>({playerIndex:slot.playerIndex,event})));
    }
    const pending:typeof this.pendingRecoveryEvents=[];
    for(const receipt of this.pendingRecoveryEvents){const {playerIndex,event}=receipt;
      if(onlyPlayer!==undefined&&playerIndex!==onlyPlayer||timing==='afterPhysics'&&event.kind==='consume'||
        timing!=='afterPhysics'&&event.kind!=='consume'){pending.push(receipt);continue;}
      const slot=this.playerSlots.find(row=>row.playerIndex===playerIndex),entity=this.itemRegistry.findById(event.itemId);
      if(!slot)continue;
      const accepted=entity&&recoveryTransactionAccepted(event,{playerIndex,actorGeneration:slot.character.getPositionResetGeneration(),
        itemId:entity.id,entityGeneration:entity.spawnedAtFrame,heldByPlayer:entity.getHolderPlayerIndex(),despawned:entity.isDespawned(),recovery:entity.definition.recovery});
      if(!accepted){
        slot.character.notifyItemRecoveryTransactionRejected(event.itemId,event.entryFrame,event);
        // Discard only the exact still-owned temporary recovery entity. A
        // replacement, stolen object or ordinary equipped item stays intact.
        if(entity&&!entity.isDespawned()&&entity.spawnedAtFrame===event.entityGeneration&&
          event.actorGeneration===slot.character.getPositionResetGeneration()&&entity.getHolderPlayerIndex()===playerIndex&&
          this.inventoriesByPlayerIndex.get(playerIndex)?.getHeldItem()!==entity)this.removeItem(entity,frame);
        continue;
      }
      if(event.kind==='consume'){slot.character.applyValidatedItemRecovery(event.spec,event);this.removeItem(entity!,frame);continue;}
      if(event.kind==='discard'){this.removeItem(entity!,frame);continue;}
        const owned=entity!,origin=slot.character.getHeldItemWorldPosition();
        owned.markDropped(frame,origin);owned.markFalling(frame,origin);
        this.itemSurfaceY.delete(owned.id);this.itemFallingY.delete(owned.id);
        this.thrownItems.push({entity:owned,ownerSlotIndex:slot.playerIndex,x:origin.x,y:origin.y,vx:0,vy:0,passiveDrop:true});
    }
    this.pendingRecoveryEvents=pending;
  }

public pendingRecoveryEvents:Array<{playerIndex:number;event:RecoveryTransactionEvent}>=[];

public removeItem(entity: ItemEntity, frame: number): void {
    for (const [player,inventory] of this.inventoriesByPlayerIndex) if (inventory.getHeldItem() === entity) {
      inventory.detachWithoutDrop();
      this.playerSlots.find(slot=>slot.playerIndex===player)?.character.interruptHeavyItemCarry();
      this.donkeykongHeavyItemRequests.delete(player);this.itemPickupRequests.delete(player);
    }
    this.containerStrikeFrames.delete(entity.id);
    entity.markDespawned(frame);

    this.itemSurfaceY.delete(entity.id);
    this.itemFallingY.delete(entity.id);
    this.thrownItems = this.thrownItems.filter(t => t.entity !== entity);
  }

public readonly containerStrikeFrames = new Map<number,Map<string,number>>();

public inputCaptureBuffer!: InputCaptureBuffer;

public prevLedgeKeys = new Map<number, string | null>();


public coordinatingPhysicsStep = false;

public physicsWorld!: PhysicsWorld;

public hitboxDamageHandler!: HitboxDamageHandler;

public blastZonePositionWatcher!: BlastZonePositionWatcher;

public updateFighterSeparation(): void {
    const fighters: Character[] = [this.p1, this.p2, ...this.extraFighters].filter(
      (f): f is Character => f !== null && f !== undefined,
    );
    if (fighters.length < 2) return;

    // Speed (px/step) applied per px of overlap, capped so shallow grazes
    // get a gentle nudge while deep interpenetrations resolve quickly.
    const PUSH_PER_PX = 0.22;
    const MAX_PUSH = 3.5;

    for (let i = 0; i < fighters.length; i++) {
      for (let j = i + 1; j < fighters.length; j++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const a = fighters[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const b = fighters[j]!;

        const snap = a.getAnimationSnapshot();
        const snapB = b.getAnimationSnapshot();
        if (
          snap.hitstunRemaining > 0 || snapB.hitstunRemaining > 0 ||
          snap.hitlagRemaining > 0 || snapB.hitlagRemaining > 0 ||
          snap.destroyed || snapB.destroyed ||
          a.isGrabbed() || b.isGrabbed() ||
          a.getFinalSmashControl()?.jostle === false || b.getFinalSmashControl()?.jostle === false ||
          a.isPikachuSpecialJostleDisabled() || b.isPikachuSpecialJostleDisabled() ||
          a.isSourceIntrinsicJostleDisabled() || b.isSourceIntrinsicJostleDisabled()
        ) continue;

        const ba = a.body.bounds;
        const bb = b.body.bounds;

        // AABB overlap on both axes is required for a real intersection.
        const xOverlap = Math.min(ba.max.x, bb.max.x) - Math.max(ba.min.x, bb.min.x);
        if (xOverlap <= 0) continue;
        const yOverlap = Math.min(ba.max.y, bb.max.y) - Math.max(ba.min.y, bb.min.y);
        if (yOverlap <= 0) continue;

        const posA = a.getPosition();
        const posB = b.getPosition();

        // Fighter jostling separates horizontally. Vertical separation added
        // a fresh upward impulse on every step that fighters remained stacked,
        // overcoming gravity and feeding the reference launch integrator.
        const push = Math.min(xOverlap * PUSH_PER_PX, MAX_PUSH);
        const dir = posA.x < posB.x ? -1 : 1;
        const va = a.getVelocity();
        const vb = b.getVelocity();
        this.physicsWorld.body.setVelocity(a.body, { x: va.x + dir * push, y: va.y });
        this.physicsWorld.body.setVelocity(b.body, { x: vb.x - dir * push, y: vb.y });
      }
    }
  }

public p1!: Character;

public p2!: Character;

public extraFighters: Character[] = [];

public matchRng!: MatchRng;

public itemSpawnManager: ItemSpawnManager | null = null;

public activeMatchConfig!: MatchConfig;

public itemSpawnEventLog: ItemSpawnEventLog = new ItemSpawnEventLog();

public projectileSpawnLatch: Set<string> = new Set();

public addProjectile(row:Omit<MatchSim['projectiles'][number],'id'|'creatorPlayerIndex'|'creatorGeneration'|'bornFrame'|
    'attackInstanceKey'|'attackInstance'|'display'|'spawnedThisFrameByMove'>,frame:number,
    creatorGeneration=this.playerSlots.find(slot=>slot.playerIndex===row.ownerSlotIndex)!.character.getPositionResetGeneration()):void {
    const id=this.nextProjectileId++,attackInstanceKey=`ordinary:${row.ownerSlotIndex}:${creatorGeneration}:${frame}:${id}`;
    const display={angle:row.link?displayAngleDegrees(linkProjectileAngle(row)):0,scaleX:1,scaleY:1,visible:true};
    this.projectiles.push({...row,id,creatorPlayerIndex:row.ownerSlotIndex,creatorGeneration,bornFrame:frame,attackInstanceKey,
      attackInstance:this.linkArrowAttackToken(attackInstanceKey),display,spawnedThisFrameByMove:row.moveId});
  }

public nextProjectileId = 0;

public linkArrowAttackToken(key:string,parentToken?:object):object {
    let token=this.linkArrowVolleyTokens.get(key);
    if(!token){token=parentToken??{};this.linkArrowVolleyTokens.set(key,token);}
    let receipt=this.linkArrowCombatReceipts.get(key);
    if(!receipt){receipt={stale:null,registered:false};this.linkArrowCombatReceipts.set(key,receipt);}
    this.linkArrowAttackReceipts.set(token,receipt);return token;
  }

public linkArrowVolleyTokens=new Map<string,object>();

public linkArrowCombatReceipts=new Map<string,{stale:number|null;registered:boolean}>();

public linkArrowAttackReceipts=new WeakMap<object,{stale:number|null;registered:boolean}>();

public spawnItemShot(ownerSlotIndex: number, event: { shot: ItemShot; x: number; y: number; facing: 1 | -1 }): void {
    const { shot, facing } = event;
    this.addProjectile({visualRecipe:{kind:'item-shot',visual:shot.visual},visualFacing:facing,
      ownerSlotIndex, moveId: shot.id, facing, damage: shot.damage, knockback: shot.knockback,
      x: event.x, y: event.y, vx: facing * shot.speed, vy: 0, width: shot.width, height: shot.height,
      framesRemaining: shot.lifetimeFrames, ignoreStaleMoves: true,
      reflectable:shot.reflectable,absorbable:shot.absorbable,
    },this.physicsEngine.getFrame());
  }

public readonly simEvents = new SimEventQueue();

public commitItemCatches(frame:number):void {
    for(const slot of [...this.playerSlots].sort((a,b)=>a.playerIndex-b.playerIndex)){
      const fighter=slot.character,player=slot.playerIndex;
      if(this.stockTracker.isEliminated(player)||this.itemFrozen.get(player))continue;
      const inventory=this.inventoriesByPlayerIndex.get(player)!;
      if(inventory.isHolding())continue;
      const context=fighter.getItemCatchContext();
      if(!context)continue;
      const edge=this.itemCatchEdges.get(player);
      if(context.context==='air-stationary'&&edge?.frame!==frame)continue;
      const facing=edge?.frame===frame?edge.facing:fighter.getActiveAttack()?.facing??fighter.getFacing();
      const rectangle=this.fighterItemRectangle(fighter,facing);
      const repeat=this.itemRepeat.get(player)?.state??EMPTY_ITEM_REPEAT_RULES;
      const reservations=new Set([...this.itemPickupRequests.values(),...this.donkeykongHeavyItemRequests.values()].map(r=>r.entity));
      const candidate=nearestAcquirableItem(rectangle,fighter.getPosition(),this.itemRegistry.getActive().filter(item=>
        item.isCatchable()&&!reservations.has(item)&&canRecatchItem(repeat,String(item.id))&&
        canCatchItem({context:context.context,age:context.age,airborne:!fighter.isGrounded(),holdingItem:false,
          holdable:item.definition.holdable!==false,heavy:item.definition.heavy,externallyBlocked:context.externallyBlocked,
          pickupRectanglesOverlap:true})));
      // Ground heavy acquisition requires its distinct pickup status/event.
      // It must never attach through a light attack catch callback.
      if(!candidate||candidate.definition.heavy)continue;
      const origin=fighter.getHeldItemWorldPosition();
      if(!inventory.pickup(candidate,frame,player,origin,'catch'))continue;
      this.thrownItems=this.thrownItems.filter(t=>t.entity!==candidate);
      this.itemSurfaceY.delete(candidate.id);this.itemFallingY.delete(candidate.id);
    }
  }

public commitItemEvents(receipts: readonly {
    playerIndex:number;event:ReturnType<Character['drainItemActionEvents']>[number];
  }[], frame:number) {
    for(const {playerIndex,event} of receipts){
      if(event.kind==='reverse-facing')continue;
      const slot=this.playerSlots.find(s=>s.playerIndex===playerIndex);
      const inventory=this.inventoriesByPlayerIndex.get(playerIndex);
      if(!slot || !inventory || this.stockTracker.isEliminated(playerIndex))continue;
      if(event.kind==='pickup'){
        const request=this.itemPickupRequests.get(playerIndex);
        if(!request||request.action!==event.action)continue;
        this.itemPickupRequests.delete(playerIndex);
        if(request.resetGeneration!==slot.character.getPositionResetGeneration()){
          slot.character.notifySourceLinkLightPickupResult(request.entity.id,request.entity.spawnedAtFrame,false);continue;}
        const rectangle=this.fighterItemRectangle(slot.character,event.entryFacing,false);
        let acquired=false;
        if(!inventory.isHolding() && request.entity.isPickable() &&
          acquisitionRectanglesOverlap(rectangle,itemAcquisitionRectangle(request.entity))){
          const origin=slot.character.getHeldItemWorldPosition();
          acquired=inventory.pickup(request.entity,frame,playerIndex,origin);

        }
        slot.character.notifySourceLinkLightPickupResult(request.entity.id,request.entity.spawnedAtFrame,acquired);
        continue;
      }
      const held=inventory.getHeldItem();
      if(!held||held.definition.heavy)continue;
      // A grounded thrower never releases the item below the floor it stands on (a low hand, e.g. Pikachu's down throw).
      const hand=slot.character.getHeldItemWorldPosition();
      const feet=slot.character.getPosition().y+slot.character.getTuning().height/2;
      const origin=slot.character.isGrounded()?{x:hand.x,y:Math.min(hand.y,feet)}:hand;
      const profile=fighterItemProfile(slot.character.id);
      const basis=itemReleaseVelocity(event.plan,event.entryFacing,profile);
      const velocity=held.definition.generated?.kind==='link-remote-bomb'?linkRemoteBombReleaseVelocity(basis):nativeItemReleaseVelocity(held.definition.throwProfile,basis);
      const entity=inventory.detachWithoutDrop();
      if(!entity)continue;
      if(event.action==='air-z-drop'){
        const repeat=this.itemRepeat.get(playerIndex);
        if(repeat)this.itemRepeat.set(playerIndex,{...repeat,state:noteItemZDrop(repeat.state,String(entity.id))});
      }
      // In flight the item is a free falling object: catchable, not ground-pickable, until it lands.
      entity.markDropped(frame,origin);entity.markFalling(frame,origin);
      const arrowPassiveDrop=entity.definition.generated?.kind==='link-arrow'&&
        (event.action==='ground-drop'||event.action==='air-z-drop');
      if(event.action!=='ground-drop'&&event.action!=='air-z-drop')entity.beginGeneratedArrowThrowLifetime(frame);
      this.itemSurfaceY.delete(entity.id);this.itemFallingY.delete(entity.id);
      // A throw wears a Banana Peel (two slips and / or throws).
      entity.wearOut();
      this.thrownItems.push({entity,ownerSlotIndex:playerIndex,x:origin.x,y:origin.y,
        vx:velocity.x,vy:velocity.y,damagePower:velocity.power,throwAction:event.action,
        ...(arrowPassiveDrop?{passiveDrop:true as const}:{})});
    }
  }

public commitDonkeyKongHeavyItemEvents(receipts:readonly {
    playerIndex:number;event:ReturnType<Character['drainDonkeyKongHeavyItemActionEvents']>[number];
  }[],frame:number):void {
    for(const {playerIndex,event} of receipts){
      if(event.kind==='reverse-facing')continue;
      const request=this.donkeykongHeavyItemRequests.get(playerIndex);
      const slot=this.playerSlots.find(s=>s.playerIndex===playerIndex),inventory=this.inventoriesByPlayerIndex.get(playerIndex);
      if(!request||!slot||!inventory||request.action!==event.plan.action)continue;
      this.donkeykongHeavyItemRequests.delete(playerIndex);
      if(request.resetGeneration!==slot.character.getPositionResetGeneration()||this.stockTracker.isEliminated(playerIndex))continue;
      if(event.kind==='pickup'){
        const rectangle=this.fighterItemRectangle(slot.character,event.entryFacing,false);
        if(!inventory.isHolding()&&request.entity.isPickable()&&request.entity.definition.heavy&&
          acquisitionRectanglesOverlap(rectangle,itemAcquisitionRectangle(request.entity))){
          const origin=slot.character.getHeldItemWorldPosition();
          if(inventory.pickup(request.entity,frame,playerIndex,origin)){
            slot.character.syncDonkeyKongHeavyItem(true);
            
          }
        }
        continue;
      }
      if(inventory.getHeldItem()!==request.entity)continue;
      const p=slot.character.getPosition(),offset=event.plan.sourceOffset;
      const offsetFacing=event.plan.sourceReverseBeforeReleaseFrame!==undefined?event.facing:event.entryFacing;
      const origin=offset?{x:p.x+offset.x*offsetFacing*5,
        y:p.y+slot.character.getTuning().height/2-offset.y*5}:slot.character.getHeldItemWorldPosition();
      const velocity=nativeItemReleaseVelocity(request.entity.definition.throwProfile,donkeyKongHeavyReleaseVelocity(event.plan,event.entryFacing,slot.character.id));
      const entity=inventory.detachWithoutDrop();if(!entity)continue;
      entity.markDropped(frame,origin);entity.markFalling(frame,origin);slot.character.syncDonkeyKongHeavyItem(false);
      this.itemSurfaceY.delete(entity.id);this.itemFallingY.delete(entity.id);
      this.thrownItems.push({entity,ownerSlotIndex:playerIndex,x:origin.x,y:origin.y,vx:velocity.x,vy:velocity.y,
        damagePower:velocity.power});
    }
  }

public linkArticleHost(frame:number):LinkArticleHost {
    return {
      spawnProjectile:spawn=>this.addProjectile({...spawn,visualRecipe:{kind:spawn.visual},
        // The arrow drawing points along +x and turns with its flight.
        visualFacing:spawn.visual==='link-arrow'?1:spawn.facing},frame),
      spawnBomb:(owner,centre)=>{
        const inventory=this.inventoriesByPlayerIndex.get(owner);if(!inventory||inventory.isHolding())return null;
        const entity=this.spawnLinkArticleItem(LINK_REMOTE_BOMB_ITEM_DEFINITION,centre,frame);
        if(inventory.pickup(entity,frame,owner,entity.getPosition()))return entity.id;
        this.removeItem(entity,frame);return null;
      },
      bombHolder:id=>{const entity=this.itemRegistry.findById(id);return!entity||entity.isDespawned()?undefined:entity.getHolderPlayerIndex();},
      explodeBomb:(id,owner)=>{const entity=this.itemRegistry.findById(id);if(entity)this.explodeItem(entity,frame,owner);},
      removeHeldItem:owner=>{const held=this.inventoriesByPlayerIndex.get(owner)?.getHeldItem();if(held)this.removeItem(held,frame);},
    };
  }

public spawnLinkArticleItem(definition:ItemDefinition,centre:{x:number;y:number},frame:number):ItemEntity {
    const profile=definition.throwProfile,bottom={x:centre.x,y:centre.y+profile.mapBottom*profile.pixelsPerUnit};
    const entity=this.itemRegistry.spawn(definition,bottom,frame,ItemEntity);
    entity.markGrounded(frame,bottom);
    return entity;
  }

public explodeItem(entity: ItemEntity, frame: number, owner: number | null, spared: readonly number[] = []): void {
    const spec = entity.definition.bobOmb?.explosion ?? entity.definition.explosion;
    if (!spec || entity.isDespawned()) return;
    const p = entity.getPosition(), x = p.x, y = entity.isHeld() ? p.y : p.y - spec.centreAboveRoot;
    this.removeItem(entity, frame);
    this.simEvents.push({kind:'explosion',frame,x,y,radius:spec.radius});
    this.itemExplosions.push({ x, y, spec, owner, framesLeft: spec.activeFrames, done: new Set(spared),
      moveId: `item.${entity.definition.type}.explosion`, ...(spec.hitsOwner ? { ownerImmune: false } : {}) });
  }

public itemExplosions: Array<{
    x: number;
    y: number;
    spec: ItemExplosionSpec;
    owner: number | null;
    framesLeft: number;
    done: Set<number>;

    ownerImmune?: boolean;
    moveId?: string;
  }> = [];

public sweptHurtboxContact(fighter: Character, from: { x: number; y: number }, to: { x: number; y: number },
    radius: number,unblockable=false): { fraction: number; damageMultiplier: number } | null {
    let nearest = sweptHurtboxEntry(fighter.getActiveHurtboxes(), fighter.getPosition(), fighter.getFacing(), from, to, radius);
    const bubble=unblockable?null:fighter.getSourceShieldBubble();
    if(bubble&&fighter.getActiveHurtboxes().some(h=>!h.intangible)){
      const contact=sweepTranslatedSourceShape({from,to,shape:{kind:'capsule',start:{x:0,y:0},end:{x:0,y:0},radius},
        target:{kind:'capsule',start:bubble.centre,end:bubble.centre,radius:bubble.radius}});
      if(contact&&(!nearest||contact.fraction<=nearest.fraction))nearest={fraction:contact.fraction,damageMultiplier:1};
    }
    return nearest;
  }

public openContainer(entity:ItemEntity,frame:number,owner:number|null,throwAction?:ItemAction):ContainerBreakOutcome|null {
    const spec=entity.definition.container,state=entity.getContainerState();
    if(!spec||!state||state.resolved||entity.isDespawned())return null;
    const rng=this.matchRng.stream(ITEM_CONTAINER_RNG_STREAM);
    const explosionRoll=rng.next(),countRoll=rng.next();
    const eligible=eligibleContainerContents(spec,enabledSpawnItems(this.activeMatchConfig.itemSwitch));
    let content=pickSpawnItem(rng,eligible);
    if(content?.type==='food')content=foodDefinition(FOOD_VARIANTS[rng.range(0,FOOD_VARIANTS.length-1)]!);
    const p=entity.getPosition();
    const outcome=entity.resolveContainerBreak(frame,p,{explosionRoll,countRoll,contentsType:content?.type??null,throwAction});
    if(!outcome)return null;
    this.removeItem(entity,frame);
    if(outcome.kind==='explosion'){
      // Containers retain their rendered bottom root even while held.
      const blast=outcome.explosion,x=p.x,y=p.y-blast.centreAboveRoot;
      this.simEvents.push({kind:'explosion',frame,x,y,radius:blast.radius});
      this.itemExplosions.push({x,y,spec:blast,owner,ownerImmune:!!spec.downThrowOwnerImmune&&!!throwAction?.includes('-down-'),
        moveId:`item.${entity.definition.type}.explosion`,framesLeft:blast.activeFrames,done:new Set()});
    }else if(content){
      for(let index=0;index<outcome.count;index++){
        // Authored gentle separation prevents identical contents becoming one
        // opaque sprite; no additional loot or physics RNG is consumed.
        const position={x:p.x+(index-(outcome.count-1)/2)*12,y:p.y-20};
        const spawned=this.itemRegistry.spawn(content,position,frame,ItemEntity);
        this.thrownItems.push({entity:spawned,ownerSlotIndex:-1,x:position.x,y:position.y,vx:0,vy:0,passiveDrop:true});
      }
    }
    return outcome;
  }

public resolveCombatHit!: ConstructorParameters<typeof HitboxDamageHandler>[0];

public linkTerrainBoxes():LinkTerrainBox[] {
    return this.baseStage.bodies.platformBodies.filter(body=>!body.isSensor&&body.collisionFilter.mask!==0&&
      (body.label===PLATFORM_LABELS.solid||body.label===PLATFORM_LABELS.passThrough))
      .map(body=>({solid:body.label===PLATFORM_LABELS.solid,min:{...body.bounds.min},max:{...body.bounds.max}}));
  }

public finalHit(run: FinalRun, _strike: string, contact: FinalContact, label: string, sheet?: string,
    detached = false): boolean {
    const owner = this.playerSlots.find(s => s.playerIndex === run.owner.playerIndex)?.character;
    if (!owner || owner.getPositionResetGeneration() !== run.owner.generation) return false;
    const packet = finalPacketBinding(owner.id, sheet ?? owner.getFinalSmashControl()?.sheet ?? '', label, contact.packetId);
    if (!packet) return false;
    const target = this.playerSlots.find(s => s.playerIndex === contact.target)?.character;
    const facing = packet.native.directionCheck.endsWith('_POS') && target
      ? (target.getPosition().x >= owner.getPosition().x ? 1 : -1) : owner.getFacing();
    const result = this.resolveCombatHit(contact.target, finalRunPacketHit(packet, run, facing, contact.damageMultiplier), { kind: 'attack', moveId: `${owner.id}.final`, staleMoveId: `${owner.id}.final`,
      attackerOwnerId: owner.id, attackerPlayerIndex: run.owner.playerIndex, attackerBodyId: owner.body.id,
      projectile: detached, collisionHitId: contact.packetId,...(contact.contactCapsuleWorld?{contactCapsuleWorld:contact.contactCapsuleWorld}:{}) });
    if(result?.reactionApplied&&target&&run.owner.fighter==='link'&&(label==='ancient-fighter'||label==='ancient-terrain')&&
      (target.id==='link'||target.id==='donkeykong'||target.id==='pikachu')){
      target.setFinalVictimPresentation(beginFinalImpactVictimPresentation({runId:run.id,ownerPlayerIndex:run.owner.playerIndex,
        ownerGeneration:run.owner.generation,victimPlayerIndex:contact.target,victimGeneration:target.getPositionResetGeneration(),
        victimFighter:target.id,frame:this.physicsEngine.getFrame(),facing:target.getFacing(),acceptedHit:true,
        genuineVictimHitstop:target.isInHitlag(),packet:label==='ancient-fighter'?'ancient-fighter-blast':'ancient-terrain-blast',
        acceptedHitReceipt:JSON.stringify([run.id,_strike,contact.target,contact.packetId,this.physicsEngine.getFrame()])}));
    }
    return result?.reactionApplied === true;
  }

public tickWorldItems(frame: number): void {
    const inFlight = new Set(this.thrownItems.map(t => t.entity));
    for (const entity of this.itemRegistry.getActive()) {
      if (entity.isDespawned()) continue;
      if(entity.definition.container)this.tickContainer(entity,frame,inFlight.has(entity));
      else if(entity.definition.launchedByAttacks)this.tickAttackLaunch(entity,frame);
      else if(entity.definition.hammer)this.tickHammer(entity,frame);
      else if (entity.definition.bobOmb) this.tickBobOmb(entity, frame, inFlight.has(entity));
      else if (entity.definition.slipsOnContact && entity.getSnapshot().state === 'grounded' && !inFlight.has(entity))
        this.tickBananaSlip(entity, frame);
    }
    this.tickItemExplosions(frame);
  }

public tickContainer(entity:ItemEntity,frame:number,inFlight:boolean):void {
    const spec=entity.definition.container!,p=entity.getPosition();
    const centre={x:p.x,y:p.y-entity.definition.throwProfile.mapBottom*entity.definition.throwProfile.pixelsPerUnit};
    for(const strike of this.itemStrikes(entity)){
      if(entity.damageContainer(strike.hit.damage)){this.openContainer(entity,frame,strike.playerIndex);return;}
      if(spec.rolling&&!entity.isHeld()&&!inFlight&&entity.getSnapshot().state==='grounded')entity.startContainerRoll(strike.direction*spec.rolling.maxSpeed);
    }
    const rolling=entity.getContainerState()?.rolling;
    if(!spec.rolling||!rolling||entity.isHeld()||inFlight||entity.getSnapshot().state!=='grounded')return;
    const next=stepContainerRoll(spec.rolling,rolling),vx=next?.vx??0;
    const support=this.baseStage.bodies.platformBodies.find(platform=>(platform.label===PLATFORM_LABELS.solid||platform.label===PLATFORM_LABELS.passThrough)&&
      !platform.isSensor&&platform.collisionFilter.mask!==0&&Math.abs(platform.bounds.min.y-p.y)<=2&&p.x>=platform.bounds.min.x&&p.x<=platform.bounds.max.x);
    const position={x:p.x+vx,y:p.y};
    entity.updateFreePosition(position);entity.setContainerRolling(next);
    if(!support||position.x<support.bounds.min.x||position.x>support.bounds.max.x){
      entity.setContainerRolling(null);entity.markFalling(frame,position);this.itemSurfaceY.delete(entity.id);this.itemFallingY.delete(entity.id);
      this.thrownItems.push({entity,ownerSlotIndex:entity.getOwnerPlayerIndex()??-1,...position,vx,vy:0});return;
    }
    // Spin about the body centre while keeping the item bottom/root on its floor.
    if(!next)return;
    for(const slot of this.playerSlots){
      if(this.stockTracker.isEliminated(slot.playerIndex))continue;
      const contact=this.sweptHurtboxContact(slot.character,{x:p.x,y:centre.y},{x:position.x,y:centre.y},entity.definition.throwProfile.attackRadius*5);
      if(!contact)continue;
      const outcome=this.openContainer(entity,frame,entity.getOwnerPlayerIndex());
      if(outcome?.kind==='explosion')return;
      this.resolveCombatHit(slot.playerIndex,thrownItemHit(entity.definition,undefined,{vx,vy:0},1,contact.damageMultiplier,slot.character.isGrounded()),
        {kind:'attack',projectile:true,ignoreStaleMoves:true,moveId:'item.barrel.roll',attackInstance:entity,
          contactCircleSweepWorld:{from:{x:p.x,y:centre.y},to:{x:p.x+(position.x-p.x)*contact.fraction,y:centre.y},radius:entity.definition.throwProfile.attackRadius*5},
          attackerOwnerId:this.playerSlots.find(owner=>owner.playerIndex===entity.getOwnerPlayerIndex())?.character.id??'',
          attackerPlayerIndex:entity.getOwnerPlayerIndex()??undefined});
      return;
    }
  }

public itemStrikes(entity:ItemEntity):Array<{playerIndex:number;hit:HitInfo;direction:1|-1}> {
    const p=entity.getPosition();
    const centre={x:p.x,y:p.y-entity.definition.throwProfile.mapBottom*entity.definition.throwProfile.pixelsPerUnit};
    const radius=entity.definition.pickupBounds?Math.max(entity.definition.pickupBounds.width,entity.definition.pickupBounds.height)/2:20;
    const strikes=this.containerStrikeFrames.get(entity.id)??new Map<string,number>();
    this.containerStrikeFrames.set(entity.id,strikes);
    const struck:Array<{playerIndex:number;hit:HitInfo;direction:1|-1}>=[];
    for(const slot of this.playerSlots){
      if(this.stockTracker.isEliminated(slot.playerIndex)||slot.playerIndex===entity.getHolderPlayerIndex()||slot.character.isInHitlag())continue;
      const fighter=slot.character,hammer=fighter.getEquippedItem()?.definition.hammer,hammerState=fighter.getEquippedItem()?.getHammerState?.();
      const attack=fighter.getActiveAttack(),body=attack?.phase==='active'?attack.hitboxBody:null;
      let hit:HitInfo,key:string,interval:number,direction=fighter.getFacing(),strikeAge=attack?.framesElapsed??0;
      if(hammer&&hammerState&&!hammerState.malfunction&&fighter.getHammerPresentation()&&!fighter.isTumbling()&&
        fighter.getHammerDamageAreas(hammer).some(area=>Math.hypot(area.x-centre.x,area.y-centre.y)<=area.radius+radius)){
        key=`hammer.${this.inventoriesByPlayerIndex.get(slot.playerIndex)?.getHeldItem()?.id??slot.playerIndex}`;interval=hammer.rehitFrames;strikeAge=hammerState.motionElapsed;
        hit={damage:hammer.damage,knockback:{x:0,y:0,scaling:0,reference:hammer.knockback},facing:direction};
      }else if(body){
        const x=Math.max(body.bounds.min.x,Math.min(centre.x,body.bounds.max.x)),y=Math.max(body.bounds.min.y,Math.min(centre.y,body.bounds.max.y));
        if(Math.hypot(centre.x-x,centre.y-y)>radius)continue;
        key=`strike.${body.id}`;interval=body.plugin.rehitFrames??Infinity;direction=attack!.facing;
        hit={damage:body.plugin.damage??attack!.move.damage,knockback:body.plugin.knockback??attack!.move.knockback,
          facing:hitLaunchFacing(body.plugin,centre.x-fighter.getPosition().x)};
      }else continue;
      if(strikeAge-(strikes.get(key)??-Infinity)<interval)continue;
      strikes.set(key,strikeAge);
      struck.push({playerIndex:slot.playerIndex,hit,direction});
    }
    return struck;
  }

public tickAttackLaunch(entity:ItemEntity,frame:number):void {
    if(entity.isHeld())return;
    const strike=this.itemStrikes(entity)[0];
    if(!strike)return;
    const velocity=itemAttackLaunchVelocity(strike.hit),flight=this.thrownItems.find(t=>t.entity===entity);
    if(flight){
      Object.assign(flight,{ownerSlotIndex:strike.playerIndex,vx:velocity.vx,vy:velocity.vy});
      delete flight.passiveDrop;delete flight.throwAction;delete flight.ownerCleared;delete flight.damagePower;
      return;
    }
    const p=entity.getPosition();
    entity.markFalling(frame,p);
    this.itemSurfaceY.delete(entity.id);this.itemFallingY.delete(entity.id);
    this.thrownItems.push({entity,ownerSlotIndex:strike.playerIndex,x:p.x,y:p.y,vx:velocity.vx,vy:velocity.vy});
  }

public tickHammer(entity:ItemEntity,frame:number):void {
    const spec=entity.definition.hammer!;entity.advanceHammerGrowth(frame);
    if(!entity.isHeld())return;
    const slot=this.playerSlots.find(s=>s.playerIndex===entity.getHolderPlayerIndex());if(!slot)return;
    if(slot.character.getEquippedItem()!==entity){this.removeItem(entity,frame);return;}
    if(!entity.getHammerState()){
      entity.startHammer(this.matchRng.stream(spec.golden?GOLDEN_HAMMER_RNG_STREAM:HAMMER_RNG_STREAM).next());
      // A pickup commits after the generic held-visual pass. Its first
      // Hammer drawing and contact must already share this activated socket.
      entity.updateHeldPosition(slot.character.getHeldItemWorldPosition());
    }
    let state=entity.getHammerState()!;
    if(state.elapsed>=spec.durationFrames){this.removeItem(entity,frame);return;}
    if(state.malfunction==='headless'&&!state.detached){
      entity.setHammerState(state={...state,detached:true});
      const centre=slot.character.getHammerDamageAreas(spec)[2]!;
      const hand={x:centre.x,y:centre.y+HAMMER_HEAD_DEFINITION.visual!.height/2};
      const head=this.itemRegistry.spawn(HAMMER_HEAD_DEFINITION,hand,frame,ItemEntity);
      this.thrownItems.push({entity:head,ownerSlotIndex:slot.playerIndex,x:hand.x,y:hand.y,vx:0,vy:0,passiveDrop:true});
    }
    if(state.malfunction || !slot.character.getHammerPresentation() || slot.character.isTumbling() || slot.character.isInHitlag())return;
    const circles=slot.character.getHammerDamageAreas(spec);
    for(const target of this.playerSlots){
      if(target===slot || this.stockTracker.isEliminated(target.playerIndex))continue;
      if(!entity.canHammerContact(target.playerIndex))continue;
      const contact=circles.map(c=>{const hit=this.sweptHurtboxContact(target.character,c,c,c.radius);return hit?{...hit,circle:c}:null;}).find(c=>c!==null);
      if(!contact)continue;
      const facing=slot.character.getFacing();
      const result=this.resolveCombatHit(target.playerIndex,hammerHit(spec,facing,contact.damageMultiplier),
        {kind:'attack',ignoreStaleMoves:true,moveId:`item.${entity.definition.type}.auto`,attackInstance:{},
        contactCircleSweepWorld:{from:contact.circle,to:contact.circle,radius:contact.circle.radius},
        attackerOwnerId:slot.character.id,attackerPlayerIndex:slot.playerIndex,attackerBodyId:slot.character.body.id});
      if(result?.confirmed){entity.confirmHammerContact(target.playerIndex);state=entity.getHammerState()!;}
    }
  }

public tickBobOmb(entity: ItemEntity, frame: number, flying: boolean): void {
    const spec = entity.definition.bobOmb!, snap = entity.getSnapshot();
    const holder = snap.state === 'held' ? snap.holderPlayerIndex : null;
    const situation = snap.state === 'held' ? 'held' : snap.state === 'grounded' && !flying ? 'grounded' : 'airborne';
    const pos = entity.getPosition();
    const centre = situation === 'held' ? pos : { x: pos.x, y: pos.y - spec.explosion.centreAboveRoot };
    if (situation !== 'airborne' && this.itemHitByAttack(centre, spec.contactRadius, holder)) {
      this.explodeItem(entity, frame, holder);
      return;
    }
    // It turns toward the nearest fighter when it starts walking (SmashWiki, SSB4).
    const nearest = this.playerSlots.filter(slot => !this.stockTracker.isEliminated(slot.playerIndex))
      .map(slot => slot.character.getPosition().x - pos.x).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 1;
    const step = stepBobOmb(spec, entity.getBobOmbState()!, situation, nearest < 0 ? -1 : 1);
    let state = step.state;
    if (step.explode) {
      entity.setBobOmbState(state);
      this.explodeItem(entity, frame, holder);
      return;
    }
    if (situation === 'grounded' && state.phase === 'walking') {
      if (this.playerSlots.some(slot => !this.stockTracker.isEliminated(slot.playerIndex)
        && this.sweptHurtboxContact(slot.character, centre, centre, spec.contactRadius))) {
        this.explodeItem(entity, frame, null);
        return;
      }
      // Back and forth on its platform, turning at the edges.
      const platform = this.baseStage.bodies.platformBodies.find(b =>
        (b.label === PLATFORM_LABELS.solid || b.label === PLATFORM_LABELS.passThrough) && !b.isSensor
        && b.collisionFilter.mask !== 0 && Math.abs(b.bounds.min.y - pos.y) <= 2 && pos.x >= b.bounds.min.x && pos.x <= b.bounds.max.x);
      const half = (entity.definition.visual?.width ?? 0) / 2, next = pos.x + state.direction * spec.walkSpeed;
      if (!platform || next < platform.bounds.min.x + half || next > platform.bounds.max.x - half)
        state = { ...state, direction: state.direction === 1 ? -1 : 1 };
      else entity.updateFreePosition({ x: next, y: pos.y });
    }
    entity.setBobOmbState(state);
  }

public itemHitByAttack(centre: { x: number; y: number }, radius: number, holder: number | null): boolean {
    return this.playerSlots.some(slot => {
      if (slot.playerIndex === holder || this.stockTracker.isEliminated(slot.playerIndex)) return false;
      const fighter=slot.character,hammer=fighter.getEquippedItem()?.definition.hammer;
      const hammerState=fighter.getEquippedItem()?.getHammerState?.();
      if(hammer && hammerState && !hammerState.malfunction && fighter.getHammerPresentation() && !fighter.isInHitlag() && !fighter.isTumbling() &&
        fighter.getHammerDamageAreas(hammer).some(c=>Math.hypot(c.x-centre.x,c.y-centre.y)<=c.radius+radius))return true;
      const attack = fighter.getActiveAttack();
      const bounds = attack?.phase === 'active' ? attack.hitboxBody?.bounds : undefined;
      if (!bounds) return false;
      const x = Math.max(bounds.min.x, Math.min(centre.x, bounds.max.x)), y = Math.max(bounds.min.y, Math.min(centre.y, bounds.max.y));
      return Math.hypot(centre.x - x, centre.y - y) <= radius;
    });
  }

public tickBananaSlip(entity: ItemEntity, frame: number): void {
    const pos = entity.getPosition(), owner = entity.getOwnerPlayerIndex();
    const ownerSlot = owner === null ? undefined : this.playerSlots.find(s => s.playerIndex === owner);
    for (const slot of this.playerSlots) {
      const fighter = slot.character;
      if (slot.playerIndex === owner || this.stockTracker.isEliminated(slot.playerIndex)) continue;
      if (!fighter.isGrounded() || fighter.isTripped() || !this.sweptHurtboxContact(fighter, pos, pos, BANANA_SLIP_RADIUS)) continue;
      const facing: 1 | -1 = fighter.getPosition().x < pos.x ? -1 : 1;
      const result = this.resolveCombatHit(slot.playerIndex, bananaSlipHit(facing),
        { kind: 'attack', projectile: true, ignoreStaleMoves: true, moveId: 'item.bananaPeel.slip', attackInstance: {},
          contactCircleSweepWorld:{from:pos,to:pos,radius:BANANA_SLIP_RADIUS},
          attackerOwnerId: ownerSlot?.character.id ?? '', attackerPlayerIndex: owner ?? undefined, attackerBodyId: ownerSlot?.character.body.id });
      if (!result?.confirmed) continue;
      if (entity.wearOut()) { this.removeItem(entity, frame); return; }
      entity.markFalling(frame, pos);
      this.itemSurfaceY.delete(entity.id); this.itemFallingY.delete(entity.id);
      this.thrownItems.push({ entity, ownerSlotIndex: owner ?? -1, x: pos.x, y: pos.y,
        vx: -facing * BANANA_SLIP_PUSH.vx, vy: BANANA_SLIP_PUSH.vy, passiveDrop: true });
      return;
    }
  }

public tickItemExplosions(frame: number): void {
    for (const e of [...this.itemExplosions]) {
      const centre = { x: e.x, y: e.y };
      const ownerSlot = e.owner === null ? undefined : this.playerSlots.find(s => s.playerIndex === e.owner);
      for (const slot of this.playerSlots) {
        if ((e.ownerImmune!==false&&slot.playerIndex === e.owner) || e.done.has(slot.playerIndex) || this.stockTracker.isEliminated(slot.playerIndex)) continue;
        const contact = this.sweptHurtboxContact(slot.character, centre, centre, e.spec.radius);
        if (!contact) continue;
        const facing: 1 | -1 = slot.character.getPosition().x < e.x ? -1 : 1;
        const result = this.resolveCombatHit(slot.playerIndex, itemExplosionHit(e.spec, facing, contact.damageMultiplier),
          { kind: 'attack', projectile: true, ignoreStaleMoves: true, moveId: e.moveId??'item.bobOmb.explosion', attackInstance: e,
            contactCircleSweepWorld:{from:centre,to:centre,radius:e.spec.radius},
            attackerOwnerId: ownerSlot?.character.id ?? '', attackerPlayerIndex: e.owner ?? undefined, attackerBodyId: ownerSlot?.character.body.id });
        if (result?.confirmed) e.done.add(slot.playerIndex);
      }
      for (const other of this.itemRegistry.getActive()) {
        const containerSpec=other.definition.container;
        if(containerSpec){
          const p=other.getPosition(),y=p.y-other.definition.throwProfile.mapBottom*other.definition.throwProfile.pixelsPerUnit;
          if(Math.hypot(p.x-e.x,y-e.y)<=e.spec.radius+other.definition.throwProfile.attackRadius*5&&other.damageContainer(e.spec.damage))
            this.openContainer(other,frame,e.owner);
        }
        const bob = other.definition.bobOmb;
        if (!bob) continue;
        const p = other.getPosition(), y = other.isHeld() ? p.y : p.y - bob.explosion.centreAboveRoot;
        if (Math.hypot(p.x - e.x, y - e.y) <= e.spec.radius + bob.contactRadius)
          this.explodeItem(other, frame, other.isHeld() ? other.getHolderPlayerIndex() : null);
      }
      e.framesLeft -= 1;
    }
    this.itemExplosions = this.itemExplosions.filter(e => {
      if (e.framesLeft > 0) return true;
      return false;
    });
  }

public tickSmashBall(frame: number): void {
    const manager = this.smashBallRuntime; if (!manager) return;
    const blast = this.baseStage.getViewportBlastZone(), platforms = this.baseStage.bodies.platformBodies;
    const playable = platforms.filter(body => !body.isSensor && body.collisionFilter.mask !== 0 &&
      (body.label === PLATFORM_LABELS.solid || body.label === PLATFORM_LABELS.passThrough));
    const left = playable.length ? Math.min(...playable.map(p => p.bounds.min.x)) : blast.x;
    const right = playable.length ? Math.max(...playable.map(p => p.bounds.max.x)) : blast.x + blast.width;
    const ground = playable.length ? Math.max(...playable.map(p => p.bounds.min.y)) : blast.y + blast.height;
    const scores = this.matchRules.getScores(frame);
    manager.step({ frame, bounds: { left, right, top: Math.max(blast.y + 40, ground - 420), bottom: ground - 30 }, heavyBottomBlastY: blast.y + blast.height,
      fighters: this.playerSlots.filter(slot => !this.stockTracker.isEliminated(slot.playerIndex)).map(slot => ({
        playerIndex: slot.playerIndex, position: slot.character.getPosition(),
        score: this.activeMatchConfig.mode === 'stocks' || this.matchRules.isSuddenDeath()
          ? this.stockTracker.getStocks(slot.playerIndex) : scores[slot.playerIndex]! })),
      floorY: (x, previousY, nextY) => playable.filter(platform => x >= platform.bounds.min.x && x <= platform.bounds.max.x &&
        previousY <= platform.bounds.min.y + 2 && nextY >= platform.bounds.min.y)
        .sort((a, b) => a.bounds.min.y - b.bounds.min.y)[0]?.bounds.min.y ?? null },
      () => this.matchRng.stream('final-ball-motion').next());
    let ball = manager.getRoaming();
    if (ball) for (const slot of this.playerSlots) {
      if (this.stockTracker.isEliminated(slot.playerIndex) || slot.character.isInHitlag()) continue;
      const actor = slot.character;
      const hammer = actor.getEquippedItem()?.definition.hammer, hammerState = actor.getEquippedItem()?.getHammerState?.();
      if (hammer && hammerState && !hammerState.malfunction && actor.getHammerPresentation() && !actor.isTumbling() &&
        actor.getHammerDamageAreas(hammer).some(area => Math.hypot(area.x - ball!.position.x, area.y - ball!.position.y) <= area.radius + manager.policy.radius))
        this.damageSmashBall(slot.playerIndex, hammer.damage,
          `ball-${ball.resource.id}-hammer-${slot.playerIndex}-${Math.floor(hammerState.motionElapsed / hammer.rehitFrames)}`);
      ball = manager.getRoaming(); if (!ball) break;
    }
    if (ball) for (const body of this.physicsWorld.world.getAllBodies()) {
      if (body.label !== HITBOX_LABEL) continue;
      const plugin = body.plugin as HitboxPlugin;
      if (plugin.kind === 'grab') continue;
      const owner = this.playerSlots.find(slot => slot.character.body.id === plugin.ownerBodyId);
      if (!owner || this.stockTracker.isEliminated(owner.playerIndex)) continue;
      const geometry = plugin.hitbox;
      const origin = plugin.ownerAnchoredContact ? owner.character.getPosition() : geometry
        ? { x: body.position.x - geometry.offsetX * plugin.facing, y: body.position.y - geometry.offsetY } : null;
      let damage = plugin.damage, touches = false,selectedContact:AttackCollisionHit|null=null;
      if (plugin.collisionHits && origin) {
        const contact = [...plugin.collisionHits].sort((a, b) => a.id - b.id).find(row => row.targetCategory !== 'fighter' &&
          capsulesIntersect(posedCapsule(row.capsule, origin, plugin.facing),
            { start: ball!.position, end: ball!.position, radius: manager.policy.radius }));
        if (contact) { touches = true; damage = contact.damage ?? damage;selectedContact=contact; }
      } else {
        const x = Math.max(body.bounds.min.x, Math.min(ball.position.x, body.bounds.max.x));
        const y = Math.max(body.bounds.min.y, Math.min(ball.position.y, body.bounds.max.y));
        touches = Math.hypot(x - ball.position.x, y - ball.position.y) <= manager.policy.radius;
      }
      if (touches) this.damageSmashBall(owner.playerIndex,
        damage * (plugin.moveId.startsWith('item.') ? 1 : owner.character.getStaleMultiplier(plugin.moveId)),
        `ball-${ball.resource.id}-body-${body.id}`,{moveId:plugin.moveId,
          sourcePoseId:owner.character.getAttack(plugin.staleMoveId??plugin.moveId)?.sourcePoseId??null,
          bodyId:body.id,collisionHitId:selectedContact?.id??null,packet:selectedContact??{damage:plugin.damage,hitbox:plugin.hitbox??null},origin,facing:plugin.facing});
      ball = manager.getRoaming(); if (!ball) break;
    }

  }

public damageSmashBall(playerIndex: number, damage: number, receipt: string,
    _contact?:{moveId:string;sourcePoseId:string|null;bodyId:number;collisionHitId:number|null;packet:unknown;origin:{x:number;y:number}|null;facing:1|-1}): boolean {
    const manager=this.smashBallRuntime,acceptedBefore=manager?.hasAcceptedStrike(receipt)??false;
    const granted = this.smashBallRuntime?.hit({ receipt, attacker: playerIndex,
      damageAfterStaleFresh: damage, scoreDifference: this.finalBallScoreDifference(playerIndex) });
    if (granted !== null && granted !== undefined) {
      if (this.finalSmashController?.canOwnResource(granted)) this.finalSmashController.grantBall(granted, this.physicsEngine.getFrame());
      else this.smashBallRuntime?.consumeOrRetireStandby(granted, this.physicsEngine.getFrame());
    }
    return !acceptedBefore&&(manager?.hasAcceptedStrike(receipt)??false);
  }

public finalBallScoreDifference(playerIndex: number): number {
    const scores = this.activeMatchConfig.mode === 'stocks' || this.matchRules.isSuddenDeath()
      ? this.playerSlots.map(slot => this.stockTracker.getStocks(slot.playerIndex)) : this.matchRules.getScores(this.physicsEngine.getFrame());
    const others = this.playerSlots.filter(slot => slot.playerIndex !== playerIndex && !this.stockTracker.isEliminated(slot.playerIndex))
      .map(slot => scores[slot.playerIndex]!);
    return others.length ? scores[playerIndex]! - Math.max(...others) : 0;
  }

public latchTrapExplosions(frame: number): void {
    const liveExplosions = new Set<string>();
    for (const slot of this.playerSlots) {
      if (this.stockTracker.isEliminated(slot.playerIndex)) continue;
      for (const t of slot.character.getActiveTraps()) {
        if (!t.detonated) continue;
        const key = `${slot.playerIndex}:${t.objectId}`;
        liveExplosions.add(key);
        if (this.trapExplosionLatches.has(key)) continue;
        this.trapExplosionLatches.add(key);
        this.simEvents.push({ kind: 'damageFlash', frame, x: t.x, y: t.y, width: t.width, height: t.height, color: 0xff7040 });
        this.simEvents.push({ kind: 'explosion', frame, x: t.x, y: t.y, radius: Math.max(t.width, t.height) / 2 });
      }
    }
    for (const key of this.trapExplosionLatches) {
      if (!liveExplosions.has(key)) this.trapExplosionLatches.delete(key);
    }
  }

public readonly trapExplosionLatches = new Set<string>();

public sourceAbsorberContact(actor:Character,from:{x:number;y:number},to:{x:number;y:number},projectile:AbsorbProjectileShape,absorbable:boolean){
    const attack=actor.getActiveAttack(),window=activeAbsorber(attack);if(!window||!attack)return null;
    const origin=window.coordinateOrigin==='actorSourceRoot'?actor.getSourceRootPosition():actor.getPosition();
    const hit=sweepAttackAbsorber({window,origin,facing:attack.facing,from,to,projectile,absorbable});
    return hit?{kind:'absorber' as const,fraction:hit.fraction,window}:null;
  }

public spawnLinkArrowItem(at:{x:number;y:number},lifetimeFrames:number,frame:number):void {
    const entity=this.spawnLinkArticleItem(LINK_ARROW_ITEM_DEFINITION,at,frame);
    entity.initializeGeneratedArrowLifetime(lifetimeFrames,frame);this.itemSurfaceY.set(entity.id,entity.getPosition().y);
  }

public acceptSourceAbsorption(player:number,window:AttackAbsorbWindow,sourceDamage:number):void {
    const actor=this.playerSlots.find(s=>s.playerIndex===player)?.character;
    actor?.applySourceAbsorbedHealing(absorbedHealingAmount(window,sourceDamage));
    // Selected absorption-only admission does not enqueue staleness or Final
    // Meter. The source healing dose ignores incoming stale/freshness.
  }

public respawnHandler!: RespawnHandler;

public blastZoneWatcher!: BlastZoneWatcher;

public beginSuddenDeath(participants: ReadonlyArray<number>): void {
    const frame = this.physicsEngine.getFrame();
    for (const cpu of this.cpuControllers.values()) cpu.reset();
    this.clearFinalFxPresentation();
    for (const [index, inventory] of this.inventoriesByPlayerIndex) {
      inventory.drop(frame, this.playerSlots[index]!.character.getPosition(),'reset');
    }
    
    this.itemSurfaceY.clear();
    this.itemFallingY.clear();
    this.itemRegistry.reset();this.pendingRecoveryEvents=[];this.containerStrikeFrames.clear();
    this.linkArticles.reset();this.finalVictimFitDependencies.clear();this.gazeKnockouts.clear(); this.linkArrowCombatReceipts.clear(); this.linkArrowVolleyTokens.clear(); this.linkArrowAttackReceipts = new WeakMap();
    this.itemSpawnManager = null;
    this.projectiles = [];
    this.projectileSpawnLatch.clear();
    this.thrownItems = [];
    this.matchStatsTracker.clearAttribution();
    this.prevLedgeKeys.clear();
    this.prevFighterFeetY = new WeakMap();
    this.prevFighterPositionGeneration = new WeakMap();
    this.prevPlatformTopY = new WeakMap();
    this.passThroughLandingGrace = new WeakMap();
    this.suppressAttackUntilRelease.clear();
    for (const slot of this.playerSlots) {
      this.respawnHandler.unregisterSlot(slot.playerIndex);
      slot.character.resetForRound(slot.spawnX, slot.spawnY);
      slot.character.setFacing(slot.faceOnSpawn);
      slot.character.setDamagePercent(participants.includes(slot.playerIndex) ? LIVE_SUDDEN_DEATH_PERCENT : 0);
      this.blastZonePositionWatcher.clearOutOfBounds(slot.playerIndex);
      if (!participants.includes(slot.playerIndex)) {
        this.matchStatsTracker.recordElimination(slot.playerIndex, frame);
        this.blastZoneWatcher.unregisterPlayer(slot.playerIndex);
        this.blastZonePositionWatcher.unregisterPlayer(slot.playerIndex);
        this.hitboxDamageHandler.unregisterPlayer(slot.playerIndex);
        this.baseStage.unregisterPlayer(slot.playerIndex);
      }
    }
  }

public clearFinalFxPresentation():void{this.finalFxClocks.clear();}

public matchStatsTracker!: MatchStatsTracker;

public prevFighterFeetY: WeakMap<Character, number> = new WeakMap();

public prevFighterPositionGeneration: WeakMap<Character, number> = new WeakMap();

public passThroughLandingGrace: WeakMap<Character, Set<number>> = new WeakMap();

public recordingStopped = false;

public recordingController!: RecordingController;

public create(data?: MatchSimData):void {
this.physicsWorld = createMatterPhysicsWorld();
const physicsHost: PhysicsHost = { matter: this.physicsWorld };
const history=data?.historyCheckpoint?parseMatchHistoryCheckpoint(data.historyCheckpoint,this.buildIdentity):null;
if(history)data={matchConfig:history.replay.matchConfig,rngSeed:history.replay.rngSeed,
      ...(history.customStage===null?{}:{customStage:deserializeCustomStage(history.customStage)}),
      characterOverrides:history.characterOverrides,labMode:history.labMode};
this.historyRestore=history;
this.historyRestoreStatus=history?'reconstructing':'idle';
this.setRecordedInputs(history?.replay.inputTimeline.entries??null);
this.historyConstructionPositions=[];
this.historyConstructionError=null;
this.clearSourceScreenKo();
this.cpuBallAttackHeld.clear();
this.cpuBallStrategies.clear();
this.cpuBallGoals.clear();
this.itemSpawnEventLog.reset();
this.trapExplosionLatches.clear();
this.itemExplosions = [];
this.sourceIntro=null;
this.pausedForMenu = false;
this.prevLedgeKeys.clear();
this.initialiseMatchSeed(data);
const { width, height } = this.viewport;
this.historyConstructionViewport={width,height};
if(history&&(history.viewport.width!==width||history.viewport.height!==height))
      throw new Error('History reconstruction requires the exact original construction viewport');
this.physicsEngine = new PhysicsEngine();
const requestedStageId = data?.matchConfig?.stageId;
if (data?.customStage) {
      const runtimeId =
        requestedStageId && isCustomStageId(requestedStageId)
          ? requestedStageId
          : undefined;
      this.activeStage = customStageDataToStageLayout(data.customStage, {
        runtimeIdOverride: runtimeId,
      });
    } else if (requestedStageId && isCustomStageId(requestedStageId)) {
      const slotId = customStageSlotIdFromRuntimeId(requestedStageId);
      const loaded = loadCustomStage(slotId);
      if (loaded.ok) {
        data={...data,customStage:loaded.value};
        this.activeStage = customStageDataToStageLayout(loaded.value, {
          runtimeIdOverride: requestedStageId,
        });
      } else {
        // The saved-stage load failed — log and fall back to FLAT_STAGE.
        // We don't crash because the match flow has already committed
        // to starting; a graceful fallback lets the player see "the
        // custom stage is gone" via the rendered stage banner rather
        // than a stack trace.
        console.warn(
          `MatchSim: failed to load custom stage '${slotId}' (${loaded.code}: ${loaded.error}); falling back to FLAT_STAGE.`,
        );
        this.activeStage = FLAT_STAGE;
      }
    } else if (
      requestedStageId &&
      Object.prototype.hasOwnProperty.call(STAGES, requestedStageId)
    ) {
      this.activeStage = getStage(requestedStageId);
    } else {
      this.activeStage = FLAT_STAGE;
    }
this.baseStage = new BaseStage(physicsHost, this.activeStage, {
      viewportSize: { width, height },
      onLavaKo: (playerIndex) => {
        // Same instant-KO pipeline as the legacy LavaCollisionWatcher
        // wiring: route through the stats-aware stock-loss helper so
        // the post-match stats panel sees the lava-KO too.
        this.recordStockLossWithStats(
          playerIndex,
          this.physicsEngine.getFrame(),
        );
      },
      onWindForce: (playerIndex, _hazardId, force) => {
        // Resolve the live fighter body and nudge velocity. Slot 0 = P1
        // (Wolf), slot 1 = P2 (Cat). Same body lookup the old
        // WindForceController callback used.
        const body = [this.p1, this.p2, ...this.extraFighters][playerIndex]?.body;
        if (!body) return;
        // Skip eliminated slots so a corpse body doesn't drift on
        // gusts after KO. Mirrors the lava watcher's handling.
        if (this.stockTracker?.isEliminated(playerIndex)) return;
        this.physicsWorld.body.setVelocity(body, {
          x: body.velocity.x + force.x,
          y: body.velocity.y + force.y,
        });
      },
    });
const designOffsetX = this.baseStage.transform.offsetX;
const designOffsetY = this.baseStage.transform.offsetY;
const toViewportX = (dx: number): number => designOffsetX + dx * this.baseStage.bodies.scale;
const toViewportY = (dy: number): number => designOffsetY + dy * this.baseStage.bodies.scale;
this.activeMatchConfig = snapshotMatchCharacters(this.resolveActiveMatchConfig(data));
const storedBindings = this.options.bindingsStore ?? new InputBindingsStore();
this.matchParticipants = buildMatchParticipants(this.activeMatchConfig.players, storedBindings, this.options.inputProfiles);
this.activeMatchConfig = snapshotMatchCharacters({ ...this.activeMatchConfig, players: this.matchParticipants.map((participant) => participant.slot) });
this.matchParticipants = this.matchParticipants.map((participant, index) => Object.freeze({ ...participant, slot: this.activeMatchConfig.players[index]! }));
if (this.matchParticipants.length < 2) throw new Error('A match needs at least two fighters; add a CPU for solo play.');
this.launchData = { ...data, matchConfig: this.activeMatchConfig };
const firstParticipant = this.matchParticipants[0]!.slot;
const secondParticipant = this.matchParticipants[1]!.slot;
const wolfSpawn = this.activeStage.spawnPoints[0]!;
const catSpawn = this.activeStage.spawnPoints[1]!;
const p1SpawnX = toViewportX(wolfSpawn.x);
const p1SpawnY = toViewportY(wolfSpawn.y);
const p2SpawnX = toViewportX(catSpawn.x);
const p2SpawnY = toViewportY(catSpawn.y);
const p1CharacterId = firstParticipant.characterId;
const p2CharacterId = secondParticipant.characterId;
const p1Override = data?.characterOverrides?.find(
      (entry) => entry.slotIndex === firstParticipant.index && entry.spec.id === p1CharacterId,
    )?.spec ?? firstParticipant.customCharacter?.spec;
const p2Override = data?.characterOverrides?.find(
      (entry) => entry.slotIndex === secondParticipant.index && entry.spec.id === p2CharacterId,
    )?.spec ?? secondParticipant.customCharacter?.spec;
this.p1 = createCharacterById(physicsHost, p1CharacterId, {
      ...(p1Override?.movement ?? {}),
      ...(p1Override?.body ?? {}),
      spawnX: p1SpawnX,
      spawnY: p1SpawnY,
      slotIndex: 0,
    });
this.p2 = createCharacterById(physicsHost, p2CharacterId, {
      ...(p2Override?.movement ?? {}),
      ...(p2Override?.body ?? {}),
      spawnX: p2SpawnX,
      spawnY: p2SpawnY,
      slotIndex: 1,
    });
if (p1Override) applyCharacterMoveOverrides(this.p1, p1Override);
if (p2Override) applyCharacterMoveOverrides(this.p2, p2Override);
this.p1.setFacing(1);
this.p2.setFacing(-1);
const resolvedPlayerCount = Math.min(this.activeMatchConfig.players.length, 4);
for (let slotIdx = 2; slotIdx < resolvedPlayerCount; slotIdx += 1) {
       // matchConfig.players.index is 1-based
      const sp = this.activeStage.spawnPoints[slotIdx];
      if (!sp) break; // stage doesn't have enough spawn points
      const sx = toViewportX(sp.x);
      const sy = toViewportY(sp.y);
      const participant = this.matchParticipants[slotIdx]!.slot;
      const cid = participant.characterId;
      const fighterOverride = data?.characterOverrides?.find(
        (entry) => entry.slotIndex === participant.index && entry.spec.id === cid,
      )?.spec ?? participant.customCharacter?.spec;
      const fighter = createCharacterById(physicsHost, cid, {
        ...(fighterOverride?.movement ?? {}),
        ...(fighterOverride?.body ?? {}),
        spawnX: sx,
        spawnY: sy,
        slotIndex: slotIdx,
      });
      if (fighterOverride) applyCharacterMoveOverrides(fighter, fighterOverride);
      // Face inward so initial attacks tend toward the centre of the stage.
      fighter.setFacing(slotIdx % 2 === 0 ? 1 : -1);
      this.extraFighters.push(fighter);

      
}
this.stockTracker = new StockTracker({
      playerCount: resolvedPlayerCount,
      ...MatchRulesController.stockOptions(this.activeMatchConfig),
      respawnDelayFrames: 0,
      invincibilityFrames: DEFAULT_INVINCIBILITY_FRAMES, // 90 frames = 1.5 s
    });
this.matchStatsTracker = new MatchStatsTracker({
      playerCount: resolvedPlayerCount,
      matchStartFrame: 0,
    });
this.matchRules = new MatchRulesController(this.activeMatchConfig, this.stockTracker, this.matchStatsTracker);
this.blastZoneWatcher = new BlastZoneWatcher((playerIndex) => {
      // Use the *current* simulated frame so the respawn fire-frame is
      // computed deterministically against the same clock the rest of
      // the engine reads. Calling `getFrame()` here is safe even mid-
      // step because `PhysicsEngine` only advances the counter between
      // step callbacks.
      this.recordStockLossWithStats(playerIndex, this.physicsEngine.getFrame());
    });
this.blastZoneWatcher.registerPlayer(0, this.p1.body);
this.blastZoneWatcher.registerPlayer(1, this.p2.body);
for (let i = 0; i < this.extraFighters.length; i += 1) {
      this.blastZoneWatcher.registerPlayer(i + 2, this.extraFighters[i]!.body);
    }
this.blastZonePositionWatcher = new BlastZonePositionWatcher(
      this.activeStage.blastZone,
      (event) => {
        this.recordStockLossWithStats(event.playerIndex, event.frame);
        const actor=this.playerSlots.find(slot=>slot.playerIndex===event.playerIndex)?.character;
        if(actor?.id==='link'&&this.acceptedStockLossFrames.get(event.playerIndex)===event.frame&&
          this.sourceScreenKo.get(event.playerIndex)?.koFrame!==event.frame){
          const state=beginLinkScreenKoPresentation({frame:event.frame,generation:actor.getPositionResetGeneration(),facing:actor.getFacing(),
            playerIndex:event.playerIndex,koFrame:event.frame,position:event.position,direction:event.edge,acceptedStockLoss:true});
          if(state)this.sourceScreenKo.set(event.playerIndex,state);
        }
      },
    );
this.blastZonePositionWatcher.registerPlayer(0, this.p1.body);
this.blastZonePositionWatcher.registerPlayer(1, this.p2.body);
for (let i = 0; i < this.extraFighters.length; i += 1) {
      this.blastZonePositionWatcher.registerPlayer(i + 2, this.extraFighters[i]!.body);
    }
const attackStaleness = new WeakMap<object, number>();
this.resolveCombatHit = (targetIndex, hitInfo, context) => {
        const slot = this.playerSlots?.[targetIndex];
        if (!slot) return { confirmed: false };
        // Eliminated fighters are unregistered from the handler before
        // they can take phantom hits, but check defensively in case a
        // late-firing event arrives the same step a slot is removed.
        if (this.stockTracker.isEliminated(slot.playerIndex)) {
          return { confirmed: false };
        }
        // Grab range-sensor connects route to a different resolver
        // than damage hitboxes — both fighters transition into the
        // grabber-holding / target-grabbed pair, no immediate damage.
        if (context.kind === 'grab') {
          if (slot.character.isCaptureProtected()) return { confirmed: false };
          const attackerSlotForGrab =
            context.attackerPlayerIndex !== undefined
              ? this.playerSlots?.find(
                  (s) => s.playerIndex === context.attackerPlayerIndex,
                )
              : this.playerSlots?.find(
                  (s) => s.character.id === context.attackerOwnerId,
                );
          if (attackerSlotForGrab) {
            attackerSlotForGrab.character.resolveGrabConnect(slot.character);
            return { confirmed: slot.character.getGrabbedBy() === attackerSlotForGrab.character };
          }
          return { confirmed: false };
        }
        // AC 10304 — capture whether the defender was shielding BEFORE
        // the hit resolves. A shielded hit drains shield health (and may
        // shatter it) — the Character voices its own shield / shield-
        // break cue for that case, so we must NOT also fire the flesh-
        // and-bone connect cue or the block would double up.
        // ---- Tier 3: RAGE + STALE-MOVE negation ------------------------
        // Resolve the attacker BEFORE applying the hit so we can fold two
        // attacker-side modifiers into the hit:
        //   • RAGE — the attacker's own percent scales their knockback up
        //     (a battered fighter KOs earlier).
        //   • STALE-MOVE negation — a move repeated recently deals less
        //     damage AND knockback; varying offence keeps moves fresh.
        // Both are deterministic functions of attacker state, so the
        // replay re-derives identical hits.
        const attackerSlot =
          context.attackerPlayerIndex !== undefined
            ? this.playerSlots?.find(
                (s) => s.playerIndex === context.attackerPlayerIndex,
              )
            : this.playerSlots?.find(
                (s) => s.character.id === context.attackerOwnerId,
              );
        if(attackerSlot&&!attackerSlot.character.mayResolveIntrinsicSourceContact(slot.playerIndex,context.attackInstance))return{confirmed:false};
        const staleMoveId = context.staleMoveId ?? context.moveId;
        const attackType = attackerSlot?.character.getAttack(staleMoveId)?.type;
        let effectiveHit: HitInfo = { ...hitInfo,combatShieldContact:this.sourceShieldContactReceipt(slot.character,hitInfo,context),...(hitInfo.nativeAttackHeight&&attackerSlot?{combatAttackHeightContext:{attackerRootY:context.sourceAttackOriginWorld?.y??attackerSlot.character.getSourceRootPosition().y,victimRootY:slot.character.getSourceRootPosition().y}}:{}),...(context.receivingRegions?{combatReceivingRegions:context.receivingRegions}:{}),...(context.contactCapsuleWorld?{combatContactCapsuleWorld:context.contactCapsuleWorld}:{}),...(context.collisionHitId===undefined?{}:{combatCollisionHitId:context.collisionHitId}), combatAttackerSlotIndex:attackerSlot?.playerIndex??null, combatViaSceneResolver:true,combatMoveId:context.moveId,combatSourcePoseId:attackerSlot?.character.getAttack(context.moveId)?.sourcePoseId??null, hitlagPlayers: this.playerSlots.length,
          attackerMinusVictimStocks: attackerSlot && this.activeMatchConfig.mode === 'stocks'
            ? this.stockTracker.getStocks(attackerSlot.playerIndex) - this.stockTracker.getStocks(slot.playerIndex)
            : 0,
          shieldKind: context.projectile ? 'projectile' : attackType === 'aerial' ? 'aerial'
            : attackType === 'smash' ? 'smash' : 'normal' };
        if (attackerSlot) {
          const finalReceipt = hitInfo.finalSmashRunId === undefined ? undefined : this.finalCombatReceipts.get(hitInfo.finalSmashRunId);
          const articleReceipt=context.attackInstance?this.linkArrowAttackReceipts.get(context.attackInstance):undefined;
          // A Beam may join its smash token after the body's first contact.
          // Adopt the cached receipt instead of adding a second queue entry.
          if(articleReceipt&&!articleReceipt.registered&&context.attackInstance&&attackStaleness.has(context.attackInstance)){
            articleReceipt.stale=attackStaleness.get(context.attackInstance)!;articleReceipt.registered=true;}
          const stale = finalReceipt?.stale ?? articleReceipt?.stale ?? (context.ignoreStaleMoves?1:(context.attackInstance
            ? attackStaleness.get(context.attackInstance) : undefined)
            ?? attackerSlot.character.getStaleMultiplier(staleMoveId));
          effectiveHit = applyCombatModifiers(effectiveHit, attackerSlot.character.getDamagePercent(), stale);
        }

        const heldBeforeHit=this.inventoriesByPlayerIndex.get(slot.playerIndex)?.getHeldItem();
        const holdingBeforeHit=heldBeforeHit
          ?{entity:heldBeforeHit,position:slot.character.getHeldItemWorldPosition(),
            resetGeneration:slot.character.getPositionResetGeneration()}:null;
        const attachedContact=context.contactCapsuleWorld;
        const passiveSweep=attachedContact?{from:attachedContact.start,to:attachedContact.end,projectile:{radius:attachedContact.radius},
          bodyContactFraction:this.sweptHurtboxContact(slot.character,attachedContact.start,attachedContact.end,attachedContact.radius)?.fraction}:context.contactSweepWorld;
        const suppliedPassive=context.passiveShieldReceipt;
        const passiveEligible=!slot.character.isInvincible()&&linkPassiveShieldCanIntercept({reflectable:effectiveHit.reflectable===true,
          isProjectile:context.projectile===true,unblockable:effectiveHit.unblockable===true},true);
        const passiveContact=passiveEligible&&suppliedPassive&&suppliedPassive.actorGeneration===slot.character.getPositionResetGeneration()&&
          slot.character.getLinkPassiveShieldWorldSurfaces().some(s=>s.id===suppliedPassive.surfaceId)?suppliedPassive:!context.sourceArticleSweepArbitrated&&passiveSweep&&!slot.character.isInvincible()&&
          linkPassiveShieldCanIntercept({reflectable:effectiveHit.reflectable===true,isProjectile:context.projectile===true,
            unblockable:effectiveHit.unblockable===true},true)?sweepLinkPassiveShield({
              surfacesWorld:slot.character.getLinkPassiveShieldWorldSurfaces(),...passiveSweep}):null;
        if(passiveContact)slot.character.notifyLinkPassiveShieldContact(effectiveHit);
        const hitApplication:ReturnType<Character['applyHitDetailed']> = passiveContact?{outcome:'shielded' as const,damageApplied:0,
          knockback:{vector:{x:0,y:0},magnitude:0,angle:0,hitstunFrames:0}}:slot.character.applyHitDetailed(effectiveHit);


        const finalPlayer = this.finalSmashController?.getPlayer(slot.playerIndex);
        if (finalPlayer?.ballStandby && hitApplication.outcome === 'landed' &&
          hitApplication.knockback.hitstunFrames > 0 && attackerSlot?.playerIndex !== slot.playerIndex &&
          rollHeldItemDrop(this.matchRng.stream('final-ball-drop'), hitInfo.baseDamage ?? hitInfo.damage, false) &&
          this.smashBallRuntime?.dropStandby(slot.playerIndex, slot.character.getPosition()))
          this.finalSmashController?.dropBall(slot.playerIndex);
        // A heavy item falls on the native carry damage check; a light item on its ceil(base damage)/70 roll
        // (an empty shooting item: base damage/2), drawn on its own `item-drop` stream (heldItemDrop.ts).
        if(holdingBeforeHit&&(holdingBeforeHit.entity.definition.heavy?(slot.character.id==='donkeykong'?hitApplication.heavyItemDrop!==undefined:hitApplication.outcome==='landed')
          :hitApplication.outcome==='landed'&&rollHeldItemDrop(this.matchRng.stream(ITEM_DROP_RNG_STREAM),hitInfo.damage,
            holdingBeforeHit.entity.isEmptyShooter())))
          this.dropHeldItemAfterDamage(slot,holdingBeforeHit,this.physicsEngine.getFrame());
        if (hitApplication.outcome === 'invulnerable') {
          // Source true invincibility registers contact without interrupting
          // the protected fighter. Ordinary direct attacker freezes once;
          // handler confirmation consumes the strike even after protection.
          if (attackerSlot && !context.projectile) attackerSlot.character.armAttackerHitlag(computeHitlag({
            damage: effectiveHit.damage, targetPercent: 0, multiplier: effectiveHit.hitlagMultiplier,
            players: effectiveHit.hitlagPlayers, electricCollision: effectiveHit.electricCollision,
          }));
          return { confirmed: true };
        }
        const hitResult = hitApplication.knockback;
        const consumed =
          hitApplication.outcome === 'landed' ||
          hitApplication.outcome === 'shielded' ||
          hitApplication.outcome === 'parried';
        if (!consumed) return { confirmed: false };
        // A reflected article is still physically managed by its original
        // spawner. Notify all managers by identity after ownership transfers.
        for (const actor of this.playerSlots) actor.character.notifyPikachuSpecialContact(context.attackInstance, hitApplication.outcome);
        if (attackerSlot) {
          attackerSlot.character.notifyIntrinsicSourceContact(context.moveId,hitApplication.outcome,slot.playerIndex,context.attackInstance);
          const finalReceipt = hitInfo.finalSmashRunId === undefined ? undefined : this.finalCombatReceipts.get(hitInfo.finalSmashRunId);
          const articleReceipt=context.attackInstance?this.linkArrowAttackReceipts.get(context.attackInstance):undefined;
          if (!context.ignoreStaleMoves && (finalReceipt ? !finalReceipt.registered : articleReceipt?!articleReceipt.registered:
            (!context.attackInstance || !attackStaleness.has(context.attackInstance)))) {
            if (finalReceipt) { finalReceipt.stale = attackerSlot.character.getStaleMultiplier(staleMoveId); finalReceipt.registered = true; }
            if(articleReceipt){articleReceipt.stale=attackerSlot.character.getStaleMultiplier(staleMoveId);articleReceipt.registered=true;}
            if (context.attackInstance) attackStaleness.set(context.attackInstance,
              attackerSlot.character.getStaleMultiplier(staleMoveId));
            attackerSlot.character.registerLandedMove(staleMoveId, hitApplication.outcome !== 'landed');
          }
          if (hitApplication.outcome === 'landed') {
            this.cpuControllers.get(attackerSlot.playerIndex)?.registerLandedHit(
              attackerSlot.character.getAttack(context.moveId)?.type ?? 'jab', slot.character.getDamagePercent(),
            );
          }
        }

        // Shield pushback — when a raised shield absorbs a normal hit, the
        // attacker bounces back in the opposite direction of their attack.
        // Skipped when the shield just broke (attacker is rewarded with a
        // free punish window) or when the hit was unblockable (command grab).
        if (
          hitApplication.outcome === 'shielded' &&
          hitResult.magnitude === 0 &&
          !effectiveHit.unblockable &&
          !slot.character.isShieldBroken() &&
          attackerSlot && !context.projectile
        ) {
          if (effectiveHit.shieldSetoffMultiplier !== undefined) {
            attackerSlot.character.armShieldBlockRecoil(
              effectiveHit.damage, effectiveHit.shieldKind, slot.character.getPosition().x,
            );
          } else {
            const vel = attackerSlot.character.getVelocity();
            const pushDir = -(effectiveHit.facing); // opposite of attack direction
            this.physicsWorld.body.setVelocity(attackerSlot.character.body, {
              x: vel.x + pushDir * 3.0,
              y: vel.y,
            });
          }
        }

        // Direct shield contacts freeze both participants. Release parries
        // have distinct attacker/victim durations; detached projectiles
        // leave their owner free. Flesh-hit attacker freeze is computed
        // separately below because crouching only shortens the victim's.
        const contactFreeze = slot.character.getHitlagRemaining();
        if (attackerSlot && hitApplication.parryKind === 'shield') {
          const freeze = computeShieldParryHitlag({ damage: effectiveHit.damage,
            targetPercent: 0, multiplier: effectiveHit.hitlagMultiplier, players: effectiveHit.hitlagPlayers,
            electricCollision: effectiveHit.electricCollision, projectile: context.projectile === true,
            direct: effectiveHit.direct },
          context.projectile === true);
          attackerSlot.character.armAttackerHitlag(freeze.attacker);
        }
        if (attackerSlot && !context.projectile && hitApplication.outcome === 'shielded') {
          attackerSlot.character.armAttackerHitlag(contactFreeze);
        }

        // ---- Sub-AC 1 + Sub-AC 3 of AC 16: feed stats ledger -----------
        // Credit the attacker for the (post-stale) damage actually dealt
        // and arm the matching contact freeze. Self-hits are filtered
        // upstream; a non-roster ownerId resolves to no slot and is
        // silently skipped (environmental damage is uncredited).
        if (attackerSlot && hitApplication.outcome === 'landed') {
          if (!context.projectile) attackerSlot.character.armAttackerHitlag(computeHitlag({
            damage: effectiveHit.damage, targetPercent: 0, multiplier: effectiveHit.hitlagMultiplier,
            players: effectiveHit.hitlagPlayers, electricCollision: effectiveHit.electricCollision,
          }));
          this.matchStatsTracker.recordDamage(
            attackerSlot.playerIndex,
            slot.playerIndex,
            hitApplication.damageApplied,
            this.physicsEngine.getFrame(),
          );
        }
        if (attackerSlot && !context.projectile) {
          attackerSlot.character.applyAerialRebound(context.attackInstance, hitApplication.outcome);
        }

        // ---- AC 10304: connect-on-hit SFX ------------------------------
        // The CONNECT cue (distinct from the SWING cue the Character
        // fires when its hitbox spawns): a damage-scaled pop / thud the
        // frame a hit actually lands on a defender, with a metallic clang
        // when the attacker is swinging a held melee weapon. Skipped when
        // the defender was shielding (the block's shield / shatter cue
        // already covers that contact). Routed through the same SFX
        // AudioManager the fighters use; `emitCombatSfx` swallows any
        // backend error so a bad cue can never break the hit pipeline.
        // This is a render-side presentation effect reading resolved sim
        // state — it never feeds back into the deterministic step.
        if (hitApplication.outcome === 'landed') {
          const attackerHeld = attackerSlot
            ? this.inventoriesByPlayerIndex
                .get(attackerSlot.playerIndex)
                ?.getHeldItem()
            : null;
          const heldWeapon =
            attackerHeld?.definition.itemClass === 'battering';
          const connectKey = mapHitConnectToSfxKey({
            damage: hitApplication.damageApplied,
            heldWeapon,
          });
          this.simEvents.push({ kind: 'sfx', key: connectKey });
        }

        // ---- Hit-feedback FX: spawn a hit spark at the contact point ----
        // The visible "we connected" cue. Spawned the exact frame the
        // hit resolves (right after `applyHit`) so the burst is frame-
        // accurate. Contact point: the midpoint between the attacker's
        // live hitbox sensor centre and the target's body, biased toward
        // the target so the burst reads as landing ON the defender. The
        // shard-scatter seed is the simulated frame plus the attacker's
        // slot index — a deterministic integer (NOT a `Math.random()`
        // read) so a replayed match paints identical sparks. World-camera
        // partitioned (the pool's GameObjects keep scrollFactor 1).
        if (hitApplication.outcome === 'landed') {
          const sparkFrame = this.physicsEngine.getFrame();
          const targetPos = slot.character.getPosition();
          let contactX = targetPos.x;
          let contactY = targetPos.y;
          const attackerActive = attackerSlot?.character.getActiveAttack();
          if (attackerActive && !context.projectile) {
            const center = computeHitboxCenter(
              attackerSlot!.character.getPosition(),
              attackerActive.move,
              attackerActive.facing,
            );
            // Bias 60% toward the defender so the pop sits on the body
            // that just took the hit, not floating in front of the swing.
            contactX = center.x + (targetPos.x - center.x) * 0.6;
            contactY = center.y + (targetPos.y - center.y) * 0.6;
          }
          this.simEvents.push({ kind: 'hit', frame: sparkFrame, x: contactX, y: contactY,
            damage: hitApplication.damageApplied, seed: sparkFrame + (attackerSlot?.playerIndex ?? 0) });
        }
        return { confirmed: true, reactionApplied: hitApplication.outcome === 'landed' };
      };
this.hitboxDamageHandler = new HitboxDamageHandler(this.resolveCombatHit);
const clanks = new AttackClankHandler({
      frame: () => this.physicsEngine.getFrame(), players: () => this.playerSlots.length,
      isCurrent: (sensor, plugin) => {
        const active = this.playerSlots.find(slot => slot.character.body.id === plugin.ownerBodyId)?.character.getActiveAttack();
        return active?.hitboxBody === sensor && ['jab', 'tilt', 'smash', 'aerial'].includes(active.move.type);
      },
      damage: (plugin, row) => {
        const owner = this.playerSlots.find(slot => slot.character.body.id === plugin.ownerBodyId)?.character;
        const stale = (plugin.attackInstance ? attackStaleness.get(plugin.attackInstance) : undefined)
          ?? owner?.getStaleMultiplier(plugin.staleMoveId ?? plugin.moveId) ?? 1;
        return (row?.damage ?? plugin.damage) * stale;
      },
      rebound: (ownerBodyId, freeze, recovery) =>
        this.playerSlots.find(slot => slot.character.body.id === ownerBodyId)?.character.applyAttackClank(freeze, recovery),
    });
this.hitboxDamageHandler.setAttackClankHooks(
      () => clanks.sampleBodies(this.physicsWorld.world.getAllBodies()),
      (sensor, targetBodyId) => clanks.canHit(sensor, targetBodyId));
this.hitboxDamageHandler.setGroundedLookup(index => this.playerSlots[index]?.character.isGrounded() ?? false);
this.hitboxDamageHandler.setFacingLookup(index => this.playerSlots[index]?.character.getFacing() ?? 1);
this.hitboxDamageHandler.setRehitClockLookup((ownerBodyId, sensor) => {
      if (ownerBodyId === undefined) return null;
      const owner = this.playerSlots?.find(slot => slot.character.body.id === ownerBodyId);
      const active = owner?.character.getActiveAttack();
      if (!active || active.hitboxBody !== sensor || active.move.type !== 'aerial' ||
          !('rehitClockPolicy' in active.move) || active.move.rehitClockPolicy !== 'authored-attack-elapsed') return null;
      return active.framesElapsed;
    });
this.hitboxDamageHandler.registerPlayer(0, this.p1.body);
this.hitboxDamageHandler.registerPlayer(1, this.p2.body);
for (let i = 0; i < this.extraFighters.length; i += 1) {
      this.hitboxDamageHandler.registerPlayer(i + 2, this.extraFighters[i]!.body);
    }
this.hitboxDamageHandler.setHurtboxLookup((targetIndex) => {
      const slot = this.playerSlots?.[targetIndex];
      if (!slot) return null;
      return slot.character.getActiveHurtboxes();
    });
this.hitboxDamageHandler.setActiveShieldLookup(targetIndex=>this.playerSlots[targetIndex]?.character.getSourceShieldBubble()??null);
const matchEndPlayerNames: string[] = [
      getCharacterSpec(this.p1.id).displayName,
      getCharacterSpec(this.p2.id).displayName,
    ];
for (const fighter of this.extraFighters) {
      matchEndPlayerNames.push(getCharacterSpec(fighter.id).displayName);
    }
this.matchEndDetector = new MatchEndDetector(this.stockTracker, {
      detectStockElimination: false,
      endingDurationFrames: DEFAULT_ENDING_DURATION_FRAMES,
      playerNames: matchEndPlayerNames,
      stageName:
        this.activeStage.id === 'lava'
          ? 'Lava Stage'
          : this.activeStage.id === 'wind'
            ? 'Wind Stage'
            : this.activeStage.id === 'crumbling'
              ? 'Crumbling Stage'
              : this.activeStage.id === 'moving-platform'
                ? 'Moving Platform'
                : this.activeStage.id === 'flat' ? 'Flat Stage' : this.activeStage.id,
      // Sub-AC 3 of AC 16 — hand the stats ledger to the detector so
      // the freeze-time `enterEnding` snapshot finalises survival
      // frames on the canonical match-end frame and freezes the
      // per-player stats panel onto the result payload that's handed
      // to `ResultsScene`. Without this wire, the results screen
      // would render the stocks block but skip the post-match stats
      // panel entirely.
      statsTracker: this.matchStatsTracker,
    });
if (this.baseStage.lavaCollisionWatcher || this.baseStage.windForceController) {
      this.baseStage.registerPlayer(0, this.p1.body);
      this.baseStage.registerPlayer(1, this.p2.body);
      for (let i = 0; i < this.extraFighters.length; i += 1) {
        this.baseStage.registerPlayer(i + 2, this.extraFighters[i]!.body);
      }
    }
this.collisionStartHandler = (event) => {
      this.blastZoneWatcher.handleCollisionStart(event);
      this.hitboxDamageHandler.handleCollisionStart(event);
      // AC 20101 Sub-AC 1 — fan out to every hazard adapter the
      // active stage owns in one call. No-op on hazard-free stages.
      this.baseStage.handleCollisionStart(event);
    };
this.physicsWorld.world.on('collisionstart', this.collisionStartHandler);
this.hitboxCollisionActiveHandler = (event) => {
      this.hitboxDamageHandler.handleCollisionStart(event);
    };
this.physicsWorld.world.on('collisionactive', this.hitboxCollisionActiveHandler);
if (this.baseStage.needsCollisionEndChannel()) {
      this.collisionEndHandler = (event) => {
        // AC 20101 Sub-AC 1 — same fan-out for the `collisionend`
        // channel. Subscribed only when the stage actually carries
        // hazards that need it (lava + wind), so non-hazard stages
        // pay no listener cost.
        this.baseStage.handleCollisionEnd(event);
      };
      this.physicsWorld.world.on('collisionend', this.collisionEndHandler);
    }
this.passThroughPlatformHandler = () => this.updatePassThroughPlatformMasks();
this.physicsWorld.world.on('beforeupdate', this.passThroughPlatformHandler);
this.fighterSeparationHandler = () => {
      if (!this.coordinatingPhysicsStep) this.updateFighterSeparation();
    };
this.physicsWorld.world.on('afterupdate', this.fighterSeparationHandler);
this.playerSlots = [this.p1,this.p2,...this.extraFighters].map((character,playerIndex)=>{
    const spawn=this.activeStage.spawnPoints[playerIndex];
    return {playerIndex,character,spawnX:spawn?toViewportX(spawn.x):0,spawnY:spawn?toViewportY(spawn.y):0,
      faceOnSpawn:(playerIndex%2===0?1:-1) as 1|-1,bindingsSlot:(playerIndex+1) as PlayerBindingsIndex};
  });
const damageTakenMultiplier = oneOnOneDamageTakenMultiplier(this.activeMatchConfig);
for (const slot of this.playerSlots) slot.character.setDamageTakenMultiplier(damageTakenMultiplier);
this.cpuControllers.clear();
for (const participant of this.matchParticipants) {
      if (participant.slot.inputType !== 'ai') continue;
      const index = participant.runtimePlayerIndex;
      const seed = this.activeMatchConfig.rngSeed ^ Math.imul(participant.slot.index, 0x9e3779b9);
      this.cpuControllers.set(index, new LiveCpuController(index, participant.slot.aiDifficulty ?? 'medium', seed));
    }
const sfxSink = { playSfx: (key: string) => this.simEvents.push({ kind: 'sfx', key }) };
for (const slot of this.playerSlots) slot.character.setSfxSink(sfxSink);
const tripRng = this.matchRng.stream('combat-trip');
for (const slot of this.playerSlots) slot.character.setTripRandomSource(() => tripRng.next());
this.ledgeCandidatesByStage = this.baseStage.getLedgeCandidates();
for (const slot of this.playerSlots) {
      slot.character.setLedgeCandidates(this.ledgeCandidatesByStage);
    }
this.respawnHandler = new RespawnHandler();
for (const slot of this.playerSlots) {
      this.respawnHandler.registerSlot(
        {
          playerIndex: slot.playerIndex,
          spawnX: slot.spawnX,
          spawnY: slot.spawnY,
          faceOnSpawn: slot.faceOnSpawn,
        },
        slot.character,
      );
    }
this.respawnHandler.onRespawn((event) => {
      // Re-arm the position-based KO detector. The handler's teleport
      // call has already put the body back inside the stage, so the
      // per-tick scan should consider subsequent boundary crossings
      // as fresh KOs.
      this.blastZonePositionWatcher.clearOutOfBounds(event.playerIndex);
      this.cpuControllers.get(event.playerIndex)?.reset();
      this.playerSlots.find(slot=>slot.playerIndex===event.playerIndex)?.character.beginPikachuRespawnPresentation();
    });
const bindingsStore = this.options.runtimeBindingsStore ?? createMatchBindingsStore(this.matchParticipants);
this.finalBindingsStore = bindingsStore;
if(history){const saved=deserializeBindingsSnapshot(history.bindingsSnapshot);
      for(const index of [1,2,3,4] as const)bindingsStore.set(index,saved[index]);}
this.inputCaptureBuffer = new InputCaptureBuffer({
      playerCount: resolvedPlayerCount,
    });
if(this.activeMatchConfig.linkIntroPolicy===undefined&&this.playerSlots.some(slot=>slot.character.id==='link')){
      this.activeMatchConfig={...this.activeMatchConfig,linkIntroPolicy:'source-entry-121'};
      this.launchData={...this.launchData,matchConfig:this.activeMatchConfig};
    }
this.matchStartMetadata = buildMatchStartMetadata({
      matchConfig: this.activeMatchConfig,
      engineVersion: this.buildIdentity,
      fixedTimestepMs: this.physicsEngine.fixedTimestepMs,
      ...(history?{nowFactory:()=>new Date(history.replay.metadata.recordedAt)}:{}),
    });
this.recordingController = new RecordingController({
      buffer: this.inputCaptureBuffer,
      itemSpawnEventLog: this.itemSpawnEventLog,
      fixedTimestepMs: this.physicsEngine.fixedTimestepMs,
      engineVersion: this.matchStartMetadata.engineVersion,
      // Lock the controller's wall-clock factory to the match-start
      // timestamp so the recorded `metadata.recordedAt` reflects when
      // the match BEGAN, not when the player pressed save. The
      // metadata snapshot's `startedAt` is the canonical source.
      nowFactory: () => new Date(this.matchStartMetadata.startedAt),
    });
if (data?.labMode) {
      this.recordingStopped = true;
    } else {
      this.recordingController.start({ matchConfig: this.activeMatchConfig });
      this.recordingStopped = false;
    }
this.itemSpawnManager = new ItemSpawnManager({
      frequency: resolveItemFrequency(this.activeMatchConfig.itemFrequency),
      anchors: this.activeStage.itemSpawnAnchors ?? [],
      rng: this.matchRng,
    });
this.finalSmashController = new FinalSmashController(
      parseFinalSmashRules(this.activeMatchConfig.finalSmashRules ?? NEW_MATCH_FINAL_RULES),
      this.playerSlots.map(slot => ({ playerIndex: slot.playerIndex, fighter: slot.character.id,
        generation: slot.character.getPositionResetGeneration() })));
this.finalDamageReceiptSequence = 0;
for(const slot of this.playerSlots)slot.character.setCombatPercentReceiptSink(event=>{
      this.finalSmashController?.damageReceipt({id:`combat-${++this.finalDamageReceiptSequence}`,frame:this.physicsEngine.getFrame(),
        // Self-explosive received credit is real; same-owner dealt credit is
        // separate source selection, currently conservatively uncredited.
        attacker:event.attackerSlotIndex===slot.playerIndex?null:event.attackerSlotIndex,
        victim:slot.playerIndex,appliedPercent:event.damageApplied,recoil:event.recoil});
      if(!event.viaSceneResolver&&event.attackerSlotIndex!==null&&event.attackerSlotIndex!==slot.playerIndex)
        this.matchStatsTracker.recordDamage(event.attackerSlotIndex,slot.playerIndex,event.damageApplied,this.physicsEngine.getFrame());
    });
this.smashBallRuntime = new SmashBallRuntime(0, data?.labMode === true);
this.finalSpecialHeld.clear();
this.finalCombatReceipts.clear();
this.finalCameraAnchor = null;
this.linkArticles.reset();
this.finalVictimFitDependencies.clear();
this.linkArrowCombatReceipts.clear();
this.linkArrowVolleyTokens.clear();
this.linkArrowAttackReceipts = new WeakMap();
this.finalAppliedRoots.clear();
for (const label of ['final-ball-spawn', 'final-ball-variant', 'final-ball-motion', 'final-ball-drop']) this.matchRng.stream(label);
this.createFinalChoreography();
this.beginSourceIntro();
if(history&&JSON.stringify(this.activeStage)!==history.stageIdentity)
      throw new Error('Resolved stage differs from the checkpoint construction');
for(const slot of this.playerSlots){const actor=slot.character,setPosition=actor.setPosition.bind(actor);
      actor.setPosition=(x:number,y:number)=>{
        const construction=this.physicsEngine.getFrame()===0&&this.inputCaptureBuffer.isEmpty();
        if(construction){
          if((this.sourceIntro?.frame??0)>0)this.historyConstructionError='Position changed inside an already advancing intro';
          if(this.historyConstructionPositions.length>=64)this.historyConstructionError='Construction event limit exceeded';
          else this.historyConstructionPositions.push({playerIndex:slot.playerIndex,x,y});
        }
        setPosition(x,y);
        // Supported construction placement resets the real actor generation.
        // Keep the already-created Final participant at that same identity;
        // history replays this exact hook before its first recorded input.
        if(construction)this.consumeFinalEvents(this.finalSmashController?.resetParticipant(slot.playerIndex,
          actor.getPositionResetGeneration(),'owner-reset',0)??[],0);
      };
    }
if(history){
      for(const p of history.constructionPositions)this.playerSlots.find(slot=>slot.playerIndex===p.playerIndex)!.character.setPosition(p.x,p.y);
      
}
}

public historyRestore:MatchHistoryCheckpoint|null=null;

public historyRestoreStatus:'idle'|'reconstructing'|'ready'|'failed'='idle';

setRecordedInputs(timeline: ReadonlyArray<CapturedFrame> | null): void {
    this.recordedInputs = timeline && new Map(timeline.map(entry => [entry.frame, entry.inputs] as const));
  }

public historyConstructionPositions:MatchHistoryCheckpoint['constructionPositions'][number][]=[];

public historyConstructionError:string|null=null;

public clearSourceScreenKo():void{this.sourceScreenKo.clear();this.acceptedStockLossFrames.clear();}

public acceptedStockLossFrames=new Map<number,number>();

public sourceIntro:{frame:number;accumulatorMs:number;participants:readonly number[]}|null=null;

public pausedForMenu = false;

public initialiseMatchSeed(data:MatchSimData|undefined):void {
 const {seed,rng}=initialiseMatchRngFromConfig({rngSeed:data?.matchConfig?.rngSeed ?? data?.rngSeed ?? GAME_CONFIG.defaultRngSeed},GAME_CONFIG.defaultRngSeed);
 this.matchRng=rng;this.matchRngSeed=seed;
 }

public matchRngSeed!: number;

public historyConstructionViewport={width:0,height:0};

public activeStage!: StageLayout;

public recordStockLossWithStats(
    playerIndex: number,
    frame: number,
  ): ReturnType<StockTracker['loseStock']> {
    const protectedFinal = this.playerSlots?.find(slot => slot.playerIndex === playerIndex)?.character.isFinalSmashNoDead();
    if (protectedFinal) return { playerIndex, stocksRemaining: this.stockTracker.getStocks(playerIndex), eliminated: false, respawnFrame: -1 };
    const wasActive = !this.stockTracker.isEliminated(playerIndex) && !this.stockTracker.isRespawning(playerIndex);
    const event = this.stockTracker.loseStock(playerIndex, frame);
    if (wasActive) {
      const actor=this.playerSlots.find(slot=>slot.playerIndex===playerIndex)?.character,eating=actor?.getEatingState();
      const temporary=eating?this.itemRegistry.findById(eating.itemId):null;
      if(actor&&eating&&temporary&&!temporary.isDespawned()&&temporary.spawnedAtFrame===eating.entityGeneration&&
        eating.actorGeneration===actor.getPositionResetGeneration()&&temporary.getHolderPlayerIndex()===playerIndex&&
        this.inventoriesByPlayerIndex.get(playerIndex)?.getHeldItem()!==temporary)this.removeItem(temporary,frame);
      actor?.discardItemRecoveryOnStock();this.pendingRecoveryEvents=this.pendingRecoveryEvents.filter(row=>row.playerIndex!==playerIndex);
      this.acceptedStockLossFrames.set(playerIndex,frame);
      const fighter=this.playerSlots.find(slot=>slot.playerIndex===playerIndex)?.character;
      const held=this.inventoriesByPlayerIndex.get(playerIndex)?.getHeldItem();
      // Engine lifecycle policy: a stock loss retires the currently held heavy
      // object directly, independently of voluntary-drop restrictions. Free
      // objects belonging to this player retain their existing trajectories.
      if(held?.definition.heavy||held?.definition.generated)this.removeItem(held,frame);
      this.donkeykongHeavyItemRequests.delete(playerIndex);
      this.itemPickupRequests.delete(playerIndex);
      fighter?.interruptHeavyItemCarry();
      fighter?.interruptSourceReceivingOnStockLoss();
      fighter?.interruptPikachuSpecialAction();
      this.matchStatsTracker.recordStockLoss(playerIndex, frame);
      if (fighter) {
        fighter.setFinalSmashControl(null);
        this.smashBallRuntime?.consumeOrRetireStandby(playerIndex, frame);
        const scores = this.matchRules.getScores(frame);
        const retention = this.activeMatchConfig.mode === 'stocks' || this.matchRules.isSuddenDeath()
          ? finalMeterStockRetentionRatio(this.stockTracker.getStocks(playerIndex), this.playerSlots
            .filter(other => other.playerIndex !== playerIndex && !this.stockTracker.isEliminated(other.playerIndex))
            .map(other => this.stockTracker.getStocks(other.playerIndex)))
          : this.playerSlots.some(other => other.playerIndex !== playerIndex &&
              !this.stockTracker.isEliminated(other.playerIndex) && scores[other.playerIndex]! > scores[playerIndex]!) ? .9 : .6;
        // Selected net-KOs comparator after stats attribution; Wiki ratios are approximate.
        this.consumeFinalEvents(this.finalSmashController?.resetParticipant(playerIndex,
          fighter.getPositionResetGeneration() + 1, 'owner-stock-loss', retention) ?? [], frame);
      }

      if (event.eliminated) {
        this.matchStatsTracker.recordElimination(playerIndex, frame);
      }
      // AC 10304 — voice the trademark Smash "blast" KO cue on every
      // REAL stock loss. Gated on the same `stocksRemaining < before`
      // branch the stats ledger uses, so a duplicate blast-zone
      // collision on a body lingering past the boundary (a no-op
      // `loseStock`) can't double-fire the boom. Routed through the
      // scene's SFX AudioManager; `emitCombatSfx` swallows any backend
      // error. This call sits in the deterministic stock-loss path but
      // the audio it requests is a pure side-effect that never alters
      // the StockTracker / replay state.
      this.simEvents.push({ kind: 'sfx', key: ASSET_KEYS.sfxKo });
    }
    return event;
  }

public resolveActiveMatchConfig(data: MatchSimData | undefined): MatchConfig {
    if (data?.matchConfig) {
      // Re-emit with the resolved seed so the replay header reflects
      // what the live RNG was actually built from (the menu may have
      // passed a finite-but-unclamped seed; `initialiseMatchSeed`
      // clamped it).
      return Object.freeze({
        ...data.matchConfig,
        players: maskPlayerSlots(data.matchConfig.players),
        rngSeed: this.matchRngSeed,
      });
    }
    // M1-scaffold default: 2P keyboard match, Wolf vs Cat, 3 stocks,
    // Flat Stage. Mirrors the actual subsystems wired up above.
    const players: PlayerSlot[] = [
      Object.freeze({
        index: 1,
        characterId: 'donkeykong',
        paletteIndex: 0,
        inputType: 'keyboard_p1',
      }) as PlayerSlot,
      Object.freeze({
        index: 2,
        characterId: 'pikachu',
        paletteIndex: 0,
        inputType: 'keyboard_p2',
      }) as PlayerSlot,
    ];
    return Object.freeze({
      mode: 'stocks',
      stockCount: DEFAULT_STOCK_COUNT,
      // Use whichever stage was actually resolved at scene-create
      // time so the synthesised config matches the live geometry.
      // Falls back to FLAT_STAGE when the scene starts before
      // `activeStage` is initialised (e.g. in a test fixture that
      // synthesises the config independently).
      stageId: this.activeStage?.id ?? FLAT_STAGE.id,
      players: Object.freeze(players),
      rngSeed: this.matchRngSeed,
    });
  }

public matchParticipants!: ReadonlyArray<MatchParticipant>;

public launchData!: MatchSimData;

public sourceShieldContactReceipt(actor:Character,hit:HitInfo,context:Parameters<MatchSim['resolveCombatHit']>[2]):HitInfo['combatShieldContact'] {
    const bubble=hit.unblockable?null:actor.getSourceShieldBubble();if(!bubble)return undefined;
    const receipt={actorGeneration:bubble.actorGeneration,centre:{...bubble.centre},radius:bubble.radius},given=context.activeShieldReceipt;
    if(given&&given.actorGeneration===receipt.actorGeneration&&given.centre.x===receipt.centre.x&&
      given.centre.y===receipt.centre.y&&given.radius===receipt.radius)return receipt;
    const target:SourceSweepTarget={kind:'capsule',start:bubble.centre,end:bubble.centre,radius:bubble.radius};
    if(context.contactCapsuleWorld&&capsulesIntersect(context.contactCapsuleWorld,target))return receipt;
    if(context.contactBoundsWorld&&capsuleIntersectsBounds(target,{x:0,y:0},1,context.contactBoundsWorld))return receipt;
    const circle=context.contactCircleSweepWorld;
    if(circle&&sweepTranslatedSourceShape({from:circle.from,to:circle.to,shape:{kind:'capsule',start:{x:0,y:0},end:{x:0,y:0},radius:circle.radius},target}))return receipt;
    const rectangle=context.contactSweepWorld;
    if(rectangle&&sweepTranslatedSourceShape({from:rectangle.from,to:rectangle.to,shape:{kind:'rectangle',
      offsetX:0,offsetY:0,width:rectangle.projectile.width,height:rectangle.projectile.height},target}))return receipt;
    return undefined;
  }

public collisionStartHandler:
    | ((event: BlastZoneCollisionEvent & HitboxCollisionEvent) => void)
    | null = null;

public hitboxCollisionActiveHandler:
    | ((event: HitboxCollisionEvent) => void)
    | null = null;

public collisionEndHandler:
    | ((event: LavaCollisionEvent | WindCollisionEvent) => void)
    | null = null;

public passThroughPlatformHandler: (() => void) | null = null;

public updatePassThroughPlatformMasks(): void {
    const platforms = this.baseStage?.bodies?.platformBodies;
    if (!platforms) return;
    const fighters: Character[] = [this.p1, this.p2, ...this.extraFighters].filter(
      (f): f is Character => f !== undefined && f !== null,
    );

    // Snapshot current feet positions once so every platform iterates
    // against the same baseline; commit to prevFeet *after* the loop
    // so prevFeet always reflects the previous step.
    // Matter bounds include velocity expansion for broad-phase detection.
    // Feet history and landing CCD need the current contact geometry, including
    // after a grounded landing changes velocity before the next world step.
    const geometricFeetY = (fighter: Character): number => {
      const vertices = fighter.body.vertices;
      return vertices?.length
        ? Math.max(...vertices.map(vertex => vertex.y))
        : fighter.getBodyBottomY();
    };
    const currentFeet = new Map<Character, number>();
    for (const fighter of fighters) {
      const generation = fighter.getPositionResetGeneration();
      if (this.prevFighterPositionGeneration.get(fighter) !== generation) {
        this.prevFighterFeetY.delete(fighter);
        this.passThroughLandingGrace.delete(fighter);
        this.prevFighterPositionGeneration.set(fighter, generation);
      }
      currentFeet.set(fighter, geometricFeetY(fighter));
    }
    // 4 px epsilon for the feet-vs-top compare (rejects a fighter
    // standing on the platform from the "below" branch); 2 px for
    // the horizontal-overlap padding so a body grazing the edge
    // isn't borderline-counted.
    const FEET_EPS = 4;
    const X_EPS = 2;
    // Vertical band around a platform's top within which, while we hold the
    // fighter SOLID and it is descending, we tell the fighter to suppress its
    // per-fighter fall-accel for the next step (`markPlatformFallSupported`).
    // Covers the ~15 px the body can be ejected above a thin float during a
    // landing wobble so the fall speed can't re-spike and tunnel back through.
    // Kept tight so a fighter merely passing high above a platform is
    // unaffected — free-fall feel only changes within this landing band.
    const SUPPORT_BAND = 20;

    for (const body of platforms) {
      const isPassThrough = body.label === PLATFORM_LABELS.passThrough;
      const isPlatform =
        isPassThrough || body.label === PLATFORM_LABELS.solid;
      if (!isPlatform) continue;
      const filter = body.collisionFilter;
      // Crumble adapter writes mask=0 for the lifecycle 'falling' /
      // 'gone' states. Skip — we must not resurrect a fallen platform
      // (and must not landing-assist onto one).
      if (filter.mask === 0) continue;
      const platBounds = body.bounds;
      const platTop = platBounds?.min?.y ?? body.position.y;
      const platBottom = platBounds?.max?.y ?? body.position.y;
      const platLeft = platBounds?.min?.x ?? body.position.x;
      const platRight = platBounds?.max?.x ?? body.position.x;

      let mask = 0;
      for (const fighter of fighters) {
        const slotBit = CHARACTER_SLOT_BITS[fighter.slotIndex];
        if (slotBit === undefined) continue;
        let grace = this.passThroughLandingGrace.get(fighter);
        if (fighter.isSourceTerrainBypassControlled()) { grace?.clear(); continue; }

        const fLeft = fighter.getBodyLeftX();
        const fRight = fighter.getBodyRightX();
        const overlapsX = fRight >= platLeft - X_EPS && fLeft <= platRight + X_EPS;
        const feet = currentFeet.get(fighter)!;
        // First-step fallback: missing prev sample collapses to the
        // current sample. A freshly-spawned fighter standing on the
        // platform reads "was at top, is at top" = solid; one spawned
        // below reads "was below, is below" = phased.
        const prevFeet = this.prevFighterFeetY.get(fighter) ?? feet;
        const feetBelowTop = feet > platTop + FEET_EPS;
        const prevTop = this.prevPlatformTopY.get(body) ?? platTop;
        const prevFeetBelowTop = prevFeet > prevTop + FEET_EPS;

        // Masks must anticipate entry into the column during this physics
        // step. A fast diagonal launch can start outside it and reach the
        // platform's side/underside before the next outer mask update.
        // Below-top or deliberate-drop approaches therefore stay phased
        // even outside the column; approaches from above remain solid.
        // Landing grace is stale outside the column, and no surface here
        // can support the fighter's fall until there is actual overlap.
        if (!overlapsX) {
          grace?.delete(body.id);
          if (
            !isPassThrough ||
            (!feetBelowTop && !fighter.isInDropThroughWindow())
          ) {
            mask |= slotBit;
          }
          continue;
        }

        if (isPassThrough && fighter.isInDropThroughWindow()) {
          // Phase — drop this slot bit. A deliberate drop-through
          // cancels any in-flight landing grace for this platform.
          grace?.delete(body.id);
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'dropWindow',
            currentFeet.get(fighter)!,
            this.prevFighterFeetY.get(fighter) ?? currentFeet.get(fighter)!,
            platTop, fighter.getVelocity().y, mask,
          );
          continue;
        }

        // ---- Landing assist (CCD for thin platforms) ----------------
        // A genuine falling crossing — feet above the top last step,
        // below it now, still moving downward. At Smash-feel fall
        // speeds (11-20 px/step) the crossing step can bury the feet
        // PAST the mid-plane of a 22-24 px float, and Matter resolves
        // overlap along the SHORTEST exit — ejecting the fighter
        // downward THROUGH the platform instead of up onto it,
        // sub-pixel-dependent (the "sometimes lands, sometimes falls
        // through" coin flip). Don't gamble on the solver: snap the
        // body up so the feet rest 1 px into the surface and kill the
        // fall velocity — the standard platform-fighter landing
        // resolution. Applies to BOTH pass-through floats and thin
        // solid carriers; purely simulation-state-driven, replay-safe.
        // Solid bodies only qualify when THIN (≤ 48 px — the moving
        // carriers): thick grounds resolve fine on their own (the
        // penetration can never reach their mid-plane), and custom-
        // stage SLOPES are solid rotated bodies whose bounding-box top
        // is not their walking surface — snapping to it would teleport
        // the fighter uphill.
        const assistEligible =
          isPassThrough || platBottom - platTop <= 48;
        if (
          assistEligible &&
          feetBelowTop &&
          !prevFeetBelowTop &&
          fighter.getVelocity().y >= 0
        ) {
          const lift = feet - (platTop + 1);
          const pos = fighter.getPosition();
          // Body.setPosition rebuilds bounds using the current velocity.
          // Clear the fall first so the snapped feet/history aren't still
          // expanded downward by the old high-speed landing velocity.
          this.physicsWorld.body.setVelocity(fighter.body, {
            x: fighter.getVelocity().x,
            y: 0,
          });
          this.physicsWorld.body.setPosition(fighter.body, {
            x: pos.x,
            y: pos.y - lift,
          });
          grace?.delete(body.id);
          mask |= slotBit;
          // We just resolved this fighter's landing onto the float — hold its
          // fall-accel off next step so it settles instead of re-spiking and
          // tunnelling back through (the pass-through platform jitter).
          fighter.markPlatformFallSupported();
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'assistSnap',
            feet, prevFeet, platTop, 0, mask,
          );
          continue;
        }

        if (!isPassThrough) {
          // Solid platforms never phase — the landing assist above is
          // the only per-fighter work they need.
          continue;
        }

        if (!feetBelowTop) {
          // At or above the top — standing / falling toward it. Solid;
          // any prior landing grace has resolved.
          grace?.delete(body.id);
          mask |= slotBit;
          // Descending onto / resting just above the surface within the
          // landing band: suppress fall-accel next step so a contact flicker
          // can't ramp the fall speed back up and tunnel the body through.
          if (
            fighter.getVelocity().y >= 0 &&
            Math.abs(feet - platTop) <= SUPPORT_BAND
          ) {
            fighter.markPlatformFallSupported();
          }
          if (Math.abs(feet - platTop) < 60) {
            this.recordPlatDiag(
              body.id, fighter.slotIndex, 'solidAbove',
              feet, prevFeet, platTop, fighter.getVelocity().y, mask,
            );
          }
          continue;
        }

        if (!prevFeetBelowTop) {
          // CROSSING FRAME while moving upward (the landing assist
          // above handles the downward case) — e.g. clipped while
          // rising. Open the landing grace so the pair stays solid
          // while Matter unwinds the overlap.
          if (!grace) {
            grace = new Set<number>();
            this.passThroughLandingGrace.set(fighter, grace);
          }
          grace.add(body.id);
          mask |= slotBit;
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'graceOpenRising',
            feet, prevFeet, platTop, fighter.getVelocity().y, mask,
          );
          continue;
        }

        if (grace?.has(body.id)) {
          if (feet > platBottom + FEET_EPS) {
            // The body tunnelled clear past the platform's bottom —
            // the landing failed; phase so the fall completes cleanly
            // instead of warping the fighter back up.
            grace.delete(body.id);
            this.recordPlatDiag(
              body.id, fighter.slotIndex, 'graceBottomOut',
              feet, prevFeet, platTop, fighter.getVelocity().y, mask,
            );
            continue;
          }
          // Still resolving the landing — keep solid.
          mask |= slotBit;
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'graceHold',
            feet, prevFeet, platTop, fighter.getVelocity().y, mask,
          );
          continue;
        }

        // Below for ≥ 1 step with no landing in flight — lateral /
        // from-under approach (or post-drop-through tail): phase.
        this.recordPlatDiag(
          body.id, fighter.slotIndex, 'phase',
          feet, prevFeet, platTop, fighter.getVelocity().y, mask,
        );
      }

      if (isPassThrough) {
        filter.category = COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH;
        // KEEPALIVE keeps a fully-phased platform's mask non-zero so
        // the crumble sentinel check above can never mistake the
        // driver's own write for a crumbled platform (the bit matches
        // no body, so it creates no collisions).
        filter.mask = mask | COLLISION_CATEGORIES.PASS_THROUGH_DRIVER_KEEPALIVE;
      }
    }

    for (const fighter of fighters) {
      // A landing assist may have corrected the original snapshot. The next
      // step starts at that resolved surface, not at the old penetrated feet.
      this.prevFighterFeetY.set(fighter, geometricFeetY(fighter));
    }
  }

public recordPlatDiag(
    b: number, s: number, br: string,
    feet: number, prev: number, top: number, vy: number, m: number,
  ): void {
    this.platformDiagLog.push({
      f: this.physicsEngine.getFrame(), b, s, br,
      feet: Math.round(feet * 10) / 10,
      prev: Math.round(prev * 10) / 10,
      top: Math.round(top * 10) / 10,
      vy: Math.round(vy * 100) / 100,
      m,
    });
    if (this.platformDiagLog.length > 6000) {
      this.platformDiagLog.splice(0, this.platformDiagLog.length - 6000);
    }
  }

public platformDiagLog: Array<{
    f: number; b: number; s: number; br: string;
    feet: number; prev: number; top: number; vy: number; m: number;
  }> = [];

public fighterSeparationHandler: (() => void) | null = null;

public finalBindingsStore: InputBindingsStore | null = null;

public matchStartMetadata!: MatchStartMetadata;

public finalDamageReceiptSequence = 0;

public finalCameraAnchor: { x: number; y: number } | null = null;

public finalAppliedRoots = new Map<number, { runId: number; sheet: string; delta: { x: number; y: number }; facing: 1 | -1 }>();

public createFinalChoreography(): void {
    if (!this.finalSmashController) return;
    this.finalChoreography = new FinalSmashChoreography(this.finalSmashController, {
      actor: index => {
        const actor = this.playerSlots.find(s => s.playerIndex === index)?.character;
        if (!actor || this.stockTracker.isEliminated(index) || this.stockTracker.isRespawning(index)) return null;
        const centre = actor.getPosition();
        return { playerIndex: index, fighter:actor.id,generation: actor.getPositionResetGeneration(), centre,
          root: actor.getSourceRootPosition(), facing: actor.getFacing(),
          grounded: actor.isGrounded(), hitlag: actor.isInHitlag(),
          eligibleVictim: actor.getActiveHurtboxes().some(h => !h.intangible) };
      },
      retainBodyTail: (owner,sheet,age,advance,endAge,runId,frame) => {
        const actor=this.playerSlots.find(s=>s.playerIndex===owner)?.character;if(!actor)return;
        const pose=finalBodyPose(actor.id,sheet,age),prior=this.finalAppliedRoots.get(owner);
        if(pose){const position=actor.getPosition(),same=prior?.runId===runId&&prior.sheet===sheet;
          actor.moveFinalSmashRoot({x:position.x+pose.rootDelta.x*actor.getFacing()-(same?prior.delta.x*prior.facing:0),
            y:position.y+pose.rootDelta.y-(same?prior.delta.y:0)},runId);}
        actor.retainFinalSmashBodyTail(sheet,age,advance,endAge,runId,frame);
      },
      victimPresentation:(index,state)=>{this.playerSlots.find(s=>s.playerIndex===index)?.character.setFinalVictimPresentation(state);
        if(!state)this.finalVictimFitDependencies.delete(index);},
      equipment: index => this.playerSlots.find(s=>s.playerIndex===index)?.character.getLinkEquipmentState() ?? null,
      lease: (index, control) => {
        const actor=this.playerSlots.find(s=>s.playerIndex===index)?.character; if(!actor)return;
        actor.setFinalSmashControl(control);
        if (!control) { this.finalAppliedRoots.delete(index); return; }
        if (control.role==='owner'&&control.sheet) {
          const pose=finalBodyPose(actor.id,control.sheet,control.age);
          if (pose) {
            const prior=this.finalAppliedRoots.get(index);
            const same=prior?.runId===control.runId&&prior.sheet===control.sheet;
            const dx=pose.rootDelta.x*control.facing-(same?prior.delta.x*prior.facing:0);
            const dy=pose.rootDelta.y-(same?prior.delta.y:0);
            const position=actor.getPosition();
            actor.moveFinalSmashRoot({x:position.x+dx,y:position.y+dy},control.runId);
            this.finalAppliedRoots.set(index,{runId:control.runId,sheet:control.sheet,delta:{...pose.rootDelta},facing:control.facing});
          }
        }
      },
      moveRoot: (index, root, runId) => {
        const actor = this.playerSlots.find(s => s.playerIndex === index)?.character;
        if (actor) actor.moveFinalSmashSourceRoot(root, runId);
      },
      cliffStopVelocity:(index,velocity)=>{
        const actor=this.playerSlots.find(slot=>slot.playerIndex===index)?.character;
        if(!actor?.isGrounded())return velocity;
        const supportId=actor.getSourceSupportPresentationObservation()?.bodyId;
        const support=this.baseStage.bodies.platformBodies.find(body=>body.id===supportId&&!body.isSensor&&body.collisionFilter.mask!==0&&
          (body.label===PLATFORM_LABELS.solid||body.label===PLATFORM_LABELS.passThrough));
        return support?projectPikachuFinalCliffVelocity({root:actor.getSourceRootPosition(),velocity,hullWidth:actor.getTuning().width,
          support:{left:support.bounds.min.x,right:support.bounds.max.x}}):velocity;
      },
      contacts: (owner, sheet, age, label) => this.finalContacts(owner, sheet, age, label),
      hit: (run, strike, contact, label) => this.finalHit(run, strike, contact, label),
      groundRay: (root, length) => this.baseStage.bodies.platformBodies.some(body =>
        !body.isSensor && body.collisionFilter.mask !== 0 &&
        (body.label === PLATFORM_LABELS.solid || body.label === PLATFORM_LABELS.passThrough) &&
        root.x >= body.bounds.min.x && root.x <= body.bounds.max.x &&
        body.bounds.min.y >= root.y && body.bounds.min.y <= root.y + length),
      captureAnchor: (ownerIndex, sheet, age) => {
        const owner = this.playerSlots.find(s => s.playerIndex === ownerIndex)?.character;
        const pose = owner ? finalBodyPose(owner.id, sheet, age) : null;
        const anchor=pose?.attachments.find(a=>a.role==='capture-anchor'),control=owner?.getFinalSmashControl();
        if(!owner||!pose||!anchor||control?.role!=='owner'){
          for(const captive of this.finalSmashController?.getActive()?.captures??[])
            this.finalVictimFitDependencies.set(captive.playerIndex,'Missing same-drawing Final captor anatomical punch-pocket anchor');
          return null;
        }
        const centre=owner.getPosition();
        return {x:centre.x+anchor.point.x*control.facing,y:centre.y-pose.bodyCentreFromRootY+anchor.point.y};
      },
      captureRoot:(recipient,pocket,run)=>{
        const actor=this.playerSlots.find(s=>s.playerIndex===recipient)?.character,
          state=actor?.getFinalVictimPresentationState(),pose=actor?.getFinalVictimBodyPose();
        const anchor=pose?.attachments.find(a=>a.role==='capture-anchor');
        if(!actor||state?.kind!=='captured'||state.runId!==run.id||!pose||!anchor||pose.captureSupport===undefined){
          this.finalVictimFitDependencies.set(recipient,'Missing same-drawing authored victim anatomical anchor/explicit support review');return null;}
        const root={x:pocket.x-anchor.point.x*state.facing,y:pocket.y-anchor.point.y};
        if(!Number.isFinite(root.x)||!Number.isFinite(root.y))throw new Error('Invalid measured Final anatomical pocket');
        // Actual reviewed anatomy is an evidence witness, not a floor snap.
        // captureSupport:null declares intentional lift; numeric bottom remains
        // relative to this exact drawing's body centre and current solved ROOT.
        this.finalVictimFitDependencies.delete(recipient);return root;
      },
      linkEvent: (owner, event, run) => this.consumeLinkFinalEvent(owner, event, run),
      camera: (_run, anchor) => { this.finalCameraAnchor = anchor ? { ...anchor } : null; },
    }, 5, GAME_CONFIG.width / GAME_CONFIG.height);
  }

public finalContacts(ownerIndex: number, sheet: string, age: number, label: string): readonly FinalContact[] {
    const owner = this.playerSlots.find(s => s.playerIndex === ownerIndex)?.character;
    if (!owner) return [];
    const pose = finalBodyPose(owner.id, sheet, age, label);
    if (!pose) return []; // missing new paired source artwork is an explicit gate
    const centre = owner.getPosition(), facing = owner.getFacing(),control=owner.getFinalSmashControl();
    const origin = { x: centre.x, y: centre.y - pose.bodyCentreFromRootY };
    const contactCapsule=(capsule:import('../characters/capsuleGeometry').CollisionCapsule)=>control?.rotationDegrees===undefined?
      posedCapsule(capsule,origin,facing):{radius:capsule.radius,
        start:(()=>{const p=transformPikachuFinalOrientationPoint(capsule.start,{facing:control.facing,rotationDegrees:control.rotationDegrees});return{x:origin.x+p.x,y:origin.y+p.y};})(),
        end:(()=>{const p=transformPikachuFinalOrientationPoint(capsule.end,{facing:control.facing,rotationDegrees:control.rotationDegrees});return{x:origin.x+p.x,y:origin.y+p.y};})()};
    this.finalContactDebugCapsules.push(...pose.outgoing.map(hit=>contactCapsule(hit.capsule)));
    const contacts: FinalContact[] = [];
    for (const target of this.playerSlots) {
      if (target.playerIndex === ownerIndex || this.stockTracker.isEliminated(target.playerIndex) ||
        this.stockTracker.isRespawning(target.playerIndex)) continue;
      const position = target.character.getPosition(), targetFacing = target.character.getFacing();
      const selected = pose.outgoing.filter(hit => {
        const packet = finalPacketBinding(owner.id, sheet, label, hit.id)?.native;
        if (!packet || packet.categoryMask.includes('NO_FIGHTER')) return false;
        const grounded = target.character.isGrounded();
        if (packet.situationMask.endsWith('_G') && !grounded || packet.situationMask.endsWith('_A') && grounded) return false;
        return target.character.getActiveHurtboxes().some(h => !h.intangible && (h.capsule
          ? capsulesIntersect(contactCapsule(hit.capsule), posedCapsule(h.capsule, position, targetFacing))
          : capsuleIntersectsBounds(contactCapsule(hit.capsule), {x:0,y:0}, 1, {
              min: { x: position.x + h.offsetX * targetFacing - h.width / 2, y: position.y + h.offsetY - h.height / 2 },
              max: { x: position.x + h.offsetX * targetFacing + h.width / 2, y: position.y + h.offsetY + h.height / 2 },
            })));
      }).sort((a,b) => a.id - b.id);
      const hit = selected[0]; if (!hit) continue;
      // Match the selected capsule, not a distant tangible body's multiplier.
      const multipliers = target.character.getActiveHurtboxes().filter(h => !h.intangible && (h.capsule
        ? capsulesIntersect(contactCapsule(hit.capsule), posedCapsule(h.capsule, position, targetFacing))
        : capsuleIntersectsBounds(contactCapsule(hit.capsule), {x:0,y:0}, 1, {
          min: { x: position.x + h.offsetX * targetFacing - h.width / 2, y: position.y + h.offsetY - h.height / 2 },
          max: { x: position.x + h.offsetX * targetFacing + h.width / 2, y: position.y + h.offsetY + h.height / 2 },
        }))).map(h => h.damageMultiplier ?? 1);
      contacts.push({ target: target.playerIndex, packetId: hit.id, damageMultiplier: Math.max(...multipliers),contactCapsuleWorld:contactCapsule(hit.capsule) });
    }
    return contacts.sort((a,b) => a.target - b.target);
  }

public consumeLinkFinalEvent(owner: number, event: LinkAncientFinalEvent, run: FinalRun): void {
    // Fresh Link owns equipment/article callbacks; Scene owns world articles
    // and camera leases. These are source events, never generic special presses.
    this.playerSlots.find(s => s.playerIndex === owner)?.character.onLinkFinalEvent(event, run.id);
    if (event.kind === 'shoot-ancient-arrow') {
      const fighter=this.linkArticleFighters().find(f=>f.playerIndex===owner);
      if(fighter)this.linkArticles.shootAncientArrow(run,fighter,this.physicsEngine.getFrame());
    }
    if (event.kind === 'slow-opponents') this.slowFinalOpponents(run,event.rawFactor,event.rawDuration,this.physicsEngine.getFrame());
  }

public beginSourceIntro():void {
    
    const participants=this.activeMatchConfig.linkIntroPolicy==='none'?[]:this.playerSlots.filter(slot=>slot.character.beginSourceMatchEntry(slot.character.getFacing()===1?'left':'right')).map(slot=>slot.playerIndex);
    if(participants.length){
      // Entry already contains its Hip path above the source root. Put that
      // root on the real starting floor; rivals wait grounded during intro.
      for(const slot of this.playerSlots){
        const actor=slot.character,p=actor.getPosition(),hull=actor.body.bounds;
        const floor=this.baseStage.bodies.platformBodies.filter(body=>!body.isSensor&&body.collisionFilter.mask!==0&&
          ([PLATFORM_LABELS.solid,PLATFORM_LABELS.passThrough]as readonly string[]).includes(body.label)&&
          body.bounds.min.x<=p.x&&body.bounds.max.x>=p.x&&body.bounds.min.y>=hull.max.y-1)
          .sort((a,b)=>a.bounds.min.y-b.bounds.min.y||a.id-b.id)[0];
        if(!floor)continue;
        this.matter.body.setPosition(actor.body,{x:p.x,y:floor.bounds.min.y-(hull.max.y-p.y)+.5});
        this.matter.body.setVelocity(actor.body,{x:0,y:0});
      }
      // Real narrowphase support contacts select grounded waiting poses.
      // No gameplay clock, controller, item or hazard tick is consumed.
      this.physicsWorld.world.step(this.physicsEngine.fixedTimestepMs);
      for(const slot of this.playerSlots)this.matter.body.setVelocity(slot.character.body,{x:0,y:0});
    }
    this.sourceIntro=participants.length?{frame:0,accumulatorMs:0,participants}:null;
    
  }

public advanceSourceIntro(deltaMs:number):boolean {
    const state=this.sourceIntro;if(!state)return false;
    if(!this.physicsEngine.isPaused()){
      state.accumulatorMs+=Math.max(0,Math.min(deltaMs,250));
      while(state.accumulatorMs>=this.physicsEngine.fixedTimestepMs&&this.sourceIntro){
        state.accumulatorMs-=this.physicsEngine.fixedTimestepMs;state.frame+=1;
        for(const index of state.participants)this.playerSlots.find(slot=>slot.playerIndex===index)?.character.advanceSourceMatchEntry(state.frame,false);
        if(state.frame>=121){
          for(const index of state.participants)this.playerSlots.find(slot=>slot.playerIndex===index)?.character.advanceSourceMatchEntry(0,true);
          this.sourceIntro=null;
        }
      }
    }
    return true;
  }

getMatchRng(): MatchRng {
    return this.matchRng;
  }

getMatchRngSeed(): number {
    return this.matchRngSeed;
  }

getInputCaptureBuffer(): InputCaptureBuffer {
    return this.inputCaptureBuffer;
  }

getRecordingController(): RecordingController {
    return this.recordingController;
  }

getActiveMatchConfig(): MatchConfig {
    return this.activeMatchConfig;
  }

getMatchStartMetadata(): MatchStartMetadata {
    return this.matchStartMetadata;
  }

getItemSpawnEvents() {
    return this.itemSpawnEventLog.getEntries();
  }

getItemRegistry(): ItemRegistry {
    return this.itemRegistry;
  }

getInventory(playerIndex: number): Inventory | null {
    return this.inventoriesByPlayerIndex.get(playerIndex) ?? null;
  }

getSimDigest(): { readonly text: string; readonly hash: string } {
    return simDigest(this.captureMatchHistoryEvidence());
  }

captureMatchHistoryEvidence():string {
    const frame=this.physicsEngine.getFrame(),base=this.baseStage.bodies.platformBodies[0]?.id;
    if(base===undefined)throw new Error('Stage body construction identity required for canonical evidence');
    const body=(b:MatterJS.BodyType)=>({bodyId:b.id,label:b.label,position:{...b.position},positionPrev:{...b.positionPrev},
      velocity:{...b.velocity},angle:b.angle,anglePrev:b.anglePrev,angularVelocity:b.angularVelocity,
      force:{...b.force},torque:b.torque,mass:b.mass,inertia:b.inertia,inverseMass:b.inverseMass,inverseInertia:b.inverseInertia,
      timeScale:b.timeScale,isStatic:b.isStatic,isSensor:b.isSensor,isSleeping:b.isSleeping,
      ignoreGravity:b.ignoreGravity??false,collisionFilter:{...b.collisionFilter},bounds:structuredClone(b.bounds),
      vertices:(b.vertices??[]).map(v=>({x:v.x,y:v.y})),sleepCounter:(b as MatterJS.BodyType&{sleepCounter:number}).sleepCounter,motion:b.motion,
      positionImpulse:{...b.positionImpulse},constraintImpulse:{...b.constraintImpulse},
      contacts:this.hitboxDamageHandler.getLiveStrikeHistory(b),
      plugin:Object.fromEntries(Object.entries(b.plugin??{}).filter(([key,value])=>key!=='hitGroup'&&key!=='attackInstance'&&
        (value===null||['string','number','boolean'].includes(typeof value)||Array.isArray(value)||['knockback','capsule'].includes(key))))});
    return canonicalMatchHistoryEvidence({schema:'match-history-evidence/1',frame,stage:this.activeStage.id,
      ...(this.baseStage.gazeHazards.length?{gaze:this.baseStage.gazeHazards.map(hazard=>({id:hazard.id,timeline:hazard.timeline,state:hazard.toState()}))}:{}),
      rng:this.matchRng.snapshotState(),intro:this.getSourceIntroSnapshot(),ledgeInputHistory:[...this.prevLedgeKeys],
      match:{rulesPhase:this.matchRules.getPhase(),endPhase:this.matchEndDetector.getPhase(),endFrame:this.matchEndDetector.getEndFrame(),
        secondsRemaining:this.matchRules.getSecondsRemaining(),scores:this.matchRules.getScores(frame),
        stocks:this.playerSlots.map(slot=>this.stockTracker.getPlayerState(slot.playerIndex)),stats:this.matchStatsTracker.getAllStats(frame),
        lastAttackers:this.playerSlots.map(slot=>this.matchStatsTracker.getLastAttacker(slot.playerIndex)),finalizedFrame:this.matchStatsTracker.getFinalizedFrame()},
      actors:this.playerSlots.map(slot=>({playerIndex:slot.playerIndex,state:slot.character.getMatchHistoryEvidence(),
        heldEntityId:this.itemRegistry.getActive().find(e=>e===slot.character.getEquippedItem())?.id??null})),
      bodies:this.physicsWorld.world.getAllBodies().slice().sort((a,b)=>a.id-b.id).map(body),
      pairs:this.physicsWorld.world.engine.pairs.list.map((rawPair:MatterJS.IPair)=>{const pair=rawPair as MatterJS.IPair&{bodyA:MatterJS.BodyType;bodyB:MatterJS.BodyType;collision:MatterJS.ICollisionData;
        contacts:{vertex:{x:number;y:number;index:number}|null;normalImpulse:number;tangentImpulse:number}[]};return {bodyId:pair.bodyA.id,targetBodyId:pair.bodyB.id,isActive:pair.isActive,
        timeCreated:pair.timeCreated,timeUpdated:pair.timeUpdated,separation:pair.separation,
        collision:{normal:{...pair.collision.normal},tangent:{...pair.collision.tangent},depth:pair.collision.depth},
        contacts:pair.contacts.slice(0,pair.contactCount).map((contact:typeof pair.contacts[number])=>({vertex:contact.vertex?{x:contact.vertex.x,y:contact.vertex.y,index:contact.vertex.index}:null,
          normalImpulse:contact.normalImpulse,tangentImpulse:contact.tangentImpulse}))};}),
      items:this.itemRegistry.getHistoryEvidence(),itemScheduler:this.itemSpawnManager?.snapshotState()??null,
      itemInputHistory:{flicks:[...this.itemFlicks],buttons:[...this.itemButtons],repeat:[...this.itemRepeat],
        catchEdges:[...this.itemCatchEdges],frozen:[...this.itemFrozen],suppressAttackUntilRelease:[...this.suppressAttackUntilRelease],
        projectileSpawnLatch:[...this.projectileSpawnLatch].sort(),trapExplosionLatches:[...this.trapExplosionLatches].sort(),
        pickups:[...this.itemPickupRequests].map(([player,row])=>({player,entityId:row.entity.id,action:row.action,resetGeneration:row.resetGeneration})),
        heavyRequests:[...this.donkeykongHeavyItemRequests].map(([player,row])=>({player,entityId:row.entity.id,action:row.action,resetGeneration:row.resetGeneration}))},
      supportHistory:{actors:this.playerSlots.map(slot=>({playerIndex:slot.playerIndex,feetY:this.prevFighterFeetY.get(slot.character),
        generation:this.prevFighterPositionGeneration.get(slot.character),grace:[...(this.passThroughLandingGrace.get(slot.character)??[])]
          .sort((a,b)=>a-b).map(platformBodyId=>({platformBodyId}))})),
        platforms:this.baseStage.bodies.platformBodies.map(body=>({platformBodyId:body.id,previousTopY:this.prevPlatformTopY.get(body)}))},
      falling:[...this.itemFallingY],surfaces:[...this.itemSurfaceY],
      thrown:this.thrownItems.map(({entity,...t})=>({...t,entityId:entity.id})),
      itemExplosions:this.itemExplosions,
      containerStrikes:[...this.containerStrikeFrames].map(([id,rows])=>[id,[...rows]]),
      cpu:[...this.cpuControllers].map(([index,cpu])=>({index,state:cpu.getHistoryEvidence()})),
      subsystems:this.captureFinalRuntimeSnapshot()},base);
  }

getSourceIntroSnapshot(){return this.sourceIntro?structuredClone(this.sourceIntro):null;}

captureFinalRuntimeSnapshot() {
    return { schemaVersion: 2 as const, frame: this.physicsEngine.getFrame(), rng: this.matchRng.snapshotState(),
      ...(this.baseStage.gazeHazards.length?{gazeKnockouts:[...this.gazeKnockouts.values()].map(row=>structuredClone(row))}:{}),
      controller: this.finalSmashController?.snapshot() ?? null, choreography: this.finalChoreography?.snapshot() ?? null,
      finalFxClocks:[...this.finalFxClocks.values()].map(row=>structuredClone(row)),
      ball: this.smashBallRuntime?.snapshot() ?? null, damageSequence: this.finalDamageReceiptSequence,
      sourceIntro:this.getSourceIntroSnapshot(),sourceScreenKo:this.getSourceScreenKoSnapshot(),acceptedStockLossFrames:[...this.acceptedStockLossFrames],
      cpuBallAttackHeld:[...this.cpuBallAttackHeld],cpuBallGoals:[...this.cpuBallGoals].map(([index,row])=>[index,{...row}] as const),
      specialHeld: [...this.finalSpecialHeld], combat: [...this.finalCombatReceipts].map(([id,value])=>[id,{...value}] as const),
      appliedRoots: [...this.finalAppliedRoots].map(([index,row])=>[index,structuredClone(row)] as const),
      camera: this.finalCameraAnchor ? { ...this.finalCameraAnchor } : null,
      ordinaryProjectiles:this.captureOrdinaryProjectileCheckpoint(),
      linkArrowCombatReceipts:[...this.linkArrowCombatReceipts].map(([key,value])=>[key,{...value}] as const),
      linkArticles:this.linkArticles.snapshot(),
      pendingRecoveryEvents:structuredClone(this.pendingRecoveryEvents),
      actors: this.playerSlots.map(s=>({ playerIndex:s.playerIndex, lease:s.character.getFinalSmashLeaseSnapshot() })) };
  }

getSourceScreenKoSnapshot(){return [...this.sourceScreenKo.values()].map(row=>structuredClone(row));}

captureOrdinaryProjectileCheckpoint():OrdinaryProjectileCheckpoint {
    return parseOrdinaryProjectileCheckpoint({schema:'ordinary-world-projectiles/1',frame:this.physicsEngine.getFrame(),
      nextProjectileId:this.nextProjectileId,projectileSpawnLatch:[...this.projectileSpawnLatch].sort(),
      rows:this.projectiles.map(p=>({id:p.id,attackInstanceKey:p.attackInstanceKey,ownerSlotIndex:p.ownerSlotIndex,
        creatorPlayerIndex:p.creatorPlayerIndex,creatorGeneration:p.creatorGeneration,bornFrame:p.bornFrame,moveId:p.moveId,
        facing:p.facing,visualFacing:p.visualFacing,damage:p.damage,knockback:p.knockback,
        hitlagMultiplier:p.hitlagMultiplier??null,sdiMultiplier:p.sdiMultiplier??null,reflectable:p.reflectable??null,absorbable:p.absorbable??null,
        x:p.x,y:p.y,vx:p.vx,vy:p.vy,width:p.width,height:p.height,
        remainingLife:p.framesRemaining===Number.POSITIVE_INFINITY?{kind:'unbounded'}:{kind:'finite',frames:p.framesRemaining},
        spawnedThisFrameByMove:p.spawnedThisFrameByMove,ignoreStaleMoves:p.ignoreStaleMoves===true,visualRecipe:p.visualRecipe,
        visualTransform:{...p.display},
        boomerang:p.boomerang?{...p.boomerang,hitTargets:[...p.boomerang.hitTargets].sort((a,b)=>a-b)}:null,
        ...(p.gravity?{gravity:p.gravity}:{}),...(p.link?{link:structuredClone(p.link)}:{})}))});
  }

captureMatchHistoryCheckpoint():MatchHistoryCheckpoint {
    if(this.historyRestore||this.historyConstructionError||this.matchEndDetector.isMatchOver())
      throw new Error(this.historyConstructionError??'Capture requires an active fully reconstructed match');
    if(!this.finalBindingsStore)throw new Error('Missing actual match bindings');
    const replay=serializeReplay({matchConfig:this.activeMatchConfig,capturedFrames:this.inputCaptureBuffer.getEntries(),
      itemSpawnEvents:this.itemSpawnEventLog.getEntries(),engineVersion:this.buildIdentity,
      fixedTimestepMs:this.physicsEngine.fixedTimestepMs,recordedAt:new Date(this.matchStartMetadata.startedAt)});
    const loop=this.physicsEngine.getLoop();
    return parseMatchHistoryCheckpoint(JSON.parse(matchHistoryJson({schema:'match-history-checkpoint/1',
      buildIdentity:this.buildIdentity,frame:loop.getFrame(),viewport:this.historyConstructionViewport,replay,
      bindingsSnapshot:serializeBindingsSnapshot(this.finalBindingsStore.snapshot()),
      customStage:this.launchData.customStage?serializeCustomStage(this.launchData.customStage):null,
      characterOverrides:this.launchData.characterOverrides??[],constructionPositions:this.historyConstructionPositions,
      inputResolver:this.options.inputHistory?.captureHistoryState() ?? this.emptyInputHistory(),
      sceneInput:{prevStartHeld:false},
      stageIdentity:JSON.stringify(this.activeStage),worldEvidence:this.captureMatchHistoryEvidence(),labMode:this.launchData.labMode===true,intro:this.getSourceIntroSnapshot(),
      clock:{accumulatorMs:loop.getAccumulatorMs(),paused:loop.isPaused(),pausedForMenu:this.pausedForMenu}})),this.buildIdentity);
  }

public restoreMatchHistoryCheckpoint(value:unknown):MatchSim{const checkpoint=parseMatchHistoryCheckpoint(value,this.buildIdentity);const restored=new MatchSim({...this.options,historyCheckpoint:checkpoint});this.dispose();return restored;}

public finishMatchHistoryRestore():void {
    const history=this.historyRestore;if(!history)return;
    try {
    if(this.physicsEngine.getFrame()!==history.frame||JSON.stringify(this.itemSpawnEventLog.getEntries())!==JSON.stringify(history.replay.itemSpawnEvents)){
      this.historyRestoreStatus='failed';throw new Error('Reconstruction frame or autonomous item event history diverged');}
    if(history.intro){
      if(!this.sourceIntro||this.sourceIntro.frame!==history.intro.frame||
        JSON.stringify(this.sourceIntro.participants)!==JSON.stringify(history.intro.participants))throw new Error('Initial intro identity diverged');
      this.sourceIntro.accumulatorMs=history.intro.accumulatorMs;
    }else if(this.sourceIntro)throw new Error('Unexpected active intro after reconstruction');
    this.physicsEngine.getLoop().restoreReconstructedClock({frame:history.frame,...history.clock});
    this.options.inputHistory?.restoreHistoryState(history.inputResolver);
    
    if(this.captureMatchHistoryEvidence()!==history.worldEvidence){this.historyRestoreStatus='failed';
      throw new Error('Actual whole-world reconstruction evidence diverged');}
    this.historyRestore=null;this.setRecordedInputs(null);this.historyRestoreStatus='ready';this.pausedForMenu=history.clock.pausedForMenu;
    } catch(error) {this.historyRestoreStatus='failed';throw error;}
  }

restoreFinalRuntimeSnapshot(snapshot: ReturnType<MatchSim['captureFinalRuntimeSnapshot']>): void {
    if (snapshot.schemaVersion !== 2) throw new Error('Unsupported owned subsystem snapshot (ordinary projectile transport required)');
    const ordinaryProjectiles=parseOrdinaryProjectileCheckpoint(snapshot.ordinaryProjectiles);
    if(!Array.isArray(snapshot.finalFxClocks))throw new Error('Missing owned Final FX clock checkpoint');
    const fxClocks=snapshot.finalFxClocks.map(row=>parseFinalFxRunClock(row,FINAL_FX_CUES));
    if(new Set(fxClocks.map(row=>row.ownerIndex)).size!==fxClocks.length)throw new Error('Duplicate Final FX owner checkpoint');
    if(ordinaryProjectiles.frame!==snapshot.frame)throw new Error('Ordinary/Final checkpoint frame mismatch');
    this.validateOrdinaryProjectileParticipants(ordinaryProjectiles);
    this.finalVictimFitDependencies.clear();
    this.finalContactDebugCapsules.length=0;
    if(!Array.isArray(snapshot.actors)||snapshot.actors.length!==this.playerSlots.length||new Set(snapshot.actors.map(row=>row.playerIndex)).size!==this.playerSlots.length)
      throw new Error('Owned subsystem snapshot requires every unique actual participant');
    for (const row of snapshot.actors) {
      if(row.lease.finalVictimPresentation){const victim=parseFinalVictimPresentationState(row.lease.finalVictimPresentation),owner=this.playerSlots.find(s=>s.playerIndex===victim.ownerPlayerIndex)?.character;
        if(victim.victimPlayerIndex!==row.playerIndex||victim.victimGeneration!==row.lease.generation||victim.lastFrame>snapshot.frame||
          !owner||owner.id!==victim.ownerFighter||victim.ownerGeneration>owner.getPositionResetGeneration())
          throw new Error('Cinematic checkpoint participant/owner/frame identity mismatch');}
      const actor=this.playerSlots.find(s=>s.playerIndex===row.playerIndex)?.character;
      if (!actor || actor.getPositionResetGeneration()!==row.lease.generation) throw new Error('Final restore actor generation mismatch');
    }
    const integer=(value:unknown,min=0)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
    const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
    const named=(value:unknown)=>typeof value==='string'&&value.length>0;
    if(!integer(snapshot.frame))throw new Error('Malformed source checkpoint frame');
    this.gazeKnockouts.clear();
    if(this.baseStage.gazeHazards.length){
      if(!Array.isArray(snapshot.gazeKnockouts))throw new Error('Missing accepted gaze knockout presentation checkpoint');
      for(const row of snapshot.gazeKnockouts){
        const actor=this.playerSlots.find(slot=>slot.playerIndex===row.playerIndex)?.character;
        if(!actor||actor.id!==row.characterId||!integer(row.bornFrame)||row.bornFrame>snapshot.frame||
          !finite(row.sourceRoot?.x)||!finite(row.sourceRoot?.y)||![1,-1].includes(row.facing)||![1,-1].includes(row.away)||
          this.gazeKnockouts.has(row.playerIndex))throw new Error('Malformed accepted gaze knockout presentation');
        this.gazeKnockouts.set(row.playerIndex,structuredClone(row));
      }
    }
    this.physicsEngine.setFrame(snapshot.frame); this.matchRng.restoreState(snapshot.rng);
    this.clearFinalFxPresentation();
    if (snapshot.controller) this.finalSmashController?.restore(snapshot.controller);
    if (snapshot.ball) this.smashBallRuntime?.restore(snapshot.ball);
    this.finalDamageReceiptSequence=snapshot.damageSequence;
    this.clearSourceScreenKo();
    if(new Set(snapshot.sourceScreenKo.map(row=>row.playerIndex)).size!==snapshot.sourceScreenKo.length)throw new Error('Duplicate detached ScreenKO checkpoint participant');
    this.sourceScreenKo=new Map(snapshot.sourceScreenKo.map(row=>{const state=parseLinkScreenKoPresentationState(row);
      const actor=this.playerSlots.find(slot=>slot.playerIndex===state.playerIndex)?.character;
      if(state.lastFrame>snapshot.frame||!actor||actor.id!=='link'||state.generation>actor.getPositionResetGeneration())throw new Error('ScreenKO checkpoint clock/participant mismatch');
      return[state.playerIndex,state];}));
    if(snapshot.acceptedStockLossFrames.some(([index,frame])=>!integer(index)||!integer(frame)||frame>snapshot.frame))throw new Error('Malformed stock-loss receipt checkpoint');
    this.acceptedStockLossFrames=new Map(snapshot.acceptedStockLossFrames);
    const intro=snapshot.sourceIntro;
    if(intro!==null&&(!Number.isSafeInteger(intro.frame)||intro.frame<0||intro.frame>=121||!Number.isFinite(intro.accumulatorMs)||
      intro.accumulatorMs<0||intro.accumulatorMs>=this.physicsEngine.fixedTimestepMs||!Array.isArray(intro.participants)||!intro.participants.length||
      new Set(intro.participants).size!==intro.participants.length||intro.participants.some(index=>!Number.isSafeInteger(index)||
        this.playerSlots.find(slot=>slot.playerIndex===index)?.character.id!=='link')||snapshot.frame!==0))
      throw new Error('Malformed initial source intro checkpoint');
    this.sourceIntro=intro?structuredClone(intro):null;
    if(snapshot.cpuBallAttackHeld.some(([index,held])=>!integer(index)||typeof held!=='boolean'))throw new Error('Malformed CPU Ball input checkpoint');
    this.cpuBallGoals=new Map(snapshot.cpuBallGoals.map(([index,row])=>{
      if(!integer(index)||!integer(row.actorGeneration)||!integer(row.ballId)||!integer(row.surfaceId)||![1,-1].includes(row.attackFacing)||
        typeof row.neutralAttackIdentity!=='string'||!row.neutralAttackIdentity||typeof row.surfaceGeometryIdentity!=='string'||!row.surfaceGeometryIdentity||
        typeof row.hullShapeIdentity!=='string'||!row.hullShapeIdentity||typeof row.contactGeometryIdentity!=='string'||!Number.isFinite(row.halfWidth)||row.halfWidth<=0||!Number.isFinite(row.goalX))throw new Error('Malformed retained CPU Ball goal checkpoint');
      return[index,{...row}];}));
    this.cpuBallAttackHeld=new Map(snapshot.cpuBallAttackHeld);
    this.finalSpecialHeld=new Map(snapshot.specialHeld); this.finalCombatReceipts=new Map(snapshot.combat.map(([id,v])=>[id,{...v}]));
    this.finalAppliedRoots=new Map(snapshot.appliedRoots.map(([i,row])=>[i,structuredClone(row)]));
    this.finalCameraAnchor=snapshot.camera?{...snapshot.camera}:null;
    const combatKeys=new Set<string>();
    this.linkArrowCombatReceipts=new Map(snapshot.linkArrowCombatReceipts.map(([key,value])=>{
      if(!named(key)||combatKeys.has(key)||!value||typeof value.registered!=='boolean'||value.stale!==null&&(!finite(value.stale)||value.stale<0)||
        value.registered!==(value.stale!==null))throw new Error('Malformed detached-article combat receipt checkpoint');
      combatKeys.add(key);return[key,{...value}] as const;}));
    this.linkArrowAttackReceipts=new WeakMap();this.linkArrowVolleyTokens.clear();
    this.restoreOrdinaryProjectileCheckpoint(ordinaryProjectiles);
    this.linkArticles.restore(snapshot.linkArticles);this.linkArticles.syncOwners(this.linkArticleFighters(),this.projectiles);
    this.pendingRecoveryEvents=(snapshot.pendingRecoveryEvents??[]).map(row=>{
      if(!Number.isSafeInteger(row.playerIndex)||!this.playerSlots.some(slot=>slot.playerIndex===row.playerIndex))throw new Error('Invalid recovery transaction participant');
      return{playerIndex:row.playerIndex,event:parseRecoveryTransactionEvent(row.event)};
    });
    for (const row of snapshot.actors) this.playerSlots.find(s=>s.playerIndex===row.playerIndex)!.character.restoreFinalSmashLease(row.lease);
    if(this.sourceIntro)for(const index of this.sourceIntro.participants){const actor=this.playerSlots.find(slot=>slot.playerIndex===index)!.character,
      route=actor.getSourceContextualPresentationRoute();if(!actor.getSourceMatchEntryEquipment()||route?.rawAge!==this.sourceIntro.frame)
      throw new Error('Restore initial intro actor lease before rearming presentation clock');}
    if (snapshot.choreography){if(snapshot.choreography.currentFrame>snapshot.frame)throw new Error('Future Final choreography checkpoint');
      this.finalChoreography?.restore(snapshot.choreography);}
    for(const clock of fxClocks){const actor=this.playerSlots.find(slot=>slot.playerIndex===clock.ownerIndex)?.character,
      control=actor?.getFinalSmashControl(),run=this.finalSmashController?.getActive();
      if(!actor||!control||control.role!=='owner'||!isFinalFxFighter(actor.id)||clock.lastFrame>snapshot.frame||
        clock.generation!==actor.getPositionResetGeneration()||clock.runId!==control.runId||run?.id!==clock.runId||
        run.owner.playerIndex!==clock.ownerIndex||run.owner.generation!==clock.generation||
        ['finish','miss','done','uncommitted-end-tail'].includes(control.phase))throw new Error('Final FX checkpoint requires its actual live run/owner lease');
      if(actor.id==='pikachu'&&['dash','hit','attack','attack2','attack-finish','return'].includes(control.phase)&&clock.flightEntryFrame===null)
        throw new Error('Actual Pika flight checkpoint lost its admitted startup/Dash FX run identity');
      if(clock.flightEntryFrame===null){const armed=clock.armed[0],cue=armed?FINAL_FX_CUES.find(row=>row.key===armed.cueKey):null,
        elapsed=armed&&cue?Math.max(0,control.age+cue.selection.bodyAgeOffset-armed.sourceAge):0;
        if(armed&&(control.phase!=='startup'||control.sheet!==cue?.carryAdmission?.motion)||clock.elapsed!==elapsed)
          throw new Error('Startup Final FX clock differs from its actual source body/script clock');
      }else if(!['dash','hit','attack','attack2','attack-finish','return'].includes(control.phase))throw new Error('Flight FX restored outside actual movement owner');
      this.finalFxClocks.set(clock.ownerIndex,clock);
    }
  }

public validateOrdinaryProjectileParticipants(snapshot:OrdinaryProjectileCheckpoint):void {
    for(const row of snapshot.rows){
      const creator=this.playerSlots.find(slot=>slot.playerIndex===row.creatorPlayerIndex)?.character;
      const owner=this.playerSlots.find(slot=>slot.playerIndex===row.ownerSlotIndex)?.character;
      // Detached ordinary items retain their actual creator receipt through
      // stock changes; reflection changes attributed owner, not that receipt.
      if(!creator||!owner||row.creatorGeneration>creator.getPositionResetGeneration()||
        row.boomerang?.hitTargets.some(index=>!this.playerSlots.some(slot=>slot.playerIndex===index)))
        throw new Error('Ordinary projectile checkpoint participant/generation mismatch');
      const base=`ordinary:${row.creatorPlayerIndex}:${row.creatorGeneration}:${row.bornFrame}:${row.id}`;
      if(!row.attackInstanceKey.startsWith(base)||!/^(?:\/reflect:\d+:\d+)*$/.test(row.attackInstanceKey.slice(base.length)))
        throw new Error('Ordinary projectile checkpoint attack-instance lineage mismatch');
      let lastOwner=row.creatorPlayerIndex,lastReflectionFrame:number|null=null;
      for(const suffix of row.attackInstanceKey.slice(base.length).split('/').filter(Boolean)){
        const[,rawFrame,rawOwner]=suffix.split(':'),frame=Number(rawFrame),index=Number(rawOwner);
        if(!Number.isSafeInteger(frame)||frame<row.bornFrame||frame>snapshot.frame||lastReflectionFrame!==null&&frame<=lastReflectionFrame||!this.playerSlots.some(slot=>slot.playerIndex===index))
          throw new Error('Ordinary projectile checkpoint reflection lineage mismatch');
        lastOwner=index;lastReflectionFrame=frame;
      }
      if(row.ownerSlotIndex!==lastOwner)throw new Error('Ordinary projectile checkpoint attributed owner lacks actual reflection lineage');
    }
    for(const latch of snapshot.projectileSpawnLatch){const match=/^(\d+):(.+)$/.exec(latch);
      if(!match||!this.playerSlots.some(slot=>slot.playerIndex===Number(match[1])))throw new Error('Ordinary projectile checkpoint spawn-latch participant mismatch');}
  }

restoreOrdinaryProjectileCheckpoint(value:unknown):void {
    const snapshot=parseOrdinaryProjectileCheckpoint(value);
    if(snapshot.frame!==this.physicsEngine.getFrame())throw new Error('Restore ordinary projectile world at the exact authoritative frame');
    this.validateOrdinaryProjectileParticipants(snapshot);
    for(const row of snapshot.rows){const receipt=this.linkArrowCombatReceipts.get(row.attackInstanceKey);
      if(!receipt||typeof receipt.registered!=='boolean'||receipt.stale!==null&&(!Number.isFinite(receipt.stale)||receipt.stale<0)||
        receipt.registered!==(receipt.stale!==null))throw new Error('Restore actual ordinary projectile combat receipt before world reconstruction');}
    const reconstructed:MatchSim['projectiles']=[];
    for(const row of snapshot.rows){
      reconstructed.push({id:row.id,creatorPlayerIndex:row.creatorPlayerIndex,creatorGeneration:row.creatorGeneration,bornFrame:row.bornFrame,
        attackInstanceKey:row.attackInstanceKey,ownerSlotIndex:row.ownerSlotIndex,moveId:row.moveId,facing:row.facing,visualFacing:row.visualFacing,
        damage:row.damage,knockback:row.knockback,attackInstance:this.linkArrowAttackToken(row.attackInstanceKey),
        x:row.x,y:row.y,vx:row.vx,vy:row.vy,width:row.width,height:row.height,
        framesRemaining:row.remainingLife.kind==='unbounded'?Number.POSITIVE_INFINITY:row.remainingLife.frames,
        spawnedThisFrameByMove:row.spawnedThisFrameByMove,display:{...row.visualTransform},visualRecipe:row.visualRecipe,
        ...(row.hitlagMultiplier===null?{}:{hitlagMultiplier:row.hitlagMultiplier}),...(row.sdiMultiplier===null?{}:{sdiMultiplier:row.sdiMultiplier}),
        ...(row.reflectable===null?{}:{reflectable:row.reflectable}),...(row.absorbable===null?{}:{absorbable:row.absorbable}),
        ...(row.ignoreStaleMoves?{ignoreStaleMoves:true as const}:{}),
        ...(row.boomerang?{boomerang:{...row.boomerang,hitTargets:new Set(row.boomerang.hitTargets)}}:{}),
        ...(row.gravity===undefined?{}:{gravity:row.gravity}),...(row.link===undefined?{}:{link:structuredClone(row.link)})});
      const restored=reconstructed.at(-1)!;
      if(restored.link)restored.display.angle=displayAngleDegrees(linkProjectileAngle(restored));
    }
    this.projectiles=reconstructed;this.nextProjectileId=snapshot.nextProjectileId;this.projectileSpawnLatch=new Set(snapshot.projectileSpawnLatch);
  }

getFinalSmashSnapshot(): FinalControllerSnapshot | null { return this.finalSmashController?.snapshot() ?? null; }

getSmashBallSnapshot(): SmashBallRuntimeSnapshot | null { return this.smashBallRuntime?.snapshot() ?? null; }

getFinalChoreographySnapshot(): FinalChoreographySnapshot | null { return this.finalChoreography?.snapshot() ?? null; }

  getCpuFinalStrategySnapshot(){return [...this.cpuFinalStrategies].map(([playerIndex,row])=>({playerIndex,...row}));}

  getMatchHistoryRestoreStatus(){return {state:this.historyRestoreStatus,frame:this.physicsEngine.getFrame(),
    targetFrame:this.historyRestore?.frame??null,buildIdentity:this.buildIdentity};}

getFinalVictimFitSnapshot(){return this.playerSlots.flatMap(slot=>{
    const actor=slot.character,state=actor.getFinalVictimPresentationState(),pose=actor.getFinalVictimBodyPose();
    if(state?.kind!=='captured'||!pose)return [];
    const root=actor.getSourceRootPosition(),anchor=pose.attachments.find(a=>a.role==='capture-anchor'),support=pose.captureSupport;
    const owner=this.playerSlots.find(s=>s.playerIndex===state.ownerPlayerIndex)?.character,control=owner?.getFinalSmashControl(),
      ownerPose=owner&&control?.sheet?finalBodyPose(owner.id,control.sheet,control.age):null,ownerAnchor=ownerPose?.attachments.find(a=>a.role==='capture-anchor');
    const pocket=owner&&ownerPose&&ownerAnchor&&control?{x:owner.getPosition().x+ownerAnchor.point.x*control.facing,
      y:owner.getPosition().y-ownerPose.bodyCentreFromRootY+ownerAnchor.point.y}:null;
    return [{playerIndex:slot.playerIndex,generation:state.victimGeneration,runId:state.runId,root,
      profileKey:actor.getFinalVictimPresentationSelection()!.profileKey,authoredPoseIdentity:pose.authoredPoseIdentity,
      fitBasis:state.ownerFighter==='donkeykong'?'dk-paired-anatomical-pocket':'pikachu-saved-target-root',
      savedTargetRoot:state.ownerFighter==='pikachu'?this.finalChoreography?.snapshot().captureRoots.find(r=>r.playerIndex===slot.playerIndex&&r.generation===state.victimGeneration)?.root??null:null,
      victimAnchor:anchor?{x:root.x+anchor.point.x*state.facing,y:root.y+anchor.point.y}:null,ownerPocket:state.ownerFighter==='donkeykong'?pocket:null,
      supportReview:support===undefined?'missing':support===null?'lifted-no-floor':'reviewed-anatomical-bottom',
      anatomicalBottomWorld:support?actor.getPosition().y+support.reviewedBottom:null,clearance:support?.clearance??null,
      reviewKey:support?.reviewKey??null}];
  });}
}
