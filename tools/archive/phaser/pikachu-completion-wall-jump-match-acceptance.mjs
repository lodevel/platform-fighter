import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';

// This harness intentionally requires the caller's immutable wall-consumer build.
const prefix=process.env.PF_STAGED_PREFIX;
assert.ok(prefix,'PF_STAGED_PREFIX must name the immutable wall-consumer build');
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-wall-jump';
const record=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const frames=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
const auxiliarySnapshot=record.sourceLeafDirectory?`${record.sourceLeafDirectory}/pikachuAuxiliaryBody.ts`:`${prefix}-pikachuAuxiliaryBody.ts`;
const auxiliaryBytes=await readFile(auxiliarySnapshot);
const sourceHashes=JSON.parse(await readFile(record.sourceHashes,'utf8'));
assert.equal(createHash('sha256').update(auxiliaryBytes).digest('hex'),sourceHashes['src/characters/pikachuAuxiliaryBody.ts'],'immutable source oracle must match staged leaf hash');
const {selectPikachuAuxiliaryBody}=await tsImport(new URL(`../${auxiliarySnapshot}`,import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});
const report={result:'RUNNING',build:record,cases:[],errors:[],failedResponses:[],scope:'Actual production MatchScene default keyboard W/A/D/G. Real Matter solid side contact and fresh edge before ordinary air-jump budget arbitration. Two normal air jumps exhaust the budget before wall installation; thereafter no actor position/velocity/state mutation. Native PassiveWallJump body and 12 capsules at0/11/22/33/44; ordinary wall launch6.5/-13 is explicitly beta, no native common parity claim.'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const held=new Set(),down=async key=>{await page.keyboard.down(key);held.add(key);},up=async key=>{await page.keyboard.up(key);held.delete(key);},release=async()=>{for(const key of [...held])await up(key);};
const step=async(n=1)=>page.evaluate(n=>window.__wallStep(n),n);
const capture=async(c,name,o)=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const screenshot=`${name}.png`;await page.screenshot({path:`${output}/${screenshot}`});const view=await page.evaluate(()=>{const g=window.__game,c=g.scene.getScene('MatchScene').cameras.main,b=g.canvas.getBoundingClientRect();return{camera:{worldView:{x:c.worldView.x,y:c.worldView.y,width:c.worldView.width,height:c.worldView.height},x:c.x,y:c.y,width:c.width,height:c.height,zoom:c.zoom},canvas:{left:b.left,top:b.top,width:b.width,height:b.height,internalWidth:g.canvas.width,internalHeight:g.canvas.height}};});c.captures.push({screenshot,observation:o,...view});};
try {
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,record.bundleSha256);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:2711,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;scene.hitboxDebugLayer.setEnabled(true);
  const actor=scene.p1,floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of scene.baseStage.bodies.platformBodies.filter(b=>b!==floor)){b.collisionFilter.mask=0;scene.matter.world.remove(b);} // keep rendered indexed array intact
  let wall=null,wallDrawing=null;
  const read=()=>{const sprite=scene.playerSlots[0].sprite,p=actor.getPosition(),pairs=[...actor.contactPairs.values()].map(pair=>{const b=pair.bodyA===actor.body?pair.bodyB:pair.bodyA;return {id:b.id,label:b.label,isSensor:b.isSensor,mask:b.collisionFilter.mask,normal:pair.collision?.normal};});
   return {presentation:actor.getPikachuAuxiliaryAirPresentationState(),position:p,velocity:actor.getVelocity(),facing:actor.getFacing(),jumpsUsed:actor.getJumpsUsed(),grounded:actor.isGrounded(),invincible:actor.isInvincible(),iframes:actor.getDodgeIframesRemaining(),damage:actor.getDamagePercent(),attack:actor.getActiveAttack()?.move.id??null,receiving:actor.getActiveHurtboxes(),texture:sprite.texture.key,textureFrame:Number(sprite.frame.name),origin:[sprite.originX,sprite.originY],scale:[sprite.scaleX,sprite.scaleY],spritePosition:{x:sprite.x,y:sprite.y},rotation:sprite.rotation,mirror:Math.sign(sprite.scaleX)*(sprite.flipX?-1:1),stocks:scene.playerSlots.map(s=>({index:s.playerIndex,stocks:scene.stockTracker.getStocks(s.playerIndex)})),pairs,wall:wall?{id:wall.id,mask:wall.collisionFilter.mask,isSensor:wall.isSensor,bounds:wall.bounds}:null,input:{move:scene.inputResolver.getMoveVector(1),jump:scene.inputResolver.isActionHeld(1,'jump')}};};
  window.__wallStep=(n=1)=>{let o;for(let i=0;i<n;i++){scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();o=read();}return o;};
  window.__wallRead=read;window.__wallFreeze=()=>{const before=read();for(let i=0;i<5;i++)scene.update(0,scene.physicsEngine.fixedTimestepMs);return{before,after:read()};};
  window.__wallReset=facing=>{if(wall){wall.collisionFilter.mask=0;scene.matter.world.remove(wall);wall=null;wallDrawing.destroy();wallDrawing=null;}const x=(floor.bounds.min.x+floor.bounds.max.x)/2;actor.resetForRound(x,floor.bounds.min.y-25-400);actor.setFacing(facing);actor.setDamagePercent(0);scene.p2.resetForRound(x+450,floor.bounds.min.y-scene.p2.getTuning().height/2);scene.p2.setDamagePercent(0);window.__wallStep();for(let i=0;i<20;i++)scene.update(0,scene.physicsEngine.fixedTimestepMs);return read();};
  window.__wallInstall=side=>{const p=actor.getPosition();wall=scene.matter.add.rectangle(p.x+side*29,p.y,20,500,{isStatic:true,label:'platform.solid',collisionFilter:{...floor.collisionFilter}});scene.baseStage.bodies.platformBodies.push(wall);wallDrawing=scene.add.rectangle(wall.position.x,wall.position.y,20,500,0x86a7bd,.45).setDepth(0);return read();};
  window.__wallModify=kind=>{if(kind==='mask0')wall.collisionFilter.mask=0;if(kind==='sensor')wall.isSensor=true;if(kind==='stale')scene.matter.body.setPosition(wall,{x:wall.position.x+300,y:wall.position.y});if(kind==='pass-through')wall.label='platform.passThrough';return read();};
 });
 const reset=async facing=>{await release();await step(2);return page.evaluate(f=>window.__wallReset(f),facing);};
 const exhaust=async()=>{await down('w');await step();await up('w');await step();await down('w');const o=await step();await up('w');await step();assert.equal(o.jumpsUsed,2);};
 for(const side of [1,-1])for(const facing of [1,-1]){
  const c={kind:'full-clock',side,facing,captures:[],trace:[]};report.cases.push(c);await reset(facing);await exhaust();await page.evaluate(side=>window.__wallInstall(side),side);c.contact=await step();assert.ok(c.contact.pairs.some(p=>p.id===c.contact.wall.id&&Math.abs(p.normal?.x)>=.9));
  await down('w');c.entry=await step();c.trace.push(c.entry);await capture(c,`wall-${side}-face-${facing}-0`,c.entry);
  c.freeze=await page.evaluate(()=>window.__wallFreeze());
  for(let age=1;age<=45;age++){const o=await step();c.trace.push(o);if([11,22,33,44,45].includes(age))await capture(c,`wall-${side}-face-${facing}-${age}`,o);}
  await release();
 }
 for(const side of [1,-1]){
  const c={kind:'outward-edge-interrupt',side,facing:side,captures:[],trace:[]};report.cases.push(c);await reset(side);await exhaust();await page.evaluate(side=>window.__wallInstall(side),side);c.contact=await step();await down(side===1?'a':'d');c.entry=await step();c.trace.push(c.entry);await capture(c,`outward-${side}-0`,c.entry);await release();await step(2);await down('g');c.interrupted=await step();await capture(c,`outward-${side}-jolt`,c.interrupted);await release();await step(90);
 }
 for(const kind of ['no-wall','mask0','sensor','stale','pass-through','held-request'])for(const side of [1,-1]){
  const c={kind:`reject-${kind}`,side,captures:[],trace:[]};report.cases.push(c);await reset(side);await exhaust();if(kind==='held-request'){await down('w');await step();}if(kind!=='no-wall'){await page.evaluate(side=>window.__wallInstall(side),side);c.contact=await step();await page.evaluate(kind=>window.__wallModify(kind),kind);}if(kind!=='held-request')await down('w');c.entry=await step();c.trace.push(c.entry);await capture(c,`reject-${kind}-${side}`,c.entry);await release();
 }
 if(process.env.PF_WALL_CONTACTS==='1')for(const side of [1,-1]){
  const c={kind:'damage-contact',side,captures:[],trace:[],fixtureScope:'Public opponent addAttack/attemptAttack creates an authored giant base2 zero-launch melee contact. This is a collision/protection oracle, not native Wolf geometry.'};report.cases.push(c);await reset(side);await exhaust();await page.evaluate(side=>window.__wallInstall(side),side);c.contact=await step();await down('w');c.entry=await step();c.trace.push(c.entry);await release();await capture(c,`damage-${side}-entry`,c.entry);
  await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');s.p2.addAttack({id:'probe.wall-body-contact',type:'jab',startupFrames:1,activeFrames:8,recoveryFrames:0,cooldownFrames:0,damage:2,knockback:{x:0,y:0,scaling:0},hitbox:{offsetX:0,offsetY:0,width:1300,height:1800},hitlagMultiplier:1});s.p2.attemptAttack('probe.wall-body-contact');});
  c.contactTrace=[];for(let n=0;n<4;n++){const o=await step();c.contactTrace.push(o);if(o.damage>0){c.hit=o;await capture(c,`damage-${side}-hit`,o);break;}}
  await step(12);
 }
 for(const c of report.cases){
  for(const o of c.trace)assert.ok(o.stocks.every(s=>s.stocks===5),'fixture must not cross a KO boundary or lose a stock');
  if(c.kind.startsWith('reject-')){assert.equal(c.entry.presentation,null,c.kind);assert.equal(c.entry.jumpsUsed,2);continue;}
  assert.deepEqual(c.entry.presentation,{sheet:'wall_jump',framesElapsed:0,facing:-c.side});assert.equal(c.entry.facing,-c.side);assert.equal(c.entry.jumpsUsed,2);assert.ok((c.entry.position.x-c.contact.position.x)*-c.side>6);assert.ok(c.entry.velocity.y<-12);
  if(c.freeze)assert.deepEqual(c.freeze.before,c.freeze.after);
  for(let age=0;age<c.trace.length;age++){
   const o=c.trace[age];assert.equal(o.jumpsUsed,2);assert.equal(o.iframes,0);assert.equal(o.invincible,false);assert.equal(o.damage,0);
   if(age===45){assert.equal(o.presentation,null);continue;}
   assert.equal(o.presentation.framesElapsed,age);const pose=selectPikachuAuxiliaryBody('wall_jump',age),clip=frames.animations.wall_jump;
   assert.equal(o.texture,'char.pikachu.wall_jump');assert.equal(o.textureFrame,pose.artFrameIndex);assert.equal(o.mirror,-c.side);assert.equal(o.rotation,0);assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.deepEqual(o.receiving,pose.hurtboxes);assert.equal(o.receiving.length,12);assert.ok(o.receiving.every(h=>!h.intangible));assert.equal(o.grounded,false);
  }
  if(c.interrupted){assert.equal(c.interrupted.presentation,null);assert.equal(c.interrupted.attack,'pikachu.neutral_special');assert.equal(c.interrupted.jumpsUsed,2);}
  if(c.kind==='damage-contact'){assert.ok(c.hit,'actual melee contact must damage wall-bouncing body without protection');assert.equal(c.hit.damage,2*1.05);assert.equal(c.hit.presentation,null,'damage retires the auxiliary source cue');}
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.cases.length,captures:report.cases.flatMap(c=>c.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}finally{await release().catch(()=>{});await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
