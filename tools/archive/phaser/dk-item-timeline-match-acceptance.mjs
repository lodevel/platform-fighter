import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const output=process.env.PF_ITEM_OUT??'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/items-checkpoint-05';
const report={scope:'Actual MatchScene fixed Matter steps and inventory callbacks. Controlled recorded-input fixtures plus separate physical keyboard cases. Source callback clocks and standard initial velocities only; target Have sockets, native item-specific physics and full animations remain unqualified.',errors:[],rows:[]};
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto('http://localhost:4196/platform-fighter/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 if(process.env.PF_EXPECT_BUNDLE_SHA&&report.bundleSha256!==process.env.PF_EXPECT_BUNDLE_SHA)throw Error('Wrong immutable bundle');
 await page.evaluate(()=>{
  const game=window.__game;for(const scene of game.scene.getScenes(true))game.scene.stop(scene.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810085,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),a=s.p1;
  let input={},physical=false,releases=0;
  const originalMove=s.inputResolver.getMoveVector.bind(s.inputResolver),originalHeld=s.inputResolver.isActionHeld.bind(s.inputResolver);
  s.inputResolver.getMoveVector=p=>physical?originalMove(p):({x:p===1?input.moveX??0:0,y:p===1?input.moveY??0:0});
  s.inputResolver.isActionHeld=(p,k)=>physical?originalHeld(p,k):p===1&&input[k]===true;
  const tick=(i={})=>{input=i;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();return read();};
  const read=()=>{const state=a.getDonkeyKongItemActionState(),held=s.getInventory(s.playerSlots[0].playerIndex)?.getHeldItem();return{frame:s.physicsEngine.getFrame(),releaseCount:releases,position:a.getPosition(),facing:a.getFacing(),grounded:a.isGrounded(),state:state?JSON.parse(JSON.stringify(state)):null,held:held?.id??null,grab:a.getGrabState().name,attack:a.getActiveAttack()?.move.id??null,thrown:s.thrownItems.map(t=>({id:t.entity.id,x:t.x,y:t.y,vx:t.vx,vy:t.vy,power:t.damagePower})),socket:a.getHeldItemWorldPosition(),hitlag:a.getHitlagRemaining()};};
  const reset=()=>{physical=false;input={};releases=0;s.getInventory(s.playerSlots[0].playerIndex)?.detachWithoutDrop();for(const item of s.getItemRegistry().getActive())item.markDespawned(s.physicsEngine.getFrame());s.thrownItems=[];s.donkeykongItemRequests.clear();s.donkeykongItemFlicks.clear();s.donkeykongItemButtons.clear();s.suppressAttackUntilRelease.clear();a.resetForRound(floor.position.x,floor.bounds.min.y-a.getTuning().height/2);s.p2.resetForRound(floor.bounds.max.x-30,floor.bounds.min.y-42);a.setInvincibility(0);a.setDamagePercent(0);for(let n=0;n<12;n++)tick();return read();};
  const spawn=()=>{s.itemSpawnTypeIndex=0;let pending=true;const tr=s.baseStage.transform,scale=s.stage.scale,p=a.getPosition();s.itemSpawnManager.step=frame=>pending?(pending=false,[{frame,anchorIndex:0,anchor:{x:(p.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(p.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];tick();const item=s.getItemRegistry().getActive().at(-1);if(!item)throw Error('No spawned bat');item.markGrounded(s.physicsEngine.getFrame(),{x:a.getPosition().x,y:floor.bounds.min.y});return item;};
  const pickup=()=>{const item=spawn();const entry=tick({attack:true});const commit=tick();for(let n=0;n<8;n++)tick();if(s.getInventory(s.playerSlots[0].playerIndex)?.getHeldItem()!==item)throw Error('Setup native pickup callback failed '+JSON.stringify({entry,commit,end:read(),item:item.getSnapshot(),canUse:a.canUseItemsBeforeInput(),resetGeneration:a.getPositionResetGeneration(),requests:[...s.donkeykongItemRequests.values()].map(r=>({action:r.action,entity:r.entity.id,generation:r.resetGeneration})),items:s.getItemRegistry().getActive().map(i=>i.getSnapshot())}));const originalDrop=item.markDropped.bind(item);item.markDropped=(...args)=>{releases++;return originalDrop(...args);};return{item,entry,commit};};
  window.__dkItems={s,a,floor,tick,read,reset,spawn,pickup,setPhysical:v=>physical=v};
 });
 for(const airborne of[false,true])for(const direction of['forward','back','up','down'])for(const strong of[false,true])for(const facing of[1,-1]){
  const row=await page.evaluate(({airborne,direction,strong,facing})=>{
   const t=window.__dkItems,{s,a}=t;t.reset();const setup=t.pickup();a.setFacing(facing);
   if(airborne){s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:t.floor.bounds.min.y-450});s.matter.body.setVelocity(a.body,{x:0,y:0});for(let i=0;i<2;i++)t.tick();}
   const magnitude=strong?1:.5,moveX=direction==='forward'?facing*magnitude:direction==='back'?-facing*magnitude:0,moveY=direction==='up'?-magnitude:direction==='down'?magnitude:0;
   const trace=[t.tick({grab:true,moveX,moveY})];for(let n=0;n<30;n++)trace.push(t.tick({grab:true}));
   const eventFrame={forward:10,back:14,up:15,down:8}[direction],releaseIndex=trace.findIndex(r=>r.thrown.some(x=>x.id===setup.item.id));
   const release=trace[releaseIndex],item=release?.thrown.find(x=>x.id===setup.item.id),before=trace[releaseIndex-1];
   const speed=(direction==='up'?(strong?4.1:3.1):direction==='down'?(strong?4.62:3.3):strong?3.64:2.6)*1.09*5;
   const angle=(direction==='up'?90:direction==='down'?-90:strong?11:airborne?14:17)*Math.PI/180;
   const expected={x:Math.cos(angle)*speed*(direction==='back'?-facing:facing),y:-Math.sin(angle)*speed};
   return{kind:'throw',airborne,direction,strong,facing,setup:{entry:setup.entry,commit:setup.commit},trace,expected,checks:[
    {label:'selected distinct source action',pass:trace[0].state?.plan.action===`throw-${airborne?'air':'ground'}-${direction}-${strong?'strong':'ordinary'}`},
    {label:'item held through step before source release',pass:releaseIndex===eventFrame-1&&before?.held===setup.item.id&&release?.held===null},
    {label:'source initial velocity; existing item gravity adds .45 in same step',pass:!!item&&Math.abs(item.vx-expected.x)<1e-7&&Math.abs(item.vy-.45-expected.y)<1e-7},
    {label:'held grab press never becomes fighter grab after detach',pass:trace.every(r=>r.grab==='idle')},
    {label:'source back reversal step11 or fixed entry facing',pass:direction==='back'?trace.slice(0,10).every(r=>r.facing===facing)&&trace.slice(10).every(r=>r.facing===-facing):trace.every(r=>r.facing===facing)},
    {label:'released object once',pass:trace.at(-1).releaseCount===1&&trace.slice(releaseIndex).every(r=>r.thrown.filter(x=>x.id===setup.item.id).length<=1)}
   ]};
  },{airborne,direction,strong,facing});report.rows.push(row);
 }
 for(const airborne of[false,true])for(const facing of[1,-1]){
  report.rows.push(await page.evaluate(({airborne,facing})=>{const t=window.__dkItems,{s,a}=t;t.reset();const setup=t.pickup();a.setFacing(facing);if(airborne){s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:t.floor.bounds.min.y-450});s.matter.body.setVelocity(a.body,{x:0,y:0});t.tick();t.tick();}
   const trace=[t.tick({grab:true})];for(let n=0;n<12;n++)trace.push(t.tick({grab:true}));const index=trace.findIndex(r=>r.thrown.some(x=>x.id===setup.item.id)),item=trace[index]?.thrown.find(x=>x.id===setup.item.id);const speed=2.1*1.09*5,angle=100*Math.PI/180;
   return{kind:'drop',airborne,facing,trace,checks:[{label:'source drop age and single release',pass:index===(airborne?0:6)},{label:'drop initial velocity and power',pass:!!item&&Math.abs(item.vx-(airborne?0:Math.cos(angle)*speed*facing))<1e-7&&Math.abs(item.vy-.45-(airborne?0:-Math.sin(angle)*speed))<1e-7&&item.power===(airborne?1:.5)},{label:'spent held grab cannot become fighter grab',pass:trace.every(r=>r.grab==='idle')} ]};}, {airborne,facing}));
 }
 report.rows.push(await page.evaluate(()=>{const t=window.__dkItems,{a}=t;t.reset();const item=t.spawn();const entry=t.tick({attack:true});a.armAttackerHitlag(4);const frozen=Array.from({length:4},()=>t.tick({attack:true}));const commit=t.tick({attack:true});for(let n=0;n<10;n++)t.tick({attack:true});return{kind:'pickup-freeze',entry,frozen,commit,end:t.read(),checks:[{label:'pickup is delayed at entry',pass:entry.held===null&&entry.state?.plan.action==='pickup-standing'},{label:'four frozen steps retain age0 without attaching',pass:frozen.every(r=>r.held===null&&r.state?.framesElapsed===0)},{label:'native2 resumes attaching same reserved identity',pass:commit.held===item.id&&commit.state?.framesElapsed===1},{label:'held pickup attack cannot become fighter attack',pass:t.read().attack===null}]};}));
 report.rows.push(await page.evaluate(()=>{const t=window.__dkItems,{a}=t;t.reset();const setup=t.pickup();const entry=t.tick({grab:true,moveY:-.5});a.applyHit({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:0,y:-1,scaling:0}});const trace=Array.from({length:20},()=>t.tick());return{kind:'pre-release-damage',entry,trace,checks:[{label:'interruption follows successful throw entry',pass:entry.state?.plan.action==='throw-ground-up-ordinary'},{label:'pre-event interruption keeps held item without release',pass:trace.every(r=>r.held===setup.item.id&&!r.thrown.some(x=>x.id===setup.item.id)&&r.state===null)}]};}));
 // Separate genuine keyboard routes establish pickup/release edge consumers.
 for(const facing of[1,-1]){
  await page.evaluate(facing=>{const t=window.__dkItems;t.reset();t.spawn();t.a.setFacing(facing);t.setPhysical(true);},facing);
  await page.keyboard.down('f');const entry=await page.evaluate(()=>window.__dkItems.tick());
  await page.keyboard.up('f');const commit=await page.evaluate(()=>window.__dkItems.tick());
  await page.evaluate(()=>{for(let n=0;n<9;n++)window.__dkItems.tick();});
  await page.keyboard.down('t');const throwEntry=await page.evaluate(()=>window.__dkItems.tick());
  const trace=await page.evaluate(()=>Array.from({length:9},()=>window.__dkItems.tick()));
  await page.keyboard.up('t');await page.evaluate(()=>window.__dkItems.tick());
  const name=`keyboard-pickup-drop-${facing}`;await page.screenshot({path:`${output}/${name}.png`});
  report.rows.push({kind:name,entry,commit,throwEntry,trace,checks:[{label:'physical F pickup reserves at age0 then callback2 attaches',pass:entry.state?.plan.action==='pickup-standing'&&entry.held===null&&commit.held!==null},{label:'physical T neutral request selects delayed ground drop',pass:throwEntry.state?.plan.action==='ground-drop'&&throwEntry.held!==null&&trace[4].held!==null&&trace[5].held===null},{label:'physical held T consumed after release',pass:trace.every(r=>r.grab==='idle')}]});
 }
 report.checks=report.rows.flatMap(r=>r.checks);report.result=report.errors.length||report.checks.some(c=>!c.pass)?'FAIL':'PASS_SCOPED_ITEM_CLOCKS';
 console.log(JSON.stringify({result:report.result,cases:report.rows.length,checks:report.checks.length,failed:report.rows.filter(r=>r.checks.some(c=>!c.pass)).map(r=>({kind:r.kind,direction:r.direction,airborne:r.airborne,strong:r.strong,facing:r.facing,checks:r.checks.filter(c=>!c.pass)}))}));
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);}finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
if(report.result!=='PASS_SCOPED_ITEM_CLOCKS')process.exitCode=1;
