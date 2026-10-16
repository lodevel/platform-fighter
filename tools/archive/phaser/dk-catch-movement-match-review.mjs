import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.env.PF_CATCH_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/catch-movement';
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={url,scope:'Physical keyboard, actual MatchScene fixed Matter and source-window inventory catch/rethrow consumers. Explicit public registry spawn and initial body resets/velocity fixtures; no input resolver or catch/physics method override. Native coefficients/windows are independent expectations. Common kinetic setup, acquisition rectangle target fit, item physics and baseline body/socket art remain explicit beta limits.',errors:[],cases:[],sourceBindings:[]};
for(const p of ['src/characters/donkeykongGroundMovement.ts','src/characters/donkeykongAirMovement.ts','src/characters/donkeykongItemCatch.ts','docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/item-catch-contract.json']){
 try{const captured=p.startsWith('src/')?`.tmp/dk-mechanics-checkpoint-06-source-leaves/${p}`:p;report.sourceBindings.push({path:p,capturedPath:captured,sha256:hash(await readFile(captured))});}catch(e){if(e.code!=='ENOENT')throw e;}
}
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
const held=new Set(),down=async k=>{await page.keyboard.down(k);held.add(k);},up=async k=>{await page.keyboard.up(k);held.delete(k);};
const release=async()=>{for(const k of [...held])await up(k);};
const step=async(n=1)=>page.evaluate(n=>window.__dkCatch.step(n),n);
const check=(label,pass,actual,expected)=>({label,pass,actual,expected});
const capture=async(c,label)=>{const path=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${path}`});(c.captures??=[]).push(path);};
const run=async(name,fn)=>{await release();const c={name,checks:[]};report.cases.push(c);await fn(c);await capture(c,'final');};
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);report.bundleSha256=hash(await(await page.request.get(report.bundle)).body());
 if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810062,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene'),a=s.p1;s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');for(const body of s.baseStage.bodies.platformBodies)if(body!==floor){body.collisionFilter.mask=0;s.matter.world.remove(body);}
  const read=()=>({frame:s.physicsEngine.getFrame(),position:a.getPosition(),velocity:a.getVelocity(),grounded:a.isGrounded(),facing:a.getFacing(),freeze:a.getHitlagRemaining(),friction:a.body.friction,locomotion:a.getLocomotionState(),body:a.getPackedBodyState(),catch:a.getDonkeyKongItemCatchContext(),itemAction:a.getDonkeyKongItemActionState(),held:s.getInventory(s.playerSlots[0].playerIndex).getHeldItem()?.id??null,grab:a.getGrabState().name,attack:a.getActiveAttack()?{id:a.getActiveAttack().move.id,age:a.getActiveAttack().framesElapsed}:null,dodge:a.getDodgeState(),repeat:s.donkeykongItemRepeat.get(s.playerSlots[0].playerIndex)?.state??null});
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  let bat=null;
  // One ordinary Scene spawn acquires its actual definition/constructor. Later
  // fixtures use the public registry rather than importing an alternate item.
  let pending=true;s.itemSpawnTypeIndex=0;const tr=s.baseStage.transform,scale=s.stage.scale;
  s.itemSpawnManager.step=frame=>pending?(pending=false,[{frame,anchorIndex:0,anchor:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];
  step();bat=s.getItemRegistry().getActive().at(-1);if(!bat)throw Error('Missing ordinary bat definition');
  const definition=bat.definition,Entity=bat.constructor;
  const reset=({facing=1,air=false}={})=>{s.getInventory(s.playerSlots[0].playerIndex).detachWithoutDrop();a.syncPikachuHeldItem(false);for(const item of s.getItemRegistry().getActive())item.markDespawned(s.physicsEngine.getFrame());s.thrownItems=[];s.donkeykongItemRequests.clear();s.donkeykongItemButtons.clear();s.donkeykongItemCatchEdges.clear();s.donkeykongItemRepeat.clear();s.suppressAttackUntilRelease.clear();a.resetForRound(floor.position.x-200,floor.bounds.min.y-42);s.p2.resetForRound(floor.bounds.max.x-20,floor.bounds.min.y-42);a.setFacing(facing);a.setInvincibility(0);step(12);if(air){s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:floor.bounds.min.y-650});s.matter.body.setVelocity(a.body,{x:0,y:0});step(2);}return read();};
  const spawn=({near=true,holdable=true,heavy=false}={})=>{const p=a.getPosition(),entity=s.getItemRegistry().spawn({...definition,holdable,heavy},{x:p.x+a.getFacing()*(near?25:300),y:p.y},s.physicsEngine.getFrame(),Entity);const visual=s.add.container(p.x,p.y,[s.add.rectangle(0,0,12,24,0x987045)]);s.itemVisuals.set(entity.id,visual);return{id:entity.id,state:entity.getSnapshot()};};
  const moveItem=(id,near)=>{const item=s.getItemRegistry().getActive().find(i=>i.id===id);if(!item)throw Error('Missing identity fixture');const p=a.getPosition(),q={x:p.x+a.getFacing()*(near?25:300),y:p.y};item.updateFreePosition(q);const t=s.thrownItems.find(t=>t.entity===item);if(t){t.x=q.x;t.y=q.y;t.vx=0;t.vy=0;}s.itemVisuals.get(id)?.setPosition(q.x,q.y);return item.getSnapshot();};
  window.__dkCatch={s,a,read,step,reset,spawn,moveItem,velocity:x=>s.matter.body.setVelocity(a.body,{x,y:a.getVelocity().y}),freeze:n=>a.armAttackerHitlag(n)};
 });
 for(const facing of [1,-1])await run(`movement-run-brake-${facing}`,async c=>{
  c.reset=await page.evaluate(f=>window.__dkCatch.reset({facing:f}),facing);await down(facing===1?'d':'a');c.run=await step(25);assert.equal(c.run.locomotion.name,'run');
  await page.evaluate(x=>window.__dkCatch.velocity(x),5*facing);c.acceleration=await step();
  c.checks.push(check('actual full run adds source(.044+.07337)*5 once',Math.abs(c.acceleration.velocity.x-facing*(5+.58685))<1e-6,c.acceleration.velocity.x,facing*(5+.58685)),check('source run traction suppresses duplicate Matter friction',c.acceleration.friction===0,c.acceleration.friction));
  await page.evaluate(x=>window.__dkCatch.velocity(x),5*facing);await release();c.brake=await step();
  c.checks.push(check('actual neutral brake subtracts source.123*5 once',Math.abs(c.brake.velocity.x-facing*(5-.615))<1e-6,c.brake.velocity.x,facing*4.385),check('dedicated brake route latched',c.brake.body.turnBrake?.sheet==='run_brake',c.brake.body.turnBrake));
  c.resetAfter=await page.evaluate(f=>window.__dkCatch.reset({facing:f}),facing);c.checks.push(check('round reset retires source movement state',c.resetAfter.body.turnBrake===null));
 });
 for(const facing of [1,-1])await run(`movement-air-${facing}`,async c=>{
  await page.evaluate(f=>window.__dkCatch.reset({facing:f,air:true}),facing);await down(facing===1?'d':'a');await page.evaluate(x=>window.__dkCatch.velocity(x),2*facing);c.control=await step();await release();await page.evaluate(x=>window.__dkCatch.velocity(x),2*facing);c.neutral=await step();
  c.checks.push(check('actual ordinary full air control uses source.3',Math.abs(c.control.velocity.x-facing*2.3)<1e-6,c.control.velocity.x),check('actual ordinary neutral air uses constant.075 brake',Math.abs(c.neutral.velocity.x-facing*1.925)<1e-6,c.neutral.velocity.x));
 });
 for(const facing of [1,-1])await run(`catch-stationary-${facing}`,async c=>{
  await page.evaluate(f=>window.__dkCatch.reset({facing:f,air:true}),facing);c.item=await page.evaluate(()=>window.__dkCatch.spawn());await down('t');c.catch=await step();await capture(c,'caught');
  c.checks.push(check('fresh physical airborne grab catches free falling entity immediately',c.catch.held===c.item.id,c.catch),check('air catch preserves underlying body and creates no ground pickup/fighter grab',c.catch.itemAction===null&&c.catch.grab==='idle',c.catch));
 });
 for(const facing of [1,-1])for(const kind of ['aerial','air-dodge','tilt','dash-attack'])for(const boundary of ['last','expired'])await run(`catch-${kind}-${boundary}-${facing}`,async c=>{
  const air=kind==='aerial'||kind==='air-dodge';await page.evaluate(spec=>window.__dkCatch.reset(spec),{facing,air});
  if(kind==='tilt'){await down('s');await step(8);}
  if(kind==='dash-attack'){await down(facing===1?'d':'a');await step(25);}
  await down(kind==='air-dodge'?'h':'f');let o=await step();await up(kind==='air-dodge'?'h':'f');
  const end={aerial:4,'air-dodge':5,tilt:2,'dash-attack':5}[kind],targetAge=boundary==='last'?end-2:end-1;
  for(let i=0;i<12&&(o.catch?.context!==kind||o.catch.age<targetAge);i++)o=await step();
  assert.equal(o.catch?.context,kind);assert.equal(o.catch.age,targetAge);c.before=o;c.item=await page.evaluate(()=>window.__dkCatch.spawn());c.after=await step();
  const sampledAge=kind==='air-dodge'?c.after.dodge.active?.framesElapsed:c.after.attack?.age;
  c.checks.push(check('source window exact last accepted or first expired age',sampledAge===targetAge+1,sampledAge,targetAge+1),check('actual overlap respects finite source catch boundary',boundary==='last'?c.after.held===c.item.id:c.after.held===null,c.after.held,boundary==='last'?c.item.id:null),check('catch preserves existing attack or dodge owner',kind==='air-dodge'?c.after.dodge.active!==null:c.after.attack?.id===c.before.attack?.id,c.after));
 });
 for(const trait of ['unholdable','heavy'])await run(`catch-reject-${trait}`,async c=>{
  await page.evaluate(()=>window.__dkCatch.reset({air:true}));c.item=await page.evaluate(trait=>window.__dkCatch.spawn({holdable:trait!=='unholdable',heavy:trait==='heavy'}),trait);await down('t');c.after=await step();c.checks.push(check('air acquisition rejects independently declared item trait',c.after.held===null,c.after));
 });
 await run('catch-held-grab-does-not-refresh',async c=>{
  await page.evaluate(()=>window.__dkCatch.reset({air:true}));await down('t');await step(2);c.item=await page.evaluate(()=>window.__dkCatch.spawn());c.held=await step();await up('t');await step();await down('t');c.fresh=await step();c.checks.push(check('held grab cannot reopen stationary frame1 window',c.held.held===null,c.held),check('separate new physical grab edge opens actual source catch',c.fresh.held===c.item.id,c.fresh));
 });
 for(const facing of [1,-1])await run(`z-drop-identity-separation-${facing}`,async c=>{
  await page.evaluate(f=>window.__dkCatch.reset({facing:f,air:true}),facing);c.item=await page.evaluate(()=>window.__dkCatch.spawn());await down('t');assert.equal((await step()).held,c.item.id);await up('t');await step();await down('t');c.drop=await step();await up('t');
  c.checks.push(check('neutral fresh airborne release records the exact dropped identity and one-step gap',c.drop.held===null&&c.drop.repeat.unseparatedZDrops.includes(String(c.item.id))&&c.drop.repeat.zDropActionGapRemaining===1,c.drop));
  await page.evaluate(id=>{window.__dkCatch.moveItem(id,true);window.__dkCatch.freeze(3);},c.item.id);c.frozen=await step(3);
  c.checks.push(check('last frozen step preserves dropped identity and action gap',c.frozen.repeat.unseparatedZDrops.includes(String(c.item.id))&&c.frozen.repeat.zDropActionGapRemaining===1,c.frozen));
  await page.evaluate(id=>window.__dkCatch.moveItem(id,true),c.item.id);await down('t');c.blocked=await step();await up('t');
  c.checks.push(check('new grab cannot recatch the same overlapping Z-dropped identity',c.blocked.held===null&&c.blocked.repeat.unseparatedZDrops.includes(String(c.item.id)),c.blocked));
  await page.evaluate(id=>window.__dkCatch.moveItem(id,false),c.item.id);c.separated=await step();
  c.checks.push(check('sampled acquisition-rectangle separation clears that exact identity',!c.separated.repeat.unseparatedZDrops.includes(String(c.item.id)),c.separated));
  await page.evaluate(id=>window.__dkCatch.moveItem(id,true),c.item.id);await down('t');c.recatch=await step();
  c.checks.push(check('same entity can be recaught with a fresh edge after separation',c.recatch.held===c.item.id,c.recatch));
  await up('t');await step();await down('t');await step();await release();c.reset=await page.evaluate(f=>window.__dkCatch.reset({facing:f,air:true}),facing);
  c.checks.push(check('round reset clears repeat identity and clocks',c.reset.repeat.unseparatedZDrops.length===0&&c.reset.repeat.zDropActionGapRemaining===0&&c.reset.repeat.aerialRethrowRemaining===0,c.reset));
 });
 await run('completed-aerial-throw-seven-step-rethrow-delay',async c=>{
  await page.evaluate(()=>window.__dkCatch.reset({air:true}));c.first=await page.evaluate(()=>window.__dkCatch.spawn());await down('t');c.pickup=await step();assert.equal(c.pickup.held,c.first.id);
  await up('t');await step();await down('d');await down('t');c.entry=await step();await up('t');assert(c.entry.itemAction?.plan.action.startsWith('throw-air-forward'));
  c.timeline=[c.entry];for(let i=0;i<35&&c.timeline.at(-1).itemAction;i++)c.timeline.push(await step());c.completed=c.timeline.at(-1);
  assert.equal(c.completed.itemAction,null);assert.equal(c.completed.repeat.aerialRethrowRemaining,7);
  c.replacement=await page.evaluate(()=>window.__dkCatch.spawn());await down('t');c.catchReplacement=await step();assert.equal(c.catchReplacement.held,c.replacement.id);
  await up('t');await step();c.attempts=[];
  for(const elapsed of [3,5,7]){
   await down('t');c.attempts.push({elapsed,observation:await step()});await up('t');if(elapsed<7)await step();
  }
  c.checks.push(check('actual completion starts independent seven-step source delay, not release',c.completed.repeat.aerialRethrowRemaining===7,c.completed.repeat),check('new item can be caught while directional rethrow remains locked',c.catchReplacement.held===c.replacement.id&&c.catchReplacement.repeat.aerialRethrowRemaining===6,c.catchReplacement),check('fresh physical rethrow rejected at elapsed3 and5',c.attempts.slice(0,2).every(r=>r.observation.itemAction===null),c.attempts),check('fresh physical rethrow succeeds exactly at elapsed7',c.attempts[2].observation.itemAction?.plan.action.startsWith('throw-air-forward')&&c.attempts[2].observation.repeat.aerialRethrowRemaining===0,c.attempts[2]));
 });
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.result=report.failedChecks.length||report.errors.length?'FAIL':'PASS_CONSUMER_SCOPE';console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failed:report.failedChecks},null,2));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
