import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
import {createBrowserMatchKeyboard} from './browser-match-keyboard.mjs';
import {verifyRespawnReport} from './pikachu-completion-respawn-verify.mjs';
const prefix=process.env.PF_STAGED_PREFIX,output=process.env.PF_REGISTRY_OUTPUT;
assert.ok(prefix&&output,'Set PF_STAGED_PREFIX and PF_REGISTRY_OUTPUT');
const build=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
assert.equal(createHash('sha256').update(await readFile(`${prefix}-pikachu-frames.json`)).digest('hex'),build.pikachuFramesSha256);
const leaf=`${build.sourceLeafDirectory}/pikachuAuxiliaryBody.ts`;
const hashes=JSON.parse(await readFile(build.sourceHashes,'utf8'));
assert.equal(createHash('sha256').update(await readFile(leaf)).digest('hex'),hashes['src/characters/pikachuAuxiliaryBody.ts']);
const {selectPikachuAuxiliaryBody}=await tsImport(new URL(`../${leaf}`,import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});
const report={build,rows:[],errors:[],failedResponses:[],scope:'Actual production stocks/position-blast watcher/RespawnHandler hook, both inward entry facings, own129 Entry visual cue and twelve source receiving regions. Entry is uncommitted; source Rebirth/common effects/selector remain unknown. Stock grace90 and authored native Entry/body projection are distinct. Keyboard movement/jump/attack interrupts; no direct respawn status injection. Default airborne spawn naturally interrupts the cue at ordinary hard landing. A separately declared public Matter static-body fixture pins the actual default airborne spawn after the genuine KO hook, exercising all129 drawings and clocks. That supplemental fixture does not prove default gravity, floor support, source spawn commitment or kinetics; ordinary landing remains validated only by the default airborne cases. Fresh keyboard interruption cases always use unmodified dynamic default spawns.'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});const keyboard=await createBrowserMatchKeyboard(page);
report.inputProvenance='Trusted browser key events through normal Phaser/Match input; letters/arrows use Playwright, P2 Numpad1 uses CDP NumLock-on keyCode97/location3. Human keyboard feel remains unmeasured.';
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const step=n=>page.evaluate(n=>window.__respawnStep(n??1),n);
const capture=async(row,name,o)=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:`${output}/${name}.png`});row.captures.push({screenshot:`${name}.png`,observation:o,view:await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene'),c=s.cameras.main;const b=s.game.canvas.getBoundingClientRect();return {camera:{worldView:{x:c.worldView.x,y:c.worldView.y,width:c.worldView.width,height:c.worldView.height},x:c.x,y:c.y,scrollX:c.scrollX,scrollY:c.scrollY,zoom:c.zoom,width:c.width,height:c.height},canvas:{left:b.left,top:b.top,width:b.width,height:b.height,internalWidth:s.game.canvas.width,internalHeight:s.game.canvas.height},canvasRect:b.toJSON()};})});};
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,build.bundleSha256);
 await page.evaluate(()=>{
  const g=window.__game;for(const s of g.scene.getScenes(true))g.scene.stop(s.scene.key);
  g.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:10,stageId:'flat',rngSeed:4156,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=g.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.hitboxDebugLayer.setEnabled(true);let index=0;
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of s.baseStage.bodies.platformBodies.filter(b=>b!==floor)){b.collisionFilter.mask=0;s.matter.world.remove(b);}
  const alphaCache=new Map();
  const read=()=>{const slot=s.playerSlots[index],a=slot.character,sp=slot.sprite,f=sp.frame,key=sp.texture.key+'/'+f.name;let maxY=alphaCache.get(key);if(maxY===undefined){const cv=document.createElement('canvas');cv.width=f.cutWidth;cv.height=f.cutHeight;const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(sp.texture.getSourceImage(),f.cutX,f.cutY,f.cutWidth,f.cutHeight,0,0,f.cutWidth,f.cutHeight);const bytes=ctx.getImageData(0,0,f.cutWidth,f.cutHeight).data;maxY=-Infinity;for(let y=0;y<f.cutHeight;y++)for(let x=0;x<f.cutWidth;x++)if(bytes[(y*f.cutWidth+x)*4+3]>=32)maxY=Math.max(maxY,y+.5);alphaCache.set(key,maxY);}const alphaBottom=sp.y+(maxY-sp.originY*f.cutHeight)*sp.scaleY;return {index,presentation:a.getPikachuRespawnPresentationState(),position:a.getPosition(),velocity:a.getVelocity(),facing:a.getFacing(),grounded:a.isGrounded(),damage:a.getDamagePercent(),invincible:a.isInvincible(),hitlag:a.getHitlagRemaining(),attack:a.getActiveAttack()?.move.id??null,canAttack:a.canAttack(),receiving:a.getActiveHurtboxes(),texture:sp.texture.key,textureFrame:Number(sp.frame.name),origin:[sp.originX,sp.originY],scale:[sp.scaleX,sp.scaleY],spritePosition:{x:sp.x,y:sp.y},spriteAlpha:sp.alpha,rotation:sp.rotation,mirror:Math.sign(sp.scaleX)*(sp.flipX?-1:1),floorY:floor.bounds.min.y,alpha:{threshold:32,pixelCenters:true,worldBottom:alphaBottom,clearance:floor.bounds.min.y-alphaBottom},stocks:s.stockTracker.getStocks(slot.playerIndex),isStatic:a.body.isStatic,input:{attack:s.inputResolver.isActionHeld(index+1,'attack'),jump:s.inputResolver.isActionHeld(index+1,'jump')},platform:s.respawnHandler.getActiveSpawnPlatforms().find(p=>p.playerIndex===slot.playerIndex)??null};};
  window.__respawnPin=()=>{s.matter.body.setStatic(s.playerSlots[index].character.body,true);return read();};
  window.__respawnRead=read;window.__respawnStep=(n=1)=>{for(let k=0;k<n;k++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  window.__respawnKO=i=>{for(const slot of s.playerSlots)s.matter.body.setStatic(slot.character.body,false);index=i;const a=s.playerSlots[index].character,other=s.playerSlots[1-index].character;other.resetForRound(floor.position.x+400*(index===0?1:-1),floor.bounds.min.y-25);const z=s.baseStage.getViewportBlastZone(),before=s.stockTracker.getStocks(index);a.setDamagePercent(85);a.setPosition(z.x-200,z.y+z.height/2);for(let k=0;k<180;k++){window.__respawnStep();if(a.getPikachuRespawnPresentationState())return {before,entry:read()};}throw Error('Actual stock loss never produced Entry cue');};
  window.__respawnPause=()=>{const before=read();for(let k=0;k<5;k++)s.update(0,s.physicsEngine.fixedTimestepMs);return {before,after:read()};};
  window.__respawnHitlag=()=>s.playerSlots[index].character.armAttackerHitlag(4);
 });
 for(const index of [0,1]){
  const row={kind:'default-airborne-spawn',index,captures:[],trace:[]};report.rows.push(row);row.ko=await page.evaluate(i=>window.__respawnKO(i),index);row.trace.push(row.ko.entry);await capture(row,`default-respawn-${index}-0`,row.ko.entry);
  for(let n=1;n<100;n++){const o=await step(1);row.trace.push(o);if(n===25||!o.presentation){await capture(row,`default-respawn-${index}-${n}`,o);}if(!o.presentation)break;}
 }
 for(const index of [0,1]){
  const row={kind:'full-clock-static-body-fixture',index,captures:[],trace:[],fixtureScope:'Public Matter.Body.setStatic after genuine stock loss/default airborne respawn pins the actor for conditional cue clock/body/drawing consumption only. No native gravity/commitment/support claim.'};report.rows.push(row);row.ko=await page.evaluate(i=>window.__respawnKO(i),index);row.pinned=await page.evaluate(()=>window.__respawnPin());row.trace.push(row.pinned);
  await capture(row,`respawn-${index}-0`,row.pinned);row.pause=await page.evaluate(()=>window.__respawnPause());
  for(let age=1;age<=129;age++){
   const o=await step(1);row.trace.push(o);if([25,30,50,75,89,90,100,128,129].includes(age))await capture(row,`respawn-${index}-${age}`,o);
   if(age===30){await page.evaluate(()=>window.__respawnHitlag());row.hitlag=[];for(let n=0;n<4;n++)row.hitlag.push(await step(1));}
  }
 }
 for(const index of [0,1])for(const action of ['move','jump','attack']){
  const row={kind:'fresh-interrupt',index,action,captures:[]};report.rows.push(row);row.ko=await page.evaluate(i=>window.__respawnKO(i),index);row.beforeAction=await step(26);assert.equal(row.beforeAction.presentation?.framesElapsed,26);assert.equal(row.beforeAction.isStatic,false);
  const key=index===0?{move:'d',jump:'w',attack:'f'}[action]:{move:'ArrowLeft',jump:'ArrowUp',attack:'Numpad1'}[action];
  await keyboard.down(key);row.after=await step(1);await keyboard.up(key);await capture(row,`respawn-${index}-${action}`,row.after);await step(2);
 }
 verifyRespawnReport(report,metadata,selectPikachuAuxiliaryBody);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,rows:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length}));
}catch(e){report.result='FAIL';report.failure=e.stack;throw e;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
