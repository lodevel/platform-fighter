/** Physical input boundary review. Authoring/syntax checks are not Match proof.
 * Root launches this against an immutable checkpoint; no resolver overrides. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';

const hash=b=>createHash('sha256').update(b).digest('hex');
const expectedBundle=process.env.PF_EXPECT_BUNDLE_SHA;
const expectedMetadata=process.env.PF_EXPECT_DK_METADATA_SHA;
assert.match(expectedBundle??'',/^[a-f0-9]{64}$/,'PF_EXPECT_BUNDLE_SHA is required');
assert.match(expectedMetadata??'',/^[a-f0-9]{64}$/,'PF_EXPECT_DK_METADATA_SHA is required');
const prefix=process.env.PF_FROZEN_SOURCE_DIR??'.tmp/dk-full-ground-paired-checkpoint-11-source-leaves';
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const base=process.env.PF_INPUT_BOUNDARY_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/ground-input-boundary-checkpoint-11';
let out=base;for(let n=2;;n++){try{await access(`${out}/observations.json`);out=`${base}-attempt${n}`;}catch{break;}}
const filter=process.env.PF_INPUT_BOUNDARY_CASE_FILTER?new RegExp(process.env.PF_INPUT_BOUNDARY_CASE_FILTER):null;
const report={url,out,frozenSourcePrefix:prefix,scope:'Physical P1 keyboard edges in normal fixed MatchScene/Matter, both faces. Selected combo age7, held-input retirement, early queued and late fresh input, ordinary shared buffer expiration/consumption, vertical flick versus held crouch. No contact/damage/art qualification. Shared nine-step queue is an authored framework adapter; native input buffer duration/order is not asserted.',cases:[],errors:[],failedResponses:[]};
await mkdir(out,{recursive:true});
let browser,page;
const held=new Set();
const down=async key=>{await page.keyboard.down(key);held.add(key);};
const up=async key=>{await page.keyboard.up(key);held.delete(key);};
const release=async()=>{if(page)for(const key of [...held])await up(key);};
const read=async()=>page.evaluate(()=>window.__dkInputBoundary.read());
const step=async(n=1)=>page.evaluate(n=>window.__dkInputBoundary.step(n),n);
const check=(c,label,pass,actual,expected)=>c.checks.push({label,pass,actual,expected});
const capture=async c=>{c.keyboardEvents=await page.evaluate(()=>window.__dkInputBoundary.keyboardEvents);c.screenshot=`${c.name}.png`;await page.screenshot({path:`${out}/${c.screenshot}`});};
async function run(name,facing,body){if(filter&&!filter.test(name))return;const c={name,facing,checks:[],trace:[]};report.cases.push(c);await release();c.settled=await page.evaluate(f=>window.__dkInputBoundary.reset(f),facing);check(c,'settled grounded actionable fixture',c.settled.grounded&&c.settled.canAttack&&!c.settled.attack,c.settled,{grounded:true,canAttack:true,attack:null});await body(c);await capture(c);check(c,'physical KeyF event observed',c.keyboardEvents.some(e=>e.type==='keydown'&&e.code==='KeyF'),c.keyboardEvents);check(c,'far victim prevents unrelated hitlag',c.trace.every(o=>o.targetPercent===0),c.trace.map(o=>o.targetPercent),0);}
async function jab(c){await down('f');const o=await step();c.trace.push(o);check(c,'fresh physical F enters exact jab age0',o.attack?.id==='donkeykong.jab'&&o.attack.age===0,o.attack,{id:'donkeykong.jab',age:0});return o;}
async function enter(age,c){await jab(c);await up('f');let o=await read();while(o.attack?.id==='donkeykong.jab'&&o.attack.age<age){o=await step();c.trace.push(o);}assert.equal(o.attack?.age,age);return o;}
async function enterJab2(age,c){await enter(6,c);await down('f');let o=await step();c.trace.push(o);await up('f');assert.equal(o.attack?.id,'donkeykong.jab2');assert.equal(o.attack.age,0);while(o.attack.age<age){o=await step();c.trace.push(o);}return o;}

try{
 const metadata=await readFile('assets/characters/donkeykong/frames.json');assert.equal(hash(metadata),expectedMetadata);report.metadataSha256=hash(metadata);
 const sourcePaths=[`${prefix}/src/characters/Character.ts`,`${prefix}/src/characters/DonkeyKong.ts`,`${prefix}/src/characters/groundedAttackInput.ts`];
 const sources=await Promise.all(sourcePaths.map(p=>readFile(p,'utf8')));
 report.sourcePins=sourcePaths.map((path,i)=>({path,sha256:hash(sources[i])}));
 assert.match(sources[0],/OFFENSIVE_ACTION_BUFFER_FRAMES\s*=\s*9/);
 assert.match(sources[1],/jabChain:\s*\{\s*nextId:\s*['"]donkeykong\.jab2['"],\s*advanceWindowStart:\s*7/);
 const primaryPath='docs/review/2026-10-06/dk-all-attack-values/sources/Attack11.txt';
 const primary=await readFile(primaryPath,'utf8');assert.ok(primary.includes('frame(agent.lua_state_agent, 5.0)')&&primary.includes('wait(agent.lua_state_agent, 2.0)')&&primary.includes('FIGHTER_STATUS_ATTACK_FLAG_ENABLE_COMBO'));
 const technicalPath='docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/ground-input-boundary-sources/wiki-neutral-hit1-timing-observation.json';
 const technicalBytes=await readFile(technicalPath),technical=JSON.parse(technicalBytes);assert.deepEqual(technical.timing.continuability_native_frames,[8,28]);assert.equal(technical.timing.interruptible_native_frame,25);
 report.technicalSource={path:technicalPath,sha256:hash(technicalBytes),observation:technical};
 report.comboClock={primaryPath,sha256:hash(primary),primaryNativeEnableFrame:7,primarySampleAge:6,selectedAdvanceAge:7,technicalSource:{url:'https://www.ssbwiki.com/index.php?title=Donkey_Kong_(SSBU)/Neutral_attack/Hit_1&oldid=1789606',continuabilityNativeFrames:[8,28],earliestSelectedSourceAge:7},statusCompositionLimit:'Raw ATTACK frame5 plus wait2 sets ENABLE_COMBO at native7; technical continuability begins native8. Flag and composed status transition are distinct facts. Selected age7 follows technical continuability; the native status composition/order remains unrecovered.',consumerOrder:'Update/age shared buffer, advance attack, then evaluate chain; pre-input age6 reaches selected age7 on that step.',ordinaryBuffer:{frames:9,provenance:'Shared authored framework adapter; no native queue duration claim'}};
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);assert.ok(report.bundle);
 report.bundleSha256=hash(await(await page.request.get(report.bundle)).body());assert.equal(report.bundleSha256,expectedBundle);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:811072,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const body of s.baseStage.bodies.platformBodies)if(body!==floor){body.collisionFilter.mask=0;s.matter.world.remove(body);}
  const copy=x=>x==null?null:JSON.parse(JSON.stringify(x));const keyboardEvents=[];
  for(const type of ['keydown','keyup'])document.addEventListener(type,e=>keyboardEvents.push({type,key:e.key,code:e.code,keyCode:e.keyCode,location:e.location}),true);
  const read=()=>{const p=s.p1,a=p.getActiveAttack(),slot=s.playerSlots[0],sp=slot.sprite;return{frame:s.physicsEngine.getFrame(),grounded:p.isGrounded(),canAttack:p.canAttack(),position:p.getPosition(),velocity:p.getVelocity(),facing:p.getFacing(),percent:p.getDamagePercent(),targetPercent:s.p2.getDamagePercent(),attack:a?{id:a.move.id,age:a.framesElapsed,facing:a.facing,sensorId:a.hitboxBody?.id??null}:null,buffer:copy(p.offensiveActionBuffer),chargingSmash:copy(p.chargingSmash),bodyState:copy(p.getPackedBodyState()),input:{attack:s.inputResolver.getAction(slot.bindingsSlot,'attack'),vector:s.inputResolver.getMoveVector(slot.bindingsSlot),binding:s.registry.get('inputBindingsStore').getAction(slot.bindingsSlot,'attack')},sprite:sp?{key:sp.texture.key,frame:sp.frame.name,flipX:sp.flipX}:null};};
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  const reset=facing=>{s.p1.resetForRound(floor.position.x-100,floor.bounds.min.y-42);s.p2.resetForRound(floor.position.x+500,floor.bounds.min.y-42);s.p1.setFacing(facing);s.p2.setFacing(-facing);s.p1.setInvincibility(0);s.p2.setInvincibility(0);step(12);keyboardEvents.length=0;return read();};
  window.__dkInputBoundary={read,step,reset,keyboardEvents};
 });
 for(const facing of [1,-1]){
  await run(`held-first-F-no-chain-${facing}`,facing,async c=>{await jab(c);for(let age=1;age<=28;age++){const o=await step();c.trace.push(o);check(c,`held F sample${age} never enters jab2`,o.attack?.id!=='donkeykong.jab2',o.attack);if(age===24)check(c,'jab retires at total24 while first F held',o.attack===null,o.attack,null);}check(c,'held first edge leaves no buffered repeat',c.trace.at(-1).buffer===null,c.trace.at(-1).buffer,null);});
  for(const before of [1,5,6,7,12])await run(`fresh-followup-preage${before}-${facing}`,facing,async c=>{const pre=await enter(before,c);c.prePress=pre;await down('f');let o=await step();c.trace.push(o);await up('f');if(before<6){check(c,'early fresh tap remains jab before selected eligibility',o.attack?.id==='donkeykong.jab'&&o.attack.age===before+1,o.attack,{id:'donkeykong.jab',age:before+1});check(c,'early tap creates one authored buffer',o.buffer?.kind==='attack'&&o.buffer.remaining===9,o.buffer,{kind:'attack',remaining:9});while(o.attack?.id==='donkeykong.jab'){o=await step();c.trace.push(o);if(c.trace.length>30)throw Error('Queued follow-up did not enter');}}check(c,'selected window produces one exact jab2 entry',o.attack?.id==='donkeykong.jab2'&&o.attack.age===0,o.attack,{id:'donkeykong.jab2',age:0});check(c,'chain preserves facing and consumes queue',o.attack?.facing===facing&&o.buffer===null,{attack:o.attack,buffer:o.buffer});if(before<6)check(c,'first entry occurs at selected age7 boundary',o.frame-pre.frame===7-before,o.frame-pre.frame,7-before);for(let i=0;i<4;i++){o=await step();c.trace.push(o);}check(c,'one tap does not restart follow-up',o.attack?.id==='donkeykong.jab2'&&o.attack.age===4,o.attack,{id:'donkeykong.jab2',age:4});});
  for(const before of [7,25])await run(`ordinary-buffer-preage${before}-${facing}`,facing,async c=>{await enterJab2(before,c);await down('f');let o=await step();await up('f');c.postPressFrame=o.frame;c.trace.push(o);check(c,'busy fresh F creates authored nine-step queue',o.buffer?.remaining===9&&o.buffer.kind==='attack',o.buffer,{kind:'attack',remaining:9});for(let i=0;i<36-before;i++){o=await step();c.trace.push(o);}const starts=c.trace.filter(x=>x.frame>c.postPressFrame&&x.attack?.id==='donkeykong.jab'&&x.attack.age===0);if(before===7){check(c,'early ordinary queue expires before action ends',starts.length===0,starts,[]);check(c,'expired queue leaves neutral after commitment',o.attack===null&&o.buffer===null,{attack:o.attack,buffer:o.buffer});}else{check(c,'late ordinary queued light starts exactly once',starts.length===1,starts.map(x=>({frame:x.frame,attack:x.attack})),{count:1});if(starts.length)check(c,'ordinary queue enters after end rather than replacing jab2',starts[0].frame-c.postPressFrame===6,starts[0].frame-c.postPressFrame,6);}});
  for(const before of [24,27,28])await run(`post-retirement-fresh-F-preage${before}-${facing}`,facing,async c=>{const entry=await jab(c);await up('f');let o=await read();for(let age=1;age<=before;age++){o=await step();c.trace.push(o);}c.beforePress=o;
   c.sourceReconciliation={originalJabElapsedBeforePress:before,originalJabNativeSampleBeforePress:before+1,originalJabNativeSampleAfterNextAdvance:before+2,technicalContinuabilityNativeFrames:[8,28],preSampleWithinTechnicalWindow:before+1<=28,advancedSampleWithinTechnicalWindow:before+2<=28,sourceExpectedBranch:'Technical continuability permits jab2 while the original jab status remains within native8–28; interruptibility starts25. Whether an actionable status retains that transition after the selected total24 requires native status composition evidence.',selectedConsumer:'Committed jab retires at age24; no retained jab chain state. Subsequent neutral fresh attack classifies a new jab.',qualification:'Current selected route only; missing source late-continuation possibility is explicitly open for adjudication, not waived as a buffer adapter.'};
   check(c,'original selected jab has retired before late press',o.attack===null&&o.canAttack,o.attack,null);check(c,'fixture advances requested original elapsed count',o.frame-entry.frame===before,o.frame-entry.frame,before);await down('f');o=await step();c.trace.push(o);await up('f');c.actualRoute=o.attack;check(c,'current post-retirement route starts new jab at age0',o.attack?.id==='donkeykong.jab'&&o.attack.age===0,o.attack,{id:'donkeykong.jab',age:0});});
  await run(`neutral-simultaneous-S-F-${facing}`,facing,async c=>{await down('s');await down('f');const o=await step();c.trace.push(o);check(c,'fresh vertical flick routes to down-smash charge entry0',o.attack===null&&o.chargingSmash?.moveId==='donkeykong.dsmash'&&o.chargingSmash.startupElapsed===0,{attack:o.attack,charging:o.chargingSmash},{id:'donkeykong.dsmash',chargeStartup:0});check(c,'simultaneous route does not claim dtilt age0',o.attack?.id!=='donkeykong.dtilt',o.attack);await up('f');c.trace.push(await step());});
  await run(`crouched-S8-fresh-F-${facing}`,facing,async c=>{await down('s');for(let n=0;n<8;n++)c.trace.push(await step());c.beforePress=await read();await down('f');const o=await step();c.trace.push(o);check(c,'held down plus fresh F enters exact dtilt age0',o.attack?.id==='donkeykong.dtilt'&&o.attack.age===0,o.attack,{id:'donkeykong.dtilt',age:0});check(c,'crouched tilt bypasses smash charging',o.chargingSmash===null,o.chargingSmash,null);await up('f');});
 }
 const checks=report.cases.flatMap(c=>c.checks);Object.assign(report,{caseCount:report.cases.length,checkCount:checks.length,passedChecks:checks.filter(c=>c.pass).length,failedChecks:checks.filter(c=>!c.pass)});
 report.status=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS';
 if(report.status!=='PASS')process.exitCode=1;
}catch(e){report.status='ERROR';report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release();if(browser)await browser.close();await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,status:report.status,caseCount:report.caseCount,checkCount:report.checkCount,passedChecks:report.passedChecks,failedChecks:report.failedChecks?.map(c=>c.label),error:report.error}));
