import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
import {verifyPikachuSurfaceTechTrace} from './pikachu-completion-surface-tech-trace-verify.mjs';

const prefix=process.env.PF_STAGED_PREFIX;
assert.ok(prefix&&process.env.PF_REGISTRY_URL,'Set immutable PF_STAGED_PREFIX and PF_REGISTRY_URL');
const build=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
const hashes=JSON.parse(await readFile(build.sourceHashes,'utf8'));
assert.ok(build.sourceLeafDirectory,'Surface consumer needs immutable same-directory source graph');
const leaf=`${build.sourceLeafDirectory}/pikachuSurfaceTech.ts`;
for(const name of ['pikachuSurfaceTech','pikachuAuxiliaryBody'])assert.equal(createHash('sha256').update(await readFile(`${build.sourceLeafDirectory}/${name}.ts`)).digest('hex'),hashes[`src/characters/${name}.ts`]);
assert.equal(createHash('sha256').update(await readFile(`${prefix}-pikachu-frames.json`)).digest('hex'),build.pikachuFramesSha256);
const {selectPikachuSurfaceTechBody}=await tsImport(new URL(`../${leaf}`,import.meta.url).pathname,import.meta.url);
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-surface-tech';
await mkdir(output,{recursive:true});
const report={result:'RUNNING',build,sourceLeaf:leaf,errors:[],failedResponses:[],cases:[],scope:'Actual immutable MatchScene keyboard H fresh shield after public hit launch and a genuine live Matter wall/ceiling collision. Initial high-air fixture only; no actor state/position/velocity writes after launch. Source body/root/mirror and12 capsules throughout wall25 authored beta commitment or ceiling27 source-cancel commitment; native protection wall[1,21),ceiling[1,18). Native common buffers, wall trajectory and collision threshold remain explicit beta. Authored giant melee controls probe contact/protection, not native attack geometry.'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const held=new Set(),down=async key=>{await page.keyboard.down(key);held.add(key);},up=async key=>{await page.keyboard.up(key);held.delete(key);},release=async()=>{for(const key of [...held])await up(key);};
const step=async(n=1)=>page.evaluate(n=>window.__surfaceStep(n),n);
const capture=async(c,label)=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const observation=await page.evaluate(()=>window.__surfaceRead());const screenshot=`${c.id}-${label}.png`;await page.screenshot({path:`${output}/${screenshot}`});const view=await page.evaluate(()=>{const g=window.__game,c=g.scene.getScene('MatchScene').cameras.main,b=g.canvas.getBoundingClientRect();return{camera:{worldView:{x:c.worldView.x,y:c.worldView.y,width:c.worldView.width,height:c.worldView.height},x:c.x,y:c.y,width:c.width,height:c.height,zoom:c.zoom},canvas:{left:b.left,top:b.top,width:b.width,height:b.height,internalWidth:g.canvas.width,internalHeight:g.canvas.height}};});c.captures.push({screenshot,observation,...view});};
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,build.bundleSha256);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:7193,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:1,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.hitboxDebugLayer.setEnabled(true);
  const a=s.p1,floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of s.baseStage.bodies.platformBodies)if(b!==floor){b.collisionFilter.mask=0;s.matter.world.remove(b);} // preserve indexed array
  let surface=null,drawing=null;
  const read=()=>{const sp=s.playerSlots[0].sprite;return{surface:a.getPikachuSurfaceTechPresentationState(),groundRecovery:a.getPikachuGroundRecoveryPresentationState(),position:a.getPosition(),velocity:a.getVelocity(),facing:a.getFacing(),grounded:a.isGrounded(),tumbling:a.isTumbling(),hitlag:a.getHitlagRemaining(),hitstun:a.getHitstunRemaining(),invincible:a.isInvincible(),ignoreGravity:a.body.ignoreGravity??false,percent:a.getDamagePercent(),jumpsUsed:a.getJumpsUsed(),jump:a.getJumpPresentationState(),move:a.getActiveAttack()?.move.id??null,receiving:a.getActiveHurtboxes(),texture:sp.texture.key,textureFrame:Number(sp.frame.name),origin:[sp.originX,sp.originY],scale:[sp.scaleX,sp.scaleY],mirror:Math.sign(sp.scaleX)*(sp.flipX?-1:1),rotation:sp.rotation,spritePosition:{x:sp.x,y:sp.y},stocks:s.playerSlots.map(slot=>({index:slot.playerIndex,stocks:s.stockTracker.getStocks(slot.playerIndex)})),pairs:[...a.contactPairs.values()].map(pair=>{const other=pair.bodyA===a.body?pair.bodyB:pair.bodyA;const sign=pair.bodyA===a.body?1:-1;return{id:other.id,mask:other.collisionFilter.mask,sensor:other.isSensor,active:pair.isActive,normal:pair.collision?{x:pair.collision.normal.x*sign,y:pair.collision.normal.y*sign}:null};}),fixture:surface?{id:surface.id,bounds:surface.bounds,mask:surface.collisionFilter.mask,sensor:surface.isSensor}:null,input:{shield:s.inputResolver.isActionHeld(1,'shield'),jump:s.inputResolver.isActionHeld(1,'jump')},attacker:s.p2.getActiveAttack()?{id:s.p2.getActiveAttack().move.id,age:s.p2.getActiveAttack().framesElapsed,sensor:s.p2.getActiveAttack().hitboxBody?{bounds:s.p2.getActiveAttack().hitboxBody.bounds}:null}:null};};
  const step=(n=1)=>{let o;for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();o=read();}return o;};
  window.__surfaceStep=step;window.__surfaceRead=read;
  window.__surfaceReset=({kind,side,facing})=>{if(surface){surface.collisionFilter.mask=0;s.matter.world.remove(surface);drawing.destroy();}a.resetForRound(floor.position.x,floor.bounds.min.y-425);a.setFacing(facing);s.p2.resetForRound(floor.position.x+450,floor.bounds.min.y-25);step();for(let n=0;n<20;n++)s.update(0,s.physicsEngine.fixedTimestepMs);const p=a.getPosition();surface=kind==='wall'?s.matter.add.rectangle(p.x+side*60,p.y,20,1000,{isStatic:true,label:'platform.solid',collisionFilter:{...floor.collisionFilter}}):s.matter.add.rectangle(p.x,p.y-65,1000,20,{isStatic:true,label:'platform.solid',collisionFilter:{...floor.collisionFilter}});s.baseStage.bodies.platformBodies.push(surface);drawing=s.add.rectangle(surface.position.x,surface.position.y,kind==='wall'?20:1000,kind==='wall'?1000:20,0x86a7bd,.45).setDepth(0);return read();};
  window.__surfaceLaunch=({kind,side})=>{a.applyHit({damage:1,knockback:{x:kind==='wall'?8:0,y:kind==='ceiling'?-8:0,scaling:0},facing:side,hitlagMultiplier:1});return read();};
  window.__surfaceModify=kind=>{if(kind==='mask0')surface.collisionFilter.mask=0;if(kind==='sensor')surface.isSensor=true;if(kind==='stale')s.matter.body.setPosition(surface,{x:surface.position.x+2000,y:surface.position.y});return read();};
  window.__surfaceFreeze=()=>{const before=read();for(let n=0;n<5;n++)s.update(0,s.physicsEngine.fixedTimestepMs);return{before,after:read()};};
  window.__surfaceProbe=()=>{s.p2.addAttack({id:'probe.surface-contact',type:'jab',startupFrames:1,activeFrames:4,recoveryFrames:0,cooldownFrames:0,damage:2,knockback:{x:0,y:0,scaling:0},hitbox:{offsetX:0,offsetY:0,width:3000,height:3000},hitlagMultiplier:1});s.p2.attemptAttack('probe.surface-contact');return read();};
 });
 const entry=async(c,variant='fresh')=>{
  await release();await step(2);await page.evaluate(c=>window.__surfaceReset(c),c);if(variant==='held')await down('h');await step();
  c.launched=await page.evaluate(c=>window.__surfaceLaunch(c),c);if(variant==='expired'){await down('h');await step();await up('h');}
  c.flight=[];let o;for(let n=0;n<80;n++){o=await step();c.flight.push(o);if(o.pairs.some(p=>p.id===o.fixture.id&&p.active!==false))break;}
  assert.ok(o.pairs.some(p=>p.id===o.fixture.id&&p.active!==false),'actual physical contact required');c.contact=o;
  if(['mask0','sensor','stale'].includes(variant))await page.evaluate(v=>window.__surfaceModify(v),variant);
  if(variant!=='held')await down('h');c.entry=await step();await release();return c.entry;
 };
 const contacts=[...[1,-1].flatMap(side=>[1,-1].map(facing=>({kind:'wall',side,facing}))),...[1,-1].map(facing=>({kind:'ceiling',side:1,facing}))];
 for(const spec of contacts){
  const c={...spec,id:`${spec.kind}-${spec.side}-${spec.facing}`,captures:[],trace:[]};report.cases.push(c);await entry(c);assert.ok(c.entry.surface);c.trace.push(c.entry);await capture(c,0);
  const duration=c.entry.surface.duration;for(let age=1;age<duration;age++){const o=await step();c.trace.push(o);if(age===8)c.pause=await page.evaluate(()=>window.__surfaceFreeze());if([6,12,13,18,20,24,26].includes(age))await capture(c,age);}
  await down('w');c.firstFree=await step();await capture(c,'free');await release();
 }
 for(const kind of ['wall','ceiling'])for(const variant of ['held','expired','mask0','sensor','stale']){const c={kind,side:1,facing:1,variant,id:`reject-${kind}-${variant}`,captures:[]};report.cases.push(c);await entry(c,variant);await capture(c,'rejected');}
 if(process.env.PF_SURFACE_CONTACTS==='1')for(const kind of ['wall','ceiling'])for(const facing of [1,-1])for(const protection of ['protected','vulnerable']){
  const c={kind,side:1,facing,protection,id:`contact-${kind}-${facing}-${protection}`,captures:[],trace:[]};report.cases.push(c);await entry(c);const age=protection==='protected'?4:(kind==='wall'?20:17);while((await page.evaluate(()=>window.__surfaceRead())).surface.framesElapsed<age)await step();c.before=await page.evaluate(()=>window.__surfaceProbe());await capture(c,'before');for(let n=0;n<4;n++)c.trace.push(await step());c.after=c.trace.at(-1);await capture(c,'after');
 }
 const validation=verifyPikachuSurfaceTechTrace(report,metadata,selectPikachuSurfaceTechBody);report.validation=validation;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.cases.length,captures:report.cases.flatMap(c=>c.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}finally{await release().catch(()=>{});await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
