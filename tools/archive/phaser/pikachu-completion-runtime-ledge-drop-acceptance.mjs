import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';

if(!process.env.PF_BUILD_RECORD)throw Error('Set PF_BUILD_RECORD to an immutable checkpoint');
const recordPath=process.env.PF_BUILD_RECORD,checkpoint=recordPath.replace(/-assets-staged\.json$/,'');
const build=JSON.parse(await readFile(recordPath,'utf8'));
const metadata=JSON.parse(await readFile(checkpoint+'-pikachu-frames.json','utf8'));
const poses=(await tsImport(new URL('../'+checkpoint+'-pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url)).PIKACHU_STATE_AUTHORED_HURTBOX_POSES;
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-ledge-drop';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],build,scope:'Actual both-corner catches followed by normal simulated InputResolver down/away ledge drop. Live physical clearance, vulnerable ordinary fall, native18 loop body/12caps and freeze, thirty-step beta tether cooldown; fresh air-jump and neutral special remain usable during cooldown. Native common drop trajectory/cooldown parity and human-controller feel are separate fidelity limits.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureDrop',n=>page.screenshot({path:`${output}/${n}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,build.bundleSha256);
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const x of game.scene.getScenes(true))game.scene.stop(x.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1308,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.hitboxDebugLayer.setEnabled(true);
  let input={};s.inputResolver.getMoveVector=slot=>({x:slot===1?input.moveX??0:0,y:slot===1?input.moveY??0:0});s.inputResolver.isActionHeld=(slot,k)=>slot===1&&input[k]===true;
  const step=(next={})=>{input=next;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
  const a=s.p1,floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  const read=()=>{const sp=s.playerSlots[0].sprite;return{position:a.getPosition(),velocity:a.getVelocity(),grounded:a.isGrounded(),facing:a.getFacing(),ledge:a.getLedgeHangState(),attachment:a.getPikachuLedgeAttachmentState(),ordinary:a.getOrdinaryPresentationState(),jump:a.getJumpPresentationState(),jumps:a.getJumpsUsed(),special:a.getPikachuSpecialState(),move:a.getActiveAttack()?.move.id??null,invincible:a.isInvincible(),helpless:a.isHelpless(),stocks:s.stockTracker.getStocks(0),texture:sp.texture.key,textureFrame:Number(sp.frame.name),origin:[sp.originX,sp.originY],spritePosition:{x:sp.x,y:sp.y},rotation:sp.rotation,scale:[sp.scaleX,sp.scaleY],flipX:sp.flipX,bodyMirror:Math.sign(sp.scaleX)*(sp.flipX?-1:1),receiving:a.getActiveHurtboxes(),camera:{scrollX:s.cameras.main.scrollX,scrollY:s.cameras.main.scrollY,zoom:s.cameras.main.zoom}};};
  const rows=[];
  for(const facing of[1,-1])for(const route of['fall-down','fall-away','airjump','special']){
   const corner={x:facing===1?floor.bounds.min.x:floor.bounds.max.x,y:floor.bounds.min.y};
   a.resetForRound(corner.x-facing*18,corner.y+6);s.p2.resetForRound(floor.position.x,corner.y-25);a.setFacing(facing);a.setDamagePercent(0);s.matter.body.setVelocity(a.body,{x:0,y:1});
   let caught=null;for(let n=0;n<15;n++){step();if(a.isHangingOnLedge()){caught=read();break;}}if(!caught)throw Error('realcorner catch missed');
   for(let n=0;n<19;n++)step();const beforeDrop=read();
   step(route==='fall-away'?{moveX:-facing}:{moveY:1});const trace=[read()],captures=[];
   const capture=async(frame)=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const screenshot=`drop-${facing}-${route}-${frame}.png`;await window.__captureDrop(screenshot);captures.push({screenshot,observation:read()});};
   await capture(0);let freeze=null;
   for(let n=1;n<=36;n++){
    step(n===8&&route==='airjump'?{jump:true}:n===8&&route==='special'?{special:true}:{});trace.push(read());
    if([5,6,7,8,12,17,18,29,30,35,36].includes(n))await capture(n);
    if(n===6){const before=read();for(let k=0;k<5;k++)s.update(0,s.physicsEngine.fixedTimestepMs);freeze={before,after:read()};}
   }
   rows.push({facing,route,corner,tuning:a.getTuning().ledge,caught,beforeDrop,trace,captures,freeze});
  }
  return rows;
 });
 for(const row of report.rows){
  const first=row.trace[0];assert.equal(row.beforeDrop.ledge.name,'hanging');assert.equal(first.attachment,null);assert.equal(first.ledge.name,'cooldown');assert.equal(first.ledge.cooldownRemaining,row.tuning.tetherCooldownFrames);assert.equal(first.grounded,false);assert.equal(first.invincible,false);assert.equal(first.helpless,false);
  assert.ok(first.position.y-row.beforeDrop.position.y>=row.tuning.dropDownClearance-.1,'true downward separation');
  assert.ok(row.trace.every(o=>o.ledge.name!=='hanging'),'no unintended regrab');assert.ok(row.trace.every(o=>o.stocks===row.caught.stocks),'survives observed drop window');
  const {camera:c1,...b}=row.freeze.before,{camera:c2,...a}=row.freeze.after;assert.deepEqual(a,b,'paused fixed-step clocks and actual body remain frozen');
  for(const o of row.trace){
   if(o.texture!=='char.pikachu.fall')continue;assert.equal(o.ordinary.sheet,'fall');const clip=metadata.animations.fall,age=o.ordinary.framesElapsed%clip.loopDuration,w=clip.frameWindows.find(w=>w.startFrame<=age&&age<w.endFrame);assert.equal(o.textureFrame,w.artFrameIndex);assert.deepEqual(o.receiving,poses.find(p=>p.sheet==='fall'&&p.artFrameIndex===w.artFrameIndex).hurtboxes);assert.equal(o.receiving.length,12);assert.equal(o.bodyMirror,row.facing);assert.deepEqual(o.origin,[.5,416/512]);
  }
  if(row.route.startsWith('fall')){assert.equal(row.trace[30].ledge.cooldownRemaining,0);assert.equal(row.trace[30].ledge.name,'idle');assert.ok(row.trace.slice(0,30).every(o=>o.ledge.cooldownRemaining>0));assert.ok(row.trace.every(o=>!o.invincible));assert.ok(row.trace[36].position.y>first.position.y);assert.equal(new Set(row.trace.map(o=>o.textureFrame)).size,3);}
  if(row.route==='airjump'){assert.equal(row.trace[8].jump.kind,'air');assert.equal(row.trace[8].jumps,2);assert.ok(row.trace[8].velocity.y<0);assert.ok(row.trace[8].ledge.cooldownRemaining>0);assert.equal(row.trace[8].texture,'char.pikachu.airjump');}
  if(row.route==='special'){assert.ok(row.trace[8].special);assert.ok(row.trace[8].ledge.cooldownRemaining>0);assert.ok(row.trace[8].move?.startsWith('pikachu.'),'fresh special starts real move');}
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:'PASS',rows:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(output+'/ledge-drop-match-observations.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
