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
const filter=process.env.PF_ARMOR_CASE_FILTER?new RegExp(process.env.PF_ARMOR_CASE_FILTER):null;
const baseOut=process.env.PF_ARMOR_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/heavy-armor-checkpoint-10';
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
  window.__dkArmor={s,a,b,read,step,reset,spawn,clearObservations,pulse,retireSensors,placeJabber,inputDiagnostic};
 });

 // Expected math is independent of Character's classifier implementation.
 // Zero-growth fixture baseKB is exact even under the Scene fresh/stale/rage.
 const independentKB=hit=>{const r=hit.knockback.reference;if(!r)return undefined;const weight=hit.nativeCollisionAttribute==='collision_attr_bury'||hit.statusEffect==='bury'?100:127;const damage=(hit.baseDamage??hit.damage)*(1-(1-(hit.staleMultiplier??1))*.3);return(((hit.postPercent/10+hit.postPercent*damage/20)*1.4*200/(weight+100)+18)*r.growth/100+r.base);};
 async function verify(c,expectation,{realJab=false,projectile=false}={}){
  const o=await read(),row=o.results[0];assert(row,'Fixture must make real handler contact with the carry recipient');c.impact=o;c.contact=row;
  const hit={...row.hit,postPercent:row.before.percent+row.hit.damage};const kb=independentKB(hit);
  c.independentExpected={rawReferenceKnockback:kb,classificationProxy:kb===undefined?null:kb*.4,sourceWeight:hit.nativeCollisionAttribute==='collision_attr_bury'||hit.statusEffect==='bury'?100:127,postHitPercent:hit.postPercent};
  check(c,'contact follows actual registered Matter handler into normal Scene resolver',o.contacts.some(x=>x.index===0&&x.context.attackerBodyId===awaitBodyId&&x.confirmation?.confirmed===true),o.contacts);
  check(c,'damage and post-hit percent are applied exactly once',near(row.result.damageApplied,row.hit.damage)&&near(row.afterCharacter.percent,hit.postPercent),{damageApplied:row.result.damageApplied,percent:row.afterCharacter.percent},{damage:row.hit.damage,postPercent:hit.postPercent});
  check(c,'ordinary landed outcome preserves source-scoped resistance/drop signal',row.result.outcome==='landed'&&(expectation==='resist'?row.result.reactionResisted===true&&!row.result.heavyItemDrop:expectation==='unsupported'?row.result.reactionResisted===undefined&&!row.result.heavyItemDrop:row.result.reactionResisted===undefined&&row.result.heavyItemDrop?.reason===expectation),row.result,expectation);
  if(expectation==='resist')check(c,'weak supported rawKB is below80 without queued launch/burial',kb<80&&row.result.knockback.magnitude===0&&row.afterCharacter.hitstun===0&&row.afterCharacter.buried===null&&o.held===c.crate.id&&o.drops.length===0,row.afterCharacter,kb);
  else if(expectation!=='unsupported'){
   check(c,'supported loss detaches the exact prehit held identity once at saved socket',o.held===null&&o.drops.length===1&&o.drops[0].id===c.crate.id&&near(o.drops[0].origin.x,row.before.socket.x)&&near(o.drops[0].origin.y,row.before.socket.y),o.drops,row.before.socket);
   const flight=o.launches.find(x=>x.id===c.crate.id);
   check(c,'source drop creates zero-speed passive flight without an attack launch',flight?.passiveDrop===true&&flight.vx===0&&flight.vy===0&&flight.nativeThrow===undefined&&flight.damagePower===undefined,flight,{vx:0,vy:0,passiveDrop:true});
   check(c,'drop classification uses independently recomputed modified rawKB',near(row.result.heavyItemDrop.referenceKnockback,kb),row.result.heavyItemDrop,kb);
  }
  const h=Math.min(30,Math.floor((row.hit.damage*.65+6)*(row.hit.hitlagMultiplier??1)*(row.hit.electricCollision?1.5:1)));
  check(c,'contact starts independently expected victim hitlag',row.afterCharacter.freeze===h,row.afterCharacter.freeze,h);
  check(c,projectile?'detached fixture owner remains unfrozen':'direct owner freezes on resisted or launching flesh contact',projectile?o.attacker.freeze===0:o.attacker.freeze>0,o.attacker.freeze,projectile?0:h);
  await capture(c,'impact');
  const trace=[];for(let i=0;i<h+3;i++)trace.push(await step());c.afterTrace=trace;
  const end=trace.at(-1),statsBefore=c.before.stats;
  check(c,'normal damage stats and stale queue record one landed contact',end.results.length===1&&end.stale===1&&near(end.stats[0].damageTaken-statsBefore[0].damageTaken,row.hit.damage)&&near(end.stats[1].damageDealt-statsBefore[1].damageDealt,row.hit.damage),{results:end.results.length,stale:end.stale,stats:end.stats},row.hit.damage);
  if(expectation==='resist')check(c,'carry and exact held identity survive the hitlag boundary',end.held===c.crate.id&&end.carry!==null&&end.hitstun===0&&end.drops.length===0,end);
  if(expectation!=='resist'&&expectation!=='unsupported'&&!hit.statusEffect)check(c,'queued reference launch survives Scene inventory syncfalse',trace.some(x=>x.freeze===0&&x.hitstun>0&&Math.hypot(x.velocity.x,x.velocity.y)>1),trace.map(x=>({freeze:x.freeze,hitstun:x.hitstun,velocity:x.velocity})));
  if(expectation!=='resist'&&expectation!=='unsupported')check(c,'passive item retains no combat attack profile and releases only once',end.drops.length===1&&end.trajectories.filter(x=>x.id===c.crate.id).every(x=>x.passiveDrop&&x.nativeThrow===undefined&&x.damagePower===undefined),{drops:end.drops,trajectories:end.trajectories});
  if(realJab){const id=o.contacts.find(x=>x.index===0)?.context.collisionHitId,source=primary.collisionHits.find(x=>x.id===id)?.sourceRegion;assert(source,'Actual selected jab ID must have a pinned primary packet');check(c,'actual jab damage/launch/hitlag fields agree with independently pinned selected source ID',near(row.hit.baseDamage,source.damage)&&row.hit.knockback.reference?.base===source.BKB&&row.hit.knockback.reference?.growth===source.KBG&&near(row.hit.hitlagMultiplier,source.hitlag),{id,hit:row.hit},source);check(c,'native keypad97 physical input produced DK jab source normal/false packet',o.keyboardEvents.some(e=>e.type==='keydown'&&e.code==='Numpad1'&&e.keyCode===97)&&row.hit.nativeCollisionAttribute==='collision_attr_normal'&&row.hit.nativeForceReaction===false&&o.contacts.some(x=>x.context.moveId==='donkeykong.jab'),{keyboard:o.keyboardEvents,hit:row.hit});}
 }
 const awaitBodyId=await page.evaluate(()=>window.__dkArmor.b.body.id);
 for(const facing of [1,-1])await run(`real-dk-jab-resists-${facing}`,async c=>{
  await pickup(c,facing);c.attackerFixture=await page.evaluate(f=>window.__dkArmor.placeJabber(f),facing);assert(c.attackerFixture.grounded,'P2 must be settled before fresh physical attack');
  await keypad('rawKeyDown');c.input=await page.evaluate(()=>window.__dkArmor.inputDiagnostic());c.entry=await step();await keypad('keyUp');assert.equal(c.entry.attacker.attack?.id,'donkeykong.jab');
  for(let i=0;i<10&&!(await read()).results.length;i++)await step();await verify(c,'resist',{realJab:true});
 });
 const specs=[
  {name:'normal79',kb:79,attribute:'collision_attr_normal',force:false,expect:'resist'},
  {name:'normal80',kb:80,attribute:'collision_attr_normal',force:false,expect:'threshold'},
  {name:'normal81',kb:81,attribute:'collision_attr_normal',force:false,expect:'threshold'},
  {name:'electric20',kb:20,attribute:'collision_attr_elec',force:false,electric:true,expect:'resist'},
  {name:'rush20',kb:20,attribute:'collision_attr_rush',force:false,expect:'resist'},
  {name:'forced-electric20',kb:20,attribute:'collision_attr_elec',force:true,electric:true,expect:'forced-reaction'},
  {name:'sleep20',kb:20,attribute:'collision_attr_sleep',expect:'sleep'},
  {name:'sleep-ex20',kb:20,attribute:'collision_attr_sleep_ex',expect:'sleep'},
  {name:'bury79',kb:79,attribute:'collision_attr_bury',force:false,bury:true,expect:'resist'},
  {name:'bury-weight100',kb:30,growth:50,damage:10,percent:89.5,attribute:'collision_attr_bury',force:false,bury:true,expect:'threshold'},
  {name:'normal-missing-force',kb:20,attribute:'collision_attr_normal',expect:'unsupported'},
  {name:'unknown-attribute',kb:20,attribute:'collision_attr_future',force:false,expect:'unsupported'},
  {name:'missing-attribute',kb:20,force:false,expect:'unsupported'},
  {name:'legacy-reference-absent',kb:20,legacy:true,attribute:'collision_attr_normal',force:false,expect:'unsupported'},
  {name:'detached-normal20',kb:20,attribute:'collision_attr_normal',force:false,projectile:true,expect:'resist'},
 ];
 for(const facing of [1,-1])for(const spec of specs)await run(`fixture-${spec.name}-${facing}`,async c=>{
  await pickup(c,facing);if(spec.percent!==undefined)await page.evaluate(p=>window.__dkArmor.a.setDamagePercent(p),spec.percent);
  c.sensor=await page.evaluate(s=>window.__dkArmor.pulse(s),spec);c.first=await step();await page.evaluate(()=>window.__dkArmor.retireSensors());await verify(c,spec.expect,{projectile:spec.projectile});
 });
 for(const facing of [1,-1])await run(`resisted-freeze-no-sdi-${facing}`,async c=>{
  await pickup(c,facing);await page.evaluate(()=>{const t=window.__dkArmor;t.s.matter.body.setVelocity(t.a.body,{x:2,y:0});});
  c.sensor=await page.evaluate(()=>window.__dkArmor.pulse({name:'frozen-entry',kb:20,attribute:'collision_attr_normal',force:false}));c.impact=await step();await page.evaluate(()=>window.__dkArmor.retireSensors());assert(c.impact.results[0]?.result.reactionResisted);
  const row=c.impact.results[0],trace=[];let o=c.impact;
  for(let i=0;i<30&&o.freeze>0;i++){const key=i%2?'a':'d';await down(key);o=await step();await up(key);trace.push(o);}
  c.freezeTrace=trace;const frozenRows=trace.filter(x=>x.freeze>0);
  check(c,'stick edges during actual hitlag do not SDI or advance carry',frozenRows.every(x=>near(x.position.x,c.impact.position.x)&&near(x.position.y,c.impact.position.y)&&JSON.stringify(x.carry)===JSON.stringify(c.impact.carry)&&x.facing===facing),frozenRows.map(x=>({position:x.position,carry:x.carry,freeze:x.freeze})),c.impact.position);
  const restored=o.inputSamples.find(x=>x.before.freeze===1&&x.after.freeze===0);
  check(c,'last frozen input restores exactly captured velocity before Matter friction/integration',!!restored&&near(restored.after.velocity.x,row.before.velocity.x)&&near(restored.after.velocity.y,row.before.velocity.y),restored,row.before.velocity);
  check(c,'freeze boundary retains item and creates no queued launch',o.held===c.crate.id&&o.drops.length===0&&o.hitstun===0&&o.buried===null,o);
  await capture(c,'release');
 });
 await run('reset-clears-old-drop-signal',async c=>{
  await pickup(c,1);await page.evaluate(()=>window.__dkArmor.pulse({name:'reset-loss',kb:80,attribute:'collision_attr_normal',force:false}));await step();await page.evaluate(()=>window.__dkArmor.retireSensors());const first=await read();assert(first.results[0]?.result.heavyItemDrop);
  await pickup(c,1);await page.evaluate(()=>window.__dkArmor.a.setInvincibility(5));await page.evaluate(()=>window.__dkArmor.pulse({name:'protected-after-reset',kb:80,attribute:'collision_attr_normal',force:false}));c.protected=await step();await page.evaluate(()=>window.__dkArmor.retireSensors());
  check(c,'round reset plus protected next sensor cannot reuse old heavy loss signal',c.protected.held===c.crate.id&&c.protected.drops.length===0&&c.protected.results.every(x=>x.result.heavyItemDrop===undefined&&x.result.reactionResisted===undefined)&&c.protected.percent===0,c.protected);
  await capture(c,'protected');
 });
 assert(report.cases.length,'Filter selected no cases');
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(x=>!x.pass).map(x=>({case:c.name,...x})));report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);
 report.result=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS_CONSUMER_SCOPE';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failedChecks:report.failedChecks},null,2));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
