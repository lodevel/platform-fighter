import type { MatchSim } from './MatchSim';
import {gazeKnockoutFlight} from './knockoutFlight';
import type { EffectArtView, ItemView, PresentationSpriteView, SimView } from './view';
import { captureSimulationAnimation } from '../characters/simulationSpriteAnimation';
import { finalHudModel } from '../finalSmash/finalSmashPresentation';
import { formatBindingList } from '../ui/rebindingScreenFormat';
import { HELD_ITEM_MIN_FORESHORTENING } from '../characters/heldItemSocket';
import { isItemUseMove } from '../items/ItemDefinition';
import type { ItemEntity } from '../items/ItemEntity';
import { bobOmbFlashing } from '../items/BobOmb';
import { ASSET_KEYS } from '../assets/manifest';
import { getPackedBodyRenderMetrics, getPackedNativeTimedClip, installedPackedSheet, packedBodyProfile, selectPackedNativeSampleFrame } from '../characters/packedBodyPresentation';
import { finalBodyPose } from '../finalSmash/finalBodyPose';
import { FINAL_FX_CUES, registeredFinalFxProfiles } from '../finalSmash/registeredFinalFx';
import { isFinalFxFighter, selectFinalFxPresentation } from '../finalSmash/finalFxProfiles';
import { selectLinkScreenKoPresentation } from '../characters/linkContextualPresentation';
import { LINK_ARTICLE_SHEETS, linkArticleDrawing, linkAncientArrowDamageArea, linkProjectileAngle } from '../match/linkArticles';
import { ANCIENT_ARROW_FLIGHT } from '../finalSmash/linkAncientBow';
import { effectAction, sheetDisplay } from '../characters/actionDisplay';
import { analyticAttackDebugBoxes, attackSensorDebugBoxes, computeFighterDebugBoxes } from '../fx/hitboxDebugFormat';

function itemView(sim:MatchSim,entity:ItemEntity,frame:number):ItemView {
  const definition=entity.definition,visual=definition.visual,holderIndex=entity.getHolderPlayerIndex();
  const holder=holderIndex===null?null:sim.playerSlots.find(slot=>slot.playerIndex===holderIndex)?.character;
  let root={...entity.getPosition()},angle=0,scaleX=1,scaleY=1,visible=true;
  if(holder){
    visible=holder.getLinkEquipmentState()?.heldItemVisible!==false&&(!definition.recovery?holder.getEatingState()===null:true);
    if(definition.generated?.kind==='link-remote-bomb'){root={...holder.getHeldItemWorldPosition()};visible=true;}
    else {
      const socket=holder.getHeldItemSocket();root={x:socket.x,y:socket.y};
      if(!definition.recovery&&!definition.container){
        const active=holder.getActiveAttack(),swing=visual?.swingArc,total=active?active.move.startupFrames+active.move.activeFrames:0;
        const progress=active&&total>0?Math.min(active.framesElapsed/total,1):1;
        const fallback=active&&swing&&isItemUseMove(definition,active.move.id)?swing[0]+(swing[1]-swing[0])*progress:visual?.restAngle??0;
        angle=(socket.angle??fallback)*Math.PI/180;
        scaleX=holder.getFacing();scaleY=Math.max(HELD_ITEM_MIN_FORESHORTENING,socket.length);
      }
    }
  }
  const rolling=entity.getContainerState()?.rolling;
  if(!holder&&rolling)angle=rolling.angle*Math.PI/180;
  const bob=entity.getBobOmbState();if(!holder&&bob?.phase==='walking')scaleX=bob.direction;
  const hammer=entity.getHammerState();
  const spriteKey=hammer?.malfunction==='headless'&&hammer.detached?ASSET_KEYS.itemHammerHandle:visual?.spriteKey??'';
  const growth=definition.hammer?.golden&&!hammer?Math.max(.05,Math.min(1,(frame-entity.spawnedAtFrame)/Math.max(1,definition.hammer.growthFrames))):1;
  const width=visual?.width??(definition.generated?.kind==='link-remote-bomb'?20:75),height=(visual?.height??(definition.generated?.kind==='link-remote-bomb'?20:75))*growth;
  // Item roots are their bottom. Sprite cards use the centre after the same
  // held-socket scale and rotation that the previous renderer applied.
  const position={x:root.x+Math.sin(angle)*height*scaleY/2,y:root.y-Math.cos(angle)*height*scaleY/2};
  return {id:entity.id,type:definition.type,spriteKey,width,height,position,rootPosition:root,angle,scaleX,scaleY,
    generatedKind:definition.generated?.kind,alpha:entity.isBroken()?.4:1,visible,
    ...(bob&&definition.bobOmb&&bobOmbFlashing(definition.bobOmb,bob)&&Math.floor(frame/4)%2===0?{alpha:.8}:{})};
}

/** One of Link's article strips as a package effect action at a drawing step. */
const linkEffect=(sheet:string,step:number,facing:1|-1):EffectArtView=>({characterId:'link',action:effectAction(sheet),tick:step,facing});

function presentationSprites(sim:MatchSim):PresentationSpriteView[] {
  const result:PresentationSpriteView[]=[];
  for(const slot of sim.playerSlots){
    const actor=slot.character,control=actor.getFinalSmashPresentation();
    if(!control||control.role!=='owner'||!isFinalFxFighter(actor.id)||sim.stockTracker.isEliminated(slot.playerIndex))continue;
    const pose=control.sheet?finalBodyPose(actor.id,control.sheet,control.age):null,clock=sim.finalFxClocks.get(slot.playerIndex);
    const matching=clock?.runId===control.runId&&clock.generation===actor.getPositionResetGeneration()?clock:null;
    const selected=selectFinalFxPresentation(FINAL_FX_CUES,registeredFinalFxProfiles(actor.id),{fighter:actor.id,ownerIndex:slot.playerIndex,
      generation:actor.getPositionResetGeneration(),control,sourceRoot:actor.getSourceRootPosition(),points:pose?.effectPoints??[],bodyAvailable:pose!==null,
      flightClock:matching?{elapsed:matching.elapsed,armedKeys:matching.armed.map(row=>row.cueKey)}:null});
    for(const row of selected.poses)result.push({key:`char.${actor.id}.${row.sheet}`,frame:row.frameIndex,x:row.point.x,y:row.point.y,
      originX:row.facing===-1?1-row.profile.originX:row.profile.originX,originY:row.profile.originY,
      scaleX:row.profile.scaleToWorld*row.cue.selection.scale,scaleY:row.profile.scaleToWorld*row.cue.selection.scale,
      flipX:row.facing===-1,rotation:row.rotationDegrees*Math.PI/180,depth:row.cue.selection.layer==='behind-body'?-.1:5,
      art:{characterId:actor.id,action:effectAction(row.profile.sheet),tick:row.age,facing:row.facing,scaleX:row.cue.selection.scale,scaleY:row.cue.selection.scale}});
  }
  for(const state of sim.sourceScreenKo.values()){
    const route=selectLinkScreenKoPresentation(state),sheet=installedPackedSheet('link',route.motion),metrics=getPackedBodyRenderMetrics('link',sheet);
    if(!metrics||!getPackedNativeTimedClip('link',sheet))continue;
    // Detached Screen KO is expressed in viewport coordinates; its dedicated
    // camera layer is selected by the host rather than changing simulation.
    result.push({key:`char.link.${sheet}`,frame:selectPackedNativeSampleFrame('link',sheet,route.rawAge),x:sim.viewport.width/2,y:sim.viewport.height/2,
      originX:route.facing===-1?1-metrics.originX:metrics.originX,originY:metrics.originY,
      scaleX:metrics.scaleToWorld,scaleY:metrics.scaleToWorld,flipX:route.facing===-1,depth:9000,space:'screen',
      art:{characterId:'link',...sheetDisplay('link',sheet,route.rawAge,route.facing)}});
  }
  for(const arrow of sim.linkArticles.ancientArrows()){
    const state=arrow.state,metrics=getPackedBodyRenderMetrics('link','fx__link_ancientbowarrow');
    if(state.phase!=='fly'||!metrics)continue;
    result.push({key:'char.link.fx__link_ancientbowarrow',frame:0,x:state.x,y:state.y,originX:state.facing===-1?1-metrics.originX:metrics.originX,
      originY:metrics.originY,scaleX:metrics.scaleToWorld,scaleY:metrics.scaleToWorld,flipX:state.facing===-1,depth:3,
      art:linkEffect('fx__link_ancientbowarrow',0,state.facing)});
  }
  for(const entity of sim.itemRegistry.getActive()){
    if(entity.definition.generated?.kind!=='link-arrow')continue;
    const item=itemView(sim,entity,sim.physicsEngine.getFrame()),metrics=getPackedBodyRenderMetrics('link',LINK_ARTICLE_SHEETS['link-arrow']);
    if(metrics&&item.visible)result.push({key:`char.link.${LINK_ARTICLE_SHEETS['link-arrow']}`,frame:0,x:item.rootPosition!.x,
      y:item.rootPosition!.y-entity.definition.throwProfile.mapBottom*entity.definition.throwProfile.pixelsPerUnit,
      originX:metrics.originX,originY:metrics.originY,scaleX:metrics.scaleToWorld,scaleY:metrics.scaleToWorld,rotation:item.angle,depth:3,
      art:linkEffect(LINK_ARTICLE_SHEETS['link-arrow'],0,1)});
  }
  return result;
}

/** Read the shared simulation once. Only the one-shot presentation FIFO drains. */
export function buildSimView(sim:MatchSim):SimView {
  const frame=sim.physicsEngine.getFrame(),frozen=sim.pausedForMenu||sim.physicsEngine.isPaused()||sim.matchEndDetector.isMatchOver();
  const specialEffects=sim.playerSlots.flatMap(slot=>[...slot.character.getPikachuSpecialVisuals(),...slot.character.getPikachuFootstoolVisuals()]);
  const targets=sim.playerSlots.filter(slot=>!sim.stockTracker.isEliminated(slot.playerIndex)).map(slot=>({...slot.character.getPosition(),active:true}));
  for(const object of specialEffects){if(object.kind!=='cloud'&&object.kind!=='bolt')continue;
    const width=object.kind==='cloud'?65:16,top=object.kind==='cloud'?47:80;
    targets.push({x:object.x-width,y:object.y-top,active:true},{x:object.x+width,y:object.y+24,active:true});}
  if(!targets.length)targets.push({x:sim.viewport.width/2,y:sim.viewport.height/2,active:true});
  const ball=sim.smashBallRuntime?.getRoaming();
  return {frame,stageId:sim.activeStage.id,stageFrame:sim.baseStage.getHazardFrame(),
    knockoutFlights:[...sim.gazeKnockouts.values()].flatMap(receipt=>{const flight=gazeKnockoutFlight(receipt,frame);return flight?[flight]:[];}),
    platforms:sim.baseStage.bodies.platformBodies.map((body,index)=>{
      const platform=sim.activeStage.platforms[index]!,scale=sim.baseStage.bodies.scale;
      return {id:platform.id??`plat${index}`,x:body.position.x,y:body.position.y,width:platform.width*scale,height:platform.height*scale,
        active:body.collisionFilter.mask!==0};
    }),
    fighters:sim.playerSlots.map(slot=>{
      const actor=slot.character,tuning=actor.getTuning(),parry=actor.getShieldPresentationState(),sourceBubble=actor.getSourceShieldBubble();
      const socket=actor.getHeldItemSocket(),held=sim.getInventory(slot.playerIndex)?.getHeldItem();
      return {playerIndex:slot.playerIndex,characterId:actor.id,paletteIndex:sim.matchParticipants[slot.playerIndex]!.slot.paletteIndex,
        position:{...actor.getPosition()},facing:actor.getFacing(),animation:captureSimulationAnimation(actor,frame,frozen),
        sourceRoot:actor.getSourceRootPosition(),equipment:held?[held.definition.type]:[],
        poseAttachments:[{id:'item-grip',space:'world' as const,position:{x:socket.x,y:socket.y},
          ...(socket.angle===null?{}:{rotation:socket.angle*Math.PI/180})}],
        invincible:actor.isInvincible(),eliminated:sim.stockTracker.isEliminated(slot.playerIndex),body:{width:tuning.width,height:tuning.height},
        chargeProgress:actor.getChargeProgress(),shield:{state:actor.getShieldState(),maxHealth:tuning.shield?.maxHealth??50,
          ...(sourceBubble?{centre:{...sourceBubble.centre},activeRadius:sourceBubble.radius}:{}),
          parry:parry?.kind==='parry'?{framesElapsed:parry.framesElapsed,totalFrames:parry.totalFrames??0}:null}};
    }),
    items:sim.itemRegistry.getActive().map(entity=>itemView(sim,entity,frame)),
    projectiles:sim.projectiles.filter(p=>p.display.visible).map(p=>{
      const sheet=p.visualRecipe.kind==='link-arrow'||p.visualRecipe.kind==='link-boomerang'?LINK_ARTICLE_SHEETS[p.visualRecipe.kind]:null;
      const count=sheet?packedBodyProfile('link')?.clips[sheet]?.frameCount??0:0,artFrame=linkArticleDrawing(p,count);
      return {id:p.id,moveId:p.moveId,x:p.x,y:p.y,w:p.width,h:p.height,facing:p.facing,visualFacing:p.visualFacing,visualRecipe:p.visualRecipe,
        angle:(p.link?linkProjectileAngle(p):p.display.angle)*Math.PI/180,artFrame,artPosition:{x:p.x,y:p.y},
        ...(sheet?{art:linkEffect(sheet,artFrame,p.visualFacing??p.facing)}:{})};
    }),
    explosions:[...sim.itemExplosions.map((e,id)=>({id,x:e.x,y:e.y,radius:e.spec.radius,progress:1-e.framesLeft/e.spec.activeFrames})),
      ...sim.linkArticles.ancientArrows().map(arrow=>{const state=arrow.state,area=linkAncientArrowDamageArea(state);
        return {id:100000+arrow.run.id,x:area.x,y:area.y,radius:area.radius,visualRecipe:'ancient-arrow' as const,phase:state.phase,facing:state.facing,
          progress:state.phase==='fly'?0:state.age/(state.phase==='fighter-blast'?ANCIENT_ARROW_FLIGHT.fighterBlastFrames:ANCIENT_ARROW_FLIGHT.terrainBlastFrames)};})],
    camera:{targets,finalAnchor:sim.finalCameraAnchor?{...sim.finalCameraAnchor}:null},
    hud:{mode:sim.activeMatchConfig.mode,secondsLeft:sim.matchRules.getSecondsRemaining(),suddenDeath:sim.matchRules.isSuddenDeath(),players:sim.playerSlots.map(slot=>{
      const config=sim.matchParticipants[slot.playerIndex]!.slot,controller=sim.finalSmashController,resource=controller?.getPlayer(slot.playerIndex);
      return {playerIndex:slot.playerIndex,slotIndex:config.index,characterId:slot.character.id,paletteIndex:config.paletteIndex,cpu:config.inputType==='ai',
        damage:slot.character.getDamagePercent(),stocks:sim.stockTracker.getStocks(slot.playerIndex),score:sim.matchRules.getScores(frame)[slot.playerIndex]??0,
        eliminated:sim.stockTracker.isEliminated(slot.playerIndex),final:resource&&controller?finalHudModel({player:resource,meterEnabled:controller.rules.meterEnabled,
          availableResource:controller.getAvailableResource(slot.playerIndex),specialBindingLabel:sim.finalBindingsStore?formatBindingList(sim.finalBindingsStore.get(slot.bindingsSlot).bindings.special??[]):'Special',gameplayFrame:frame}):null};
    })},events:sim.simEvents.drain(),presentationSprites:presentationSprites(sim),
    traps:sim.playerSlots.filter(slot=>!sim.stockTracker.isEliminated(slot.playerIndex)).flatMap(slot=>slot.character.getActiveTraps().map(trap=>({x:trap.x,y:trap.y,armDelay:trap.armDelay,framesSinceSpawn:trap.framesSinceSpawn,detonated:trap.detonated,fused:trap.fused}))),
    smashBall:ball?{x:ball.position.x,y:ball.position.y,radius:sim.smashBallRuntime!.policy.visualRadius,receivingRadius:sim.smashBallRuntime!.policy.radius,heavy:ball.resource.heavy}:null,
    spawnPlatforms:sim.respawnHandler.getActiveSpawnPlatforms().map(platform=>({x:platform.x,y:platform.y,width:platform.width,height:platform.height,
      alpha:Math.max(0,Math.min(1,1-(frame-platform.spawnedFrame)/Math.max(1,platform.invincibilityFrames)))})),specialEffects,
    debugAreas:[...sim.playerSlots.filter(slot=>!sim.stockTracker.isEliminated(slot.playerIndex)).flatMap(slot=>{
      const actor=slot.character,position=actor.getPosition(),grab=actor.getGrabSpec();
      return computeFighterDebugBoxes({bodyX:position.x,bodyY:position.y,facing:actor.getFacing(),hurtboxes:actor.getActiveHurtboxes(),
        activeAttack:null,activeGrab:actor.getGrabState().name==='whiffActive'&&grab?{hitbox:grab.hitbox}:null});
    }),...analyticAttackDebugBoxes(sim.finalContactDebugCapsules),...sim.physicsWorld.world.getAllBodies().flatMap(sensor=>attackSensorDebugBoxes(sensor,
      sim.playerSlots.find(slot=>slot.character.body.id===sensor.plugin?.ownerBodyId)?.character.getPosition()))]};
}
