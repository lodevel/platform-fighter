import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.env.PF_CRATE_OUT??'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/native-crate-checkpoint-07';
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={url,scope:'Native-profile crate receiving/contact consumers in actual MatchScene fixed Matter; explicit spawned item, initial flight and public defender protection fixtures. Shield uses CDP simulated physical keypad events through the actual P2 binding, with explicit keyCode99 (headless NumLock default corrected). High-speed crossing is synthetic sampler stress, not source throw velocity. Heavy throw controls, full native container physics, art and unmapped ATTACK_FP flags are separate pending scopes.',cases:[],errors:[],sourceBindings:[]};
for(const path of ['src/items/Crate.ts','src/items/nativeItemThrow.ts','src/scenes/MatchScene.ts','src/characters/Character.ts','src/match/HitboxDamageHandler.ts']){
 const capturedPath=`.tmp/dk-mechanics-checkpoint-07-source-leaves/${path}`;report.sourceBindings.push({path,capturedPath,sha256:hash(await readFile(capturedPath))});
}
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const keypad=await page.context().newCDPSession(page);const shieldKey=async type=>keypad.send('Input.dispatchKeyEvent',{type,key:'3',code:'Numpad3',windowsVirtualKeyCode:99,nativeVirtualKeyCode:99,location:3,isKeypad:true});page.on('pageerror',e=>report.errors.push(e.message));
const checks=(c,label,pass,actual,expected)=>c.checks.push({label,pass,actual,expected});
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);report.bundleSha256=hash(await(await page.request.get(report.bundle)).body());
 if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810071,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of s.baseStage.bodies.platformBodies)if(b!==floor){b.collisionFilter.mask=0;s.matter.world.remove(b);}
  const read=()=>({frame:s.physicsEngine.getFrame(),owner:{damage:s.p1.getDamagePercent(),freeze:s.p1.getHitlagRemaining(),stale:s.p1.getStaleMultiplier('item.crate.throw')},target:{damage:s.p2.getDamagePercent(),position:s.p2.getPosition(),freeze:s.p2.getHitlagRemaining(),shield:s.p2.getShieldState(),hurtboxes:s.p2.getActiveHurtboxes()},thrown:s.thrownItems.map(t=>({id:t.entity.id,x:t.x,y:t.y,vx:t.vx,vy:t.vy,state:t.entity.getSnapshot().state}))});
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  const tr=s.baseStage.transform,scale=s.stage.scale;let pending=true;s.itemSpawnTypeIndex=5;
  s.itemSpawnManager.step=frame=>pending?(pending=false,[{frame,anchorIndex:0,anchor:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(floor.position.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];
  step();const seed=s.getItemRegistry().getActive().at(-1);if(seed?.definition.type!=='crate')throw Error('Missing normal Scene crate definition');
  const def=seed.definition,Entity=seed.constructor;
  const reset=facing=>{for(const item of s.getItemRegistry().getActive())item.markDespawned(s.physicsEngine.getFrame());s.thrownItems=[];for(const visual of s.itemVisuals.values())visual.destroy();s.itemVisuals.clear();s.itemSurfaceY.clear();s.itemFallingY.clear();
   s.p1.resetForRound(floor.position.x-250,floor.bounds.min.y-42);s.p2.resetForRound(floor.position.x+150,floor.bounds.min.y-s.p2.getTuning().height/2);
   s.p1.setFacing(facing);s.p1.setDamagePercent(0);s.p2.setDamagePercent(0);s.p1.setInvincibility(0);s.p2.setInvincibility(0);step(12);return read();};
  const launch=({facing=1,mode='contact',protection=null})=>{
   const p=s.p2.getPosition(),radius=9.119999885559082*5;
   const x=p.x-facing*(mode==='crossing'?200:radius+1),y=p.y+37.5+(mode==='miss'?150:0),vx=facing*(mode==='crossing'?400:12);
   const entity=s.getItemRegistry().spawn(def,{x,y},s.physicsEngine.getFrame(),Entity);entity.markGrounded(s.physicsEngine.getFrame(),{x,y});
   const visual=s.add.container(x,y,[s.add.rectangle(0,-37.5,75,75,0x9c6b35).setStrokeStyle(3,0x3c2515)]);s.itemVisuals.set(entity.id,visual);
   s.thrownItems.push({entity,ownerSlotIndex:s.playerSlots[0].playerIndex,x,y,vx,vy:0,damagePower:1,framesRemaining:120,consumeOnImpact:false,container:visual});
   if(protection)s.p2.setInvincibility(10,protection==='invincible'?'invincible':'legacy');
   const original=s.resolveCombatHit,contacts=[];s.resolveCombatHit=(i,h,c)=>{const result=original(i,h,c);contacts.push({target:i,hit:structuredClone(h),context:{kind:c.kind,projectile:c.projectile,ignoreStaleMoves:c.ignoreStaleMoves},result:structuredClone(result)});return result;};
   return {id:entity.id,mode,x,y,vx,vy:0,radius,contacts};
  };
  window.__dkCrate={s,read,step,reset,launch,contacts:()=>window.__dkCrate.flight.contacts};
 });
 for(const facing of [1,-1])for(const mode of ['contact','miss','crossing']){
  const c={name:`crate-${mode}-${facing}`,checks:[]};report.cases.push(c);await page.evaluate(f=>window.__dkCrate.reset(f),facing);
  c.before=await page.evaluate(()=>window.__dkCrate.read());c.flight=await page.evaluate(spec=>{window.__dkCrate.flight=window.__dkCrate.launch(spec);return {...window.__dkCrate.flight,contacts:[]};},{facing,mode});
  c.after=await page.evaluate(()=>window.__dkCrate.step());c.contacts=await page.evaluate(()=>window.__dkCrate.contacts());
  if(mode==='miss')checks(c,'actual displaced sphere misses all posed receiving geometry',c.after.target.damage===0&&c.contacts.length===0,c.after);
  else{
   const expected=15-.4+Math.hypot(Math.abs(c.flight.vx)-.0125,.6)/5*1.6;
   checks(c,'actual source sphere contact reaches normal combat resolver in the release step',c.contacts.length===1&&c.contacts[0].result.confirmed===true,c.contacts);
   checks(c,'source speed damage applies without fighter freshness bonus',Math.abs(c.after.target.damage-expected)<1e-8,c.after.target.damage,expected);
   checks(c,'source packet reference KB and final published item modifier are retained',c.contacts[0]?.hit.knockback.reference.base===30&&c.contacts[0].hit.knockback.reference.growth===80&&c.contacts[0].hit.referenceKnockbackMultiplier===.8,c.contacts);
   checks(c,'detached item hit does not freeze owner or modify stale queue',c.after.owner.freeze===0&&c.after.owner.stale===c.before.owner.stale,c.after.owner);
  }
  await page.screenshot({path:`${out}/${c.name}.png`});
 }
 for(const protection of ['legacy','invincible']){
  const c={name:`crate-${protection}`,checks:[]};report.cases.push(c);await page.evaluate(()=>window.__dkCrate.reset(1));
  await page.evaluate(protection=>{window.__dkCrate.flight=window.__dkCrate.launch({protection});},protection);
  c.after=await page.evaluate(()=>window.__dkCrate.step());c.contacts=await page.evaluate(()=>window.__dkCrate.contacts());
  checks(c,'protected actual fighter takes no damage',c.after.target.damage===0,c.after);
  if(protection==='legacy')checks(c,'legacy protected contact is rejected without retiring the item',c.contacts.length===1&&c.contacts[0].result.confirmed===false&&c.after.thrown.length===1,c.contacts);
  else checks(c,'true invincibility registers and consumes source item contact',c.contacts.length===1&&c.contacts[0].result.confirmed===true&&c.after.thrown.length===0,c.contacts);
  await page.screenshot({path:`${out}/${c.name}.png`});
 }
 const c={name:'crate-physical-keyboard-shield',checks:[]};report.cases.push(c);await page.evaluate(()=>window.__dkCrate.reset(1));await shieldKey('rawKeyDown');await page.evaluate(()=>window.__dkCrate.step(4));
 c.before=await page.evaluate(()=>window.__dkCrate.read());await page.evaluate(()=>{window.__dkCrate.flight=window.__dkCrate.launch({});});c.after=await page.evaluate(()=>window.__dkCrate.step());c.contacts=await page.evaluate(()=>window.__dkCrate.contacts());
 checks(c,'CDP simulated physical P2 keypad binding raises shield before contact',c.before.target.shield.name==='active',c.before.target.shield);
 checks(c,'crate contact drains actual shield without flesh damage',c.after.target.damage===0&&c.after.target.shield.health<c.before.target.shield.health,c.after.target);
 await shieldKey('keyUp');await page.screenshot({path:`${out}/${c.name}.png`});
 report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.failedChecks=report.cases.flatMap(c=>c.checks.filter(x=>!x.pass).map(x=>({case:c.name,...x})));report.result=report.failedChecks.length||report.errors.length?'FAIL':'PASS_CONTACT_CONSUMER_SCOPE';if(report.result==='FAIL')process.exitCode=1;
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failed:report.failedChecks},null,2));
}catch(e){report.result='ERROR';report.failure=e.stack;process.exitCode=1;console.error(e.stack);}
finally{await shieldKey('keyUp').catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
