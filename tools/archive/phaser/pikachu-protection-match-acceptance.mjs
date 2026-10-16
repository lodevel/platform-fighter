import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/protection-initial';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']}),page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual MatchScene authored persistent-contact probes distinguish source intangible nonconfirmation from true invincible registered contact; actual lingering grab excludes protected source spot-dodge and captures after expiry. Contact fixtures are labeled authored, not source attack timing.'};page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4235/platform-fighter/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 report.rows=await page.evaluate(()=>{
  const game=window.__game;for(const x of game.scene.getScenes(true))game.scene.stop(x.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:717,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;let inputs=[{},{}];s.inputResolver.getMoveVector=slot=>({x:inputs[slot-1]?.moveX??0,y:inputs[slot-1]?.moveY??0});s.inputResolver.isActionHeld=(slot,key)=>inputs[slot-1]?.[key]===true;
  const step=(a={},b={})=>{inputs=[a,b];s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');const p=s.p1,w=s.p2;
  const reset=f=>{p.resetForRound(floor.position.x,floor.bounds.min.y-25);w.resetForRound(floor.position.x+90*f,floor.bounds.min.y-w.getTuning().height/2);p.setDamagePercent(0);w.setDamagePercent(0);for(let n=0;n<12;n++)step();p.setFacing(f);w.setFacing(-f);};
  const observe=()=>({dodge:p.getDodgeState(),sourceInvincible:p.isSourceInvincible(),throwInvincible:p.isThrowInvincible(),grabbed:p.isGrabbed(),grabber:w.getGrabState(),damage:p.getDamagePercent(),targetFreeze:p.getHitlagRemaining(),attackerFreeze:w.getHitlagRemaining()});
  w.addAttack({id:'probe.persistent-melee',type:'jab',startupFrames:1,activeFrames:45,recoveryFrames:0,cooldownFrames:0,damage:2,knockback:{x:0,y:0,scaling:0},hitbox:{offsetX:0,offsetY:0,width:320,height:180},hitlagMultiplier:1});
  const original=w.getGrabSpec();w.setGrabSpec({...original,startupFrames:1,activeFrames:45,whiffRecoveryFrames:0,hitbox:{offsetX:0,offsetY:0,width:320,height:180},collisionHits:undefined,dashGrab:undefined,pivotGrab:undefined});
  const rows=[];
  for(const facing of [1,-1]){
   reset(facing);step({dodge:true});step();step();step({}, {grab:true});let trace=[];
   for(let n=0;n<30;n++){trace.push(observe());if(p.isGrabbed())break;step();}rows.push({kind:'lingering-grab-vs-spot',facing,trace});
   reset(facing);step({dodge:true});step();step();w.attemptAttack('probe.persistent-melee');trace=[];
   for(let n=0;n<24;n++){step();trace.push(observe());if(p.getDamagePercent()>0)break;}rows.push({kind:'persistent-melee-vs-spot',facing,trace});
   reset(facing);p.setRespawnInvincibility(8);w.attemptAttack('probe.persistent-melee');trace=[];
   for(let n=0;n<15;n++){step();trace.push(observe());}rows.push({kind:'registered-true-invincible-contact',facing,trace,fixture:'Public source-opt-in respawn hook8-step authored timer; actual standard90 respawn path is a separate check.'});
  }
  return rows;
 });
 for(const r of report.rows){
  if(r.kind==='lingering-grab-vs-spot'){assert.ok(r.trace.some(o=>o.dodge.active&&o.dodge.active.framesElapsed>=2&&o.dodge.active.framesElapsed<16));for(const o of r.trace.filter(o=>o.dodge.active?.framesElapsed<16))assert.equal(o.grabbed,false);assert.equal(r.trace.at(-1).grabbed,true);}
  if(r.kind==='persistent-melee-vs-spot'){const protectedRows=r.trace.filter(o=>o.dodge.active?.framesElapsed<16);assert.ok(protectedRows.length);for(const o of protectedRows){assert.equal(o.damage,0);assert.equal(o.attackerFreeze,0);}assert.ok(r.trace.at(-1).damage>0);}
  if(r.kind==='registered-true-invincible-contact'){assert.ok(r.trace.some(o=>o.attackerFreeze>0));assert.ok(r.trace.every(o=>o.damage===0&&o.targetFreeze===0));}
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({rows:report.rows.length,result:report.result}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}finally{await writeFile(`${output}/protection-match-observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
