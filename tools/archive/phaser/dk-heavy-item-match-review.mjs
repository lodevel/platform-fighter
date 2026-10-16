import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const caseFilter=process.env.PF_HEAVY_CASE_FILTER?new RegExp(process.env.PF_HEAVY_CASE_FILTER):null;
const out=process.env.PF_HEAVY_OUT??`docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/heavy-items-checkpoint-07${caseFilter?'-filtered':''}`;
const checkpoint=process.env.PF_HEAVY_CHECKPOINT??'.tmp/dk-mechanics-checkpoint-07';
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={url,scope:'Actual physical F pickup and F/T heavy directional throws, live MatchScene/Matter inventory callbacks and source carry status gates. Public registry/reset/initial velocity fixtures and observational push/drop recording only; no input resolver, damage resolver or physics override. Unit get/throw motion rate remains selected authored over unrecovered common2/1.33 caller;6/12/18/26 resource-entry phase adapters, walking acceleration/middle gait and common jump impulse remain calibrated. Heavy receiving/socket/body art and source reaction-frame armor conversion remain unqualified.',errors:[],cases:[],sourceBindings:[]};
report.caseSelection=process.env.PF_HEAVY_CASE_FILTER??'all';
for(const p of ['src/characters/Character.ts','src/characters/donkeykongHeavyItems.ts','src/characters/donkeykongHeavyCarry.ts','src/items/Crate.ts','src/items/nativeItemThrow.ts']){
 const captured=`${checkpoint}-source-leaves/${p}`;
 report.sourceBindings.push({path:p,capturedPath:captured,sha256:sha(await readFile(captured))});
}
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
const held=new Set();
const down=async k=>{if(!held.has(k)){await page.keyboard.down(k);held.add(k);}};
const up=async k=>{if(held.has(k)){await page.keyboard.up(k);held.delete(k);}};
const release=async()=>{for(const k of [...held])await up(k);};
const step=async(n=1)=>page.evaluate(n=>window.__dkHeavy.step(n),n);
const check=(label,pass,actual,expected)=>({label,pass,actual,expected});
const capture=async(c,label)=>{await page.evaluate(()=>{const t=window.__dkHeavy,p=t.a.getPosition(),camera=t.s.cameras.main;camera.setScroll(p.x-camera.width/2,p.y-camera.height/2);});const p=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${p}`});(c.captures??=[]).push(p);};
const run=async(name,fn)=>{if(caseFilter&&!caseFilter.test(name))return;await release();const c={name,checks:[]};report.cases.push(c);await fn(c);await capture(c,'final');};
const directionKey=(direction,facing)=>direction==='up'?'w':direction==='down'?'s':(direction==='forward'?facing:-facing)===1?'d':'a';
async function pickup(c,{facing=1,ordinaryDirection=null,air=false}={}){
 await page.evaluate(f=>window.__dkHeavy.reset(f),facing);c.spawn=await page.evaluate(()=>window.__dkHeavy.spawn());
 await down('f');c.pickupEntry=await step();await up('f');
 const prefix=[];for(let i=0;i<12;i++)prefix.push(await step());
 if(ordinaryDirection)await down(directionKey(ordinaryDirection,facing));
 for(let i=0;i<12;i++)prefix.push(await step());
 c.pickupTrace=[c.pickupEntry,...prefix];c.pickupEnd=c.pickupTrace.at(-1);
 assert.equal(c.pickupEntry.action?.plan.action,'pickup');assert.equal(c.pickupEnd.action,null);assert.equal(c.pickupEnd.held,c.spawn.id);
 c.checks.push(check('physical F selects native heavy pickup without fighter attack',c.pickupEntry.action?.plan.action==='pickup'&&c.pickupEntry.held===null&&c.pickupEntry.attack===null,c.pickupEntry),
  check('selected unit-rate native5 pickup commits exact identity at age4',c.pickupTrace.slice(0,4).every(o=>o.held===null)&&c.pickupTrace[4].held===c.spawn.id,c.pickupTrace.slice(0,5),4));
 if(air){await page.evaluate(()=>window.__dkHeavy.air());await step(2);assert.equal((await page.evaluate(()=>window.__dkHeavy.read())).grounded,false);}
}
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);
 report.bundleSha256=sha(await(await page.request.get(report.bundle)).body());
 if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810097,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene'),a=s.p1;s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  let releases=[],launches=[],pending=true;s.itemSpawnTypeIndex=5;
  const tr=s.baseStage.transform,scale=s.stage.scale;
  s.itemSpawnManager.step=frame=>pending?(pending=false,[{frame,anchorIndex:0,anchor:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];
  const read=()=>({frame:s.physicsEngine.getFrame(),position:a.getPosition(),velocity:a.getVelocity(),facing:a.getFacing(),grounded:a.isGrounded(),freeze:a.getHitlagRemaining(),action:a.getDonkeyKongHeavyItemActionState(),carry:a.getDonkeyKongHeavyCarryState(),body:a.getPackedBodyState(),held:s.getInventory(s.playerSlots[0].playerIndex).getHeldItem()?.id??null,attack:a.getActiveAttack()?.move.id??null,grab:a.getGrabState().name,dodge:a.getDodgeState().name,shield:a.getShieldState().name,jumpsUsed:a.getJumpsUsed(),jump:a.getJumpPresentationState(),dropThrough:a.isInDropThroughWindow(),ledge:a.getLedgeHangState().name,recipient:a.getFootstoolParticipant(1,{moveX:0,jump:false}).mayReceive,releases:JSON.parse(JSON.stringify(releases)),launches:JSON.parse(JSON.stringify(launches))});
  const step=(n=1)=>{for(let i=0;i<n;i++){
   // Observe initial launch before item flight retirement; down throws may
   // legitimately settle in this same real physics step. Preserve push return.
   const list=s.thrownItems,original=list.push;
   list.push=function(...items){for(const item of items)launches.push({frame:s.physicsEngine.getFrame(),id:item.entity.id,x:item.x,y:item.y,vx:item.vx,vy:item.vy,power:item.damagePower});return original.apply(this,items);};
   s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();
   list.push=original;
  }return read();};
  step();const acquired=s.getItemRegistry().getActive().at(-1);if(acquired?.definition.type!=='crate')throw Error('Source crate rotation fixture missing');
  const definition=acquired.definition,Entity=acquired.constructor;
  const reset=facing=>{
   s.getInventory(s.playerSlots[0].playerIndex).detachWithoutDrop();a.syncPikachuHeldItem(false);a.syncDonkeyKongHeavyItem(false);
   for(const item of s.getItemRegistry().getActive())item.markDespawned(s.physicsEngine.getFrame());
   // Fixture teleports/forced retirement skip ordinary lifecycle visuals.
   // Retire those explicit fixture handles before taking the next screenshot.
   for(const visual of s.itemVisuals.values())visual.destroy();s.itemVisuals.clear();
   s.itemSurfaceY.clear();s.itemFallingY.clear();
   s.thrownItems=[];s.donkeykongItemRequests.clear();s.donkeykongHeavyItemRequests.clear();s.donkeykongItemButtons.clear();s.donkeykongItemFlicks.clear();s.donkeykongItemRepeat.clear();s.suppressAttackUntilRelease.clear();
   a.resetForRound(floor.position.x-180,floor.bounds.min.y-42);s.p2.resetForRound(floor.bounds.max.x-20,floor.bounds.min.y-42);a.setInvincibility(0);a.setDamagePercent(0);
   step(12);a.setFacing(facing);releases=[];launches=[];return read();
  };
  const spawn=()=>{
   const p=a.getPosition(),entity=s.getItemRegistry().spawn(definition,{x:p.x+a.getFacing()*25,y:floor.bounds.min.y},s.physicsEngine.getFrame(),Entity);
   entity.markGrounded(s.physicsEngine.getFrame(),entity.getPosition());
   const visual=s.add.container(entity.getPosition().x,entity.getPosition().y,[s.add.rectangle(0,-37.5,89,75,0x97632e).setStrokeStyle(3,0x3a220d)]);s.itemVisuals.set(entity.id,visual);
   const original=entity.markDropped.bind(entity);entity.markDropped=(...args)=>{releases.push({frame:s.physicsEngine.getFrame(),id:entity.id,origin:args[1]});return original(...args);};
   return{id:entity.id,definition:entity.definition.type,position:entity.getPosition()};
  };
  const air=()=>{const top=Math.min(...s.baseStage.bodies.platformBodies.map(p=>p.bounds.min.y));s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:top-450});s.matter.body.setVelocity(a.body,{x:0,y:0});};
  window.__dkHeavy={s,a,floor,step,read,reset,spawn,air};
 });
 for(const air of [false,true])for(const facing of [1,-1])for(const direction of ['forward','back','up','down'])for(const strong of [false,true])await run(`throw-${air?'air':'ground'}-${direction}-${strong?'strong':'ordinary'}-${facing}`,async c=>{
  await pickup(c,{facing,ordinaryDirection:strong?null:direction,air});
  // Ordinary direction ages through pickup's existing commitment; backward
  // cannot turn the held actor before throw entry. No synthetic analog route.
  if(strong)await down(directionKey(direction,facing));
  const button=direction==='forward'?'f':'t';await down(button);c.entry=await step();await up(button);
  const action=`throw-${direction}-${strong?'strong':'ordinary'}`;assert.equal(c.entry.action?.plan.action,action);
  const sourceFrame={forward:18,back:20,up:15,down:14}[direction];c.trace=[c.entry];
  for(let i=1;i<40;i++)c.trace.push(await step());
  const releaseIndex=c.trace.findIndex(o=>o.releases.some(r=>r.id===c.spawn.id)),event=c.trace[releaseIndex];
  const launch=event?.launches.find(l=>l.id===c.spawn.id);
  const speed=(direction==='up'||direction==='down'?(strong?6:4.8):(strong?4.4:3.4))*1.09*5;
  const angle=(direction==='up'?90:direction==='down'?-90:strong?17:60)*Math.PI/180;
  const rawX=Math.cos(angle)*speed*(direction==='back'?-facing:facing),rawY=-Math.sin(angle)*speed;
  const expected={vx:Math.max(-12,Math.min(12,rawX*.7*.7)),vy:Math.min(11,rawY*.7)};
  c.checks.push(check('physical F/T selected exact source direction and flick strength',c.entry.action?.plan.action===action,c.entry.action?.plan.action,action),
   check('item remains held until selected native callback minus1',releaseIndex===sourceFrame-1&&c.trace.slice(0,releaseIndex).every(o=>o.held===c.spawn.id)&&event.held===null,releaseIndex,sourceFrame-1),
   check('source heavy throw velocity plus independent published crate profile measured before same-step retirement',!!launch&&Math.abs(launch.vx-expected.vx)<1e-7&&Math.abs(launch.vy-expected.vy)<1e-7,launch,expected),
   check('source back releases on old entry world side then reverses at same callback',direction==='back'?c.trace.slice(0,releaseIndex).every(o=>o.facing===facing)&&event.facing===-facing&&Math.sign(launch.x-event.position.x)===-facing:c.trace.slice(0,releaseIndex+1).every(o=>o.facing===facing),event),
   check('heavy NO_REAC remains after item release until throw commitment exits',c.trace.slice(0,releaseIndex+1).every(o=>!o.recipient)&&c.trace.slice(releaseIndex).filter(o=>o.action).every(o=>!o.recipient),c.trace.slice(releaseIndex,releaseIndex+3).map(o=>({held:o.held,action:o.action?.framesElapsed,recipient:o.recipient}))),
   check('one release without fighter attacks or grabs across held directions',c.trace.at(-1).releases.filter(r=>r.id===c.spawn.id).length===1&&c.trace.every(o=>o.attack===null&&o.grab==='idle'),c.trace.at(-1).releases));
 });
 for(const facing of [1,-1])await run(`carry-turn-freeze-${facing}`,async c=>{
  await pickup(c,{facing});await down(facing===1?'a':'d');c.entry=await step();assert.equal(c.entry.carry?.phase,'turn');
  await page.evaluate(()=>window.__dkHeavy.a.armAttackerHitlag(3));c.frozen=[];for(let i=0;i<3;i++)c.frozen.push(await step());
  await down('t');c.denied=await step();await up('t');c.second=await step();c.reversed=await step();
  await down('t');c.throw=await step();await up('t');
  c.checks.push(check('real hitlag preserves turn age0 and facing for three steps',c.frozen.every(o=>o.carry?.age===0&&o.facing===facing),c.frozen),
   check('throw unavailable before captured third callback reversal',c.denied.action===null&&c.denied.facing===facing&&c.second.facing===facing,c.denied),
   check('third callback reverses and permits new physical throw',c.reversed.facing===-facing&&c.throw.action?.plan.action.startsWith('throw-forward-'),c.throw));
 });
 for(const mini of [false,true])await run(`heavy-ground-jump-${mini?'mini':'full'}`,async c=>{
  await pickup(c);await down('w');c.entry=await step();assert.equal(c.entry.carry?.phase,'jump-squat');if(mini)await up('w');
  c.trace=[c.entry];for(let i=1;i<=6;i++)c.trace.push(await step());await up('w');
  c.checks.push(check('six selected source resource-entry samples before takeoff',c.trace.slice(0,6).every(o=>o.carry?.phase==='jump-squat')&&c.trace[6].carry?.phase==='jump',c.trace.map(o=>o.carry)),
   check('full/mini jump uses documented ordinary kinetic adapter, no airjump',c.trace[6].velocity.y<0&&c.trace[6].jump?.shortHop===mini,c.trace[6].jump));
  await capture(c,'takeoff');
  const before=await page.evaluate(()=>window.__dkHeavy.read());await down('w');c.airJumpAttempt=await step();await up('w');
  c.checks.push(check('fresh airborne W cannot consume a second jump',c.airJumpAttempt.jumpsUsed===before.jumpsUsed,c.airJumpAttempt.jumpsUsed,before.jumpsUsed));
 });
 await run('heavy-real-touchdown-eighteen-step-gate',async c=>{
  await pickup(c,{air:true});
  await page.evaluate(()=>{const t=window.__dkHeavy;t.s.matter.body.setPosition(t.a.body,{x:t.floor.position.x-180,y:t.floor.bounds.min.y-44});t.s.matter.body.setVelocity(t.a.body,{x:0,y:2});});
  c.contactTrace=[];let o;for(let i=0;i<12;i++){o=await step();c.contactTrace.push(o);if(o.carry?.phase==='landing')break;}
  assert.equal(o.carry?.phase,'landing');assert.equal(o.carry.age,0);c.entry=o;await capture(c,'entry');
  c.trace=[o];for(let age=1;age<18;age++){if(age%2===1)await down('t');else await up('t');c.trace.push(await step());}
  await up('t');c.exit=await step();await down('t');c.fresh=await step();await up('t');
  c.checks.push(check('real Matter touchdown enters distinct source heavy landing',c.entry.grounded&&c.entry.carry?.phase==='landing',c.entry),
   check('fresh physical throws remain blocked for18 selected resource-entry landing samples',c.trace.length===18&&c.trace.every(o=>o.action===null&&o.held===c.spawn.id&&o.carry?.phase==='landing'),c.trace.map(o=>({age:o.carry?.age,action:o.action?.plan.action}))),
   check('landing age18 returns wait and new physical throw is eligible',c.exit.carry?.phase==='wait'&&c.fresh.action?.plan.action==='throw-forward-ordinary',c.fresh));
 });
 await run('heavy-walk-restrictions-reset',async c=>{
  await pickup(c);await down('d');await step(25);c.walk=await page.evaluate(()=>window.__dkHeavy.read());
  await down('g');await down('h');c.blocked=await step(3);await release();
  c.checks.push(check('full stick stays heavy walk with source max and calibrated acceleration',c.walk.carry?.phase==='walk'&&Math.abs(c.walk.velocity.x)<=6.623+1e-6,c.walk),
   check('held heavy blocks special/shield/dodge while retaining inventory',c.blocked.held===c.spawn.id&&c.blocked.attack===null&&c.blocked.shield==='idle'&&c.blocked.dodge==='idle',c.blocked));
  c.reset=await page.evaluate(()=>window.__dkHeavy.reset(1));c.checks.push(check('round reset clears carry/action/inventory',c.reset.carry===null&&c.reset.action===null&&c.reset.held===null,c.reset));
 });
 await run('heavy-platform-pass',async c=>{
  await pickup(c);await page.evaluate(()=>{const t=window.__dkHeavy,platform=t.s.baseStage.bodies.platformBodies.find(p=>p.label==='platform.passThrough');if(!platform)throw Error('Source pass fixture requires actual pass-through stage');t.s.matter.body.setPosition(t.a.body,{x:platform.position.x,y:platform.bounds.min.y-42});t.s.matter.body.setVelocity(t.a.body,{x:0,y:0});});
  await step(12);await down('s');c.pass=await step();await up('s');c.trace=[c.pass];for(let i=0;i<14;i++)c.trace.push(await step());
  c.checks.push(check('fresh physical down flick invokes source heavy pass on real supporting platform',c.pass.carry?.phase==='pass'&&c.pass.dropThrough,c.pass),check('held object retained while actual Matter falls through',c.trace.some(o=>!o.grounded)&&c.trace.every(o=>o.held===c.spawn.id),c.trace));
 });
 for(const facing of [1,-1])for(const releasedThrow of [false,true])await run(`heavy-cliff-policy-${releasedThrow?'throw-recovery':'carry'}-${facing}`,async c=>{
  await pickup(c,{facing,air:true});
  if(releasedThrow){await down('t');const entry=await step();await up('t');assert.equal(entry.action?.plan.action,'throw-forward-ordinary');await step(17);const o=await page.evaluate(()=>window.__dkHeavy.read());assert.equal(o.held,null);assert(o.action);}
  c.geometry=await page.evaluate(f=>{
   const t=window.__dkHeavy,candidate=t.a.getLedgeCandidates().find(c=>c.side===(f===1?'left':'right'));if(!candidate)throw Error('Missing actual stage ledge');
   const x=candidate.x+(candidate.side==='left'?-29:29),y=candidate.y+10;
   t.s.matter.body.setPosition(t.a.body,{x,y});t.s.matter.body.setVelocity(t.a.body,{x:0,y:1});
   return{candidate,detected:t.a.computeLedgeDetection(),action:t.a.getDonkeyKongHeavyItemActionState(),carry:t.a.getDonkeyKongHeavyCarryState()};
  },facing);
  assert(c.geometry.detected,'Cliff fixture must be independently inside ordinary ledge geometry');c.after=await step();
  c.checks.push(check('actual eligible ledge geometry stays unlatched under native heavy CLIFF_NONE policy',c.geometry.detected!==null&&c.after.ledge==='idle',c.after.ledge,'idle'),
   check('NO_REAC policy persists for held carry or postrelease heavy throw commitment',!c.after.recipient&&!releasedThrow?c.after.held===c.spawn.id:!c.after.recipient&&c.after.action!==null,c.after));
 });
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.result=report.failedChecks.length||report.errors.length?'FAIL':'PASS_CONSUMER_SCOPE';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failed:report.failedChecks},null,2));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
