import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-capture-events';
if(!process.env.PF_BUILD_RECORD)throw Error('Set PF_BUILD_RECORD');
const checkpoint=process.env.PF_BUILD_RECORD.replace(/-assets-staged\.json$/,'');const build=JSON.parse(await readFile(process.env.PF_BUILD_RECORD,'utf8'));const metadata=JSON.parse(await readFile(checkpoint+'-pikachu-frames.json','utf8'));
const poses=(await tsImport(new URL('../'+checkpoint+'-pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url)).PIKACHU_STATE_AUTHORED_HURTBOX_POSES;
const modes=process.env.PF_CAPTURE_MODES?.split(',')??['damage','timeout'];
await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual MatchScene normal simulated InputResolver standing catches bothfaces, grounded-captor first20holding grab_pull→grab_hold, genuine sourcepummel→captured_hit20 with real hit-stop freeze and return highhold, and natural capturetimeout→captor grab_escape/target captured_release29 locks. Source-body12caps/mirror/root measured independently of native hi-low/socket/rate selector fidelity; accompanying immutable alpha audit owns floor acceptance.'};
page.on('pageerror',e=>report.errors.push(e.message));await page.exposeFunction('__captureEventBody',n=>page.screenshot({path:`${output}/${n}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');report.build=build;assert.equal(report.bundleSha256,build.bundleSha256);
 report.rows=await page.evaluate(async({metadata,modes})=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:926,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:1,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;let ai={},bi={};s.inputResolver.getMoveVector=slot=>({x:(slot===1?ai:bi).moveX??0,y:(slot===1?ai:bi).moveY??0});s.inputResolver.isActionHeld=(slot,key)=>(slot===1?ai:bi)[key]===true;
  const step=(a={},b={})=>{ai=a;bi=b;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};const a=s.p1,b=s.p2,floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),rows=[];
  const body=(c,sp)=>({texture:sp.texture.key,textureFrame:Number(sp.frame.name),position:c.getPosition(),spritePosition:{x:sp.x,y:sp.y},origin:[sp.originX,sp.originY],scale:[sp.scaleX,sp.scaleY],rotation:sp.rotation,flipX:sp.flipX,flipY:sp.flipY,facing:c.getFacing(),bodyMirror:Math.sign(sp.scaleX)*(sp.flipX?-1:1),receiving:c.getActiveHurtboxes(),floorY:floor.bounds.min.y,grounded:c.isGrounded()});
  const read=()=>({grab:a.getGrabState(),capture:b.getCapturePresentationState(),budget:a.getCaptureBudgetState(),captured:b.isGrabbed(),aRelease:a.getGrabReleasePresentationState(),bRelease:b.getGrabReleasePresentationState(),aHitlag:a.getHitlagRemaining(),bHitlag:b.getHitlagRemaining(),percent:b.getDamagePercent(),aCanAttack:a.canAttack(),bCanAttack:b.canAttack(),actorMove:a.getActiveAttack()?.move.id??null,actorSpecial:a.getPikachuSpecialState(),actorJumps:a.getJumpsUsed(),victimMove:b.getActiveAttack()?.move.id??null,victimSpecial:b.getPikachuSpecialState(),jumps:b.getJumpsUsed(),stocks:s.stockTracker.getStocks(s.playerSlots[1].playerIndex),actorBody:body(a,s.playerSlots[0].sprite),targetBody:body(b,s.playerSlots[1].sprite)});
  for(const facing of[1,-1])for(const mode of modes){
   a.resetForRound(floor.position.x,floor.bounds.min.y-25);b.resetForRound(floor.position.x+facing*45,floor.bounds.min.y-25);a.setDamagePercent(0);b.setDamagePercent(mode==='damage'?20:0);for(let n=0;n<12;n++)step();a.setFacing(facing);b.setFacing(-facing);step({grab:true});for(let n=0;n<12&&!b.isGrabbed();n++)step();if(!b.isGrabbed())throw Error('realcatch missed');
   const pull=[],trace=[],captures=[],seen=new Set();let afterFree=null;const capture=async(label,o)=>{const screenshot=`${mode}-${facing}-${label}.png`;await window.__captureEventBody(screenshot);captures.push({screenshot,observation:o});};
   const seenHoldCells=new Set();
   for(let n=0;n<=51;n++){
    const o=read();pull.push(o);
    const newHold=o.actorBody.texture==='char.pikachu.grab_hold'&&!seenHoldCells.has(o.actorBody.textureFrame);
    if(newHold)seenHoldCells.add(o.actorBody.textureFrame);
    if([0,5,10,19,20].includes(n)||newHold)await capture('pull'+n,o);
    if(n<51)step();
   }
   if(mode==='damage'){
    step({attack:true});for(let n=0;n<20&&b.getDamagePercent()===20;n++)step();if(b.getDamagePercent()!==21)throw Error('realpummel didnotdamage');
    for(let n=0;n<60;n++){const o=read();trace.push(o);const event=o.capture.event;const age=event.framesElapsed;if(event.kind!=='damage')throw Error('damageevent missing');
     if([0,5,10,19,20].includes(age)&&!seen.has(age)){seen.add(age);await capture('damage'+age,o);}
     if(age>=20)break;step({}, {jump:true,attack:true,special:true});
    }
   }else{
    for(let n=0;n<180&&b.isGrabbed();n++)step();if(b.isGrabbed())throw Error('naturalbudget didnotrelease');
    for(let age=0;age<=29;age++){const o=read();trace.push(o);if([0,6,7,12,15,18,24,28,29].includes(age))await capture('release'+age,o);if(age<29){const attempted=age===4||age===13?{attack:true,special:true,jump:true,moveX:facing}:{};step(attempted,attempted);}}
    step({attack:true},{attack:true});afterFree=read();
   }
   rows.push({facing,mode,pull,trace,captures,afterFree});
  }
  return rows;
 },{metadata,modes});
 const match=(body,sheet,age)=>{const clip=metadata.animations[sheet];const local=clip.loopDuration?age%clip.loopDuration:Math.min(age,clip.frameWindows.at(-1).endFrame-1);const window=clip.frameWindows.find(w=>w.startFrame<=local&&local<w.endFrame);assert.equal(body.texture,'char.pikachu.'+sheet);assert.equal(body.textureFrame,window.artFrameIndex);assert.deepEqual(body.receiving,poses.find(p=>p.sheet===sheet&&p.artFrameIndex===window.artFrameIndex).hurtboxes);assert.equal(body.receiving.length,12);assert.deepEqual(body.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);};
 for(const row of report.rows){
  for(const o of row.pull){const age=o.grab.active.framesElapsed;assert.ok(o.captured);match(o.actorBody,age<20?'grab_pull':'grab_hold',age);assert.equal(o.actorBody.bodyMirror,row.facing);match(o.targetBody,'captured',o.capture.framesElapsed);}
  if(row.mode==='damage'){
   const ages=[...new Set(row.trace.map(o=>o.capture.event.framesElapsed))];assert.deepEqual(ages,Array.from({length:21},(_,i)=>i));
   for(const o of row.trace){assert.ok(o.captured);assert.equal(o.percent,21);assert.equal(o.victimMove,null);assert.equal(o.victimSpecial,null);const age=o.capture.event.framesElapsed;match(o.targetBody,age<20?'captured_hit':'captured',age<20?age:o.capture.framesElapsed);assert.equal(o.targetBody.bodyMirror,o.capture.facing);}
   const frozen=row.trace.filter(o=>o.bHitlag>0);assert.ok(frozen.length>0);assert.ok(frozen.every(o=>o.capture.event.framesElapsed===0));assert.equal(row.trace.at(-1).stocks,row.pull[0].stocks);
  }else{
   for(let age=0;age<29;age++){const o=row.trace[age];assert.equal(o.aRelease.framesElapsed,age);assert.equal(o.bRelease.framesElapsed,age);assert.equal(o.aCanAttack,false);assert.equal(o.bCanAttack,false);assert.equal(o.actorMove,null);assert.equal(o.victimMove,null);assert.equal(o.actorSpecial,null);assert.equal(o.victimSpecial,null);assert.equal(o.actorJumps,0);assert.ok(o.jumps<=row.trace[0].jumps);match(o.actorBody,'grab_escape',age);match(o.targetBody,'captured_release',age);assert.equal(o.actorBody.bodyMirror,o.aRelease.facing);assert.equal(o.targetBody.bodyMirror,o.bRelease.facing);}
   assert.equal(row.trace[29].aRelease,null);assert.equal(row.trace[29].bRelease,null);assert.equal(row.trace[29].stocks,row.pull[0].stocks);
   assert.ok(row.afterFree.actorMove,'fresh first-free actor attack succeeds');assert.ok(row.afterFree.victimMove,'fresh first-free target attack succeeds');
  }
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,rows:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/capture-event-match-observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
