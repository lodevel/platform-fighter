import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// This tool observes the real Scene callback and real Matter contacts. Synthetic
// packets below are explicit threshold/attribute fixtures, not native attacks.
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const frozen=process.env.PF_FROZEN_SOURCE_DIR??'.tmp/dk-heavy-armor-checkpoint-10-source-leaves';
const expectedBundle=process.env.PF_EXPECT_BUNDLE_SHA;
assert(expectedBundle,'PF_EXPECT_BUNDLE_SHA is required: refuse an unbound application');
const filter=process.env.PF_PASSIVE_CASE_FILTER?new RegExp(process.env.PF_PASSIVE_CASE_FILTER):null;
const baseOut=process.env.PF_PASSIVE_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/heavy-armor-passive-checkpoint-10';
let out=baseOut;for(let i=2;;i++){try{await access(out);out=`${baseOut}-attempt${i}`;}catch{break;}}
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={url,out,frozenSourceDirectory:frozen,scope:'Source-scoped heavy carry armor through physical F pickup, native keypad P2 jab input and actual MatchScene/Matter contacts. Additional rawKB/attribute sensors are explicitly authored fixtures through the unchanged normal handler. Raw modifiedKB*.4 strict32 is the documented bounded classification calibration, not a recovered native calc_reaction_frame. Source carry body/held socket art is not qualified by this tool. Ordinary unsupported-domain reactions do not establish native resistance/drop. No direct applyHit invocation, input resolver override, combat resolver override or physics replacement.',sourceBindings:[],cases:[],errors:[],failedResponses:[]};
for(const path of ['src/characters/Character.ts','src/characters/combat.ts','src/characters/donkeykongHeavyArmor.ts','src/characters/donkeykongAttackReactionMetadata.ts','src/characters/donkeykongSourceMoves.ts','src/match/HitboxDamageHandler.ts','src/scenes/MatchScene.ts']){
 const capturedPath=`${frozen}/${path}`;report.sourceBindings.push({path,capturedPath,sha256:hash(await readFile(capturedPath))});
}
const primaryPath='docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art/firstclips-jab-native6-attack-source.json';
const primary=JSON.parse(await readFile(primaryPath));
assert.equal(hash(await readFile(primary.sourceCommand)),primary.sourceCommandSha256);
report.jabPrimary={packet:primaryPath,command:primary.sourceCommand,sha256:primary.sourceCommandSha256};
const metadata=await readFile('assets/characters/donkeykong/frames.json');report.metadataSha256=hash(metadata);
if(process.env.PF_EXPECT_DK_METADATA_SHA)assert.equal(report.metadataSha256,process.env.PF_EXPECT_DK_METADATA_SHA);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const cdp=await page.context().newCDPSession(page);
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const held=new Set();let keypadHeld=false;
const down=async key=>{if(!held.has(key)){await page.keyboard.down(key);held.add(key);}};
const up=async key=>{if(held.has(key)){await page.keyboard.up(key);held.delete(key);}};
const keypad=async type=>{await cdp.send('Input.dispatchKeyEvent',{type,key:'1',code:'Numpad1',windowsVirtualKeyCode:97,nativeVirtualKeyCode:97,isKeypad:true,location:3});keypadHeld=type==='rawKeyDown';};
const release=async()=>{for(const key of [...held])await up(key);if(keypadHeld)await keypad('keyUp');};
const step=async(n=1)=>page.evaluate(n=>window.__dkArmor.step(n),n);
const read=async()=>page.evaluate(()=>window.__dkArmor.read());
const check=(c,label,pass,actual,expected)=>c.checks.push({label,pass,actual,expected});
const near=(a,b,tolerance=1e-7)=>Number.isFinite(a)&&Math.abs(a-b)<=tolerance;
const capture=async(c,label)=>{await page.evaluate(()=>{const t=window.__dkArmor,p=t.a.getPosition(),cam=t.s.cameras.main;cam.setScroll(p.x-cam.width/2,p.y-cam.height/2);});const filename=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${filename}`});(c.captures??=[]).push({label,path:filename,observation:await read()});};
const run=async(name,fn)=>{if(filter&&!filter.test(name))return;await release();const c={name,checks:[]};report.cases.push(c);await fn(c);};
async function pickup(c,facing){
 await page.evaluate(f=>window.__dkArmor.reset(f),facing);c.crate=await page.evaluate(()=>window.__dkArmor.spawn());
 await down('f');c.pickupEntry=await step();await up('f');c.pickupTrace=[c.pickupEntry];
 for(let i=1;i<25;i++)c.pickupTrace.push(await step());
 const last=c.pickupTrace.at(-1);assert.equal(last.held,c.crate.id);assert.equal(last.carry?.phase,'wait');assert.equal(last.action,null);
 check(c,'physical F selects heavy pickup and callback5 commits reserved identity at age4',c.pickupEntry.action?.plan.action==='pickup'&&c.pickupTrace.slice(0,4).every(o=>o.held===null)&&c.pickupTrace[4].held===c.crate.id,c.pickupTrace.slice(0,5).map(o=>({held:o.held,age:o.action?.framesElapsed})),4);
 c.before=await page.evaluate(()=>window.__dkArmor.clearObservations());
}
try{
 report.scope='Actual source-scoped heavy loss through physical F pickup and normal Matter threshold fixture. Passive crate overlap is independently measured against the known native throw sphere/target movement bounds, then normal Scene item gravity/settlement is observed with an overlapping real recipient. Offstage/high-air position fixtures isolate actual passive lifecycle retirement; no timeout, physics, input or combat resolver overrides. The dormant nativeThrow definition remains present, so zero damage under real overlap is the acceptance condition. Heavy air catch is source-ineligible and is not fabricated.';
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);
 report.bundleSha256=hash(await(await page.request.get(report.bundle)).body());assert.equal(report.bundleSha256,expectedBundle);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810010,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene'),a=s.p1,b=s.p2;s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(p=>p.label==='platform.solid');
  for(const p of s.baseStage.bodies.platformBodies)if(p!==floor){p.collisionFilter.mask=0;s.matter.world.remove(p);}
  const clone=value=>JSON.parse(JSON.stringify(value));
  let contacts=[],results=[],drops=[],launches=[],inputSamples=[],keyboardEvents=[],sensors=[],trackedMove='',spawned=null;
  for(const type of ['keydown','keyup'])document.addEventListener(type,e=>keyboardEvents.push({type,key:e.key,code:e.code,keyCode:e.keyCode,location:e.location,numLock:e.getModifierState('NumLock')}),true);
  const heldItem=()=>s.getInventory(s.playerSlots[0].playerIndex).getHeldItem();
  const fighter=p=>({position:p.getPosition(),velocity:p.getVelocity(),facing:p.getFacing(),percent:p.getDamagePercent(),grounded:p.isGrounded(),freeze:p.getHitlagRemaining(),hitstun:p.getHitstunRemaining(),carry:p.getDonkeyKongHeavyCarryState(),action:p.getDonkeyKongHeavyItemActionState(),buried:p.getBuriedPresentationState(),attack:p.getActiveAttack()?{id:p.getActiveAttack().move.id,age:p.getActiveAttack().framesElapsed}:null,jumpsUsed:p.getJumpsUsed()});
  const read=()=>clone({frame:s.physicsEngine.getFrame(),...fighter(a),attacker:fighter(b),held:heldItem()?.id??null,socket:a.getHeldItemWorldPosition(),entity:spawned?{id:spawned.id,state:spawned.getSnapshot().state,position:spawned.getPosition()}:null,stale:trackedMove?b.getStaleOccurrences(trackedMove):null,stats:s.matchStatsTracker.getAllStats(s.physicsEngine.getFrame()),contacts,results,drops,launches,inputSamples,keyboardEvents,trajectories:s.thrownItems.map(t=>({id:t.entity.id,x:t.x,y:t.y,vx:t.vx,vy:t.vy,passiveDrop:t.passiveDrop===true,nativeThrow:t.nativeThrow,damagePower:t.damagePower})),fixtureAttackSensors:s.matter.world.getAllBodies().filter(p=>p.label==='hitbox.attack').map(p=>({id:p.id,moveId:p.plugin?.moveId,ownerBodyId:p.plugin?.ownerBodyId}))});
  const actualHit=a.applyHitDetailed.bind(a);a.applyHitDetailed=hit=>{
   const before={...fighter(a),socket:a.getHeldItemWorldPosition(),held:heldItem()?.id??null};
   const result=actualHit(hit);results.push(clone({frame:s.physicsEngine.getFrame(),hit,before,result,afterCharacter:fighter(a)}));return result;
  };
  const callback=s.hitboxDamageHandler.callback;s.hitboxDamageHandler.callback=(index,hit,context)=>{
   const outcome=callback(index,hit,context);contacts.push(clone({frame:s.physicsEngine.getFrame(),index,hit,context:{moveId:context.moveId,collisionHitId:context.collisionHitId,attackerBodyId:context.attackerBodyId,attackerPlayerIndex:context.attackerPlayerIndex,projectile:context.projectile},confirmation:outcome}));return outcome;
  };
  const actualInput=a.applyInput.bind(a);a.applyInput=(input,frame)=>{
   const before=fighter(a);const result=actualInput(input,frame);inputSamples.push(clone({frame,input,before,after:fighter(a)}));return result;
  };
  const step=(n=1)=>{for(let i=0;i<n;i++){
   const list=s.thrownItems,original=list.push;list.push=function(...items){for(const t of items)launches.push(clone({frame:s.physicsEngine.getFrame(),id:t.entity.id,x:t.x,y:t.y,vx:t.vx,vy:t.vy,passiveDrop:t.passiveDrop===true,nativeThrow:t.nativeThrow,damagePower:t.damagePower}));return original.apply(this,items);};
   s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();list.push=original;
  }return read();};
  let pending=true;s.itemSpawnTypeIndex=5;const tr=s.baseStage.transform,scale=s.stage.scale;
  s.itemSpawnManager.step=frame=>pending?(pending=false,[{frame,anchorIndex:0,anchor:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];
  step();const acquired=s.getItemRegistry().getActive().at(-1);if(acquired?.definition.type!=='crate')throw Error('Native crate fixture acquisition failed');
  const definition=acquired.definition,Entity=acquired.constructor;
  const clearObservations=()=>{contacts=[];results=[];drops=[];launches=[];inputSamples=[];keyboardEvents=[];return read();};
  const reset=facing=>{
   for(const p of sensors)s.matter.world.remove(p);sensors=[];
   for(const slot of s.playerSlots){s.getInventory(slot.playerIndex).detachWithoutDrop();slot.character.syncPikachuHeldItem(false);slot.character.syncDonkeyKongHeavyItem(false);}
   for(const item of s.getItemRegistry().getActive())item.markDespawned(s.physicsEngine.getFrame());for(const v of s.itemVisuals.values())v.destroy();s.itemVisuals.clear();s.itemSurfaceY.clear();s.itemFallingY.clear();s.thrownItems=[];
   s.donkeykongItemRequests.clear();s.donkeykongHeavyItemRequests.clear();s.donkeykongItemButtons.clear();s.donkeykongItemFlicks.clear();s.donkeykongItemRepeat.clear();s.suppressAttackUntilRelease.clear();
   a.resetForRound(floor.position.x-160,floor.bounds.min.y-42);b.resetForRound(floor.position.x+500,floor.bounds.min.y-42);a.setInvincibility(0);b.setInvincibility(0);a.setDamagePercent(0);b.setDamagePercent(0);step(12);a.setFacing(facing);b.setFacing(-facing);spawned=null;trackedMove='';clearObservations();return read();
  };
  const spawn=()=>{
   const p=a.getPosition();spawned=s.getItemRegistry().spawn(definition,{x:p.x+a.getFacing()*25,y:floor.bounds.min.y},s.physicsEngine.getFrame(),Entity);spawned.markGrounded(s.physicsEngine.getFrame(),spawned.getPosition());
   const visual=s.add.container(spawned.getPosition().x,spawned.getPosition().y,[s.add.rectangle(0,-37.5,89,75,0x97632e).setStrokeStyle(3,0x3a220d)]);s.itemVisuals.set(spawned.id,visual);
   const entity=spawned,actual=entity.markDropped.bind(entity);entity.markDropped=(...args)=>{drops.push(clone({frame:s.physicsEngine.getFrame(),id:entity.id,origin:args[1]}));return actual(...args);};return{id:entity.id,type:entity.definition.type};
  };
  const pulse=spec=>{
   trackedMove=`donkeykong.armor-fixture.${spec.name}`;const p=a.getPosition(),capsule={start:{x:0,y:0},end:{x:0,y:0},radius:3};
   const metadata={...(spec.attribute===undefined?{}:{nativeCollisionAttribute:spec.attribute}),...(spec.force===undefined?{}:{nativeForceReaction:spec.force}),...(spec.bury?{statusEffect:'bury'}:{})};
   const body=s.matter.add.rectangle(p.x,p.y-5,6,6,{label:'hitbox.attack',isSensor:true,ignoreGravity:true,frictionAir:0,collisionFilter:{category:8,mask:4},plugin:{ownerId:'donkeykong',ownerBodyId:b.body.id,moveId:trackedMove,attackKind:'ground',damage:spec.damage??3,hitlagMultiplier:1,direct:true,setoff:'off',knockback:{x:1,y:-1,scaling:0,...(spec.legacy?{}:{reference:{angle:45,base:spec.kb,growth:spec.growth??0}})},facing:a.getFacing(),hitbox:{offsetX:0,offsetY:0,width:6,height:6},collisionHits:[{id:0,capsule,...metadata}],...metadata,...(spec.projectile?{projectile:true}:{}),...(spec.electric?{electricCollision:true}:{})}});
   sensors.push(body);return{id:body.id,moveId:trackedMove,world:{x:p.x,y:p.y-5},explicitAuthoredFixture:true};
  };
  const retireSensors=()=>{for(const p of sensors)s.matter.world.remove(p);sensors=[];};
  const placeJabber=facing=>{const p=a.getPosition();s.matter.body.setPosition(b.body,{x:p.x-85*facing,y:p.y});s.matter.body.setVelocity(b.body,{x:0,y:0});b.setFacing(facing);trackedMove='donkeykong.jab';return{grounded:b.isGrounded(),attack:b.getActiveAttack(),position:b.getPosition()};};
  const inputDiagnostic=()=>{const slot=s.playerSlots[1];return{binding:s.registry.get('inputBindingsStore').getAction(slot.bindingsSlot,'attack'),logicalAttack:s.inputResolver.getAction(slot.bindingsSlot,'attack'),moveVector:s.inputResolver.getMoveVector(slot.bindingsSlot)};};
  window.__dkArmor={s,a,b,floor,read,step,reset,spawn,clearObservations,pulse,retireSensors,placeJabber,inputDiagnostic};
 });

 const drop=async(c,facing)=>{
  await pickup(c,facing);
  c.sensor=await page.evaluate(()=>window.__dkArmor.pulse({name:'passive-loss80',kb:80,attribute:'collision_attr_normal',force:false}));
  c.impact=await step();await page.evaluate(()=>window.__dkArmor.retireSensors());
  assert.equal(c.impact.results[0]?.result.heavyItemDrop?.reason,'threshold');
  assert.equal(c.impact.held,null);assert.equal(c.impact.drops.length,1);
  const initial=c.impact.launches.find(x=>x.id===c.crate.id);assert(initial?.passiveDrop);assert.equal(initial.vx,0);assert.equal(initial.vy,0);
  return c.impact;
 };
 for(const facing of [1,-1])await run(`actual-passive-overlap-and-ground-repickup-${facing}`,async c=>{
  await drop(c,facing);
  c.geometry=await page.evaluate(id=>{
   const t=window.__dkArmor,flight=t.s.thrownItems.find(x=>x.entity.id===id);if(!flight)throw Error('Actual passive trajectory must still exist');
   const profile=flight.entity.definition.nativeThrow;if(!profile)throw Error('Fixture must retain dormant native attack profile');
   const centre={x:flight.x,y:flight.y-profile.mapBottom*profile.pixelsPerUnit},radius=profile.attackRadius*profile.pixelsPerUnit;
   t.s.matter.body.setPosition(t.b.body,centre);t.s.matter.body.setVelocity(t.b.body,{x:0,y:0});t.b.setInvincibility(0);
   const bounds=t.b.body.bounds,closest={x:Math.max(bounds.min.x,Math.min(bounds.max.x,centre.x)),y:Math.max(bounds.min.y,Math.min(bounds.max.y,centre.y))};
   const distance=Math.hypot(centre.x-closest.x,centre.y-closest.y);
   return{centre,radius,bounds,distance,overlap:distance<=radius,sourceRadiusNative:profile.attackRadius,dormantDefinitionPresent:true,passive:flight.passiveDrop===true,percent:t.b.getDamagePercent(),held:t.s.getInventory(t.s.playerSlots[1].playerIndex).getHeldItem()?.id??null};
  },c.crate.id);
  assert(c.geometry.overlap);c.trace=[];c.postPhysicsOverlaps=[];
  for(let i=0;i<30;i++){
   c.trace.push(await step());
   c.postPhysicsOverlaps.push(await page.evaluate(id=>{
    const t=window.__dkArmor,item=t.s.getItemRegistry().getActive().find(x=>x.id===id);if(!item)return null;
    const p=item.getPosition(),profile=item.definition.nativeThrow,centre={x:p.x,y:p.y-profile.mapBottom*profile.pixelsPerUnit},radius=profile.attackRadius*profile.pixelsPerUnit,b=t.b.body.bounds;
    const distance=Math.hypot(centre.x-Math.max(b.min.x,Math.min(b.max.x,centre.x)),centre.y-Math.max(b.min.y,Math.min(b.max.y,centre.y)));
    const actor=t.b.getPosition(),facing=t.b.getFacing();
    const receivingWitnesses=t.b.getActiveHurtboxes().filter(h=>!h.intangible).map(h=>{
     if(h.capsule){
      const start={x:actor.x+h.capsule.start.x*facing,y:actor.y+h.capsule.start.y},end={x:actor.x+h.capsule.end.x*facing,y:actor.y+h.capsule.end.y};
      const dx=end.x-start.x,dy=end.y-start.y,length2=dx*dx+dy*dy;
      const parameter=length2?Math.max(0,Math.min(1,((centre.x-start.x)*dx+(centre.y-start.y)*dy)/length2)):0;
      const separation=Math.hypot(centre.x-start.x-parameter*dx,centre.y-start.y-parameter*dy);
      return{id:h.id,region:h.region,intangible:false,kind:'capsule',start,end,receivingRadius:h.capsule.radius,separation,overlap:separation<=radius+h.capsule.radius};
     }
     const x=actor.x+h.offsetX*facing,y=actor.y+h.offsetY;
     const rect={min:{x:x-h.width/2,y:y-h.height/2},max:{x:x+h.width/2,y:y+h.height/2}};
     const separation=Math.hypot(centre.x-Math.max(rect.min.x,Math.min(rect.max.x,centre.x)),centre.y-Math.max(rect.min.y,Math.min(rect.max.y,centre.y)));
     return{id:h.id,region:h.region,intangible:false,kind:'rectangle',rect,separation,overlap:separation<=radius};
    }).filter(w=>w.overlap);
    return{centre,radius,bounds:b,distance,overlap:distance<=radius,receivingWitnesses,state:item.getSnapshot().state};
   },c.crate.id));
  }
  const end=c.trace.at(-1);
  check(c,'independent known crate throw sphere overlaps actual recipient physical bounds',c.geometry.overlap&&near(c.geometry.sourceRadiusNative,9.119999885559082)&&c.geometry.dormantDefinitionPresent,c.geometry,{nativeRadius:9.119999885559082});
  check(c,'overlap persists at a completed actual Matter sample while passive flight is falling',c.postPhysicsOverlaps.some(o=>o?.overlap&&o.state==='falling'),c.postPhysicsOverlaps);
  check(c,'hypothetical native attack sphere independently overlaps actual vulnerable posed receiving during falling flight',c.postPhysicsOverlaps.some(o=>o?.state==='falling'&&o.receivingWitnesses.length>0),c.postPhysicsOverlaps.map(o=>o&&({state:o.state,centre:o.centre,radius:o.radius,receivingWitnesses:o.receivingWitnesses})));
  check(c,'overlapping passive drop causes no recipient damage or source item throw contact during real gravity/settlement',c.trace.every(o=>o.attacker.percent===c.geometry.percent&&o.contacts.every(x=>x.index!==1)),c.trace.map(o=>({percent:o.attacker.percent,entity:o.entity,contacts:o.contacts})),0);
  check(c,'passive crate settles through actual floor crossing and retires its flight once',end.entity?.state==='grounded'&&end.trajectories.every(t=>t.id!==c.crate.id)&&end.drops.length===1&&near(end.entity.position.y,(await page.evaluate(()=>window.__dkArmor.floor.bounds.min.y))),end);
  await capture(c,'overlap-settled');
  // Reacquisition uses P2's native keypad attack; keep the settled input state.
  // This is a ground heavy pickup, never an invented airborne heavy catch.
  c.repickupFixture=await page.evaluate(id=>{
   const t=window.__dkArmor,item=t.s.getItemRegistry().getActive().find(x=>x.id===id);if(!item?.isPickable())throw Error('Same dropped identity must really be grounded');
   const p=item.getPosition();t.s.matter.body.setPosition(t.b.body,{x:p.x-25,y:t.floor.bounds.min.y-42});t.s.matter.body.setVelocity(t.b.body,{x:0,y:0});t.b.setFacing(1);return{id:item.id,position:p};
  },c.crate.id);
  await step(12);assert((await read()).attacker.grounded);
  await keypad('rawKeyDown');c.repickupEntry=await step();await keypad('keyUp');
  const acquisition=[];for(let i=0;i<24;i++)acquisition.push(await step());
  c.reacquired=await page.evaluate(()=>{const t=window.__dkArmor;return{held:t.s.getInventory(t.s.playerSlots[1].playerIndex).getHeldItem()?.id??null,carry:t.b.getDonkeyKongHeavyCarryState(),action:t.b.getDonkeyKongHeavyItemActionState(),flights:t.s.thrownItems.map(x=>x.entity.id),entity:t.s.getInventory(t.s.playerSlots[1].playerIndex).getHeldItem()?.getSnapshot()};});
  check(c,'fresh physical P2 keypad attack reacquires the same grounded identity through heavy callback',c.repickupEntry.attacker.action?.plan.action==='pickup'&&c.reacquired.held===c.crate.id&&c.reacquired.carry?.phase==='wait'&&c.reacquired.action===null,c.reacquired,c.crate.id);
  check(c,'acquired identity has one holder and no stale passive flight owner',c.reacquired.entity?.state==='held'&&!c.reacquired.flights.includes(c.crate.id),c.reacquired);
  await capture(c,'reacquired');
 });
 for(const facing of [1,-1])await run(`actual-passive-offstage-retirement-${facing}`,async c=>{
  await drop(c,facing);
  c.positionFixture=await page.evaluate(id=>{
   const t=window.__dkArmor,flight=t.s.thrownItems.find(x=>x.entity.id===id),blast=t.s.baseStage.getViewportBlastZone();
   const position={x:blast.x+blast.width+100,y:Math.min(t.floor.bounds.min.y-400,blast.y+100)};
   flight.x=position.x;flight.y=position.y;flight.entity.updateFreePosition(position);flight.container.setPosition(position.x,position.y);
   return{position,blast,remaining:flight.framesRemaining,actualVelocity:{x:flight.vx,y:flight.vy},explicitPositionFixture:true};
  },c.crate.id);
  c.after=await step();
  check(c,'actual offstage passive lifecycle despawns rather than falsely grounding midair',c.after.entity?.state==='despawned'&&!c.after.trajectories.some(t=>t.id===c.crate.id),c.after.entity,c.positionFixture);
  c.visual=await page.evaluate(id=>window.__dkArmor.s.itemVisuals.has(id),c.crate.id);
  check(c,'offstage retirement destroys visual ownership and cannot create attack damage',!c.visual&&c.after.attacker.percent===0&&c.after.drops.length===1,c.after);
 });
 await run('actual-passive-natural-expiry-in-air',async c=>{
  await drop(c,1);
  c.positionFixture=await page.evaluate(id=>{
   const t=window.__dkArmor,flight=t.s.thrownItems.find(x=>x.entity.id===id),position={x:t.floor.position.x,y:t.floor.bounds.min.y-4000};
   flight.x=position.x;flight.y=position.y;flight.entity.updateFreePosition(position);flight.container.setPosition(position.x,position.y);
   return{position,remaining:flight.framesRemaining,explicitPositionFixture:true,noLifetimeOverride:true};
  },c.crate.id);
  assert(c.positionFixture.remaining>1);
  c.beforeExpiry=await step(c.positionFixture.remaining-1);c.expired=await step();
  check(c,'unchanged remaining lifetime keeps airborne passive flight until final actual tick',c.beforeExpiry.entity?.state==='falling'&&c.beforeExpiry.trajectories.some(t=>t.id===c.crate.id),c.beforeExpiry.entity,c.positionFixture.remaining-1);
  check(c,'actual timeout despawns airborne identity without midair ground transition or attack',c.expired.entity?.state==='despawned'&&!c.expired.trajectories.some(t=>t.id===c.crate.id)&&c.expired.attacker.percent===0,c.expired.entity);
 });
 assert(report.cases.length,'Filter selected no cases');
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(x=>!x.pass).map(x=>({case:c.name,...x})));report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);
 report.result=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS_PASSIVE_LIFECYCLE_SCOPE';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failedChecks:report.failedChecks},null,2));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}

