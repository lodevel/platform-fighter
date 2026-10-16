import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import ts from 'typescript';
import {afterAll,describe,expect,it} from 'vitest';
import {DonkeyKong} from './DonkeyKong';
import {Pikachu} from './Pikachu';
import {itemPhysicsFixture,NEUTRAL_INPUT as idle} from '../items/itemPhysicsFixture';
import {CRATE_DEFINITION} from '../items/Crate';
import {BARREL_DEFINITION} from '../items/Barrel';
import * as actions from '../items/itemActions';
import * as catches from '../items/itemCatch';
import * as acquisition from '../items/itemAcquisitionBounds';
import * as nativeThrow from '../items/nativeItemThrow';
import * as heavy from './donkeykongHeavyItems';
import { finalMeterStockRetentionRatio } from '../finalSmash/finalSmashMeter';
import type {CharacterInput} from './Character';
import {ItemEntity} from '../items/ItemEntity';
import {StockTracker} from '../match/StockTracker';
import {MatchStatsTracker} from '../match/MatchStatsTracker';
import {RespawnHandler} from '../match/RespawnHandler';
import {BlastZonePositionWatcher} from '../match/BlastZonePositionWatcher';
import {SimEventQueue} from '../sim/simEvents';

const require=createRequire(import.meta.url);
const Composite=require('../physics/matter/source/lib/body/Composite.js');
const Body=require('../physics/matter/source/lib/body/Body.js');
const measurements:Record<string,unknown>[]=[];
afterAll(()=>{if(process.env.CARRY_MEASUREMENTS_PATH)writeFileSync(process.env.CARRY_MEASUREMENTS_PATH,JSON.stringify(measurements,null,2)+'\n');});

// Execute production Scene consumers, without loading its graphics/audio app.
// No replacement item planner, cleanup logic or physics is authored by this fixture.
const source=ts.createSourceFile('MatchSim.ts',readFileSync(new URL('../sim/MatchSim.ts',import.meta.url),'utf8'),ts.ScriptTarget.ES2022,true);
const klass=source.statements.find((node):node is ts.ClassDeclaration=>ts.isClassDeclaration(node)&&node.name?.text==='MatchSim')!;
const methodNames=['fighterItemRectangle','prepareItemInput','dropHeldItemAfterDamage','commitDonkeyKongHeavyItemEvents','recordStockLossWithStats','removeItem'];
const methods=methodNames.map(name=>klass.members.find((node):node is ts.MethodDeclaration=>ts.isMethodDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)!.getText(source));
const compiled=ts.transpileModule(`class HeavyHost {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const dependencies={...actions,...catches,...acquisition,...nativeThrow,...heavy,finalMeterStockRetentionRatio,
  emitCombatSfx:()=>{},ASSET_KEYS:{sfxKo:'ko'}};
const HeavyHost=new Function(...Object.keys(dependencies),`${compiled};return HeavyHost;`)(...Object.values(dependencies));

function fixture(Fighter:typeof Pikachu|typeof DonkeyKong,definition=CRATE_DEFINITION){
  const f=itemPhysicsFixture(Fighter,definition),slot={playerIndex:0,character:f.actor};let frame=20;
  let committedVelocity=f.actor.getVelocity();const apply=f.actor.applyInput.bind(f.actor);
  f.actor.applyInput=(...args)=>{apply(...args);committedVelocity=f.actor.getVelocity();};
  const visual={setPosition(){return this;},setScale(){return this;},setAngle(){return this;},destroy(){}};
  const host=new HeavyHost();
  for(const name of ['itemFrozen','itemButtons','itemRepeat','itemCatchEdges','itemFlicks','itemPickupRequests','donkeykongHeavyItemRequests','itemSurfaceY','itemFallingY','suppressAttackUntilRelease','containerStrikeFrames','hammerAreasVisual'])host[name]=new Map();
  // Stock-loss collaborators outside the item path (recovery receipts, KO frames, Final Meter).
  Object.assign(host,{simEvents:new SimEventQueue(),pendingRecoveryEvents:[],acceptedStockLossFrames:new Map(),activeMatchConfig:{mode:'stocks'},
    matchRules:{getScores:()=>[0],isSuddenDeath:()=>false},smashBallRuntime:null,finalSmashController:null,consumeFinalEvents:()=>{}});
  Object.assign(host,{inventoriesByPlayerIndex:new Map([[0,f.inventory]]),playerSlots:[slot],itemVisuals:new Map([[f.bat.id,visual]]),thrownItems:[],
    itemRegistry:{getActive:()=>[f.bat],getGrounded:()=>f.bat.isPickable()?[f.bat]:[]},
    stockTracker:{isEliminated:()=>false}});
  const step=(input:CharacterInput=idle)=>{
    const adapted=host.prepareItemInput(slot,input,++frame,f.actor.getFacing());
    f.step(adapted);
    const events=f.actor.drainDonkeyKongHeavyItemActionEvents();
    host.commitDonkeyKongHeavyItemEvents(events.map(event=>({playerIndex:0,event})),frame);
    return events;
  };
  return {...f,host,slot,step,frame:()=>frame,committedVelocity:()=>committedVelocity};
}

describe('heavy carry through production Scene inputs and real Matter',()=>{
  it.each([1,-1] as const)('W+F up flick keeps Pikachu grounded until native15 heavy release, facing%i',facing=>{
    const f=fixture(Pikachu);f.actor.setFacing(facing);f.step();
    // Exact keyboard W supplies up AND jump; F supplies a fresh attack.
    f.step({...idle,moveY:-1,jump:true,attack:true});
    expect(f.actor.getDonkeyKongHeavyItemActionState()?.plan.action).toBe('throw-up-strong');
    expect(f.actor.getJumpsquatRemaining()).toBe(0);
    for(let age=1;age<14;age++){
      expect(f.step()).toEqual([]);expect(f.actor.isGrounded()).toBe(true);
      expect(f.actor.getJumpsquatRemaining()).toBe(0);expect(f.inventory.getHeldItem()).toBe(f.bat);
    }
    const events=f.step();expect(events.map(event=>[event.kind,event.plan.sourceEventFrame])).toEqual([['release',15]]);
    expect(f.actor.isGrounded()).toBe(true);expect(f.inventory.isHolding()).toBe(false);
    expect(f.host.thrownItems).toHaveLength(1);expect(f.host.thrownItems[0].passiveDrop).toBeUndefined();
    expect(f.host.thrownItems[0].vy).toBeLessThan(0);expect(f.actor.getJumpsUsed()).toBe(0);
    for(let age=0;age<25;age++)f.step();expect(f.actor.isGrounded()).toBe(true);expect(f.actor.getJumpsUsed()).toBe(0);
    measurements.push({case:'pikachu-real-W-plus-F-up',facing,releaseNativeFrame:15,held:false,grounded:f.actor.isGrounded(),jumpsUsed:f.actor.getJumpsUsed(),trajectories:f.host.thrownItems.length});
  });
  it.each([1,-1] as const)('real stock/respawn path retires held DK Barrel while preserving a free owner Barrel, facing%i',facing=>{
    const f=fixture(DonkeyKong,BARREL_DEFINITION);f.actor.setFacing(facing);f.step();
    const free=new ItemEntity(2,BARREL_DEFINITION,0,{x:40,y:20});free.markGrounded(0,{x:40,y:20});
    f.host.itemVisuals.set(free.id,{destroy(){}});f.host.thrownItems.push({entity:free,ownerSlotIndex:0,x:40,y:20,vx:2,vy:0});
    f.host.stockTracker=new StockTracker({playerCount:1,stockCount:2,respawnDelayFrames:0});
    f.host.matchStatsTracker=new MatchStatsTracker({playerCount:1});
    const respawn=new RespawnHandler();respawn.registerSlot({playerIndex:0,spawnX:0,spawnY:0,faceOnSpawn:facing},f.actor);
    const oldGeneration=f.actor.getPositionResetGeneration(),plan=heavy.heavyItemPlan('donkeykong','throw-up-ordinary');
    f.host.donkeykongHeavyItemRequests.set(0,{entity:f.bat,action:plan.action,resetGeneration:oldGeneration});
    const watcher=new BlastZonePositionWatcher({left:-500,right:500,top:-500,bottom:500},event=>f.host.recordStockLossWithStats(event.playerIndex,event.frame));
    watcher.registerPlayer(0,f.actor.body);Body.setPosition(f.actor.body,{x:501*facing,y:0});
    expect(watcher.update(f.frame())).toHaveLength(1);expect(f.host.stockTracker.getStocks(0)).toBe(1);
    expect(f.inventory.isHolding()).toBe(false);expect(f.bat.isDespawned()).toBe(true);
    expect(f.actor.getDonkeyKongHeavyCarryState()).toBeNull();expect(f.actor.getDonkeyKongHeavyItemActionState()).toBeNull();
    expect(f.host.donkeykongHeavyItemRequests.size).toBe(0);
    expect(f.host.thrownItems).toHaveLength(1);expect(f.host.thrownItems[0].entity).toBe(free);expect(free.isDespawned()).toBe(false);
    expect(respawn.applyRespawns(f.host.stockTracker.consumePendingRespawns(f.frame()),f.frame())).toHaveLength(1);
    expect(f.actor.getEquippedItem()).toBeNull();expect(f.inventory.isHolding()).toBe(false);
    f.host.commitDonkeyKongHeavyItemEvents([{playerIndex:0,event:{kind:'release',plan,facing,entryFacing:facing,entryFrame:0}}],f.frame());
    expect(f.host.thrownItems).toHaveLength(1);expect(f.host.thrownItems[0].entity).toBe(free);
    measurements.push({case:'dk-real-stock-respawn',facing,stocks:f.host.stockTracker.getStocks(0),held:f.inventory.isHolding(),retiredHeldItem:f.bat.isDespawned(),freeOwnerItemPreserved:!free.isDespawned(),pendingHeavy:f.host.donkeykongHeavyItemRequests.size});
  });
  it.each([1,-1] as const)('Pikachu slow walk moves toward %i and blocks jump/ordinary offenses/defense',facing=>{
    const f=fixture(Pikachu);f.actor.setFacing(facing);const origin=f.actor.getPosition();
    for(let age=0;age<25;age++)f.step({...idle,moveX:facing,jump:true,special:true,shield:true,dodge:true,appeal:true});
    expect(f.inventory.getHeldItem()).toBe(f.bat);expect(f.actor.isGrounded()).toBe(true);
    expect((f.actor.getPosition().x-origin.x)*facing).toBeGreaterThan(50);
    // Native fighter_param item_lift_speed_max=.84208, source-supported cap adapter.
    expect(f.committedVelocity().x).toBeCloseTo(facing*.84208*5,6);
    // Matter's floor solver applies friction after the source speed commit.
    expect(Math.abs(f.actor.getVelocity().x)).toBeLessThanOrEqual(.84208*5);
    expect(f.actor.getJumpsUsed()).toBe(0);expect(f.actor.getJumpsquatRemaining()).toBe(0);
    expect(f.actor.getActiveAttack()).toBeNull();expect(f.actor.getShieldState().name).toBe('idle');
    expect(f.actor.getLocomotionStateName()).not.toBe('run');
    expect(f.actor.getPikachuItemPresentationState()?.sheet).toBe('item_heavy_walk');
    measurements.push({case:'pikachu-slow-carry',facing,expectedCap:.84208*5*facing,
      committedVelocity:f.committedVelocity(),matterVelocity:f.actor.getVelocity(),position:f.actor.getPosition(),grounded:f.actor.isGrounded(),sheet:f.actor.getPikachuItemPresentationState()?.sheet});
    f.step({...idle,moveX:-facing});
    expect(f.actor.getFacing()).toBe(-facing);expect(f.actor.getDonkeyKongHeavyCarryState()?.facing).toBe(-facing);
  });
  it('actual support loss drops Pikachu heavy item and interrupts its action once',()=>{
    const f=fixture(Pikachu);f.step();Composite.remove(f.engine.world,f.floor);
    for(let age=0;age<12&&f.inventory.isHolding();age++)f.step();
    expect(f.actor.isGrounded()).toBe(false);expect(f.inventory.isHolding()).toBe(false);
    expect(f.actor.getDonkeyKongHeavyCarryState()).toBeNull();expect(f.actor.getDonkeyKongHeavyItemActionState()).toBeNull();
    expect(f.bat.getSnapshot().state).toBe('falling');expect(f.host.thrownItems).toHaveLength(1);
    expect(f.host.thrownItems[0]).toMatchObject({entity:f.bat,passiveDrop:true,vx:0,vy:0});
    measurements.push({case:'pikachu-real-support-loss',grounded:f.actor.isGrounded(),held:f.inventory.isHolding(),trajectoryCount:f.host.thrownItems.length,itemState:f.bat.getSnapshot().state});
    for(let age=0;age<4;age++)f.step();expect(f.host.thrownItems).toHaveLength(1);
  });
  it('landed Pikachu damage is unarmored; production cleanup detaches heavy inventory without duplication',()=>{
    const f=fixture(Pikachu);f.step();
    const before={entity:f.bat,position:f.actor.getHeldItemWorldPosition(),resetGeneration:f.actor.getPositionResetGeneration()};
    const result=f.actor.applyHitDetailed({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:2,y:-1,scaling:0}});
    expect(result.outcome).toBe('landed');expect(result.reactionResisted).toBeUndefined();
    f.host.dropHeldItemAfterDamage(f.slot,before,f.frame());f.host.dropHeldItemAfterDamage(f.slot,before,f.frame());
    expect(f.inventory.isHolding()).toBe(false);expect(f.actor.getDonkeyKongHeavyCarryState()).toBeNull();
    expect(f.host.thrownItems).toHaveLength(1);expect(f.bat.isHeld()).toBe(false);
  });
  it.each([Pikachu,DonkeyKong])('%s reset clears pending source actions and stale-generation release cannot throw a respawned item',Fighter=>{
    const f=fixture(Fighter);f.step();
    expect(f.actor.beginDonkeyKongHeavyItemAction('throw-forward-ordinary',f.frame()+1)).toBe(true);
    const plan=heavy.heavyItemPlan(Fighter===Pikachu?'pikachu':'donkeykong','throw-forward-ordinary');
    const oldGeneration=f.actor.getPositionResetGeneration();
    f.host.donkeykongHeavyItemRequests.set(0,{entity:f.bat,action:plan.action,resetGeneration:oldGeneration});
    f.actor.resetForRound(100,0);
    expect(f.actor.getDonkeyKongHeavyCarryState()).toBeNull();expect(f.actor.getDonkeyKongHeavyItemActionState()).toBeNull();
    expect(f.actor.drainDonkeyKongHeavyItemActionEvents()).toEqual([]);
    f.host.commitDonkeyKongHeavyItemEvents([{playerIndex:0,event:{kind:'release',plan,facing:1,entryFacing:1,entryFrame:0}}],f.frame());
    expect(f.host.thrownItems).toEqual([]);expect(f.host.donkeykongHeavyItemRequests.size).toBe(0);
  });
  it('Pikachu cannot acquire a heavy item in actual air',()=>{
    const f=fixture(Pikachu);f.inventory.drop(f.frame(),f.actor.getPosition(),'reset');f.bat.markGrounded(f.frame(),f.actor.getPosition());
    Composite.remove(f.engine.world,f.floor);for(let age=0;age<8;age++)f.step();
    expect(f.actor.isGrounded()).toBe(false);expect(f.actor.beginDonkeyKongHeavyItemAction('pickup',f.frame()+1)).toBe(false);
    f.step({...idle,attack:true});expect(f.inventory.isHolding()).toBe(false);
  });
  it.each([1,-1] as const)('Pikachu pickup callback commits inventory at native4 only, facing%i',facing=>{
    const f=fixture(Pikachu);f.actor.setFacing(facing);f.inventory.drop(f.frame(),f.actor.getPosition(),'reset');f.bat.markGrounded(f.frame(),f.actor.getPosition());
    expect(f.step({...idle,attack:true})).toEqual([]);expect(f.inventory.isHolding()).toBe(false);
    f.step();f.step();expect(f.inventory.isHolding()).toBe(false);
    expect(f.step().map(event=>[event.kind,event.plan.sourceEventFrame])).toEqual([['pickup',4]]);
    expect(f.inventory.getHeldItem()).toBe(f.bat);expect(f.actor.getFacing()).toBe(facing);
  });
  it('DK carries at its retained1.1 walk cap and its actual accelerating motion visits every gait',()=>{
    const f=fixture(DonkeyKong,BARREL_DEFINITION);f.step();const seen=new Set<string>([f.actor.getPackedBodyState().heavyItem!.sheet]);
    for(let age=0;age<30;age++){f.step({...idle,moveX:1});seen.add(f.actor.getPackedBodyState().heavyItem?.sheet??'');}
    expect(seen).toEqual(new Set(['super_lift_wait','super_lift_walk_slow','super_lift_walk_middle','super_lift_walk_fast']));
    expect(f.committedVelocity().x).toBeCloseTo(1.365*5*1.1,6);
    expect(f.actor.getVelocity().x).toBeLessThanOrEqual(1.365*5*1.1);expect(f.inventory.getHeldItem()).toBe(f.bat);
    measurements.push({case:'dk-carry-gaits',expectedCap:1.365*5*1.1,committedVelocity:f.committedVelocity(),matterVelocity:f.actor.getVelocity(),sheets:[...seen]});
  });
  it('a pickup callback freezes across actual attacker hitlag rather than committing during the pause',()=>{
    const f=fixture(Pikachu);f.inventory.drop(f.frame(),f.actor.getPosition(),'reset');f.bat.markGrounded(f.frame(),f.actor.getPosition());
    f.step({...idle,attack:true});f.actor.armAttackerHitlag(4);
    for(let age=0;age<4;age++){expect(f.step()).toEqual([]);expect(f.inventory.isHolding()).toBe(false);}
    f.step();f.step();expect(f.inventory.isHolding()).toBe(false);f.step();expect(f.inventory.getHeldItem()).toBe(f.bat);
  });
  it('Pikachu back-throw reverses before release and production throw velocity/release offset use that new basis',()=>{
    for(const facing of [1,-1] as const){
      const f=fixture(Pikachu);f.actor.setFacing(facing);f.step();
      // Explicit source action entry isolates chronology from flick classification.
      expect(f.actor.beginDonkeyKongHeavyItemAction('throw-back-ordinary',f.frame()+1,facing)).toBe(true);
      f.host.donkeykongHeavyItemRequests.set(0,{entity:f.bat,action:'throw-back-ordinary',resetGeneration:f.actor.getPositionResetGeneration()});
      f.step();for(let age=1;age<18;age++){f.step();expect(f.actor.getFacing()).toBe(facing);expect(f.inventory.isHolding()).toBe(true);}
      expect(f.step().map(event=>event.kind)).toEqual(['reverse-facing']);expect(f.actor.getFacing()).toBe(-facing);expect(f.inventory.isHolding()).toBe(true);
      f.step();f.step();const position=f.actor.getPosition();
      expect(f.step().map(event=>event.kind)).toEqual(['release']);expect(f.inventory.isHolding()).toBe(false);
      const thrown=f.host.thrownItems[0];expect(thrown.vx*facing).toBeLessThan(0);
      measurements.push({case:'pikachu-back-release',facing,actorFacing:f.actor.getFacing(),release:{x:thrown.x,y:thrown.y,vx:thrown.vx,vy:thrown.vy},callbackNativeFrame:22,reverseNativeFrame:19});
      expect(thrown.x).toBeCloseTo(position.x-14*5*facing,6);
      expect(thrown.y).toBeCloseTo(f.actor.getPosition().y+f.actor.getTuning().height/2-16*5,6);
      for(let age=0;age<20;age++)f.step();expect(f.host.thrownItems).toHaveLength(1);
    }
  });
});
